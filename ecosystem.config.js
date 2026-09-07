'use strict';

const path = require('path');

const ROOT = __dirname;

const instance = (key) => ({
  name: `wa-${key}`,
  script: 'run.js',
  args: [key],
  cwd: ROOT,
  interpreter: process.execPath,
  autorestart: true,
  restart_delay: 5000,
  min_uptime: 15000,
  max_restarts: 50,
  kill_timeout: 20000,
  out_file: path.join(ROOT, 'instances', key, 'run.log'),
  error_file: path.join(ROOT, 'instances', key, 'run.log'),
  merge_logs: true,
  time: false,
});

module.exports = {
  apps: [instance('number1'), instance('number2')],
};
