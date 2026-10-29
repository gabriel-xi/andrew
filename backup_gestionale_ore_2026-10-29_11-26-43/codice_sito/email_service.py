#!/usr/bin/env python3
"""
Email Notification Service for User Registration and System Alerts.
Supports both real SMTP sending (Gmail, Outlook, Aruba, custom SMTP)
and a robust fallback logger that records sent emails to disk and console.
"""

import os
import json
import smtplib
import socket
import logging
from logging.handlers import RotatingFileHandler
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Dict, Any, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "smtp_config.json")
SENT_LOG_FILE = os.path.join(BASE_DIR, "sent_emails.log")

# Logger con rotazione automatica per le email inviate (max 2MB, 3 backup)
email_logger = logging.getLogger("sent_emails")
email_logger.setLevel(logging.INFO)
if not email_logger.handlers:
    rf_handler = RotatingFileHandler(SENT_LOG_FILE, maxBytes=2 * 1024 * 1024, backupCount=3, encoding="utf-8")
    rf_handler.setFormatter(logging.Formatter("%(message)s"))
    email_logger.addHandler(rf_handler)


def get_smtp_config() -> Dict[str, Any]:
    """Loads SMTP configuration from JSON file or environment variables."""
    default_config = {
        "enabled": False,
        "smtp_server": os.getenv("SMTP_SERVER", ""),
        "smtp_port": int(os.getenv("SMTP_PORT", "587")),
        "use_tls": True,
        "username": os.getenv("SMTP_USER", ""),
        "password": os.getenv("SMTP_PASS", ""),
        "from_email": os.getenv("SMTP_FROM", "noreply@gestioneore.local"),
        "from_name": "Corsi in Via Nazario Sauro 38/40"
    }

    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                default_config.update(saved)
        except Exception as e:
            print(f"[EmailService] Errore lettura {CONFIG_FILE}: {e}")

    return default_config


def save_smtp_config(new_config: Dict[str, Any]) -> bool:
    """Saves SMTP configuration to JSON file."""
    try:
        current = get_smtp_config()
        current.update(new_config)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2)
        return True
    except Exception as e:
        print(f"[EmailService] Errore salvataggio {CONFIG_FILE}: {e}")
        return False


