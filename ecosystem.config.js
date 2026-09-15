'use strict';

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'wa-webhook',
      script: 'server.js',
      cwd: __dirname,
      interpreter: process.execPath,
      autorestart: true,
      restart_delay: 5000,
      min_uptime: 15000,
      max_restarts: 50,
      out_file: path.join(__dirname, 'logs', 'run.log'),
      error_file: path.join(__dirname, 'logs', 'run.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
