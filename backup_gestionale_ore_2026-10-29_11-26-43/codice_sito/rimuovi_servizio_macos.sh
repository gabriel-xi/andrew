#!/bin/bash
# Disinstalla il servizio macOS di background
PLIST_PATH="$HOME/Library/LaunchAgents/com.gestioneore.server.plist"

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null
  rm -f "$PLIST_PATH"
  echo "✅ Servizio macOS rimosso con successo."
else
  echo "ℹ️ Il file di servizio com.gestioneore.server.plist non era presente."
fi

# Ferma eventuale processo ancora attivo
PID=$(lsof -ti:58234)
if [ ! -z "$PID" ]; then
  kill -9 $PID
  echo "✅ Processo sulla porta 58234 arrestato."
fi
