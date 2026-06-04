@echo off
setlocal enabledelayedexpansion
title PC Command Agent v12 Manager

:: Auto-elevate to admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set AGENT_DIR=%~dp0
set AGENT_FILE=%AGENT_DIR%agent_v12.py
set LOG_FILE=%AGENT_DIR%agent_log.txt
set PROGRESS_FILE=%AGENT_DIR%agent_setup_progress.json
set CONFIG_FILE=%AGENT_DIR%agent_config.json
set STARTUP_ERR=%AGENT_DIR%startup_error.log

:: Detect Python
set PYTHON=
where python >nul 2>&1
if %errorlevel%==0 set PYTHON=python
if not defined PYTHON (
    where python3 >nul 2>&1
    if %errorlevel%==0 set PYTHON=python3
)

:MENU
cls
echo.
echo  ================================================
echo    PC Command Agent v12 Manager
echo    [1080p Video + Fixed Audio + Fast API]
echo  ================================================
echo.
if defined PYTHON (
    for /f "tokens=*" %%v in ('!PYTHON! --version 2^>^&1') do set PY_VER=%%v
    echo   Python : [FOUND] !PY_VER!
) else (
    echo   Python : [NOT FOUND] - Use option 0 to install
)
echo.
call :CHECK_DONE "libraries"  D1
call :CHECK_DONE "audio_lib"  D2
call :CHECK_DONE "ffmpeg"     D3
call :CHECK_DONE "firewall"   D4
call :CHECK_DONE "startup"    D5
call :CHECK_DONE "key_hash"   D6
echo   SETUP CHECKLIST
echo   ------------------------------------------------
echo    [%D1%]  1. Core Python Libraries Installed
echo    [%D2%]  2. Audio Library  (pyaudiowpatch / sounddevice)
echo    [%D3%]  3. ffmpeg in PATH  (192kbps MP3 audio)
echo    [%D4%]  4. Firewall Ports 5000 + 5001 Opened
echo    [%D5%]  5. Windows Auto-Start Scheduled
echo    [%D6%]  6. Secret / Master Keys Configured
echo   ------------------------------------------------
echo.
echo   MENU
echo   ------------------------------------------------
echo    0.  Install Python   (if not installed)
echo    1.  Install / Check  all required libraries
echo    1c. Check library status only  (no install)
echo    2.  Start agent
echo    3.  Stop agent
echo    4.  Restart agent
echo    5.  Check agent status  (ports + config)
echo    6.  View live log  (last 50 lines, live tail)
echo    7.  Change Secret Key  (PBKDF2 hashed)
echo    8.  Change Master Key  (PBKDF2 hashed)
echo    9.  Install as Windows auto-start
echo    10. Remove from Windows auto-start
echo    11. Open Firewall Ports 5000 + 5001
echo    12. Test video stream in browser
echo    13. Check ffmpeg (audio encoder)
echo    14. Mark a checklist step complete manually
echo    D.  DEBUG - Start in visible console (see crash reason)
echo    X.  Exit
echo   ------------------------------------------------
echo.
set /p CHOICE=   Enter choice: 

if /i "%CHOICE%"=="X"   exit /b
if    "%CHOICE%"=="0"   goto INSTALL_PYTHON
if    "%CHOICE%"=="1"   goto INSTALL_LIBS
if /i "%CHOICE%"=="1c"  goto CHECK_LIBS_ONLY
if    "%CHOICE%"=="2"   goto START
if    "%CHOICE%"=="3"   goto STOP
if    "%CHOICE%"=="4"   goto RESTART
if    "%CHOICE%"=="5"   goto STATUS
if    "%CHOICE%"=="6"   goto VIEWLOG
if    "%CHOICE%"=="7"   goto CHANGEKEY
if    "%CHOICE%"=="8"   goto CHANGEMASTERKEY
if    "%CHOICE%"=="9"   goto ADDSTARTUP
if    "%CHOICE%"=="10"  goto REMOVESTARTUP
if    "%CHOICE%"=="11"  goto FIREWALL
if    "%CHOICE%"=="12"  goto TEST_STREAM
if    "%CHOICE%"=="13"  goto CHECK_FFMPEG
if    "%CHOICE%"=="14"  goto MARK_STEP
if /i "%CHOICE%"=="D"   goto START_DEBUG
goto MENU

