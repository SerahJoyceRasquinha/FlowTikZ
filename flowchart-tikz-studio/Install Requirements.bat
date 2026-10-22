@echo off
setlocal EnableExtensions

REM ====================================================================
REM  Flowchart TikZ Studio - Windows requirements (check + install)
REM
REM  This file lists everything the project needs in order to RUN on
REM  Windows, and the commands that install it. Every requirement is
REM  CHECKED first and installed ONLY if it is missing or too old, so
REM  nothing is ever installed twice.
REM
REM   #  Requirement            Why it is needed          How it is installed
REM   -  ---------------------  ------------------------  --------------------------------
REM   1  Node.js 18 or newer    runs Vite, the dev server  latest Node.js LTS, via:
REM      (npm comes with it)    and npm                      a) nvm-windows, if you use it
REM                                                          b) winget  (OpenJS.NodeJS.LTS)
REM                                                          c) official .msi from nodejs.org
REM   2  Project packages       React, Vite, TypeScript,   npm install
REM      (node_modules)         Zustand ...                (exact versions from
REM                                                         package-lock.json)
REM
REM  Notes
REM   * npm is bundled with Node.js, so it is never installed separately.
REM   * Node.js is installed at the newest LTS release (the current
REM     long-term-support line - the "latest" version nodejs.org
REM     recommends). An existing Node.js 18+ is kept as it is.
REM   * Project packages use the versions pinned in package-lock.json.
REM     Forcing every package to its newest major version would break
REM     the app (React 19, Vite 6+ etc. are not drop-in upgrades).
REM   * Google Chrome is NOT required. The starter opens Chrome if it
REM     is installed and your default browser otherwise.
REM
REM  Usage
REM   Install Requirements.bat           check, install what is missing, pause
REM   Install Requirements.bat check     check only - exit code 0 = all present
REM   Install Requirements.bat install   check + install missing, no pause
REM                                      (this is what the starter calls)
REM ====================================================================

REM ---- settings ------------------------------------------------------
set "MIN_NODE_MAJOR=18"
set "WINGET_NODE_ID=OpenJS.NodeJS.LTS"
REM ---------------------------------------------------------------------

set "MODE=%~1"
if /i "%MODE%"=="check" goto ModeOk
if /i "%MODE%"=="install" goto ModeOk
set "MODE=interactive"
:ModeOk

REM ---- project folder = folder with package.json ----
set "PROJECT=%~dp0"
if not exist "%PROJECT%package.json" set "PROJECT=%CD%\"
if exist "%PROJECT%package.json" goto HaveProject
echo   [X] package.json not found next to this file or in "%CD%".
set "RC=1"
goto Finish
:HaveProject
set "PROJECT=%PROJECT:~0,-1%"

if /i "%MODE%"=="interactive" title Flowchart TikZ Studio - requirements

echo.
echo   Checking requirements...
call :CheckAll
if not defined MISSING (
    echo.
    echo   All requirements are installed.
    set "RC=0"
    goto Finish
)

if /i "%MODE%"=="check" (
    set "RC=1"
    goto Finish
)

REM ====================================================================
REM  Install whatever is missing, in dependency order
REM ====================================================================
echo.
echo   Installing what is missing...

if not defined NEED_NODE goto SkipNode
call :InstallNode
call :CheckNode
if defined NEED_NODE goto NodeStillMissing
REM Node.js is ready now, so the packages can be checked properly.
call :CheckDeps
:SkipNode

if not defined NEED_DEPS goto SkipDeps
call :InstallDeps
call :CheckDeps
if defined NEED_DEPS goto DepsStillMissing
:SkipDeps

echo.
echo   Final check:
call :CheckAll
if defined MISSING (
    set "RC=1"
    goto Finish
)
echo.
echo   All requirements are installed.
set "RC=0"
goto Finish

:NodeStillMissing
echo.
echo   [X] Node.js %MIN_NODE_MAJOR%+ is still not available.
echo       If an installer window asked for permission, allow it and run
echo       this again. If it keeps failing, install "Node.js LTS" from
echo       https://nodejs.org , close this window, and run this again.
echo       If an older Node.js is still being picked up, remove it in
echo       Settings ^> Apps, or put the new one first in PATH.
set "RC=1"
goto Finish

:DepsStillMissing
echo.
echo   [X] Project packages could not be installed - see npm's
echo       messages above. Check your internet connection and run
echo       this again.
set "RC=1"
goto Finish


REM ====================================================================
REM  CHECKS  (set NEED_xxx when something is missing, print a line each)
REM ====================================================================

:CheckAll
set "MISSING="
call :CheckNode
call :CheckDeps
if defined NEED_NODE set "MISSING=1"
if defined NEED_DEPS set "MISSING=1"
exit /b 0

REM ---- 1. Node.js + npm ----
:CheckNode
set "NEED_NODE="
set "NODE_VER="
set "NODE_MAJOR="
set "NPM_VER="
where node >nul 2>&1
if errorlevel 1 goto NodeNotFound
for /f "delims=" %%V in ('node -v 2^>nul') do set "NODE_VER=%%V"
if not defined NODE_VER goto NodeNotFound
for /f "tokens=1 delims=v." %%M in ("%NODE_VER%") do set "NODE_MAJOR=%%M"
if not defined NODE_MAJOR goto NodeNotFound
if %NODE_MAJOR% LSS %MIN_NODE_MAJOR% goto NodeTooOld
where npm >nul 2>&1
if errorlevel 1 goto NpmNotFound
for /f "delims=" %%V in ('npm -v 2^>nul') do set "NPM_VER=%%V"
if not defined NPM_VER goto NpmNotFound
echo   [OK]      Node.js %NODE_VER%  (npm %NPM_VER%)
exit /b 0

