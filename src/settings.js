'use strict';

const int = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

const ms = (value, fallback) => (Number.isFinite(value) && value >= 0 ? value : fallback);

const nonNeg = (value, fallback) =>
  Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;

function resolveSettings(config = {}) {
  const baseGap = ms(config.send_delay_ms, 1000);

  return {
    concurrency: int(config.concurrency, 3),
    sendDelayMinMs: ms(config.send_delay_min_ms, baseGap),
    sendDelayMaxMs: ms(config.send_delay_max_ms, Math.max(baseGap, Math.round(baseGap * 2.5))),
    heavyMediaMinMs: nonNeg(config.heavy_media_delay_min_ms, 3000),
    heavyMediaMaxMs: nonNeg(config.heavy_media_delay_max_ms, 9000),
    preReplyMaxMs: nonNeg(config.pre_reply_delay_max_ms, 6000),
    dailyNewContactCap: nonNeg(config.daily_new_contact_cap, 0),
    sendRetryAttempts: int(config.send_retry_attempts, 3),
    sendRetryBaseMs: int(config.send_retry_base_ms, 2000),
    actionTimeoutMs: int(config.action_timeout_ms, 45000),
    sequenceTimeoutMs: int(config.sequence_timeout_ms, 240000),
    jobTimeoutMs: int(config.job_timeout_ms, 300000),
    chatResolveTimeoutMs: int(config.chat_resolve_timeout_ms, 20000),
    protocolTimeoutMs: int(config.protocol_timeout_ms, 180000),
    healthIntervalMs: int(config.health_check_interval_ms, 60000),
    healthTimeoutMs: int(config.health_check_timeout_ms, 20000),
    healthMaxFailures: int(config.health_check_max_failures, 3),
    stuckJobMs: int(config.stuck_job_ms, 600000),
  };
}

module.exports = { resolveSettings };