:: ============================================================
:INSTALL_PYTHON
:: ============================================================
cls
echo.
echo   --- Install Python ---
echo.
if defined PYTHON (
    echo   Python is already installed: !PY_VER!
    echo   No action needed.
    pause
    goto MENU
)
echo   Python was NOT found on this system.
echo.
echo   Choose install method:
echo    1. Open python.org download page in browser
echo    2. Install via winget  (Windows 10 1709+ / Win 11)
echo    3. Install via Chocolatey  (requires choco)
echo    4. Back
echo.
set /p PYCHOICE=   Enter choice: 
if "%PYCHOICE%"=="1" (
    start https://www.python.org/downloads/
    echo.
    echo   IMPORTANT: Check "Add Python to PATH" before clicking Install!
    pause
    goto MENU
)
if "%PYCHOICE%"=="2" (
    winget install --id Python.Python.3.12 -e --source winget
    echo.
    echo   Done. Close and reopen this BAT so Python is detected.
    pause
    goto MENU
)
if "%PYCHOICE%"=="3" (
    choco >nul 2>&1
    if %errorlevel% neq 0 (
        echo   Chocolatey is not installed. Try option 1 or 2.
        pause
        goto INSTALL_PYTHON
    )
    choco install python -y
    echo   Done. Close and reopen this BAT so Python is detected.
    pause
    goto MENU
)
if "%PYCHOICE%"=="4" goto MENU
goto INSTALL_PYTHON

:: ============================================================
::  LIBRARY DEFINITIONS  (v12 — updated list)
::  Format: LABEL|import_name|pip_package_name
:: ============================================================
:DEFINE_LIBS
set LIB_COUNT=16
set "LIB_1=flask|flask|flask"
set "LIB_2=werkzeug|werkzeug|werkzeug"
set "LIB_3=PIL|PIL|pillow"
set "LIB_4=pyautogui|pyautogui|pyautogui"
set "LIB_5=pynput|pynput|pynput"
set "LIB_6=psutil|psutil|psutil"
set "LIB_7=mss|mss|mss"
set "LIB_8=pystray|pystray|pystray"
set "LIB_9=pycaw|pycaw|pycaw"
set "LIB_10=comtypes|comtypes|comtypes"
set "LIB_11=win32api|win32api|pywin32"
set "LIB_12=win32clipboard|win32clipboard|pywin32"
set "LIB_13=pyaudiowpatch|pyaudiowpatch|pyaudiowpatch"
set "LIB_14=sounddevice|sounddevice|sounddevice"
set "LIB_15=numpy|numpy|numpy"
set "LIB_16=waitress|waitress|waitress"
exit /b

:: ============================================================
:CHECK_LIBS_ONLY
:: ============================================================
cls
call :DEFINE_LIBS
if not defined PYTHON (
    echo   [ERROR] Python not found. Run option 0 first.
    pause
    goto MENU
)
echo.
echo   --- Library Status Check (v12) ---
echo.
echo   Checking all !LIB_COUNT! required libraries...
echo.
set MISSING_COUNT=0
for /l %%i in (1,1,!LIB_COUNT!) do (
    call :CHECK_ONE_LIB "!LIB_%%i!"
)
echo.
:: Also check ffmpeg
where ffmpeg >nul 2>&1
if %errorlevel%==0 (
    echo   [OK]     ffmpeg        - found in PATH
) else (
    echo   [MISS]   ffmpeg        - NOT in PATH  (audio will fall back to PCM)
    echo             Install: winget install --id Gyan.FFmpeg -e
)
echo.
if !MISSING_COUNT!==0 (
    echo   [ALL OK] All libraries are installed.
) else (
    echo   [WARN] !MISSING_COUNT! library(ies) missing. Run option 1 to install.
)
echo.
pause
goto MENU

