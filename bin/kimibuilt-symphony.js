#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { startSymphonyDaemon } = require('../src/orchestration/symphony-daemon');

startSymphonyDaemon({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  logger: console,
}).then(({ orchestrator, statusServer }) => {
  const shutdown = async (signal) => {
    console.log(`[Symphony] shutdown_requested signal=${signal}`);
    orchestrator.stop();
    if (statusServer) {
      await new Promise((resolve) => statusServer.close(resolve));
    }
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}).catch((error) => {
  console.error(`[Symphony] startup_failed error=${error.message}`);
  if (error.validation?.errors) {
    console.error(`[Symphony] validation_errors errors=${error.validation.errors.map((entry) => entry.code).join(',')}`);
  }
  process.exit(1);
});
