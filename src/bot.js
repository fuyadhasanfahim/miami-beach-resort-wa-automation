'use strict';

const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const { makeLogger } = require('./logger');
const { resolveSettings } = require('./settings');
const { createRepliedStore } = require('./repliedStore');
const { createProgressStore } = require('./progressStore');
const { createDailyCap } = require('./dailyCap');
const { createDispatcher } = require('./dispatcher');
const { createReplyPlan, runReplySequence } = require('./replySequence');
const { startWatchdog } = require('./watchdog');
const { clearBrowserLocks } = require('./preflight');
const { withTimeout } = require('./withTimeout');

const IGNORED_TYPES = new Set([
  'e2e_notification',
  'notification_template',
  'gp2',
  'call_log',
  'ciphertext',
  'protocol',
  'revoked',
]);

const TERMINAL_DISCONNECTS = new Set(['LOGOUT', 'UNPAIRED', 'UNPAIRED_IDLE', 'CONFLICT']);

function isDirectChatId(id) {
  return id.endsWith('@c.us') || id.endsWith('@lid');
}

async function startBot(ctx) {
  const { instanceKey, instanceDir, config } = ctx;
  const name = config.instance_name || instanceKey;
  const log = makeLogger(name);
  const settings = resolveSettings(config);

  const replied = createRepliedStore(path.join(instanceDir, 'replied.json'));
  const progress = createProgressStore(path.join(instanceDir, 'progress.json'));
  const dailyCap = createDailyCap(path.join(instanceDir, 'daily.json'), settings.dailyNewContactCap);
  log(`Reply history: ${replied.size()} completed, ${progress.size()} partial.`);
  if (dailyCap.enabled()) {
    log(`Daily new-contact cap: ${dailyCap.limit()} (used ${dailyCap.used()} today).`);
  }

  const plan = createReplyPlan({ config, resolveAsset: ctx.resolveAsset, log });
  if (plan.count === 0) {
    log('No reply actions configured (no text, link, or media).');
  } else {
    log(`Reply plan: ${plan.count} item(s) per sender.`);
  }

  const inFlight = new Set();
  let stopping = false;
  let watchdog = null;
  let authLogged = false;

  const executablePath =
    config.executable_path || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: instanceKey,
      dataPath: path.join(instanceDir, '.wwebjs_auth'),
    }),
    webVersionCache: {
      type: 'local',
      path: path.join(instanceDir, '.wwebjs_cache'),
    },
    puppeteer: {
      headless: true,
      executablePath,
      protocolTimeout: settings.protocolTimeoutMs,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  if (executablePath) log(`Using browser: ${executablePath}`);

  async function hardExit(reason, code) {
    if (stopping) return;
    stopping = true;
    if (watchdog) watchdog.stop();
    log(`Exiting (${reason}). Supervisor will restart if code != 0.`);
    try {
      await withTimeout(() => client.destroy(), 15000, 'client.destroy');
    } catch (err) {
      log(`destroy on exit failed (${err && err.message ? err.message : err}).`);
    }
    process.exit(code);
  }

  async function resolveTarget(chatId) {
    try {
      return await withTimeout(
        () => client.getChatById(chatId),
        settings.chatResolveTimeoutMs,
        'getChatById',
      );
    } catch (_) {
      return { sendMessage: (content, opts) => client.sendMessage(chatId, content, opts) };
    }
  }

  const dispatcher = createDispatcher({
    concurrency: settings.concurrency,
    jobTimeoutMs: settings.jobTimeoutMs,
    log,
    processFn: async ({ senderId, chatId }) => {
      const stats = dispatcher.stats();
      const startIndex = Math.min(progress.get(senderId), plan.count);
      const resume = startIndex > 0 ? ` resuming ${startIndex + 1}/${plan.count}` : '';
      log(`Processing ${senderId}${resume} (active ${stats.active}/${stats.concurrency}, waiting ${stats.pending}).`);
      try {
        const target = await resolveTarget(chatId);
        await withTimeout(
          () =>
            runReplySequence({
              plan,
              target,
              settings,
              startIndex,
              onProgress: (n) => progress.set(senderId, n),
              log,
            }),
          settings.sequenceTimeoutMs,
          `sequence ${senderId}`,
        );
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

  client.on('qr', (qr) => {
    log('Scan this QR in WhatsApp > Linked devices:');
    qrcode.generate(qr, { small: true });
  });

  client.on('loading_screen', (percent, message) => {
    log(`Loading ${percent}% ${message || ''}`.trim());
  });

  client.on('authenticated', () => {
    if (authLogged) return;
    authLogged = true;
    log('Authenticated. Session stored, no QR needed next time.');
  });

  client.on('auth_failure', (msg) => {
    log(`Auth failure: ${msg}`);
  });

  client.on('ready', () => {
    log(`Client ready. Concurrency = ${settings.concurrency}. Waiting for messages...`);
    if (!watchdog) {
      watchdog = startWatchdog({
        client,
        dispatcher,
        settings,
        log,
        onUnhealthy: (reason) => hardExit(`watchdog: ${reason}`, 1),
      });
      log(`Watchdog on (health check every ${Math.round(settings.healthIntervalMs / 1000)}s).`);
    }
  });

  async function handleIncoming(message, source) {
    if (message.fromMe) return;
    if (IGNORED_TYPES.has(message.type)) return;
    if (plan.count === 0) return;

    const senderId = message.from || '';
    const preview = (message.body || '').replace(/\s+/g, ' ').slice(0, 40);
    log(`Inbound (${source}) from=${senderId} type=${message.type} body="${preview}"`);

    if (senderId === 'status@broadcast' || !isDirectChatId(senderId)) {
      log(`Skipped ${senderId} (not a 1-on-1 personal chat).`);
      return;
    }
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

    let chat = null;
    try {
      chat = await withTimeout(() => message.getChat(), settings.chatResolveTimeoutMs, 'getChat');
    } catch (_) {
      chat = null;
    }
    if (chat && chat.isGroup) {
      log(`Skipped ${senderId} (group chat).`);
      return;
    }

    if (replied.has(senderId) || inFlight.has(senderId)) return;
    inFlight.add(senderId);

    const chatId = chat && chat.id ? chat.id._serialized : senderId;
    dispatcher.enqueue({ senderId, chatId });
    const stats = dispatcher.stats();
    log(`Queued ${senderId} (active ${stats.active}/${stats.concurrency}, waiting ${stats.pending}).`);
  }

  client.on('message', (m) => handleIncoming(m, 'message'));
  client.on('message_create', (m) => handleIncoming(m, 'message_create'));

  client.on('disconnected', (reason) => {
    if (stopping) return;
    if (TERMINAL_DISCONNECTS.has(reason)) {
      log(`Disconnected (${reason}). This linked device is no longer paired.`);
      log(`Open WhatsApp > Linked devices on the phone. If it stays unpaired, delete instances/${instanceKey}/.wwebjs_auth and start again to scan a fresh QR.`);
    } else {
      log(`Disconnected (${reason}).`);
    }
    hardExit(`disconnected ${reason}`, 1);
  });

  process.on('unhandledRejection', (reason) => {
    log(`UnhandledRejection: ${reason && reason.message ? reason.message : reason}`);
  });

  const shutdown = (signal) => hardExit(`${signal} received`, 0);
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  clearBrowserLocks(instanceDir, log);

  log('Initializing WhatsApp client...');
  client
    .initialize()
    .catch((e) => hardExit(`initialize failed (${e && e.message ? e.message : e})`, 1));
}

module.exports = { startBot };
