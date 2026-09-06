'use strict';

const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const { makeLogger } = require('./logger');
const { createStore } = require('./store');
const { startWorker } = require('./worker');

const IGNORED_TYPES = new Set([
  'e2e_notification',
  'notification_template',
  'gp2',
  'call_log',
  'ciphertext',
  'protocol',
  'revoked',
]);

function isDirectChatId(id) {
  return id.endsWith('@c.us') || id.endsWith('@lid');
}

async function startBot(ctx) {
  const { instanceKey, instanceDir, config } = ctx;
  const name = config.instance_name || instanceKey;
  const log = makeLogger(name);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log('DATABASE_URL is not set. Add it to .env before starting.');
    process.exit(1);
  }

  log('Connecting to database...');
  const store = await createStore({ databaseUrl, instanceKey });
  log(`Database connected. ${await store.repliedCount()} replied, ${await store.pendingCount()} in queue.`);

  const executablePath =
    config.executable_path || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: instanceKey,
      dataPath: path.join(instanceDir, '.wwebjs_auth'),
    }),
    puppeteer: {
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  if (executablePath) log(`Using browser: ${executablePath}`);

  let ready = false;
  let worker = null;

  client.on('qr', (qr) => {
    log('Scan this QR in WhatsApp > Linked devices:');
    qrcode.generate(qr, { small: true });
  });

  client.on('loading_screen', (percent, message) => {
    log(`Loading ${percent}% ${message || ''}`.trim());
  });

  client.on('authenticated', () => {
    log('Authenticated. Session stored, no QR needed next time.');
  });

  client.on('auth_failure', (msg) => {
    log(`Auth failure: ${msg}`);
  });

  client.on('ready', () => {
    ready = true;
    log('Client is ready. Waiting for incoming messages...');
    if (!worker) {
      worker = startWorker({ store, client, ctx, log, isReady: () => ready });
    }
  });

  async function handleIncoming(message, source) {
    if (message.fromMe) return;
    if (IGNORED_TYPES.has(message.type)) return;

    const senderId = message.from || '';
    const preview = (message.body || '').replace(/\s+/g, ' ').slice(0, 40);
    log(`Inbound (${source}) from=${senderId} type=${message.type} body="${preview}"`);

    if (senderId === 'status@broadcast' || !isDirectChatId(senderId)) {
      log(`Skipped ${senderId} (not a 1-on-1 personal chat).`);
      return;
    }

    let chat;
    try {
      chat = await message.getChat();
    } catch (_) {
      /* getChat can fail transiently; treat as direct chat */
    }
    if (chat && chat.isGroup) {
      log(`Skipped ${senderId} (group chat).`);
      return;
    }

    const chatId = chat && chat.id ? chat.id._serialized : senderId;

    try {
      const result = await store.enqueue({ sender: senderId, chatId });
      if (result === 'queued') {
        log(`Queued ${senderId}. ${await store.pendingCount()} in queue.`);
      } else if (result === 'already_replied') {
        log(`${senderId} already replied once before. Ignoring.`);
      } else {
        log(`${senderId} already in queue. Ignoring.`);
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      log(`Error queueing message from ${senderId}: ${msg}`);
    }
  }

  client.on('message', (m) => handleIncoming(m, 'message'));
  client.on('message_create', (m) => handleIncoming(m, 'message_create'));

  client.on('disconnected', (reason) => {
    ready = false;
    log(`Disconnected (${reason}). Re-initializing in 5s...`);
    setTimeout(() => {
      log('Re-initializing client now.');
      client.initialize().catch((e) => log(`Re-init failed: ${e.message}`));
    }, 5000);
  });

  process.on('unhandledRejection', (reason) => {
    log(`UnhandledRejection: ${reason && reason.message ? reason.message : reason}`);
  });

  async function shutdown(signal) {
    log(`${signal} received. Shutting down...`);
    try {
      if (worker) await worker.stop();
      await store.close();
      await client.destroy();
    } catch (_) {
      /* best effort */
    }
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log('Initializing WhatsApp client...');
  client.initialize().catch((e) => log(`Initialize failed: ${e.message}`));
}

module.exports = { startBot };
