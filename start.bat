@echo off
set ELECTRON_PATH=%TEMP%\electron-temp\node_modules\electron\dist\electron.exe
if not exist "%ELECTRON_PATH%" (
    echo Electron not found at %ELECTRON_PATH%
    echo Please run: npm install electron --prefix %TEMP%\electron-temp
    pause
    exit /b 1
)
start "" "%ELECTRON_PATH%" "%~dp0."
