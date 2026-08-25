'use strict';

/**
 * Structured logging.
 *
 * Every log line is a single JSON object so it can be shipped to a log
 * aggregator later. In development we also pretty-print to be readable.
 *
 * NEVER log secrets: passwords, tokens, API keys, or full request bodies that
 * might contain them. The `redact` helper strips common sensitive keys.
 */

const REDACT_KEYS = new Set([
  'password', 'passwordHash', 'password_hash', 'token', 'accessToken',
  'refreshToken', 'secret', 'apiKey', 'api_key', 'authorization', 'cookie',
]);

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k)) out[k] = '[redacted]';
    else if (v && typeof v === 'object') out[k] = redact(v);
    else out[k] = v;
  }
  return out;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
const pretty = (process.env.NODE_ENV || 'development') !== 'production';

function emit(level, service, message, meta) {
  if (LEVELS[level] < threshold) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    service,
    message,
    ...(meta ? { meta: redact(meta) } : {}),
  };
  const line = pretty
    ? `${record.ts} ${level.toUpperCase().padEnd(5)} [${service}] ${message}` +
      (meta ? ' ' + JSON.stringify(redact(meta)) : '')
    : JSON.stringify(record);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

const logger = {
  debug: (service, message, meta) => emit('debug', service, message, meta),
  info: (service, message, meta) => emit('info', service, message, meta),
  warn: (service, message, meta) => emit('warn', service, message, meta),
  error: (service, message, meta) => emit('error', service, message, meta),
  redact,
};

module.exports = { logger };
