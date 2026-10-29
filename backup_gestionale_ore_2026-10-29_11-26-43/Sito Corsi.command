#!/bin/bash

# ==============================================================================
# SITO CORSI - AVVIO & GESTIONE SERVER GESTIONALE (v2.0)
# ==============================================================================

# Risoluzione dinamica cartella progetto
if [ -d "$HOME/.gemini/antigravity/scratch/gestione_ore_v2" ]; then
    PROJECT_DIR="$HOME/.gemini/antigravity/scratch/gestione_ore_v2"
elif [ -d "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gestione_ore_v2" ]; then
    PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gestione_ore_v2"
else
    PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

PORT=58235
URL="http://localhost:${PORT}"
PID_FILE="$HOME/.gestione_ore_v2/server.pid"

# Titolo finestra Terminale macOS
echo -ne "\033]0;Corsi in Via Nazario Sauro 38/40 (Porta ${PORT})\007"

# Pulisci schermo e mostra intestazione
clear
cat << "EOF"
=================================================================
  🏫 CORSI IN VIA NAZARIO SAURO 38/40 (v2.0)
=================================================================
EOF
echo "📍 Progetto:   ${PROJECT_DIR}"
echo "🌐 Indirizzo:  ${URL}"
echo "-----------------------------------------------------------------"

cd "${PROJECT_DIR}" || {
    echo "❌ Errore: cartella non trovata: ${PROJECT_DIR}"
    echo "Premi un tasto per uscire..."
    read -n 1
    exit 1
}

# Funzione per arrestare in modo verificato e sicuro il server
stop_server() {
    local target_pid=""
    if [ -f "$PID_FILE" ]; then
        target_pid=$(cat "$PID_FILE" 2>/dev/null)
    fi

    if [ -z "$target_pid" ] || ! ps -p "$target_pid" -o command= 2>/dev/null | grep -q "server.py"; then
        target_pid=$(lsof -ti :${PORT} 2>/dev/null)
    fi

    if [ -n "$target_pid" ]; then
        if ps -p "$target_pid" -o command= 2>/dev/null | grep -q -E "python|server\.py"; then
            echo ""
            echo "🛑 Spegnimento del server in corso (PID: ${target_pid})..."
            kill -15 $target_pid 2>/dev/null
            sleep 1.2
            if kill -0 $target_pid 2>/dev/null; then
                kill -9 $target_pid 2>/dev/null
            fi
            rm -f "$PID_FILE" 2>/dev/null
            echo "✅ Server spento correttamente! Porta ${PORT} liberata."
        else
            echo "⚠️ Attenzione: il processo sulla porta (PID: $target_pid) non corrisponde a server.py. Terminazione annullata per sicurezza."
        fi
    else
        echo ""
        echo "ℹ️ Il server è già spento."
    fi
}

# Trap per intercettare CTRL+C e chiusura finestra
trap 'echo ""; stop_server; exit 0' INT TERM

# Controlla se il server è già in esecuzione e risponde su /api/health
EXISTING_PID=$(lsof -ti :${PORT} 2>/dev/null)
if [ -n "$EXISTING_PID" ]; then
    HEALTH_CHECK=$(curl -s -m 1 http://localhost:${PORT}/api/health 2>/dev/null)
    if echo "$HEALTH_CHECK" | grep -q "gestione_ore_v2"; then
        echo "✅ Il server è già attivo e operativo sulla porta ${PORT} (PID: ${EXISTING_PID})."
    else
        echo "⚠️ Porta ${PORT} occupata da processo ${EXISTING_PID}."
    fi
    echo ""
    echo "Scegli un'opzione:"
    echo "  [1] Apri il browser e mantieni il controllo per spegnerlo (Default)"
    echo "  [2] Riavvia il server da zero"
    echo "  [3] Spegni il server ed esci"
    echo ""
    read -t 10 -p "Digita [1, 2 o 3] e premi Invio (default 1 in 10s): " choice
    echo ""
    choice=${choice:-1}

    if [ "$choice" = "3" ]; then
        stop_server
        echo "Premi un tasto per chiudere..."
        read -n 1
        exit 0
    elif [ "$choice" = "2" ]; then
        stop_server
        sleep 1
    fi
fi

# Se non è in esecuzione, avvia il server
PID_CHECK=$(lsof -ti :${PORT} 2>/dev/null)
if [ -z "$PID_CHECK" ]; then
    echo "🚀 Avvio server in corso sulla porta ${PORT}..."
    PORT=${PORT} python3 server.py > /tmp/sito_corsi_v2.log 2>&1 &
    SERVER_PID=$!
    
    # Attendi con verifica HTTP reale su /api/health
    echo -n "⏳ Connessione al servizio"
    SERVER_READY=0
    for i in {1..15}; do
        sleep 0.4
        echo -n "."
        HEALTH_RES=$(curl -s -m 1 http://localhost:${PORT}/api/health 2>/dev/null)
        if echo "$HEALTH_RES" | grep -q "gestione_ore_v2"; then
            SERVER_READY=1
            break
        fi
    done
    echo ""
    if [ "$SERVER_READY" -eq 1 ]; then
        echo "✅ Server avviato e verificato con successo!"
    else
        echo "⚠️ Avviso: il server sta completando l'inizializzazione."
    fi
fi

# Apri il browser all'indirizzo del sito
echo ""
echo "================================================================="
echo "  ✅ IL SITO È ORA ONLINE E APERTO NEL TUO BROWSER!"
echo "  🌐 ${URL}"
echo "================================================================="
open "${URL}"

# Loop di controllo interattivo: opzioni 1, 2 e 3 sempre disponibili
while true; do
    echo ""
    echo "-----------------------------------------------------------------"
    echo "  ⚙️ GESTIONE E CONTROLLO SERVER (Porta ${PORT}):"
    echo "     [1] Riapri il sito nel browser (se l'hai chiuso)"
    echo "     [2] Riavvia il server da zero"
    echo "     [3] Spegni il server ed esci"
    echo "-----------------------------------------------------------------"
    echo "💡 Suggerimento: puoi anche premere direttamente [INVIO] per spegnere."
    echo ""
    read -p "👉 Scegli un'opzione [1, 2 o 3] oppure premi INVIO per spegnere: " user_choice

    if [ "$user_choice" = "1" ]; then
        echo "🌐 Riapertura del sito nel browser in corso..."
        open "${URL}"
    elif [ "$user_choice" = "2" ]; then
        echo ""
        echo "🔄 Riavvio del server in corso..."
        stop_server
        sleep 1
        PORT=${PORT} python3 server.py > /tmp/sito_corsi_v2.log 2>&1 &
        sleep 1.5
        echo "✅ Server riavviato e aggiornato con successo!"
        open "${URL}"
    elif [ "$user_choice" = "3" ] || [ -z "$user_choice" ] || [ "$user_choice" = "q" ] || [ "$user_choice" = "Q" ]; then
        stop_server
        break
    else
        echo "⚠️ Scelta non valida. Digita 1, 2 o 3."
    fi
done

echo ""
echo "================================================================="
echo "  ✨ Operazione completata. Arrivederci!"
echo "================================================================="
sleep 1

