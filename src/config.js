'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadInstance(instanceKey) {
  if (!/^[a-zA-Z0-9._-]+$/.test(instanceKey || '')) {
    throw new Error(`Invalid instance name: "${instanceKey}"`);
  }

  const instanceDir = path.join(ROOT, 'instances', instanceKey);
  const configPath = path.join(instanceDir, 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const assetsDir = config.assets_dir
    ? path.resolve(instanceDir, config.assets_dir)
    : path.join(ROOT, 'assets');

  const resolveAsset = (p) => (path.isAbsolute(p) ? p : path.join(assetsDir, p));

  if (!config.reply_text && config.reply_text_file) {
    config.reply_text = fs.readFileSync(resolveAsset(config.reply_text_file), 'utf8').trim();
  }
  if (!config.reply_link && config.reply_link_file) {
    config.reply_link = fs.readFileSync(resolveAsset(config.reply_link_file), 'utf8').trim();
  }

  return { instanceKey, instanceDir, assetsDir, resolveAsset, config };
}

module.exports = { loadInstance };
