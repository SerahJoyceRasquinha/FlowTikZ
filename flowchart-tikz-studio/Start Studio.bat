@echo off
REM ===========================================================================
REM  Flowchart TikZ Studio - one-click launcher
REM  Double-click this file. It will:
REM    1. Check Node.js and Google Chrome are installed
REM    2. Run "npm install" the first time only
REM    3. Open TERMINAL 1 -> frontend dev server (Vite)
REM    4. Open TERMINAL 2 -> backend, or a dev console if no backend is set
REM    5. Wait until the port actually answers
REM    6. Open http://localhost:5173/ in a NEW TAB in CHROME ONLY
REM ===========================================================================

REM ------------------------- CONFIG: EDIT THESE ------------------------------
set "FRONTEND_DIR=%~dp0"
set "FRONTEND_CMD=npm run dev"
set "FRONTEND_PORT=5173"

REM Leave BACKEND_CMD empty if you have no backend yet.
REM Example once you add one:
REM   set "BACKEND_DIR=%~dp0server"
REM   set "BACKEND_CMD=npm run start"
REM   set "BACKEND_PORT=3000"
set "BACKEND_DIR=%~dp0"
set "BACKEND_CMD="
set "BACKEND_PORT="

REM What terminal 2 runs when BACKEND_CMD is empty: tests | console
set "NO_BACKEND_MODE=console"
REM ---------------------------------------------------------------------------

title Flowchart TikZ Studio - Launcher
cd /d "%FRONTEND_DIR%"
echo.
echo  ==========================================================
echo   Flowchart TikZ Studio - starting up
echo  ==========================================================
echo.

REM ---------- 1. Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
    echo  [ERROR] Node.js was not found on your PATH.
    echo          Install Node 18 or newer from https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%V in ('node -v') do echo  [OK] Node.js %%V

REM ---------- 2. Google Chrome ----------
set "CHROME="
for %%P in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do if exist %%P set "CHROME=%%~P"

if not defined CHROME (
    for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do if exist "%%B" set "CHROME=%%B"
)
if not defined CHROME (
    for /f "tokens=2,*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do if exist "%%B" set "CHROME=%%B"
)

if not defined CHROME (
    echo  [ERROR] Google Chrome was not found.
    echo          This launcher is set to open Chrome only - no fallback browser.
    echo          Install Chrome, or edit the CHROME path inside this file.
    echo.
    pause
    exit /b 1
)
echo  [OK] Chrome found

REM ---------- 3. Dependencies ----------
if not exist "%FRONTEND_DIR%node_modules" (
    echo  [..] node_modules missing - running npm install ^(first run only^)
    call npm install
    if errorlevel 1 (
        echo.
        echo  [ERROR] npm install failed. Scroll up for the reason.
        pause
        exit /b 1
    )
    echo  [OK] Dependencies installed
) else (
    echo  [OK] Dependencies already installed
)

REM ---------- 4. Is the frontend already running? ----------
set "ALREADY_UP="
powershell -NoProfile -Command "try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%FRONTEND_PORT%);$c.Close();exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 set "ALREADY_UP=1"

if defined ALREADY_UP (
    echo  [OK] Port %FRONTEND_PORT% is already serving - reusing it
) else (
    echo  [..] Terminal 1: starting frontend dev server
    start "FRONTEND - Vite dev server (port %FRONTEND_PORT%)" cmd /k "cd /d "%FRONTEND_DIR%" && %FRONTEND_CMD%"
)

REM ---------- 5. Terminal 2 ----------
if defined BACKEND_CMD (
    echo  [..] Terminal 2: starting backend
    start "BACKEND - %BACKEND_CMD%" cmd /k "cd /d "%BACKEND_DIR%" && %BACKEND_CMD%"
) else (
    if /i "%NO_BACKEND_MODE%"=="tests" (
        echo  [..] Terminal 2: test watcher ^(no backend configured^)
        start "DEV CONSOLE - test watch" cmd /k "cd /d "%FRONTEND_DIR%" && npm run test:watch"
    ) else (
        echo  [..] Terminal 2: dev console ^(no backend configured^)
        start "DEV CONSOLE - project shell" cmd /k "cd /d "%FRONTEND_DIR%" && echo No backend configured. Set BACKEND_CMD in Start Studio.bat to launch one here. && echo."
    )
)

REM ---------- 6. Wait for the port, then open Chrome ----------
if defined ALREADY_UP goto :open_chrome

echo  [..] Waiting for http://localhost:%FRONTEND_PORT%/ to answer
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',%FRONTEND_PORT%);$c.Close();exit 0}catch{Start-Sleep -Milliseconds 500}};exit 1" >nul 2>nul
if errorlevel 1 (
    echo.
    echo  [ERROR] Server did not come up on port %FRONTEND_PORT% within 30 seconds.
    echo          Check the FRONTEND terminal window for the real error.
    echo          If Vite says it moved to another port, update FRONTEND_PORT above.
    echo.
    pause
    exit /b 1
)

:open_chrome
echo  [OK] Server is live
echo  [..] Opening Chrome
start "" "%CHROME%" --new-tab "http://localhost:%FRONTEND_PORT%/"

echo.
echo  ==========================================================
echo   Running. Close the two terminal windows to stop.
echo  ==========================================================
timeout /t 4 >nul
exit /b 0
