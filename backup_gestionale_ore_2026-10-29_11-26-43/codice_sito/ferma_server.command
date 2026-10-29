#!/bin/bash
# Script per arrestare il server Gestionale Ore (v2) in modo sicuro e verificato
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

PORT=${PORT:-58235}
PID_FILE="$HOME/.gestione_ore_v2/server.pid"

target_pid=""
if [ -f "$PID_FILE" ]; then
    target_pid=$(cat "$PID_FILE" 2>/dev/null)
fi

if [ -z "$target_pid" ] || ! ps -p "$target_pid" -o command= 2>/dev/null | grep -q "server.py"; then
    target_pid=$(lsof -ti :${PORT} 2>/dev/null)
fi

if [ -n "$target_pid" ]; then
    if ps -p "$target_pid" -o command= 2>/dev/null | grep -q -E "python|server\.py"; then
        echo "🛑 Arresto del server v2 (PID $target_pid, porta $PORT) in corso..."
        kill -15 $target_pid 2>/dev/null
        sleep 1.2
        if kill -0 $target_pid 2>/dev/null; then
            kill -9 $target_pid 2>/dev/null
        fi
        rm -f "$PID_FILE" 2>/dev/null
        echo "✅ Server v2 terminato con successo. Porta $PORT liberata."
    else
        echo "⚠️ Il processo sulla porta $PORT (PID: $target_pid) non è server.py. Terminazione annullata."
    fi
else
    echo "ℹ️ Nessun server attivo rilevato sulla porta $PORT."
fi
