'use strict';

// Reads NUMBER1_* / NUMBER2_* variables from the environment and returns a
// Map keyed by phone_number_id (how Meta's webhook payload identifies which
// of the two numbers a message belongs to). A number with no phone_number_id
// or access_token set is skipped, so you can go live with just NUMBER1 first.
function buildNumberConfigs(env = process.env) {
  const numbers = new Map();
  const numFromEnv = (v) => (v === undefined || v === '' ? undefined : Number(v));

  for (const key of ['NUMBER1', 'NUMBER2']) {
    const phoneNumberId = env[`${key}_PHONE_NUMBER_ID`];
    const accessToken = env[`${key}_ACCESS_TOKEN`];
    if (!phoneNumberId || !accessToken) continue;

    numbers.set(phoneNumberId, {
      key: key.toLowerCase(),
      label: env[`${key}_LABEL`] || key,
      phoneNumberId,
      accessToken,
      dailyNewContactCap: numFromEnv(env[`${key}_DAILY_CAP`]) || 0,
      concurrency: numFromEnv(env[`${key}_CONCURRENCY`]),
      sendDelayMs: numFromEnv(env[`${key}_SEND_DELAY_MS`]),
    });
  }

  return numbers;
}

module.exports = { buildNumberConfigs };
