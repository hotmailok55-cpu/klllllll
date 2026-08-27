'use strict';

/**
 * ============================================================================
 * INTEGRATION REGISTRY  — the one place external APIs plug into the platform.
 * ============================================================================
 *
 * This is the answer to "I want to bring you a new API later and have a clear
 * place to put it." (spec §3, §5, §66, §77)
 *
 * How it fits together:
 *
 *     Platform code
 *        -> CopyrightService            (our rules, our vocabulary)
 *           -> registry.get('copyright')
 *              -> a Provider adapter    (translates to one company's API)
 *                 -> the external API
 *
 * Platform code NEVER imports a provider directly. It asks the registry for the
 * capability it needs. Swapping vendors means writing one new adapter file and
 * changing one environment variable — nothing else in the platform changes.
 *
 * The registry also owns the operational concerns so no adapter has to
 * reimplement them:
 *   - health tracking (status, last success/failure, response time)  §35
 *   - circuit breaker (stop hammering a dead API)                    §36
 *   - enable/disable via feature flags and config                    §63
 *   - never exposing secret values, only "configured: true"          §4, §77
 *
 * To add a provider, see docs/ADDING-AN-API.md.
 */

const db = require('../core/db');
const { config } = require('../core/config');
const { logger } = require('../core/logger');

/**
 * The capabilities the platform knows how to use. Each one has a human label
 * (shown in the admin dashboard) and the adapters available for it.
 *
 * `adapters` maps a provider name -> a factory function returning the adapter.
 * They are lazily required so an unused provider never has to load.
 */
const CAPABILITIES = {
  copyright: {
    label: 'Copyright Detection',
    load: () => require('./copyright'),
    flag: 'COPYRIGHT_CHECK_ENABLED',
  },
  music: {
    label: 'Music Licensing',
    load: () => require('./music'),
    flag: 'MUSIC_API_ENABLED',
  },
  moderation: {
    label: 'Content Moderation',
    load: () => require('./moderation'),
    flag: null, // internal moderation always runs; the flag gates AI providers
  },
  storage: {
    label: 'File Storage',
    load: () => require('./storage'),
    flag: null,
  },
  notifications: {
    label: 'Notification Delivery',
    load: () => require('./notifications'),
    flag: null,
  },
  analytics: {
    label: 'Analytics',
    load: () => require('./analytics'),
    flag: null,
  },
  payments: {
    label: 'Payments / Monetization',
    load: () => require('./payments'),
    flag: 'MONETIZATION_ENABLED',
  },
  ai: {
    label: 'AI Services',
    load: () => require('./ai'),
    flag: 'AI_MODERATION_ENABLED',
  },
};

const instances = new Map(); // capability -> adapter instance

/**
 * Get the active adapter for a capability.
 *
 * Always returns SOMETHING — if nothing is configured you get the capability's
 * null/internal adapter, which degrades gracefully (e.g. copyright returns
 * "pending" instead of throwing). A missing API key must never take the
 * platform down. (spec §35)
 */
function get(capability) {
  if (instances.has(capability)) return instances.get(capability);

  const spec = CAPABILITIES[capability];
  if (!spec) throw new Error(`Unknown integration capability: ${capability}`);

  const module = spec.load();
  const settings = config.integrations[capability] || {};
  const providerName = settings.provider || 'null';

  let adapter;
  const factory = module.adapters[providerName];
  if (!factory) {
    logger.warn('integrations', 'unknown provider, falling back', {
      capability, requested: providerName, available: Object.keys(module.adapters),
    });
    adapter = module.adapters[module.fallback]();
  } else {
    adapter = factory(settings);
  }

  // Wrap so every call is measured, health-tracked, and circuit-broken.
  const wrapped = instrument(capability, adapter);
  instances.set(capability, wrapped);
  syncRegistryRow(capability, adapter);
  return wrapped;
}

/** Whether a capability is enabled (feature flag + adapter is not the null one). */
function isEnabled(capability) {
  const spec = CAPABILITIES[capability];
  if (!spec) return false;
  if (spec.flag && !config.flags[spec.flag]) return false;
  return get(capability).providerName !== 'null';
}

/**
 * Wrap each adapter method with: timing, health recording, and a circuit
 * breaker. Adapters therefore stay simple — they only translate requests.
 */
