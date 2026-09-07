'use strict';

const fs = require('fs');
const path = require('path');

const LOCK_NAMES = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket']);

function clearBrowserLocks(instanceDir, log) {
  const root = path.join(instanceDir, '.wwebjs_auth');
  if (!fs.existsSync(root)) return;

  let removed = 0;

  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (LOCK_NAMES.has(entry.name)) {
        try {
          fs.rmSync(full, { force: true });
          removed += 1;
        } catch (_) {
          /* ignore */
        }
      }
    }
  };

  walk(root, 0);
  if (removed > 0 && typeof log === 'function') {
    log(`Cleared ${removed} stale Chromium lock file(s).`);
  }
}

module.exports = { clearBrowserLocks };
