#!/bin/bash
# Installa il server Gestionale Ore come Servizio macOS di background (avvio automatico)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PLIST_PATH="$HOME/Library/LaunchAgents/com.gestioneore.server.plist"

mkdir -p "$HOME/Library/LaunchAgents"

cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gestioneore.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which python3)</string>
        <string>$DIR/server.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/gestione_ore_server.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/gestione_ore_server_error.log</string>
</dict>
</plist>
EOF

# Ricarica il servizio con launchctl
launchctl unload "$PLIST_PATH" 2>/dev/null
launchctl load "$PLIST_PATH"

echo "✅ Servizio macOS installato e avviato con successo!"
echo "Il server ora si avvierà automaticamente ad ogni accensione/login del Mac in background."
echo "URL locale: http://localhost:58234"
echo "Log del server: /tmp/gestione_ore_server.log"
