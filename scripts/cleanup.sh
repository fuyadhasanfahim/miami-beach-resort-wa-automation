#!/usr/bin/env bash
# Usage: scripts/cleanup.sh <instance>
# Stops a running bot for <instance> and clears leftovers a crash / hard-kill
# can leave behind (orphan Chromium, Chromium singleton locks). Safe to run
# even if nothing is running. Only touches the given instance.
set -e

key="${1:?usage: scripts/cleanup.sh <instance>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
session_dir="$root/instances/$key/.wwebjs_auth"

# 1. stop the node process for this instance
pkill -f "run.js $key" 2>/dev/null || true

# 2. kill any Chromium still holding this instance's browser profile
pkill -f "instances/$key/.wwebjs_auth" 2>/dev/null || true

sleep 1

# 3. remove Chromium singleton locks left by a non-clean exit
if [ -d "$session_dir" ]; then
  find "$session_dir" -maxdepth 3 \
    \( -name 'SingletonLock' -o -name 'SingletonCookie' -o -name 'SingletonSocket' \) \
    -exec rm -f {} + 2>/dev/null || true
fi

echo "cleanup: $key stopped and cleared."
