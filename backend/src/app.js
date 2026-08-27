'use strict';

/**
 * APPLICATION WIRING.
 *
 * This is the assembly point: it connects config -> database -> services ->
 * routes and returns a request listener. Keeping it separate from server.js
 * means tests can build the whole app in-process without binding a port.
 *
 * BOOT ORDER MATTERS:
 *   1. validate configuration      (fail fast on a bad environment)
 *   2. connect + migrate database  (everything else needs the schema)
 *   3. install the event sink      (so no early event is lost)
 *   4. initialize integrations     (populates the admin registry)
 *   5. subscribe services to events
 *   6. register background jobs
 *   7. build the router
 */

const fs = require('node:fs');
const path = require('node:path');
const { config, validateConfig } = require('./core/config');
const { logger } = require('./core/logger');
const db = require('./core/db');
const { createRequestListener, Router } = require('./core/http');
const registry = require('./integrations/registry');
const users = require('./services/users');
const analytics = require('./services/analytics');
const notifications = require('./services/notifications');
const processing = require('./services/processing');
const v1 = require('./routes/v1');

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');

/**
 * Build the application.
 * @param {object} options { migrate: boolean }
 */
function createApp({ migrate = true } = {}) {
  validateConfig(logger);

  db.connect();
  if (migrate) db.migrate();

  // The event sink must exist before any service can publish.
  analytics.install();

  registry.initialize();

  // Services subscribe to the events they care about.
  notifications.install();

  // Background job handlers.
  processing.registerJobs();

  const router = v1.router;

  // Media streaming route. Only used when no CDN is configured — in production
  // CDN_URL points these at the CDN and this route is never hit for hot files.
  registerMediaRoute(router);

  const listener = createRequestListener(router, {
    authenticate,
    onNotFound: serveFrontend,
  });

  logger.info('app', 'application ready', {
    env: config.env,
    flags: Object.entries(config.flags).filter(([, v]) => v).map(([k]) => k),
  });

  return listener;
}

/**
 * Resolve the Authorization header (or the session cookie) to a user.
 * Runs on every request; a missing or bad token simply means ctx.user is null,
 * never an error — public endpoints must work signed out.
 */
function authenticate(ctx) {
  const header = ctx.req.headers.authorization || '';
  let token = null;

  if (header.startsWith('Bearer ')) {
    token = header.slice(7).trim();
  } else if (ctx.req.headers.cookie) {
    const match = /(?:^|;\s*)session=([^;]+)/.exec(ctx.req.headers.cookie);
    if (match) token = decodeURIComponent(match[1]);
  }
  if (!token) return;

  const resolved = users.resolveSession(token);
  if (resolved) {
    ctx.user = resolved.user;
    ctx.sessionId = resolved.sessionId;
  }
}

/**
 * Serve stored media with HTTP range support, so the player can seek and the
 * browser can start playback before the whole file arrives.
 */
function registerMediaRoute(router) {
  router.get('/api/v1/media/:a/:b/:c', (ctx) => streamMedia(ctx, `${ctx.params.a}/${ctx.params.b}/${ctx.params.c}`));
  router.get('/api/v1/media/:a/:b', (ctx) => streamMedia(ctx, `${ctx.params.a}/${ctx.params.b}`));
}

async function streamMedia(ctx, key) {
  const storage = registry.get('storage');
  const info = await storage.stat(key);

  if (!info) {
    ctx.res.writeHead(404, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'File not found.' } }));
    return;
  }

  const range = ctx.req.headers.range;
  // Media is immutable once written (keys include the video id), so it can be
  // cached hard by the browser and any CDN in front of us.
  const baseHeaders = {
    'Content-Type': info.contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    // Uploaded content is never executed or interpreted as a document.
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : info.size - 1;

    if (start >= info.size || end >= info.size || start > end) {
      ctx.res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
      return ctx.res.end();
    }

    ctx.res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${info.size}`,
      'Content-Length': end - start + 1,
    });
    storage.createReadStream(key, { start, end }).pipe(ctx.res);
    return;
  }

  ctx.res.writeHead(200, { ...baseHeaders, 'Content-Length': info.size });
  storage.createReadStream(key).pipe(ctx.res);
}

/**
 * Serve the frontend for any non-API path (single-page app fallback).
 * Returns true when it handled the request.
 */
function serveFrontend(ctx) {
  if (ctx.pathname.startsWith('/api/')) return false;

  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };

  // Resolve inside the frontend directory only — never let a URL escape it.
  const requested = ctx.pathname === '/' ? '/index.html' : ctx.pathname;
  const full = path.resolve(FRONTEND_DIR, '.' + requested);

  let filePath = full;
  if (!full.startsWith(FRONTEND_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    // SPA fallback: unknown client-side routes render the app shell.
    filePath = path.join(FRONTEND_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) return false;

  const ext = path.extname(filePath);
  const body = fs.readFileSync(filePath);
  ctx.res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  ctx.res.end(body);
  return true;
}

module.exports = { createApp, authenticate };
