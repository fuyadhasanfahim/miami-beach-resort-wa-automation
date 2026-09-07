'use strict';

const { withTimeout } = require('./withTimeout');

function createDispatcher({ concurrency, processFn, log, jobTimeoutMs }) {
  const max = Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 3;
  const pending = [];
  const running = new Map();
  let active = 0;
  let seq = 0;

  function pump() {
    while (active < max && pending.length > 0) {
      const job = pending.shift();
      const id = (seq += 1);
      active += 1;
      running.set(id, Date.now());

      withTimeout(() => processFn(job), jobTimeoutMs, `job ${job && job.senderId}`)
        .catch((err) => log(`dispatcher: ${err && err.message ? err.message : err}`))
        .finally(() => {
          running.delete(id);
          active -= 1;
          pump();
        });
    }
  }

  return {
    enqueue(job) {
      pending.push(job);
      pump();
    },
    stats() {
      return { active, pending: pending.length, concurrency: max };
    },
    runningFor() {
      let longest = 0;
      const now = Date.now();
      for (const startedAt of running.values()) {
        longest = Math.max(longest, now - startedAt);
      }
      return longest;
    },
  };
}

module.exports = { createDispatcher };
