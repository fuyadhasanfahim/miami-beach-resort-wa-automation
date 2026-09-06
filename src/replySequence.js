'use strict';

const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildActions({ config, resolveAsset, log }) {
  const actions = [];

  if (config.reply_text && config.reply_text.trim()) {
    actions.push({ label: 'text message', run: (t) => t.sendMessage(config.reply_text) });
  }

  if (config.reply_link && config.reply_link.trim()) {
    actions.push({ label: 'link', run: (t) => t.sendMessage(config.reply_link.trim()) });
  }

  const media = [];
  for (const rel of config.images || []) media.push({ kind: 'image', abs: resolveAsset(rel) });
  if (config.video_path) media.push({ kind: 'video', abs: resolveAsset(config.video_path) });
  if (config.audio_path) media.push({ kind: 'audio', abs: resolveAsset(config.audio_path) });

  for (const m of media) {
    if (!fs.existsSync(m.abs)) {
      log(`  WARNING: file missing, skipping: ${m.abs}`);
      continue;
    }
    const label = `${m.kind} ${path.basename(m.abs)}`;
    if (m.kind === 'audio') {
      actions.push({
        label,
        run: (t) => t.sendMessage(MessageMedia.fromFilePath(m.abs), { sendAudioAsVoice: true }),
      });
    } else {
      actions.push({ label, run: (t) => t.sendMessage(MessageMedia.fromFilePath(m.abs)) });
    }
  }

  return actions;
}

async function withRetry(fn, { attempts, baseMs, label, log }) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err && err.message ? err.message : String(err);
      if (i < attempts) {
        const delay = baseMs * Math.pow(2, i - 1);
        log(`  retry ${i}/${attempts - 1} for ${label} in ${delay}ms (${msg})`);
        await wait(delay);
      } else {
        log(`  FAILED ${label} after ${attempts} attempts (${msg})`);
      }
    }
  }
  throw lastErr;
}

async function runReplySequence({ target, ctx, log, startAt = 0, onProgress }) {
  const { config, resolveAsset } = ctx;
  const gap = Number.isFinite(config.send_delay_ms) ? config.send_delay_ms : 1000;
  const attempts = Number.isFinite(config.send_retry_attempts) ? config.send_retry_attempts : 3;
  const baseMs = Number.isFinite(config.send_retry_base_ms) ? config.send_retry_base_ms : 2000;

  const actions = buildActions({ config, resolveAsset, log });

  for (let i = startAt; i < actions.length; i++) {
    const action = actions[i];
    await withRetry(() => action.run(target), { attempts, baseMs, label: action.label, log });
    log(`  sent ${action.label}`);
    if (onProgress) await onProgress(i + 1);
    if (i < actions.length - 1) await wait(gap);
  }
}

module.exports = { runReplySequence };
