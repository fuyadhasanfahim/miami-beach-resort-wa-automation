'use strict';

const fs = require('fs');

// Remembers which senders have already received the reply sequence, so each
// sender is only ever replied to once. Backed by a plain JSON array on disk
// (no database, no network). To let everyone get the sequence again, delete
// the instance's replied.json file.
function createRepliedStore(filePath) {
  let ids = new Set();

  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(raw)) ids = new Set(raw);
    }
  } catch (err) {
    console.error(`[repliedStore] could not read ${filePath}: ${err.message}. Starting empty.`);
  }

  function persist() {
    const tmp = `${filePath}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify([...ids]));
      fs.renameSync(tmp, filePath);
    } catch (err) {
      console.error(`[repliedStore] could not write ${filePath}: ${err.message}`);
    }
  }

  return {
    has: (id) => ids.has(id),
    add: (id) => {
      if (!ids.has(id)) {
        ids.add(id);
        persist();
      }
    },
    size: () => ids.size,
  };
}

module.exports = { createRepliedStore };
