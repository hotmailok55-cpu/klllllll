# Architecture

How LJBMK Social is put together, and why.

---

## The shape

```
  Browser (frontend/)
      |  fetch, JSON only, no credentials ever
      v
  HTTP layer      core/http.js        routing, auth, errors, request ids
      |
      v
  Routes          routes/v1.js        thin: validate -> call one service -> return
      |
      v
  Services        services/*.js       ALL the business logic and policy
      |
      +---> core/db.js          database access
      +---> core/events.js      publish domain events
      +---> core/queue.js       enqueue expensive work
      +---> integrations/       registry -> adapter -> external API
```

Two directions of dependency, both enforced by convention:

- **Routes never contain logic.** If a handler grows past a dozen lines, the
  logic belongs in a service.
- **Services never import a vendor.** They ask the registry for a *capability*.

---

## Directory map

```
backend/
  server.js            web server (+ in-process worker in development)
  worker.js            background worker only — run separately in production
  scripts/seed.js      realistic development data

  src/
    core/              infrastructure, no business logic
      config.js        every environment variable, read in ONE place
      db.js            database access + migrations
      http.js          router, request lifecycle, error shaping
      events.js        the event bus
      queue.js         durable job queue with retries and backoff
      cache.js         TTL cache (used sparingly, always with expiry)
      crypto.js        password hashing, token generation
      errors.js        typed errors -> clean HTTP responses
      logger.js        structured logs with secret redaction
      ratelimit.js     per-action budgets
      validate.js      input validation

    migrations/        numbered .sql files, applied once, in order

    services/          the platform's actual behaviour
      users.js           accounts, sessions, blocking, deletion, export
      channels.js        creator profiles, the follow graph
      videos.js          video records, visibility, reactions
      uploads.js         upload intake, file validation, drafts
      processing.js      transcode / thumbnail pipeline (background)
      sounds.js          music and audio as reusable objects
      comments.js        threads, depth capping
      recommendations.js THE FEED ALGORITHM
      trending.js        velocity-based trending
      search.js          multi-signal ranked search
      notifications.js   event-driven, subscribes to the bus
      moderation.js      the policy engine
      copyright.js       detection vs licensing, kept separate
      analytics.js       the event log, view counting, creator stats
      playlists.js       playlists and saved videos

    integrations/      the ONLY place external APIs are touched
      registry.js        capability -> adapter, health, circuit breaker
      BaseProvider.js    timeouts, retries, backoff, safe logging
      copyright/ music/ moderation/ storage/
      notifications/ analytics/ payments/ ai/

    routes/v1.js       the versioned HTTP API

  tests/platform.test.js

frontend/              plain ES modules, no build step
  index.html
  styles.css
  js/
    api.js             the only place that calls fetch()
    ui.js              DOM helpers, formatting, sheets, empty states
    app.js             router + session
    views/             feed, watch, comments, share, auth, upload, pages

docs/
```

---

## Why these choices

### Zero runtime dependencies

The backend uses only Node built-ins: `node:http`, `node:sqlite`,
`node:crypto`. You can read every line that runs. There is no framework
behaviour to discover, no transitive dependency to audit, and `node server.js`
just works.

That is a starting position, not a religion. Add a library when a real need
appears — but each one should earn its place.

### SQLite, behind an abstraction

SQLite is genuinely good for development and a small production deployment, and
it means no database to install. Everything goes through `core/db.js`
(`get` / `all` / `run` / `tx`), so moving to Postgres means reimplementing that
one thin file, not touching services.

**Video files never go in the database.** The database stores a `storage_key`;
the bytes live in the storage integration. That single rule is what makes the
CDN swap a config change.

### No frontend build step

Plain ES modules, served as-is. You can open `frontend/js/views/feed.js` in the
browser's debugger and it is the same file that is on disk. Add a bundler when
the app is big enough to need one.

---

## The event system

Services publish; other services subscribe. The video service contains **no
notification code at all**:

```js
// services/videos.js
publish(EVENTS.VIDEO_LIKED, { videoId, userId, creatorId });

// services/notifications.js — a completely separate file
subscribe(EVENTS.VIDEO_LIKED, ({ payload }) => {
  create({ userId: payload.creatorId, type: 'like', ... });
});
```

Adding a new reaction to an existing event means editing one subscriber, never
the publisher.

Every published event is also written to `analytics_events`, so statistics can
be **recomputed** and new metrics can be calculated retroactively.

Today the bus is in-process. Swapping it for Kafka/SQS/Redis Streams means
reimplementing `publish`/`subscribe` — the call sites do not change.

---

## Counters are a cache

`videos.view_count` is not the truth. `view_events` is.

```
view_events   ->  recomputeVideoStats()  ->  videos.view_count
watch_events  ->  retention curves, completion rates, the algorithm's signals
```

If a counter drifts, `analytics.recomputeVideoStats(videoId)` repairs it from
the log. This is asserted in the tests.

---

## Background work

The web server never transcodes. `uploads.receiveFile()` stores the bytes,
enqueues `video.process`, and returns — the browser sees "Processing…" instead
of freezing.

```
video.process  ->  probe, thumbnail, transcode ladder
      |
      v
video.copyright  ->  copyright service (own job, so it can fail alone)
      |
      v
video.moderate   ->  moderation service
      |
      v
finalize()       ->  status becomes 'ready'
```

Each stage is a separate job, so a copyright API outage does not force a
re-transcode. Failures retry with exponential backoff up to `max_attempts`,
then land in `dead` where the admin dashboard shows them. Nothing retries
forever.

Run workers separately in production:

```bash
node server.js --web    # web only
node worker.js          # one or more of these
```

The job claim is atomic (`UPDATE ... WHERE status='queued'` and check
`changes === 1`), so two workers never run the same job.

---

## Scaling path

Nothing important lives in process memory, with two deliberate exceptions that
are documented and easy to replace:

| Today | At scale |
|---|---|
| `core/cache.js` — in-memory TTL | Redis, same interface |
| `core/ratelimit.js` — in-memory counters | Redis `INCR` + `EXPIRE` |
| `core/queue.js` — SQLite-backed | SQS / BullMQ, same `enqueue` |
| `core/events.js` — in-process | Kafka / Redis Streams, same `publish` |
| SQLite | Postgres, reimplement `core/db.js` |
| local storage | S3/GCS adapter + `CDN_URL` |

Sessions are already stateless from the server's point of view: the token is
opaque and validated against the database, so any server can serve any request.

---

## Security posture

| Concern | Where |
|---|---|
| Password hashing | scrypt, `core/crypto.js` |
| Session tokens | random, stored **hashed**, revocable per device |
| Account enumeration | login returns an identical error either way |
| Input validation | `core/validate.js`, every route |
| Upload safety | file **signature** checked, not the filename or MIME |
| Path traversal | storage keys resolved against the root and refused if they escape |
| Uploaded content | served with `nosniff` + a `sandbox` CSP, never executed |
| Rate limiting | per-action budgets, `core/ratelimit.js` |
| Secrets | environment only; never in source, never sent to the browser |
| Logging | `logger.redact()` strips passwords, tokens, keys |
| Audit trail | `audit_log` for privileged actions |

---

## Environments

`NODE_ENV` selects behaviour:

- **development** — random dev auth secret, pretty logs, verification links
  printed to the console, in-process worker.
- **production** — refuses to boot without `AUTH_SECRET`, JSON logs, warns if
  storage is still local.

Use separate databases and storage per environment. Never point a staging
deployment at production storage.
