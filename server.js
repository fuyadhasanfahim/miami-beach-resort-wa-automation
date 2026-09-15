'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');

const { makeLogger } = require('./src/logger');
const { buildNumberConfigs } = require('./src/numbers');
const { createInstance } = require('./src/instance');
const { createWebhookRouter, verifySignature } = require('./src/webhook');
const registry = require('./src/registry');
const { createEmbeddedSignupRouter } = require('./src/embeddedSignup');

const log = makeLogger('server');

const PORT = Number(process.env.PORT) || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.APP_SECRET;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

if (!VERIFY_TOKEN) {
  console.error('Missing VERIFY_TOKEN in .env (used to verify the webhook with Meta).');
  process.exit(1);
}
if (!PUBLIC_BASE_URL) {
  console.error('Missing PUBLIC_BASE_URL in .env (public https URL, e.g. https://wa.yourdomain.com).');
  process.exit(1);
}

// Numbers can come from two places: static NUMBER1_*/NUMBER2_* env vars, or
// numbers/registry.json (written by the /connect Embedded Signup flow).
// Either can be empty at boot — /connect can add the very first number live.
const instances = new Map();

function registerNumber(cfg) {
  instances.set(cfg.phoneNumberId, createInstance({ cfg, publicBaseUrl: PUBLIC_BASE_URL }));
}

for (const [, cfg] of buildNumberConfigs()) registerNumber(cfg);
for (const entry of registry.load()) registerNumber(entry);

if (instances.size === 0) {
  log('No WhatsApp numbers configured yet. Set NUMBER1_* in .env, or connect one at /connect.');
}

if (!APP_SECRET) {
  log('APP_SECRET not set — webhook signature verification is DISABLED. Set it before going live.');
}

const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) => {
  res.json({ ok: true, numbers: [...instances.values()].map((i) => i.cfg.label) });
});

app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d' }));

app.use(
  '/connect',
  createEmbeddedSignupRouter({ registry, onNumberConnected: registerNumber, log }),
);

app.use(
  '/webhook',
  express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }),
  (req, res, next) => {
    if (req.method !== 'POST') return next();
    if (!verifySignature(APP_SECRET, req.rawBody, req.get('X-Hub-Signature-256'))) {
      log('Webhook signature verification failed. Rejecting request.');
      return res.sendStatus(401);
    }
    return next();
  },
  createWebhookRouter({ verifyToken: VERIFY_TOKEN, instances, log }),
);

app.listen(PORT, () => {
  log(`Listening on port ${PORT}. Configure Meta's webhook callback URL as ${PUBLIC_BASE_URL}/webhook`);
});