:: ============================================================
:INSTALL_LIBS
:: ============================================================
cls
call :DEFINE_LIBS
echo.
echo   --- Installing Required Libraries for v12 ---
echo.
if not defined PYTHON (
    echo   [ERROR] Python not found. Run option 0 first.
    pause
    goto MENU
)

echo   Upgrading pip first...
!PYTHON! -m pip install --upgrade pip --quiet
echo.
echo   Installing each library...
echo.

set MISSING_COUNT=0
set INSTALLED_COUNT=0
set FAILED_COUNT=0

for /l %%i in (1,1,!LIB_COUNT!) do (
    call :INSTALL_ONE_LIB "!LIB_%%i!"
)

echo.
echo   ----------------------------------------
echo   Note: pyaudiowpatch  = WASAPI loopback (best audio, primary)
echo         sounddevice    = audio fallback if pyaudiowpatch fails
echo         numpy          = required by sounddevice fallback
echo         waitress       = production WSGI server (recommended)
echo         win32clipboard = clipboard sync support
echo.
:: Check if pyaudiowpatch is OK (it sometimes needs special handling)
!PYTHON! -c "import pyaudiowpatch" >nul 2>&1
if %errorlevel% neq 0 (
    echo   [RETRY] pyaudiowpatch failed — trying pip install with --pre flag...
    !PYTHON! -m pip install pyaudiowpatch --pre --quiet
)
echo.
echo   ---- ffmpeg check ----
where ffmpeg >nul 2>&1
if %errorlevel%==0 (
    echo   [OK] ffmpeg found in PATH - 192kbps MP3 audio encoding enabled.
    call :MARK_DONE "ffmpeg"
) else (
    echo   [MISSING] ffmpeg not found. Audio will work as raw PCM only.
    echo   To install ffmpeg (recommended):
    echo     winget install --id Gyan.FFmpeg -e
    echo   Or download from https://ffmpeg.org/download.html and add to PATH.
)
echo.
if !FAILED_COUNT! GTR 0 (
    echo   [WARN] !FAILED_COUNT! package(s) failed to install. Check output above.
) else (
    echo   [OK] All libraries ready.
    call :MARK_DONE "libraries"
    call :MARK_DONE "audio_lib"
    call :MARK_DONE "bat_file"
)
echo.
pause
goto MENU

:: ============================================================
::  SUBROUTINE: Check one library and print status
:: ============================================================
:CHECK_ONE_LIB
set "_SPEC=%~1"
for /f "tokens=1,2,3 delims=|" %%a in ("!_SPEC!") do (
    set "_LABEL=%%a"
    set "_IMPORT=%%b"
    set "_PIP=%%c"
)
!PYTHON! -c "import !_IMPORT!" >nul 2>&1
if !errorlevel!==0 (
    echo   [OK]     !_LABEL!
) else (
    echo   [MISS]   !_LABEL!     ^(pip install !_PIP!^)
    set /a MISSING_COUNT+=1
)
exit /b

:: ============================================================
::  SUBROUTINE: Install one library if missing
:: ============================================================
:INSTALL_ONE_LIB
set "_SPEC=%~1"
for /f "tokens=1,2,3 delims=|" %%a in ("!_SPEC!") do (
    set "_LABEL=%%a"
    set "_IMPORT=%%b"
    set "_PIP=%%c"
)
!PYTHON! -c "import !_IMPORT!" >nul 2>&1
if !errorlevel!==0 (
    echo   [OK]     !_LABEL! already installed
) else (
    echo   [INST]   Installing !_PIP! ...
    !PYTHON! -m pip install !_PIP! --quiet
    if !errorlevel!==0 (
        !PYTHON! -c "import !_IMPORT!" >nul 2>&1
        if !errorlevel!==0 (
            echo             [SUCCESS] !_LABEL! installed OK
            set /a INSTALLED_COUNT+=1
        ) else (
            echo             [WARN]    !_LABEL! installed but import still fails
            set /a FAILED_COUNT+=1
        )
    ) else (
        echo             [FAILED]  !_PIP! pip install failed
        set /a FAILED_COUNT+=1
    )
    set /a MISSING_COUNT+=1
)
exit /b

