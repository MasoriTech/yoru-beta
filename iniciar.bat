@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Yoru - inicializacao completa
cd /d "%~dp0"

set "APP_VERSION="
set "PYTHONUTF8=1"
set "PIP_DISABLE_PIP_VERSION_CHECK=1"

echo.
echo  ============================================================
echo                     YORU - INICIADOR
echo  ============================================================
echo.
echo  Este arquivo prepara as dependencias e inicia o Yoru.
echo  Pasta: %CD%
echo.

if not exist "package.json" (
  echo [ERRO] package.json nao encontrado. Extraia o ZIP completo do Yoru.
  goto :fail
)

rem ------------------------------------------------------------
rem 1. Node.js x64 - necessario para instalar e iniciar o Electron
rem ------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [1/6] Node.js nao encontrado. Tentando instalar Node.js LTS pelo WinGet...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo [ERRO] WinGet indisponivel. Instale Node.js LTS x64 em https://nodejs.org/ e rode iniciar.bat novamente.
    goto :fail
  )
  winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
  where node >nul 2>nul
  if errorlevel 1 (
    echo [ERRO] O Node.js foi solicitado, mas ainda nao esta disponivel nesta janela.
    echo        Feche e abra o iniciar.bat novamente depois da instalacao.
    goto :fail
  )
)

for /f "delims=" %%v in ('node -p "process.versions.node.split(String.fromCharCode(46))[0]"') do set "NODE_MAJOR=%%v"
for /f "delims=" %%a in ('node -p "process.arch"') do set "NODE_ARCH=%%a"
if not defined NODE_MAJOR goto :node_error
if !NODE_MAJOR! LSS 20 (
  echo [ERRO] Node.js !NODE_MAJOR! detectado. O Yoru requer Node.js 20 ou superior; prefira LTS x64.
  goto :fail
)
if /i not "!NODE_ARCH!"=="x64" (
  echo [ERRO] Node.js detectado como !NODE_ARCH!. Instale a versao x64 do Node.js.
  goto :fail
)
echo [OK] Node.js !NODE_MAJOR!.x x64 detectado.

rem ------------------------------------------------------------
rem 2. Python - conector Tapo e backend opcional Faster-Whisper
rem ------------------------------------------------------------
set "PY_RUN="
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" >nul 2>nul
  if not errorlevel 1 set "PY_RUN=py -3"
)
if not defined PY_RUN (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" >nul 2>nul
    if not errorlevel 1 set "PY_RUN=python"
  )
)

if not defined PY_RUN (
  echo [2/6] Python 3.11+ nao encontrado. Tentando instalar Python 3.12 pelo WinGet...
  where winget >nul 2>nul
  if not errorlevel 1 (
    winget install --id Python.Python.3.12 --exact --silent --accept-package-agreements --accept-source-agreements
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
    if exist "%ProgramFiles%\Python312\python.exe" set "PATH=%ProgramFiles%\Python312;%ProgramFiles%\Python312\Scripts;%PATH%"
    where py >nul 2>nul
    if not errorlevel 1 (
      py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" >nul 2>nul
      if not errorlevel 1 set "PY_RUN=py -3"
    )
    if not defined PY_RUN (
      where python >nul 2>nul
      if not errorlevel 1 (
        python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" >nul 2>nul
        if not errorlevel 1 set "PY_RUN=python"
      )
    )
  )
)

if defined PY_RUN (
  for /f "delims=" %%v in ('!PY_RUN! -c "import sys; print(str(sys.version_info[0])+chr(46)+str(sys.version_info[1])+chr(46)+str(sys.version_info[2]))"') do set "PY_VERSION=%%v"
  echo [OK] Python !PY_VERSION! detectado por !PY_RUN!.
  !PY_RUN! -m pip --version >nul 2>nul
  if errorlevel 1 (
    echo [INFO] Preparando o pip...
    !PY_RUN! -m ensurepip --upgrade
  )
  if errorlevel 1 (
    echo [AVISO] pip nao ficou disponivel. O Yoru vai abrir, mas Tapo/Faster-Whisper podem ficar indisponiveis.
    set "TAPO_READY=0"
  ) else (
    echo [3/6] Instalando/atualizando o conector da lampada Tapo...
    !PY_RUN! -m pip install --user --upgrade python-kasa
    if errorlevel 1 (
      echo [AVISO] Nao foi possivel instalar python-kasa. O Yoru vai abrir; a aba Smart Home informara a pendencia.
      set "TAPO_READY=0"
    ) else (
      !PY_RUN! -c "import kasa; print('python-kasa pronto')"
      if errorlevel 1 (set "TAPO_READY=0") else (set "TAPO_READY=1")
    )
  )
) else (
  echo [AVISO] Python 3.11+ nao foi localizado/instalado.
  echo         O Yoru ainda pode abrir, mas o conector Tapo e Faster-Whisper ficarao indisponiveis.
  echo         Instale Python 3.12 em https://www.python.org/downloads/windows/ e rode novamente.
  set "TAPO_READY=0"
)

