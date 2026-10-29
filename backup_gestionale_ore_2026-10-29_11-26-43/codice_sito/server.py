"""
Web API Server for Gestione Ore e Straordinari Dipendenti.
Serves the modern frontend application and provides full REST endpoints for:
- Role-based Authentication & Profile Management (Admin vs Tutor)
- Course Management & Quota Tracking (Monte ore stabilito)
- Weekly Timetable & Course Lecture Schedules
- Daily Work Entries (Scheduled vs Actual hours, uscite anticipate/posticipate)
- Monthly Breakdown per Course & Bank Hours (Banca Ore)
- Excel (.xlsx) and CSV Export/Import
"""

import os
import sys
import re
import json
import tempfile
import datetime
import time
import secrets
import logging
from typing import Optional, Dict, Any, List
from functools import wraps
from logging.handlers import RotatingFileHandler
from bottle import Bottle, request, response, static_file, abort
import database
import excel_engine
import calendar_parser
import email_service
import backup_manager

app = Bottle()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Logging rotativo su file per il server
server_logger = logging.getLogger("server")
server_logger.setLevel(logging.INFO)
log_path = os.path.join(database.DB_DIR, "server.log")
if not server_logger.handlers:
    rfh = RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
    rfh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    server_logger.addHandler(rfh)

# Rate limiting in-memory per login (max 5 tentativi al minuto per IP)
LOGIN_ATTEMPTS = {}

def check_login_rate_limit(ip: str) -> bool:
    now = time.time()
    cutoff = now - 60.0
    attempts = [t for t in LOGIN_ATTEMPTS.get(ip, []) if t > cutoff]
    if len(attempts) >= 5:
        return False
    attempts.append(now)
    LOGIN_ATTEMPTS[ip] = attempts
    return True

# Gestione sessioni persistenti server-side su SQLite con token crittografici e scadenza (30 giorni)
SESSION_LIFETIME = 86400 * 30

def create_session(user: dict) -> str:
    token = secrets.token_hex(32)
    expires_at = time.time() + SESSION_LIFETIME
    database.create_user_session(user["id"], token, expires_at)
    try:
        response.set_cookie("auth_token", token, path="/", max_age=int(SESSION_LIFETIME), httponly=False, samesite="Lax")
    except Exception:
        pass
    return token

def get_authenticated_user() -> Optional[dict]:
    """
    Verifica l'identità dell'utente ESCLUSIVAMENTE tramite sessione persistente verificata in SQLite.
    Supporta Bearer header, X-Auth-Token, query param (per download) o cookie auth_token.
    Nessun fallback insicuro a header o parametri utente non autenticati.
    """
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    if not token:
        token = request.headers.get("X-Auth-Token", "").strip()
    if not token:
        token = request.query.get("auth_token", "").strip()
    if not token:
        token = request.get_cookie("auth_token", "").strip()

    if not token:
        return None

    sess = database.get_user_session(token)
    if not sess:
        return None

    # Aggiorna last_seen con throttle (al massimo ogni 5 minuti)
    if time.time() - sess.get("last_seen", 0) > 300:
        try:
            database.touch_user_session(token)
        except Exception:
            pass

    emp = database.get_employee(sess["user_id"])
    if emp and not emp.get("deleted_at"):
        emp_dict = dict(emp)
        emp_dict["token"] = token
        return emp_dict

    return None

def require_auth(func):
    """Richiede che la richiesta provenga da un utente con sessione autenticata valida."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        user = get_authenticated_user()
        if not user:
            return json_response({
                "status": "error",
                "message": "Autenticazione richiesta. Effettua l'accesso per continuare."
            }, 401)
        return func(*args, **kwargs)
    return wrapper

def require_admin(func):
    """Richiede che la richiesta provenga da un amministratore con sessione valida."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        employees = database.list_employees()
        has_admin = any(e.get("role") == "admin" for e in employees)
        # Se il database non ha ancora un amministratore configurato, permette la prima operazione
        if not has_admin:
            return func(*args, **kwargs)

        user = get_authenticated_user()
        if not user:
            return json_response({
                "status": "error",
                "message": "Autenticazione richiesta. Effettua l'accesso per continuare."
            }, 401)
        if user.get("role") != "admin":
            user_name = user.get('name') if user else 'Anonimo'
            server_logger.warning(f"Accesso negato rotta admin a: {user_name} IP: {request.remote_addr}")
            return json_response({
                "status": "error",
                "message": "Accesso non autorizzato. Operazione riservata all'Amministratore."
            }, 403)
        return func(*args, **kwargs)
    return wrapper


def check_session_permission(user: dict, session_id: int) -> bool:
    """Verifica se l'utente ha il permesso di modificare/eliminare una specifica sessione di calendario."""
    if not user:
        return False
    if user.get("role") == "admin":
        return True
    info = database.get_course_calendar_for_session(session_id)
    if not info:
        return False
    user_id = user.get("id")
    return (info.get("course_tutor_id") == user_id or 
            info.get("stage_tutor_id") == user_id or
            info.get("session_tutor_id") == user_id)


def json_response(data, status=200):
    response.content_type = "application/json"
    response.set_header("X-Content-Type-Options", "nosniff")
    response.status = status
    return json.dumps(data, ensure_ascii=False)


# -------------------------------------------------------------
# STATIC FILES
# -------------------------------------------------------------

@app.route("/")
def index():
    res = static_file("index.html", root=STATIC_DIR)
    res.set_header("Cache-Control", "no-cache, no-store, must-revalidate")
    res.set_header("Pragma", "no-cache")
    res.set_header("Expires", "0")
    return res


@app.route("/static/<filepath:path>")
def server_static(filepath):
    res = static_file(filepath, root=STATIC_DIR)
    res.set_header("Cache-Control", "no-cache, no-store, must-revalidate")
    res.set_header("Pragma", "no-cache")
    res.set_header("Expires", "0")
    return res


# -------------------------------------------------------------
# AUTH & PROFILE API (ADMIN VS TUTOR)
# -------------------------------------------------------------

@app.route("/api/health", method=["GET"])
def health_check():
    """Health check endpoint for CLI runners, scripts, and monitoring."""
    return json_response({
        "status": "ok",
        "app": "gestione_ore_v2",
        "title": "Corsi in Via Nazario Sauro 38/40",
        "timestamp": time.time()
    })


@app.route("/api/auth/me", method=["GET"])
def auth_me():
    """Returns the verified profile and permissions of the currently authenticated session."""
    user = get_authenticated_user()
    if not user:
        return json_response({"status": "error", "message": "Non autenticato"}, 401)
    return json_response({
        "status": "ok",
        "user": user,
        "is_admin": user.get("role") == "admin"
    })


