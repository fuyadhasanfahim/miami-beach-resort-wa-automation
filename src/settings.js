'use strict';

const int = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

const ms = (value, fallback) => (Number.isFinite(value) && value >= 0 ? value : fallback);

const nonNeg = (value, fallback) =>
  Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;

function resolveSettings(cfg = {}) {
  const baseGap = ms(cfg.sendDelayMs, 1000);

  return {
    concurrency: int(cfg.concurrency, 3),
    sendDelayMinMs: ms(cfg.sendDelayMinMs, baseGap),
    sendDelayMaxMs: ms(cfg.sendDelayMaxMs, Math.max(baseGap, Math.round(baseGap * 2.5))),
    heavyMediaMinMs: nonNeg(cfg.heavyMediaMinMs, 3000),
    heavyMediaMaxMs: nonNeg(cfg.heavyMediaMaxMs, 9000),
    preReplyMaxMs: nonNeg(cfg.preReplyMaxMs, 6000),
    sendRetryAttempts: int(cfg.sendRetryAttempts, 3),
    sendRetryBaseMs: int(cfg.sendRetryBaseMs, 2000),
    actionTimeoutMs: int(cfg.actionTimeoutMs, 20000),
    jobTimeoutMs: int(cfg.jobTimeoutMs, 120000),
  };
}

module.exports = { resolveSettings };
