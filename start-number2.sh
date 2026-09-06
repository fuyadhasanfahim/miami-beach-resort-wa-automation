#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
. scripts/load-node.sh
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found for this script."
  echo "Run ./setup.sh first, or run directly:  node run.js number2"
  exit 1
fi
[ -d node_modules ] || npm install --no-audit --no-fund
bash scripts/cleanup.sh number2
exec node run.js number2