@app.route("/api/auth/logout", method=["POST"])
def auth_logout():
    """Revokes the current session token."""
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    if not token:
        token = request.headers.get("X-Auth-Token", "").strip()
    if not token:
        token = request.query.get("auth_token", "").strip()
    if not token:
        token = request.get_cookie("auth_token", "").strip()

    if token:
        try:
            database.delete_user_session(token)
        except Exception:
            pass

    try:
        response.delete_cookie("auth_token", path="/")
    except Exception:
        pass

    return json_response({"status": "ok", "message": "Disconnessione effettuata con successo."})


@app.route("/api/auth/profiles", method=["GET"])
def get_profiles():
    employees = database.list_employees()
    has_admin = any(e.get("role") == "admin" for e in employees)
    return json_response({
        "status": "ok",
        "profiles": employees,
        "needs_setup": not has_admin
    })


@app.route("/api/auth/setup-admin", method=["POST"])
def setup_admin():
    """Initializes the site by creating the unique primary Admin account with password and email."""
    try:
        employees = database.list_employees()
        if any(e.get("role") == "admin" for e in employees):
            return json_response({
                "status": "error",
                "message": "Configurazione iniziale già completata. Amministratore già presente."
            }, 403)

        data = request.json or {}
        admin = database.setup_admin_profile(data)
        token = create_session(admin)
        admin_dict = dict(admin)
        admin_dict["token"] = token

        # Trigger confirmation email
        email_res = {}
        if admin.get("email"):
            email_res = email_service.send_registration_email(
                to_email=admin["email"],
                user_name=admin["name"],
                role="Amministratore (Admin)"
            )

        return json_response({
            "status": "ok",
            "token": token,
            "user": admin_dict,
            "email_status": email_res
        })
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/admin/reset-data", method=["POST"])
@require_admin
def admin_reset_data():
    """Purges all mock and seeded data to return database to clean pristine state."""
    try:
        database.clean_reset_database()
        return json_response({"status": "ok", "message": "Database svuotato completamente."})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/auth/login", method=["POST"])
def auth_login():
    """Authenticates by identifier (Name or Email) and password with IP rate-limiting."""
    client_ip = request.remote_addr or "127.0.0.1"
    if not check_login_rate_limit(client_ip):
        return json_response({
            "status": "error",
            "message": "Troppi tentativi di accesso. Riprova tra 60 secondi."
        }, 429)

    try:
        data = request.json or {}
        identifier = data.get("identifier", "").strip()
        password = data.get("password", "").strip()

        if not identifier or not password:
            return json_response({
                "status": "error",
                "message": "Inserisci sia Nome e Cognome (o Email) che la Password."
            }, 400)

        emp = database.authenticate_employee(identifier, password)
        if not emp:
            server_logger.warning(f"Tentativo di login fallito per '{identifier}' da IP {client_ip}")
            return json_response({
                "status": "error",
                "message": "Credenziali non corrette. Verifica Nome e Cognome / Email e la Password inserita."
            }, 401)

        token = create_session(emp)
        emp_dict = dict(emp)
        emp_dict["token"] = token
        server_logger.info(f"Login riuscito: {emp['name']} (Ruolo: {emp['role']}) da IP {client_ip}")

        return json_response({
            "status": "ok",
            "token": token,
            "user": emp_dict,
            "is_admin": emp["role"] == "admin"
        })
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/auth/register", method=["POST"])
@app.route("/api/auth/register-tutor", method=["POST"])
def register_user():
    """Allows creating a new user profile. Public registration is strictly limited to role 'tutor'. Admin role requires an authenticated admin caller."""
    try:
        data = request.json or {}
        caller = get_authenticated_user()
        if caller and caller.get("role") == "admin":
            role = str(data.get("role", "tutor")).strip().lower()
            data["role"] = "admin" if role in ("admin", "admin_tutor") else "tutor"
        else:
            # Public registration can ONLY create tutors
            data["role"] = "tutor"
            data["is_tutor"] = 1

        new_id = database.create_employee(data)
        emp = database.get_employee(new_id)
        token = create_session(emp)
        emp_dict = dict(emp)
        emp_dict["token"] = token

        # Determine human-friendly role name for email
        if emp.get("role") == "admin":
            role_label = "Amministratore & Tutor" if emp.get("is_tutor") else "Amministratore (Admin)"
        else:
            role_label = "Tutor d'aula"

        # Trigger confirmation email
        email_res = {}
        if emp and emp.get("email"):
            email_res = email_service.send_registration_email(
                to_email=emp["email"],
                user_name=emp["name"],
                role=role_label
            )

        return json_response({
            "status": "ok",
            "token": token,
            "user": emp_dict,
            "email_status": email_res
        })
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/auth/smtp-config", method=["GET"])
def get_smtp_settings():
    cfg = email_service.get_smtp_config()
    safe_cfg = {k: v for k, v in cfg.items() if k != "password"}
    safe_cfg["has_password"] = bool(cfg.get("password"))
    return json_response({"status": "ok", "config": safe_cfg})


@app.route("/api/auth/smtp-config", method=["POST"])
@require_admin
def update_smtp_settings():
    try:
        data = request.json or {}
        email_service.save_smtp_config(data)
        return json_response({"status": "ok", "message": "Configurazione SMTP salvata con successo."})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


# -------------------------------------------------------------
# EMPLOYEES CRUD (ADMIN CONTROL)
# -------------------------------------------------------------

@app.route("/api/employees", method=["GET"])
@require_auth
def get_employees():
    employees = database.list_employees()
    return json_response({"status": "ok", "employees": employees})


@app.route("/api/employees", method=["POST"])
@require_admin
def create_employee():
    try:
        data = request.json or {}
        new_id = database.create_employee(data)
        emp = database.get_employee(new_id)
        return json_response({"status": "ok", "employee": emp})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/employees/<emp_id:int>", method=["PUT"])
@require_auth
def update_employee(emp_id):
    try:
        user = get_authenticated_user()
        if user.get("role") != "admin" and user["id"] != emp_id:
            return json_response({"status": "error", "message": "Non sei autorizzato a modificare questo profilo."}, 403)

        data = request.json or {}
        # Se non è admin, non può promuoversi da solo ad admin
        if user.get("role") != "admin":
            data.pop("role", None)

        success = database.update_employee(emp_id, data)
        emp = database.get_employee(emp_id)
        return json_response({"status": "ok", "success": success, "employee": emp})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/employees/<emp_id:int>/contract-schedule", method=["GET", "PUT", "POST"])
