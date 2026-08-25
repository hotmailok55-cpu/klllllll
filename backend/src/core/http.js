'use strict';

/**
 * Minimal HTTP router and request/response plumbing.
 *
 * Built on node:http with no framework, so there is nothing hidden: you can
 * read the whole request lifecycle in this one file. If you later want Express
 * or Fastify, the route handlers (`(ctx) => data`) port over almost unchanged.
 *
 * Conventions every route can rely on:
 *   - A handler returns a plain object -> serialized as `{ data: ... }` JSON.
 *   - A handler throws an AppError     -> serialized as `{ error: {...} }`.
 *   - `ctx.body`, `ctx.query`, `ctx.params` are parsed and ready.
 *   - `ctx.user` is the authenticated user or null.
 *   - Every request gets a request id, echoed in the `X-Request-Id` header and
 *     included in logs so a user's error report can be traced. (spec §69)
 */

const { randomUUID } = require('node:crypto');
const { AppError } = require('./errors');
const { logger } = require('./logger');
const { config } = require('./config');

const MAX_JSON_BODY = 1024 * 1024; // 1MB; uploads use a different path

class Router {
  constructor() {
    this.routes = [];   // { method, segments, handler, options }
    this.middleware = [];
  }

  /** Register middleware run before every route. */
  use(fn) { this.middleware.push(fn); return this; }

  /**
   * Register a route.
   * Path segments starting with ':' are parameters: '/videos/:id/like'.
   */
  add(method, path, handler, options = {}) {
    this.routes.push({
      method,
      segments: path.split('/').filter(Boolean),
      handler,
      options,
    });
    return this;
  }

  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }
  patch(p, h, o) { return this.add('PATCH', p, h, o); }
  put(p, h, o) { return this.add('PUT', p, h, o); }
  delete(p, h, o) { return this.add('DELETE', p, h, o); }

  /** Find a route matching the method + path. Returns { route, params }. */
  match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    let methodMismatch = false;

    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
        else if (seg !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      if (route.method !== method) { methodMismatch = true; continue; }
      return { route, params };
    }
    return methodMismatch ? { methodMismatch: true } : null;
  }
}

/** Read and parse a JSON request body, with a size cap. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] || '';
    if (!type.includes('application/json')) return resolve({});

    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BODY) {
        reject(new AppError(413, 'PAYLOAD_TOO_LARGE', 'That request was too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new AppError(400, 'INVALID_JSON', 'The request body was not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/** Send a JSON response. */
function sendJson(res, status, payload, requestId) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Request-Id': requestId,
    // Defensive headers. HTTPS/HSTS is terminated at the proxy in production.
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

/**
 * Build the node:http request listener for a router.
 *
 * @param {Router} router
 * @param {object} hooks  { authenticate, onNotFound }
 */
function createRequestListener(router, hooks = {}) {
  return async function requestListener(req, res) {
    const started = Date.now();
    const requestId = randomUUID();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // CORS. The frontend is served from the same origin in the MVP, so this is
    // permissive only for local development convenience.
    const origin = req.headers.origin;
    if (origin && !config.isProduction) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const ctx = {
      req, res, requestId,
      method: req.method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
      params: {},
      body: {},
      user: null,
      // Identity used for rate limiting and view dedupe when signed out.
      // Behind a proxy, x-forwarded-for is the client address.
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
          || req.socket.remoteAddress || '0.0.0.0',
      setHeader: (k, v) => res.setHeader(k, v),
    };

    try {
      const matched = router.match(req.method, url.pathname);

      if (!matched) {
        if (hooks.onNotFound && (await hooks.onNotFound(ctx))) return;
        throw new AppError(404, 'NOT_FOUND', 'That endpoint does not exist.');
      }
      if (matched.methodMismatch) {
        throw new AppError(405, 'METHOD_NOT_ALLOWED', 'That method is not allowed here.');
      }

      const { route, params } = matched;
      ctx.params = params;

      if (['POST', 'PATCH', 'PUT'].includes(req.method) && !route.options.rawBody) {
        ctx.body = await readJsonBody(req);
      }

      // Attach the authenticated user (if any) before auth checks run.
      if (hooks.authenticate) await hooks.authenticate(ctx);

      for (const mw of router.middleware) await mw(ctx, route);

      const result = await route.handler(ctx);

      // A handler may take over the response itself (file streaming); then it
      // returns undefined and we stop here.
      if (result === undefined || res.writableEnded) return;

      const status = route.options.status || (req.method === 'POST' ? 201 : 200);
      sendJson(res, status, { data: result }, requestId);

      logger.info('http', `${req.method} ${url.pathname}`, {
        status, ms: Date.now() - started, requestId, userId: ctx.user?.id,
      });
    } catch (err) {
      handleError(err, ctx, started);
    }
  };
}

/** Turn any thrown value into a clean JSON error response. */
function handleError(err, ctx, started) {
  const { res, requestId } = ctx;
  if (res.writableEnded) return;

  if (err instanceof AppError) {
    sendJson(res, err.status, {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        requestId,
      },
    }, requestId);
    logger.warn('http', `${ctx.method} ${ctx.pathname}`, {
      status: err.status, code: err.code, ms: Date.now() - started, requestId,
    });
    return;
  }

  // Unexpected error: log the detail for us, show a calm message to the user.
  // Never leak a stack trace to the client. (spec §73)
  logger.error('http', `Unhandled error on ${ctx.method} ${ctx.pathname}`, {
    error: err.message, stack: err.stack, requestId,
  });
  sendJson(res, 500, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our end. Please try again — nothing you did was lost.',
      requestId,
    },
  }, requestId);
}

module.exports = { Router, createRequestListener, sendJson, readJsonBody };
