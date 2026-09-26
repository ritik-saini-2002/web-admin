@echo off
REM =====================================================================
REM  Computer Inventory Collector - Launcher
REM  Just double-click this file. It runs CollectComputerData.ps1
REM  (which must be in the SAME folder) using PowerShell.
REM
REM  -ExecutionPolicy Bypass only applies to this one run and does NOT
REM  change any system-wide setting on the PC.
REM =====================================================================
setlocal
set "SCRIPT_DIR=%~dp0"

if not exist "%SCRIPT_DIR%CollectComputerData.ps1" (
    echo.
    echo ERROR: CollectComputerData.ps1 was not found in this folder.
    echo Make sure all files are kept together.
    echo.
    pause
    exit /b 1
)

if not exist "%SCRIPT_DIR%Config.ps1" (
    echo.
    echo ERROR: Config.ps1 was not found in this folder.
    echo Make sure all files are kept together.
    echo.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%CollectComputerData.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
    echo Done. You can close this window.
) else (
    echo The script reported a problem ^(see messages above^).
    echo Your entry has still been saved locally and will be sent
    echo automatically next time this file is run with network access.
)
echo.
pause
exit /b %EXITCODE%
