'use strict';

const fs = require('fs');
const path = require('path');

const { makeLogger } = require('./logger');
const { createRepliedStore } = require('./repliedStore');
const { createProgressStore } = require('./progressStore');
const { createDailyCap } = require('./dailyCap');
const { createDispatcher } = require('./dispatcher');
const { createGraphClient } = require('./graphClient');
const { createReplyPlan, runReplySequence } = require('./replySequence');
const { resolveSettings } = require('./settings');

const ROOT = path.join(__dirname, '..');

// Wires one WhatsApp number end to end: its own reply history, its own
// concurrency pool, its own daily cap — all namespaced under numbers/<key>/.
function createInstance({ cfg, publicBaseUrl }) {
  const log = makeLogger(cfg.label);
  const dataDir = path.join(ROOT, 'numbers', cfg.key);
  fs.mkdirSync(dataDir, { recursive: true });

  const replied = createRepliedStore(path.join(dataDir, 'replied.json'));
  const progress = createProgressStore(path.join(dataDir, 'progress.json'));
  const dailyCap = createDailyCap(path.join(dataDir, 'daily.json'), cfg.dailyNewContactCap);
  const settings = resolveSettings(cfg);

  const graph = createGraphClient({ phoneNumberId: cfg.phoneNumberId, accessToken: cfg.accessToken });
  const plan = createReplyPlan({ publicBaseUrl, log });
  log(
    `Reply plan: ${plan.count} item(s) per sender. Reply history: ${replied.size()} completed, ${progress.size()} partial.`,
  );
  if (dailyCap.enabled()) {
    log(`Daily new-contact cap: ${dailyCap.limit()} (used ${dailyCap.used()} today).`);
  }

  const inFlight = new Set();

  const dispatcher = createDispatcher({
    concurrency: settings.concurrency,
    jobTimeoutMs: settings.jobTimeoutMs,
    log,
    processFn: async ({ senderId }) => {
      const stats = dispatcher.stats();
      const startIndex = Math.min(progress.get(senderId), plan.count);
      const resume = startIndex > 0 ? ` resuming ${startIndex + 1}/${plan.count}` : '';
      log(`Processing ${senderId}${resume} (active ${stats.active}/${stats.concurrency}, waiting ${stats.pending}).`);
      try {
        await runReplySequence({
          plan,
          graph,
          to: senderId,
          settings,
          startIndex,
          onProgress: (n) => progress.set(senderId, n),
          log,
        });
        replied.add(senderId);
        progress.clear(senderId);
        dailyCap.record();
        const tally = dailyCap.enabled() ? ` (${dailyCap.used()}/${dailyCap.limit()} today)` : '';
        log(`Done ${senderId}.${tally}`);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        if (err && err.permanent) {
          replied.add(senderId);
          progress.clear(senderId);
          log(`Failed ${senderId}: ${msg}. Permanent — marked replied, will not retry.`);
        } else {
          log(`Failed ${senderId}: ${msg}. Progress ${progress.get(senderId)}/${plan.count} saved; retries on next message.`);
        }
      } finally {
        inFlight.delete(senderId);
      }
    },
  });

  function handleIncomingMessage(message) {
    const senderId = message && message.from;
    if (!senderId) return;
    log(`Inbound from=${senderId} type=${message.type}`);

    if (plan.count === 0) return;
    if (replied.has(senderId)) {
      log(`${senderId} already replied once before. Ignoring.`);
      return;
    }
    if (inFlight.has(senderId)) {
      log(`${senderId} already queued / in progress. Ignoring.`);
      return;
    }
    if (dailyCap.reached()) {
      log(`Daily new-contact cap reached (${dailyCap.limit()}). Ignoring ${senderId} until tomorrow.`);
      return;
    }

    inFlight.add(senderId);
    dispatcher.enqueue({ senderId });
    const stats = dispatcher.stats();
    log(`Queued ${senderId} (active ${stats.active}/${stats.concurrency}, waiting ${stats.pending}).`);
  }

  return { cfg, replied, progress, dailyCap, handleIncomingMessage };
}

module.exports = { createInstance };
