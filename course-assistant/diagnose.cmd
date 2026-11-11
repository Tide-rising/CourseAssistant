@echo off
setlocal
cd /d "%~dp0"
echo Collecting diagnosis info, please wait...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\diagnose.ps1"
echo.
echo A copy has been saved to diagnose-report.txt next to this file.
pause