:NodeNotFound
set "NEED_NODE=missing"
echo   [MISSING] Node.js %MIN_NODE_MAJOR%+ with npm
exit /b 0

:NodeTooOld
set "NEED_NODE=old"
echo   [OLD]     Node.js %NODE_VER% found - version %MIN_NODE_MAJOR% or newer is needed
exit /b 0

:NpmNotFound
set "NEED_NODE=nonpm"
echo   [MISSING] npm  (Node.js %NODE_VER% is installed without npm)
exit /b 0

REM ---- 2. project packages ----
:CheckDeps
set "NEED_DEPS="
if defined NEED_NODE goto DepsUnknown
if not exist "%PROJECT%\node_modules\" goto DepsNotFound
if not exist "%PROJECT%\node_modules\.bin\vite.cmd" goto DepsNotFound
pushd "%PROJECT%"
REM npm ls exits non-zero if any package (at any depth) is missing,
REM the wrong version, or does not match package.json.
call npm ls --all >nul 2>&1
set "LSRC=%errorlevel%"
popd
if not "%LSRC%"=="0" goto DepsBroken
echo   [OK]      Project packages (node_modules)
exit /b 0

:DepsUnknown
set "NEED_DEPS=1"
echo   [WAITING] Project packages - installed after Node.js
exit /b 0

:DepsNotFound
set "NEED_DEPS=1"
echo   [MISSING] Project packages (node_modules)
exit /b 0

:DepsBroken
set "NEED_DEPS=1"
echo   [BROKEN]  Project packages - some are missing or out of date
exit /b 0


REM ====================================================================
REM  INSTALLERS
REM ====================================================================

REM ---- 1. Node.js LTS (npm included) ----
:InstallNode
echo.
echo   ---- Installing Node.js LTS (includes npm) ----
echo   Windows may ask for permission - click "Yes".
echo.

REM a) nvm-windows manages Node for this user: use it, so we do not
REM    end up with a second, competing Node.js installation.
where nvm >nul 2>&1
if errorlevel 1 goto TryWinget
echo   nvm-windows found - using it.
call nvm install lts
call nvm use lts
call :RefreshPath
call :NodeOkQuiet
if not errorlevel 1 exit /b 0
echo   nvm could not provide Node.js %MIN_NODE_MAJOR%+, trying winget...

REM b) winget (built into Windows 10 1809+ / Windows 11)
:TryWinget
where winget >nul 2>&1
if errorlevel 1 goto TryMsi
echo   Using winget: %WINGET_NODE_ID%
call winget install --id %WINGET_NODE_ID% --exact --source winget --silent --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
    echo   winget install did not complete - trying winget upgrade...
    call winget upgrade --id %WINGET_NODE_ID% --exact --source winget --silent --accept-source-agreements --accept-package-agreements
)
call :RefreshPath
call :NodeOkQuiet
if not errorlevel 1 exit /b 0
echo   winget did not provide Node.js %MIN_NODE_MAJOR%+, trying the official installer...

REM c) official installer: newest LTS .msi straight from nodejs.org
:TryMsi
echo   Downloading the newest Node.js LTS installer from nodejs.org...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $rel=(Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts } | Select-Object -First 1; $arch='x64'; if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch='arm64' }; $name='node-'+$rel.version+'-'+$arch+'.msi'; $msi=Join-Path $env:TEMP $name; Write-Host ('  Node.js '+$rel.version+' ('+$arch+')'); Invoke-WebRequest ('https://nodejs.org/dist/'+$rel.version+'/'+$name) -OutFile $msi -UseBasicParsing; $p=Start-Process msiexec.exe -ArgumentList ('/i '+[char]34+$msi+[char]34+' /passive /norestart') -Verb RunAs -Wait -PassThru; Remove-Item $msi -ErrorAction SilentlyContinue; exit $p.ExitCode"
call :RefreshPath
exit /b 0

REM Quiet version of the Node check: errorlevel 0 = Node %MIN%+ and npm usable
:NodeOkQuiet
set "Q_VER="
set "Q_MAJOR="
where node >nul 2>&1
if errorlevel 1 exit /b 1
for /f "delims=" %%V in ('node -v 2^>nul') do set "Q_VER=%%V"
if not defined Q_VER exit /b 1
for /f "tokens=1 delims=v." %%M in ("%Q_VER%") do set "Q_MAJOR=%%M"
if not defined Q_MAJOR exit /b 1
if %Q_MAJOR% LSS %MIN_NODE_MAJOR% exit /b 1
where npm >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0

REM A freshly installed program is not on this window's PATH yet.
REM Reload PATH from the registry (machine + user) so it is.
:RefreshPath
set "NEWPATH="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"`) do set "NEWPATH=%%P"
if defined NEWPATH set "PATH=%NEWPATH%"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if defined NVM_SYMLINK if exist "%NVM_SYMLINK%\node.exe" set "PATH=%NVM_SYMLINK%;%PATH%"
exit /b 0

REM ---- 2. project packages ----
:InstallDeps
echo.
echo   ---- Installing project packages (npm install) ----
echo   This happens only once and may take a few minutes.
echo.
pushd "%PROJECT%"
call npm install --no-audit --no-fund
popd
exit /b 0


REM ====================================================================
:Finish
REM Hand the (possibly refreshed) PATH back to whoever called this file,
REM so the starter can use a Node.js that was installed just now.
if /i "%MODE%"=="interactive" (
    echo.
    pause
)
endlocal & set "PATH=%PATH%" & exit /b %RC%