:: ============================================================
::  FIX: START — Fully detached via PowerShell Start-Process
::       The agent now lives in its OWN process group and
::       survives when this BAT / console window is closed.
:: ============================================================
:START
cls
echo.
echo   --- Starting Agent v12 ---
echo.
if not defined PYTHON (
    echo   [ERROR] Python not found. Run option 0 first.
    pause
    goto MENU
)
if not exist "%AGENT_FILE%" (
    echo   [ERROR] agent_v12.py not found at:
    echo   %AGENT_FILE%
    echo.
    echo   Make sure agent_v12.py is in the same folder as this BAT file.
    pause
    goto MENU
)

:: Check if already running
netstat -ano | findstr ":5000 " >nul 2>&1
if %errorlevel%==0 (
    echo   [INFO] Agent is already running on port 5000.
    echo   Use option 4 to restart, or option 3 to stop first.
    pause
    goto MENU
)

:: -----------------------------------------------------------
:: Use pythonw.exe (no console window at all) if available,
:: otherwise fall back to python.exe with -WindowStyle Hidden.
:: Both create a fully independent background process.
:: -----------------------------------------------------------
echo   Launching agent as independent background process...

:: Try pythonw.exe first for truly silent launch (no terminal at all)
set PYTHONW=
for /f "delims=" %%p in ('where pythonw 2^>nul') do (
    if not defined PYTHONW set "PYTHONW=%%p"
)

:: Build the PowerShell launch command in a variable to avoid ^ issues inside if-blocks
set "PS_AGENT_FILE=!AGENT_FILE:\=\!"
set "PS_LOG=!LOG_FILE:\=\!"
set "PS_ERR=!STARTUP_ERR:\=\!"
set "PS_DIR=!AGENT_DIR!"

if defined PYTHONW (
    powershell -NoProfile -NonInteractive -Command "Start-Process -FilePath '!PYTHONW!' -ArgumentList '"!PS_AGENT_FILE!"' -WorkingDirectory '!PS_DIR!' -WindowStyle Hidden -RedirectStandardOutput '!PS_LOG!' -RedirectStandardError '!PS_ERR!'"
    echo   [pythonw] Launched silently - no terminal window will appear.
) else (
    powershell -NoProfile -NonInteractive -Command "Start-Process -FilePath '!PYTHON!' -ArgumentList '"!PS_AGENT_FILE!"' -WorkingDirectory '!PS_DIR!' -WindowStyle Hidden -RedirectStandardOutput '!PS_LOG!' -RedirectStandardError '!PS_ERR!'"
    echo   [python] Launched with hidden window ^(tip: install pythonw for fully silent mode^).
)

echo   Waiting 5 seconds for agent to initialise...
timeout /t 5 /nobreak >nul

:: Verify it actually started
netstat -ano | findstr ":5000 " >nul 2>&1
if %errorlevel%==0 (
    echo.
    echo   [OK] Agent is running on port 5000!
    echo   You can safely close this window — the agent will keep running.
    echo.
    pause
    goto STATUS
)

:: Startup failed — show error from log
echo.
echo   !! Agent did NOT start on port 5000 !!
echo.
if exist "%STARTUP_ERR%" (
    for %%A in ("%STARTUP_ERR%") do if %%~zA GTR 0 (
        echo   --- Error from startup_error.log ---
        type "%STARTUP_ERR%"
        echo   ------------------------------------
    ) else (
        echo   startup_error.log is empty.
        echo   Use option D (DEBUG) to see the real error in a visible console.
    )
) else (
    echo   No error log found. Use option D (DEBUG) to see the real error.
)
echo.
echo   Most common causes:
echo    - A Python library is missing  ^(run option 1 to install all^)
echo    - Port 5000 already in use     ^(run option 3 to stop first^)
echo    - agent_v12.py has a syntax error
echo.
pause
goto MENU

:: ============================================================
:START_DEBUG
:: ============================================================
cls
echo.
echo   --- DEBUG MODE: Agent running in this console ---
echo.
echo   All errors and output will appear here.
echo   Press Ctrl+C to stop the agent.
echo.
if not defined PYTHON ( echo   [ERROR] Python not found. & pause & goto MENU )
if not exist "%AGENT_FILE%" (
    echo   [ERROR] agent_v12.py not found at: %AGENT_FILE%
    pause
    goto MENU
)
echo   =========================================================
!PYTHON! "%AGENT_FILE%"
echo   =========================================================
echo.
echo   Agent has exited. See output above for the error/reason.
echo.
pause
goto MENU