function instrument(capability, adapter) {
  const wrapped = Object.create(adapter);

  for (const key of collectMethods(adapter)) {
    const original = adapter[key];
    if (typeof original !== 'function') continue;

    // Only instrument ASYNC methods. Those are the ones that perform I/O and
    // can therefore fail, time out, or need a circuit breaker.
    //
    // Synchronous helpers (storage.urlFor, isConfigured, resolve…) are left
    // exactly as they are: wrapping them would turn a plain string return into
    // a Promise and quietly break every caller.
    if (original.constructor.name !== 'AsyncFunction') {
      wrapped[key] = original.bind(adapter);
      continue;
    }

    wrapped[key] = async function instrumented(...args) {
      // Circuit breaker: if this provider has been failing, stop calling it for
      // a cooldown period and let the caller apply its fallback immediately.
      if (isCircuitOpen(capability)) {
        const err = new Error(`Integration "${capability}" is temporarily unavailable (circuit open).`);
        err.code = 'CIRCUIT_OPEN';
        err.integration = capability;
        throw err;
      }

      const started = Date.now();
      try {
        const result = await original.apply(adapter, args);
        recordSuccess(capability, Date.now() - started);
        return result;
      } catch (err) {
        recordFailure(capability, err, Date.now() - started);
        throw err;
      }
    };
  }
  return wrapped;
}