@require_auth
def employee_contract_schedule(emp_id):
    """Gestisce la visualizzazione e l'aggiornamento dell'orario lavorativo da contratto d'ufficio."""
    user = get_authenticated_user()
    if user.get("role") != "admin" and user["id"] != emp_id:
        return json_response({"status": "error", "message": "Non sei autorizzato a visualizzare o modificare questo orario contrattuale."}, 403)

    if request.method == "GET":
        emp = database.get_employee(emp_id)
        if not emp:
            return json_response({"status": "error", "message": "Dipendente non trovato"}, 404)
        return json_response({
            "status": "ok",
            "employee_id": emp_id,
            "name": emp["name"],
            "contract_office_days": emp.get("contract_office_days") or "lun,mar,mer,gio,ven",
            "contract_office_start": emp.get("contract_office_start") or "09:00",
            "contract_office_end": emp.get("contract_office_end") or "13:00",
            "contract_lunch_start": emp.get("contract_lunch_start") or "",
            "contract_lunch_end": emp.get("contract_lunch_end") or ""
        })
    else:
        data = request.json or {}
        emp = database.get_employee(emp_id)
        if not emp:
            return json_response({"status": "error", "message": "Dipendente non trovato"}, 404)
        update_data = {
            "name": emp["name"],
            "contract_office_days": data.get("contract_office_days", emp.get("contract_office_days") or "lun,mar,mer,gio,ven"),
            "contract_office_start": data.get("contract_office_start", emp.get("contract_office_start") or "09:00"),
            "contract_office_end": data.get("contract_office_end", emp.get("contract_office_end") or "13:00"),
            "contract_lunch_start": data.get("contract_lunch_start", emp.get("contract_lunch_start") or ""),
            "contract_lunch_end": data.get("contract_lunch_end", emp.get("contract_lunch_end") or "")
        }
        database.update_employee(emp_id, update_data)
        updated_emp = database.get_employee(emp_id)
        return json_response({"status": "ok", "employee": updated_emp})


@app.route("/api/employees/<emp_id:int>", method=["DELETE"])
@require_admin
def delete_employee(emp_id):
    try:
        success = database.delete_employee(emp_id)
        return json_response({"status": "ok", "success": success, "message": "Profilo spostato nel Cestino. Puoi ripristinarlo entro 3 giorni."})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/employees/trash", method=["GET"])
def get_deleted_employees():
    trash = database.list_deleted_employees()
    return json_response({"status": "ok", "trash": trash})


@app.route("/api/employees/<emp_id:int>/restore", method=["POST"])
@require_admin
def restore_deleted_employee(emp_id):
    try:
        database.restore_employee(emp_id)
        emp = database.get_employee(emp_id)
        return json_response({"status": "ok", "message": "Profilo ripristinato con successo!", "employee": emp})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/employees/<emp_id:int>/permanent", method=["DELETE"])
@require_admin
def permanent_delete_employee(emp_id):
    try:
        database.permanent_delete_employee(emp_id)
        return json_response({"status": "ok", "message": "Profilo eliminato definitivamente."})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/admin/hours-overview", method=["GET"])
@require_admin
def get_admin_hours_overview():
    try:
        data = database.get_docenti_tutor_hours_summary()
        return json_response({"status": "ok", "data": data})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/admin/backup/download", method=["GET"])
@require_admin
def download_backup():
    try:
        zip_path = backup_manager.create_full_backup()
        filename = os.path.basename(zip_path)
        directory = os.path.dirname(zip_path)
        return static_file(filename, root=directory, download=filename, mimetype="application/zip")
    except Exception as e:
        return json_response({"status": "error", "message": f"Errore creazione backup: {str(e)}"}, 500)


@app.route("/api/admin/backups", method=["GET"])
@require_admin
def list_backups():
    try:
        backups = []
        b_dir = backup_manager.BACKUPS_DIR
        if os.path.exists(b_dir):
            for f in sorted(os.listdir(b_dir), reverse=True):
                if f.endswith(".zip"):
                    p = os.path.join(b_dir, f)
                    st = os.stat(p)
                    backups.append({
                        "filename": f,
                        "size_mb": round(st.st_size / (1024 * 1024), 2),
                        "created_at": datetime.datetime.fromtimestamp(st.st_mtime).strftime("%d/%m/%Y %H:%M:%S")
                    })
        return json_response({"status": "ok", "backups": backups})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 500)


# -------------------------------------------------------------
# COURSES API (MONTE ORE CORSI)
# -------------------------------------------------------------

@app.route("/api/courses", method=["GET"])
@require_auth
def get_courses():
    user = get_authenticated_user()
    emp_id = request.query.get("employee_id")
    if user.get("role") == "admin":
        emp_id_int = int(emp_id) if (emp_id and str(emp_id).lower() != "all") else None
    else:
        # Non-admin tutor can view all courses or their own courses
        emp_id_int = int(emp_id) if (emp_id and str(emp_id).lower() != "all") else None

    courses = database.list_courses(emp_id_int)
    return json_response({"status": "ok", "courses": courses})


@app.route("/api/courses", method=["POST"])
@require_admin
def create_course():
    try:
        data = request.json or {}
        raw_emp = data.get("employee_id")
        emp_id = int(raw_emp) if (raw_emp is not None and str(raw_emp).strip() != "" and str(raw_emp) != "0") else None
        new_id = database.create_course(emp_id, data)
        c = database.get_course(new_id)
        return json_response({"status": "ok", "course": c})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/courses/<course_id:int>", method=["GET"])
@require_auth
def get_course_detail(course_id):
    try:
        c = database.get_course(course_id)
        if not c:
            return json_response({"status": "error", "message": "Corso non trovato"}, 404)
        return json_response({"status": "ok", "course": c})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/courses/<course_id:int>", method=["PUT"])
@require_auth
def update_course(course_id):
    try:
        user = get_authenticated_user()
        c_orig = database.get_course(course_id)
        if not c_orig:
            return json_response({"status": "error", "message": "Corso non trovato"}, 404)

        # Se non è admin, può modificare solo se il corso è assegnato a lui o non è ancora assegnato
        if user.get("role") != "admin":
            if c_orig.get("employee_id") and c_orig.get("employee_id") != user["id"]:
                return json_response({"status": "error", "message": "Non sei autorizzato a modificare i dati di questo corso."}, 403)

        data = request.json or {}
        success = database.update_course(course_id, data)
        c = database.get_course(course_id)
        return json_response({"status": "ok", "success": success, "course": c})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/courses/<course_id:int>", method=["DELETE"])
@require_admin
def delete_course(course_id):
    try:
        success = database.delete_course(course_id)
        return json_response({"status": "ok", "success": success})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/courses/<course_id:int>/toggle-contract-integration", method=["POST", "PUT"])
