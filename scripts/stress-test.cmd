@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stress-test.ps1" %*
exit /b %ERRORLEVEL%