function collectMethods(obj) {
  const names = new Set();
  let cur = obj;
  while (cur && cur !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(cur)) {
      if (n !== 'constructor' && typeof obj[n] === 'function') names.add(n);
    }
    cur = Object.getPrototypeOf(cur);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Health tracking (spec §35) — persisted so the admin dashboard survives restarts
// ---------------------------------------------------------------------------

const CIRCUIT_FAILURE_THRESHOLD = 5;   // consecutive failures before opening
const CIRCUIT_COOLDOWN_MS = 60_000;    // how long to stay open

function syncRegistryRow(capability, adapter) {
  const spec = CAPABILITIES[capability];
  const settings = config.integrations[capability] || {};
  const configured = Boolean(settings.apiKey) || adapter.providerName === 'internal'
    || adapter.providerName === 'local';
  const enabled = spec.flag ? Boolean(config.flags[spec.flag]) : true;

  const existing = db.get('SELECT key FROM api_integrations WHERE key = :key', { key: capability });
  const now = new Date().toISOString();

  if (existing) {
    db.run(
      `UPDATE api_integrations
          SET label=:label, provider=:provider, enabled=:enabled,
              configured=:configured, updated_at=:now
        WHERE key=:key`,
      { key: capability, label: spec.label, provider: adapter.providerName,
        enabled, configured, now }
    );
  } else {
    db.run(
      `INSERT INTO api_integrations (key, label, provider, enabled, configured, status, updated_at)
       VALUES (:key, :label, :provider, :enabled, :configured, :status, :now)`,
      { key: capability, label: spec.label, provider: adapter.providerName,
        enabled, configured,
        status: adapter.providerName === 'null' ? 'not_connected' : 'connected',
        now }
    );
  }
}

function recordSuccess(capability, ms) {
  const now = new Date().toISOString();
  const row = db.get('SELECT avg_response_ms FROM api_integrations WHERE key=:key', { key: capability });
  // Exponential moving average keeps a stable, cheap latency figure.
  const avg = row?.avg_response_ms ? Math.round(row.avg_response_ms * 0.7 + ms * 0.3) : ms;
  db.run(
    `UPDATE api_integrations
        SET status='connected', last_success_at=:now, consecutive_failures=0,
            circuit_open_until=NULL, avg_response_ms=:avg, updated_at=:now
      WHERE key=:key`,
    { key: capability, now, avg }
  );
}

function recordFailure(capability, err, ms) {
  const now = new Date().toISOString();
  const row = db.get('SELECT consecutive_failures FROM api_integrations WHERE key=:key', { key: capability });
  const failures = (row?.consecutive_failures || 0) + 1;
  const openCircuit = failures >= CIRCUIT_FAILURE_THRESHOLD;

  db.run(
    `UPDATE api_integrations
        SET status=:status, last_failure_at=:now, last_error=:error,
            consecutive_failures=:failures, circuit_open_until=:until, updated_at=:now
      WHERE key=:key`,
    {
      key: capability, now,
      status: openCircuit ? 'error' : 'degraded',
      // Store the message only — never a raw response that might carry a key.
      error: String(err.message || err).slice(0, 500),
      failures,
      until: openCircuit ? new Date(Date.now() + CIRCUIT_COOLDOWN_MS).toISOString() : null,
    }
  );

  logger.error('integrations', 'provider call failed', {
    capability, failures, circuitOpen: openCircuit, error: err.message, ms,
  });
}

function isCircuitOpen(capability) {
  const row = db.get('SELECT circuit_open_until FROM api_integrations WHERE key=:key', { key: capability });
  if (!row?.circuit_open_until) return false;
  if (new Date(row.circuit_open_until) > new Date()) return true;
  // Cooldown elapsed: half-open — let the next call through to probe.
  db.run(`UPDATE api_integrations SET circuit_open_until=NULL WHERE key=:key`, { key: capability });
  return false;
}

/**
 * The admin-facing view of every integration.
 * Note what is NOT here: any secret value. Only `configured: true/false`.
 * (spec §5, §77)
 */
function status() {
  const rows = db.all('SELECT * FROM api_integrations ORDER BY key');
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return Object.entries(CAPABILITIES).map(([key, spec]) => {
    // Touch the adapter so a never-yet-used integration still appears.
    let providerName = 'null';
    try { providerName = get(key).providerName; } catch { /* keep default */ }
    const row = byKey.get(key) || db.get('SELECT * FROM api_integrations WHERE key=:key', { key });

    return {
      key,
      label: spec.label,
      provider: row?.provider || providerName,
      enabled: Boolean(row?.enabled),
      configured: Boolean(row?.configured),
      status: row?.status || 'not_connected',
      lastSuccessAt: row?.last_success_at || null,
      lastFailureAt: row?.last_failure_at || null,
      lastTestAt: row?.last_test_at || null,
      lastError: row?.last_error || null,
      avgResponseMs: row?.avg_response_ms ?? null,
      rateLimitInfo: row?.rate_limit_info ? safeParse(row.rate_limit_info) : null,
      circuitOpen: row?.circuit_open_until ? new Date(row.circuit_open_until) > new Date() : false,
      featureFlag: spec.flag,
    };
  });
}

/**
 * "Test Connection" — a safe health check an admin can run from the dashboard.
 * Calls the adapter's own `healthCheck()`; never echoes credentials back.
 */
async function testConnection(capability) {
  const adapter = get(capability);
  const now = new Date().toISOString();
  const started = Date.now();
  try {
    const result = await adapter.healthCheck();
    db.run(`UPDATE api_integrations SET last_test_at=:now, updated_at=:now WHERE key=:key`,
      { key: capability, now });
    return { ok: true, provider: adapter.providerName, ms: Date.now() - started, ...result };
  } catch (err) {
    db.run(`UPDATE api_integrations SET last_test_at=:now, updated_at=:now WHERE key=:key`,
      { key: capability, now });
    return {
      ok: false,
      provider: adapter.providerName,
      ms: Date.now() - started,
      message: String(err.message || err).slice(0, 300),
    };
  }
}

/** Enable/disable an integration at runtime (admin dashboard). */
function setEnabled(capability, enabled) {
  db.run(
    `UPDATE api_integrations SET enabled=:enabled, status=:status, updated_at=:now WHERE key=:key`,
    {
      key: capability,
      enabled: enabled ? 1 : 0,
      status: enabled ? 'connected' : 'disabled',
      now: new Date().toISOString(),
    }
  );
  return status().find((s) => s.key === capability);
}

/** Reload adapters — call after changing configuration. */
function reset() { instances.clear(); }

function safeParse(text) { try { return JSON.parse(text); } catch { return null; } }

/** Register every capability row at boot so the dashboard is populated. */
function initialize() {
  for (const key of Object.keys(CAPABILITIES)) {
    try { get(key); } catch (err) {
      logger.error('integrations', 'failed to initialize', { capability: key, error: err.message });
    }
  }
  logger.info('integrations', 'registry initialized', {
    capabilities: Object.keys(CAPABILITIES).length,
  });
}

module.exports = {
  CAPABILITIES, get, isEnabled, status, testConnection, setEnabled, reset, initialize,
};
