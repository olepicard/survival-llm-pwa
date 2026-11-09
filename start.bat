@echo off
title Survival LLM - PWA Standalone
cd /d "%~dp0"

echo ========================================================
echo   Lancement de Survival LLM (Version PWA Standalone)
echo ========================================================
echo.

start "" "http://localhost:8000"
python server.py

pause
