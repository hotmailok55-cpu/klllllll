'use strict';

/**
 * Database access layer.
 *
 * The rest of the platform talks to THIS module, never to a specific database
 * vendor. Today it is backed by SQLite (via Node's built-in `node:sqlite`,
 * zero dependencies) which is perfect for local development and the MVP. To
 * move to Postgres later you re-implement this thin surface (`query`, `get`,
 * `all`, `run`, `tx`) and migrations, and the services keep working.
 *
 * We also run a tiny, ordered SQL migration system here (spec §78): every
 * schema change is a numbered file in src/migrations and is applied exactly
 * once, tracked in the `_migrations` table.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { config } = require('./config');
const { logger } = require('./logger');

let db = null;

/** Open (and remember) the database connection. */
function connect(file = config.database.file) {
  if (db) return db;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  // Pragmas for correctness + reasonable concurrency in SQLite.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  logger.info('db', 'Connected', { file });
  return db;
}

function getDb() {
  if (!db) connect();
  return db;
}

/** Run a statement that returns rows. Returns an array of row objects. */
function all(sql, params = {}) {
  return getDb().prepare(sql).all(normalizeParams(params));
}

/** Run a statement that returns a single row (or undefined). */
function get(sql, params = {}) {
  return getDb().prepare(sql).get(normalizeParams(params));
}

/** Run a write statement. Returns { changes, lastInsertRowid }. */
function run(sql, params = {}) {
  return getDb().prepare(sql).run(normalizeParams(params));
}

/** Run a function inside a transaction; rolls back on throw. */
function tx(fn) {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

/**
 * node:sqlite wants named params as { name: value } WITHOUT the ':' prefix in
 * the object keys but WITH ':' in the SQL. Booleans must become 0/1 and
 * undefined must become null. This helper normalizes that so services can pass
 * plain JS objects.
 */
function normalizeParams(params) {
  if (Array.isArray(params)) return params.map(coerce);
  const out = {};
  for (const [k, v] of Object.entries(params)) out[k] = coerce(v);
  return out;
}

function coerce(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** Apply any not-yet-applied migrations from src/migrations, in order. */
function migrate(dir = path.join(__dirname, '..', 'migrations')) {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(all('SELECT name FROM _migrations').map((r) => r.name));
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    : [];
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    tx(() => {
      database.exec(sql);
      run('INSERT INTO _migrations (name, applied_at) VALUES (:name, :at)', {
        name: file,
        at: new Date().toISOString(),
      });
    });
    logger.info('db', 'Applied migration', { file });
    count++;
  }
  if (count === 0) logger.info('db', 'Schema up to date');
  return count;
}

/** Generate a URL-safe, sortable-ish unique id with a type prefix. */
function newId(prefix) {
  // 12 random bytes -> base64url, prefixed so ids are self-describing in logs.
  const rand = crypto.randomBytes(12).toString('base64url');
  return prefix ? `${prefix}_${rand}` : rand;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { connect, getDb, all, get, run, tx, migrate, newId, close };
