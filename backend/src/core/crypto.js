'use strict';

/**
 * Password hashing and token generation.
 *
 * Passwords use scrypt (memory-hard, in the Node standard library, no
 * dependency). We store `scrypt$N$r$p$salt$hash` so the parameters travel with
 * the hash and can be raised later without invalidating old passwords.
 *
 * Plaintext passwords are NEVER stored or logged. (spec §6)
 */

const crypto = require('node:crypto');

// Cost parameters. N must be a power of 2. These are a reasonable 2020s
// baseline (~64MB memory per hash); raise N as hardware improves.
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hash a plaintext password. Returns a self-describing string. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, PARAMS.keylen, {
    N: PARAMS.N, r: PARAMS.r, p: PARAMS.p,
    maxmem: 256 * 1024 * 1024,
  });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

/**
 * Verify a password against a stored hash. Uses a constant-time comparison so
 * the check does not leak information through timing.
 */
function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** A cryptographically random, URL-safe opaque token (for sessions, links). */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Hash a token or identifier for storage. Session tokens and IPs are stored
 * hashed so a database leak does not expose live sessions or raw addresses.
 */
function sha256(value, salt = '') {
  return crypto.createHash('sha256').update(String(value) + salt).digest('hex');
}

module.exports = { hashPassword, verifyPassword, randomToken, sha256 };
