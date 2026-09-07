'use strict';

const int = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

const ms = (value, fallback) => (Number.isFinite(value) && value >= 0 ? value : fallback);

function resolveSettings(config = {}) {
  return {
    concurrency: int(config.concurrency, 3),
    sendDelayMs: ms(config.send_delay_ms, 1000),
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