:: ============================================================
::  SILENT CHECK (no echo, just increments MISSING_COUNT)
:: ============================================================
:SILENT_CHECK
set "_SPEC=%~1"
for /f "tokens=1,2,3 delims=|" %%a in ("!_SPEC!") do (
    set "_IMPORT=%%b"
)
!PYTHON! -c "import !_IMPORT!" >nul 2>&1
if !errorlevel! neq 0 set /a MISSING_COUNT+=1
exit /b

:: ============================================================
:STOP
:: ============================================================
cls
echo.
echo   --- Stopping Agent ---
echo.

:: Kill by port (most precise — only kills the agent process)
set KILLED=0
for /f "tokens=5" %%i in ('netstat -ano ^| findstr ":5000 " 2^>nul') do (
    if "%%i" NEQ "0" (
        taskkill /PID %%i /F >nul 2>&1
        set KILLED=1
    )
)
for /f "tokens=5" %%i in ('netstat -ano ^| findstr ":5001 " 2^>nul') do (
    if "%%i" NEQ "0" (
        taskkill /PID %%i /F >nul 2>&1
        set KILLED=1
    )
)

:: FIX: Do NOT blindly kill ALL python.exe — that would kill
:: unrelated Python scripts the user may be running.
:: Instead, use PowerShell to target only agent_v12 processes.
powershell -NoProfile -NonInteractive -Command "Get-WmiObject Win32_Process -Filter \"name='python.exe' OR name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*agent_v12*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

if !KILLED!==1 (
    echo   Agent stopped.
) else (
    echo   Agent was not running on ports 5000/5001.
)
pause
goto MENU

:STOP_SILENT
for /f "tokens=5" %%i in ('netstat -ano ^| findstr ":5000 " 2^>nul') do (
    if "%%i" NEQ "0" taskkill /PID %%i /F >nul 2>&1
)
for /f "tokens=5" %%i in ('netstat -ano ^| findstr ":5001 " 2^>nul') do (
    if "%%i" NEQ "0" taskkill /PID %%i /F >nul 2>&1
)
powershell -NoProfile -NonInteractive -Command "Get-WmiObject Win32_Process -Filter \"name='python.exe' OR name='pythonw.exe'\" | Where-Object { $_.CommandLine -like '*agent_v12*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
exit /b

:RESTART
cls
echo   Stopping agent...
call :STOP_SILENT
echo   Waiting 2 seconds...
timeout /t 2 /nobreak >nul
echo   Restarting...
goto START

:: ============================================================
:STATUS
:: ============================================================
cls
echo.
echo   --- Agent v12 Status ---
echo.
netstat -ano | findstr ":5000 " >nul 2>&1
if %errorlevel%==0 (
    echo   [RUNNING]  Port 5000  - Command API  (mouse / keyboard / files)
) else (
    echo   [STOPPED]  Port 5000  - Command API
)
netstat -ano | findstr ":5001 " >nul 2>&1
if %errorlevel%==0 (
    echo   [RUNNING]  Port 5001  - Video 1080p stream + Audio 192kbps + Viewer
) else (
    echo   [STOPPED]  Port 5001  - Video stream + Audio
)
echo.
:: Show local IP for quick access
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set IP=%%a
    set IP=!IP: =!
    :: Skip loopback
    if not "!IP!"=="127.0.0.1" (
        echo   Local IP : !IP!
        echo.
        echo   Browser viewer  : http://!IP!:5001/screen/viewer?key=^<your_key^>
        echo   1080p stream    : http://!IP!:5001/screen/stream?key=^<your_key^>^&w=1920^&q=75^&fps=20
        echo   2K stream       : http://!IP!:5001/screen/stream?key=^<your_key^>^&w=2560^&q=85^&fps=15
        echo   Audio only      : http://!IP!:5001/audio/stream?key=^<your_key^>^&fmt=mp3
        goto STATUS_DONE
    )
)
:STATUS_DONE
echo.
if exist "%CONFIG_FILE%" (
    echo   Config  : Found  ^(keys stored hashed^)
) else (
    echo   Config  : NOT FOUND  ^(use options 7 and 8 to set keys!^)
)
echo.
pause
goto MENU

