#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
. scripts/load-node.sh 2>/dev/null || true

key="number2"
app="wa-$key"

if command -v node >/dev/null 2>&1 && [ -f "$ROOT/node_modules/pm2/bin/pm2" ]; then
  node "$ROOT/node_modules/pm2/bin/pm2" delete "$app" >/dev/null 2>&1 || true
  node "$ROOT/node_modules/pm2/bin/pm2" save >/dev/null 2>&1 || true
fi

bash scripts/cleanup.sh "$key"
echo "$app stopped."
