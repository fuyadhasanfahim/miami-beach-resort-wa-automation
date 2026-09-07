'use strict';

const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { withTimeout } = require('./withTimeout');
const { randInt } = require('./rand');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PERMANENT_RE =
  /(invalid wid|not registered|not-registered|number is not|no such|not a valid|unable to send|wid error|not-authorized|forbidden|blocked)/i;

function isPermanentError(err) {
  const msg = (err && err.message ? err.message : String(err)).toLowerCase();
  return PERMANENT_RE.test(msg);
}

function createReplyPlan({ config, resolveAsset, log }) {
  const actions = [];

  const text = (config.reply_text || '').trim();
  if (text) {
    actions.push({
      label: 'text message',
      heavy: false,
      run: (t) => t.sendMessage(text, { linkPreview: false }),
    });
  }

  const link = (config.reply_link || '').trim();
  if (link) {
    actions.push({
      label: 'link',
      heavy: false,
      run: (t) => t.sendMessage(link, { linkPreview: false }),
    });
  }

  const media = [];
  for (const rel of config.images || []) media.push({ kind: 'image', abs: resolveAsset(rel) });
  if (config.video_path) media.push({ kind: 'video', abs: resolveAsset(config.video_path) });
  if (config.audio_path) media.push({ kind: 'audio', abs: resolveAsset(config.audio_path) });

  for (const m of media) {
    if (!fs.existsSync(m.abs)) {
      log(`asset missing, skipped: ${m.abs}`);
      continue;
    }
    const payload = MessageMedia.fromFilePath(m.abs);
    const options = m.kind === 'audio' ? { sendAudioAsVoice: true } : undefined;
    actions.push({
      label: `${m.kind} ${path.basename(m.abs)}`,
      heavy: m.kind === 'video' || m.kind === 'audio',
      run: (t) => t.sendMessage(payload, options),
    });
  }

  return { actions, count: actions.length };
}

async function withRetry(fn, { attempts, baseMs, timeoutMs, label, log }) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await withTimeout(fn, timeoutMs, label);
    } catch (err) {
      lastErr = err;
      const msg = err && err.message ? err.message : String(err);
      if (isPermanentError(err)) {
        err.permanent = true;
        log(`giving up ${label} (permanent: ${msg})`);
        throw err;
      }
      if (i < attempts) {
        const delay = baseMs * 2 ** (i - 1);
        log(`retry ${i}/${attempts - 1} ${label} in ${delay}ms (${msg})`);
        await wait(delay);
      } else {
        log(`failed ${label} after ${attempts} attempt(s) (${msg})`);
      }
    }
  }
  throw lastErr;
}

async function runReplySequence({ plan, target, settings, startIndex = 0, onProgress, log }) {
  const { actions } = plan;
  const begin = Math.max(0, Math.min(startIndex, actions.length));

  if (begin === 0 && settings.preReplyMaxMs > 0) {
    await wait(randInt(0, settings.preReplyMaxMs));
  }

  for (let i = begin; i < actions.length; i += 1) {
    const action = actions[i];

    if (i > begin) {
      await wait(randInt(settings.sendDelayMinMs, settings.sendDelayMaxMs));
    }
    if (action.heavy && settings.heavyMediaMaxMs > 0) {
      await wait(randInt(settings.heavyMediaMinMs, settings.heavyMediaMaxMs));
    }

    await withRetry(() => action.run(target), {
      attempts: settings.sendRetryAttempts,
      baseMs: settings.sendRetryBaseMs,
      timeoutMs: settings.actionTimeoutMs,
      label: action.label,
      log,
    });
    log(`sent ${action.label} (${i + 1}/${actions.length})`);
    if (onProgress) onProgress(i + 1);
  }
}

module.exports = { createReplyPlan, runReplySequence, isPermanentError };
