@echo off
setlocal
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m pip install --upgrade pip
  py -3 -m pip install faster-whisper
) else (
  python -m pip install --upgrade pip
  python -m pip install faster-whisper
)
if %errorlevel% neq 0 (
  echo.
  echo Falha na instalacao. Instale Python 3 x64 e tente novamente.
  pause
  exit /b 1
)
echo.
echo Faster-Whisper instalado. Feche e abra o Yoru novamente.
pause