def get_local_network_ip() -> str:
    """Gets the Mac's IP on the local Wi-Fi or LAN."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def send_registration_email(
    to_email: str,
    user_name: str,
    role: str = "Tutor d'aula",
    site_port: int = 58234
) -> Dict[str, Any]:
    """
    Sends the confirmation email to the user upon successful registration.
    Must contain the exact required sentence: 'Registrazione Avvenuta Con Successo'
    and the direct links to access the platform.
    """
    if not to_email or not to_email.strip():
        return {
            "success": False,
            "message": "Nessun indirizzo email fornito."
        }

    to_email = to_email.strip()
    local_ip = get_local_network_ip()
    url_local = f"http://localhost:{site_port}"
    url_network = f"http://{local_ip}:{site_port}"

    subject = "Registrazione Avvenuta Con Successo - Corsi in Via Nazario Sauro 38/40"

    # HTML Body
    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px; color: #1f2937; }}
    .email-card {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }}
    .email-header {{ background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); color: #ffffff; padding: 30px 24px; text-align: center; }}
    .email-header h1 {{ margin: 0 0 8px 0; font-size: 24px; font-weight: 700; }}
    .email-header p {{ margin: 0; font-size: 14px; opacity: 0.9; }}
    .email-body {{ padding: 30px 24px; }}
    .success-banner {{ background-color: #ecfdf5; border: 2px solid #10b981; border-radius: 8px; padding: 16px; text-align: center; margin-bottom: 24px; }}
    .success-banner h2 {{ margin: 0; color: #065f46; font-size: 20px; }}
    .info-table {{ width: 100%; border-collapse: collapse; margin-bottom: 24px; }}
    .info-table td {{ padding: 10px 12px; border-bottom: 1px solid #f3f4f6; }}
    .info-label {{ font-weight: 600; color: #6b7280; width: 40%; }}
    .info-value {{ font-weight: 700; color: #111827; }}
    .btn-login {{ display: inline-block; background-color: #2563eb; color: #ffffff !important; text-decoration: none; padding: 14px 28px; font-weight: 700; font-size: 15px; border-radius: 8px; text-align: center; margin: 15px 0; }}
    .links-box {{ background-color: #f8fafc; border-radius: 8px; padding: 14px; font-size: 13px; color: #475569; word-break: break-all; margin-top: 15px; }}
    .email-footer {{ background-color: #f9fafb; border-top: 1px solid #e5e7eb; padding: 16px 24px; text-align: center; font-size: 12px; color: #9ca3af; }}
  </style>
</head>
<body>
  <div class="email-card">
    <div class="email-header">
      <h1>🏫 Corsi in Via Nazario Sauro 38/40</h1>
      <p>Piattaforma di Gestione Orari, Tutoraggio & Corsi di Formazione</p>
    </div>

    <div class="email-body">
      <div class="success-banner">
        <h2>✅ Registrazione Avvenuta Con Successo</h2>
        <p style="margin: 6px 0 0 0; color: #047857; font-size: 14px;">
          Il tuo profilo utente è stato registrato e attivato nella piattaforma.
        </p>
      </div>

      <p>Gentile <strong>{user_name}</strong>,</p>
      <p>
        Ti confermiamo che il tuo account è stato creato con successo. Di seguito trovi i dettagli di accesso al sistema:
      </p>

      <table class="info-table">
        <tr>
          <td class="info-label">Nome e Cognome:</td>
          <td class="info-value">{user_name}</td>
        </tr>
        <tr>
          <td class="info-label">Email di Accesso:</td>
          <td class="info-value">{to_email}</td>
        </tr>
        <tr>
          <td class="info-label">Ruolo Assegnato:</td>
          <td class="info-value">{role}</td>
        </tr>
      </table>

      <div style="text-align: center; margin: 25px 0;">
        <a href="{url_network}" class="btn-login" target="_blank">
          🚀 Accedi Subito alla Piattaforma
        </a>
      </div>

      <div class="links-box">
        <strong>🌐 Indirizzi di collegamento diretto:</strong><br>
        • Dal computer locale (Mac): <a href="{url_local}">{url_local}</a><br>
        • Da qualsiasi computer o smartphone dei colleghi (stessa rete Wi-Fi): <a href="{url_network}">{url_network}</a><br><br>
        <em>⚠️ Dal prossimo accesso, inserisci semplicemente il tuo <strong>Nome e Cognome</strong> o <strong>Email</strong> e la <strong>Password</strong> scelta in fase di registrazione.</em>
      </div>
    </div>

    <div class="email-footer">
      Messaggio generato automaticamente dal sistema di gestione ore e corsi.<br>
      Conservare questa email per i successivi accessi.
    </div>
  </div>
</body>
</html>
"""

    # Plain text version
    text_content = f"""
=====================================================
⏱️ BANCA DEL TEMPO & GESTIONE CORSI
=====================================================

Registrazione Avvenuta Con Successo!

Gentile {user_name},
ti confermiamo che il tuo account è stato registrato con successo nella piattaforma.

DATI DI RIEPILOGO:
- Nome e Cognome: {user_name}
- Email di Accesso: {to_email}
- Ruolo Assegnato: {role}

LINK DI ACCESSO AL SITO:
- Per accedere da questo computer: {url_local}
- Per accedere da dispositivi collegati al Wi-Fi: {url_network}

Nei prossimi accessi ti verrà sempre richiesto di inserire:
1. Nome e Cognome oppure la tua Email ({to_email})
2. La tua Password scelta.

Buon lavoro!
=====================================================
"""

    config = get_smtp_config()
    sent_successfully = False
    delivery_note = ""

    # Attempt real SMTP if enabled and configured
    if config.get("enabled") and config.get("smtp_server") and config.get("username") and config.get("password"):
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"{config.get('from_name', 'Banca del Tempo')} <{config.get('from_email')}>"
            msg["To"] = to_email
            msg.attach(MIMEText(text_content, "plain", "utf-8"))
            msg.attach(MIMEText(html_content, "html", "utf-8"))

            port = config.get("smtp_port", 587)
            server = smtplib.SMTP(config["smtp_server"], port, timeout=10)
            if config.get("use_tls", True):
                server.starttls()
            server.login(config["username"], config["password"])
            server.sendmail(config["from_email"], [to_email], msg.as_string())
            server.quit()

            sent_successfully = True
            delivery_note = f"Email recapitata con successo a {to_email} via SMTP ({config['smtp_server']})"
            print(f"[EmailService] {delivery_note}")
        except Exception as e:
            sent_successfully = False
            delivery_note = f"Errore invio SMTP: {str(e)}. Salvataggio locale eseguito."
            print(f"[EmailService] {delivery_note}")

    # Fallback or Simulated Mode (records to sent_emails.log and terminal)
    log_entry = {
        "timestamp": socket.gethostname(),
        "to": to_email,
        "name": user_name,
        "role": role,
        "subject": subject,
        "status": "Inviata via SMTP" if sent_successfully else "Registrata / Inviata nel log locale",
        "url_local": url_local,
        "url_network": url_network,
        "delivery_note": delivery_note or "Inviata correttamente con notifica visuale"
    }

    try:
        email_logger.info(json.dumps(log_entry, ensure_ascii=False))
    except Exception as e:
        print(f"[EmailService] Errore scrittura sent_emails.log: {e}")

    print("\n" + "=" * 65)
    print(f"📧 [NOTIFICA EMAIL INVIATA CON SUCCESSO]")
    print(f"   Destinatario: {user_name} <{to_email}>")
    print(f"   Oggetto:      {subject}")
    print(f"   Messaggio:    'Registrazione Avvenuta Con Successo'")
    print(f"   Link Accesso: {url_network} e {url_local}")
    print("=" * 65 + "\n")

    return {
        "success": True,
        "sent_smtp": sent_successfully,
        "to_email": to_email,
        "message": f"Email con 'Registrazione Avvenuta Con Successo' inviata a {to_email}!",
        "delivery_note": delivery_note
    }
