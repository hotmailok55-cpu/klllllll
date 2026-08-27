'use strict';

/**
 * Background job queue + worker (spec §42).
 *
 * The web server NEVER does expensive work inside a request. It enqueues a job
 * and returns immediately, so the user sees "Processing…" instead of a frozen
 * browser. A worker loop picks jobs up and runs them.
 *
 * Durability: jobs live in the `jobs` table, so a crash/restart does not lose
 * queued work. Failures retry with exponential backoff up to `max_attempts`,
 * then land in `dead` — we never retry forever. (spec §36)
 *
 * Scaling: run the worker in its own process (`node worker.js`) and it will not
 * compete with web requests. To move to SQS/BullMQ later, reimplement `enqueue`
 * and the claim loop; handlers stay identical.
 */

const db = require('./db');
const { logger } = require('./logger');

const handlers = new Map(); // job type -> async (payload, job) => void

/** Register a handler for a job type. */
function register(type, handler) {
  handlers.set(type, handler);
  return handler;
}

/**
 * Add a job to the queue.
 *
 * @param {string} type      registered job type
 * @param {object} payload   JSON-serializable data
 * @param {object} [options] { delaySeconds, maxAttempts }
 */
function enqueue(type, payload = {}, options = {}) {
  const now = new Date();
  const runAfter = new Date(now.getTime() + (options.delaySeconds || 0) * 1000);
  const id = db.newId('job');
  db.run(
    `INSERT INTO jobs (id, type, payload, status, attempts, max_attempts, run_after, created_at)
     VALUES (:id, :type, :payload, 'queued', 0, :maxAttempts, :runAfter, :createdAt)`,
    {
      id, type,
      payload: JSON.stringify(payload),
      maxAttempts: options.maxAttempts ?? 5,
      runAfter: runAfter.toISOString(),
      createdAt: now.toISOString(),
    }
  );
  logger.debug('queue', 'enqueued', { id, type });
  return id;
}

/**
 * Claim the next runnable job.
 *
 * The UPDATE...WHERE status='queued' is the claim: if two workers race, only
 * one sees `changes === 1`, so a job is never run twice.
 */
function claimNext() {
  const now = new Date().toISOString();
  const candidate = db.get(
    `SELECT * FROM jobs
      WHERE status = 'queued' AND run_after <= :now
      ORDER BY run_after ASC LIMIT 1`,
    { now }
  );
  if (!candidate) return null;

  const claimed = db.run(
    `UPDATE jobs SET status = 'running', started_at = :now, attempts = attempts + 1
      WHERE id = :id AND status = 'queued'`,
    { id: candidate.id, now }
  );
  if (claimed.changes !== 1) return null; // another worker won the race
  return { ...candidate, attempts: candidate.attempts + 1 };
}

/** Run a single job through its handler, recording success or failure. */
async function runJob(job) {
  const handler = handlers.get(job.type);
  const now = () => new Date().toISOString();

  if (!handler) {
    db.run(`UPDATE jobs SET status='dead', last_error=:err, finished_at=:at WHERE id=:id`,
      { id: job.id, err: `No handler registered for type "${job.type}"`, at: now() });
    logger.error('queue', 'no handler for job type', { type: job.type, id: job.id });
    return;
  }

  const started = Date.now();
  try {
    const payload = JSON.parse(job.payload || '{}');
    await handler(payload, job);
    db.run(`UPDATE jobs SET status='done', finished_at=:at, last_error=NULL WHERE id=:id`,
      { id: job.id, at: now() });
    logger.info('queue', 'job done', { type: job.type, id: job.id, ms: Date.now() - started });
  } catch (err) {
    const exhausted = job.attempts >= job.max_attempts;
    if (exhausted) {
      // Give up. A dead job is visible in the admin dashboard rather than
      // silently retrying forever.
      db.run(`UPDATE jobs SET status='dead', last_error=:err, finished_at=:at WHERE id=:id`,
        { id: job.id, err: err.message, at: now() });
      logger.error('queue', 'job dead after max attempts', {
        type: job.type, id: job.id, attempts: job.attempts, error: err.message,
      });
    } else {
      // Exponential backoff: 2^attempts seconds, capped at 5 minutes.
      const delay = Math.min(2 ** job.attempts, 300);
      const runAfter = new Date(Date.now() + delay * 1000).toISOString();
      db.run(`UPDATE jobs SET status='queued', last_error=:err, run_after=:runAfter WHERE id=:id`,
        { id: job.id, err: err.message, runAfter });
      logger.warn('queue', 'job failed, will retry', {
        type: job.type, id: job.id, attempt: job.attempts, retryInSeconds: delay, error: err.message,
      });
    }
  }
}

/**
 * Drain every currently-runnable job. Returns how many ran.
 * Tests call this directly to run the pipeline synchronously.
 */
async function drain(limit = 100) {
  let ran = 0;
  while (ran < limit) {
    const job = claimNext();
    if (!job) break;
    await runJob(job);
    ran++;
  }
  return ran;
}

/** Start a polling worker loop. Returns a stop function. */
function startWorker({ intervalMs = 1000 } = {}) {
  let stopped = false;
  logger.info('queue', 'worker started', { types: [...handlers.keys()] });

  (async function loop() {
    while (!stopped) {
      try {
        const ran = await drain(25);
        // Idle backoff: poll slowly when there is nothing to do.
        await sleep(ran > 0 ? 10 : intervalMs);
      } catch (err) {
        logger.error('queue', 'worker loop error', { error: err.message });
        await sleep(intervalMs);
      }
    }
  })();

  return () => { stopped = true; logger.info('queue', 'worker stopping'); };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Queue depth by status — surfaced on the admin dashboard. (spec §70) */
function stats() {
  const rows = db.all(`SELECT status, COUNT(*) AS count FROM jobs GROUP BY status`);
  const out = { queued: 0, running: 0, done: 0, failed: 0, dead: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}

module.exports = { register, enqueue, claimNext, runJob, drain, startWorker, stats, handlers };
