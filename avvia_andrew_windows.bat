@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Installa Node.js 22.16 o superiore: https://nodejs.org
  pause
  exit /b 1
)
if not exist data mkdir data
if not exist data\setup.key (
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" > data\setup.key
  echo Chiave iniziale amministratore:
  type data\setup.key
  echo.
)
set /p ANDREW_SETUP_KEY=<data\setup.key
start "" "http://127.0.0.1:58235"
node app.js
pause
