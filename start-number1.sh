#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
. scripts/load-node.sh

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Run ./setup.sh first."
  exit 1
fi
if [ ! -f node_modules/pm2/bin/pm2 ]; then
  echo "Installing dependencies (npm install) ..."
  npm install --no-audit --no-fund
fi

key="number1"
app="wa-$key"
pm2() { node "$ROOT/node_modules/pm2/bin/pm2" "$@"; }

pm2 delete "$app" >/dev/null 2>&1 || true
bash scripts/cleanup.sh "$key" || true
pm2 start ecosystem.config.js --only "$app"
pm2 save >/dev/null 2>&1 || true

echo
echo "$app is running under pm2 (auto-restarts on crash or unhealthy exit)."
echo "Ctrl+C just detaches from the log view — the bot keeps running."
echo "Stop it with: ./stop-number1.sh"
echo
exec node "$ROOT/node_modules/pm2/bin/pm2" logs "$app" --lines 20
