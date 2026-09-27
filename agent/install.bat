@echo off
chcp 65001 >nul
title Instalacao do Agente - Monitoramento
echo ==============================================
echo   Instalacao do Agente de Monitoramento
echo ==============================================
echo.

set "AGENT_DIR=%~dp0"
set "AGENT_EXE=%AGENT_DIR%node.exe"
set "AGENT_JS=%AGENT_DIR%index-silent.js"
set "LOCK_FILE=%USERPROFILE%\.agent-monitor\running.lock"

echo [1/5] Verificando Node.js...
if not exist "%AGENT_EXE%" (
    echo ERRO: node.exe nao encontrado na pasta do agente.
    echo Baixe o Node.js portable em: https://nodejs.org/en/download
    pause
    exit /b 1
)
echo       OK - Node.js encontrado

echo.
echo [2/5] Instalando dependencias...
cd /d "%AGENT_DIR%"
call npm install --production
if errorlevel 1 (
    echo ERRO ao instalar dependencias.
    pause
    exit /b 1
)
echo       OK - Dependencias instaladas

echo.
echo [3/5] Configurando inicializacao automatica...
powershell -Command "$action = New-ScheduledTaskAction -Execute '%~dp0launcher.vbs' -WorkingDirectory '%~dp0'; $trigger = New-ScheduledTaskTrigger -AtLogOn; $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable; $principal = New-ScheduledTaskPrincipal -UserId '%USERNAME%' -LogonType S4U -RunLevel Highest; Register-ScheduledTask -TaskName 'AgentMonitor' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Agente de monitoramento de tela' -Force"
if errorlevel 1 (
    echo       AVISO: Nao foi possivel criar tarefa agendada. Tente executar como Administrador.
) else (
    echo       OK - Inicializacao automatica configurada
)

echo.
echo [4/5] Iniciando agente...
start "" /b nircmd.exe elevate cmd /c "cd /d %AGENT_DIR% && launcher.vbs"
timeout /t 3 /nobreak >nul

echo.
echo [5/5] Verificando status...
if exist "%LOCK_FILE%" (
    echo       OK - Agente esta rodando
) else (
    echo       AGUARDE - Iniciando...
)

echo.
echo ==============================================
echo   Instalacao concluida!
echo.
echo   O agente iniciara automaticamente no boot.
echo   Para desinstalar, execute uninstall.bat
echo ==============================================
echo.
pause
