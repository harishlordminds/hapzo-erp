@echo off
setlocal
cd /d "%~dp0"
node scripts\backup.js
if errorlevel 1 echo Backup could not be written. See the error above.
pause
