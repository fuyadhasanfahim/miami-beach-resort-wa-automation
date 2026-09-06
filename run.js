'use strict';

require('dotenv').config({ quiet: true });

const { loadInstance } = require('./src/config');
const { startBot } = require('./src/bot');

const instanceKey = process.argv[2];

if (!instanceKey) {
  console.error('Usage: node run.js <instance>   (e.g. "node run.js number1")');
  process.exit(1);
}

let ctx;
try {
  ctx = loadInstance(instanceKey);
} catch (err) {
  console.error(`Failed to load instance "${instanceKey}": ${err.message}`);
  process.exit(1);
}

startBot(ctx).catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
