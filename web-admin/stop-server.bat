@echo off
:: IT Connect Web Admin - Stop Background Server
:: Kills the server running on port 5008

echo Stopping server on port 5008...

set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5008 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo Killed process PID: %%a
    set "FOUND=1"
)

if "%FOUND%"=="0" (
    echo No server found running on port 5008.
) else (
    echo Server stopped successfully.
)

timeout /t 3 >nul
