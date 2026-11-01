@echo off
title Lubit - Make VPS Zip
cd /d "%~dp0.."

if not exist .git (
    echo [ERROR] Run this from the project folder that has .git
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-zip.ps1"
if errorlevel 1 (
    echo.
    echo [FAILED] See the message above.
    pause
    exit /b 1
)

echo.
pause
exit /b 0
