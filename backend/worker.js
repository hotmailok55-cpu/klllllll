'use strict';

/**
 * WORKER ENTRY POINT.
 *
 *   node worker.js
 *
 * Runs the background job loop with no HTTP server attached. In production run
 * this as its own process (or several), so heavy work — transcoding, copyright
 * checks, notification delivery — never competes with serving requests.
 * (spec §42, §74)
 *
 * Scale by running more worker processes; the job claim is atomic, so two
 * workers never run the same job.
 */

const { config, validateConfig } = require('./src/core/config');
const { logger } = require('./src/core/logger');
const db = require('./src/core/db');
const queue = require('./src/core/queue');
const registry = require('./src/integrations/registry');
const analytics = require('./src/services/analytics');
const notifications = require('./src/services/notifications');
const processing = require('./src/services/processing');

validateConfig(logger);
db.connect();
db.migrate();

analytics.install();
registry.initialize();
notifications.install();
processing.registerJobs();

const stop = queue.startWorker({ intervalMs: 1000 });

logger.info('worker', 'started', { env: config.env, pid: process.pid });

function shutdown(signal) {
  logger.info('worker', 'shutting down', { signal });
  stop();
  // Give a running job a moment to finish before closing the database.
  setTimeout(() => {
    db.close();
    process.exit(0);
  }, 2000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('worker', 'uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
