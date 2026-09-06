#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
. scripts/load-node.sh
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found for this script."
  echo "Quick fix: run it directly in your terminal ->  node run.js number2"
  echo "Or run ./setup.sh to install a local copy of Node."
  exit 1
fi
[ -d node_modules ] || npm install --no-audit --no-fund
exec node run.js number2
