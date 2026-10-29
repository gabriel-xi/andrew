#!/usr/bin/env python3
"""
Avvio del Sito Web Locale per la Gestione Ore e Straordinari Dipendenti.
Apre automaticamente il browser predefinito e gestisce il server web locale.
Supporta l'accesso sia dal Mac locale che da tutti i dispositivi dei colleghi sulla stessa rete.
"""

import sys
import os
import webbrowser
import threading
import time
import socket

# Assicuriamo che il percorso corrente sia nella sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

import database
import server

PORT = int(os.environ.get("PORT", 58235))
LOCAL_URL = f"http://localhost:{PORT}"


def get_local_ip():
    """Rileva l'indirizzo IP locale del computer sulla rete Wi-Fi o LAN."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def is_port_in_use(port: int) -> bool:
    """Verifica se la porta specificata è già occupata da un server attivo."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def open_browser():
    time.sleep(0.5)
    print(f"Apertura del browser su {LOCAL_URL} ...")
    webbrowser.open(LOCAL_URL)


def main():
    local_ip = get_local_ip()
    network_url = f"http://{local_ip}:{PORT}"

    print("=" * 70)
    print("  ⏱️  SITO WEB: BANCA DEL TEMPO & GESTIONE CORSI DIPENDENTI")
    print("=" * 70)

    # Controlla se il server è già in esecuzione (es. come servizio macOS di background)
    if is_port_in_use(PORT):
        print("✅ Il server è già ATTIVO e perfettamente funzionante in background!")
        print("\n🌐 INDIRIZZI DI ACCESSO AL SITO:")
        print(f"  👉 Per te (su questo Mac):            {LOCAL_URL}")
        print(f"  👥 Per i tuoi colleghi (stessa rete):  {network_url}")
        print("\n🚀 Apertura automatica del browser in corso...")
        open_browser()
        print("=" * 70)
        return

    print("• Inizializzazione database locale...")
    database.init_db()

    print("\n🌐 INDIRIZZI DI ACCESSO AL SITO:")
    print(f"  👉 Per te (su questo computer):      {LOCAL_URL}")
    print(f"  👥 Per i tuoi colleghi (stessa rete): {network_url}")
    print("\n• Premi CTRL+C nel terminale per arrestare il server in qualsiasi momento.\n")

    # Avvia thread per aprire il browser automaticamente
    threading.Thread(target=open_browser, daemon=True).start()

    # Avvia il server web Bottle in ascolto su 0.0.0.0 (accessibile anche dalla rete locale)
    try:
        server.start_server(host="0.0.0.0", port=PORT, quiet=True)
    except KeyboardInterrupt:
        print("\nServer arrestato con successo. Arrivederci!")
    except OSError as e:
        if getattr(e, "errno", None) == 48 or "Address already in use" in str(e):
            print(f"\n✅ Il server è già ATTIVO in background sulla porta {PORT}.")
            print(f"👉 Apertura automatica su {LOCAL_URL} ...")
            open_browser()
        else:
            raise


if __name__ == "__main__":
    main()
