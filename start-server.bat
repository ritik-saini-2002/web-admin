@echo off
:: IT Connect Web Admin - Background Server Launcher
:: Serves the dist folder and /pcproxy route on port 5008
:: Auto-hides console and runs in background

:: Check if this script is already running hidden
if "%HIDDEN%"=="1" goto :START_SERVER

:: Re-launch this script hidden using VBScript
set "HIDDEN=1"
set "VBS=%TEMP%\launch_hidden_%RANDOM%.vbs"
echo CreateObject("WScript.Shell").Run """%~f0""", 0, False > "%VBS%"
wscript //nologo "%VBS%"
del "%VBS%" 2>nul
exit /b

:START_SERVER
cd /d "%~dp0"

:: Kill any existing server on port 5008
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5008 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Check if Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found. Please install Node.js first.
    exit /b 1
)

:: Start the production server on all network interfaces
node production-server.mjs >nul 2>&1
