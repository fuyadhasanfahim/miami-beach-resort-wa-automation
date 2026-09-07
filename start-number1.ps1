# Start WhatsApp number 1 under pm2 (native Windows PowerShell).
# Linux / macOS / Git Bash / WSL: use ./start-number1.sh
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$vendor = Join-Path $PSScriptRoot "vendor\node"
if (Test-Path $vendor) {
  $bin = Get-ChildItem -Path $vendor -Directory -Filter "node-v*-win-*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($bin) { $env:Path = "$($bin.FullName);$env:Path" }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js not found. Run .\setup.ps1 first."
}

$pm2 = "node_modules\pm2\bin\pm2"
if (-not (Test-Path $pm2)) {
  Write-Host "Installing dependencies (npm install) ..."
  npm install --no-audit --no-fund
}

$key = "number1"
$app = "wa-$key"

& node $pm2 delete $app 2>$null | Out-Null
& node $pm2 start ecosystem.config.js --only $app
& node $pm2 save 2>$null | Out-Null

Write-Host ""
Write-Host "$app is running under pm2 (auto-restarts on crash or unhealthy exit)."
Write-Host "Ctrl+C just detaches from the log view - the bot keeps running."
Write-Host "Stop it with: .\stop-number1.ps1"
Write-Host ""
& node $pm2 logs $app --lines 20
