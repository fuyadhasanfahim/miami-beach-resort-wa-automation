'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');

const { makeLogger } = require('./src/logger');
const { buildNumberConfigs } = require('./src/numbers');
const { createInstance } = require('./src/instance');
const { createWebhookRouter, verifySignature } = require('./src/webhook');

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

const numberConfigs = buildNumberConfigs();
if (numberConfigs.size === 0) {
  console.error('No WhatsApp numbers configured. Set NUMBER1_PHONE_NUMBER_ID and NUMBER1_ACCESS_TOKEN in .env.');
  process.exit(1);
}

const instances = new Map();
for (const [phoneNumberId, cfg] of numberConfigs) {
  instances.set(phoneNumberId, createInstance({ cfg, publicBaseUrl: PUBLIC_BASE_URL }));
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
