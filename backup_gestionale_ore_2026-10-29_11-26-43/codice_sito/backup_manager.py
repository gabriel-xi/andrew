#!/usr/bin/env python3
"""
Modulo per la creazione del Backup Completo del Gestionale Ore & Corsi.
Include:
- Codice sorgente e applicazione web (Python, HTML, JS, CSS, icone, script)
- Database SQLite (~/.gestione_ore/banca_ore.db) con snapshot consistente online
- Archivio documentale (~/.gestione_ore/documents/)
- Istruzioni per il ripristino
"""

import os
import sys
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.getenv("GESTIONE_ORE_DATA_DIR", os.path.expanduser("~/.gestione_ore_v2"))
DB_PATH = os.path.join(DB_DIR, "banca_ore.db")
DOCS_DIR = os.path.join(DB_DIR, "documents")
BACKUPS_DIR = os.path.join(PROJECT_DIR, "backups")


def create_full_backup(dest_dir: str = None) -> str:
    """
    Crea un archivio ZIP contenente l'intero sito, il database e i documenti.
    Ritorna il percorso assoluto del file ZIP creato.
    """
    if dest_dir is None:
        dest_dir = BACKUPS_DIR

    os.makedirs(dest_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    zip_filename = f"backup_gestionale_ore_{timestamp}.zip"
    zip_path = os.path.join(dest_dir, zip_filename)

    with tempfile.TemporaryDirectory() as temp_dir:
        # 1. Snapshot coerente del database SQLite
        db_snapshot_path = os.path.join(temp_dir, "banca_ore.db")
        if os.path.exists(DB_PATH):
            try:
                src_conn = sqlite3.connect(DB_PATH)
                dst_conn = sqlite3.connect(db_snapshot_path)
                with dst_conn:
                    src_conn.backup(dst_conn)
                dst_conn.close()
                src_conn.close()
            except Exception as e:
                print(f"[Backup] Avviso backup SQLite online: {e}. Copia file diretta.")
                shutil.copy2(DB_PATH, db_snapshot_path)
        else:
            # Crea DB vuoto inizializzato se non esiste
            dst_conn = sqlite3.connect(db_snapshot_path)
            dst_conn.close()

        # 2. File di istruzioni per il ripristino
        readme_content = f"""======================================================================
  BACKUP COMPLETO - CORSI IN VIA NAZARIO SAURO 38/40
======================================================================
Data di creazione: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}
File: {zip_filename}

Questo archivio contiene:
1. 'codice_sito/': Tutti i file del programma (server Python, frontend web,
   script di avvio e arresto rapido).
2. 'dati_database/banca_ore.db': Copia consistente del database SQLite
   contenente profili, corsi, calendari, sessioni e timbrature.
3. 'dati_database/documents/': Tutti i documenti e allegati caricati.

----------------------------------------------------------------------
COME RIPRISTINARE IL GESTIONALE (su questo o su un altro Mac/PC):
----------------------------------------------------------------------
PASSAGGIO 1 - Ripristino Dati:
- Crea (se non esiste) la cartella '.gestione_ore_v2' nella tua cartella utente (~/.gestione_ore_v2)
- Copia il file 'dati_database/banca_ore.db' in '~/.gestione_ore_v2/banca_ore.db'
- Copia l'intera cartella 'dati_database/documents' in '~/.gestione_ore_v2/documents'

PASSAGGIO 2 - Esecuzione:
- Estrai la cartella 'codice_sito' dove preferisci (es. Documenti o Desktop)
- Fai doppio click su 'avvia_server.command' (su Mac) oppure esegui:
    python3 server.py
- Apri il browser all'indirizzo: http://localhost:58235
======================================================================
"""
        readme_path = os.path.join(temp_dir, "ISTRUZIONI_RIPRISTINO.txt")
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(readme_content)

        # 3. Assemblaggio Archivio ZIP
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zipf:
            # Aggiungi Istruzioni alla radice del file ZIP
            zipf.write(readme_path, "ISTRUZIONI_RIPRISTINO.txt")

            # Aggiungi Database
            zipf.write(db_snapshot_path, "dati_database/banca_ore.db")

            # Aggiungi Cartella Documenti
            if os.path.exists(DOCS_DIR):
                for root, _, files in os.walk(DOCS_DIR):
                    for file in files:
                        if file.startswith("."):
                            continue
                        fpath = os.path.join(root, file)
                        rel_path = os.path.relpath(fpath, DOCS_DIR)
                        zipf.write(fpath, os.path.join("dati_database/documents", rel_path))

            # Aggiungi Codice Sorgente e Applicazione
            ignore_dirs = {"__pycache__", ".git", "backups"}
            ignore_exts = {".pyc", ".DS_Store"}

            for root, dirs, files in os.walk(PROJECT_DIR):
                # Filtra cartelle da ignorare
                dirs[:] = [d for d in dirs if d not in ignore_dirs]

                for file in files:
                    if file.startswith(".") and file != ".env":
                        continue
                    _, ext = os.path.splitext(file)
                    if ext in ignore_exts:
                        continue
                    if file.endswith(".log") and file != "sent_emails.log":
                        continue

                    fpath = os.path.join(root, file)
                    rel_to_proj = os.path.relpath(fpath, PROJECT_DIR)
                    zipf.write(fpath, os.path.join("codice_sito", rel_to_proj))

    return zip_path


if __name__ == "__main__":
    print("Creazione backup completo del gestionale in corso...")
    zip_created = create_full_backup()
    size_mb = os.path.getsize(zip_created) / (1024 * 1024)
    print("=" * 60)
    print("✅ BACKUP COMPLETO CREATO CON SUCCESSO!")
    print(f"📁 Percorso file: {zip_created}")
    print(f"📦 Dimensione:    {size_mb:.2f} MB")
    print("=" * 60)