@require_auth
def toggle_course_contract_integration(course_id):
    """Commuta lo stato di integrazione con le ore contrattuali d'ufficio per un corso specifico."""
    try:
        user = get_authenticated_user()
        c_orig = database.get_course(course_id)
        if not c_orig:
            return json_response({"status": "error", "message": "Corso non trovato"}, 404)
        if user.get("role") != "admin":
            if c_orig.get("employee_id") and c_orig.get("employee_id") != user["id"]:
                return json_response({"status": "error", "message": "Non sei autorizzato a modificare questo corso."}, 403)

        res = database.toggle_course_contract_integration(course_id)
        return json_response(res)
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/courses/<course_id:int>/assign-tutor", method=["POST", "PUT"])
@require_auth
def assign_course_tutor_endpoint(course_id):
    """Abbina un tutor a un corso (o rimuove l'abbinamento)."""
    try:
        user = get_authenticated_user()
        data = request.json or {}
        raw_emp = data.get("employee_id")
        emp_id = int(raw_emp) if (raw_emp is not None and str(raw_emp).strip() != "" and str(raw_emp) != "0") else None

        c_orig = database.get_course(course_id)
        if not c_orig:
            return json_response({"status": "error", "message": "Corso non trovato"}, 404)

        if user.get("role") != "admin":
            current_tutor = c_orig.get("employee_id")
            if current_tutor and current_tutor != user["id"]:
                return json_response({"status": "error", "message": "Questo corso è già assegnato a un altro tutor. Solo l'amministratore può modificare l'assegnazione."}, 403)
            if emp_id is not None and emp_id != user["id"]:
                return json_response({"status": "error", "message": "Puoi abbinare solo il tuo profilo a questo corso."}, 403)
            if emp_id is None and current_tutor != user["id"]:
                return json_response({"status": "error", "message": "Non puoi rimuovere altri tutor da questo corso."}, 403)

        success = database.assign_course_tutor(course_id, emp_id)
        updated = database.get_course(course_id)
        return json_response({"status": "ok", "success": success, "course": updated})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


# -------------------------------------------------------------
# TUTOR DASHBOARD & CONTRACTS API
# -------------------------------------------------------------

@app.route("/api/tutors/<employee_id:int>/dashboard", method=["GET"])
@require_auth
def get_tutor_dashboard(employee_id):
    try:
        user = get_authenticated_user()
        if user.get("role") != "admin" and user["id"] != employee_id:
            return json_response({"status": "error", "message": "Accesso non autorizzato alla dashboard di un altro tutor."}, 403)

        data = database.get_tutor_dashboard_data(employee_id)
        return json_response(data)
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/employees/<employee_id:int>/contracts", method=["GET"])
@require_auth
def get_employee_contracts(employee_id):
    try:
        user = get_authenticated_user()
        if user.get("role") != "admin" and user["id"] != employee_id:
            return json_response({"status": "error", "message": "Accesso negato"}, 403)

        database.seed_default_tutor_contracts_if_empty(employee_id)
        contracts = database.list_employee_contracts(employee_id)
        return json_response({"status": "ok", "contracts": contracts})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/employees/<employee_id:int>/contracts", method=["POST"])
@require_auth
def create_contract(employee_id):
    try:
        user = get_authenticated_user()
        if user.get("role") != "admin" and user["id"] != employee_id:
            return json_response({"status": "error", "message": "Accesso negato"}, 403)

        data = request.json or {}
        new_id = database.create_employee_contract(employee_id, data)
        c = database.get_employee_contract(new_id)
        return json_response({"status": "ok", "contract": c})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/contracts/<contract_id:int>", method=["GET"])
@require_auth
def get_contract(contract_id):
    try:
        user = get_authenticated_user()
        c = database.get_employee_contract(contract_id)
        if not c:
            return json_response({"status": "error", "message": "Contratto non trovato"}, 404)
        if user.get("role") != "admin" and user["id"] != c["employee_id"]:
            return json_response({"status": "error", "message": "Accesso negato"}, 403)
        return json_response({"status": "ok", "contract": c})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/contracts/<contract_id:int>", method=["PUT"])
@require_auth
def update_contract(contract_id):
    try:
        user = get_authenticated_user()
        c = database.get_employee_contract(contract_id)
        if not c:
            return json_response({"status": "error", "message": "Contratto non trovato"}, 404)
        if user.get("role") != "admin" and user["id"] != c["employee_id"]:
            return json_response({"status": "error", "message": "Accesso negato"}, 403)

        data = request.json or {}
        database.update_employee_contract(contract_id, data)
        updated = database.get_employee_contract(contract_id)
        return json_response({"status": "ok", "contract": updated})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/contracts/<contract_id:int>", method=["DELETE"])
@require_auth
def delete_contract(contract_id):
    try:
        user = get_authenticated_user()
        c = database.get_employee_contract(contract_id)
        if not c:
            return json_response({"status": "error", "message": "Contratto non trovato"}, 404)
        if user.get("role") != "admin" and user["id"] != c["employee_id"]:
            return json_response({"status": "error", "message": "Accesso negato"}, 403)

        success = database.delete_employee_contract(contract_id)
        return json_response({"status": "ok", "success": success})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/courses/<course_id:int>/sync-calendar-entries", method=["POST"])
@require_auth
def sync_course_calendar_entries(course_id):
    try:
        user = get_authenticated_user()
        data = request.json or {}
        emp_id = data.get("employee_id")
        if not emp_id:
            c = database.get_course(course_id)
            if c and c.get("employee_id"):
                emp_id = c["employee_id"]
            else:
                emp_id = user["id"]

        emp_id = int(emp_id)
        if user.get("role") != "admin" and emp_id != user["id"]:
            return json_response({"status": "error", "message": "Non sei autorizzato a sincronizzare ore per altri colleghi."}, 403)

        res = database.sync_tutor_course_calendar_entries(course_id, emp_id)
        return json_response(res)
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/courses/<course_id:int>/parse-attendance-file", method=["POST"])
@require_auth
def parse_course_attendance_file(course_id):
    try:
        upload = request.files.get("file")
        if not upload:
            return json_response({"status": "error", "message": "Nessun file selezionato."}, 400)

        filename = upload.raw_filename or upload.filename or "presenze.xlsx"
        file_bytes = upload.file.read()
        if not file_bytes:
            return json_response({"status": "error", "message": "Il file caricato è vuoto."}, 400)

        course_sessions = database.get_course_sessions_for_matching(course_id)
        parsed = calendar_parser.parse_attendance_document(file_bytes, filename, course_sessions)
        return json_response(parsed)
    except Exception as e:
        return json_response({"status": "error", "message": f"Errore analisi documento presenze: {str(e)}"}, 400)


