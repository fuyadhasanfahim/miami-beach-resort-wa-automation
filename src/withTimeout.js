'use strict';

class TimeoutError extends Error {
  constructor(label, ms) {
    super(`${label || 'operation'} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

function withTimeout(input, ms, label) {
  let work;
  try {
    work = typeof input === 'function' ? input() : input;
  } catch (err) {
    return Promise.reject(err);
  }

  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve(work);
  }

  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    if (timer.unref) timer.unref();
  });

  return Promise.race([Promise.resolve(work), guard]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout, TimeoutError };
