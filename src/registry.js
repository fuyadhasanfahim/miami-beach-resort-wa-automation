'use strict';

const fs = require('fs');
const path = require('path');

// Numbers connected later through Embedded Signup — kept separate from the
// static NUMBER1_*/NUMBER2_* env vars so new numbers can be added at
// runtime, with no redeploy and no manual .env edit.
const REGISTRY_PATH = path.join(__dirname, '..', 'numbers', 'registry.json');

function load() {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
      if (Array.isArray(raw)) return raw;
    }
  } catch (err) {
    console.error(`[registry] could not read ${REGISTRY_PATH}: ${err.message}`);
  }
  return [];
}

function save(entries) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  const tmp = `${REGISTRY_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, REGISTRY_PATH);
}

// Adds a number, or replaces it (by phoneNumberId) if it was connected
// before — a re-connect through the signup page refreshes its token live.
function upsert(entry) {
  const entries = load().filter((e) => e.phoneNumberId !== entry.phoneNumberId);
  entries.push(entry);
  save(entries);
  return entries;
}

module.exports = { load, upsert };
