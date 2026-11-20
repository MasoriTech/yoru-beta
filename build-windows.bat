@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Yoru - criar o programa para Windows
rem Roda sempre na pasta deste arquivo, mesmo com duplo clique, como administrador ou por atalho.
cd /d "%~dp0"

echo.
echo  === Yoru: criando o instalador (.exe) ===
echo.

rem ---------- 1. Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] O Node.js nao foi encontrado.
  echo        Instale o Node.js 64 bits LTS em nodejs.org e rode este arquivo de novo.
  goto :falha
)
set "NODEMAJOR=0"
set "NODEARCH="
for /f "delims=" %%v in ('node -p "parseInt(process.versions.node)"') do set "NODEMAJOR=%%v"
for /f "delims=" %%v in ('node -p "process.arch"') do set "NODEARCH=%%v"
if %NODEMAJOR% LSS 20 (
  echo [ERRO] Seu Node.js e antigo, versao %NODEMAJOR%. Instale o Node.js 22 LTS em nodejs.org.
  goto :falha
)
if /i not "%NODEARCH%"=="x64" (
  echo [ERRO] O Node.js instalado e de %NODEARCH% bits. Instale a versao 64 bits ^(x64^) em nodejs.org.
  goto :falha
)

rem ---------- 2. Yoru aberto trava a pasta dist ----------
tasklist /fi "imagename eq Yoru.exe" 2>nul | find /i "Yoru.exe" >nul
if not errorlevel 1 (
  echo [ERRO] O Yoru esta aberto. Feche o Yoru ^(tambem pela bandeja, perto do relogio^) e rode de novo.
  goto :falha
)

rem ---------- 3. Dependencias ----------
echo [1/3] Instalando as dependencias ^(a primeira vez demora alguns minutos^)...
call npm install
if errorlevel 1 (
  echo.
  echo [ERRO] Falhou o npm install. Confira a internet e rode de novo.
  goto :falha
)

rem ---------- 4. Gerar o programa ----------
rem Sem certificado de assinatura nao precisa procurar um: evita erros de "winCodeSign" e de links simbolicos.
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
if exist dist rmdir /s /q dist >nul 2>nul
if exist dist (
  echo [ERRO] Nao consegui apagar a pasta dist ^(algum arquivo dela esta em uso^). Feche o que estiver aberto nela e rode de novo.
  goto :falha
)

if /i "%~1"=="--sem-testes" (
  echo [2/3] Pulando os testes ^(--sem-testes^)...
  call npm run vendor
  if errorlevel 1 goto :falha_build
  echo [3/3] Criando o instalador e a versao portatil...
  call npx electron-builder --win
) else (
  echo [2/3] Rodando os testes e [3/3] criando o instalador e a versao portatil...
  call npm run dist
)
if errorlevel 1 goto :falha_build

if not exist "dist\Yoru-Setup-*.exe" (
  echo [ERRO] O build terminou, mas nao achei o instalador na pasta dist.
  goto :falha
)

echo.
echo  Pronto! Os arquivos estao na pasta "dist":
echo    Yoru-Setup-*.exe     ^(instalador^)
echo    Yoru-Portatil-*.exe  ^(sem instalar^)
echo.
explorer dist
pause
exit /b 0

:falha_build
echo.
echo [ERRO] Falhou ao criar o programa. Leia a mensagem em vermelho acima.
echo        - Se foi um teste que falhou, rode "npm test" para ver qual. Para criar mesmo assim:
echo          build-windows.bat --sem-testes
echo        - Se apareceu "Cannot create symbolic link" ou "winCodeSign", ative o
echo          Modo de Desenvolvedor do Windows ^(Configuracoes, Sistema, Para desenvolvedores^)
echo          ou rode este arquivo como administrador.
goto :falha

:falha
echo.
pause
exit /b 1