:: ============================================================
:VIEWLOG
:: ============================================================
cls
echo   Showing last 50 lines. Press Ctrl+C to stop.
echo.
if not exist "%LOG_FILE%" (
    echo   [INFO] Log file not found: %LOG_FILE%
    echo   Start the agent first (option 2).
    pause
    goto MENU
)
powershell -Command "Get-Content '%LOG_FILE%' -Tail 50 -Wait"
goto MENU

:: ============================================================
:CHANGEKEY
:: ============================================================
cls
echo.
echo   --- Change Secret Key (PBKDF2 hashed) ---
echo.
if not defined PYTHON (echo   [ERROR] Python not found. & pause & goto MENU)
set /p NEWKEY=   Enter new Secret Key: 
if "!NEWKEY!"=="" (echo   [ERROR] Key cannot be empty. & pause & goto MENU)
!PYTHON! -c "import hashlib,os,json;p=r'!NEWKEY!';f=r'%CONFIG_FILE%';s=os.urandom(16);dk=hashlib.pbkdf2_hmac('sha256',p.encode(),s,260000);h=s.hex()+':'+dk.hex();cfg=json.load(open(f)) if os.path.exists(f) else {};cfg.update({'secret_key_hash':h,'secret_key':p});json.dump(cfg,open(f,'w'),indent=2);print('[OK] Secret key saved to '+f)"
call :MARK_DONE "key_hash"
echo.
echo   [HINT] Restart the agent (option 4) for the new key to take effect.
echo.
pause
goto MENU

:: ============================================================
:CHANGEMASTERKEY
:: ============================================================
cls
echo.
echo   --- Change Master Key (PBKDF2 hashed) ---
echo.
if not defined PYTHON (echo   [ERROR] Python not found. & pause & goto MENU)
set /p NEWMK=   Enter new Master Key: 
if "!NEWMK!"=="" (echo   [ERROR] Key cannot be empty. & pause & goto MENU)
!PYTHON! -c "import hashlib,os,json;p=r'!NEWMK!';f=r'%CONFIG_FILE%';s=os.urandom(16);dk=hashlib.pbkdf2_hmac('sha256',p.encode(),s,260000);h=s.hex()+':'+dk.hex();cfg=json.load(open(f)) if os.path.exists(f) else {};cfg.update({'master_key_hash':h,'master_key':p});json.dump(cfg,open(f,'w'),indent=2);print('[OK] Master key saved to '+f)"
call :MARK_DONE "key_hash"
echo.
echo   [HINT] Restart the agent (option 4) for the new key to take effect.
echo.
pause
goto MENU

:: ============================================================
:ADDSTARTUP
:: ============================================================
cls
echo.
echo   --- Add to Windows Auto-Start ---
echo.
if not defined PYTHON (echo   [ERROR] Python not found. & pause & goto MENU)
if not exist "%AGENT_FILE%" (
    echo   [ERROR] agent_v12.py not found at: %AGENT_FILE%
    pause
    goto MENU
)

:: Find pythonw.exe (preferred for background — no console window at all)
set SCHTASK_EXE=
for /f "delims=" %%p in ('where pythonw 2^>nul') do set SCHTASK_EXE=%%p
if not defined SCHTASK_EXE set SCHTASK_EXE=!PYTHON!

:: FIX: Use /sc onlogon + /delay so it starts after the desktop is ready
:: Also /rl HIGHEST so it has admin rights automatically
schtasks /create /tn "PCCommandAgentV12" ^
  /tr "\"!SCHTASK_EXE!\" \"%AGENT_FILE%\"" ^
  /sc onlogon /delay 0000:30 /rl HIGHEST /f

