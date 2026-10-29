@echo off
title Banca del Tempo e Straordinari Dipendenti
echo ==========================================================
echo   Avvio del Sito Web Locale Gestione Ore e Straordinari
echo ==========================================================
cd /d "%~dp0"
python avvia_sito.py
if errorlevel 1 (
    py avvia_sito.py
)
pause
