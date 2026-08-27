'use strict';

/**
 * Small TTL cache (spec §41).
 *
 * Used for a few genuinely hot, genuinely stale-tolerant things — trending
 * lists, platform-state counts. NOT a blanket cache over every query: caching
 * everything blindly creates confusing staleness bugs.
 *
 * Every entry MUST have a TTL, and writers invalidate explicitly by prefix when
 * they change the underlying data.
 *
 * Swap the internals for Redis when you run more than one server. (spec §75)
 */

const store = new Map(); // key -> { value, expiresAt }

/** Get a cached value, or undefined if missing/expired. */
function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) { store.delete(key); return undefined; }
  return entry.value;
}

/** Store a value for `ttlSeconds`. */
function set(key, value, ttlSeconds) {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  return value;
}

/** Get-or-compute. `producer` runs only on a miss. */
function remember(key, ttlSeconds, producer) {
  const hit = get(key);
  if (hit !== undefined) return hit;
  return set(key, producer(), ttlSeconds);
}

/** Invalidate one key, or every key starting with `prefix`. */
function invalidate(keyOrPrefix, { prefix = false } = {}) {
  if (!prefix) { store.delete(keyOrPrefix); return; }
  for (const key of store.keys()) {
    if (key.startsWith(keyOrPrefix)) store.delete(key);
  }
}

function clear() { store.clear(); }
function size() { return store.size; }

module.exports = { get, set, remember, invalidate, clear, size };
