"""
Database layer for Gestione Ore Dipendenti, Corsi, Tutoraggio e Scostamenti Orari.
SQLite-based local database with support for:
- Role-based profiles: 'admin' (Andrea) and 'tutor' (altri dipendenti/collaboratori)
- First access setup & user profile creation
- Contracted working hours (orario stabilito)
- Courses with defined total hour quotas (monte ore stabilito)
- Lesson schedules, scheduled vs actual hours (uscite anticipate / posticipate)
- Monthly breakdowns per course
- Weekly schedule view with lecture timetables
- Running balance (maturate / debito) and bank hours
"""

import sqlite3
import os
import re
import datetime
import time
import json
import hashlib
import secrets
from contextlib import contextmanager
from typing import List, Dict, Any, Optional, Tuple

DB_DIR = os.getenv("GESTIONE_ORE_DATA_DIR", os.path.expanduser("~/.gestione_ore_v2"))
DB_PATH = os.path.join(DB_DIR, "banca_ore.db")
DOCS_DIR = os.path.join(DB_DIR, "documents")
os.makedirs(DOCS_DIR, exist_ok=True)


def get_db_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 20000;")
    return conn


@contextmanager
def get_db():
    conn = get_db_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def normalize_time(t_str: str) -> str:
    """Normalizza gli orari nel formato HH:MM a due cifre."""
    if not t_str:
        return "00:00"
    t_str = str(t_str).strip()
    if ":" in t_str:
        parts = t_str.split(":")
        try:
            return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
        except (ValueError, IndexError):
            return t_str
    elif t_str.isdigit():
        return f"{int(t_str):02d}:00"
    return t_str


def hash_password(password: str) -> tuple:
    """Returns (password_hash, salt) using PBKDF2-HMAC-SHA256."""
    salt = secrets.token_hex(16)
    pw_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000).hex()
    return pw_hash, salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    """Verifies a password against the stored hash and salt."""
    if not password or not password_hash or not salt:
        return False
    pw_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000).hex()
    return secrets.compare_digest(pw_hash, password_hash)


def init_db(import_initial_data: bool = True):
    """Initializes tables and upgrades schema if new columns are missing."""
    conn = get_db_connection()
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
    except Exception:
        pass
    cur = conn.cursor()

    # 1. Employees / Users Table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        email TEXT DEFAULT '',
        role TEXT NOT NULL DEFAULT 'tutor', -- 'admin' (Andrea) o 'tutor'
        pin TEXT DEFAULT '1234', -- Codice di accesso rapido opzionale
        initial_bank_hours REAL DEFAULT 124.0,
        standard_day_hours REAL DEFAULT 7.0,
        short_day_hours REAL DEFAULT 4.0,
        part_time_week_hours REAL DEFAULT 18.0,
        default_shift_start TEXT DEFAULT '09:00',
        default_shift_end TEXT DEFAULT '13:00',
        notes TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # 2. Courses Table (Corsi con monte ore stabilito di cui si è tutor o gestiti dall'ente)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER DEFAULT NULL,
        code TEXT DEFAULT '',
        name TEXT NOT NULL,
        total_allocated_hours REAL NOT NULL DEFAULT 100.0, -- Monte ore stabilito
        color TEXT DEFAULT '#2563EB',
        status TEXT DEFAULT 'Attivo', -- 'Attivo', 'Concluso', 'Pianificato'
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        docente_referente TEXT DEFAULT '',
        FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE SET NULL
    )
    """)

    # 3. Work Entries Table (Giornate di lavoro, lezioni, uscite anticipate/posticipate)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS work_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        course_id INTEGER,
        date TEXT NOT NULL,
        day_of_week TEXT NOT NULL,
        month_year TEXT NOT NULL,
        scheduled_start TEXT DEFAULT '09:00',
        scheduled_end TEXT DEFAULT '13:00',
        actual_start TEXT DEFAULT '09:00',
        actual_end TEXT DEFAULT '13:00',
        scheduled_hours REAL DEFAULT 0.0,
        actual_hours REAL DEFAULT 0.0,
        hours REAL NOT NULL, -- Ore maturate (+) o debito (-)
        type TEXT NOT NULL, -- 'maturata' (straordinario / uscita posticipata), 'utilizzata' (debito / uscita anticipata), 'ordinaria'
        activity_type TEXT DEFAULT 'Tutoraggio d''aula', -- 'Tutoraggio d''aula', 'Stage', 'Lavoro Ordinario', 'Docenza', 'Permesso'
        causale TEXT DEFAULT '',
        note TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE SET NULL
    )
    """)

    # 4. Course Calendars Table (Calendari ufficiali gestiti dall'Admin)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS course_calendars (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        start_date TEXT NOT NULL,
        expected_end_date TEXT NOT NULL,
        stage_start_date TEXT,
        stage_end_date TEXT,
        stage_tutor_id INTEGER,
        status TEXT DEFAULT 'In Corso', -- 'In Programmazione', 'In Corso', 'Concluso'
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
        FOREIGN KEY (stage_tutor_id) REFERENCES employees (id) ON DELETE SET NULL
    )
    """)

    # 5. Course Calendar Sessions (Lezioni d'aula con docenti/moduli & Giornate di stage con tutor)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS course_calendar_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        calendar_id INTEGER NOT NULL,
        phase TEXT NOT NULL DEFAULT 'aula', -- 'aula' (con docente e modulo) oppure 'stage' (con tutor)
        date TEXT NOT NULL,
        day_of_week TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        hours REAL NOT NULL,
        docente TEXT DEFAULT '', -- SOLO AULA
        modulo TEXT DEFAULT '',  -- SOLO AULA
        tutor_id INTEGER,        -- PER STAGE (o tutor d'aula)
        status TEXT DEFAULT 'confermata', -- 'confermata', 'svolta', 'rinviata', 'annullata'
        rescheduled_to_date TEXT,
        rescheduled_to_start TEXT,
        rescheduled_to_end TEXT,
        reschedule_reason TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (calendar_id) REFERENCES course_calendars (id) ON DELETE CASCADE,
        FOREIGN KEY (tutor_id) REFERENCES employees (id) ON DELETE SET NULL
    )
    """)

    # 6. Documents Table (Archivio e repository file per dipendenti e corsi)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER,
        course_id INTEGER,
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_type TEXT DEFAULT '',
        uploaded_by TEXT DEFAULT 'Admin',
        category TEXT DEFAULT 'Generale',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE SET NULL
    )
    """)

    # 7. Persistent User Sessions Table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS user_sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at REAL NOT NULL,
        expires_at REAL NOT NULL,
        last_seen REAL NOT NULL,
        FOREIGN KEY (user_id) REFERENCES employees (id) ON DELETE CASCADE
    )
    """)

    # 8. Employee / Tutor Contracts Table (Contratti multipli: P.IVA, Ritenuta d'acconto, Determinato, Indeterminato, Stage, Collaborazione, CO.CO.CO)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS employee_contracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        contract_type TEXT NOT NULL,
        contract_regime TEXT DEFAULT '',
        start_date TEXT,
        end_date TEXT,
        status TEXT DEFAULT 'Attivo',
        work_days TEXT DEFAULT 'lun,mar,mer,gio,ven',
        work_start_time TEXT DEFAULT '09:00',
        work_end_time TEXT DEFAULT '13:00',
        lunch_break_start TEXT DEFAULT '',
        lunch_break_end TEXT DEFAULT '',
        daily_hours REAL DEFAULT 4.0,
        weekly_hours REAL DEFAULT 20.0,
        renewal_notes TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
    )
    """)

    _ensure_columns(conn)
    conn.commit()
    conn.close()
    try:
        compute_and_update_module_tests()
    except Exception:
        pass
    try:
        purge_expired_trash()
    except Exception:
        pass


def _ensure_columns(conn: sqlite3.Connection):
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(employees)")
    emp_cols = [row[1] for row in cur.fetchall()]
    if "email" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN email TEXT DEFAULT ''")
    if "pin" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN pin TEXT DEFAULT '1234'")
    if "password_hash" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN password_hash TEXT DEFAULT ''")
    if "salt" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN salt TEXT DEFAULT ''")
    if "default_shift_start" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN default_shift_start TEXT DEFAULT '09:00'")
    if "default_shift_end" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN default_shift_end TEXT DEFAULT '13:00'")
    if "is_tutor" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN is_tutor INTEGER DEFAULT 1")
    if "deleted_at" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN deleted_at TEXT DEFAULT NULL")
    if "contract_office_days" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN contract_office_days TEXT DEFAULT 'lun,mar,mer,gio,ven'")
    if "contract_office_start" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN contract_office_start TEXT DEFAULT '09:00'")
    if "contract_office_end" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN contract_office_end TEXT DEFAULT '13:00'")
    if "contract_lunch_start" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN contract_lunch_start TEXT DEFAULT ''")
    if "contract_lunch_end" not in emp_cols:
        cur.execute("ALTER TABLE employees ADD COLUMN contract_lunch_end TEXT DEFAULT ''")

    cur.execute("PRAGMA table_info(work_entries)")
    cols = [row[1] for row in cur.fetchall()]
    new_cols = [
        ("course_id", "INTEGER"),
        ("scheduled_start", "TEXT DEFAULT '09:00'"),
        ("scheduled_end", "TEXT DEFAULT '13:00'"),
        ("actual_start", "TEXT DEFAULT '09:00'"),
        ("actual_end", "TEXT DEFAULT '13:00'"),
        ("scheduled_hours", "REAL DEFAULT 0.0"),
        ("actual_hours", "REAL DEFAULT 0.0"),
        ("activity_type", "TEXT DEFAULT 'Tutoraggio d''aula'"),
        ("calendar_session_id", "INTEGER DEFAULT NULL"),
        ("lunch_break_start", "TEXT DEFAULT ''"),
        ("lunch_break_end", "TEXT DEFAULT ''"),
        ("exit_date", "TEXT DEFAULT ''"),
        ("office_start", "TEXT DEFAULT ''"),
        ("office_end", "TEXT DEFAULT ''"),
        ("course_start", "TEXT DEFAULT ''"),
        ("course_end", "TEXT DEFAULT ''"),
        ("is_integrated", "INTEGER DEFAULT 0")
    ]
    for col_name, col_def in new_cols:
        if col_name not in cols:
            try:
                cur.execute(f"ALTER TABLE work_entries ADD COLUMN {col_name} {col_def}")
            except Exception:
                pass
    cur.execute("PRAGMA table_info(courses)")
    course_cols = [row[1] for row in cur.fetchall()]
    if "docente_referente" not in course_cols:
        cur.execute("ALTER TABLE courses ADD COLUMN docente_referente TEXT DEFAULT ''")
    if "integrates_with_contract" not in course_cols:
        cur.execute("ALTER TABLE courses ADD COLUMN integrates_with_contract INTEGER DEFAULT 0")

    cur.execute("PRAGMA table_info(course_calendar_sessions)")
    sess_cols = [row[1] for row in cur.fetchall()]
    if "is_module_test" not in sess_cols:
        cur.execute("ALTER TABLE course_calendar_sessions ADD COLUMN is_module_test INTEGER DEFAULT 0")
    if "test_notes" not in sess_cols:
        cur.execute("ALTER TABLE course_calendar_sessions ADD COLUMN test_notes TEXT DEFAULT ''")

    cur.execute("PRAGMA table_info(employee_contracts)")
    contract_cols = [row[1] for row in cur.fetchall()]
    if "schedule_details" not in contract_cols:
        cur.execute("ALTER TABLE employee_contracts ADD COLUMN schedule_details TEXT DEFAULT ''")
    if "has_fixed_schedule" not in contract_cols:
        cur.execute("ALTER TABLE employee_contracts ADD COLUMN has_fixed_schedule INTEGER DEFAULT 1")

    conn.commit()


# -------------------------------------------------------------
# STRICT DATA VALIDATORS (DATES, TIMES, INTERVALS, HOURS)
# -------------------------------------------------------------

def validate_iso_date(date_str: Any, field_name: str = "Data") -> str:
    if not date_str or not isinstance(date_str, str):
        raise ValueError(f"{field_name} mancante o non valida.")
    s = str(date_str).strip()
    try:
        dt = datetime.date.fromisoformat(s[:10])
        return dt.isoformat()
    except Exception:
        raise ValueError(f"{field_name} '{date_str}' non valida. Specificare una data nel formato AAAA-MM-GG (es. 2026-10-28).")


def validate_time_str(time_str: Any, field_name: str = "Orario") -> str:
    if not time_str or not isinstance(time_str, str):
        raise ValueError(f"{field_name} mancante o non valido.")
    s = str(time_str).strip()
    parts = s.split(":")
    if len(parts) < 2:
        raise ValueError(f"{field_name} '{time_str}' non valido. Specificare l'orario nel formato OO:MM (es. 09:00).")
    try:
        h = int(parts[0])
        m = int(parts[1])
        if h < 0 or h > 23 or m < 0 or m > 59:
            raise ValueError()
        return f"{h:02d}:{m:02d}"
    except Exception:
        raise ValueError(f"{field_name} '{time_str}' non valido. I valori devono essere compresi tra 00:00 e 23:59.")


def validate_time_interval(start_time: str, end_time: str) -> float:
    t_start = validate_time_str(start_time, "Orario di inizio")
    t_end = validate_time_str(end_time, "Orario di fine")
    h1, m1 = map(int, t_start.split(":"))
    h2, m2 = map(int, t_end.split(":"))
    mins = (h2 * 60 + m2) - (h1 * 60 + m1)
    if mins <= 0:
        raise ValueError(f"Intervallo orario non valido: l'orario di fine ({t_end}) deve essere successivo all'orario di inizio ({t_start}).")
    return round(mins / 60.0, 2)


def validate_session_hours(raw_hours: Any, start_time: str, end_time: str) -> float:
    interval_hours = validate_time_interval(start_time, end_time)
    try:
        h_val = float(raw_hours)
    except (TypeError, ValueError):
        raise ValueError(f"Valore ore non valido: '{raw_hours}'. Deve essere un numero.")
    
    if h_val <= 0:
        raise ValueError("La durata delle ore deve essere un numero positivo maggiore di 0.")
    if h_val > 24.0:
        raise ValueError(f"La durata delle ore ({h_val}h) supera il limite massimo consentito di 24 ore.")
    if h_val > interval_hours + 1.0:
        raise ValueError(f"Ore incongruenti: {h_val}h dichiarate a fronte di un intervallo {start_time}-{end_time} pari a {interval_hours}h.")
    return round(h_val, 2)


def compute_and_update_module_tests(calendar_id: Optional[int] = None, cur = None):
    """
    Identifica e contrassegna automaticamente l'ultima lezione di ogni modulo didattico
    come giornata di 'Test di verifica finale del modulo', escludendo rigorosamente
    le sessioni annullate e ordinando per data/orario effettivi.
    """
    own_conn = False
    conn = None
    if cur is None:
        conn = get_db_connection()
        cur = conn.cursor()
        own_conn = True

    try:
        cal_filter = "AND s.calendar_id = ?" if calendar_id else ""
        params = [calendar_id] if calendar_id else []

        # Trova tutte le sessioni d'aula attive (non annullate) con modulo specificato
        query = f"""
        SELECT s.id, s.calendar_id, s.modulo,
               COALESCE(NULLIF(s.rescheduled_to_date, ''), s.date) as effective_date,
               COALESCE(NULLIF(s.rescheduled_to_start, ''), s.start_time) as effective_start
        FROM course_calendar_sessions s
        WHERE s.phase = 'aula' 
          AND TRIM(COALESCE(s.modulo, '')) != ''
          AND s.status != 'annullata'
          {cal_filter}
        ORDER BY s.calendar_id ASC, TRIM(s.modulo) ASC, effective_date ASC, effective_start ASC, s.id ASC
        """
        cur.execute(query, params)
        rows = cur.fetchall()

        # Determina l'ID dell'ultima sessione attiva per ciascun modulo didattico
        last_session_per_module = {}
        for r in rows:
            key = (r["calendar_id"], r["modulo"].strip().upper())
            last_session_per_module[key] = r["id"]

        test_ids = set(last_session_per_module.values())

        # Reset per tutte le sessioni considerate
        if calendar_id:
            cur.execute("UPDATE course_calendar_sessions SET is_module_test = 0 WHERE calendar_id = ?", (calendar_id,))
        else:
            cur.execute("UPDATE course_calendar_sessions SET is_module_test = 0")

        # Assegna is_module_test = 1 per le ultime lezioni valide
        if test_ids:
            t_list = list(test_ids)
            cur.execute(f"UPDATE course_calendar_sessions SET is_module_test = 1 WHERE id IN ({','.join(['?']*len(t_list))})", t_list)

        if own_conn and conn:
            conn.commit()
    except Exception as e:
        print(f"[compute_and_update_module_tests] Errore: {e}")
    finally:
        if own_conn and conn:
            conn.close()
        conn.close()


def _seed_andrea_entries(conn: sqlite3.Connection, andrea_id: int, course1_id: int, course2_id: int):
    raw_records = [
        # Febbraio 2026
        ("2026-02-10", "Martedì", "FEBBRAIO 2026", 7.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "16:00", "09:00", "09:00", 7.0, 0.0, "Permesso"),
        ("2026-02-13", "Venerdì", "FEBBRAIO 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        ("2026-02-20", "Venerdì", "FEBBRAIO 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "Venerdì 20", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        ("2026-02-23", "Lunedì", "FEBBRAIO 2026", 7.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "16:00", "09:00", "09:00", 7.0, 0.0, "Permesso"),
        ("2026-02-24", "Martedì", "FEBBRAIO 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        ("2026-02-27", "Venerdì", "FEBBRAIO 2026", 4.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "08:30", "16:30", 4.0, 8.0, "Tutoraggio d'aula"),
        # Marzo 2026
        ("2026-03-03", "Martedì", "MARZO 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        ("2026-03-04", "Mercoledì", "MARZO 2026", 5.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "08:00", "17:00", 4.0, 9.0, "Tutoraggio d'aula"),
        ("2026-03-05", "Giovedì", "MARZO 2026", 5.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "08:00", "17:00", 4.0, 9.0, "Tutoraggio d'aula"),
        ("2026-03-09", "Lunedì", "MARZO 2026", 2.0, "maturata", "Straordinario svolto (Verde)", "", course2_id, "09:00", "13:00", "09:00", "15:00", 4.0, 6.0, "Stage"),
        ("2026-03-10", "Martedì", "MARZO 2026", 2.0, "maturata", "Straordinario svolto (Verde)", "", course2_id, "09:00", "13:00", "09:00", "15:00", 4.0, 6.0, "Stage"),
        ("2026-03-16", "Lunedì", "MARZO 2026", 3.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "10:00", 4.0, 1.0, "Permesso"),
        ("2026-03-20", "Venerdì", "MARZO 2026", 4.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "08:30", "16:30", 4.0, 8.0, "Tutoraggio d'aula"),
        ("2026-03-30", "Lunedì", "MARZO 2026", 2.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "11:00", 4.0, 2.0, "Permesso"),
        # Aprile 2026
        ("2026-04-08", "Mercoledì", "APRILE 2026", 1.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "14:00", 4.0, 5.0, "Tutoraggio d'aula"),
        ("2026-04-09", "Giovedì", "APRILE 2026", 1.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "14:00", 4.0, 5.0, "Tutoraggio d'aula"),
        ("2026-04-10", "Venerdì", "APRILE 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        ("2026-04-13", "Lunedì", "APRILE 2026", 2.0, "maturata", "Straordinario svolto (Verde)", "", course2_id, "09:00", "13:00", "09:00", "15:00", 4.0, 6.0, "Stage"),
        ("2026-04-15", "Mercoledì", "APRILE 2026", 2.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "15:00", 4.0, 6.0, "Tutoraggio d'aula"),
        ("2026-04-16", "Giovedì", "APRILE 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        ("2026-04-21", "Martedì", "APRILE 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        ("2026-04-23", "Giovedì", "APRILE 2026", 7.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "16:00", "09:00", "09:00", 7.0, 0.0, "Permesso"),
        ("2026-04-28", "Martedì", "APRILE 2026", 2.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "15:00", 4.0, 6.0, "Tutoraggio d'aula"),
        ("2026-04-29", "Mercoledì", "APRILE 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        ("2026-04-30", "Giovedì", "APRILE 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        # Maggio 2026
        ("2026-05-07", "Giovedì", "MAGGIO 2026", 2.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "11:00", 4.0, 2.0, "Permesso"),
        ("2026-05-08", "Venerdì", "MAGGIO 2026", 2.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "11:00", 4.0, 2.0, "Permesso"),
        ("2026-05-15", "Venerdì", "MAGGIO 2026", 7.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "08:00", "19:00", 4.0, 11.0, "Tutoraggio d'aula"),
        ("2026-05-22", "Venerdì", "MAGGIO 2026", 2.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "15:00", 4.0, 6.0, "Tutoraggio d'aula"),
        ("2026-05-29", "Venerdì", "MAGGIO 2026", 2.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "15:00", 4.0, 6.0, "Tutoraggio d'aula"),
        # Giugno 2026
        ("2026-06-05", "Venerdì", "GIUGNO 2026", 2.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "15:00", 4.0, 6.0, "Tutoraggio d'aula"),
        ("2026-06-10", "Mercoledì", "GIUGNO 2026", 4.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "09:00", 4.0, 0.0, "Permesso"),
        ("2026-06-11", "Giovedì", "GIUGNO 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        ("2026-06-26", "Venerdì", "GIUGNO 2026", 2.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "11:00", 4.0, 2.0, "Permesso"),
        # Luglio 2026
        ("2026-07-03", "Venerdì", "LUGLIO 2026", 4.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "08:30", "16:30", 4.0, 8.0, "Tutoraggio d'aula"),
        ("2026-07-06", "Lunedì", "LUGLIO 2026", 1.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "12:00", 4.0, 3.0, "Permesso"),
        ("2026-07-08", "Mercoledì", "LUGLIO 2026", 1.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "14:00", 4.0, 5.0, "Tutoraggio d'aula"),
        ("2026-07-13", "Lunedì", "LUGLIO 2026", 1.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "12:00", 4.0, 3.0, "Permesso"),
        ("2026-07-17", "Venerdì", "LUGLIO 2026", 1.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "12:00", 4.0, 3.0, "Permesso"),
        ("2026-07-20", "Lunedì", "LUGLIO 2026", 4.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "09:00", 4.0, 0.0, "Permesso"),
        ("2026-07-25", "Sabato", "LUGLIO 2026", 2.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "15:00", 4.0, 6.0, "Tutoraggio d'aula"),
        # Agosto 2026
        ("2026-08-03", "Lunedì", "AGOSTO 2026", 4.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "09:00", 4.0, 0.0, "Permesso"),
        ("2026-08-04", "Martedì", "AGOSTO 2026", 4.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "09:00", 4.0, 0.0, "Permesso"),
        ("2026-08-05", "Mercoledì", "AGOSTO 2026", 4.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "09:00", 4.0, 0.0, "Permesso"),
        ("2026-08-06", "Giovedì", "AGOSTO 2026", 4.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "09:00", 4.0, 0.0, "Permesso"),
        ("2026-08-07", "Venerdì", "AGOSTO 2026", 2.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "11:00", 4.0, 2.0, "Permesso"),
        # Settembre 2026
        ("2026-09-02", "Mercoledì", "SETTEMBRE 2026", 3.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "16:00", 4.0, 7.0, "Tutoraggio d'aula"),
        ("2026-09-04", "Venerdì", "SETTEMBRE 2026", 2.0, "maturata", "Straordinario svolto (Verde)", "", course1_id, "09:00", "13:00", "09:00", "15:00", 4.0, 6.0, "Tutoraggio d'aula"),
        ("2026-09-08", "Martedì", "SETTEMBRE 2026", 4.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "09:00", 4.0, 0.0, "Permesso"),
        ("2026-09-18", "Venerdì", "SETTEMBRE 2026", 2.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "11:00", 4.0, 2.0, "Permesso"),
        # Ottobre 2026
        ("2026-10-05", "Lunedì", "OTTOBRE 2026", 2.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "11:00", 4.0, 2.0, "Permesso"),
        ("2026-10-26", "Lunedì", "OTTOBRE 2026", 4.0, "utilizzata", "Permesso fruito (Giallo)", "", None, "09:00", "13:00", "09:00", "09:00", 4.0, 0.0, "Permesso"),
        ("2026-10-27", "Martedì", "OTTOBRE 2026", 1.0, "maturata", "Uscita posticipata tutoraggio", "Lezione conclusa alle 14:00", course1_id, "09:00", "13:00", "09:00", "14:00", 4.0, 5.0, "Tutoraggio d'aula"),
        ("2026-10-28", "Mercoledì", "OTTOBRE 2026", 0.0, "ordinaria", "Lezione d'aula ordinaria", "Lezione su Web Design", course1_id, "09:00", "13:00", "09:00", "13:00", 4.0, 4.0, "Tutoraggio d'aula"),
        ("2026-10-29", "Giovedì", "OTTOBRE 2026", 1.5, "maturata", "Supporto allievi straordinario", "", course1_id, "09:00", "13:00", "08:30", "14:00", 4.0, 5.5, "Tutoraggio d'aula"),
        ("2026-10-30", "Venerdì", "OTTOBRE 2026", 0.5, "utilizzata", "Uscita anticipata", "", course1_id, "09:00", "13:00", "09:00", "12:30", 4.0, 3.5, "Permesso")
    ]

    cur = conn.cursor()
    for dt, dow, my, hrs, t, cau, nt, cid, s_start, s_end, a_start, a_end, s_hrs, a_hrs, act_tp in raw_records:
        cur.execute("""
        INSERT INTO work_entries (
            employee_id, course_id, date, day_of_week, month_year,
            scheduled_start, scheduled_end, actual_start, actual_end,
            scheduled_hours, actual_hours, hours, type, activity_type, causale, note
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            andrea_id, cid, dt, dow, my,
            s_start, s_end, a_start, a_end,
            s_hrs, a_hrs, hrs, t, act_tp, cau, nt
        ))
    conn.commit()


