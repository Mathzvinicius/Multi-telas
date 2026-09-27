# Deploy do Agente para Windows
# Empacota o agente com Node.js portable para deploy facil

param(
    [string]$OutputDir = "..\deploy\agent-package",
    [string]$ServerUrl = "http://localhost:3000",
    [int]$Interval = 5000
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deploy do Agente de Monitoramento" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = $PSScriptRoot
$AgentDir = Join-Path $ScriptDir "..\agent"
$OutputPath = Join-Path $ScriptDir $OutputDir

# Criar diretorio de saida
if (Test-Path $OutputPath) {
    Remove-Item $OutputPath -Recurse -Force
}
New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

Write-Host "[1/5] Baixando Node.js portable..." -ForegroundColor Yellow
$NodeVersion = "20.10.0"
$NodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$NodeZip = Join-Path $OutputPath "node.zip"

try {
    Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZip -UseBasicParsing
    Write-Host "      OK - Node.js baixado" -ForegroundColor Green
} catch {
    Write-Host "      ERRO ao baixar Node.js: $_" -ForegroundColor Red
    Write-Host "      Baixe manualmente em: https://nodejs.org/en/download" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "[2/5] Extraindo Node.js..." -ForegroundColor Yellow
Expand-Archive -Path $NodeZip -DestinationPath $OutputPath -Force
Remove-Item $NodeZip

$NodeFolder = Get-ChildItem $OutputPath -Directory | Where-Object { $_.Name -like "node-v*" }
$NodeExe = Join-Path $NodeFolder.FullName "node.exe"
Write-Host "      OK - Node.js extraido" -ForegroundColor Green

Write-Host ""
Write-Host "[3/5] Copiando arquivos do agente..." -ForegroundColor Yellow
$FilesToCopy = @("index-silent.js", "launcher.vbs", "install.bat", "uninstall.bat", "package.json")
foreach ($file in $FilesToCopy) {
    $source = Join-Path $AgentDir $file
    if (Test-Path $source) {
        Copy-Item $source -Destination $OutputPath -Force
    }
}

Write-Host ""
Write-Host "[4/5] Instalando dependencias..." -ForegroundColor Yellow
Set-Location $OutputPath
& $NodeExe npm install --production 2>&1 | Out-Null
Set-Location $ScriptDir
Write-Host "      OK - Dependencias instaladas" -ForegroundColor Green

Write-Host ""
Write-Host "[5/5] Criando instalador principal..." -ForegroundColor Yellow

# Atualizar install.bat com a URL do servidor
$InstallBat = Join-Path $OutputPath "install.bat"
if (Test-Path $InstallBat) {
    $content = Get-Content $InstallBat -Raw
    $content = $content -replace 'http://localhost:3000', $ServerUrl
    $content = $content -replace '5000', $Interval.ToString()
    Set-Content $InstallBat $content
}

# Criar arquivo de configuracao
$Config = @{
    serverUrl = $ServerUrl
    captureInterval = $Interval
    agentId = [guid]::NewGuid().ToString()
} | ConvertTo-Json
Set-Content (Join-Path $OutputPath "config.json") $Config

Write-Host "      OK" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Deploy concluido!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Pacote criado em: $OutputPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "Para distribuir:" -ForegroundColor Yellow
Write-Host "  1. Copie a pasta para a maquina do colaborador" -ForegroundColor White
Write-Host "  2. Execute install.bat como Administrador" -ForegroundColor White
Write-Host ""
Write-Host "Para desinstalar:" -ForegroundColor Yellow
Write-Host "  Execute uninstall.bat" -ForegroundColor White
Write-Host ""
