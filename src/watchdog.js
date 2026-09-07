'use strict';

const { withTimeout } = require('./withTimeout');

function startWatchdog({ client, dispatcher, settings, log, onUnhealthy }) {
  let failures = 0;
  let stopped = false;
  let busy = false;

  const trip = (reason) => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    onUnhealthy(reason);
  };

  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const longest = dispatcher.runningFor();
      if (longest > settings.stuckJobMs) {
        log(`watchdog: job running ${Math.round(longest / 1000)}s (limit ${Math.round(settings.stuckJobMs / 1000)}s).`);
        trip('stuck job');
        return;
      }

      let state = null;
      try {
        state = await withTimeout(() => client.getState(), settings.healthTimeoutMs, 'getState');
      } catch (err) {
        log(`watchdog: getState failed (${err && err.message ? err.message : err}).`);
      }

      if (state === 'CONNECTED') {
        if (failures > 0) log('watchdog: connection healthy again.');
        failures = 0;
        return;
      }

      failures += 1;
      log(`watchdog: unhealthy state=${state} (${failures}/${settings.healthMaxFailures}).`);
      if (failures >= settings.healthMaxFailures) {
        trip(`unhealthy state ${state}`);
      }
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(tick, settings.healthIntervalMs);
  if (timer.unref) timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

module.exports = { startWatchdog };
