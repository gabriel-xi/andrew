#!/usr/bin/env python3
"""
Script per copiare i dati esistenti dalla Versione 1 (~/.gestione_ore/banca_ore.db)
alla Versione 2 (~/.gestione_ore_v2/banca_ore.db) in modo consistente e senza fermare la versione 1.
"""

import os
import shutil
import sqlite3

V1_DIR = os.path.expanduser("~/.gestione_ore")
V1_DB = os.path.join(V1_DIR, "banca_ore.db")
V1_DOCS = os.path.join(V1_DIR, "documents")

V2_DIR = os.path.expanduser("~/.gestione_ore_v2")
V2_DB = os.path.join(V2_DIR, "banca_ore.db")
V2_DOCS = os.path.join(V2_DIR, "documents")

def clone_data():
    if not os.path.exists(V1_DB):
        print(f"❌ Nessun database trovato in {V1_DB}")
        return

    os.makedirs(V2_DIR, exist_ok=True)
    os.makedirs(V2_DOCS, exist_ok=True)

    print(f"📦 Esecuzione snapshot online coerente di {V1_DB} verso {V2_DB}...")
    try:
        src = sqlite3.connect(V1_DB)
        dst = sqlite3.connect(V2_DB)
        with dst:
            src.backup(dst)
        dst.close()
        src.close()
        print("✅ Database clonato con successo in v2!")
    except Exception as e:
        print(f"Avviso snapshot: {e}. Copia diretta del file...")
        shutil.copy2(V1_DB, V2_DB)

    # Copia documenti se presenti
    if os.path.exists(V1_DOCS):
        print("📁 Copia documenti allegati...")
        for item in os.listdir(V1_DOCS):
            s_path = os.path.join(V1_DOCS, item)
            d_path = os.path.join(V2_DOCS, item)
            if os.path.isfile(s_path):
                shutil.copy2(s_path, d_path)
        print("✅ Documenti clonati in v2!")

    print("\n🎉 Operazione completata. La versione v2 ora ha una copia indipendente di tutti i dati della v1.")

if __name__ == "__main__":
    clone_data()

