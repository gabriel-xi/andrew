#!/bin/bash
cd "$(dirname "$0")"
echo "Avvio Sito Web Gestione Ore..."
if [ -f "/usr/local/bin/python3.12" ]; then
    /usr/local/bin/python3.12 avvia_sito.py
elif which python3 >/dev/null 2>&1; then
    python3 avvia_sito.py
else
    echo "Python 3 non trovato nel sistema."
    read -p "Premi INVIO per uscire..."
fi
