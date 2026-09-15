'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { createGraphClient } = require('./graphClient');

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE = 'https://graph.facebook.com';

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function exchangeCodeForToken({ appId, appSecret, code }) {
  const url =
    `${GRAPH_BASE}/${GRAPH_VERSION}/oauth/access_token` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&code=${encodeURIComponent(code)}`;
  const res = await fetch(url);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((payload && payload.error && payload.error.message) || `token exchange failed (HTTP ${res.status})`);
  }
  return payload.access_token;
}

async function subscribeAppToWaba({ wabaId, accessToken }) {
  const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${wabaId}/subscribed_apps`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((payload && payload.error && payload.error.message) || `subscribe failed (HTTP ${res.status})`);
  }
}

async function listWabaPhoneNumbers({ wabaId, accessToken }) {
  const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${wabaId}/phone_numbers`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((payload && payload.error && payload.error.message) || `phone_numbers lookup failed (HTTP ${res.status})`);
  }
  return (payload && payload.data) || [];
}

// Coexistence only has a window (24h from onboarding) to request this sync —
// fire it right away. Numbers that weren't onboarded from an existing
// WhatsApp Business App simply have nothing to sync, so failures here are
// logged and swallowed rather than failing the whole /connect request.
async function requestCoexistenceSync({ phoneNumberId, accessToken, log }) {
  const graph = createGraphClient({ phoneNumberId, accessToken });
  for (const syncType of ['smb_app_state_sync', 'history']) {
    try {
      const result = await graph.requestSmbAppDataSync(syncType);
      log(`Requested ${syncType} sync for phone_number_id=${phoneNumberId} (request_id=${result && result.request_id}).`);
    } catch (err) {
      log(`${syncType} sync not available for phone_number_id=${phoneNumberId}: ${err && err.message ? err.message : err} (fine if this number wasn't already using the WhatsApp Business App).`);
    }
  }
}

// Wires the public signup page + the server-side half of Meta's Embedded
// Signup flow: exchange the one-time code for a long-lived Business
// Integration System User token, subscribe this app to the customer's WABA,
// find their phone number(s), and hand each one to onNumberConnected so it
// goes live immediately — no redeploy needed.
function createEmbeddedSignupRouter({ registry, onNumberConnected, log }) {
  const router = express.Router();
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const configId = process.env.META_CONFIG_ID;
  const adminToken = process.env.CONNECT_ADMIN_TOKEN;

  router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'connect.html'));
  });

  router.get('/config', (req, res) => {
    res.json({ appId: appId || null, configId: configId || null });
  });

  router.post('/callback', express.json(), async (req, res) => {
    try {
      if (!adminToken || !timingSafeEqualStr(req.get('Authorization') || '', `Bearer ${adminToken}`)) {
        res.status(401).json({ error: 'Missing or invalid admin token.' });
        return;
      }
      if (!appId || !appSecret) {
        res.status(500).json({ error: 'META_APP_ID / META_APP_SECRET not configured on the server.' });
        return;
      }

      const { code, wabaId, phoneNumberId, label } = req.body || {};
      if (!code) {
        res.status(400).json({ error: 'Missing code.' });
        return;
      }
      if (!wabaId) {
        res.status(400).json({ error: 'Missing wabaId (expected from the Embedded Signup postMessage event).' });
        return;
      }

      const accessToken = await exchangeCodeForToken({ appId, appSecret, code });
      await subscribeAppToWaba({ wabaId, accessToken });

      let phoneNumberIds = phoneNumberId ? [phoneNumberId] : [];
      if (phoneNumberIds.length === 0) {
        const numbers = await listWabaPhoneNumbers({ wabaId, accessToken });
        phoneNumberIds = numbers.map((n) => n.id);
      }
      if (phoneNumberIds.length === 0) {
        res.status(400).json({ error: 'No phone numbers found on this WhatsApp Business Account.' });
        return;
      }

      const connected = [];
      for (const id of phoneNumberIds) {
        const entry = {
          key: id,
          label: label || `WABA ${wabaId} / ${id}`,
          phoneNumberId: id,
          accessToken,
          wabaId,
          connectedAt: new Date().toISOString(),
        };
        registry.upsert(entry);
        onNumberConnected(entry);
        connected.push({ phoneNumberId: id, label: entry.label });
        log(`Connected via Embedded Signup: ${entry.label} (phone_number_id=${id}, waba=${wabaId}).`);
        requestCoexistenceSync({ phoneNumberId: id, accessToken, log }).catch(() => {});
      }

      res.json({ ok: true, connected });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      log(`Embedded Signup callback failed: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}

module.exports = { createEmbeddedSignupRouter };
