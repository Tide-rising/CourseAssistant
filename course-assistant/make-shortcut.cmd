@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1"
echo.
echo Done. A shortcut named "Course Assistant" should now be on your desktop.
pause