if %errorlevel%==0 (
    echo.
    echo   [OK] Agent will auto-start 30 seconds after every logon (as Administrator).
    echo   The 30-second delay ensures the network is ready before the agent starts.
    call :MARK_DONE "startup"
) else (
    echo   [ERROR] Failed to create scheduled task. Run as Administrator.
)
echo.
pause
goto MENU

:: ============================================================
:REMOVESTARTUP
:: ============================================================
cls
echo.
echo   --- Remove from Windows Auto-Start ---
echo.
schtasks /delete /tn "PCCommandAgentV12" /f
if %errorlevel%==0 (
    echo   [OK] Removed from startup.
    call :UNMARK_DONE "startup"
) else (
    echo   [INFO] Task not found (may already be removed).
)
:: Also clean up old task names from previous versions
schtasks /delete /tn "PCCommandAgent"      /f >nul 2>&1
schtasks /delete /tn "PCAgentTempLaunch"   /f >nul 2>&1
schtasks /delete /tn "PCCommandAgentV11"   /f >nul 2>&1
echo.
pause
goto MENU

:: ============================================================
:FIREWALL
:: ============================================================
cls
echo.
echo   --- Open Firewall Ports 5000 and 5001 ---
echo.
echo   Port 5000 = Command API  (mouse, keyboard, file ops)
echo   Port 5001 = Video 1080p stream + Audio + Browser viewer
echo.
netsh advfirewall firewall delete rule name="PC Agent Control" >nul 2>&1
netsh advfirewall firewall delete rule name="PC Agent Stream"  >nul 2>&1
netsh advfirewall firewall delete rule name="PC Agent Audio"   >nul 2>&1
netsh advfirewall firewall add rule name="PC Agent Control" protocol=TCP dir=in action=allow localport=5000
netsh advfirewall firewall add rule name="PC Agent Stream"  protocol=TCP dir=in action=allow localport=5001
if %errorlevel%==0 (
    echo.
    echo   [OK] Firewall rules added for ports 5000 and 5001.
    call :MARK_DONE "firewall"
) else (
    echo   [ERROR] Failed. Run as Administrator.
)
echo.
pause
goto MENU

:: ============================================================
:TEST_STREAM
:: ============================================================
cls
echo.
echo   --- Test Video Stream in Browser ---
echo.
echo   Getting local IP...
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set IP=%%a
    set IP=!IP: =!
    if not "!IP!"=="127.0.0.1" goto GOT_IP
)
:GOT_IP
echo.
echo   Agent must be running (option 2) before testing.
echo.
echo   Select stream quality to open in browser:
echo    1. 1080p  (1920px, q=75, 20fps)  - recommended
echo    2. 2K     (2560px, q=85, 15fps)  - high quality
echo    3. 720p   (1280px, q=65, 25fps)  - lower bandwidth
echo    4. Browser viewer (video + audio together)
echo    5. Back
echo.
set /p QCHOICE=   Enter choice: 
if "%QCHOICE%"=="1" (
    echo.
    echo   Opening: http://!IP!:5001/screen/stream?w=1920^&q=75^&fps=20
    start http://!IP!:5001/screen/stream?key=testkey^&w=1920^&q=75^&fps=20
    echo   NOTE: Replace 'testkey' with your actual key in the URL.
)
if "%QCHOICE%"=="2" (
    echo.
    echo   Opening: http://!IP!:5001/screen/stream?w=2560^&q=85^&fps=15
    start http://!IP!:5001/screen/stream?key=testkey^&w=2560^&q=85^&fps=15
    echo   NOTE: Replace 'testkey' with your actual key in the URL.
)
if "%QCHOICE%"=="3" (
    echo.
    echo   Opening: http://!IP!:5001/screen/stream?w=1280^&q=65^&fps=25
    start http://!IP!:5001/screen/stream?key=testkey^&w=1280^&q=65^&fps=25
    echo   NOTE: Replace 'testkey' with your actual key in the URL.
)
if "%QCHOICE%"=="4" (
    echo.
    echo   Opening: http://!IP!:5001/screen/viewer
    start http://!IP!:5001/screen/viewer?key=testkey
    echo   NOTE: Replace 'testkey' with your actual key in the URL.
)
if "%QCHOICE%"=="5" goto MENU
echo.
pause
goto MENU

