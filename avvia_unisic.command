#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Installa Node.js 22.16 o successivo: https://nodejs.org"
  read -k 1 "key?Premi un tasto per chiudere..."
  exit 1
fi
mkdir -p data
chmod 700 data
if [[ ! -f data/setup.key ]]; then
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" > data/setup.key
  chmod 600 data/setup.key
  echo "Chiave iniziale amministratore (conservala in modo sicuro):"
  cat data/setup.key
  echo ""
fi
export UNISIC_SETUP_KEY="$(cat data/setup.key)"
(sleep 2; open "http://127.0.0.1:58235") &
node app.js
