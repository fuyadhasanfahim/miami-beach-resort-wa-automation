#!/usr/bin/env bash
# Full environment setup for the WhatsApp auto-reply bot.
# Works on Linux, macOS, and Windows (Git Bash / WSL).
# Installs a local copy of Node.js if the system has none, then installs
# dependencies and the Chromium that WhatsApp Web needs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

MIN_NODE_MAJOR=18
NODE_VERSION_FALLBACK="24.20.0"
VENDOR_DIR="$ROOT/vendor/node"

log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[setup]\033[0m %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

fetch_stdout() {
  if have curl; then curl -fsSL "$1"
  elif have wget; then wget -qO- "$1"
  else die "Need 'curl' or 'wget' installed."
  fi
}

fetch_file() {
  if have curl; then curl -fSL --retry 3 -o "$2" "$1"
  elif have wget; then wget -O "$2" "$1"
  else die "Need 'curl' or 'wget' installed."
  fi
}

UNAME_S="$(uname -s 2>/dev/null || echo unknown)"
UNAME_M="$(uname -m 2>/dev/null || echo unknown)"

case "$UNAME_S" in
  Linux*)              OS=linux;  PKG_EXT=tar.gz ;;
  Darwin*)             OS=darwin; PKG_EXT=tar.gz ;;
  MINGW*|MSYS*|CYGWIN*)OS=win;    PKG_EXT=zip ;;
  *) die "Unsupported OS: $UNAME_S (use Linux, macOS, or Windows Git Bash/WSL)." ;;
esac

case "$UNAME_M" in
  x86_64|amd64)  ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  armv7l)        ARCH=armv7l ;;
  *) die "Unsupported CPU architecture: $UNAME_M" ;;
esac

log "Platform: $OS-$ARCH"

. "$ROOT/scripts/load-node.sh"

node_ok() {
  have node || return 1
  local major
  major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
  [ -n "$major" ] && [ "$major" -ge "$MIN_NODE_MAJOR" ]
}

install_node() {
  local ver url pkg tmp
  ver="$(fetch_stdout https://nodejs.org/dist/index.json 2>/dev/null \
        | tr '{' '\n' | grep '"lts":"' | head -1 \
        | sed -E 's/.*"version":"v([0-9]+\.[0-9]+\.[0-9]+)".*/\1/' || true)"
  [ -z "${ver:-}" ] && ver="$NODE_VERSION_FALLBACK"

  pkg="node-v${ver}-${OS}-${ARCH}.${PKG_EXT}"
  url="https://nodejs.org/dist/v${ver}/${pkg}"
  tmp="$(mktemp -d)"

  log "Downloading Node.js v${ver} ($pkg)"
  fetch_file "$url" "$tmp/$pkg"

  rm -rf "$VENDOR_DIR"
  mkdir -p "$VENDOR_DIR"

  log "Extracting Node.js"
  if [ "$PKG_EXT" = zip ]; then
    if have unzip; then
      unzip -q "$tmp/$pkg" -d "$VENDOR_DIR"
    elif have powershell.exe; then
      powershell.exe -NoProfile -Command "Expand-Archive -Force '$tmp/$pkg' '$VENDOR_DIR'"
    else
      die "Need 'unzip' or PowerShell to extract Node on Windows."
    fi
  else
    tar -xf "$tmp/$pkg" -C "$VENDOR_DIR"
  fi

  rm -rf "$tmp"
  . "$ROOT/scripts/load-node.sh"
}

if node_ok; then
  log "Node.js found: $(node -v)"
else
  warn "Node.js $MIN_NODE_MAJOR+ not found. Installing a local copy in vendor/node ..."
  install_node
  node_ok || die "Node.js install failed."
  log "Installed Node.js: $(node -v)"
fi

log "npm: $(npm -v)"

log "Installing dependencies (npm install) ..."
npm install --no-audit --no-fund

if [ -f node_modules/puppeteer/install.mjs ]; then
  log "Ensuring Chromium for WhatsApp Web ..."
  node node_modules/puppeteer/install.mjs \
    || warn "Chromium download failed. Set \"executable_path\" in a config.json to a local Chrome/Chromium."
fi

if [ "$OS" = linux ]; then
  warn "On minimal Linux you may also need system libs for Chromium:"
  warn "  sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2"
fi

chmod +x "$ROOT/start-number1.sh" "$ROOT/start-number2.sh" 2>/dev/null || true

log "Setup complete."
log "Start number 1:  ./start-number1.sh"
log "Start number 2:  ./start-number2.sh"
