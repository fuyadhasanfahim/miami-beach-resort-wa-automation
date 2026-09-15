'use strict';

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE = 'https://graph.facebook.com';

// WhatsApp Cloud API error codes that will never succeed on retry
// (bad number, outside the 24h window, permanently blocked, etc).
const PERMANENT_ERROR_CODES = new Set([131026, 131021, 131047, 131030, 100]);

class WhatsAppApiError extends Error {
  constructor(message, { status, code, subcode, permanent } = {}) {
    super(message);
    this.name = 'WhatsAppApiError';
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.permanent = !!permanent;
  }
}

function toApiError(payload, status) {
  const err = (payload && payload.error) || {};
  return new WhatsAppApiError(err.message || `WhatsApp API error (HTTP ${status})`, {
    status,
    code: err.code,
    subcode: err.error_subcode,
    permanent: PERMANENT_ERROR_CODES.has(err.code),
  });
}

function createGraphClient({ phoneNumberId, accessToken }) {
  async function send(body) {
    const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {
      payload = null;
    }

    if (!res.ok) throw toApiError(payload, res.status);
    return payload;
  }

  return {
    sendText: (to, text) => send({ to, type: 'text', text: { body: text, preview_url: false } }),
    sendImageLink: (to, link) => send({ to, type: 'image', image: { link } }),
    sendVideoLink: (to, link) => send({ to, type: 'video', video: { link } }),
    sendAudioLink: (to, link) => send({ to, type: 'audio', audio: { link } }),
  };
}

module.exports = { createGraphClient, WhatsAppApiError };
