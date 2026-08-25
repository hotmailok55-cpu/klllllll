'use strict';

/**
 * Rate limiting (spec §37).
 *
 * Different actions get different budgets: logging in is far more sensitive
 * than scrolling a feed. Buckets are defined in one place so limits are easy to
 * audit and tune.
 *
 * This implementation keeps counters in process memory, which is correct for a
 * single server. When you run multiple servers, replace `hit()` with a Redis
 * INCR + EXPIRE — the call sites do not change. (spec §75)
 */

const { config } = require('./config');
const { tooManyRequests } = require('./errors');

/**
 * name -> { windowMs, max }
 * Tune these as you learn real traffic patterns.
 */
const BUCKETS = {
  // Auth: strict, these are the attack surface.
  login:          { windowMs: 15 * 60_000, max: 10 },
  register:       { windowMs: 60 * 60_000, max: 5 },
  passwordReset:  { windowMs: 60 * 60_000, max: 5 },

  // Writes: moderate.
  upload:         { windowMs: 60 * 60_000, max: 30 },
  comment:        { windowMs: 60_000, max: 15 },
  reaction:       { windowMs: 60_000, max: 60 },
  report:         { windowMs: 60 * 60_000, max: 20 },

  // Reads: generous, but still bounded.
  search:         { windowMs: 60_000, max: 60 },
  feed:           { windowMs: 60_000, max: 120 },
  view:           { windowMs: 60_000, max: 240 },

  // Catch-all for everything else.
  default:        { windowMs: config.rateLimit.windowMs, max: config.rateLimit.defaultMax },
};

const counters = new Map(); // key -> { count, resetAt }

/** Drop expired counters so memory does not grow without bound. */
function sweep(now) {
  for (const [key, entry] of counters) {
    if (entry.resetAt <= now) counters.delete(key);
  }
}
let lastSweep = 0;

/**
 * Record a hit and throw if over budget.
 *
 * @param {string} bucket  a key of BUCKETS
 * @param {string} identity caller identity (user id, or hashed IP)
 * @returns {{remaining:number, resetAt:number}}
 */
function hit(bucket, identity) {
  const spec = BUCKETS[bucket] || BUCKETS.default;
  const now = Date.now();

  if (now - lastSweep > 60_000) { sweep(now); lastSweep = now; }

  const key = `${bucket}:${identity}`;
  let entry = counters.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + spec.windowMs };
    counters.set(key, entry);
  }
  entry.count++;

  if (entry.count > spec.max) {
    const seconds = Math.ceil((entry.resetAt - now) / 1000);
    throw tooManyRequests(`Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`);
  }
  return { remaining: spec.max - entry.count, resetAt: entry.resetAt };
}

/** Clear all counters (used by tests). */
function reset() { counters.clear(); }

module.exports = { hit, reset, BUCKETS };
