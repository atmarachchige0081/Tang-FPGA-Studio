@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0release-check.ps1" %*
exit /b %ERRORLEVEL%
