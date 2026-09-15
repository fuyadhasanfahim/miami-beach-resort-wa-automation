'use strict';

const crypto = require('crypto');
const express = require('express');

// Meta signs every POST body with the app secret; reject anything that
// doesn't match so the webhook can't be spoofed by a third party.
function verifySignature(appSecret, rawBody, signatureHeader) {
  if (!appSecret) return true;
  if (!signatureHeader || !rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createWebhookRouter({ verifyToken, instances, log }) {
  const router = express.Router();

  // Meta calls this once, at setup time, to confirm you own the endpoint.
  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === verifyToken) {
      log('Webhook verified by Meta.');
      res.status(200).send(challenge);
      return;
    }
    res.sendStatus(403);
  });

  // Meta requires a fast 200 ack; do the actual work after responding.
  router.post('/', (req, res) => {
    res.sendStatus(200);

    const body = req.body;
    if (!body || body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const phoneNumberId = value.metadata && value.metadata.phone_number_id;
        const instance = instances.get(phoneNumberId);
        if (!instance) {
          if (phoneNumberId) log(`Webhook event for unconfigured phone_number_id=${phoneNumberId}, ignoring.`);
          continue;
        }
        for (const message of value.messages || []) {
          instance.handleIncomingMessage(message);
        }
      }
    }
  });

  return router;
}

module.exports = { createWebhookRouter, verifySignature };
