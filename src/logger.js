'use strict';

function makeLogger(instanceName) {
  return function log(message) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${instanceName}] ${message}`);
  };
}

module.exports = { makeLogger };
