@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0capture-screenshots.ps1" %*
exit /b %ERRORLEVEL%