:: ============================================================
:CHECK_FFMPEG
:: ============================================================
cls
echo.
echo   --- ffmpeg Check (required for 192kbps MP3 audio) ---
echo.
where ffmpeg >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%v in ('ffmpeg -version 2^>^&1 ^| findstr "ffmpeg version"') do (
        echo   [OK] %%v
    )
    echo.
    echo   ffmpeg is installed and in PATH.
    echo   Audio will stream as 192kbps MP3.
    call :MARK_DONE "ffmpeg"
) else (
    echo   [MISSING] ffmpeg not found in PATH.
    echo.
    echo   Without ffmpeg, audio falls back to raw PCM only.
    echo   (Most phones/browsers cannot play raw PCM streams.)
    echo.
    echo   Install ffmpeg (choose one):
    echo    1. winget  (easiest on Win 10/11)
    echo    2. Open ffmpeg.org download page
    echo    3. Chocolatey
    echo    4. Back
    echo.
    set /p FFCHOICE=   Enter choice: 
    if "!FFCHOICE!"=="1" (
        winget install --id Gyan.FFmpeg -e
        echo.
        echo   Done. Restart this BAT so PATH is refreshed.
    )
    if "!FFCHOICE!"=="2" (
        start https://ffmpeg.org/download.html
        echo.
        echo   Download, extract, and add the bin folder to your system PATH.
    )
    if "!FFCHOICE!"=="3" (
        choco install ffmpeg -y
        echo   Done. Restart this BAT so PATH is refreshed.
    )
)
echo.
pause
goto MENU

:: ============================================================
:MARK_STEP
:: ============================================================
cls
echo.
echo   --- Mark Checklist Step Complete Manually ---
echo.
echo    1.  Core Libraries Installed
echo    2.  Audio Library  (pyaudiowpatch / sounddevice)
echo    3.  ffmpeg in PATH
echo    4.  Firewall Ports Opened
echo    5.  Windows Auto-Start
echo    6.  Keys Configured
echo    0.  Back
echo.
set /p STEPCHOICE=   Enter step number: 
if "%STEPCHOICE%"=="1"  call :MARK_DONE "libraries"
if "%STEPCHOICE%"=="2"  call :MARK_DONE "audio_lib"
if "%STEPCHOICE%"=="3"  call :MARK_DONE "ffmpeg"
if "%STEPCHOICE%"=="4"  call :MARK_DONE "firewall"
if "%STEPCHOICE%"=="5"  call :MARK_DONE "startup"
if "%STEPCHOICE%"=="6"  call :MARK_DONE "key_hash"
if "%STEPCHOICE%"=="0"  goto MENU
echo   [OK] Marked as complete.
pause
goto MENU

:: ============================================================
::  PROGRESS SUBROUTINES
:: ============================================================

:CHECK_DONE
set "_CK=%~1"
set "_CV=%~2"
set "%_CV%= "
if not exist "%PROGRESS_FILE%" exit /b
findstr /i /c:"%_CK%" "%PROGRESS_FILE%" >nul 2>&1
if %errorlevel%==0 set "%_CV%=X"
exit /b

:MARK_DONE
set "_MK=%~1"
if not exist "%PROGRESS_FILE%" echo {} > "%PROGRESS_FILE%"
powershell -Command "$f='%PROGRESS_FILE%';try{$j=Get-Content $f -Raw|ConvertFrom-Json}catch{$j=[PSCustomObject]@{}};Add-Member -InputObject $j -NotePropertyName '%_MK%' -NotePropertyValue $true -Force;$j|ConvertTo-Json|Set-Content $f"
exit /b

:UNMARK_DONE
set "_UK=%~1"
if not exist "%PROGRESS_FILE%" exit /b
powershell -Command "$f='%PROGRESS_FILE%';try{$j=Get-Content $f -Raw|ConvertFrom-Json}catch{$j=[PSCustomObject]@{}};$j.PSObject.Properties.Remove('%_UK%');$j|ConvertTo-Json|Set-Content $f"
exit /b