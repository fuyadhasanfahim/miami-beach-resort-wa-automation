'use strict';

const fs = require('fs');
const path = require('path');
const { withTimeout } = require('./withTimeout');
const { randInt } = require('./rand');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readAssetText(relPath) {
  return fs.readFileSync(path.join(ASSETS_DIR, relPath), 'utf8').trim();
}

// Media is sent by public https link (served from this server's /assets route)
// rather than pre-uploaded to Meta, so the same static files work for both
// numbers with no media-id bookkeeping.
function createReplyPlan({ publicBaseUrl, log }) {
  const actions = [];

  let text = '';
  try {
    text = readAssetText('message.txt');
  } catch (_) {}
  if (text) actions.push({ label: 'text message', heavy: false, kind: 'text', payload: text });

  let link = '';
  try {
    link = readAssetText('link.txt');
  } catch (_) {}
  if (link) actions.push({ label: 'link', heavy: false, kind: 'text', payload: link });

  let images = [];
  try {
    images = fs
      .readdirSync(path.join(ASSETS_DIR, 'images'))
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort();
  } catch (_) {}
  for (const img of images) {
    actions.push({
      label: `image ${img}`,
      heavy: false,
      kind: 'image',
      payload: `${publicBaseUrl}/assets/images/${img}`,
    });
  }

  if (fs.existsSync(path.join(ASSETS_DIR, 'video.mp4'))) {
    actions.push({ label: 'video', heavy: true, kind: 'video', payload: `${publicBaseUrl}/assets/video.mp4` });
  }
  if (fs.existsSync(path.join(ASSETS_DIR, 'voice.ogg'))) {
    actions.push({ label: 'audio', heavy: true, kind: 'audio', payload: `${publicBaseUrl}/assets/voice.ogg` });
  }

  if (actions.length === 0 && typeof log === 'function') {
    log('No reply actions configured (no text, link, or media found under assets/).');
  }

  return { actions, count: actions.length };
}

function sendAction(graph, to, action) {
  switch (action.kind) {
    case 'text':
      return graph.sendText(to, action.payload);
    case 'image':
      return graph.sendImageLink(to, action.payload);
    case 'video':
      return graph.sendVideoLink(to, action.payload);
    case 'audio':
      return graph.sendAudioLink(to, action.payload);
    default:
      throw new Error(`Unknown action kind: ${action.kind}`);
  }
}

async function withRetry(fn, { attempts, baseMs, timeoutMs, label, log }) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await withTimeout(fn, timeoutMs, label);
    } catch (err) {
      lastErr = err;
      const msg = err && err.message ? err.message : String(err);
      if (err && err.permanent) {
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

async function runReplySequence({ plan, graph, to, settings, startIndex = 0, onProgress, log }) {
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

    await withRetry(() => sendAction(graph, to, action), {
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

module.exports = { createReplyPlan, runReplySequence };
