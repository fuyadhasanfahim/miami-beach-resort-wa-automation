'use strict';

const { runReplySequence } = require('./replySequence');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startWorker({ store, client, ctx, log, isReady }) {
  const { config } = ctx;
  const idlePollMs = 1000;
  const gap = Number.isFinite(config.inter_contact_gap_ms) ? config.inter_contact_gap_ms : 3000;
  const maxJobAttempts = Number.isFinite(config.max_job_attempts) ? config.max_job_attempts : 3;

  let running = true;

  async function resolveTarget(chatId) {
    try {
      return await client.getChatById(chatId);
    } catch (_) {
      return { sendMessage: (content, opts) => client.sendMessage(chatId, content, opts) };
    }
  }

  async function processJob(job) {
    const sender = job.sender;
    const progress = job.progress || 0;
    const attempts = job.attempts || 1;

    if (await store.hasReplied(sender)) {
      log(`Queue: ${sender} already replied; dropping job.`);
      await store.completeJob(sender);
      return;
    }

    log(`Queue: processing ${sender} (attempt ${attempts}/${maxJobAttempts}, from step ${progress}).`);
    const target = await resolveTarget(job.chatId);

    try {
      await runReplySequence({
        target,
        ctx,
        log,
        startAt: progress,
        onProgress: (n) => store.setJobProgress(sender, n),
      });
      await store.completeJob(sender);
      log(`Queue: finished ${sender}. ${await store.pendingCount()} left in queue.`);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (attempts >= maxJobAttempts) {
        log(`Queue: giving up on ${sender} after ${attempts} attempts (${msg}). Marking as replied.`);
        await store.completeJob(sender);
      } else {
        log(`Queue: ${sender} failed (${msg}). Will retry later.`);
        await store.requeueJob(sender);
      }
    }
  }

  async function loop() {
    const stale = await store.resetStaleJobs();
    if (stale) log(`Queue: reset ${stale} stale job(s) from a previous run.`);

    const pending = await store.pendingCount();
    if (pending) log(`Queue: ${pending} job(s) waiting.`);

    while (running) {
      if (!isReady()) {
        await wait(2000);
        continue;
      }

      let job;
      try {
        job = await store.claimNextJob();
      } catch (err) {
        log(`Queue: claim error (${err.message}). Retrying in 2s.`);
        await wait(2000);
        continue;
      }

      if (!job) {
        await wait(idlePollMs);
        continue;
      }

      await processJob(job);
      await wait(gap);
    }
  }

  const done = loop().catch((err) => log(`Queue: worker stopped (${err.message}).`));

  return {
    stop: async () => {
      running = false;
      await done;
    },
  };
}

module.exports = { startWorker };
