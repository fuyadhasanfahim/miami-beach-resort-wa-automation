'use strict';

const fs = require('fs');

function createProgressStore(filePath) {
  let map = new Map();

  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        map = new Map(
          Object.entries(raw).filter(([, v]) => Number.isFinite(v) && v > 0),
        );
      }
    }
  } catch (err) {
    console.error(`[progressStore] could not read ${filePath}: ${err.message}. Starting empty.`);
  }

  function persist() {
    const tmp = `${filePath}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)));
      fs.renameSync(tmp, filePath);
    } catch (err) {
      console.error(`[progressStore] could not write ${filePath}: ${err.message}`);
    }
  }

  return {
    get: (id) => map.get(id) || 0,
    set: (id, count) => {
      if (!Number.isFinite(count) || count <= 0) return;
      if (map.get(id) === count) return;
      map.set(id, count);
      persist();
    },
    clear: (id) => {
      if (!map.has(id)) return;
      map.delete(id);
      persist();
    },
    size: () => map.size,
  };
}

module.exports = { createProgressStore };
