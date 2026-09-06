# Full environment setup for native Windows PowerShell.
# (Linux / macOS / Git Bash / WSL users: run ./setup.sh instead.)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$minMajor = 18
$fallback = "24.20.0"
$vendor   = Join-Path $PSScriptRoot "vendor\node"

function Have($c) { $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }

function Add-VendorNodeToPath {
  if (Test-Path $vendor) {
    $bin = Get-ChildItem -Path $vendor -Directory -Filter "node-v*-win-*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($bin) { $env:Path = "$($bin.FullName);$env:Path" }
  }
}

function Test-NodeOk {
  if (-not (Have node)) { return $false }
  try { [int]((node -v) -replace '^v','').Split('.')[0] -ge $minMajor } catch { $false }
}

Add-VendorNodeToPath

if (Test-NodeOk) {
  Write-Host "[setup] Node.js found: $(node -v)"
} else {
  Write-Host "[setup] Node.js $minMajor+ not found. Installing a local copy in vendor\node ..."

  $ver = ""
  try {
    $json = Invoke-WebRequest "https://nodejs.org/dist/index.json" -UseBasicParsing
    $ver = ($json.Content | ConvertFrom-Json | Where-Object { $_.lts } | Select-Object -First 1).version -replace '^v',''
  } catch { }
  if (-not $ver) { $ver = $fallback }

  $arch = "x64"
  if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $arch = "arm64" }
  elseif (-not [Environment]::Is64BitOperatingSystem) { $arch = "x86" }

  $zip = "node-v$ver-win-$arch.zip"
  $url = "https://nodejs.org/dist/v$ver/$zip"
  $tmp = Join-Path $env:TEMP $zip

  Write-Host "[setup] Downloading $url"
  Invoke-WebRequest $url -OutFile $tmp -UseBasicParsing

  if (Test-Path $vendor) { Remove-Item -Recurse -Force $vendor }
  New-Item -ItemType Directory -Force -Path $vendor | Out-Null
  Expand-Archive -Force $tmp $vendor
  Remove-Item -Force $tmp

  Add-VendorNodeToPath
  if (-not (Test-NodeOk)) { throw "Node.js install failed." }
  Write-Host "[setup] Installed Node.js: $(node -v)"
}

Write-Host "[setup] npm: $(npm -v)"

Write-Host "[setup] Installing dependencies (npm install) ..."
npm install --no-audit --no-fund

if (Test-Path "node_modules\puppeteer\install.mjs") {
  Write-Host "[setup] Ensuring Chromium for WhatsApp Web ..."
  try { node "node_modules\puppeteer\install.mjs" }
  catch { Write-Warning "Chromium download failed. Set executable_path in a config.json to a local Chrome." }
}

if (-not (Test-Path ".env")) {
  Write-Warning '.env not found. Create it with: DATABASE_URL="mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/wa-automation?appName=Cluster0"'
} elseif (-not (Select-String -Path ".env" -Pattern '^DATABASE_URL=' -Quiet)) {
  Write-Warning ".env exists but has no DATABASE_URL line."
} else {
  Write-Host "[setup] .env OK (DATABASE_URL present)."
}

Write-Host "[setup] Setup complete."
Write-Host "[setup] Start number 1:  node run.js number1"
Write-Host "[setup] Start number 2:  node run.js number2"
Write-Host "[setup] (this shell already has the local Node on PATH; a new window needs setup.ps1 re-run or vendor\node added to PATH)"
