# Database

Schema: [`backend/src/migrations/001_initial_schema.sql`](../backend/src/migrations/001_initial_schema.sql)

---

## Three rules

**1. Video files are never in the database.** Rows store a `storage_key`; the
bytes live in object storage. This is what makes the CDN swap a config change
instead of a rewrite.

**2. Counters are a cache.** `videos.view_count` is derived. The truth is
`view_events`. If a counter drifts,
`analytics.recomputeVideoStats(videoId)` rebuilds it from the log.

**3. Detection and licensing are separate columns.** `copyright_cases.result`
says what a provider *found*; `license_state` says whether we are *permitted*.
Connecting an API never sets the second one.

---

## Migrations

Numbered `.sql` files in `backend/src/migrations/`, applied once, in filename
order, tracked in `_migrations`. They run automatically at boot.

To change the schema, add a new file — **never edit an applied one**:

```
001_initial_schema.sql
002_add_livestreams.sql       <- your change
```

```sql
-- 002_add_livestreams.sql
ALTER TABLE videos ADD COLUMN live_status TEXT;
CREATE INDEX idx_videos_live ON videos(live_status) WHERE live_status IS NOT NULL;
```

Each migration runs inside a transaction, so a failure rolls back cleanly.

---

## Tables

### Identity

**`users`** — one row per account.

| Column | Notes |
|---|---|
| `id` | `usr_…` |
| `username` | unique, lowercase, becomes the @handle |
| `email` | unique, lowercase |
| `password_hash` | scrypt, self-describing (`scrypt$N$r$p$salt$hash`) |
| `status` | `active` / `suspended` / `deactivated` / `deleted` |
| `role` | `user` / `moderator` / `admin` |
| `onboarded` | has the interest picker been completed |
| `privacy_settings`, `notification_settings`, `preferences` | JSON — promote a field to a real column once you need to query it |

**`sessions`** — one per signed-in device. `token_hash` is a SHA-256 of the
token; the raw token exists only in the client. Revocable individually.

**`auth_tokens`** — single-use tokens for email verification and password
reset, distinguished by `purpose`.

### Content

**`channels`** — the creator profile. Created automatically at registration, so
everyone can post without a separate "become a creator" step.

**`videos`** — the central table.

| Column | Notes |
|---|---|
| `kind` | `short` (vertical, the feed) or `long` |
| `storage_key`, `thumbnail_key` | pointers into storage, never bytes |
| `renditions` | JSON: `[{quality, key, bitrate}]` |
| `visibility` | `public` / `unlisted` / `private` |
| `processing_status` | `draft` → `uploading` → `uploaded` → `processing` → `checking_copyright` → `checking_safety` → `ready`, or `failed` |
| `copyright_status` | `pending` / `clear` / `review` / `match` / `claim` / `restrict` / `block` |
| `moderation_status` | `pending` / `approved` / `flagged` / `removed` |
| `view_count` … `total_watch_ms` | **caches**, recomputable |
| `deleted_at` | soft delete — keeps comments and analytics coherent |

**`sounds`** — audio as a first-class, reusable object. This is what makes
"use this sound" work, and turns audio into its own discovery surface.

| Column | Notes |
|---|---|
| `source` | `original` (made here) / `library` / `provider` |
| `rights_status` | `unknown` / `cleared` / `restricted` / `blocked` |
| `use_count` | how many videos use it |

A sound is only offered in the picker when it is `original` or explicitly
`cleared`. Default is `unknown`, which means **not usable**.

**`captions`** — separate table so one video can have several languages and
sources (`creator` / `auto` / `provider`).

### Social

`follows`, `reactions` (`value` = 1 or −1), `saves`, `blocks`, `comments`
(with `depth`, capped at 2), `comment_likes`, `playlists`, `playlist_items`.

### Events — the source of truth

**`view_events`** — one row per **counted** view. Written only after the rules
below pass.

**`watch_events`** — every heartbeat, counted or not. Powers retention curves,
completion rate, and the `skipped_fast` negative signal the algorithm relies on.

**`analytics_events`** — every published domain event, append-only. Lets you
compute a metric you had not thought of yet, retroactively.

### Personalization

**`user_interests`** — topic weights. `source` distinguishes `onboarding` from
`behavior`. Behavioural weights decay hourly so taste can change.

**`user_creator_affinity`** — learned per-creator preference.

**`feed_impressions`** — what has been shown to whom. Drives both the "don't
repeat" filter *and* the exploration fairness signal.

### Trust & safety

`reports` (user-submitted), `moderation_cases` (every decision, with the raw
`signals` that produced it, for audit), `copyright_cases`, `audit_log`.

### Infrastructure

**`jobs`** — the durable queue. `run_after` implements exponential backoff;
`status` reaches `dead` after `max_attempts` rather than retrying forever.

**`api_integrations`** — the admin registry. Records provider, enabled,
`configured` (boolean only), status, last success/failure, response time, and
`circuit_open_until`. **It never stores a credential.**

---

## View counting

`analytics.shouldCountView()` — all rules configurable in `VIEW_RULES`:

| Rule | Default | Guards against |
|---|---|---|
| minimum watch time | 2s | accidental taps |
| minimum completion (short videos) | 30% | a scroll-past counting as a view |
| dedupe window | 30 min per viewer per video | refreshes |
| per-viewer cap | 120 views/hour | automation |

Viewers are identified by `viewer_key`: the user id when signed in, otherwise a
salted hash of IP + user-agent — enough to dedupe without storing anything
identifying.

---

## Indexes

Every index exists for a query that actually runs:

| Index | Serves |
|---|---|
| `idx_videos_feed` | candidate generation (visibility, status, kind, recency) |
| `idx_videos_channel` | a creator's content list |
| `idx_videos_sound` | "more videos with this sound" |
| `idx_view_events_dedupe` | "has this viewer been counted recently?" |
| `idx_watch_events_video` | retention curves |
| `idx_jobs_claim` | the worker's next-job query |
| `idx_comments_video` | comment listing by thread and recency |
| `idx_sessions_expires` | expired-session cleanup |

---

## Account deletion

Deletion **anonymizes**, it does not drop rows. A hard delete would tear holes
in other people's conversations — replies to a deleted comment would vanish
mid-thread.

| Data | What happens |
|---|---|
| email, username, display name, bio, avatar | replaced with placeholders |
| videos | soft-deleted, made private |
| comments | body → `[deleted]`, row kept so threads survive |
| sessions | all revoked |
| interests, affinity, search history | **hard-deleted** — nobody else depends on them |

---

## Backups

SQLite, safely (do not copy the file while it is being written):

```bash
sqlite3 data/platform.db ".backup '/backups/platform-$(date +%F).db'"
```

Object storage needs its own backup — the database only holds keys, so a
database restore without the files gives you a catalogue of missing videos.

**Test a restore.** A backup you have never restored is a hypothesis, not a
backup.
