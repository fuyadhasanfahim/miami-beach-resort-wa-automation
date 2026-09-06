'use strict';

// A tiny concurrency pool. Jobs are queued FIFO and up to `concurrency` of them
// run at the same time. Each job itself still sends its items one-by-one; this
// only lets several *different* senders be served in parallel.
function createDispatcher({ concurrency, processFn, log }) {
  const max = Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 3;
  const pending = [];
  let active = 0;

  function pump() {
    while (active < max && pending.length > 0) {
      const job = pending.shift();
      active += 1;
      Promise.resolve()
        .then(() => processFn(job))
        .catch((err) => log(`dispatcher: unhandled error (${err && err.message ? err.message : err})`))
        .finally(() => {
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
  };
}

module.exports = { createDispatcher };
