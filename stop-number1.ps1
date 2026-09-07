# Stop WhatsApp number 1 (native Windows PowerShell).
$ErrorActionPreference = "SilentlyContinue"
Set-Location $PSScriptRoot

$vendor = Join-Path $PSScriptRoot "vendor\node"
if (Test-Path $vendor) {
  $bin = Get-ChildItem -Path $vendor -Directory -Filter "node-v*-win-*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($bin) { $env:Path = "$($bin.FullName);$env:Path" }
}

$app = "wa-number1"
$pm2 = "node_modules\pm2\bin\pm2"

if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path $pm2)) {
  & node $pm2 delete $app 2>$null | Out-Null
  & node $pm2 save 2>$null | Out-Null
}

Write-Host "$app stopped."