@app.route("/api/courses/<course_id:int>/confirm-attendance-entries", method=["POST"])
@require_auth
def confirm_course_attendance_entries(course_id):
    try:
        user = get_authenticated_user()
        data = request.json or {}
        entries = data.get("entries") or []
        emp_id = data.get("employee_id")
        if not emp_id:
            emp_id = user["id"]
        else:
            emp_id = int(emp_id)

        if user.get("role") != "admin" and emp_id != user["id"]:
            return json_response({"status": "error", "message": "Non sei autorizzato a registrare presenze per altri colleghi."}, 403)

        result = database.save_confirmed_attendance_entries(course_id, emp_id, entries)
        return json_response(result)
    except Exception as e:
        return json_response({"status": "error", "message": f"Errore salvataggio presenze: {str(e)}"}, 400)


@app.route("/api/courses/<course_id:int>/attendance-template", method=["GET"])
@require_auth
def download_course_attendance_template(course_id):
    try:
        c = database.get_course(course_id)
        if not c:
            return json_response({"status": "error", "message": "Corso non trovato"}, 404)
        clean_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', c.get("code") or c.get("name") or "Corso")
        filename = f"Modello_Presenze_{clean_name}.xlsx"
        tmp_path = os.path.join(tempfile.gettempdir(), f"template_{course_id}_{int(time.time())}.xlsx")
        excel_engine.generate_course_attendance_template(course_id, tmp_path)
        return static_file(os.path.basename(tmp_path), root=tempfile.gettempdir(), download=filename, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


# -------------------------------------------------------------
# REPORTS: WEEKLY SCHEDULE & MONTHLY COURSES
# -------------------------------------------------------------

@app.route("/api/reports/weekly-schedule", method=["GET"])
def get_weekly_schedule():
    emp_id = int(request.query.get("employee_id", 1))
    target_date = request.query.get("date") or None
    schedule = database.get_weekly_schedule(emp_id, target_date)
    return json_response({"status": "ok", "schedule": schedule})


@app.route("/api/reports/master-schedule", method=["GET"])
def get_master_schedule():
    try:
        target_date = request.query.get("date") or None
        view_mode = request.query.get("view_mode") or "week"
        course_id_raw = request.query.get("course_id")
        course_id = int(course_id_raw) if course_id_raw and course_id_raw != "all" else None
        schedule = database.get_master_calendar_schedule(target_date, view_mode, course_id)
        return json_response({"status": "ok", "schedule": schedule})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/reports/master-aula-grid", method=["GET"])
def get_master_aula_grid():
    try:
        user = get_authenticated_user()
        docente = request.query.get("docente") or None
        month = request.query.get("month") or None
        status_filter = request.query.get("status") or None
        raw_emp = request.query.get("employee_id")
        if user and user.get("role") != "admin":
            emp_id = user["id"]
        elif raw_emp and raw_emp != "all":
            emp_id = int(raw_emp)
        else:
            emp_id = user["id"] if user else 26
        grid = database.get_master_aula_grid(docente, month, status_filter, emp_id)
        return json_response(grid)
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/reports/monthly-courses", method=["GET"])
def get_monthly_courses():
    emp_id = int(request.query.get("employee_id", 1))
    month_year = request.query.get("month_year") or None
    report = database.get_monthly_courses_report(emp_id, month_year)
    return json_response({"status": "ok", "report": report})


# -------------------------------------------------------------
# DASHBOARD & METRICS API
# -------------------------------------------------------------

@app.route("/api/dashboard", method=["GET"])
@require_auth
def get_dashboard():
    user = get_authenticated_user()
    emp_id = request.query.get("employee_id")
    if not emp_id:
        emp_id = user["id"]
    else:
        emp_id = int(emp_id)

    if user.get("role") != "admin" and emp_id != user["id"]:
        return json_response({"status": "error", "message": "Accesso non autorizzato. Puoi consultare solo i tuoi dati."}, 403)

    dash_data = database.get_dashboard_data(emp_id)
    return json_response({"status": "ok", "data": dash_data})


# -------------------------------------------------------------
# WORK ENTRIES API (CON ORARI EFFETTIVI E PREVISTI)
# -------------------------------------------------------------

@app.route("/api/entries", method=["GET"])
@require_auth
def get_entries():
    user = get_authenticated_user()
    req_emp = request.query.get("employee_id")
    if user.get("role") == "admin":
        emp_id = int(req_emp) if (req_emp and str(req_emp).lower() != "all") else user["id"]
    else:
        # Non-admin può consultare esclusivamente le proprie voci
        emp_id = user["id"]

    month_year = request.query.get("month_year") or None
    entry_type = request.query.get("type") or None
    course_id = request.query.get("course_id")
    course_id_int = int(course_id) if course_id else None
    search = request.query.get("search") or None

    entries = database.list_entries(
        emp_id,
        month_year=month_year,
        entry_type=entry_type,
        course_id=course_id_int,
        search=search
    )
    return json_response({"status": "ok", "entries": entries})


@app.route("/api/entries", method=["POST"])
@require_auth
def add_entry():
    try:
        user = get_authenticated_user()
        data = request.json or {}
        req_emp = data.get("employee_id")
        emp_id = int(req_emp) if req_emp else user["id"]

        if user.get("role") != "admin" and emp_id != user["id"]:
            return json_response({"status": "error", "message": "Non sei autorizzato a registrare ore per altri colleghi."}, 403)

        new_id = database.add_entry(emp_id, data)
        return json_response({"status": "ok", "id": new_id})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/entries/<entry_id:int>", method=["PUT"])
@require_auth
def update_entry(entry_id):
    try:
        user = get_authenticated_user()
        if user.get("role") != "admin":
            entry = database.get_entry(entry_id)
            if not entry or entry["employee_id"] != user["id"]:
                return json_response({"status": "error", "message": "Non sei autorizzato a modificare questa voce."}, 403)

        data = request.json or {}
        success = database.update_entry(entry_id, data)
        return json_response({"status": "ok", "success": success})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/entries/<entry_id:int>", method=["DELETE"])
@require_auth
def delete_entry(entry_id):
    try:
        user = get_authenticated_user()
        if user.get("role") != "admin":
            entry = database.get_entry(entry_id)
            if not entry or entry["employee_id"] != user["id"]:
                return json_response({"status": "error", "message": "Non sei autorizzato a eliminare questa voce."}, 403)

        success = database.delete_entry(entry_id)
        return json_response({"status": "ok", "success": success})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/entries/calculate-breakdown", method=["POST"])
@require_auth
def api_calculate_breakdown():
    """Calcola in anteprima le ore effettive per fasce orarie e rileva sovrapposizioni."""
    try:
        data = request.json or {}
        office_start = str(data.get("office_start") or "").strip()
        office_end = str(data.get("office_end") or "").strip()
        lunch_start = str(data.get("lunch_break_start") or data.get("lunch_start") or "").strip()
        lunch_end = str(data.get("lunch_break_end") or data.get("lunch_end") or "").strip()
        course_start = str(data.get("course_start") or "").strip()
        course_end = str(data.get("course_end") or "").strip()
        is_integrated = bool(data.get("is_integrated"))
        contract_hours = float(data.get("contract_hours", 4.0))

        res = database.calculate_day_hours_breakdown(
            office_start=office_start,
            office_end=office_end,
            lunch_start=lunch_start,
            lunch_end=lunch_end,
            course_start=course_start,
            course_end=course_end,
            is_integrated=is_integrated,
            contract_hours=contract_hours
        )
        return json_response({"status": "ok", "breakdown": res})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


# -------------------------------------------------------------
# EXPORT / IMPORT API
# -------------------------------------------------------------

@app.route("/api/export/excel", method=["GET"])
@require_auth
def export_excel():
    user = get_authenticated_user()
    emp_id = int(request.query.get("employee_id", user["id"]))
    if user.get("role") != "admin" and emp_id != user["id"]:
        return json_response({"status": "error", "message": "Non sei autorizzato a esportare i dati di un altro dipendente."}, 403)

    emp = database.get_employee(emp_id)
    emp_name = emp["name"] if emp else "Dipendente"

    safe_name = "".join(c for c in emp_name if c.isalnum() or c in (" ", "_", "-")).strip().replace(" ", "_")
    filename = f"Gestione_Straordinari_{safe_name}.xlsx"
    tmp_path = os.path.join(tempfile.gettempdir(), filename)

    excel_engine.export_to_excel(emp_id, tmp_path)
    return static_file(filename, root=tempfile.gettempdir(), download=filename, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.route("/api/export/csv", method=["GET"])
@require_auth
def export_csv():
    user = get_authenticated_user()
    emp_id = int(request.query.get("employee_id", user["id"]))
    if user.get("role") != "admin" and emp_id != user["id"]:
        return json_response({"status": "error", "message": "Non sei autorizzato a esportare i dati di un altro dipendente."}, 403)

    emp = database.get_employee(emp_id)
    emp_name = emp["name"] if emp else "Dipendente"

    safe_name = "".join(c for c in emp_name if c.isalnum() or c in (" ", "_", "-")).strip().replace(" ", "_")
    filename = f"Registro_Ore_{safe_name}.csv"
    tmp_path = os.path.join(tempfile.gettempdir(), filename)

    excel_engine.export_to_csv(emp_id, tmp_path)
    return static_file(filename, root=tempfile.gettempdir(), download=filename, mimetype="text/csv; charset=utf-8")


@app.route("/api/import/excel", method=["POST"])
@require_auth
def import_excel():
    try:
        user = get_authenticated_user()
        emp_id = int(request.forms.get("employee_id", user["id"]))
        if user.get("role") != "admin" and emp_id != user["id"]:
            return json_response({"status": "error", "message": "Non sei autorizzato a importare dati per un altro dipendente."}, 403)

        upload = request.files.get("file")
        if not upload:
            return json_response({"status": "error", "message": "Nessun file caricato"}, 400)

        tmp_path = os.path.join(tempfile.gettempdir(), upload.filename)
        upload.save(tmp_path, overwrite=True)

        count = excel_engine.import_from_excel(emp_id, tmp_path)
        try:
            os.remove(tmp_path)
        except Exception:
            pass

        return json_response({"status": "ok", "imported_count": count})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


# -------------------------------------------------------------
# COURSE CALENDARS API (ADMIN GESTIONE & TUTOR VIEW)
# -------------------------------------------------------------

@app.route("/api/course-calendars", method=["GET"])
@require_auth
def get_course_calendars():
    calendars = database.list_course_calendars()
    return json_response({"status": "ok", "calendars": calendars})


@app.route("/api/course-calendars/<cal_id:int>", method=["GET"])
@require_auth
def get_course_calendar_detail(cal_id):
    cal = database.get_course_calendar(cal_id)
    if not cal:
        return json_response({"status": "error", "message": "Calendario non trovato"}, 404)
    return json_response({"status": "ok", "calendar": cal})


@app.route("/api/course-calendars", method=["POST"])
@require_admin
def create_course_calendar():
    try:
        data = request.json or {}
        new_id = database.create_course_calendar(data)
        cal = database.get_course_calendar(new_id)
        return json_response({"status": "ok", "calendar": cal})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/course-calendars/<cal_id:int>", method=["PUT"])
@require_auth
def update_course_calendar(cal_id):
    try:
        data = request.json or {}
        success = database.update_course_calendar(cal_id, data)
        cal = database.get_course_calendar(cal_id)
        return json_response({"status": "ok", "success": success, "calendar": cal})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/course-calendars/<cal_id:int>", method=["DELETE"])
@require_admin
def delete_course_calendar(cal_id):
    try:
        success = database.delete_course_calendar(cal_id)
        return json_response({"status": "ok", "success": success})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/course-calendars/<cal_id:int>/sessions", method=["POST"])
@require_auth
def add_calendar_session(cal_id):
    try:
        user = get_authenticated_user()
        if user.get("role") != "admin":
            cal = database.get_course_calendar(cal_id)
            if not cal:
                return json_response({"status": "error", "message": "Calendario non trovato"}, 404)
            c = database.get_course(cal.get("course_id"))
            if not c or c.get("employee_id") != user["id"]:
                return json_response({"status": "error", "message": "Non puoi aggiungere lezioni a un corso non assegnato a te."}, 403)
        data = request.json or {}
        res = database.add_calendar_session(cal_id, data)
        return json_response({"status": "ok", "session": res})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/course-calendars/sessions/<session_id:int>", method=["PUT"])
@require_auth
def update_calendar_session(session_id):
    try:
        user = get_authenticated_user()
        if not check_session_permission(user, session_id):
            return json_response({"status": "error", "message": "Accesso non autorizzato. Non puoi modificare le lezioni di un altro tutor."}, 403)
        data = request.json or {}
        res = database.update_calendar_session(session_id, data)
        return json_response({"status": "ok", "session": res})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/course-calendars/sessions/<session_id:int>/status", method=["POST"])
@require_auth
def update_session_status(session_id):
    try:
        user = get_authenticated_user()
        if not check_session_permission(user, session_id):
            return json_response({"status": "error", "message": "Accesso non autorizzato. Non puoi modificare lo stato delle lezioni di un altro tutor."}, 403)
        data = request.json or {}
        status = data.get("status", "confermata")
        reschedule_data = data.get("reschedule_data")
        success = database.update_session_status(session_id, status, reschedule_data)
        return json_response({"status": "ok", "success": success})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/course-calendars/sessions/<session_id:int>", method=["DELETE"])
@require_auth
def delete_calendar_session(session_id):
    try:
        user = get_authenticated_user()
        if not check_session_permission(user, session_id):
            return json_response({"status": "error", "message": "Accesso non autorizzato. Non puoi eliminare le lezioni di un altro tutor."}, 403)
        success = database.delete_calendar_session(session_id)
        return json_response({"status": "ok", "success": success})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/course-calendars/check-conflict", method=["GET"])
def check_conflict():
    calendar_id = request.query.get("calendar_id")
    cal_int = int(calendar_id) if (calendar_id and calendar_id.isdigit()) else None
    docente = request.query.get("docente", "")
    tutor_id = request.query.get("tutor_id")
    tutor_int = int(tutor_id) if (tutor_id and tutor_id.isdigit()) else None
    date_str = request.query.get("date", "")
    start_time = request.query.get("start_time", "08:30")
    end_time = request.query.get("end_time", "13:30")
    exclude_id = request.query.get("exclude_id")
    exclude_int = int(exclude_id) if (exclude_id and exclude_id.isdigit()) else None

    conflicts = database.check_session_conflicts(cal_int, docente, tutor_int, date_str, start_time, end_time, exclude_int)
    return json_response({
        "status": "ok",
        "has_conflict": len(conflicts) > 0,
        "conflicts": conflicts
    })


@app.route("/api/course-calendars/conflicts", method=["GET"])
def get_all_conflicts():
    conflicts = database.get_all_schedule_conflicts()
    return json_response({"status": "ok", "conflicts": conflicts})


@app.route("/api/course-calendars/docenti", method=["GET"])
def get_all_docenti():
    docenti = database.list_all_docenti()
    return json_response({"status": "ok", "docenti": docenti})


# -------------------------------------------------------------
# DOCUMENTS & FILE REPOSITORY API
# -------------------------------------------------------------

@app.route("/api/documents", method=["GET"])
@require_auth
def get_documents():
    emp_id = request.query.get("employee_id")
    course_id = request.query.get("course_id")
    category = request.query.get("category")
    search = request.query.get("search")

    emp_int = int(emp_id) if emp_id and emp_id != "all" else None
    course_int = int(course_id) if course_id and course_id != "all" else None

    docs = database.list_documents(emp_int, course_int, category, search)
    return json_response({"status": "ok", "documents": docs})


@app.route("/api/documents/upload", method=["POST"])
@require_auth
def upload_document():
    try:
        user = get_authenticated_user()
        upload = request.files.get("file")
        if not upload:
            return json_response({"status": "error", "message": "Nessun file selezionato"}, 400)

        title = request.forms.get("title", "").strip() or upload.filename
        employee_id = request.forms.get("employee_id")
        course_id = request.forms.get("course_id")
        category = request.forms.get("category", "Generale").strip()
        notes = request.forms.get("notes", "").strip()
        uploaded_by = user.get("name", "Admin") if user else "Admin"

        emp_int = int(employee_id) if employee_id and employee_id != "all" and employee_id != "" else None
        course_int = int(course_id) if course_id and course_id != "all" and course_id != "" else None

        safe_filename = upload.filename
        timestamp = int(datetime.datetime.now().timestamp())
        stored_name = f"{timestamp}_{safe_filename}"
        stored_path = os.path.join(database.DOCS_DIR, stored_name)

        upload.save(stored_path, overwrite=True)
        file_size = os.path.getsize(stored_path)
        _, ext = os.path.splitext(safe_filename)

        doc_data = {
            "employee_id": emp_int,
            "course_id": course_int,
            "title": title,
            "filename": safe_filename,
            "stored_path": stored_path,
            "file_size": file_size,
            "file_type": ext.lower(),
            "uploaded_by": uploaded_by,
            "category": category,
            "notes": notes
        }
        new_id = database.create_document(doc_data)
        doc = database.get_document(new_id)
        return json_response({"status": "ok", "document": doc})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


@app.route("/api/documents/<doc_id:int>/download", method=["GET"])
@require_auth
def download_document(doc_id):
    doc = database.get_document(doc_id)
    if not doc:
        return json_response({"status": "error", "message": "Documento non trovato"}, 404)
    file_path = doc["stored_path"]
    if not os.path.exists(file_path):
        return json_response({"status": "error", "message": "File non trovato su disco"}, 404)
    dirname = os.path.dirname(file_path)
    basename = os.path.basename(file_path)
    return static_file(basename, root=dirname, download=doc["filename"])


@app.route("/api/documents/<doc_id:int>", method=["DELETE"])
@require_auth
def delete_document(doc_id):
    try:
        user = get_authenticated_user()
        doc = database.get_document(doc_id)
        if not doc:
            return json_response({"status": "error", "message": "Documento non trovato"}, 404)

        if user.get("role") != "admin" and doc.get("uploaded_by") != user.get("name"):
            return json_response({"status": "error", "message": "Non sei autorizzato a eliminare questo documento"}, 403)

        success = database.delete_document(doc_id)
        return json_response({"status": "ok", "success": success})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


# -------------------------------------------------------------
# COURSE CALENDAR TEMPLATE & EXCEL/GOOGLE SHEETS IMPORT
# -------------------------------------------------------------

@app.route("/api/course-calendars/template", method=["GET"])
def download_calendar_template():
    template_path = os.path.join(STATIC_DIR, "templates", "modello_calendario_corso.xlsx")
    if not os.path.exists(template_path):
        return json_response({"status": "error", "message": "Modello non trovato"}, 404)
    dirname = os.path.dirname(template_path)
    basename = os.path.basename(template_path)
    return static_file(basename, root=dirname, download="Modello_Calendario_Corso.xlsx")


@app.route("/api/course-calendars/parse-file", method=["POST"])
def parse_calendar_upload():
    upload = request.files.get("file")
    if not upload:
        return json_response({"status": "error", "message": "Nessun file caricato"}, 400)

    try:
        file_bytes = upload.file.read()
        filename = upload.raw_filename or upload.filename
        res = calendar_parser.parse_calendar_file(file_bytes, filename)
        if res.get("status") == "error":
            return json_response(res, 400)

        # Pre-check docente conflicts with existing sessions in DB
        conflicts = []
        for s in res.get("sessions", []):
            if s.get("phase") == "aula" and s.get("docente"):
                confs = database.check_docente_conflicts(s["docente"], s["date"], s["start_time"], s["end_time"])
                if confs:
                    for c in confs:
                        conflicts.append({
                            "docente": s["docente"],
                            "date": s["date"],
                            "proposed_time": f"{s['start_time']} - {s['end_time']}",
                            "conflicting_course": c.get("course_name"),
                            "conflicting_time": f"{c.get('start_time')} - {c.get('end_time')}",
                            "message": c.get("warning_message")
                        })

        return json_response({
            "status": "ok",
            "preview": res,
            "potential_conflicts": conflicts
        })
    except Exception as e:
        return json_response({"status": "error", "message": f"Errore durante l'analisi del file: {str(e)}"}, 400)


@app.route("/api/course-calendars/import", method=["POST"])
@require_auth
def import_course_calendar():
    try:
        user = get_authenticated_user()
        data = request.json or {}
        if not data:
            return json_response({"status": "error", "message": "Dati mancanti"}, 400)

        raw_emp = data.get("employee_id")
        emp_id = int(raw_emp) if (raw_emp is not None and str(raw_emp).strip() != "" and str(raw_emp) != "0") else None
        if user.get("role") != "admin":
            emp_id = user["id"]
        course_name = data.get("course_name", "Nuovo Corso").strip()
        course_code = data.get("course_code", "").strip()
        total_hours = float(data.get("total_allocated_hours", 0.0))
        docente_ref = data.get("docente_referente", "").strip()
        sessions = data.get("sessions", [])

        # 1. Determine target Course (Existing or New)
        target_course_id = data.get("course_id")
        course_id = None
        update_course_data = None
        new_course_data = None

        if target_course_id and str(target_course_id) != "new":
            try:
                c_id_int = int(target_course_id)
                existing_c = database.get_course(c_id_int)
                if existing_c:
                    if user.get("role") != "admin" and existing_c.get("employee_id") and existing_c["employee_id"] != user["id"]:
                        return json_response({"status": "error", "message": "Non sei autorizzato a modificare il calendario di un corso assegnato a un altro tutor."}, 403)
                    course_id = c_id_int
                    update_course_data = {
                        "name": course_name if course_name else existing_c["name"],
                        "code": course_code if course_code else existing_c["code"],
                        "total_allocated_hours": total_hours if total_hours > 0 else existing_c.get("total_allocated_hours", 0.0),
                        "color": data.get("color") or existing_c.get("color", "#2563EB"),
                        "status": "Attivo",
                        "docente_referente": docente_ref or existing_c.get("docente_referente", ""),
                        "notes": (existing_c.get("notes", "") + ("\n" if existing_c.get("notes") else "") + data.get("notes", "")).strip(),
                        "employee_id": emp_id
                    }
            except Exception as ex:
                logger.warning(f"[Import] Warning resolving target_course_id: {ex}")

        if not course_id:
            new_course_data = {
                "employee_id": emp_id,
                "name": course_name,
                "code": course_code,
                "total_allocated_hours": total_hours,
                "color": data.get("color", "#2563EB"),
                "status": "Attivo",
                "docente_referente": docente_ref,
                "notes": data.get("notes", "").strip()
            }

        # 2. Prepare Calendar Metadata
        cal_title = data.get("calendar_title") or f"Calendario {course_name} {course_code}".strip()
        cal_data = {
            "title": cal_title,
            "start_date": data.get("start_date"),
            "expected_end_date": data.get("expected_end_date"),
            "stage_start_date": data.get("stage_start_date"),
            "stage_end_date": data.get("stage_end_date"),
            "stage_tutor_id": int(data.get("stage_tutor_id")) if data.get("stage_tutor_id") else emp_id,
            "status": "In Corso",
            "notes": data.get("notes", "").strip()
        }

        # 3. Atomically validate all sessions and replace calendar
        result = database.atomic_replace_course_calendar(
            course_id=course_id,
            cal_data=cal_data,
            sessions_list=sessions,
            update_course_data=update_course_data,
            new_course_data=new_course_data
        )

        all_confs = database.get_all_schedule_conflicts()

        return json_response({
            "status": "ok",
            "course_id": result["course_id"],
            "calendar_id": result["calendar_id"],
            "sessions_created": result["sessions_created"],
            "conflicts_count": len(all_confs)
        })
    except Exception as e:
        return json_response({"status": "error", "message": f"Errore durante l'importazione: {str(e)}"}, 400)


@app.route("/api/system/discrepancies", method=["GET"])
@require_admin
def get_system_discrepancies():
    try:
        discrepancies = database.get_system_discrepancies()
        return json_response({"status": "ok", "discrepancies": discrepancies})
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 500)


@app.route("/api/system/resolve-discrepancy", method=["POST"])
@require_admin
def resolve_system_discrepancy():
    try:
        data = request.json or {}
        action = data.get("action", "merge_courses")
        primary_id = int(data.get("primary_course_id"))
        secondary_id = int(data.get("secondary_course_id"))
        target_name = data.get("target_name", "").strip()
        if not target_name:
            return json_response({"status": "error", "message": "Nome del corso mancante"}, 400)

        success = database.resolve_course_discrepancy(action, primary_id, secondary_id, target_name)
        return json_response({
            "status": "ok", 
            "success": success, 
            "message": f"Corsi unificati con successo sotto il nome '{target_name}'!"
        })
    except Exception as e:
        return json_response({"status": "error", "message": str(e)}, 400)


def get_local_ip():
    """Tenta di rilevare l'IP locale della macchina per facilitare la condivisione ai colleghi."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        # Non invia traffico reale, serve solo per determinare l'interfaccia attiva
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def save_pid():
    try:
        pid_file = os.path.join(database.DB_DIR, "server.pid")
        with open(pid_file, "w") as f:
            f.write(str(os.getpid()))
    except Exception as e:
        server_logger.warning(f"Impossibile salvare server.pid: {e}")


def remove_pid():
    try:
        pid_file = os.path.join(database.DB_DIR, "server.pid")
        if os.path.exists(pid_file):
            os.remove(pid_file)
    except Exception:
        pass


def start_server(host=None, port=None, quiet=True):
    database.init_db()
    save_pid()
    if host is None:
        local_only = os.environ.get("LOCAL_ONLY", "0") == "1"
        host = os.environ.get("HOST", "127.0.0.1" if local_only else "0.0.0.0")
    if port is None:
        port = int(os.environ.get("PORT", 58235))
    try:
        app.run(host=host, port=port, quiet=quiet)
    finally:
        remove_pid()


if __name__ == "__main__":
    database.init_db()
    save_pid()
    local_only = os.environ.get("LOCAL_ONLY", "0") == "1"
    host = os.environ.get("HOST", "127.0.0.1" if local_only else "0.0.0.0")
    port = int(os.environ.get("PORT", 58235))
    local_ip = get_local_ip()
    print("=" * 60)
    print("🏫 CORSI IN VIA NAZARIO SAURO 38/40 (v2.0) ATTIVO!")
    print(f"👉 Tuo accesso locale:         http://localhost:{port}")
    if host != "127.0.0.1" and local_ip != "127.0.0.1":
        print(f"👉 Accesso colleghi (stessa rete Wi-Fi): http://{local_ip}:{port}")
    elif host == "127.0.0.1":
        print("🔒 Modalità Locale Protetta: accesso riservato solo a questo Mac.")
    print("=" * 60)
    try:
        start_server(host=host, port=port, quiet=False)
    finally:
        remove_pid()
