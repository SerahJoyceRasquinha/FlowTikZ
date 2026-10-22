@echo off
setlocal EnableExtensions

REM ===========================================================
REM  Flowchart TikZ Studio - one-click launcher
REM
REM  Double-click this file. It will:
REM    1. find the project folder
REM    2. check every requirement listed in "Install Requirements.bat"
REM         - all present  -> go straight to step 3
REM         - any missing  -> install only what is missing, then go on
REM    3. start the Vite dev server in THIS one window
REM    4. open a browser tab by itself once the app is ready
REM       (Chrome if installed, otherwise your default browser)
REM
REM  Close this window to stop the app.
REM ===========================================================

REM ---- setting: change the port here if 5173 is taken ----
set "PORT=5173"
REM --------------------------------------------------------

set "URL=http://localhost:%PORT%/"
set "REQFILE=Install Requirements.bat"

REM Internal mode: background helper that waits for the server
REM and then opens the browser. Not meant to be run by hand.
if /i "%~1"=="__openwhenready" goto OpenWhenReady

set "SILENT="
if /i "%~1"=="/silent" set "SILENT=1"

title Flowchart TikZ Studio
call :DetectCurl

REM ---------- 1. locate the project ----------
cd /d "%~dp0"
if exist "package.json" goto FoundProject

cd /d "%~dp0.."
if exist "package.json" goto FoundProject

cd /d "%~dp0"
for /d %%D in (*) do (
    if exist "%%D\package.json" (
        cd /d "%~dp0%%D"
        goto FoundProject
    )
)

echo.
echo   [X] Could not find package.json.
echo       Put this file inside the Flowchart TikZ Studio folder
echo       - the one that contains package.json - and run it again.
goto Fail

:FoundProject
echo.
echo   Project folder : %CD%

REM ---------- 2. requirements: check, install only if needed ----------
set "INSTALLER=%CD%\%REQFILE%"
if not exist "%INSTALLER%" set "INSTALLER=%~dp0%REQFILE%"
if exist "%INSTALLER%" goto HaveInstaller
echo.
echo   [X] "%REQFILE%" was not found.
echo       Keep it in the project folder next to package.json.
goto Fail
:HaveInstaller

call "%INSTALLER%" check
if not errorlevel 1 goto RequirementsOk

echo.
echo   Some requirements are missing - installing them now.
call "%INSTALLER%" install
if not errorlevel 1 goto RequirementsOk
echo.
echo   [X] Requirements could not be installed - see the messages above.
goto Fail

:RequirementsOk
echo.

REM ---------- 3. find Chrome (optional) ----------
call :FindChrome
if defined CHROME goto HaveChrome
echo   Google Chrome was not found - your default browser will be used.
echo.
:HaveChrome

REM ---------- 4. already running? just open a tab ----------
call :IsUp
if errorlevel 1 goto NeedStart
echo   The app is already running on port %PORT%.
echo   Opening a new browser tab...
call :OpenBrowser
echo.
goto Done
:NeedStart

REM ---------- 5. arm the background "open browser" helper ----------
start "" /b "%~f0" __openwhenready

REM ---------- 6. run the dev server in this window ----------
echo   Starting the dev server on port %PORT% ...
echo   The browser will open on its own in a few seconds.
echo   If it does not, open %URL%
echo   Image import runs offline with built-in OCR - no API key needed.
echo.
echo   ---------------------------------------------------------
echo    Keep this window open while you work.
echo    Closing it stops the app.
echo   ---------------------------------------------------------
echo.

call npm run dev -- --port %PORT% --strictPort

echo.
echo   Server stopped.
goto Done


REM ===========================================================
REM  Background helper: wait for the server, then open a tab
REM ===========================================================
:OpenWhenReady
call :DetectCurl
call :FindChrome
set /a tries=0

:WaitLoop
call :IsUp
if not errorlevel 1 goto ServerUp
set /a tries+=1
if %tries% GEQ 240 exit /b 1
ping -n 2 127.0.0.1 >nul 2>&1
goto WaitLoop

:ServerUp
call :OpenBrowser
exit /b 0


REM ===========================================================
REM  Subroutines
REM ===========================================================

:OpenBrowser
if defined CHROME (
    start "" "%CHROME%" "%URL%"
) else (
    start "" "%URL%"
)
exit /b 0

:DetectCurl
set "HAVECURL="
where curl.exe >nul 2>&1
if not errorlevel 1 set "HAVECURL=1"
exit /b 0

:IsUp
REM errorlevel 0 = the app is answering on %PORT%
if not defined HAVECURL goto IsUpNetstat
curl.exe -s -o nul --max-time 3 "%URL%" >nul 2>&1
exit /b %errorlevel%
:IsUpNetstat
netstat -an | findstr /r /c:":%PORT% " >nul 2>&1
exit /b %errorlevel%

:FindChrome
set "CHROME="
set "PFX86=%ProgramFiles(x86)%"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if defined CHROME exit /b 0
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if defined CHROME exit /b 0
if exist "%PFX86%\Google\Chrome\Application\chrome.exe" set "CHROME=%PFX86%\Google\Chrome\Application\chrome.exe"
if defined CHROME exit /b 0
for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul') do set "CHROME=%%~B"
exit /b 0


REM ===========================================================
:Fail
echo.
if not defined SILENT pause
exit /b 1

:Done
if not defined SILENT pause
exit /b 0
