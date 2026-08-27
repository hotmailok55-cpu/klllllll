'use strict';

/**
 * Central configuration + feature flags.
 *
 * Everything the platform needs to know about its environment is read HERE and
 * nowhere else. Services import `config` — they never read `process.env`
 * directly. That keeps configuration discoverable and testable.
 *
 * Rules:
 *  - Secrets (API keys, DB credentials) come from environment variables only.
 *  - Never hard-code a secret in source.
 *  - Never send a secret to the frontend. The frontend talks to OUR backend;
 *    OUR backend talks to external providers.
 *
 * See docs/ENVIRONMENT.md for the full list of variables.
 */

const path = require('node:path');

/** Read an env var as a string, with a default. */
function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** Read an env var as a number, with a default. */
function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Read an env var as a boolean. "1", "true", "yes", "on" are truthy. */
function bool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const env = str('NODE_ENV', 'development');

const config = {
  env,
  isProduction: env === 'production',

  server: {
    host: str('HOST', '0.0.0.0'),
    port: num('PORT', 4000),
    // Public base URL of this API (used to build absolute links in emails, etc.)
    publicUrl: str('PUBLIC_URL', `http://localhost:${num('PORT', 4000)}`),
  },

  // Where the SQLite database file lives. In production you would point the
  // storage/database abstraction at a managed database instead; the app code
  // does not care because it talks to src/core/db.js, not to a vendor.
  database: {
    file: str('DATABASE_FILE', path.join(__dirname, '..', '..', 'data', 'platform.db')),
  },

  auth: {
    // Secret used to sign session tokens. MUST be overridden in production.
    // A random default is generated per-process in dev so tokens work locally,
    // but that means restarts invalidate sessions in dev — set AUTH_SECRET to
    // keep sessions stable.
    secret: str('AUTH_SECRET', ''),
    // Access token lifetime in seconds (default 7 days).
    tokenTtlSeconds: num('AUTH_TOKEN_TTL', 7 * 24 * 60 * 60),
  },

  // Object storage for the actual video/thumbnail files. The MVP uses the
  // local filesystem via the storage integration; swap the adapter for S3/GCS
  // later without touching the video service. See integrations/storage.
  storage: {
    driver: str('STORAGE_DRIVER', 'local'),
    localDir: str('STORAGE_LOCAL_DIR', path.join(__dirname, '..', '..', 'data', 'uploads')),
    bucket: str('STORAGE_BUCKET', ''),
    cdnUrl: str('CDN_URL', ''),
  },

  rateLimit: {
    // Requests allowed per window, per client, per bucket. Individual routes
    // can tighten these; see core/ratelimit.js.
    windowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
    defaultMax: num('RATE_LIMIT_DEFAULT_MAX', 300),
  },

  /**
   * Feature flags. Toggle features on/off without code changes. The frontend
   * can read the safe subset via GET /api/v1/system/flags.
   */
  flags: {
    SHORTS_ENABLED: bool('SHORTS_ENABLED', true),
    LIVE_STREAMING_ENABLED: bool('LIVE_STREAMING_ENABLED', false),
    MONETIZATION_ENABLED: bool('MONETIZATION_ENABLED', false),
    MUSIC_API_ENABLED: bool('MUSIC_API_ENABLED', false),
    AI_MODERATION_ENABLED: bool('AI_MODERATION_ENABLED', false),
    COPYRIGHT_CHECK_ENABLED: bool('COPYRIGHT_CHECK_ENABLED', true),
    REGISTRATION_ENABLED: bool('REGISTRATION_ENABLED', true),
  },

  /**
   * External integration configuration. Each provider reads its own keys here.
   * Absent keys mean the integration runs in a safe "null"/pending mode rather
   * than crashing. See src/integrations and docs/ADDING-AN-API.md.
   */
  integrations: {
    copyright: {
      provider: str('COPYRIGHT_PROVIDER', 'null'),
      apiKey: str('COPYRIGHT_API_KEY', ''),
      apiUrl: str('COPYRIGHT_API_URL', ''),
    },
    music: {
      provider: str('MUSIC_PROVIDER', 'null'),
      apiKey: str('MUSIC_API_KEY', ''),
      apiUrl: str('MUSIC_API_URL', ''),
    },
    moderation: {
      provider: str('MODERATION_PROVIDER', 'internal'),
      apiKey: str('MODERATION_API_KEY', ''),
      apiUrl: str('MODERATION_API_URL', ''),
    },
    analytics: {
      provider: str('ANALYTICS_PROVIDER', 'internal'),
      apiKey: str('ANALYTICS_API_KEY', ''),
    },
    payments: {
      provider: str('PAYMENTS_PROVIDER', 'null'),
      apiKey: str('PAYMENTS_API_KEY', ''),
    },
    notifications: {
      provider: str('NOTIFICATIONS_PROVIDER', 'internal'),
      apiKey: str('NOTIFICATIONS_API_KEY', ''),
    },
    storage: {
      provider: str('STORAGE_DRIVER', 'local'),
    },
    ai: {
      provider: str('AI_PROVIDER', 'null'),
      apiKey: str('AI_API_KEY', ''),
    },
  },

  // Raw helpers exposed for tests / advanced use.
  _read: { str, num, bool },
};

/**
 * Validate configuration at startup. In production we refuse to boot with an
 * unsafe default secret; in development we warn and continue.
 */
function validateConfig(logger) {
  const problems = [];
  if (!config.auth.secret) {
    if (config.isProduction) {
      problems.push('AUTH_SECRET must be set in production.');
    } else if (logger) {
      logger.warn('config', 'AUTH_SECRET not set; using a random per-process dev secret. Sessions reset on restart.');
    }
  }
  if (config.isProduction && config.storage.driver === 'local') {
    if (logger) logger.warn('config', 'STORAGE_DRIVER=local in production is not recommended; use object storage.');
  }
  if (problems.length) {
    throw new Error('Invalid configuration:\n  - ' + problems.join('\n  - '));
  }
}

module.exports = { config, validateConfig };
