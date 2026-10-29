#!/bin/bash
# Script con doppio click per creare un backup completo del gestionale
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo "    Creazione Backup Completo Gestionale Ore & Corsi"
echo "=========================================================="
echo ""

python3 backup_manager.py

echo ""
echo "Cartella dei backup: $DIR/backups"
echo "Apertura della cartella in Finder..."
open "$DIR/backups"
echo ""
echo "Premi INVIO per chiudere questa finestra..."
read
