'use strict';

const fs = require('fs');

function today() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function createDailyCap(filePath, limit) {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  let date = today();
  let count = 0;

  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (raw && raw.date === date && Number.isFinite(raw.count) && raw.count >= 0) {
        count = Math.floor(raw.count);
      }
    }
  } catch (err) {
    console.error(`[dailyCap] could not read ${filePath}: ${err.message}. Starting at 0.`);
  }

  function roll() {
    const t = today();
    if (t !== date) {
      date = t;
      count = 0;
    }
  }

  function persist() {
    const tmp = `${filePath}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ date, count }));
      fs.renameSync(tmp, filePath);
    } catch (err) {
      console.error(`[dailyCap] could not write ${filePath}: ${err.message}`);
    }
  }

  return {
    enabled: () => cap > 0,
    limit: () => cap,
    used: () => {
      roll();
      return count;
    },
    reached: () => {
      if (cap <= 0) return false;
      roll();
      return count >= cap;
    },
    record: () => {
      if (cap <= 0) return;
      roll();
      count += 1;
      persist();
    },
  };
}

module.exports = { createDailyCap };
