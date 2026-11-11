@echo off
setlocal
cd /d "%~dp0"
rem Start in LAN mode: other devices on the same network can open http://<this-pc-ip>:6520/
set COURSE_ASSISTANT_HOST=0.0.0.0
wscript.exe "%~dp0scripts\launcher.vbs"
