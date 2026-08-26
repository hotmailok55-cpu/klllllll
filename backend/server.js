'use strict';

/**
 * SERVER ENTRY POINT.
 *
 *   node server.js          web server + an in-process worker (development)
 *   node server.js --web    web server only (production: workers run separately)
 *   node worker.js          worker only
 *
 * Running the worker separately in production is the point of the split:
 * transcoding a 4K video must not compete with serving requests. (spec §74)
 */

const http = require('node:http');
const { createApp } = require('./src/app');
const { config } = require('./src/core/config');
const { logger } = require('./src/core/logger');
const queue = require('./src/core/queue');
const db = require('./src/core/db');

const webOnly = process.argv.includes('--web');

const listener = createApp();
const server = http.createServer(listener);

// Give slow uploads room, but not forever.
server.requestTimeout = 15 * 60_000;
server.headersTimeout = 60_000;

let stopWorker = null;
if (!webOnly) {
  stopWorker = queue.startWorker();
  scheduleMaintenance();
}

server.listen(config.server.port, config.server.host, () => {
  logger.info('server', 'listening', {
    url: `http://${config.server.host}:${config.server.port}`,
    env: config.env,
    worker: !webOnly,
  });

  if (!config.isProduction) {
    process.stdout.write(
      `\n  LJBMK Social is running at http://localhost:${config.server.port}\n` +
      `  API:    http://localhost:${config.server.port}/api/v1/system/state\n` +
      `  Health: http://localhost:${config.server.port}/api/v1/system/health\n\n`
    );
  }
});

/**
 * Periodic maintenance. Simple interval-based scheduling is enough here; move
 * to a cron-style scheduler when there are more jobs than this.
 */
function scheduleMaintenance() {
  // Interest decay keeps recommendation profiles current. Hourly.
  setInterval(() => queue.enqueue('maintenance.decayInterests', {}), 3600_000).unref();
  // Expired session cleanup. Every 6 hours.
  setInterval(() => queue.enqueue('maintenance.cleanSessions', {}), 6 * 3600_000).unref();
}

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests finish,
 * stop the worker, close the database. A hard exit mid-transaction is how you
 * get a corrupt database.
 */
function shutdown(signal) {
  logger.info('server', 'shutting down', { signal });

  const timer = setTimeout(() => {
    logger.warn('server', 'forced exit after timeout');
    process.exit(1);
  }, 15_000);
  timer.unref();

  server.close(() => {
    if (stopWorker) stopWorker();
    db.close();
    logger.info('server', 'shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Never die silently. Log, then exit so the supervisor can restart us cleanly.
process.on('uncaughtException', (err) => {
  logger.error('server', 'uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('server', 'unhandled rejection', { reason: String(reason) });
});