# -------------------------------------------------------------
# EMPLOYEE CRUD & ROLE ENFORCEMENT
# -------------------------------------------------------------

def _clean_safe_employee(emp: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not emp:
        return None
    d = dict(emp)
    d.pop("password_hash", None)
    d.pop("salt", None)
    d.pop("pin", None)
    if "is_tutor" not in d or d["is_tutor"] is None:
        d["is_tutor"] = 1 if d.get("role") in ("tutor", "admin_tutor") else 0
    return d


def list_employees() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    SELECT * 
    FROM employees 
    WHERE is_active = 1 AND deleted_at IS NULL
    ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, name ASC
    """)
    rows = [_clean_safe_employee(dict(r)) for r in cur.fetchall()]
    conn.close()
    return rows


def get_employee(employee_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL", (employee_id,))
    row = cur.fetchone()
    conn.close()
    return _clean_safe_employee(dict(row)) if row else None


def get_employee_by_name(name: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM employees WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NULL", (name,))
    row = cur.fetchone()
    conn.close()
    return _clean_safe_employee(dict(row)) if row else None


def get_employee_by_identifier(identifier: str) -> Optional[Dict[str, Any]]:
    """Finds employee with internal authentication fields (including password_hash)."""
    if not identifier:
        return None
    ident = identifier.strip().lower()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    SELECT * FROM employees 
    WHERE (LOWER(TRIM(name)) = ? OR LOWER(TRIM(email)) = ?) 
      AND is_active = 1
      AND deleted_at IS NULL
    LIMIT 1
    """, (ident, ident))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def authenticate_employee(identifier: str, password: str) -> Optional[Dict[str, Any]]:
    """Verifies credentials and returns clean employee dictionary if valid."""
    emp = get_employee_by_identifier(identifier)
    if not emp:
        return None
    
    pw_hash = emp.get("password_hash") or ""
    salt = emp.get("salt") or ""
    
    if pw_hash and salt:
        if not verify_password(password, pw_hash, salt):
            return None
    elif emp.get("pin"):
        if password.strip() != emp.get("pin").strip():
            return None
    else:
        return None

    return _clean_safe_employee(emp)


def create_employee(data: Dict[str, Any]) -> int:
    conn = get_db_connection()
    cur = conn.cursor()

    name = data.get("name", "").strip()
    if not name:
        raise ValueError("Il campo Nome e Cognome è obbligatorio.")
    
    email = data.get("email", "").strip()
    if not email:
        raise ValueError("L'indirizzo email è obbligatorio.")
    
    password = data.get("password", "").strip()
    if not password:
        raise ValueError("La password è obbligatoria per creare l'account.")
    if len(password) < 6:
        raise ValueError("La password deve contenere almeno 6 caratteri.")
    
    pw_hash, salt = hash_password(password)

    # Check duplicates only among active accounts
    cur.execute("SELECT id FROM employees WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NULL", (name,))
    if cur.fetchone():
        raise ValueError(f"Un profilo con il nome '{name}' esiste già. Scegli un nome diverso o accedi con le tue credenziali.")
    cur.execute("SELECT id FROM employees WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND deleted_at IS NULL", (email,))
    if cur.fetchone():
        raise ValueError(f"Un profilo con l'indirizzo email '{email}' esiste già. Accedi con le tue credenziali.")

    requested_role = data.get("role", "tutor").strip().lower()
    role = "admin" if requested_role in ("admin", "admin_tutor") else "tutor"
    
    # Double role support: if admin, check if is_tutor is requested
    if role == "admin":
        is_tutor = 1 if data.get("is_tutor") in (True, 1, "1", "true", "True") else 0
    else:
        is_tutor = 1

    cur.execute("""
    INSERT INTO employees (name, email, role, is_tutor, password_hash, salt, initial_bank_hours, standard_day_hours, short_day_hours, part_time_week_hours, default_shift_start, default_shift_end, notes, is_active, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
    """, (
        name,
        email,
        role,
        is_tutor,
        pw_hash,
        salt,
        float(data.get("initial_bank_hours", 0.0)),
        float(data.get("standard_day_hours", 7.0)),
        float(data.get("short_day_hours", 4.0)),
        float(data.get("part_time_week_hours", 18.0)),
        data.get("default_shift_start", "09:00"),
        data.get("default_shift_end", "13:00"),
        data.get("notes", "")
    ))
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return new_id


def update_employee(employee_id: int, data: Dict[str, Any]) -> bool:
    conn = get_db_connection()
    cur = conn.cursor()

    emp = get_employee(employee_id)
    if not emp:
        conn.close()
        raise ValueError("Profilo non trovato.")

    role = data.get("role", emp["role"])
    is_tutor = data.get("is_tutor", emp.get("is_tutor", 1))
    if role == "tutor":
        is_tutor = 1

    cur.execute("""
    UPDATE employees
    SET name = ?, email = ?, role = ?, is_tutor = ?, initial_bank_hours = ?, standard_day_hours = ?, short_day_hours = ?, part_time_week_hours = ?, default_shift_start = ?, default_shift_end = ?, notes = ?,
        contract_office_days = ?, contract_office_start = ?, contract_office_end = ?, contract_lunch_start = ?, contract_lunch_end = ?
    WHERE id = ?
    """, (
        data.get("name", emp["name"]),
        data.get("email", emp.get("email", "")),
        role,
        int(is_tutor),
        float(data.get("initial_bank_hours", emp.get("initial_bank_hours", 0.0))),
        float(data.get("standard_day_hours", emp.get("standard_day_hours", 7.0))),
        float(data.get("short_day_hours", emp.get("short_day_hours", 4.0))),
        float(data.get("part_time_week_hours", emp.get("part_time_week_hours", 18.0))),
        data.get("default_shift_start", emp.get("default_shift_start", "09:00")),
        data.get("default_shift_end", emp.get("default_shift_end", "13:00")),
        data.get("notes", emp.get("notes", "")),
        data.get("contract_office_days", emp.get("contract_office_days", "lun,mar,mer,gio,ven")),
        data.get("contract_office_start", emp.get("contract_office_start", "09:00")),
        data.get("contract_office_end", emp.get("contract_office_end", "13:00")),
        data.get("contract_lunch_start", emp.get("contract_lunch_start", "")),
        data.get("contract_lunch_end", emp.get("contract_lunch_end", "")),
        employee_id
    ))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected


def delete_employee(employee_id: int) -> bool:
    """Soft deletes an employee and places them in the Trash with a 3-day backup window."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, role, name FROM employees WHERE id = ? AND deleted_at IS NULL", (employee_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise ValueError("Profilo non trovato o già nel cestino.")

    # Guard: prevent deleting the last active admin
    cur.execute("SELECT COUNT(*) AS count FROM employees WHERE role = 'admin' AND is_active = 1 AND deleted_at IS NULL")
    admin_count = cur.fetchone()["count"]
    if row["role"] == "admin" and admin_count <= 1:
        conn.close()
        raise ValueError("Impossibile eliminare l'unico profilo Amministratore rimasto attivo.")

    cur.execute("""
    UPDATE employees 
    SET is_active = 0, deleted_at = datetime('now', 'localtime')
    WHERE id = ?
    """, (employee_id,))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected


def restore_employee(employee_id: int) -> bool:
    """Restores a soft-deleted employee if within the 3-day (72 hours) recovery window."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, name, deleted_at FROM employees WHERE id = ? AND deleted_at IS NOT NULL", (employee_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise ValueError("Profilo non trovato nel cestino.")

    deleted_str = row["deleted_at"]
    cur.execute("SELECT (julianday('now', 'localtime') - julianday(?)) * 24.0 AS hours_passed", (deleted_str,))
    calc = cur.fetchone()
    hours_passed = calc["hours_passed"] if calc and calc["hours_passed"] is not None else 999.0

    if hours_passed > 72.0:
        conn.close()
        raise ValueError("Il periodo massimo di ripristino di 3 giorni (72 ore) è scaduto. Il profilo non può più essere recuperato.")

    cur.execute("""
    UPDATE employees 
    SET is_active = 1, deleted_at = NULL 
    WHERE id = ?
    """, (employee_id,))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected


def list_deleted_employees() -> List[Dict[str, Any]]:
    """Returns soft-deleted employees with remaining time in the 3-day backup window."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    SELECT id, name, email, role, is_tutor, created_at, deleted_at,
           (julianday('now', 'localtime') - julianday(deleted_at)) * 24.0 AS hours_passed
    FROM employees
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
    """)
    rows = cur.fetchall()
    conn.close()

    result = []
    for r in rows:
        d = dict(r)
        hp = d.get("hours_passed") or 0.0
        can_restore = hp <= 72.0
        hours_left = max(0.0, 72.0 - hp)
        days_left = int(hours_left // 24)
        rem_hours = int(hours_left % 24)

        if can_restore:
            if days_left > 0:
                time_str = f"{days_left}g {rem_hours}h rimaste"
            else:
                time_str = f"{rem_hours}h rimaste"
        else:
            time_str = "Scaduto (> 3 giorni)"

        d["hours_passed"] = round(hp, 1)
        d["hours_left"] = round(hours_left, 1)
        d["can_restore"] = can_restore
        d["time_remaining_str"] = time_str
        result.append(d)

    return result


def permanent_delete_employee(employee_id: int) -> bool:
    """Permanently deletes an employee who has been in the trash for > 3 days or upon admin confirmation."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM work_entries WHERE employee_id = ?", (employee_id,))
        cur.execute("DELETE FROM courses WHERE employee_id = ?", (employee_id,))
        cur.execute("DELETE FROM employees WHERE id = ?", (employee_id,))
        return cur.rowcount > 0


def purge_expired_trash() -> int:
    """Permanently removes soft-deleted profiles that have exceeded the 72-hour recovery window."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
        SELECT id FROM employees
        WHERE deleted_at IS NOT NULL
          AND (julianday('now', 'localtime') - julianday(deleted_at)) * 24.0 > 72.0
        """)
        expired_ids = [r[0] for r in cur.fetchall()]
        count = 0
        for emp_id in expired_ids:
            cur.execute("DELETE FROM work_entries WHERE employee_id = ?", (emp_id,))
            cur.execute("DELETE FROM courses WHERE employee_id = ?", (emp_id,))
            cur.execute("DELETE FROM employees WHERE id = ?", (emp_id,))
            count += 1
        return count


def get_docenti_tutor_hours_summary() -> Dict[str, Any]:
    """
    Returns aggregated hours for every tutor and every docente.
    Allows Admin-only accounts to oversee all worked hours without needing personal tutor timecards.
    """
    conn = get_db_connection()
    cur = conn.cursor()

    # 1. Tutors summary
    cur.execute("""
    SELECT e.id, e.name, e.email, e.role, e.is_tutor, e.initial_bank_hours,
           COALESCE(SUM(CASE WHEN w.type = 'maturata' THEN w.hours ELSE 0 END), 0) AS total_maturate,
           COALESCE(SUM(CASE WHEN w.type = 'utilizzata' THEN w.hours ELSE 0 END), 0) AS total_utilizzate,
           COALESCE(SUM(CASE WHEN w.actual_hours > 0 THEN w.actual_hours ELSE w.hours END), 0) AS total_actual_hours,
           COUNT(DISTINCT c.id) AS assigned_courses_count,
           COALESCE(GROUP_CONCAT(DISTINCT c.name), '') AS assigned_courses_names
    FROM employees e
    LEFT JOIN work_entries w ON w.employee_id = e.id
    LEFT JOIN courses c ON c.employee_id = e.id
    WHERE e.is_active = 1 AND e.deleted_at IS NULL AND (e.is_tutor = 1 OR e.role = 'tutor')
    GROUP BY e.id
    ORDER BY e.name ASC
    """)
    tutors = []
    for r in cur.fetchall():
        d = dict(r)
        init_bank = float(d.get("initial_bank_hours", 0.0))
        mat = float(d.get("total_maturate", 0.0))
        util = float(d.get("total_utilizzate", 0.0))
        d["saldo_banca_ore"] = round(init_bank + mat - util, 1)
        names = d.get("assigned_courses_names") or ""
        d["assigned_courses_list"] = [c.strip() for c in names.split(",") if c.strip()]
        tutors.append(d)

    # 2. Docenti summary from classroom calendar sessions
    cur.execute("""
    SELECT s.docente,
           COUNT(s.id) AS sessions_count,
           COALESCE(SUM(s.hours), 0) AS total_hours,
           COALESCE(SUM(CASE WHEN s.status = 'svolta' THEN s.hours ELSE 0 END), 0) AS ore_svolte,
           COALESCE(SUM(CASE WHEN s.status = 'confermata' THEN s.hours ELSE 0 END), 0) AS ore_confermate,
           COALESCE(SUM(CASE WHEN s.status = 'rinviata' THEN 1 ELSE 0 END), 0) AS lezioni_rinviate,
           COALESCE(SUM(CASE WHEN s.status = 'annullata' THEN 1 ELSE 0 END), 0) AS lezioni_annullate,
           COALESCE(GROUP_CONCAT(DISTINCT s.modulo), '') AS moduli_names,
           COALESCE(GROUP_CONCAT(DISTINCT c.name), '') AS courses_names
    FROM course_calendar_sessions s
    JOIN course_calendars cal ON s.calendar_id = cal.id
    JOIN courses c ON cal.course_id = c.id
    WHERE s.phase = 'aula' AND TRIM(s.docente) != ''
    GROUP BY TRIM(s.docente)
    ORDER BY s.docente ASC
    """)
    docenti = []
    for r in cur.fetchall():
        d = dict(r)
        mod_names = d.get("moduli_names") or ""
        crs_names = d.get("courses_names") or ""
        d["moduli_list"] = [m.strip() for m in mod_names.split(",") if m.strip()]
        d["courses_list"] = [cn.strip() for cn in crs_names.split(",") if cn.strip()]
        docenti.append(d)

    conn.close()
    return {
        "tutors": tutors,
        "docenti": docenti
    }


# -------------------------------------------------------------
# COURSES CRUD & TRACKING (MONTE ORE CORSI)
# -------------------------------------------------------------

def list_courses(employee_id: Optional[int] = None) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        if employee_id:
            cur.execute("""
            SELECT c.*, e.name AS tutor_name
            FROM courses c
            LEFT JOIN employees e ON c.employee_id = e.id
            WHERE c.employee_id = ? OR c.employee_id IS NULL
            ORDER BY c.status ASC, c.id ASC
            """, (employee_id,))
        else:
            cur.execute("""
            SELECT c.*, e.name AS tutor_name
            FROM courses c
            LEFT JOIN employees e ON c.employee_id = e.id
            ORDER BY c.status ASC, c.id ASC
            """)

        rows = cur.fetchall()
        courses = []
        today_str = datetime.date.today().isoformat()

        for r in rows:
            d = dict(r)
            cid = d["id"]
            tot_allocated = float(d["total_allocated_hours"])

            # Ore svolte da calendario (lezioni passate fino a oggi, considerando date effettive ed escludendo annullate)
            cur.execute("""
                SELECT COALESCE(SUM(s.hours), 0) as past_hours,
                       COUNT(s.id) as past_count
                FROM course_calendar_sessions s
                JOIN course_calendars cal ON cal.id = s.calendar_id
                WHERE cal.course_id = ? 
                  AND COALESCE(NULLIF(s.rescheduled_to_date, ''), s.date) <= ? 
                  AND s.status != 'annullata'
            """, (cid, today_str))
            cal_past = cur.fetchone()
            cal_past_hrs = float(cal_past["past_hours"]) if cal_past else 0.0
            cal_past_cnt = int(cal_past["past_count"]) if cal_past else 0

            # Ore totali pianificate da calendario
            cur.execute("""
                SELECT COALESCE(SUM(s.hours), 0) as tot_hours,
                       COUNT(s.id) as tot_count
                FROM course_calendar_sessions s
                JOIN course_calendars cal ON cal.id = s.calendar_id
                WHERE cal.course_id = ? AND s.status != 'annullata'
            """, (cid,))
            cal_tot = cur.fetchone()
            cal_tot_hrs = float(cal_tot["tot_hours"]) if cal_tot else 0.0
            cal_tot_cnt = int(cal_tot["tot_count"]) if cal_tot else 0

            # Ore registrate manualmente nei work_entries per questo corso
            cur.execute("""
                SELECT COALESCE(SUM(CASE WHEN actual_hours > 0 THEN actual_hours ELSE hours END), 0) as manual_hours,
                       COUNT(id) as manual_count
            FROM work_entries
            WHERE course_id = ?
            """, (cid,))
            w_entry = cur.fetchone()
            w_hrs = float(w_entry["manual_hours"]) if w_entry else 0.0
            w_cnt = int(w_entry["manual_count"]) if w_entry else 0

            # Allinea monte ore totale se il calendario pianifica più ore
            if cal_tot_hrs > 0 and cal_tot_hrs > tot_allocated:
                tot_allocated = cal_tot_hrs
                d["total_allocated_hours"] = tot_allocated

            # Le ore svolte considerano le lezioni passate da calendario O le ore registrate manualmente
            hrs_worked = max(cal_past_hrs, w_hrs)
            remaining = max(0.0, tot_allocated - hrs_worked)
            pct = round((hrs_worked / tot_allocated * 100), 1) if tot_allocated > 0 else 0

            # Estrai ED del corso
            text = f"{d.get('code') or ''} {d.get('name') or ''}"
            m = re.search(r"ED\s*(\d+)", text, re.IGNORECASE)
            d["ed_code"] = f"ED {m.group(1)}" if m else (d.get("code") or "")

            d["hours_worked"] = hrs_worked
            d["hours_remaining"] = remaining
            d["progress_pct"] = min(100.0, pct)
            d["calendar_past_hours"] = cal_past_hrs
            d["calendar_past_count"] = cal_past_cnt
            d["calendar_total_hours"] = cal_tot_hrs
            d["calendar_total_count"] = cal_tot_cnt
            d["manual_entries_count"] = w_cnt
            d["manual_entries_hours"] = w_hrs
            courses.append(d)

        return courses
    finally:
        conn.close()


def get_course(course_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
        SELECT c.*, e.name AS tutor_name
        FROM courses c
        LEFT JOIN employees e ON c.employee_id = e.id
        WHERE c.id = ?
        """, (course_id,))
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        today_str = datetime.date.today().isoformat()
        cur.execute("""
            SELECT COALESCE(SUM(s.hours), 0) as past_hours,
                   COUNT(s.id) as past_count
            FROM course_calendar_sessions s
            JOIN course_calendars cal ON cal.id = s.calendar_id
            WHERE cal.course_id = ? 
              AND COALESCE(NULLIF(s.rescheduled_to_date, ''), s.date) <= ? 
              AND s.status != 'annullata'
        """, (course_id, today_str))
        cal_past = cur.fetchone()
        cal_past_hrs = float(cal_past["past_hours"]) if cal_past else 0.0
        cal_past_cnt = int(cal_past["past_count"]) if cal_past else 0

        cur.execute("""
            SELECT COALESCE(SUM(s.hours), 0) as tot_hours,
                   COUNT(s.id) as tot_count
            FROM course_calendar_sessions s
            JOIN course_calendars cal ON cal.id = s.calendar_id
            WHERE cal.course_id = ? AND s.status != 'annullata'
        """, (course_id,))
        cal_tot = cur.fetchone()
        cal_tot_hrs = float(cal_tot["tot_hours"]) if cal_tot else 0.0
        cal_tot_cnt = int(cal_tot["tot_count"]) if cal_tot else 0

        cur.execute("""
            SELECT COALESCE(SUM(CASE WHEN actual_hours > 0 THEN actual_hours ELSE hours END), 0) as manual_hours,
                   COUNT(id) as manual_count
            FROM work_entries
            WHERE course_id = ?
        """, (course_id,))
        w_entry = cur.fetchone()
        w_hrs = float(w_entry["manual_hours"]) if w_entry else 0.0
        w_cnt = int(w_entry["manual_count"]) if w_entry else 0

        tot_allocated = float(d["total_allocated_hours"])
        if cal_tot_hrs > 0 and cal_tot_hrs > tot_allocated:
            tot_allocated = cal_tot_hrs
            d["total_allocated_hours"] = tot_allocated

        hrs_worked = max(cal_past_hrs, w_hrs)
        remaining = max(0.0, tot_allocated - hrs_worked)
        pct = round((hrs_worked / tot_allocated * 100), 1) if tot_allocated > 0 else 0

        text = f"{d.get('code') or ''} {d.get('name') or ''}"
        m = re.search(r"ED\s*(\d+)", text, re.IGNORECASE)
        d["ed_code"] = f"ED {m.group(1)}" if m else (d.get("code") or "")

        d["hours_worked"] = hrs_worked
        d["hours_remaining"] = remaining
        d["progress_pct"] = min(100.0, pct)
        d["calendar_past_hours"] = cal_past_hrs
        d["calendar_past_count"] = cal_past_cnt
        d["calendar_total_hours"] = cal_tot_hrs
        d["calendar_total_count"] = cal_tot_cnt
        d["manual_entries_count"] = w_cnt
        d["manual_entries_hours"] = w_hrs
        return d
    finally:
        conn.close()


