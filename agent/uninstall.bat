@echo off
chcp 65001 >nul
title Desinstalacao do Agente - Monitoramento
echo ==============================================
echo   Desinstalacao do Agente de Monitoramento
echo ==============================================
echo.

echo [1/3] Parando agente...
taskkill /fi "WINDOWTITLE eq AgentMonitor*" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq *agent*" /f >nul 2>&1
tasklist /fi "imagename eq node.exe" | find /i "node.exe" >nul && taskkill /fi "imagename eq node.exe" /f >nul 2>&1
timeout /t 2 /nobreak >nul
echo       OK

echo.
echo [2/3] Removendo inicializacao automatica...
powershell -Command "Unregister-ScheduledTask -TaskName 'AgentMonitor' -Confirm:$false" >nul 2>&1
echo       OK

echo.
echo [3/3] Limpando arquivos...
rd /s /q "%USERPROFILE%\.agent-monitor" 2>nul
echo       OK

echo.
echo ==============================================
echo   Desinstalacao concluida!
echo ==============================================
echo.
pause