rem Faster-Whisper e opcional; o reconhecimento integrado do Yoru continua como alternativa.
if /i "%~1"=="--instalar-whisper" (
  if defined PY_RUN (
    echo [INFO] Instalando o backend opcional Faster-Whisper para CPU...
    !PY_RUN! -m pip install --user --upgrade faster-whisper
    if errorlevel 1 echo [AVISO] Faster-Whisper nao foi instalado. O reconhecimento integrado continua disponivel.
  ) else (
    echo [AVISO] Nao foi possivel instalar Faster-Whisper sem Python.
  )
) else (
  echo [INFO] Faster-Whisper nao solicitado. O reconhecimento integrado do Yoru permanece disponivel.
  echo        Para instalar esse backend opcional depois: iniciar.bat --instalar-whisper
)

rem ------------------------------------------------------------
rem 4. Dependencias Node/Electron - reinstala se faltar ou mudar versao
rem ------------------------------------------------------------
for /f "tokens=2 delims=:," %%v in ('findstr /c:version package.json') do set "APP_VERSION=%%~v"
set "NEED_NPM=0"
if not exist "node_modules\electron\dist\electron.exe" set "NEED_NPM=1"
if not exist "node_modules\.yoru-deps-version" set "NEED_NPM=1"
if exist "node_modules\.yoru-deps-version" (
  set /p INSTALLED_VERSION=<"node_modules\.yoru-deps-version"
  if not "!INSTALLED_VERSION!"=="!APP_VERSION!" set "NEED_NPM=1"
)
if "!NEED_NPM!"=="1" (
  echo [4/6] Instalando dependencias do Yoru/Electron. Na primeira vez pode demorar...
  if exist "package-lock.json" (
    call npm ci --no-audit --no-fund
    if errorlevel 1 (
      echo [ERRO] npm ci falhou. Confira package-lock.json, a conexao e tente novamente.
      goto :fail
    )
  ) else (
    call npm install --no-audit --no-fund
    if errorlevel 1 (
      echo [ERRO] npm install falhou. Verifique a internet e tente novamente.
      goto :fail
    )
  )
  if not exist "node_modules" mkdir "node_modules" >nul 2>nul
  >"node_modules\.yoru-deps-version" echo !APP_VERSION!
) else (
  echo [4/6] Dependencias Node/Electron ja estao preparadas para a versao !APP_VERSION!.
)

rem ------------------------------------------------------------
rem 5. Arquivos locais (Three.js, VRM e MediaPipe para Gestos)
rem ------------------------------------------------------------
echo [5/6] Conferindo arquivos locais e recursos do Yoru...
call npm run vendor
if errorlevel 1 (
  echo [ERRO] Nao foi possivel preparar os arquivos locais do Yoru.
  goto :fail
)
if not exist "src\vendor\three\three.module.js" (
  echo [ERRO] Arquivos Three.js ausentes. Rode novamente com internet.
  goto :fail
)
if not exist "src\vendor\mediapipe\hand_landmarker.task" (
  echo [AVISO] Modelo MediaPipe nao encontrado. A aba Gestos pode pedir novo download.
)

rem ------------------------------------------------------------
rem 6. Diagnostico de integracoes externas opcionais e inicio
rem ------------------------------------------------------------
echo [6/6] Verificando integracoes opcionais...
where ollama >nul 2>nul
if errorlevel 1 (echo  - Ollama nao encontrado: provedores online continuam disponiveis.) else (echo  - Ollama detectado no PATH.)
where adb >nul 2>nul
if errorlevel 1 (echo  - ADB nao encontrado: recursos Android por ADB exigem Android Platform-Tools.) else (echo  - ADB detectado no PATH.)
where scrcpy >nul 2>nul
if errorlevel 1 (echo  - scrcpy nao encontrado: espelhamento Android permanece opcional.) else (echo  - scrcpy detectado no PATH.)
if "!TAPO_READY!"=="1" (echo  - Conector Tapo/python-kasa pronto.) else (echo  - Tapo ainda depende de Python + python-kasa.)
echo.
echo  Iniciando Yoru v!APP_VERSION!...
echo  Para controlar a L530E, configure a conta Tapo dentro da aba Smart Home.
echo  Para Bluetooth, Wi-Fi e pareamento, o Yoru usa os recursos nativos do Windows.
echo.
call npm start
set "APP_EXIT=%ERRORLEVEL%"
if not "!APP_EXIT!"=="0" (
  echo.
  echo [AVISO] O Yoru foi encerrado com codigo !APP_EXIT!.
  echo        Consulte as mensagens acima para identificar o problema.
  pause
)
exit /b !APP_EXIT!

:node_error
echo [ERRO] Nao foi possivel identificar a versao do Node.js.
goto :fail

:fail
echo.
echo A inicializacao nao foi concluida. Corrija o item indicado e rode iniciar.bat novamente.
echo.
pause
exit /b 1
