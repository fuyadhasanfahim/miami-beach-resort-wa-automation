'use strict';

const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { withTimeout } = require('./withTimeout');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createReplyPlan({ config, resolveAsset, log }) {
  const actions = [];

  const text = (config.reply_text || '').trim();
  if (text) {
    actions.push({
      label: 'text message',
      run: (t) => t.sendMessage(text, { linkPreview: false }),
    });
  }

  const link = (config.reply_link || '').trim();
  if (link) {
    actions.push({
      label: 'link',
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

  for (let i = begin; i < actions.length; i += 1) {
    const action = actions[i];
    await withRetry(() => action.run(target), {
      attempts: settings.sendRetryAttempts,
      baseMs: settings.sendRetryBaseMs,
      timeoutMs: settings.actionTimeoutMs,
      label: action.label,
      log,
    });
    log(`sent ${action.label} (${i + 1}/${actions.length})`);
    if (onProgress) onProgress(i + 1);
    if (i < actions.length - 1) await wait(settings.sendDelayMs);
  }
}

module.exports = { createReplyPlan, runReplySequence };
