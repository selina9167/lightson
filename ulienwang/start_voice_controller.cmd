@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
title Ameba Mini Python Voice LED Controller
cd /d "%~dp0"

echo ========================================
echo  Ameba Mini Python Voice LED Controller
echo ========================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python was not found.
  echo Install Python, then run this file again.
  goto :failed
)

echo [INFO] Checking Python...
python --version
python -c "import serial" >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] The pyserial package is missing.
  echo Run this command in CMD:
  echo python -m pip install -r requirements.txt
  goto :failed
)

python -c "import pythoncom, win32com.client" >nul 2>&1
if errorlevel 1 (
  echo.
  echo [ERROR] The pywin32 package for voice feedback is missing.
  echo Run this command in CMD:
  echo python -m pip install -r requirements.txt
  goto :failed
)

echo [INFO] Starting controller on COM3 and port 8000...
echo [INFO] Keep this window open. Press Ctrl+C to stop.
echo.
python -u voice_controller.py --serial-port COM3 --web-port 8000

set "APP_EXIT=%ERRORLEVEL%"
echo.
if not "%APP_EXIT%"=="0" (
  echo [ERROR] Controller stopped with exit code %APP_EXIT%.
) else (
  echo [INFO] Controller stopped.
)
echo Check the messages above before closing this window.
pause
exit /b %APP_EXIT%

:failed
echo.
echo Startup failed. This window will stay open for diagnosis.
pause
exit /b 1