def create_course(employee_id: Optional[int], data: Dict[str, Any]) -> int:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        raw_emp = data.get("employee_id")
        if raw_emp is not None and str(raw_emp).strip() != "" and str(raw_emp) != "0":
            emp_id = int(raw_emp)
        else:
            emp_id = int(employee_id) if (employee_id and str(employee_id) != "0") else None

        integ = 1 if data.get("integrates_with_contract") in (True, 1, "1", "true", "True") else 0

        cur.execute("""
        INSERT INTO courses (employee_id, code, name, total_allocated_hours, color, status, notes, docente_referente, integrates_with_contract)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            emp_id,
            data.get("code", "").strip(),
            data.get("name", "Nuovo Corso").strip(),
            float(data.get("total_allocated_hours", 100.0)),
            data.get("color", "#2563EB"),
            data.get("status", "Attivo"),
            data.get("notes", "").strip(),
            data.get("docente_referente", "").strip(),
            integ
        ))
        new_id = cur.lastrowid
        conn.commit()
        return new_id
    finally:
        conn.close()


def update_course(course_id: int, data: Dict[str, Any]) -> bool:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM courses WHERE id = ?", (course_id,))
        existing_course = cur.fetchone()
        if not existing_course:
            return False

        raw_emp = data.get("employee_id")
        has_emp_field = "employee_id" in data
        emp_id = int(raw_emp) if (raw_emp is not None and str(raw_emp).strip() != "" and str(raw_emp) != "0") else None
        if not has_emp_field:
            emp_id = existing_course["employee_id"]

        integ = existing_course["integrates_with_contract"]
        if "integrates_with_contract" in data:
            integ = 1 if data.get("integrates_with_contract") in (True, 1, "1", "true", "True") else 0

        cur.execute("""
        UPDATE courses
        SET employee_id = ?, code = ?, name = ?, total_allocated_hours = ?, color = ?, status = ?, notes = ?, docente_referente = ?, integrates_with_contract = ?
        WHERE id = ?
        """, (
            emp_id,
            data.get("code", existing_course["code"]).strip(),
            data.get("name", existing_course["name"]).strip(),
            float(data.get("total_allocated_hours", existing_course["total_allocated_hours"])),
            data.get("color", existing_course["color"] or "#2563EB"),
            data.get("status", existing_course["status"] or "Attivo"),
            data.get("notes", existing_course["notes"] or "").strip(),
            data.get("docente_referente", existing_course["docente_referente"] or "").strip(),
            int(integ),
            course_id
        ))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def toggle_course_contract_integration(course_id: int) -> Dict[str, Any]:
    """Commuta lo stato di integrazione con le ore contrattuali d'ufficio per un corso."""
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, name, integrates_with_contract FROM courses WHERE id = ?", (course_id,))
        row = cur.fetchone()
        if not row:
            raise ValueError(f"Corso {course_id} non trovato.")
        cur_val = int(row["integrates_with_contract"] or 0)
        new_val = 0 if cur_val == 1 else 1
        cur.execute("UPDATE courses SET integrates_with_contract = ? WHERE id = ?", (new_val, course_id))
        conn.commit()
        return {
            "status": "ok",
            "course_id": course_id,
            "course_name": row["name"],
            "integrates_with_contract": new_val
        }
    finally:
        conn.close()


def delete_course(course_id: int) -> bool:
    conn = get_db_connection()
    cur = conn.cursor()
    # Delete associated course calendars and their sessions
    cur.execute("DELETE FROM course_calendar_sessions WHERE calendar_id IN (SELECT id FROM course_calendars WHERE course_id = ?)", (course_id,))
    cur.execute("DELETE FROM course_calendars WHERE course_id = ?", (course_id,))
    cur.execute("UPDATE work_entries SET course_id = NULL WHERE course_id = ?", (course_id,))
    cur.execute("UPDATE documents SET course_id = NULL WHERE course_id = ?", (course_id,))
    cur.execute("DELETE FROM courses WHERE id = ?", (course_id,))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected


# -------------------------------------------------------------
# WORK ENTRIES & LESSONS (USCITE ANTICIPATE / POSTICIPATE)
# -------------------------------------------------------------

ITALIAN_DAYS = {
    0: "Lunedì", 1: "Martedì", 2: "Mercoledì", 3: "Giovedì",
    4: "Venerdì", 5: "Sabato", 6: "Domenica"
}

ITALIAN_MONTHS = {
    1: "GENNAIO", 2: "FEBBRAIO", 3: "MARZO", 4: "APRILE",
    5: "MAGGIO", 6: "GIUGNO", 7: "LUGLIO", 8: "AGOSTO",
    9: "SETTEMBRE", 10: "OTTOBRE", 11: "NOVEMBRE", 12: "DICEMBRE"
}

def format_date_metadata(date_str: str):
    try:
        dt = datetime.date.fromisoformat(date_str)
        dow = ITALIAN_DAYS.get(dt.weekday(), "")
        month_name = ITALIAN_MONTHS.get(dt.month, "")
        month_year = f"{month_name} {dt.year}"
        return dow, month_year
    except Exception:
        return "", ""


def _time_str_to_minutes(t_str: Optional[str]) -> Optional[int]:
    if not t_str or not isinstance(t_str, str) or ":" not in t_str:
        return None
    try:
        parts = t_str.strip().split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return None


def calculate_day_hours_breakdown(
    office_start: str = "",
    office_end: str = "",
    lunch_start: str = "",
    lunch_end: str = "",
    course_start: str = "",
    course_end: str = "",
    is_integrated: bool = False,
    contract_hours: float = 4.0
) -> Dict[str, Any]:
    """
    Calcola analiticamente le ore lavorate effettive in ogni fascia giornaliera:
    - Sede / Ufficio (al netto della pausa pranzo)
    - Corso / Lezione
    - Integrazione con ore contrattuali (se integrato, le ore coincidenti non vengono raddoppiate)
    - Segnalazione conflitto se corso e ufficio non sono integrati ma si sovrappongono
    """
    office_mins = set()
    os_m = _time_str_to_minutes(office_start)
    oe_m = _time_str_to_minutes(office_end)
    if os_m is not None and oe_m is not None and oe_m > os_m:
        office_mins = set(range(os_m, oe_m))
        ls_m = _time_str_to_minutes(lunch_start)
        le_m = _time_str_to_minutes(lunch_end)
        if ls_m is not None and le_m is not None and le_m > ls_m:
            lunch_set = set(range(max(os_m, ls_m), min(oe_m, le_m)))
            office_mins -= lunch_set

    course_mins = set()
    cs_m = _time_str_to_minutes(course_start)
    ce_m = _time_str_to_minutes(course_end)
    if cs_m is not None and ce_m is not None and ce_m > cs_m:
        course_mins = set(range(cs_m, ce_m))

    overlap = office_mins.intersection(course_mins)
    has_conflict = False
    conflict_msg = ""
    overlap_hrs = round(len(overlap) / 60.0, 2)

    if not is_integrated and len(overlap) > 0:
        has_conflict = True
        conflict_msg = (
            f"Sovrapposizione di {overlap_hrs:.1f}h tra orario ufficio e corso non integrato! "
            f"Per svolgere il corso durante l'orario d'ufficio attiva 'Integra con ore contrattuali' sul corso."
        )

    if is_integrated:
        worked_mins = office_mins.union(course_mins)
        tot_worked = round(len(worked_mins) / 60.0, 2)
    else:
        tot_worked = round((len(office_mins) + len(course_mins)) / 60.0, 2)

    off_hrs = round(len(office_mins) / 60.0, 2)
    crs_hrs = round(len(course_mins) / 60.0, 2)
    lunch_hrs = 0.0
    if lunch_start and lunch_end:
        ls = _time_str_to_minutes(lunch_start)
        le = _time_str_to_minutes(lunch_end)
        if ls is not None and le is not None and le > ls:
            lunch_hrs = round((le - ls) / 60.0, 2)

    variance = round(tot_worked - contract_hours, 2)

    if is_integrated and overlap_hrs > 0:
        summary_text = (
            f"Corso ({course_start}-{course_end}) integrato con orario ufficio ({office_start}-{office_end}): "
            f"{overlap_hrs:.1f}h coincidenti conteggiate una sola volta. Totale lavorato: {tot_worked:.1f}h."
        )
    elif crs_hrs > 0 and off_hrs > 0:
        summary_text = f"Ufficio ({off_hrs:.1f}h) + Corso autonomo ({crs_hrs:.1f}h) = Totale {tot_worked:.1f}h."
    elif crs_hrs > 0:
        summary_text = f"Presenza Corso: {crs_hrs:.1f}h ({course_start}-{course_end})."
    else:
        summary_text = f"Lavoro in Sede/Ufficio: {off_hrs:.1f}h ({office_start}-{office_end})."

    return {
        "office_hours": off_hrs,
        "course_hours": crs_hrs,
        "lunch_hours": lunch_hrs,
        "overlap_hours": overlap_hrs,
        "total_worked_hours": tot_worked,
        "contract_hours": contract_hours,
        "variance": variance,
        "has_conflict": has_conflict,
        "conflict_msg": conflict_msg,
        "is_integrated": is_integrated,
        "summary_text": summary_text
    }


def _parse_time_diff_hours(t_start: str, t_end: str) -> float:
    try:
        h1, m1 = map(int, t_start.split(":"))
        h2, m2 = map(int, t_end.split(":"))
        mins = (h2 * 60 + m2) - (h1 * 60 + m1)
        return max(0.0, round(mins / 60.0, 2))
    except Exception:
        return 0.0


def get_entry(entry_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM work_entries WHERE id = ?", (entry_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def add_entry(employee_id: int, data: Dict[str, Any]) -> int:
    raw_date = data.get("date") or datetime.date.today().isoformat()
    date_str = validate_iso_date(raw_date, "Data registrazione")
    dow, month_year = format_date_metadata(date_str)
    exit_date = validate_iso_date(data.get("exit_date") or date_str, "Data uscita")

    s_start = validate_time_str(data.get("scheduled_start") or "09:00", "Orario inizio previsto")
    s_end = validate_time_str(data.get("scheduled_end") or "13:00", "Orario fine previsto")
    a_start = validate_time_str(data.get("actual_start") or s_start, "Orario inizio effettivo")
    a_end = validate_time_str(data.get("actual_end") or s_end, "Orario fine effettivo")

    office_start = str(data.get("office_start") or "").strip()
    office_end = str(data.get("office_end") or "").strip()
    course_start = str(data.get("course_start") or "").strip()
    course_end = str(data.get("course_end") or "").strip()
    lunch_start = str(data.get("lunch_break_start") or "").strip()
    lunch_end = str(data.get("lunch_break_end") or "").strip()

    if office_start:
        office_start = validate_time_str(office_start, "Orario entrata sede")
    if office_end:
        office_end = validate_time_str(office_end, "Orario uscita sede")
    if course_start:
        course_start = validate_time_str(course_start, "Orario inizio corso")
    if course_end:
        course_end = validate_time_str(course_end, "Orario termine corso")
    if lunch_start:
        lunch_start = validate_time_str(lunch_start, "Inizio pausa pranzo")
    if lunch_end:
        lunch_end = validate_time_str(lunch_end, "Fine pausa pranzo")

    course_id = data.get("course_id")
    course_id = int(course_id) if (course_id and str(course_id).strip() != "" and str(course_id) != "0") else None

    # Determinazione se il corso è integrato con le ore contrattuali
    is_integrated = 0
    if "is_integrated" in data:
        is_integrated = 1 if data.get("is_integrated") in (True, 1, "1", "true", "True") else 0
    elif course_id:
        conn_chk = get_db_connection()
        cur_chk = conn_chk.cursor()
        cur_chk.execute("SELECT integrates_with_contract FROM courses WHERE id = ?", (course_id,))
        c_row = cur_chk.fetchone()
        conn_chk.close()
        if c_row:
            is_integrated = int(c_row["integrates_with_contract"] or 0)

    c_sched = get_employee_contract_schedule_for_date(employee_id, date_str)
    if c_sched.get("has_fixed"):
        contract_h = c_sched["contract_hours"]
    else:
        emp = get_employee(employee_id)
        contract_h = float(emp.get("standard_day_hours", 7.0)) if emp else 7.0

    eff_off_start = office_start or (a_start if not course_id else "")
    eff_off_end = office_end or (a_end if not course_id else "")
    eff_crs_start = course_start or (a_start if course_id else "")
    eff_crs_end = course_end or (a_end if course_id else "")

    calc = calculate_day_hours_breakdown(
        office_start=eff_off_start,
        office_end=eff_off_end,
        lunch_start=lunch_start,
        lunch_end=lunch_end,
        course_start=eff_crs_start,
        course_end=eff_crs_end,
        is_integrated=bool(is_integrated),
        contract_hours=contract_h
    )

    s_hours = round(float(data.get("scheduled_hours") or (calc["contract_hours"] if (eff_off_start or eff_crs_start) else validate_time_interval(s_start, s_end))), 2)
    a_hours = calc["total_worked_hours"] if (eff_off_start or eff_crs_start) else validate_time_interval(a_start, a_end)
    variance = round(a_hours - s_hours, 2)
    entry_type = data.get("type", "").lower()
    raw_hours = data.get("hours")

    if raw_hours is not None and str(raw_hours).strip() != "":
        try:
            h_parsed = float(raw_hours)
            if h_parsed < 0 or h_parsed > 24:
                raise ValueError("Le ore devono essere comprese tra 0 e 24.")
        except (ValueError, TypeError):
            raise ValueError(f"Valore ore '{raw_hours}' non valido.")
    else:
        h_parsed = None

    if h_parsed is not None and h_parsed > 0 and entry_type in ("maturata", "utilizzata"):
        hours = h_parsed
    elif variance > 0:
        entry_type = "maturata"
        hours = variance
    elif variance < 0:
        entry_type = "utilizzata"
        hours = abs(variance)
    else:
        if not entry_type:
            entry_type = "ordinaria"
        hours = h_parsed if h_parsed is not None else a_hours

    if not entry_type:
        entry_type = "maturata" if hours > 0 else "ordinaria"

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
        INSERT INTO work_entries (
            employee_id, course_id, date, day_of_week, month_year,
            scheduled_start, scheduled_end, actual_start, actual_end,
            scheduled_hours, actual_hours, hours, type, activity_type, causale, note,
            lunch_break_start, lunch_break_end, exit_date, office_start, office_end,
            course_start, course_end, is_integrated
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            employee_id,
            course_id,
            date_str,
            dow,
            month_year,
            s_start,
            s_end,
            a_start,
            a_end,
            s_hours,
            a_hours,
            hours,
            entry_type,
            data.get("activity_type", "Tutoraggio d'aula"),
            data.get("causale", ""),
            data.get("note", ""),
            lunch_start,
            lunch_end,
            exit_date,
            eff_off_start,
            eff_off_end,
            eff_crs_start,
            eff_crs_end,
            is_integrated
        ))
        new_id = cur.lastrowid
        conn.commit()
        return new_id
    finally:
        conn.close()


def update_entry(entry_id: int, data: Dict[str, Any]) -> bool:
    raw_date = data.get("date") or datetime.date.today().isoformat()
    date_str = validate_iso_date(raw_date, "Data registrazione")
    dow, month_year = format_date_metadata(date_str)
    exit_date = validate_iso_date(data.get("exit_date") or date_str, "Data uscita")

    s_start = validate_time_str(data.get("scheduled_start") or "09:00", "Orario inizio previsto")
    s_end = validate_time_str(data.get("scheduled_end") or "13:00", "Orario fine previsto")
    a_start = validate_time_str(data.get("actual_start") or s_start, "Orario inizio effettivo")
    a_end = validate_time_str(data.get("actual_end") or s_end, "Orario fine effettivo")

    office_start = str(data.get("office_start") or "").strip()
    office_end = str(data.get("office_end") or "").strip()
    course_start = str(data.get("course_start") or "").strip()
    course_end = str(data.get("course_end") or "").strip()
    lunch_start = str(data.get("lunch_break_start") or "").strip()
    lunch_end = str(data.get("lunch_break_end") or "").strip()

    if office_start:
        office_start = validate_time_str(office_start, "Orario entrata sede")
    if office_end:
        office_end = validate_time_str(office_end, "Orario uscita sede")
    if course_start:
        course_start = validate_time_str(course_start, "Orario inizio corso")
    if course_end:
        course_end = validate_time_str(course_end, "Orario termine corso")
    if lunch_start:
        lunch_start = validate_time_str(lunch_start, "Inizio pausa pranzo")
    if lunch_end:
        lunch_end = validate_time_str(lunch_end, "Fine pausa pranzo")

    course_id = data.get("course_id")
    course_id = int(course_id) if (course_id and str(course_id).strip() != "" and str(course_id) != "0") else None

    is_integrated = 0
    if "is_integrated" in data:
        is_integrated = 1 if data.get("is_integrated") in (True, 1, "1", "true", "True") else 0
    elif course_id:
        conn_chk = get_db_connection()
        cur_chk = conn_chk.cursor()
        cur_chk.execute("SELECT integrates_with_contract FROM courses WHERE id = ?", (course_id,))
        c_row = cur_chk.fetchone()
        conn_chk.close()
        if c_row:
            is_integrated = int(c_row["integrates_with_contract"] or 0)

    # Fetch employee id for this entry
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT employee_id FROM work_entries WHERE id = ?", (entry_id,))
        e_row = cur.fetchone()
        emp_id = e_row["employee_id"] if e_row else 1
        c_sched = get_employee_contract_schedule_for_date(emp_id, date_str)
        if c_sched.get("has_fixed"):
            contract_h = c_sched["contract_hours"]
        else:
            emp = get_employee(emp_id)
            contract_h = float(emp.get("standard_day_hours", 7.0)) if emp else 7.0

        eff_off_start = office_start or (a_start if not course_id else "")
        eff_off_end = office_end or (a_end if not course_id else "")
        eff_crs_start = course_start or (a_start if course_id else "")
        eff_crs_end = course_end or (a_end if course_id else "")

        calc = calculate_day_hours_breakdown(
            office_start=eff_off_start,
            office_end=eff_off_end,
            lunch_start=lunch_start,
            lunch_end=lunch_end,
            course_start=eff_crs_start,
            course_end=eff_crs_end,
            is_integrated=bool(is_integrated),
            contract_hours=contract_h
        )

        s_hours = round(float(data.get("scheduled_hours") or (calc["contract_hours"] if (eff_off_start or eff_crs_start) else validate_time_interval(s_start, s_end))), 2)
        a_hours = calc["total_worked_hours"] if (eff_off_start or eff_crs_start) else validate_time_interval(a_start, a_end)
        variance = round(a_hours - s_hours, 2)
        entry_type = data.get("type", "").lower()
        raw_hours = data.get("hours")

        if raw_hours is not None and str(raw_hours).strip() != "":
            try:
                h_parsed = float(raw_hours)
                if h_parsed < 0 or h_parsed > 24:
                    raise ValueError("Le ore devono essere comprese tra 0 e 24.")
            except (ValueError, TypeError):
                raise ValueError(f"Valore ore '{raw_hours}' non valido.")
        else:
            h_parsed = None

        if h_parsed is not None and h_parsed > 0 and entry_type in ("maturata", "utilizzata"):
            hours = h_parsed
        elif variance > 0:
            entry_type = "maturata"
            hours = variance
        elif variance < 0:
            entry_type = "utilizzata"
            hours = abs(variance)
        else:
            if not entry_type:
                entry_type = "ordinaria"
            hours = h_parsed if h_parsed is not None else a_hours

        cur.execute("""
        UPDATE work_entries
        SET course_id = ?, date = ?, day_of_week = ?, month_year = ?,
            scheduled_start = ?, scheduled_end = ?, actual_start = ?, actual_end = ?,
            scheduled_hours = ?, actual_hours = ?, hours = ?, type = ?, activity_type = ?, causale = ?, note = ?,
            lunch_break_start = ?, lunch_break_end = ?, exit_date = ?, office_start = ?, office_end = ?,
            course_start = ?, course_end = ?, is_integrated = ?
        WHERE id = ?
        """, (
            course_id,
            date_str,
            dow,
            month_year,
            s_start,
            s_end,
            a_start,
            a_end,
            s_hours,
            a_hours,
            hours,
            entry_type,
            data.get("activity_type", "Tutoraggio d'aula"),
            data.get("causale", ""),
            data.get("note", ""),
            lunch_start,
            lunch_end,
            exit_date,
            eff_off_start,
            eff_off_end,
            eff_crs_start,
            eff_crs_end,
            is_integrated,
            entry_id
        ))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_entry(entry_id: int) -> bool:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM work_entries WHERE id = ?", (entry_id,))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected


def list_entries(employee_id: int, month_year: Optional[str] = None, entry_type: Optional[str] = None, course_id: Optional[int] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()

    query = """
    SELECT w.*, c.name AS course_name, c.color AS course_color
    FROM work_entries w
    LEFT JOIN courses c ON w.course_id = c.id
    WHERE w.employee_id = ?
    """
    params: List[Any] = [employee_id]

    if month_year:
        query += " AND w.month_year = ?"
        params.append(month_year)
    if entry_type:
        if entry_type == "ordinaria":
            query += " AND w.type IN ('ordinaria', 'ordinario')"
        elif entry_type == "presenza_corso":
            query += " AND (w.type = 'presenza_corso' OR (w.type = 'ordinario' AND w.course_id IS NOT NULL))"
        else:
            query += " AND w.type = ?"
            params.append(entry_type)
    if course_id:
        query += " AND w.course_id = ?"
        params.append(course_id)
    if search:
        query += " AND (w.causale LIKE ? OR w.note LIKE ? OR w.date LIKE ? OR c.name LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s, s])

    query += " ORDER BY w.date ASC, w.id ASC"
    cur.execute(query, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    emp = get_employee(employee_id)
    initial_bank = emp.get("initial_bank_hours", 0.0) if emp else 0.0

    all_entries = get_all_chronological_entries(employee_id)
    balance_map = {}
    current_remaining = initial_bank

    for item in all_entries:
        if item["type"] == "utilizzata":
            current_remaining -= item["hours"]
        balance_map[item["id"]] = current_remaining

    for r in rows:
        r["running_balance"] = balance_map.get(r["id"], current_remaining)

    return rows


def get_all_chronological_entries(employee_id: int) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    SELECT w.*, c.name AS course_name, c.color AS course_color
    FROM work_entries w
    LEFT JOIN courses c ON w.course_id = c.id
    WHERE w.employee_id = ?
    ORDER BY w.date ASC, w.id ASC
    """, (employee_id,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


# -------------------------------------------------------------
# WEEKLY SCHEDULE (DETTAGLIO SETTIMANA IN CORSO)
# -------------------------------------------------------------

def get_weekly_schedule(employee_id: int, target_date_str: Optional[str] = None) -> Dict[str, Any]:
    conn = get_db_connection()
    cur = conn.cursor()

    # Find earliest course session for this employee to facilitate jumping to active dates
    cur.execute("""
    SELECT MIN(s.date) as first_date, COUNT(*) as future_cnt
    FROM course_calendar_sessions s
    JOIN course_calendars cal ON s.calendar_id = cal.id
    JOIN courses c ON cal.course_id = c.id
    WHERE (c.employee_id = ? OR cal.stage_tutor_id = ? OR s.tutor_id = ?)
    """, (employee_id, employee_id, employee_id))
    course_sched_info = cur.fetchone()
    first_course_date = course_sched_info["first_date"] if course_sched_info and course_sched_info["first_date"] else None
    total_course_sessions = course_sched_info["future_cnt"] if course_sched_info else 0

    if target_date_str:
        dt = datetime.date.fromisoformat(target_date_str)
    else:
        dt = datetime.date.today()

    monday = dt - datetime.timedelta(days=dt.weekday())
    sunday = monday + datetime.timedelta(days=6)

    # 1. Registered work entries
    cur.execute("""
    SELECT w.*, c.name AS course_name, c.code AS course_code, c.color AS course_color
    FROM work_entries w
    LEFT JOIN courses c ON w.course_id = c.id
    WHERE w.employee_id = ? AND w.date >= ? AND w.date <= ?
    ORDER BY w.date ASC, w.scheduled_start ASC, w.id ASC
    """, (employee_id, monday.isoformat(), sunday.isoformat()))
    week_entries = [dict(r) for r in cur.fetchall()]

    # 2. Programmed course calendar sessions for this week
    cur.execute("""
    SELECT s.*, c.id AS course_id, c.name AS course_name, c.code AS course_code, c.color AS course_color,
           cal.title AS calendar_title
    FROM course_calendar_sessions s
    JOIN course_calendars cal ON s.calendar_id = cal.id
    JOIN courses c ON cal.course_id = c.id
    WHERE (c.employee_id = ? OR cal.stage_tutor_id = ? OR s.tutor_id = ?)
      AND s.date >= ? AND s.date <= ?
    ORDER BY s.date ASC, s.start_time ASC, s.id ASC
    """, (employee_id, employee_id, employee_id, monday.isoformat(), sunday.isoformat()))
    calendar_sessions = [dict(r) for r in cur.fetchall()]

    conn.close()

    days = []
    tot_scheduled = 0.0
    tot_actual = 0.0
    tot_maturate = 0.0
    tot_utilizzate = 0.0

    for i in range(7):
        day_date = monday + datetime.timedelta(days=i)
        d_str = day_date.isoformat()
        dow = ITALIAN_DAYS.get(day_date.weekday(), "")
        entries_this_day = [e for e in week_entries if e["date"] == d_str]
        cal_sessions_this_day = [s for s in calendar_sessions if s["date"] == d_str]

        d_sched = sum(e["scheduled_hours"] for e in entries_this_day)
        d_act = sum(e["actual_hours"] if e["actual_hours"] > 0 else e["hours"] for e in entries_this_day)
        d_mat = sum(e["hours"] for e in entries_this_day if e["type"] == "maturata")
        d_util = sum(e["hours"] for e in entries_this_day if e["type"] == "utilizzata")

        tot_scheduled += d_sched
        tot_actual += d_act
        tot_maturate += d_mat
        tot_utilizzate += d_util

        days.append({
            "date": d_str,
            "day_of_week": dow,
            "display_date": day_date.strftime("%d/%m/%Y"),
            "is_today": day_date == datetime.date.today(),
            "scheduled_hours": d_sched,
            "actual_hours": d_act,
            "maturate_hours": d_mat,
            "utilizzate_hours": d_util,
            "net_variance": round(d_mat - d_util, 2),
            "entries": entries_this_day,
            "calendar_sessions": cal_sessions_this_day
        })

    prev_monday = (monday - datetime.timedelta(days=7)).isoformat()
    next_monday = (monday + datetime.timedelta(days=7)).isoformat()

    return {
        "start_date": monday.isoformat(),
        "end_date": sunday.isoformat(),
        "label": f"Settimana {monday.strftime('%d/%m')} - {sunday.strftime('%d/%m/%Y')}",
        "prev_week": prev_monday,
        "next_week": next_monday,
        "tot_scheduled": round(tot_scheduled, 2),
        "tot_actual": round(tot_actual, 2),
        "tot_maturate": round(tot_maturate, 2),
        "tot_utilizzate": round(tot_utilizzate, 2),
        "net_variance": round(tot_maturate - tot_utilizzate, 2),
        "first_course_date": first_course_date,
        "total_course_sessions": total_course_sessions,
        "days": days
    }


def get_master_calendar_schedule(target_date_str: Optional[str] = None, view_mode: str = "week", course_id: Optional[int] = None) -> Dict[str, Any]:
    """Retrieves all course lessons grouped and aligned day-by-day for the master course schedule."""
    conn = get_db_connection()
    cur = conn.cursor()

    # Find date bounds of official calendar sessions
    cur.execute("SELECT MIN(date) as first_date, MAX(date) as last_date, COUNT(*) as cnt FROM course_calendar_sessions")
    cal_bounds = cur.fetchone()
    first_date = cal_bounds["first_date"] if cal_bounds and cal_bounds["first_date"] else None
    last_date = cal_bounds["last_date"] if cal_bounds and cal_bounds["last_date"] else None
    total_sessions_all = cal_bounds["cnt"] if cal_bounds else 0

    today = datetime.date.today()
    if target_date_str:
        dt = datetime.date.fromisoformat(target_date_str)
    elif first_date:
        first_dt = datetime.date.fromisoformat(first_date)
        # Default to first lesson date if today is before the courses begin
        dt = first_dt if today < first_dt else today
    else:
        dt = today

    if view_mode == "day":
        start_dt = dt
        end_dt = dt
    else:
        start_dt = dt - datetime.timedelta(days=dt.weekday())
        end_dt = start_dt + datetime.timedelta(days=6)

    # Query sessions in range with course, docente, and tutor metadata
    query = """
    SELECT s.*, c.id AS course_id, c.name AS course_name, c.code AS course_code, c.color AS course_color,
           cal.title AS calendar_title, e.name AS tutor_name
    FROM course_calendar_sessions s
    JOIN course_calendars cal ON s.calendar_id = cal.id
    JOIN courses c ON cal.course_id = c.id
    LEFT JOIN employees e ON c.employee_id = e.id
    WHERE s.date >= ? AND s.date <= ?
    """
    params = [start_dt.isoformat(), end_dt.isoformat()]
    if course_id:
        query += " AND c.id = ?"
        params.append(course_id)

    query += " ORDER BY s.date ASC, s.start_time ASC, c.name ASC"
    cur.execute(query, params)
    sessions = [dict(r) for r in cur.fetchall()]

    # Query courses for filter
    cur.execute("SELECT id, name, code, color, status FROM courses ORDER BY name ASC")
    courses_list = [dict(r) for r in cur.fetchall()]

    conn.close()

    # Build days list
    days = []
    curr = start_dt
    while curr <= end_dt:
        c_str = curr.isoformat()
        dow = ITALIAN_DAYS.get(curr.weekday(), "")
        day_sessions = [s for s in sessions if s["date"] == c_str]
        tot_day_hours = sum(s["hours"] for s in day_sessions)

        days.append({
            "date": c_str,
            "day_of_week": dow,
            "display_date": curr.strftime("%d/%m/%Y"),
            "is_today": curr == today,
            "sessions": day_sessions,
            "total_hours": round(tot_day_hours, 2),
            "courses_count": len(set(s["course_id"] for s in day_sessions))
        })
        curr += datetime.timedelta(days=1)

    prev_date = (start_dt - datetime.timedelta(days=7 if view_mode == "week" else 1)).isoformat()
    next_date = (start_dt + datetime.timedelta(days=7 if view_mode == "week" else 1)).isoformat()

    return {
        "view_mode": view_mode,
        "target_date": dt.isoformat(),
        "start_date": start_dt.isoformat(),
        "end_date": end_dt.isoformat(),
        "label": f"Settimana {start_dt.strftime('%d/%m')} - {end_dt.strftime('%d/%m/%Y')}" if view_mode == "week" else f"{ITALIAN_DAYS.get(dt.weekday(), '')} {dt.strftime('%d/%m/%Y')}",
        "prev_date": prev_date,
        "next_date": next_date,
        "first_course_date": first_date,
        "last_course_date": last_date,
        "total_sessions_all": total_sessions_all,
        "days": days,
        "courses": courses_list
    }


def parse_day_schedule_hours(start_time: str, end_time: str, lunch_start: Optional[str] = None, lunch_end: Optional[str] = None) -> float:
    """Calculates net hours for a single day interval."""
    try:
        if not start_time or not end_time or ":" not in start_time or ":" not in end_time:
            return 0.0
        sh, sm = map(int, start_time.split(":"))
        eh, em = map(int, end_time.split(":"))
        gross_minutes = (eh * 60 + em) - (sh * 60 + sm)
        if gross_minutes <= 0:
            return 0.0
        lunch_minutes = 0
        if lunch_start and lunch_end and ":" in lunch_start and ":" in lunch_end:
            lsh, lsm = map(int, lunch_start.split(":"))
            leh, lem = map(int, lunch_end.split(":"))
            lm = (leh * 60 + lem) - (lsh * 60 + lsm)
            if lm > 0:
                lunch_minutes = lm
        net_minutes = max(0, gross_minutes - lunch_minutes)
        return round(net_minutes / 60.0, 2)
    except Exception:
        return 0.0


def parse_contract_schedule_details(
    raw_details: Any,
    default_work_days: str = "lun,mar,mer,gio,ven",
    default_start: str = "09:00",
    default_end: str = "13:00",
    default_lunch_start: str = "",
    default_lunch_end: str = ""
) -> Dict[str, Any]:
    """
    Parses and returns structured day-by-day schedule details for lun, mar, mer, gio, ven, sab.
    """
    days_order = ["lun", "mar", "mer", "gio", "ven", "sab"]
    day_labels = {
        "lun": "Lunedì",
        "mar": "Martedì",
        "mer": "Mercoledì",
        "gio": "Giovedì",
        "ven": "Venerdì",
        "sab": "Sabato"
    }

    parsed = {}
    if isinstance(raw_details, str) and raw_details.strip():
        try:
            parsed = json.loads(raw_details)
        except Exception:
            parsed = {}
    elif isinstance(raw_details, dict):
        parsed = raw_details

    active_set = set([d.strip().lower() for d in (default_work_days or "").split(",") if d.strip()])

    result = {}
    for code in days_order:
        p_day = parsed.get(code) if isinstance(parsed, dict) else None
        if p_day and isinstance(p_day, dict):
            active = bool(p_day.get("active", False))
            start = str(p_day.get("start") or default_start).strip()
            end = str(p_day.get("end") or default_end).strip()
            l_start = str(p_day.get("lunch_start") or "").strip()
            l_end = str(p_day.get("lunch_end") or "").strip()
            hours = parse_day_schedule_hours(start, end, l_start, l_end) if active else 0.0
        else:
            active = code in active_set
            start = default_start if active else "09:00"
            end = default_end if active else "13:00"
            l_start = default_lunch_start
            l_end = default_lunch_end
            hours = parse_day_schedule_hours(start, end, l_start, l_end) if active else 0.0

        result[code] = {
            "code": code,
            "label": day_labels[code],
            "active": active,
            "start": start,
            "end": end,
            "lunch_start": l_start,
            "lunch_end": l_end,
            "hours": hours
        }

    return result


def format_contract_schedule_summary(sched_details: Dict[str, Any], has_fixed_schedule: bool = True) -> str:
    """Produces human-readable summary of schedule."""
    if not has_fixed_schedule:
        return "Flessibile / A progetto (senza orario fisso da contratto)"

    active_days = [d for d in sched_details.values() if d.get("active")]
    if not active_days:
        return "Nessun orario fisso configurato"

    parts = []
    for d in active_days:
        lbl = d["code"].capitalize()
        lunch_str = f" (Pausa: {d['lunch_start']}-{d['lunch_end']})" if d.get("lunch_start") and d.get("lunch_end") else ""
        parts.append(f"{lbl}: {d['start']}-{d['end']} ({d['hours']}h{lunch_str})")

    tot_h = round(sum(d["hours"] for d in active_days), 2)
    return f"{' • '.join(parts)} | Totale: {tot_h} h/settimana"


def get_employee_contract_schedule_for_date(employee_id: int, date_str: str) -> Dict[str, Any]:
    """
    Restituisce l'orario contrattuale e il monte ore dovuto per una specifica data,
    verificando tutti i contratti ATTIVI e temporalmente VALIDI (start_date <= date <= end_date).
    Se esistono piu contratti a orario fisso nello stesso giorno (es. 09-13 e 14-16),
    calcola l'unione effettiva dei minuti lavorativi evitando sovrapposizioni e duplicazioni.
    """
    dow_map = {0: "lun", 1: "mar", 2: "mer", 3: "gio", 4: "ven", 5: "sab", 6: "dom"}
    try:
        dt = datetime.date.fromisoformat(date_str)
        dow_code = dow_map.get(dt.weekday(), "")
    except Exception:
        dow_code = ""

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT * FROM employee_contracts 
        WHERE employee_id = ? AND status = 'Attivo'
    """, (employee_id,))
    all_contracts = [dict(r) for r in cur.fetchall()]
    conn.close()

    # Filtra per validita temporale della data richiesta
    valid_contracts = []
    for ct in all_contracts:
        s_date = str(ct.get("start_date") or "").strip()
        e_date = str(ct.get("end_date") or "").strip()
        if s_date and date_str < s_date:
            continue
        if e_date and date_str > e_date:
            continue
        valid_contracts.append(ct)

    office_minutes_set = set()
    matching_fixed_cts = []
    matching_flex_cts = []
    schedule_parts = []
    lunch_parts = []

    for ct in valid_contracts:
        if not ct.get("has_fixed_schedule", 1):
            matching_flex_cts.append(ct)
            continue

        sched_map = parse_contract_schedule_details(
            ct.get("schedule_details"),
            ct.get("work_days", "lun,mar,mer,gio,ven"),
            ct.get("work_start_time", "09:00"),
            ct.get("work_end_time", "13:00"),
            ct.get("lunch_break_start", ""),
            ct.get("lunch_break_end", "")
        )

        day_info = sched_map.get(dow_code)
        if day_info and day_info.get("active"):
            matching_fixed_cts.append(ct)
            w_start = str(day_info.get("start") or "09:00").strip()
            w_end = str(day_info.get("end") or "13:00").strip()
            l_start = str(day_info.get("lunch_start") or "").strip()
            l_end = str(day_info.get("lunch_end") or "").strip()

            schedule_parts.append(f"{w_start} - {w_end}")

            sm = _time_str_to_minutes(w_start)
            em = _time_str_to_minutes(w_end)
            if sm is not None and em is not None and em > sm:
                cur_set = set(range(sm, em))
                lsm = _time_str_to_minutes(l_start)
                lem = _time_str_to_minutes(l_end)
                if lsm is not None and lem is not None and lem > lsm:
                    lunch_overlap = set(range(max(sm, lsm), min(em, lem)))
                    cur_set -= lunch_overlap
                    lunch_parts.append(f"{l_start} - {l_end}")
                office_minutes_set.update(cur_set)

    if matching_fixed_cts:
        has_contract = True
        has_fixed = True
        contract_hours = round(len(office_minutes_set) / 60.0, 2)
        schedule_text = ", ".join(schedule_parts)
        lunch_text = ", ".join(dict.fromkeys(lunch_parts)) if lunch_parts else "Continuato (Opzionale)"
        contract_titles = " / ".join(dict.fromkeys(ct["title"] for ct in matching_fixed_cts))
    elif matching_flex_cts:
        has_contract = True
        has_fixed = False
        contract_hours = 0.0
        schedule_text = "Flessibile / A progetto"
        lunch_text = "Opzionale"
        contract_titles = " / ".join(dict.fromkeys(ct["title"] for ct in matching_flex_cts))
    else:
        has_contract = False
        has_fixed = False
        contract_hours = 0.0
        schedule_text = "—"
        lunch_text = "—"
        contract_titles = "Fuori orario da contratto"

    return {
        "has_contract": has_contract,
        "has_fixed": has_fixed,
        "contract_hours": contract_hours,
        "schedule_text": schedule_text,
        "lunch_text": lunch_text,
        "contract_titles": contract_titles,
        "office_minutes_set": office_minutes_set,
        "matching_contracts": matching_fixed_cts or matching_flex_cts
    }


def get_master_aula_grid(docente: Optional[str] = None, month: Optional[str] = None, status_filter: Optional[str] = None, employee_id: Optional[int] = None) -> Dict[str, Any]:
    """
    Ritorna la griglia comparativa orizzontale delle lezioni d'aula (escluso categoricamente lo stage):
    - I corsi sono disposti come colonne orizzontali
    - Le giornate condivise sono allineate sulla stessa riga
    - Ogni riga include il dettaglio dei contratti attivi, l'orario d'ufficio e la pausa pranzo
    - Riporta il calcolo giornaliero delle ore complessive lavorate giorno per giorno
    """
    conn = get_db_connection()
    cur = conn.cursor()
    today_str = datetime.date.today().isoformat()

    if not employee_id:
        cur.execute("SELECT id FROM employees WHERE is_active = 1 AND deleted_at IS NULL ORDER BY role DESC, id ASC LIMIT 1")
        f_emp = cur.fetchone()
        employee_id = f_emp["id"] if f_emp else 26

    # Contratti attivi del tutor
    cur.execute("SELECT * FROM employee_contracts WHERE employee_id = ? AND status = 'Attivo'", (employee_id,))
    active_contracts = [dict(r) for r in cur.fetchall()]

    # Mappa delle proprietà dei corsi (inclusa integrazione contrattuale)
    cur.execute("SELECT id, name, code, color, integrates_with_contract FROM courses")
    courses_dict = {row["id"]: dict(row) for row in cur.fetchall()}

    # 1. Recupera tutti i corsi con sessioni d'aula
    cur.execute("""
        SELECT c.id, c.name, c.code, c.color, e.name AS tutor_name,
               COUNT(s.id) AS sessions_count,
               COALESCE(SUM(s.hours), 0) AS total_aula_hours,
               MIN(s.date) AS min_date,
               MAX(s.date) AS max_date
        FROM courses c
        LEFT JOIN employees e ON c.employee_id = e.id
        JOIN course_calendars cal ON cal.course_id = c.id
        JOIN course_calendar_sessions s ON s.calendar_id = cal.id
        WHERE s.phase = 'aula'
        GROUP BY c.id
        ORDER BY c.id ASC
    """)
    courses_raw = cur.fetchall()
    courses = []
    for r in courses_raw:
        d = dict(r)
        text = f"{d.get('code') or ''} {d.get('name') or ''}"
        m = re.search(r"ED\s*(\d+)", text, re.IGNORECASE)
        d["ed_code"] = f"ED {m.group(1)}" if m else (d.get("code") or f"ED {d['id']}")
        courses.append(d)

    # 2. Prepara filtri sulle sessioni
    query = """
        SELECT s.id, s.calendar_id, cal.course_id, s.date, s.day_of_week,
               s.start_time, s.end_time, s.hours, s.docente, s.modulo, s.status, s.notes,
               s.is_module_test, s.test_notes,
               c.code AS course_code, c.name AS course_name, c.color AS course_color
        FROM course_calendar_sessions s
        JOIN course_calendars cal ON cal.id = s.calendar_id
        JOIN courses c ON cal.course_id = c.id
        WHERE s.phase = 'aula'
    """
    params = []

    if docente and docente.strip() and docente != "all":
        query += " AND s.docente LIKE ?"
        params.append(f"%{docente.strip()}%")

    if month and month.strip() and month != "all":
        query += " AND s.date LIKE ?"
        params.append(f"{month.strip()}%")

    if status_filter == "past":
        query += " AND s.date <= ?"
        params.append(today_str)
    elif status_filter == "future":
        query += " AND s.date > ?"
        params.append(today_str)
    elif status_filter == "tests":
        query += " AND s.is_module_test = 1"

    query += " ORDER BY s.date ASC, s.start_time ASC, c.id ASC"
    cur.execute(query, params)
    sessions = [dict(r) for r in cur.fetchall()]

    # Controlla se esistono registrazioni del tutor per ciascuna sessione
    for s in sessions:
        text = f"{s.get('course_code') or ''} {s.get('course_name') or ''}"
        m = re.search(r"ED\s*(\d+)", text, re.IGNORECASE)
        s["ed_code"] = f"ED {m.group(1)}" if m else (s.get("course_code") or "ED")

        # Verifica rapida se un tutor ha già registrato la presenza
        cur.execute("""
            SELECT id FROM work_entries
            WHERE course_id = ? AND date = ?
            LIMIT 1
        """, (s["course_id"], s["date"]))
        w_found = cur.fetchone()
        s["has_tutor_entry"] = bool(w_found)
        s["is_module_test"] = bool(s.get("is_module_test", 0))
        s["module_test_name"] = f"Test Finale: {s['modulo']}" if s["is_module_test"] else ""

    # 3. Raggruppa sessioni per data e per corso
    sessions_by_date = {}
    distinct_dates = []
    docenti_set = set()
    months_set = set()

    for s in sessions:
        d = s["date"]
        if d not in sessions_by_date:
            sessions_by_date[d] = {
                "date": d,
                "day_of_week": s["day_of_week"],
                "courses": {}
            }
            distinct_dates.append(d)

        cid = s["course_id"]
        if cid not in sessions_by_date[d]["courses"]:
            sessions_by_date[d]["courses"][cid] = []
        sessions_by_date[d]["courses"][cid].append(s)

        if s.get("docente"):
            docenti_set.add(s["docente"].strip())

        parts = d.split("-")
        if len(parts) >= 2:
            m_key = f"{parts[0]}-{parts[1]}"
            m_num = int(parts[1])
            m_name = ITALIAN_MONTHS.get(m_num, parts[1])
            months_set.add((m_key, f"{m_name} {parts[0]}"))

    rows = []
    dow_map = {0: "lun", 1: "mar", 2: "mer", 3: "gio", 4: "ven", 5: "sab", 6: "dom"}

    for d in distinct_dates:
        info = sessions_by_date[d]
        parts = d.split("-")
        disp_date = f"{parts[2]}/{parts[1]}/{parts[0]}" if len(parts) == 3 else d

        # Orario contrattuale per la data specifica (rispetta inizio e fine validita di ogni contratto)
        ct_sched = get_employee_contract_schedule_for_date(employee_id, d)
        has_contract = ct_sched["has_contract"]
        contract_titles = ct_sched["contract_titles"]
        schedule_text = ct_sched["schedule_text"]
        lunch_text = ct_sched["lunch_text"]
        contract_hours = ct_sched["contract_hours"]
        office_minutes = ct_sched["office_minutes_set"]

        # Sessioni dei corsi presenti in questa giornata
        all_day_sessions = [s for clist in info["courses"].values() for s in clist]
        course_hours = sum(float(s["hours"]) for s in all_day_sessions)
        is_integrated = any(courses_dict.get(s["course_id"], {}).get("integrates_with_contract") == 1 for s in all_day_sessions)

        # Calcolo ore complessive lavorate tramite unione degli insiemi di minuti
        if has_contract and course_hours > 0 and is_integrated:
            course_minutes = set()
            for s in all_day_sessions:
                c_start = s.get("start_time")
                c_end = s.get("end_time")
                c_sm = _time_str_to_minutes(c_start)
                c_em = _time_str_to_minutes(c_end)
                if c_sm is not None and c_em is not None and c_em > c_sm:
                    course_minutes.update(range(c_sm, c_em))
                else:
                    shrs = float(s.get("hours", 0.0))
                    course_minutes.update(range(0, int(shrs * 60)))

            # Unione reale: se le fasce sono separate (es. 09-13 e 14-18) sommano 8h; se coincidenti contano 4h
            total_worked_minutes = office_minutes.union(course_minutes)
            total_worked_hours = round(len(total_worked_minutes) / 60.0, 2)
            integration_lbl = f"🔗 Integrato ({total_worked_hours:.1f}h)"
            badge_class = "badge-success"
        elif has_contract and course_hours > 0 and not is_integrated:
            # Corso e orario d'ufficio separati: somma delle ore
            total_worked_hours = round(contract_hours + course_hours, 2)
            integration_lbl = f"⚖️ Separato ({total_worked_hours:.1f}h)"
            badge_class = "badge-info"
        elif has_contract and course_hours == 0:
            total_worked_hours = contract_hours
            integration_lbl = f"🏢 Ufficio ({contract_hours:.1f}h)"
            badge_class = "badge-gray"
        elif not has_contract and course_hours > 0:
            total_worked_hours = course_hours
            integration_lbl = f"🎓 Corso ({course_hours:.1f}h)"
            badge_class = "badge-purple"
        else:
            total_worked_hours = 0.0
            integration_lbl = "0.0h"
            badge_class = "badge-gray"

        # Verifica presenze registrate in work_entries dal tutor
        cur.execute("SELECT id, hours FROM work_entries WHERE employee_id = ? AND date = ?", (employee_id, d))
        entries_found = cur.fetchall()
        has_entry = len(entries_found) > 0
        registered_hours = sum(float(e["hours"]) for e in entries_found) if has_entry else 0.0

        rows.append({
            "date": d,
            "day_of_week": info["day_of_week"],
            "display_date": disp_date,
            "is_today": d == today_str,
            "is_past": d <= today_str,
            "courses": info["courses"],
            "contract_info": {
                "has_contract": has_contract,
                "contract_title": contract_titles,
                "schedule_text": schedule_text,
                "lunch_text": lunch_text,
                "contract_hours": contract_hours,
                "course_hours": course_hours,
                "total_worked_hours": total_worked_hours,
                "is_integrated": is_integrated,
                "integration_lbl": integration_lbl,
                "badge_class": badge_class,
                "has_entry": has_entry,
                "registered_hours": registered_hours
            }
        })

    sorted_months = sorted(list(months_set), key=lambda x: x[0])
    available_months = [{"value": m[0], "label": m[1]} for m in sorted_months]
    available_docenti = sorted([doc for doc in docenti_set if doc])

    total_sessions = len(sessions)
    total_hours = sum(float(s["hours"]) for s in sessions)

    conn.close()
    return {
        "status": "ok",
        "courses": courses,
        "rows": rows,
        "total_dates": len(rows),
        "total_sessions": total_sessions,
        "total_hours": total_hours,
        "available_months": available_months,
        "available_docenti": available_docenti,
        "today": today_str
    }


def sync_tutor_course_calendar_entries(course_id: int, employee_id: int) -> Dict[str, Any]:
    """
    Sincronizza automaticamente tutte le sessioni passate del calendario (date <= oggi)
    nel registro presenze (work_entries) del tutor per questo corso, se non già presenti.
    """
    conn = get_db_connection()
    cur = conn.cursor()
    today_str = datetime.date.today().isoformat()

    cur.execute("""
        SELECT s.*, c.name AS course_name, c.code AS course_code
        FROM course_calendar_sessions s
        JOIN course_calendars cal ON cal.id = s.calendar_id
        JOIN courses c ON cal.course_id = c.id
        WHERE cal.course_id = ?
          AND s.date <= ?
          AND s.status != 'annullata'
        ORDER BY s.date ASC, s.start_time ASC
    """, (course_id, today_str))
    past_sessions = [dict(r) for r in cur.fetchall()]

    synced_count = 0
    total_synced_hours = 0.0

    for s in past_sessions:
        s_date = s["date"]
        # Controlla se esiste già una registrazione per questo impiegato, corso e data
        cur.execute("""
            SELECT id FROM work_entries
            WHERE employee_id = ? AND course_id = ? AND date = ?
        """, (employee_id, course_id, s_date))
        existing = cur.fetchone()

        if not existing:
            dt = datetime.date.fromisoformat(s_date)
            month_name = ITALIAN_MONTHS.get(dt.month, "")
            month_year = f"{month_name} {dt.year}"
            hrs = float(s["hours"])
            act_type = "Tutoraggio d'aula" if s.get("phase") == "aula" else "Stage / Tirocinio"
            docente_info = f" - Docente: {s['docente']}" if s.get("docente") else ""
            modulo_info = f" ({s['modulo']})" if s.get("modulo") else ""

            cur.execute("""
                INSERT INTO work_entries (
                    employee_id, date, day_of_week, month_year, hours, type,
                    causale, note, course_id, scheduled_start, scheduled_end,
                    actual_start, actual_end, scheduled_hours, actual_hours, activity_type
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                employee_id,
                s_date,
                s["day_of_week"],
                month_year,
                hrs,
                "ordinario",
                "Presenza corso da calendario",
                f"Lezione {s.get('phase', 'aula').upper()}{modulo_info}{docente_info}",
                course_id,
                s.get("start_time", "09:00"),
                s.get("end_time", "14:00"),
                s.get("start_time", "09:00"),
                s.get("end_time", "14:00"),
                hrs,
                hrs,
                act_type
            ))
            synced_count += 1
            total_synced_hours += hrs

    conn.commit()
    conn.close()
    return {
        "status": "ok",
        "synced_count": synced_count,
        "total_synced_hours": total_synced_hours
    }


# -------------------------------------------------------------
# MONTHLY COURSES BREAKDOWN (ORE CORSI NEL MESE & MONTE ORE)
# -------------------------------------------------------------

def get_monthly_courses_report(employee_id: int, month_year: Optional[str] = None) -> Dict[str, Any]:
    if not month_year:
        today = datetime.date.today()
        month_name = ITALIAN_MONTHS.get(today.month, "")
        month_year = f"{month_name} {today.year}"

    conn = get_db_connection()
    cur = conn.cursor()

    courses = list_courses(employee_id)

    cur.execute("""
    SELECT course_id,
           COALESCE(SUM(CASE WHEN actual_hours > 0 THEN actual_hours ELSE hours END), 0) AS month_hours,
           COALESCE(SUM(CASE WHEN type = 'maturata' THEN hours ELSE 0 END), 0) AS month_maturate,
           COALESCE(SUM(CASE WHEN type = 'utilizzata' THEN hours ELSE 0 END), 0) AS month_utilizzate
    FROM work_entries
    WHERE employee_id = ? AND month_year = ? AND course_id IS NOT NULL
    GROUP BY course_id
    """, (employee_id, month_year))

    month_course_stats = {r["course_id"]: dict(r) for r in cur.fetchall()}

    cur.execute("""
    SELECT COALESCE(SUM(CASE WHEN actual_hours > 0 THEN actual_hours ELSE hours END), 0) AS non_course_hours,
           COALESCE(SUM(CASE WHEN type = 'maturata' THEN hours ELSE 0 END), 0) AS non_course_maturate,
           COALESCE(SUM(CASE WHEN type = 'utilizzata' THEN hours ELSE 0 END), 0) AS non_course_utilizzate
    FROM work_entries
    WHERE employee_id = ? AND month_year = ? AND course_id IS NULL
    """, (employee_id, month_year))
    non_course_row = dict(cur.fetchone())
    conn.close()

    course_rows = []
    tot_month_hours = 0.0
    tot_month_maturate = 0.0
    tot_month_utilizzate = 0.0

    for c in courses:
        cid = c["id"]
        stats = month_course_stats.get(cid, {"month_hours": 0.0, "month_maturate": 0.0, "month_utilizzate": 0.0})
        m_hrs = float(stats["month_hours"])
        m_mat = float(stats["month_maturate"])
        m_util = float(stats["month_utilizzate"])

        tot_month_hours += m_hrs
        tot_month_maturate += m_mat
        tot_month_utilizzate += m_util

        course_rows.append({
            "id": c["id"],
            "code": c["code"],
            "name": c["name"],
            "color": c["color"],
            "total_allocated_hours": c["total_allocated_hours"],
            "month_hours": m_hrs,
            "total_hours_worked": c["hours_worked"],
            "hours_remaining": c["hours_remaining"],
            "progress_pct": c["progress_pct"],
            "month_maturate": m_mat,
            "month_utilizzate": m_util
        })

    nc_hrs = float(non_course_row.get("non_course_hours", 0.0))
    nc_mat = float(non_course_row.get("non_course_maturate", 0.0))
    nc_util = float(non_course_row.get("non_course_utilizzate", 0.0))
    tot_month_hours += nc_hrs
    tot_month_maturate += nc_mat
    tot_month_utilizzate += nc_util

    return {
        "month_year": month_year,
        "courses": course_rows,
        "non_course": {
            "name": "Altre Attività / Ufficio / Permessi",
            "month_hours": nc_hrs,
            "month_maturate": nc_mat,
            "month_utilizzate": nc_util
        },
        "totals": {
            "tot_month_hours": round(tot_month_hours, 2),
            "tot_month_maturate": round(tot_month_maturate, 2),
            "tot_month_utilizzate": round(tot_month_utilizzate, 2),
            "month_net_variance": round(tot_month_maturate - tot_month_utilizzate, 2)
        }
    }


# -------------------------------------------------------------
# FULL DASHBOARD DATA (CONSOLIDATED)
# -------------------------------------------------------------

def calculate_entries_effective_hours(entry_list: List[Dict[str, Any]]) -> float:
    """
    Calcola le ore effettive lavorate aggregando le presenze giorno per giorno
    e unendo gli intervalli temporali per registrazioni integrate nella stessa giornata,
    evitando doppie somme (es. sede 09-13 e corso integrato 09-13 contano 4h, non 8h!).
    """
    if not entry_list:
        return 0.0

    entries_by_date = {}
    for e in entry_list:
        d = e.get("date")
        if d:
            entries_by_date.setdefault(d, []).append(e)

    total_h = 0.0
    for d, d_entries in entries_by_date.items():
        if len(d_entries) == 1:
            e = d_entries[0]
            act = float(e.get("actual_hours") or 0.0)
            h = float(e.get("hours") or 0.0)
            total_h += act if act > 0 else h
        else:
            has_integrated = any(e.get("is_integrated") == 1 for e in d_entries)
            if has_integrated:
                day_mins = set()
                fallback_h = 0.0
                for e in d_entries:
                    s_str = e.get("actual_start") or e.get("scheduled_start") or e.get("course_start") or e.get("office_start")
                    e_str = e.get("actual_end") or e.get("scheduled_end") or e.get("course_end") or e.get("office_end")
                    sm = _time_str_to_minutes(s_str)
                    em = _time_str_to_minutes(e_str)
                    if sm is not None and em is not None and em > sm:
                        cur_set = set(range(sm, em))
                        l_s = _time_str_to_minutes(e.get("lunch_break_start"))
                        l_e = _time_str_to_minutes(e.get("lunch_break_end"))
                        if l_s is not None and l_e is not None and l_e > l_s:
                            cur_set -= set(range(max(sm, l_s), min(em, l_e)))
                        day_mins.update(cur_set)
                    else:
                        act = float(e.get("actual_hours") or 0.0)
                        h = float(e.get("hours") or 0.0)
                        fallback_h += act if act > 0 else h

                if day_mins:
                    total_h += round(len(day_mins) / 60.0, 2) + fallback_h
                else:
                    total_h += fallback_h
            else:
                for e in d_entries:
                    act = float(e.get("actual_hours") or 0.0)
                    h = float(e.get("hours") or 0.0)
                    total_h += act if act > 0 else h

    return round(total_h, 2)


def get_dashboard_data(employee_id: int) -> Dict[str, Any]:
    emp = get_employee(employee_id)
    if not emp:
        return {}

    entries = get_all_chronological_entries(employee_id)
    courses = list_courses(employee_id)

    initial_bank = float(emp["initial_bank_hours"])
    std_day = float(emp["standard_day_hours"]) or 7.0
    short_day = float(emp["short_day_hours"]) or 4.0
    pt_week = float(emp["part_time_week_hours"]) or 18.0

    tot_utilizzate = sum(e["hours"] for e in entries if e["type"] == "utilizzata")
    tot_maturate = sum(e["hours"] for e in entries if e["type"] == "maturata")
    tot_ordinarie = sum(e["hours"] for e in entries if e["type"] in ("ordinaria", "ordinario", "presenza_corso"))
    tot_effettive_lavorate = calculate_entries_effective_hours(entries)

    ore_rimanenti = initial_bank - tot_utilizzate
    net_variance = tot_maturate - tot_utilizzate
    full_balance = initial_bank + tot_maturate - tot_utilizzate

    ferie_7h = round(ore_rimanenti / std_day, 2) if std_day > 0 else 0
    ferie_4h = round(ore_rimanenti / short_day, 2) if short_day > 0 else 0
    settimane_18h = round(ore_rimanenti / pt_week, 2) if pt_week > 0 else 0

    today_dt = datetime.date.today()
    current_my = f"{ITALIAN_MONTHS.get(today_dt.month, '').upper()} {today_dt.year}"

    months_order = [
        "FEBBRAIO 2026", "MARZO 2026", "APRILE 2026", "MAGGIO 2026",
        "GIUGNO 2026", "LUGLIO 2026", "AGOSTO 2026", "SETTEMBRE 2026",
        "OTTOBRE 2026", "NOVEMBRE 2026", "DICEMBRE 2026", "GENNAIO 2027",
        "FEBBRAIO 2027", "MARZO 2027", "APRILE 2027", "MAGGIO 2027"
    ]
    seen_months = list(dict.fromkeys(months_order + [e["month_year"] for e in entries if e["month_year"]]))

    monthly_stats = []
    running_remaining = initial_bank

    for my in seen_months:
        m_entries = [e for e in entries if e["month_year"] == my]
        m_utilizzate = sum(e["hours"] for e in m_entries if e["type"] == "utilizzata")
        m_maturate = sum(e["hours"] for e in m_entries if e["type"] == "maturata")
        m_lavorate = calculate_entries_effective_hours(m_entries)
        m_saldo = -m_utilizzate
        running_remaining -= m_utilizzate

        # Verifica temporale del mese: passati = Consolidato, corrente = In corso, futuri = Pianificato
        parts = my.split()
        m_num = None
        m_year = None
        if len(parts) == 2:
            for k, v in ITALIAN_MONTHS.items():
                if v.upper() == parts[0]:
                    m_num = k
                    break
            try:
                m_year = int(parts[1])
            except ValueError:
                pass

        if m_num and m_year:
            if (m_year, m_num) < (today_dt.year, today_dt.month):
                status = "Consolidato" if len(m_entries) > 0 else "Nessuna presenza"
            elif (m_year, m_num) == (today_dt.year, today_dt.month):
                status = "In corso"
            else:
                status = "Pianificato"
        else:
            if my == current_my:
                status = "In corso"
            elif len(m_entries) > 0:
                status = "Consolidato"
            else:
                status = "Pianificato"

        monthly_stats.append({
            "month_year": my,
            "ore_utilizzate": m_utilizzate,
            "ore_maturate": m_maturate,
            "ore_lavorate": m_lavorate,
            "saldo_mese": m_saldo,
            "ore_rimaste_progressive": running_remaining,
            "entries_count": len(m_entries),
            "status": status,
            "entries": m_entries
        })

    return {
        "employee": emp,
        "courses": courses,
        "summary": {
            "initial_bank_hours": initial_bank,
            "totale_ore_accreditate": initial_bank,
            "totale_ore_utilizzate": tot_utilizzate,
            "totale_ore_maturate": tot_maturate,
            "totale_ore_ordinarie": tot_ordinarie,
            "totale_ore_lavorate": tot_effettive_lavorate,
            "ore_rimanenti": ore_rimanenti,
            "saldo_pieno_con_straordinari": full_balance,
            "variazione_netta": net_variance,
            "ferie_7h": ferie_7h,
            "ferie_4h": ferie_4h,
            "settimane_18h": settimane_18h,
            "total_entries": len(entries),
            "active_courses_count": len([c for c in courses if c["status"] == "Attivo"])
        },
        "monthly_stats": monthly_stats
    }


# -------------------------------------------------------------
# COURSE CALENDARS (ADMIN) & DOCENTI CONFLICT DETECTION
# -------------------------------------------------------------

def _seed_course_calendars(conn: sqlite3.Connection, course1_id: int, course2_id: int, andrea_id: int, giorgio_id: int):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM course_calendars")
    if cur.fetchone()[0] > 0:
        return

    # Calendar 1: Avviso 6 Messina
    cur.execute("""
    INSERT INTO course_calendars (course_id, title, start_date, expected_end_date, stage_start_date, stage_end_date, stage_tutor_id, status, notes)
    VALUES (?, 'Calendario Ufficiale Avviso 6 ED 2274_1', '2026-10-15', '2027-02-28', '2027-01-11', '2027-02-28', ?, 'In Corso', 'Fase 1: Aula fino all''8 Gennaio; Fase 2: Stage in azienda con Tutor Giorgio.')
    """, (course1_id, giorgio_id))
    cal1_id = cur.lastrowid

    # Calendar 2: Avviso 1 Stage
    cur.execute("""
    INSERT INTO course_calendars (course_id, title, start_date, expected_end_date, stage_start_date, stage_end_date, stage_tutor_id, status, notes)
    VALUES (?, 'Calendario Didattico Avviso 1 Tecnico Web', '2026-11-02', '2027-03-31', '2027-02-01', '2027-03-31', ?, 'In Corso', 'Aula 120 ore + Stage 150 ore.')
    """, (course2_id, andrea_id))
    cal2_id = cur.lastrowid

    # Sample Aula Sessions for Calendar 1
    sample_aula = [
        (cal1_id, 'aula', '2026-11-03', 'Martedì', '08:30', '13:30', 5.0, 'Prof.ssa Maria Conti', 'Mod. 1 - Competenze Base e Normativa', None, 'confermata', 'Inizio modulo'),
        (cal1_id, 'aula', '2026-11-04', 'Mercoledì', '08:30', '13:30', 5.0, 'Ing. Roberto Ferri', 'Mod. 2 - Informatica e Web Design', None, 'confermata', 'Laboratorio informatico'),
        (cal1_id, 'aula', '2026-11-05', 'Giovedì', '08:30', '13:30', 5.0, 'Ing. Roberto Ferri', 'Mod. 2 - Informatica e Web Design', None, 'confermata', ''),
        (cal1_id, 'aula', '2026-11-06', 'Venerdì', '08:30', '13:30', 5.0, 'Dott.ssa Laura De Luca', 'Mod. 3 - Comunicazione Efficace', None, 'confermata', ''),
        (cal1_id, 'aula', '2026-11-10', 'Martedì', '08:30', '13:30', 5.0, 'Prof.ssa Maria Conti', 'Mod. 1 - Competenze Base e Normativa', None, 'confermata', ''),
        (cal1_id, 'aula', '2026-11-11', 'Mercoledì', '08:30', '13:30', 5.0, 'Ing. Roberto Ferri', 'Mod. 2 - Informatica e Web Design', None, 'rinviata', 'Docente influenzato - Rinviata al 17/11')
    ]
    for c_id, ph, dt, dow, st, et, hrs, doc, mod, tut, stat, nt in sample_aula:
        cur.execute("""
        INSERT INTO course_calendar_sessions (calendar_id, phase, date, day_of_week, start_time, end_time, hours, docente, modulo, tutor_id, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (c_id, ph, dt, dow, st, et, hrs, doc, mod, tut, stat, nt))

    # Sample Stage Sessions for Calendar 1 (NO DOCENTI, NO MODULI, WITH TUTOR GIORGIO!)
    sample_stage = [
        (cal1_id, 'stage', '2027-01-11', 'Lunedì', '09:00', '14:00', 5.0, '', '', giorgio_id, 'confermata', 'Avvio stage in azienda partner'),
        (cal1_id, 'stage', '2027-01-12', 'Martedì', '09:00', '14:00', 5.0, '', '', giorgio_id, 'confermata', 'Tutoraggio e monitoraggio presenze'),
        (cal1_id, 'stage', '2027-01-13', 'Mercoledì', '09:00', '14:00', 5.0, '', '', giorgio_id, 'confermata', 'Tutoraggio stage')
    ]
    for c_id, ph, dt, dow, st, et, hrs, doc, mod, tut, stat, nt in sample_stage:
        cur.execute("""
        INSERT INTO course_calendar_sessions (calendar_id, phase, date, day_of_week, start_time, end_time, hours, docente, modulo, tutor_id, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (c_id, ph, dt, dow, st, et, hrs, doc, mod, tut, stat, nt))

    # Maria Conti on 2026-11-10 at 10:00 - 14:00 on Course 2 (Overlaps with 08:30 - 13:30 on Course 1 to demonstrate overlap warning!)
    cur.execute("""
    INSERT INTO course_calendar_sessions (calendar_id, phase, date, day_of_week, start_time, end_time, hours, docente, modulo, tutor_id, status, notes)
    VALUES (?, 'aula', '2026-11-10', 'Martedì', '10:00', '14:00', 4.0, 'Prof.ssa Maria Conti', 'Mod. 1 - Introduzione al Corso', NULL, 'confermata', 'Sovrapposizione d''orario da risolvere prima della lezione!')
    """, (cal2_id,))

    conn.commit()

def list_course_calendars() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    SELECT cal.*, c.name AS course_name, c.code AS course_code, c.color AS course_color,
           e.name AS stage_tutor_name,
           (SELECT COUNT(*) FROM course_calendar_sessions WHERE calendar_id = cal.id) AS total_sessions,
           (SELECT COALESCE(SUM(hours), 0) FROM course_calendar_sessions WHERE calendar_id = cal.id AND phase = 'aula') AS total_aula_hours,
           (SELECT COALESCE(SUM(hours), 0) FROM course_calendar_sessions WHERE calendar_id = cal.id AND phase = 'stage') AS total_stage_hours
    FROM course_calendars cal
    JOIN courses c ON cal.course_id = c.id
    LEFT JOIN employees e ON cal.stage_tutor_id = e.id
    ORDER BY cal.start_date DESC, cal.id DESC
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    all_conflicts = get_all_schedule_conflicts()
    for r in rows:
        r["conflicts_count"] = sum(1 for c in all_conflicts if c["calendar_id"] == r["id"])
    return rows

def format_display_date(date_str: str) -> str:
    if not date_str:
        return ""
    try:
        parts = str(date_str).split("-")
        if len(parts) == 3:
            return f"{parts[2]}/{parts[1]}/{parts[0]}"
    except Exception:
        pass
    return str(date_str)

def get_course_calendar(calendar_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    SELECT cal.*, c.name AS course_name, c.code AS course_code, c.color AS course_color,
           e.name AS stage_tutor_name
    FROM course_calendars cal
    JOIN courses c ON cal.course_id = c.id
    LEFT JOIN employees e ON cal.stage_tutor_id = e.id
    WHERE cal.id = ?
    """, (calendar_id,))
    cal_row = cur.fetchone()
    if not cal_row:
        conn.close()
        return None

    calendar = dict(cal_row)

    cur.execute("""
    SELECT s.*, e.name AS tutor_name
    FROM course_calendar_sessions s
    LEFT JOIN employees e ON s.tutor_id = e.id
    WHERE s.calendar_id = ?
    ORDER BY s.date ASC, s.start_time ASC, s.id ASC
    """, (calendar_id,))
    sessions = [dict(r) for r in cur.fetchall()]
    conn.close()

    all_conflicts = get_all_schedule_conflicts()
    conflicts_by_session = {}
    for conf in all_conflicts:
        conflicts_by_session.setdefault(conf["session_id"], []).append(conf)

    for s in sessions:
        s["conflicts"] = conflicts_by_session.get(s["id"], [])
        s["has_conflict"] = len(s["conflicts"]) > 0
        s["is_module_test"] = bool(s.get("is_module_test", 0))
        s["module_test_name"] = f"Test Finale: {s['modulo']}" if s["is_module_test"] else ""

    active_sessions = [s for s in sessions if s.get("status") != "annullata"]
    cancelled_sessions = [s for s in sessions if s.get("status") == "annullata"]
    calendar["sessions"] = sessions
    calendar["aula_sessions"] = [s for s in active_sessions if s["phase"] == "aula"]
    calendar["stage_sessions"] = [s for s in active_sessions if s["phase"] == "stage"]
    calendar["cancelled_sessions"] = cancelled_sessions
    calendar["total_aula_hours"] = sum(s["hours"] for s in calendar["aula_sessions"])
    calendar["total_stage_hours"] = sum(s["hours"] for s in calendar["stage_sessions"])
    calendar["total_hours"] = calendar["total_aula_hours"] + calendar["total_stage_hours"]
    calendar["total_cancelled_hours"] = sum(s["hours"] for s in cancelled_sessions)
    calendar["conflicts_count"] = sum(1 for s in active_sessions if s["has_conflict"])
    calendar["module_tests"] = [
        {
            "modulo": s["modulo"],
            "docente": s["docente"],
            "session_id": s["id"],
            "date": s["date"],
            "display_date": format_display_date(s["date"]),
            "day_of_week": s["day_of_week"],
            "start_time": s["start_time"],
            "end_time": s["end_time"],
            "hours": s["hours"],
            "status": s["status"]
        }
        for s in calendar["aula_sessions"] if s.get("is_module_test")
    ]

    return calendar

def create_course_calendar(data: Dict[str, Any]) -> int:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    INSERT INTO course_calendars (course_id, title, start_date, expected_end_date, stage_start_date, stage_end_date, stage_tutor_id, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        int(data["course_id"]),
        data.get("title", "Calendario Corso").strip(),
        data.get("start_date"),
        data.get("expected_end_date"),
        data.get("stage_start_date") or None,
        data.get("stage_end_date") or None,
        int(data["stage_tutor_id"]) if data.get("stage_tutor_id") else None,
        data.get("status", "In Corso"),
        data.get("notes", "").strip()
    ))
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return new_id

def update_course_calendar(calendar_id: int, data: Dict[str, Any]) -> bool:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    UPDATE course_calendars
    SET course_id = ?, title = ?, start_date = ?, expected_end_date = ?,
        stage_start_date = ?, stage_end_date = ?, stage_tutor_id = ?, status = ?, notes = ?
    WHERE id = ?
    """, (
        int(data["course_id"]),
        data.get("title").strip(),
        data.get("start_date"),
        data.get("expected_end_date"),
        data.get("stage_start_date") or None,
        data.get("stage_end_date") or None,
        int(data["stage_tutor_id"]) if data.get("stage_tutor_id") else None,
        data.get("status", "In Corso"),
        data.get("notes", "").strip(),
        calendar_id
    ))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected

def delete_course_calendar(calendar_id: int) -> bool:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM course_calendar_sessions WHERE calendar_id = ?", (calendar_id,))
    cur.execute("DELETE FROM course_calendars WHERE id = ?", (calendar_id,))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected

def add_calendar_session(calendar_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
    phase = data.get("phase", "aula").lower()
    date_str = validate_iso_date(data.get("date"), "Data della sessione")
    dow, _ = format_date_metadata(date_str)
    start_time = validate_time_str(data.get("start_time", "08:30"), "Orario di inizio")
    end_time = validate_time_str(data.get("end_time", "13:30"), "Orario di fine")
    
    raw_h = data.get("hours")
    if raw_h is not None and str(raw_h).strip() != "" and float(raw_h) > 0:
        hours = validate_session_hours(raw_h, start_time, end_time)
    else:
        hours = validate_time_interval(start_time, end_time)

    docente = data.get("docente", "").strip() if phase == "aula" else ""
    modulo = data.get("modulo", "").strip() if phase == "aula" else ""
    tutor_id = int(data["tutor_id"]) if data.get("tutor_id") else None

    conflicts = []
    if phase == "aula" and docente:
        conflicts = check_docente_conflicts(docente, date_str, start_time, end_time)

    is_test = 1 if data.get("is_module_test") else 0
    test_notes = data.get("test_notes", "").strip()

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
        INSERT INTO course_calendar_sessions (
            calendar_id, phase, date, day_of_week, start_time, end_time, hours,
            docente, modulo, tutor_id, status, notes, is_module_test, test_notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confermata', ?, ?, ?)
        """, (
            calendar_id, phase, date_str, dow, start_time, end_time, hours,
            docente, modulo, tutor_id, data.get("notes", "").strip(),
            is_test, test_notes
        ))
        new_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    try:
        compute_and_update_module_tests(calendar_id)
    except Exception:
        pass

    return {
        "id": new_id,
        "conflicts": conflicts,
        "has_conflict": len(conflicts) > 0
    }

def update_calendar_session(session_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
    phase = data.get("phase", "aula").lower()
    date_str = validate_iso_date(data.get("date"), "Data della sessione")
    dow, _ = format_date_metadata(date_str)
    start_time = validate_time_str(data.get("start_time", "08:30"), "Orario di inizio")
    end_time = validate_time_str(data.get("end_time", "13:30"), "Orario di fine")
    
    raw_h = data.get("hours")
    if raw_h is not None and str(raw_h).strip() != "" and float(raw_h) > 0:
        hours = validate_session_hours(raw_h, start_time, end_time)
    else:
        hours = validate_time_interval(start_time, end_time)

    docente = data.get("docente", "").strip() if phase == "aula" else ""
    modulo = data.get("modulo", "").strip() if phase == "aula" else ""
    tutor_id = int(data["tutor_id"]) if data.get("tutor_id") else None

    conflicts = []
    if phase == "aula" and docente:
        conflicts = check_docente_conflicts(docente, date_str, start_time, end_time, exclude_session_id=session_id)

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT calendar_id FROM course_calendar_sessions WHERE id = ?", (session_id,))
        row = cur.fetchone()
        cal_id = row["calendar_id"] if row else None

        cur.execute("""
        UPDATE course_calendar_sessions
        SET phase = ?, date = ?, day_of_week = ?, start_time = ?, end_time = ?, hours = ?,
            docente = ?, modulo = ?, tutor_id = ?, notes = ?
        WHERE id = ?
        """, (
            phase, date_str, dow, start_time, end_time, hours,
            docente, modulo, tutor_id, data.get("notes", "").strip(),
            session_id
        ))
        if "is_module_test" in data:
            cur.execute("UPDATE course_calendar_sessions SET is_module_test = ? WHERE id = ?", (1 if data["is_module_test"] else 0, session_id))
        if "test_notes" in data:
            cur.execute("UPDATE course_calendar_sessions SET test_notes = ? WHERE id = ?", (data["test_notes"], session_id))

        conn.commit()
    finally:
        conn.close()

    if cal_id:
        try:
            compute_and_update_module_tests(cal_id)
        except Exception:
            pass

    return {
        "id": session_id,
        "conflicts": conflicts,
        "has_conflict": len(conflicts) > 0
    }

def get_calendar_session(session_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM course_calendar_sessions WHERE id = ?", (session_id,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_course_calendar_for_session(session_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
        SELECT cal.*, c.employee_id AS course_tutor_id, s.tutor_id AS session_tutor_id
        FROM course_calendar_sessions s
        JOIN course_calendars cal ON s.calendar_id = cal.id
        JOIN courses c ON cal.course_id = c.id
        WHERE s.id = ?
        """, (session_id,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_session_status(session_id: int, status: str, reschedule_data: Optional[Dict[str, Any]] = None) -> bool:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        reschedule_data = reschedule_data or {}
        resched_date = reschedule_data.get("rescheduled_to_date")
        if resched_date and str(resched_date).strip():
            resched_date = validate_iso_date(resched_date, "Data rinvio")
        else:
            resched_date = None

        resched_start = reschedule_data.get("rescheduled_to_start")
        resched_end = reschedule_data.get("rescheduled_to_end")
        new_hours = None
        if resched_start and resched_end and str(resched_start).strip() and str(resched_end).strip():
            resched_start = validate_time_str(resched_start, "Orario inizio rinvio")
            resched_end = validate_time_str(resched_end, "Orario fine rinvio")
            new_hours = validate_time_interval(resched_start, resched_end)
        else:
            resched_start = None
            resched_end = None

        reason = str(reschedule_data.get("reschedule_reason", "")).strip()

        if status in ("confermata", "svolta"):
            # When reverting back to confermata/svolta from rinviata:
            # Clear reschedule info and recalculate duration from original start_time and end_time
            cur.execute("SELECT start_time, end_time FROM course_calendar_sessions WHERE id = ?", (session_id,))
            s_row = cur.fetchone()
            orig_hours = 6.0
            if s_row and s_row["start_time"] and s_row["end_time"]:
                try:
                    orig_hours = validate_time_interval(s_row["start_time"], s_row["end_time"])
                except Exception:
                    orig_hours = 6.0
            cur.execute("""
            UPDATE course_calendar_sessions
            SET status = ?,
                rescheduled_to_date = NULL,
                rescheduled_to_start = NULL,
                rescheduled_to_end = NULL,
                reschedule_reason = '',
                hours = ?
            WHERE id = ?
            """, (status, orig_hours, session_id))
        elif new_hours is not None:
            cur.execute("""
            UPDATE course_calendar_sessions
            SET status = ?,
                rescheduled_to_date = ?,
                rescheduled_to_start = ?,
                rescheduled_to_end = ?,
                reschedule_reason = ?,
                hours = ?
            WHERE id = ?
            """, (status, resched_date, resched_start, resched_end, reason, new_hours, session_id))
        else:
            cur.execute("""
            UPDATE course_calendar_sessions
            SET status = ?,
                rescheduled_to_date = ?,
                rescheduled_to_start = ?,
                rescheduled_to_end = ?,
                reschedule_reason = ?
            WHERE id = ?
            """, (status, resched_date, resched_start, resched_end, reason, session_id))

        conn.commit()
        affected = cur.rowcount > 0

        cur.execute("SELECT calendar_id FROM course_calendar_sessions WHERE id = ?", (session_id,))
        row = cur.fetchone()
        cal_id = row["calendar_id"] if row else None
    finally:
        conn.close()

    if cal_id:
        try:
            compute_and_update_module_tests(cal_id)
        except Exception:
            pass

    return affected

def delete_calendar_session(session_id: int) -> bool:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT calendar_id FROM course_calendar_sessions WHERE id = ?", (session_id,))
    row = cur.fetchone()
    cal_id = row["calendar_id"] if row else None

    cur.execute("DELETE FROM course_calendar_sessions WHERE id = ?", (session_id,))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()

    if cal_id:
        try:
            compute_and_update_module_tests(cal_id)
        except Exception:
            pass

    return affected

def check_docente_conflicts(docente: str, date_str: str, start_time: str, end_time: str, exclude_session_id: Optional[int] = None) -> List[Dict[str, Any]]:
    if not docente or not docente.strip():
        return []
    norm_start = normalize_time(start_time)
    norm_end = normalize_time(end_time)

    with get_db() as conn:
        cur = conn.cursor()
        query = """
        SELECT s.*, cal.title AS calendar_title, c.name AS course_name, c.code AS course_code
        FROM course_calendar_sessions s
        JOIN course_calendars cal ON s.calendar_id = cal.id
        JOIN courses c ON cal.course_id = c.id
        WHERE LOWER(TRIM(s.docente)) = LOWER(TRIM(?))
          AND s.status NOT IN ('annullata')
          AND s.phase = 'aula'
          AND (
              (s.status != 'rinviata' AND s.date = ?)
              OR (s.status = 'rinviata' AND s.rescheduled_to_date = ?)
          )
        """
        params = [docente.strip(), date_str, date_str]
        if exclude_session_id:
            query += " AND s.id != ?"
            params.append(exclude_session_id)

        cur.execute(query, params)
        conflicts = []
        for r in cur.fetchall():
            s_dict = dict(r)
            if s_dict["status"] == "rinviata" and s_dict.get("rescheduled_to_start") and s_dict.get("rescheduled_to_end"):
                s_start = normalize_time(s_dict["rescheduled_to_start"])
                s_end = normalize_time(s_dict["rescheduled_to_end"])
            else:
                s_start = normalize_time(s_dict["start_time"])
                s_end = normalize_time(s_dict["end_time"])

            # Overlap check
            if s_start < norm_end and s_end > norm_start:
                is_total = (s_start == norm_start and s_end == norm_end)
                conf_start = max(s_start, norm_start)
                conf_end = min(s_end, norm_end)
                s_dict["conflict_type"] = "Totale" if is_total else "Parziale"
                s_dict["overlap_range"] = f"dalle {conf_start} alle {conf_end}"
                s_dict["warning_message"] = (
                    f"Sovrapposizione {s_dict['conflict_type'].lower()} ({s_dict['overlap_range']}): "
                    f"Il docente '{docente}' ha già lezione in '{s_dict['course_name']}' "
                    f"(Modulo: {s_dict['modulo'] or 'N/D'}) dalle {s_start} alle {s_end}."
                )
                conflicts.append(s_dict)
        return conflicts


def check_session_conflicts(calendar_id: Optional[int], docente: str, tutor_id: Optional[int], date_str: str, start_time: str, end_time: str, exclude_session_id: Optional[int] = None) -> List[Dict[str, Any]]:
    """Verifica sovrapposizioni sia per il docente che per l'orario contrattuale d'ufficio del tutor."""
    conflicts = []
    if docente and docente.strip():
        conflicts.extend(check_docente_conflicts(docente, date_str, start_time, end_time, exclude_session_id))

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        c_info = None
        if calendar_id:
            cur.execute("""
            SELECT c.id, c.name, c.employee_id, c.integrates_with_contract
            FROM course_calendars cal
            JOIN courses c ON cal.course_id = c.id
            WHERE cal.id = ?
            """, (calendar_id,))
            c_info = cur.fetchone()

        target_tutor_id = tutor_id or (c_info["employee_id"] if c_info else None)
        if target_tutor_id and c_info:
            is_integrated = int(c_info["integrates_with_contract"] or 0)
            if not is_integrated:
                emp = get_employee(target_tutor_id)
                if emp:
                    try:
                        dt = datetime.date.fromisoformat(date_str)
                        dow_code = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"][dt.weekday()]
                        office_days = [d.strip().lower() for d in (emp.get("contract_office_days") or "lun,mar,mer,gio,ven").split(",")]
                        if dow_code in office_days:
                            off_start = normalize_time(emp.get("contract_office_start") or "09:00")
                            off_end = normalize_time(emp.get("contract_office_end") or "13:00")
                            norm_start = normalize_time(start_time)
                            norm_end = normalize_time(end_time)
                            if norm_start < off_end and norm_end > off_start:
                                c_start = max(norm_start, off_start)
                                c_end = min(norm_end, off_end)
                                conflicts.append({
                                    "conflict_type": "Sovrapposizione Orario Ufficio",
                                    "overlap_range": f"dalle {c_start} alle {c_end}",
                                    "warning_message": (
                                        f"Sovrapposizione con orario d'ufficio: Il tutor '{emp['name']}' ha orario da contratto d'ufficio "
                                        f"({off_start} - {off_end}) e il corso '{c_info['name']}' non è integrato con le ore contrattuali. "
                                        f"Usa il pulsante 'Integra con ore contrattuali' sul corso se si svolge in orario d'ufficio."
                                    )
                                })
                    except Exception:
                        pass
    finally:
        conn.close()

    return conflicts


def get_all_schedule_conflicts() -> List[Dict[str, Any]]:
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
        SELECT s.id AS session_id, s.calendar_id, s.date, s.start_time, s.end_time,
               s.status, s.rescheduled_to_date, s.rescheduled_to_start, s.rescheduled_to_end,
               s.docente, s.modulo, s.tutor_id,
               c.name AS course_name, c.code AS course_code, c.employee_id AS course_tutor_id,
               c.integrates_with_contract,
               e.name AS tutor_name, e.contract_office_days, e.contract_office_start, e.contract_office_end
        FROM course_calendar_sessions s
        JOIN course_calendars cal ON s.calendar_id = cal.id
        JOIN courses c ON cal.course_id = c.id
        LEFT JOIN employees e ON COALESCE(s.tutor_id, c.employee_id) = e.id
        WHERE s.status NOT IN ('annullata')
        """)
        rows = [dict(r) for r in cur.fetchall()]

    sessions = []
    conflicts = []

    for r in rows:
        if r["status"] == "rinviata" and r.get("rescheduled_to_date"):
            eff_date = r["rescheduled_to_date"]
            eff_start = normalize_time(r.get("rescheduled_to_start") or r["start_time"])
            eff_end = normalize_time(r.get("rescheduled_to_end") or r["end_time"])
        else:
            eff_date = r["date"]
            eff_start = normalize_time(r["start_time"])
            eff_end = normalize_time(r["end_time"])

        r["eff_date"] = eff_date
        r["eff_start"] = eff_start
        r["eff_end"] = eff_end
        r["docente_norm"] = (r.get("docente") or "").strip().lower()
        if r["docente_norm"]:
            sessions.append(r)

        # Controllo sovrapposizione tutor per corsi NON integrati con l'ufficio
        if r.get("tutor_name") and not r.get("integrates_with_contract"):
            try:
                dt = datetime.date.fromisoformat(eff_date)
                dow_code = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"][dt.weekday()]
                off_days = [d.strip().lower() for d in (r.get("contract_office_days") or "lun,mar,mer,gio,ven").split(",")]
                if dow_code in off_days:
                    off_start = normalize_time(r.get("contract_office_start") or "09:00")
                    off_end = normalize_time(r.get("contract_office_end") or "13:00")
                    if eff_start < off_end and eff_end > off_start:
                        c_start = max(eff_start, off_start)
                        c_end = min(eff_end, off_end)
                        conflicts.append({
                            "session_id": r["session_id"],
                            "calendar_id": r["calendar_id"],
                            "date": eff_date,
                            "start_time": eff_start,
                            "end_time": eff_end,
                            "docente": r.get("docente") or "",
                            "modulo": r.get("modulo") or "",
                            "course_name": r["course_name"],
                            "course_code": r["course_code"],
                            "conflict_type": "Sovrapposizione Orario Ufficio",
                            "overlap_range": f"dalle {c_start} alle {c_end}",
                            "warning_message": (
                                f"Sovrapposizione orario d'ufficio: Il tutor '{r['tutor_name']}' ha orario da contratto d'ufficio "
                                f"({off_start} - {off_end}) e il corso '{r['course_name']}' non è integrato con le ore contrattuali."
                            )
                        })
            except Exception:
                pass

    seen_pairs = set()
    for i in range(len(sessions)):
        s1 = sessions[i]
        for j in range(i + 1, len(sessions)):
            s2 = sessions[j]
            if s1["session_id"] == s2["session_id"]:
                continue
            if s1["docente_norm"] != s2["docente_norm"]:
                continue
            if s1["eff_date"] != s2["eff_date"]:
                continue

            if s1["eff_start"] < s2["eff_end"] and s1["eff_end"] > s2["eff_start"]:
                pair_key = tuple(sorted([s1["session_id"], s2["session_id"]]))
                if pair_key not in seen_pairs:
                    seen_pairs.add(pair_key)
                    conf_start = max(s1["eff_start"], s2["eff_start"])
                    conf_end = min(s1["eff_end"], s2["eff_end"])
                    is_total = (s1["eff_start"] == s2["eff_start"] and s1["eff_end"] == s2["eff_end"])
                    c_type = "Totale" if is_total else "Parziale"
                    overlap_range = f"dalle {conf_start} alle {conf_end}"

                    item = {
                        "session_id": s1["session_id"],
                        "calendar_id": s1["calendar_id"],
                        "date": s1["eff_date"],
                        "start_time": s1["eff_start"],
                        "end_time": s1["eff_end"],
                        "docente": s1["docente"],
                        "modulo": s1["modulo"],
                        "course_name": s1["course_name"],
                        "course_code": s1["course_code"],
                        "conflicting_session_id": s2["session_id"],
                        "conflicting_calendar_id": s2["calendar_id"],
                        "conflicting_start": s2["eff_start"],
                        "conflicting_end": s2["eff_end"],
                        "conflicting_modulo": s2["modulo"],
                        "conflicting_course_name": s2["course_name"],
                        "conflict_type": c_type,
                        "overlap_range": overlap_range,
                        "warning_message": (
                            f"Sovrapposizione {c_type.lower()} ({overlap_range}): "
                            f"Il docente '{s1['docente']}' è programmato contemporaneamente in '{s1['course_name']}' e in '{s2['course_name']}' il {s1['eff_date']}."
                        )
                    }
                    conflicts.append(item)
    return conflicts

def list_all_docenti() -> List[str]:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    SELECT DISTINCT TRIM(docente) AS doc
    FROM course_calendar_sessions
    WHERE phase = 'aula' AND TRIM(docente) != ''
    ORDER BY doc ASC
    """)
    docenti = [r["doc"] for r in cur.fetchall()]
    conn.close()
    return docenti


# -------------------------------------------------------------
# DOCUMENTS & FILE MANAGEMENT (ADMIN & DIPENDENTI)
# -------------------------------------------------------------

def list_documents(employee_id: Optional[int] = None, course_id: Optional[int] = None, category: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()
    query = """
    SELECT d.*, e.name AS employee_name, c.name AS course_name, c.code AS course_code
    FROM documents d
    LEFT JOIN employees e ON d.employee_id = e.id
    LEFT JOIN courses c ON d.course_id = c.id
    WHERE 1=1
    """
    params = []
    if employee_id:
        query += " AND d.employee_id = ?"
        params.append(employee_id)
    if course_id:
        query += " AND d.course_id = ?"
        params.append(course_id)
    if category and category != "all":
        query += " AND d.category = ?"
        params.append(category)
    if search:
        query += " AND (d.title LIKE ? OR d.filename LIKE ? OR d.notes LIKE ? OR e.name LIKE ? OR c.name LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s, s, s])

    query += " ORDER BY d.id DESC"
    cur.execute(query, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def resolve_doc_path(stored_path: str) -> str:
    """Risolve in modo portabile il percorso del documento sul disco."""
    if not stored_path:
        return ""
    if os.path.isabs(stored_path):
        if os.path.exists(stored_path):
            return stored_path
        # Fallback cercandolo per nome file dentro la directory documenti corrente
        alt = os.path.join(DOCS_DIR, os.path.basename(stored_path))
        return alt
    return os.path.join(DOCS_DIR, stored_path)


def list_documents(employee_id: Optional[int] = None, course_id: Optional[int] = None, category: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()
    query = """
    SELECT d.*, e.name AS employee_name, c.name AS course_name, c.code AS course_code
    FROM documents d
    LEFT JOIN employees e ON d.employee_id = e.id
    LEFT JOIN courses c ON d.course_id = c.id
    WHERE 1=1
    """
    params = []
    if employee_id:
        query += " AND d.employee_id = ?"
        params.append(employee_id)
    if course_id:
        query += " AND d.course_id = ?"
        params.append(course_id)
    if category and category != "all":
        query += " AND d.category = ?"
        params.append(category)
    if search:
        query += " AND (d.title LIKE ? OR d.filename LIKE ? OR d.notes LIKE ? OR e.name LIKE ? OR c.name LIKE ?)"
        s = f"%{search}%"
        params.extend([s, s, s, s, s])

    query += " ORDER BY d.id DESC"
    cur.execute(query, params)
    rows = []
    for r in cur.fetchall():
        d = dict(r)
        d["stored_path"] = resolve_doc_path(d.get("stored_path", ""))
        rows.append(d)
    conn.close()
    return rows


def get_document(doc_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    SELECT d.*, e.name AS employee_name, c.name AS course_name, c.code AS course_code
    FROM documents d
    LEFT JOIN employees e ON d.employee_id = e.id
    LEFT JOIN courses c ON d.course_id = c.id
    WHERE d.id = ?
    """, (doc_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d["stored_path"] = resolve_doc_path(d.get("stored_path", ""))
    return d


def create_document(data: Dict[str, Any]) -> int:
    conn = get_db_connection()
    cur = conn.cursor()
    emp_id = int(data["employee_id"]) if data.get("employee_id") else None
    course_id = int(data["course_id"]) if data.get("course_id") else None

    raw_path = str(data.get("stored_path", "")).strip()
    if raw_path.startswith(DOCS_DIR):
        rel_path = os.path.relpath(raw_path, DOCS_DIR)
    elif os.path.isabs(raw_path):
        rel_path = os.path.basename(raw_path)
    else:
        rel_path = raw_path

    cur.execute("""
    INSERT INTO documents (employee_id, course_id, title, filename, stored_path, file_size, file_type, uploaded_by, category, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        emp_id,
        course_id,
        data.get("title", "Nuovo Documento").strip(),
        data.get("filename", "").strip(),
        rel_path,
        int(data.get("file_size", 0)),
        data.get("file_type", "").strip(),
        data.get("uploaded_by", "Admin").strip(),
        data.get("category", "Generale").strip(),
        data.get("notes", "").strip()
    ))
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return new_id


def delete_document(doc_id: int) -> bool:
    doc = get_document(doc_id)
    if not doc:
        return False
    try:
        if os.path.exists(doc["stored_path"]):
            os.remove(doc["stored_path"])
    except Exception as e:
        print("Errore rimozione file da disco:", e)

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected


# -------------------------------------------------------------
# ADMIN FIRST-ACCESS SETUP & DATABASE PURGE / RESET
# -------------------------------------------------------------

def setup_admin_profile(data: Dict[str, Any]) -> Dict[str, Any]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        # Security: setup_admin_profile can ONLY be executed if NO admin exists yet!
        cur.execute("SELECT id, name FROM employees WHERE role = 'admin' AND deleted_at IS NULL LIMIT 1")
        existing_admin = cur.fetchone()
        if existing_admin:
            raise ValueError(f"Configurazione iniziale non consentita: esiste già l'amministratore '{existing_admin['name']}'.")

        name = data.get("name", "").strip()
        if not name:
            raise ValueError("Il campo Nome e Cognome è obbligatorio.")
        
        email = data.get("email", "").strip()
        if not email:
            raise ValueError("L'indirizzo email è obbligatorio per l'accesso e la conferma.")
        
        password = data.get("password", "").strip()
        if not password:
            raise ValueError("La password di accesso è obbligatoria.")
        if len(password) < 6:
            raise ValueError("La password deve contenere almeno 6 caratteri.")
        
        # Role & is_tutor
        role_choice = data.get("role", "admin").strip().lower()
        role = "admin" if role_choice in ("admin", "admin_tutor") else "tutor"
        if role == "admin":
            is_tutor = 1 if data.get("is_tutor") in (True, 1, "1", "true", "True") else 0
        else:
            is_tutor = 1

        pw_hash, salt = hash_password(password)
        std_day = float(data.get("standard_day_hours", 7.0))
        short_day = float(data.get("short_day_hours", 4.0))
        pt_week = float(data.get("part_time_week_hours", 18.0))
        bank = float(data.get("initial_bank_hours", 0.0))
        notes = data.get("notes", "").strip()

        cur.execute("""
        INSERT INTO employees (name, email, role, is_tutor, password_hash, salt, initial_bank_hours, standard_day_hours, short_day_hours, part_time_week_hours, notes, is_active, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
        """, (name, email, role, is_tutor, pw_hash, salt, bank, std_day, short_day, pt_week, notes))
        admin_id = cur.lastrowid

        conn.commit()
        return get_employee(admin_id)
    finally:
        conn.close()


def clean_reset_database():
    """Wipes all mock data, work entries, courses, calendars, documents, and employees so the system is pristine."""
    init_db()
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM work_entries")
    cur.execute("DELETE FROM course_calendar_sessions")
    cur.execute("DELETE FROM course_calendars")
    cur.execute("DELETE FROM courses")
    cur.execute("DELETE FROM documents")
    cur.execute("DELETE FROM employees")
    conn.commit()
    conn.close()


def get_system_discrepancies() -> List[Dict[str, Any]]:
    """Audits the database for inconsistencies, duplicates, and orphaned records."""
    conn = get_db_connection()
    cur = conn.cursor()
    discrepancies = []

    # 1. Check duplicate course codes
    cur.execute("""
    SELECT code, COUNT(*) as cnt
    FROM courses
    WHERE code IS NOT NULL AND TRIM(code) != ''
    GROUP BY UPPER(TRIM(code))
    HAVING cnt > 1
    """)
    dup_codes = cur.fetchall()

    for row in dup_codes:
        code = row["code"]
        cur.execute("""
        SELECT c.*, 
               (SELECT COUNT(*) FROM course_calendars WHERE course_id = c.id) as calendars_count,
               (SELECT COUNT(*) FROM course_calendar_sessions s 
                JOIN course_calendars cc ON s.calendar_id = cc.id 
                WHERE cc.course_id = c.id) as sessions_count,
               (SELECT COUNT(*) FROM work_entries WHERE course_id = c.id) as work_entries_count
        FROM courses c
        WHERE UPPER(TRIM(c.code)) = UPPER(TRIM(?))
        ORDER BY c.id ASC
        """, (code,))
        matched_courses = [dict(c) for c in cur.fetchall()]

        discrepancies.append({
            "type": "duplicate_course_code",
            "severity": "warning",
            "title": f"Corsi duplicati con codice '{code}'",
            "description": f"Il sistema ha rilevato {len(matched_courses)} corsi diversi che condividono lo stesso codice '{code}'. Questo raddoppia il monte ore totale nel riepilogo.",
            "code": code,
            "courses": matched_courses
        })

    conn.close()
    return discrepancies


def resolve_course_discrepancy(action: str, primary_id: int, secondary_id: int, target_name: str) -> bool:
    """Merges two conflicting courses into one and cleans up duplicates."""
    conn = get_db_connection()
    cur = conn.cursor()

    if action == "merge_courses":
        cur.execute("SELECT * FROM courses WHERE id = ?", (primary_id,))
        primary = cur.fetchone()
        cur.execute("SELECT * FROM courses WHERE id = ?", (secondary_id,))
        secondary = cur.fetchone()

        if not primary or not secondary:
            conn.close()
            raise ValueError("Uno o entrambi i corsi specificati non esistono nel database.")

        primary = dict(primary)
        secondary = dict(secondary)

        # Transfer calendars from secondary to primary
        cur.execute("UPDATE course_calendars SET course_id = ? WHERE course_id = ?", (primary_id, secondary_id))

        # Transfer work entries from secondary to primary
        cur.execute("UPDATE work_entries SET course_id = ? WHERE course_id = ?", (primary_id, secondary_id))

        # Transfer documents from secondary to primary
        cur.execute("UPDATE documents SET course_id = ? WHERE course_id = ?", (primary_id, secondary_id))

        # Merge docenti_referente and notes
        docenti_primary = (primary.get("docente_referente") or "").strip()
        docenti_secondary = (secondary.get("docente_referente") or "").strip()
        docenti_final = docenti_primary or docenti_secondary
        if docenti_primary and docenti_secondary and docenti_primary != docenti_secondary:
            docenti_final = f"{docenti_primary}, {docenti_secondary}"

        notes_primary = (primary.get("notes") or "").strip()
        notes_secondary = (secondary.get("notes") or "").strip()
        notes_final = notes_primary or notes_secondary
        if notes_primary and notes_secondary and notes_primary != notes_secondary:
            notes_final = f"{notes_primary}\n{notes_secondary}"

        total_hours = max(float(primary.get("total_allocated_hours") or 0.0), float(secondary.get("total_allocated_hours") or 0.0))

        # Update primary with target name and merged metadata
        cur.execute("""
        UPDATE courses 
        SET name = ?, total_allocated_hours = ?, docente_referente = ?, notes = ?
        WHERE id = ?
        """, (target_name.strip(), total_hours, docenti_final, notes_final, primary_id))

        # Safely delete secondary course
        cur.execute("DELETE FROM courses WHERE id = ?", (secondary_id,))

        conn.commit()
        conn.close()
        return True

    conn.close()
    return False



# ==============================================================================
# COURSE ATTENDANCE IMPORT & VALIDATION ENGINE
# ==============================================================================

def get_course_sessions_for_matching(course_id: int) -> List[Dict[str, Any]]:
    """Returns all calendar sessions for a given course to reconcile attendance."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
    SELECT s.id, s.calendar_id, s.date, s.day_of_week, s.start_time, s.end_time,
           s.hours, s.modulo, s.docente, s.phase, s.status,
           c.name as course_name, c.code as course_code
    FROM course_calendar_sessions s
    JOIN course_calendars cal ON s.calendar_id = cal.id
    JOIN courses c ON cal.course_id = c.id
    WHERE c.id = ? AND s.status != 'annullata'
    ORDER BY s.date ASC, s.start_time ASC, s.id ASC
    """, (course_id,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def save_confirmed_attendance_entries(course_id: int, employee_id: int, entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Idempotently creates or updates work_entries for confirmed course attendance.
    Distinguishes morning and afternoon sessions on the same date using calendar_session_id
    and start_time to avoid overwriting distinct entries.
    """
    if not course_id or not employee_id:
        raise ValueError("Parametri corso o tutor mancanti.")

    conn = get_db_connection()
    try:
        cur = conn.cursor()

        cur.execute("SELECT id, name FROM courses WHERE id = ?", (course_id,))
        course_row = cur.fetchone()
        if not course_row:
            raise ValueError(f"Corso {course_id} non trovato.")

        cur.execute("SELECT id, name FROM employees WHERE id = ? AND deleted_at IS NULL", (employee_id,))
        emp_row = cur.fetchone()
        if not emp_row:
            raise ValueError(f"Tutor {employee_id} non trovato.")

        dow_names = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]
        saved_count = 0
        total_hours = 0.0

        for item in entries:
            if not item.get("selected", True):
                continue

            raw_date = str(item.get("date", "")).strip()
            if not raw_date:
                continue

            try:
                dt = datetime.datetime.strptime(raw_date[:10], "%Y-%m-%d")
                entry_date = dt.strftime("%Y-%m-%d")
                month_year = f"{ITALIAN_MONTHS.get(dt.month, '').upper()} {dt.year}"
                day_of_week = dow_names[dt.weekday()]
            except Exception:
                continue

            try:
                hours = float(item.get("hours", 0.0))
            except (ValueError, TypeError):
                continue
            if hours <= 0:
                continue

            start_time = str(item.get("start_time") or "09:00").strip()
            end_time = str(item.get("end_time") or "13:00").strip()
            modulo = str(item.get("modulo") or "Tutoraggio d'aula").strip()
            docente = str(item.get("docente") or "").strip()
            causale = f"Presenza Corso: {course_row['name']} - {modulo}"
            if docente:
                causale += f" (Docente: {docente})"

            note = str(item.get("note") or "Registrazione presenze da foglio corso").strip()
            activity_type = "Tutoraggio d'aula"

            raw_sid = item.get("calendar_session_id") or item.get("session_id") or item.get("matched_session_id")
            session_id = None
            if raw_sid:
                try:
                    session_id = int(raw_sid)
                except (ValueError, TypeError):
                    session_id = None

            # Controllo rigido monte ore singola giornata (non accettare cumulativi > 12h, rifiuta sostituzioni arbitrarie)
            if hours > 12.0:
                cur.execute("""
                SELECT s.id, s.hours, s.start_time, s.end_time, s.modulo, s.docente 
                FROM course_calendar_sessions s
                JOIN course_calendars c ON s.calendar_id = c.id
                WHERE c.course_id = ? AND s.date = ? AND s.hours <= 12.0
                LIMIT 1
                """, (course_id, entry_date))
                sess_info = cur.fetchone()
                if sess_info and sess_info["hours"] and 0 < sess_info["hours"] <= 12.0:
                    hours = float(sess_info["hours"])
                    start_time = sess_info["start_time"]
                    end_time = sess_info["end_time"]
                    session_id = session_id or sess_info["id"]
                else:
                    raise ValueError(f"Ore per la giornata {entry_date} non valide ({hours}h > 12.0h max giornaliere). Verifica la colonna del foglio ore.")

            # Ricerca presenza esistente: prioritario calendar_session_id, poi (data, corso, start_time)
            # Permette di registrare sessioni distinte (es. mattina e pomeriggio) nello stesso giorno senza sovrascriverle!
            existing = None
            if session_id:
                cur.execute("""
                SELECT id FROM work_entries 
                WHERE employee_id = ? AND course_id = ? AND calendar_session_id = ?
                """, (employee_id, course_id, session_id))
                existing = cur.fetchone()

            if not existing:
                cur.execute("""
                SELECT id FROM work_entries 
                WHERE employee_id = ? AND course_id = ? AND date = ? AND (actual_start = ? OR scheduled_start = ?)
                """, (employee_id, course_id, entry_date, start_time, start_time))
                existing = cur.fetchone()

            if existing:
                entry_id = existing["id"]
                cur.execute("""
                UPDATE work_entries
                SET hours = ?, actual_hours = ?, scheduled_hours = ?,
                    scheduled_start = ?, scheduled_end = ?, actual_start = ?, actual_end = ?,
                    causale = ?, note = ?, type = 'presenza_corso', activity_type = ?,
                    calendar_session_id = COALESCE(?, calendar_session_id)
                WHERE id = ?
                """, (hours, hours, hours, start_time, end_time, start_time, end_time, causale, note, activity_type, session_id, entry_id))
            else:
                cur.execute("""
                INSERT INTO work_entries (
                    employee_id, date, day_of_week, month_year, hours, type, causale, note,
                    course_id, scheduled_start, scheduled_end, actual_start, actual_end,
                    scheduled_hours, actual_hours, activity_type, calendar_session_id
                ) VALUES (?, ?, ?, ?, ?, 'presenza_corso', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    employee_id, entry_date, day_of_week, month_year, hours, causale, note,
                    course_id, start_time, end_time, start_time, end_time,
                    hours, hours, activity_type, session_id
                ))

            saved_count += 1
            total_hours += hours

        # Update course employee_id if empty
        cur.execute("SELECT employee_id FROM courses WHERE id = ?", (course_id,))
        c_data = cur.fetchone()
        if c_data and not c_data["employee_id"]:
            cur.execute("UPDATE courses SET employee_id = ? WHERE id = ?", (employee_id, course_id))

        conn.commit()

        return {
            "status": "ok",
            "saved_count": saved_count,
            "total_hours": round(total_hours, 1),
            "course_id": course_id,
            "employee_id": employee_id
        }
    finally:
        conn.close()


def atomic_replace_course_calendar(
    course_id: Optional[int],
    cal_data: Dict[str, Any],
    sessions_list: List[Dict[str, Any]],
    update_course_data: Optional[Dict[str, Any]] = None,
    new_course_data: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Atomically validates all sessions in memory and replaces/creates the course calendar
    within a single SQLite transaction. If ANY session has an invalid date, time, interval,
    or negative hours, throws an exception immediately with detailed error information
    WITHOUT touching or deleting the existing calendar.
    """
    if not sessions_list:
        raise ValueError("L'elenco delle lezioni è vuoto. Impossibile importare un calendario senza sessioni.")

    # Step 1: In-Memory Validation of ALL sessions before touching database
    validated_sessions = []
    for idx, s in enumerate(sessions_list):
        row_num = idx + 1
        raw_date = str(s.get("date", "")).strip()
        if not raw_date:
            raise ValueError(f"Riga {row_num}: data mancante.")
        try:
            valid_date = validate_iso_date(raw_date[:10])
        except ValueError as e:
            raise ValueError(f"Riga {row_num}: data '{raw_date}' non valida ({e}).")

        raw_start = str(s.get("start_time") or "08:00").strip()
        raw_end = str(s.get("end_time") or "14:00").strip()
        try:
            valid_start = validate_time_str(raw_start)
            valid_end = validate_time_str(raw_end)
            validate_time_interval(valid_start, valid_end)
        except ValueError as e:
            raise ValueError(f"Riga {row_num} (Data {valid_date}): orario non valido ({e}).")

        try:
            hours = float(s.get("hours", 0.0))
        except (ValueError, TypeError):
            raise ValueError(f"Riga {row_num} (Data {valid_date}): monte ore non numerico.")

        try:
            valid_hours = validate_session_hours(hours, valid_start, valid_end)
        except ValueError as e:
            raise ValueError(f"Riga {row_num} (Data {valid_date}): ore non valide ({e}).")

        phase = str(s.get("phase") or "aula").strip().lower()
        if phase not in ("aula", "stage"):
            phase = "aula"

        validated_sessions.append({
            "phase": phase,
            "date": valid_date,
            "start_time": valid_start,
            "end_time": valid_end,
            "hours": valid_hours,
            "docente": str(s.get("docente") or "").strip(),
            "modulo": str(s.get("modulo") or "").strip(),
            "notes": str(s.get("time_slot") or s.get("notes") or "").strip(),
            "tutor_id": s.get("tutor_id")
        })

    # Step 2: Atomic SQLite Transaction
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        with conn:
            # 2a. Determine target course
            target_id = course_id
            if target_id:
                cur.execute("SELECT id, name FROM courses WHERE id = ?", (target_id,))
                c_row = cur.fetchone()
                if not c_row:
                    raise ValueError(f"Corso {target_id} non trovato nel database.")
                if update_course_data:
                    # Update course metadata directly on current cursor
                    cur.execute("""
                    UPDATE courses
                    SET name = ?, code = ?, total_allocated_hours = ?, color = ?, status = ?,
                        notes = ?, employee_id = ?, docente_referente = ?
                    WHERE id = ?
                    """, (
                        update_course_data.get("name", c_row["name"]),
                        update_course_data.get("code", ""),
                        float(update_course_data.get("total_allocated_hours", 0.0)),
                        update_course_data.get("color", "#2563EB"),
                        update_course_data.get("status", "Attivo"),
                        update_course_data.get("notes", ""),
                        update_course_data.get("employee_id"),
                        update_course_data.get("docente_referente", ""),
                        target_id
                    ))

                # Delete existing sessions and calendars for this course atomically
                cur.execute("DELETE FROM course_calendar_sessions WHERE calendar_id IN (SELECT id FROM course_calendars WHERE course_id = ?)", (target_id,))
                cur.execute("DELETE FROM course_calendars WHERE course_id = ?", (target_id,))
            else:
                if not new_course_data:
                    raise ValueError("Dati nuovo corso mancanti.")
                emp_id = new_course_data.get("employee_id")
                cur.execute("""
                INSERT INTO courses (employee_id, name, code, total_allocated_hours, color, status, notes, docente_referente)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    emp_id,
                    new_course_data.get("name", "Nuovo Corso").strip(),
                    new_course_data.get("code", "").strip(),
                    float(new_course_data.get("total_allocated_hours", 100.0)),
                    new_course_data.get("color", "#2563EB"),
                    new_course_data.get("status", "Attivo"),
                    new_course_data.get("notes", "").strip(),
                    new_course_data.get("docente_referente", "").strip()
                ))
                target_id = cur.lastrowid

            # 2b. Insert Course Calendar
            cal_title = cal_data.get("title") or f"Calendario Corso {target_id}"
            cur.execute("""
            INSERT INTO course_calendars (
                course_id, title, start_date, expected_end_date,
                stage_start_date, stage_end_date, stage_tutor_id, status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                target_id,
                cal_title,
                cal_data.get("start_date"),
                cal_data.get("expected_end_date"),
                cal_data.get("stage_start_date"),
                cal_data.get("stage_end_date"),
                cal_data.get("stage_tutor_id"),
                cal_data.get("status", "In Corso"),
                cal_data.get("notes", "")
            ))
            cal_id = cur.lastrowid

            # 2c. Insert validated sessions
            for s in validated_sessions:
                cur.execute("""
                INSERT INTO course_calendar_sessions (
                    calendar_id, phase, date, start_time, end_time, hours,
                    docente, modulo, tutor_id, status, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confermata', ?)
                """, (
                    cal_id,
                    s["phase"],
                    s["date"],
                    s["start_time"],
                    s["end_time"],
                    s["hours"],
                    s["docente"],
                    s["modulo"],
                    s["tutor_id"],
                    s["notes"]
                ))

            # 2d. Compute and update module tests
            compute_and_update_module_tests(cal_id, cur=cur)

        return {
            "status": "ok",
            "course_id": target_id,
            "calendar_id": cal_id,
            "sessions_created": len(validated_sessions)
        }
    finally:
        conn.close()


# ==============================================================================
# PERSISTENT SESSION MANAGEMENT (SQLite-backed)
# ==============================================================================

def create_user_session(user_id: int, token: str, expires_at: float) -> None:
    """Saves an authenticated session token in SQLite."""
    now = time.time()
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("""
            INSERT OR REPLACE INTO user_sessions (token, user_id, created_at, expires_at, last_seen)
            VALUES (?, ?, ?, ?, ?)
            """, (token, user_id, now, expires_at, now))
    finally:
        conn.close()


def get_user_session(token: str) -> Optional[dict]:
    """Retrieves and validates a session token from SQLite."""
    if not token:
        return None
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("""
        SELECT s.token, s.user_id, s.created_at, s.expires_at, s.last_seen,
               e.name, e.email, e.role, e.is_tutor, e.deleted_at
        FROM user_sessions s
        JOIN employees e ON s.user_id = e.id
        WHERE s.token = ? AND e.deleted_at IS NULL
        """, (token,))
        row = cur.fetchone()
        if not row:
            return None
        sess = dict(row)
        exp = sess["expires_at"]
        exp_ts = None
        if isinstance(exp, (int, float)):
            exp_ts = float(exp)
        elif isinstance(exp, str):
            try:
                exp_ts = float(exp)
            except ValueError:
                try:
                    exp_ts = datetime.datetime.fromisoformat(exp).timestamp()
                except Exception:
                    exp_ts = 0.0
        if exp_ts is not None and time.time() > exp_ts:
            with conn:
                conn.execute("DELETE FROM user_sessions WHERE token = ?", (token,))
            return None
        return sess
    finally:
        conn.close()


def touch_user_session(token: str) -> None:
    """Updates last_seen for an active session."""
    if not token:
        return
    now = time.time()
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("UPDATE user_sessions SET last_seen = ? WHERE token = ?", (now, token))
    finally:
        conn.close()


def delete_user_session(token: str) -> None:
    """Revokes a session token from SQLite."""
    if not token:
        return
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("DELETE FROM user_sessions WHERE token = ?", (token,))
    finally:
        conn.close()


def cleanup_expired_sessions() -> int:
    """Purges expired sessions from SQLite."""
    now = time.time()
    conn = get_db_connection()
    try:
        with conn:
            cur = conn.execute("DELETE FROM user_sessions WHERE expires_at < ?", (now,))
            return cur.rowcount
    finally:
        conn.close()


# -------------------------------------------------------------
# EMPLOYEE / TUTOR CONTRACTS & DASHBOARD
# -------------------------------------------------------------

def calculate_contract_hours(work_days_str: str, start_time: str, end_time: str, lunch_start: Optional[str] = None, lunch_end: Optional[str] = None) -> Tuple[float, float]:
    """Calculates daily hours and weekly hours from work days and times."""
    days = [d.strip().lower() for d in (work_days_str or "").split(",") if d.strip()]
    num_days = len(days) if days else 5
    daily_h = 4.0
    try:
        sh, sm = map(int, start_time.split(":"))
        eh, em = map(int, end_time.split(":"))
        gross_minutes = (eh * 60 + em) - (sh * 60 + sm)
        if gross_minutes > 0:
            lunch_minutes = 0
            if lunch_start and lunch_end and ":" in lunch_start and ":" in lunch_end:
                lsh, lsm = map(int, lunch_start.split(":"))
                leh, lem = map(int, lunch_end.split(":"))
                lm = (leh * 60 + lem) - (lsh * 60 + lsm)
                if lm > 0:
                    lunch_minutes = lm
            net_minutes = max(0, gross_minutes - lunch_minutes)
            daily_h = round(net_minutes / 60.0, 2)
    except Exception:
        daily_h = 4.0
    weekly_h = round(daily_h * num_days, 2)
    return daily_h, weekly_h


def list_employee_contracts(employee_id: int) -> List[Dict[str, Any]]:
    """Lists all contracts for a specific employee / tutor."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT * FROM employee_contracts 
        WHERE employee_id = ? 
        ORDER BY 
            CASE status WHEN 'Attivo' THEN 1 WHEN 'In rinnovo' THEN 2 WHEN 'Rinnovato' THEN 3 ELSE 4 END,
            id DESC
    """, (employee_id,))
    rows = []
    for r in cur.fetchall():
        d = dict(r)
        has_fixed = bool(d.get("has_fixed_schedule", 1))
        d["has_fixed_schedule"] = has_fixed
        d["schedule_details"] = parse_contract_schedule_details(
            d.get("schedule_details"),
            d.get("work_days", "lun,mar,mer,gio,ven"),
            d.get("work_start_time", "09:00"),
            d.get("work_end_time", "13:00"),
            d.get("lunch_break_start", ""),
            d.get("lunch_break_end", "")
        )
        d["schedule_summary_text"] = format_contract_schedule_summary(d["schedule_details"], has_fixed)
        rows.append(d)
    conn.close()
    return rows


def get_employee_contract(contract_id: int) -> Optional[Dict[str, Any]]:
    """Retrieves a single contract by ID."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("SELECT * FROM employee_contracts WHERE id = ?", (contract_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    has_fixed = bool(d.get("has_fixed_schedule", 1))
    d["has_fixed_schedule"] = has_fixed
    d["schedule_details"] = parse_contract_schedule_details(
        d.get("schedule_details"),
        d.get("work_days", "lun,mar,mer,gio,ven"),
        d.get("work_start_time", "09:00"),
        d.get("work_end_time", "13:00"),
        d.get("lunch_break_start", ""),
        d.get("lunch_break_end", "")
    )
    d["schedule_summary_text"] = format_contract_schedule_summary(d["schedule_details"], has_fixed)
    return d


def create_employee_contract(employee_id: int, data: Dict[str, Any]) -> int:
    """Creates a new contract for an employee / tutor."""
    title = data.get("title", "Contratto Lavorativo").strip()
    contract_type = data.get("contract_type", "Indeterminato").strip()
    contract_regime = data.get("contract_regime", "").strip()
    start_date = data.get("start_date") or None
    end_date = data.get("end_date") or None
    status = data.get("status", "Attivo").strip()
    has_fixed = 1 if data.get("has_fixed_schedule", 1) in (1, True, "1", "true") else 0
    renewal_notes = data.get("renewal_notes", "").strip()
    notes = data.get("notes", "").strip()

    if has_fixed == 0:
        work_days = ""
        work_start_time = ""
        work_end_time = ""
        lunch_break_start = ""
        lunch_break_end = ""
        daily_h = 0.0
        weekly_h = 0.0
        sched_details_json = "{}"
    else:
        sched_map = parse_contract_schedule_details(
            data.get("schedule_details"),
            data.get("work_days", "lun,mar,mer,gio,ven"),
            data.get("work_start_time", "09:00"),
            data.get("work_end_time", "13:00"),
            data.get("lunch_break_start", ""),
            data.get("lunch_break_end", "")
        )
        active_codes = [c for c, d in sched_map.items() if d.get("active")]
        work_days = ",".join(active_codes)
        weekly_h = round(sum(d.get("hours", 0.0) for d in sched_map.values() if d.get("active")), 2)
        daily_h = round(weekly_h / max(1, len(active_codes)), 2) if active_codes else 0.0
        primary_day = next((d for d in sched_map.values() if d.get("active")), None)
        work_start_time = primary_day.get("start", "09:00") if primary_day else "09:00"
        work_end_time = primary_day.get("end", "13:00") if primary_day else "13:00"
        lunch_break_start = primary_day.get("lunch_start", "") if primary_day else ""
        lunch_break_end = primary_day.get("lunch_end", "") if primary_day else ""
        sched_details_json = json.dumps(sched_map, ensure_ascii=False)

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO employee_contracts (
            employee_id, title, contract_type, contract_regime,
            start_date, end_date, status, has_fixed_schedule, work_days,
            work_start_time, work_end_time, lunch_break_start, lunch_break_end,
            daily_hours, weekly_hours, schedule_details, renewal_notes, notes,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    """, (
        employee_id, title, contract_type, contract_regime,
        start_date, end_date, status, has_fixed, work_days,
        work_start_time, work_end_time, lunch_break_start, lunch_break_end,
        daily_h, weekly_h, sched_details_json, renewal_notes, notes
    ))
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return new_id


def update_employee_contract(contract_id: int, data: Dict[str, Any]) -> bool:
    """Updates an existing employee contract."""
    orig = get_employee_contract(contract_id)
    if not orig:
        return False

    title = data.get("title", orig["title"]).strip()
    contract_type = data.get("contract_type", orig["contract_type"]).strip()
    contract_regime = data.get("contract_regime", orig["contract_regime"]).strip()
    start_date = data.get("start_date", orig["start_date"])
    end_date = data.get("end_date", orig["end_date"])
    status = data.get("status", orig["status"]).strip()
    renewal_notes = data.get("renewal_notes", orig["renewal_notes"]).strip()
    notes = data.get("notes", orig["notes"]).strip()

    has_fixed = 1 if data.get("has_fixed_schedule", orig.get("has_fixed_schedule", 1)) in (1, True, "1", "true") else 0

    if has_fixed == 0:
        work_days = ""
        work_start_time = ""
        work_end_time = ""
        lunch_break_start = ""
        lunch_break_end = ""
        daily_h = 0.0
        weekly_h = 0.0
        sched_details_json = "{}"
    else:
        sched_map = parse_contract_schedule_details(
            data.get("schedule_details", orig.get("schedule_details")),
            data.get("work_days", orig.get("work_days", "lun,mar,mer,gio,ven")),
            data.get("work_start_time", orig.get("work_start_time", "09:00")),
            data.get("work_end_time", orig.get("work_end_time", "13:00")),
            data.get("lunch_break_start", orig.get("lunch_break_start", "")),
            data.get("lunch_break_end", orig.get("lunch_break_end", ""))
        )
        active_codes = [c for c, d in sched_map.items() if d.get("active")]
        work_days = ",".join(active_codes)
        weekly_h = round(sum(d.get("hours", 0.0) for d in sched_map.values() if d.get("active")), 2)
        daily_h = round(weekly_h / max(1, len(active_codes)), 2) if active_codes else 0.0
        primary_day = next((d for d in sched_map.values() if d.get("active")), None)
        work_start_time = primary_day.get("start", "09:00") if primary_day else "09:00"
        work_end_time = primary_day.get("end", "13:00") if primary_day else "13:00"
        lunch_break_start = primary_day.get("lunch_start", "") if primary_day else ""
        lunch_break_end = primary_day.get("lunch_end", "") if primary_day else ""
        sched_details_json = json.dumps(sched_map, ensure_ascii=False)

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("""
        UPDATE employee_contracts SET
            title = ?, contract_type = ?, contract_regime = ?,
            start_date = ?, end_date = ?, status = ?, has_fixed_schedule = ?, work_days = ?,
            work_start_time = ?, work_end_time = ?, lunch_break_start = ?, lunch_break_end = ?,
            daily_hours = ?, weekly_hours = ?, schedule_details = ?, renewal_notes = ?, notes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (
        title, contract_type, contract_regime,
        start_date, end_date, status, has_fixed, work_days,
        work_start_time, work_end_time, lunch_break_start, lunch_break_end,
        daily_h, weekly_h, sched_details_json, renewal_notes, notes,
        contract_id
    ))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected


def delete_employee_contract(contract_id: int) -> bool:
    """Deletes an employee contract."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("DELETE FROM employee_contracts WHERE id = ?", (contract_id,))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected


def assign_course_tutor(course_id: int, employee_id: Optional[int]) -> bool:
    """Binds (or unbinds) a course to an employee/tutor."""
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE courses SET employee_id = ? WHERE id = ?", (employee_id, course_id))
    conn.commit()
    affected = cur.rowcount > 0
    conn.close()
    return affected


def get_tutor_dashboard_data(employee_id: int) -> Dict[str, Any]:
    """Returns the comprehensive dashboard data for a tutor."""
    emp = get_employee(employee_id)
    if not emp:
        return {"status": "error", "message": "Tutor non trovato"}

    contracts = list_employee_contracts(employee_id)

    # All courses in system
    all_courses = list_courses(None)
    # Courses where this employee is tutor
    assigned_courses = [c for c in all_courses if c.get("employee_id") == employee_id]

    # For each assigned course, attach calendar and session details (including test info and tutor work entries)
    conn = get_db_connection()
    cur = conn.cursor()
    for c in assigned_courses:
        cur.execute("SELECT id FROM course_calendars WHERE course_id = ? ORDER BY id DESC LIMIT 1", (c["id"],))
        cal_row = cur.fetchone()
        cal = get_course_calendar(cal_row["id"]) if cal_row else None
        c["calendar"] = cal
        c["sessions"] = cal.get("sessions", []) if cal else []
        c["sessions_count"] = len(c["sessions"])

        # Map tutor work entries to sessions by date
        cur.execute("""
            SELECT id, date, hours, actual_start, actual_end, note
            FROM work_entries
            WHERE employee_id = ? AND course_id = ?
        """, (employee_id, c["id"]))
        work_entries_map = {row["date"]: dict(row) for row in cur.fetchall()}
        for s in c["sessions"]:
            w_found = work_entries_map.get(s["date"])
            s["has_tutor_entry"] = bool(w_found)
            s["tutor_entry_id"] = w_found["id"] if w_found else None
            s["tutor_entry_hours"] = w_found["hours"] if w_found else None
            s["tutor_entry_start"] = w_found["actual_start"] if w_found else None
            s["tutor_entry_end"] = w_found["actual_end"] if w_found else None
            s["tutor_entry_note"] = w_found["note"] if w_found else None
    conn.close()

    # Available courses that are unassigned or can be joined
    available_courses = [c for c in all_courses if not c.get("employee_id")]

    # Compute key performance metrics
    tot_contracted_weekly = sum(c.get("weekly_hours", 0) for c in contracts if c.get("status") == "Attivo")
    tot_course_hours = sum(c.get("total_allocated_hours", 0) for c in assigned_courses)
    tot_course_hours_worked = sum(c.get("hours_worked", 0) for c in assigned_courses)
    tot_course_hours_remaining = sum(c.get("hours_remaining", 0) for c in assigned_courses)

    return {
        "status": "ok",
        "tutor": emp,
        "contracts": contracts,
        "assigned_courses": assigned_courses,
        "available_courses": available_courses,
        "metrics": {
            "contracts_count": len(contracts),
            "active_contracts_count": len([c for c in contracts if c.get("status") == "Attivo"]),
            "tot_contracted_weekly_hours": tot_contracted_weekly,
            "assigned_courses_count": len(assigned_courses),
            "tot_course_allocated_hours": tot_course_hours,
            "tot_course_hours_worked": tot_course_hours_worked,
            "tot_course_hours_remaining": tot_course_hours_remaining,
            "available_courses_count": len(available_courses)
        }
    }


def seed_default_tutor_contracts_if_empty(employee_id: int) -> None:
    """Seeds default contracts for tutor if none exist."""
    existing = list_employee_contracts(employee_id)
    if len(existing) > 0:
        return

    emp = get_employee(employee_id)
    if not emp:
        return

    # Create Contract 1: Indeterminato con Ritenuta d'Acconto (18 ore: Lun-Gio 4h, Ven 2h)
    sched_18h = {
        "lun": {"code": "lun", "label": "Lunedì", "active": True, "start": "09:00", "end": "13:00", "lunch_start": "", "lunch_end": "", "hours": 4.0},
        "mar": {"code": "mar", "label": "Martedì", "active": True, "start": "09:00", "end": "13:00", "lunch_start": "", "lunch_end": "", "hours": 4.0},
        "mer": {"code": "mer", "label": "Mercoledì", "active": True, "start": "09:00", "end": "13:00", "lunch_start": "", "lunch_end": "", "hours": 4.0},
        "gio": {"code": "gio", "label": "Giovedì", "active": True, "start": "09:00", "end": "13:00", "lunch_start": "", "lunch_end": "", "hours": 4.0},
        "ven": {"code": "ven", "label": "Venerdì", "active": True, "start": "09:00", "end": "11:00", "lunch_start": "", "lunch_end": "", "hours": 2.0},
        "sab": {"code": "sab", "label": "Sabato", "active": False, "start": "09:00", "end": "13:00", "lunch_start": "", "lunch_end": "", "hours": 0.0}
    }
    create_employee_contract(employee_id, {
        "title": "Contratto a Tempo Indeterminato",
        "contract_type": "Indeterminato",
        "contract_regime": "Ritenuta d'Acconto (20%)",
        "has_fixed_schedule": 1,
        "schedule_details": sched_18h,
        "status": "Attivo",
        "notes": "Orario contrattuale d'ufficio (18.0 ore/settimana: Lun-Gio 4h, Ven 2h)"
    })

    # Create Contract 2: CO.CO.CO - Senza orari fissi da contratto (opzionale / a progetto)
    create_employee_contract(employee_id, {
        "title": "Contratto CO.CO.CO Formazione & Tutoraggio",
        "contract_type": "CO.CO.CO",
        "contract_regime": "Collaborazione Coordinata e Continuativa",
        "has_fixed_schedule": 0,
        "schedule_details": "{}",
        "status": "Attivo",
        "notes": "Collaborazione a progetto senza orario fisso predeterminato. Le ore vengono registrate a consuntivo per le attività formative svolte."
    })


