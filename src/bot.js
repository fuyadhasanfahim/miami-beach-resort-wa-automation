'use strict';

const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const { makeLogger } = require('./logger');
const { createRepliedStore } = require('./repliedStore');
const { createDispatcher } = require('./dispatcher');
const { runReplySequence } = require('./replySequence');

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

  const replied = createRepliedStore(path.join(instanceDir, 'replied.json'));
  log(`Loaded reply history: ${replied.size()} sender(s) already contacted.`);

  // Senders currently queued or being processed — stops the same person being
  // handled twice (repeat messages, or the message + message_create events).
  const inFlight = new Set();

  const executablePath =
    config.executable_path || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: instanceKey,
      dataPath: path.join(instanceDir, '.wwebjs_auth'),
    }),
    // Per-instance web-version cache. The library default is "./.wwebjs_cache/"
    // relative to the working directory, which both instances would share and
    // race on when run at the same time.
    webVersionCache: {
      type: 'local',
      path: path.join(instanceDir, '.wwebjs_cache'),
    },
    puppeteer: {
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  if (executablePath) log(`Using browser: ${executablePath}`);

  async function resolveTarget(chatId) {
    try {
      return await client.getChatById(chatId);
    } catch (_) {
      return { sendMessage: (content, opts) => client.sendMessage(chatId, content, opts) };
    }
  }

  const dispatcher = createDispatcher({
    concurrency: config.concurrency,
    log,
    processFn: async ({ senderId, chatId }) => {
      const s = dispatcher.stats();
      log(`Processing ${senderId} (active ${s.active}/${s.concurrency}, waiting ${s.pending}).`);
      try {
        const target = await resolveTarget(chatId);
        await runReplySequence({ target, ctx, log });
        replied.add(senderId);
        log(`Done ${senderId}.`);
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        log(`Failed ${senderId}: ${msg}. Not marked as replied — they'll be retried on their next message.`);
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
    log('Authenticated. Session stored, no QR needed next time.');
  });

  client.on('auth_failure', (msg) => {
    log(`Auth failure: ${msg}`);
  });

  client.on('ready', () => {
    log(`Client is ready. Concurrency = ${dispatcher.stats().concurrency}. Waiting for messages...`);
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

    if (replied.has(senderId)) {
      log(`${senderId} already replied once before. Ignoring.`);
      return;
    }
    if (inFlight.has(senderId)) {
      log(`${senderId} already queued / in progress. Ignoring.`);
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

    // Re-check after the await above, then claim the sender atomically.
    if (replied.has(senderId) || inFlight.has(senderId)) return;
    inFlight.add(senderId);

    const chatId = chat && chat.id ? chat.id._serialized : senderId;
    dispatcher.enqueue({ senderId, chatId });
    const s = dispatcher.stats();
    log(`Queued ${senderId} (active ${s.active}/${s.concurrency}, waiting ${s.pending}).`);
  }

  client.on('message', (m) => handleIncoming(m, 'message'));
  client.on('message_create', (m) => handleIncoming(m, 'message_create'));

  client.on('disconnected', (reason) => {
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
