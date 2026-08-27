<p align="center">
  <img src="frontend/assets/logo-wordmark.png" alt="LJBMK Social" height="64">
</p>

# LJBMK Social

A video social platform built around a vertical scrolling feed, reusable
sounds, and a recommendation algorithm designed to be **fair to new creators**.

Ships as **two clients on one backend**: a web app, and a native
**Android app** you can build in Android Studio and publish to Google Play.

The point of this codebase is not that it has a lot of features. It is that
every part has one job, and that bringing a new external API — copyright,
music, moderation, payments — means writing **one adapter file** and setting
some environment variables.

---

## Run it — web

Requires **Node 22.5+**. No database to install, no build step, no dependencies.

```bash
cd backend
cp .env.example .env          # optional in development
npm run seed                  # realistic demo data (needs ffmpeg for playable video)
npm start                     # http://localhost:4000
```

Then open <http://localhost:4000>.

The seed creates accounts you can sign in with (password
`password-for-development`):

| Email | Who |
|---|---|
| `maya@example.com` | 42k followers, good videos — **also an admin** |
| `devkid@example.com` | **3 followers**, excellent videos |
| `bigstudio@example.com` | 512k followers, poor retention |

Sign in as `maya` to reach `/#/admin`, where the API integration registry lives.

```bash
npm test                      # 91 tests
node worker.js                # background worker (run separately in production)
```

## Run it — Android

Open the **repository root** in Android Studio and press Run. That's it — the
project is already configured.

```bash
./gradlew assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew bundleRelease     # -> the .aab you upload to Google Play
```

One thing to set first: `API_BASE_URL` in `app/build.gradle.kts` has to point at
your backend. The default (`10.0.2.2:4000`) is correct for the emulator talking
to a backend on your own machine.

**Full walkthrough — signing your key, building the AAB, and the Play Store
submission steps — is in [docs/ANDROID.md](docs/ANDROID.md).**

`ffmpeg` is optional. Without it, uploads still work and play at their original
quality; with it, you get generated thumbnails and a multi-quality transcode
ladder.

---

## What is actually built

**Scrolling feed** — CSS scroll-snap, one video active at a time, watch time
measured per video and reported on scroll-away, infinite pagination, keyboard
navigable.

**Sounds as objects** — every upload produces a reusable "original sound".
Tapping the sound chip opens a page of every video using it, and "use this
sound" starts a new video from it.

**A fair algorithm** — a six-stage pipeline that ranks on completion *rate*
rather than view totals, reserves 30% of every feed for videos almost nobody
has seen, and weights fast-skips heavily negative so it does not drift toward
outrage. [Read how it works →](docs/ALGORITHM.md)

**The upload pipeline** — draft created before any bytes are sent (so an
interrupted upload is recoverable), file **signature** validated rather than
its filename, then background transcode → copyright → safety → ready, with the
creator seeing each stage.

**Integration registry** — eight capabilities, each behind an adapter, with
health tracking, circuit breakers and a safe "Test Connection" button. Secrets
never reach the browser and never appear in the admin payload.

**Trust & safety** — a policy engine that owns every decision, with external
classifiers contributing *signals* only. Reports limit reach but never
auto-remove, so brigading is not a takedown tool.

**Copyright** — detection and licensing tracked as separate columns, because
they are different things. A provider outage produces "check pending", never a
false "clear".

Also: comments with capped thread depth, playlists, notifications (fully
event-driven), multi-signal search, velocity-based trending, creator analytics
with real retention curves, account deletion by anonymization, and data export.

---

## Layout

```
app/                 the Android app (Kotlin + Jetpack Compose)
  src/main/java/com/ljbmk/social/
    MainActivity.kt          shell, navigation, bottom bar
    ui/components/           THE LOGO TOP BAR
    ui/feed/                 vertical feed + ExoPlayer
    data/api/                Retrofit client for the backend below

backend/
  server.js  worker.js  scripts/seed.js
  src/
    core/          config, db, http, events, queue, cache, crypto, errors,
                   logger, ratelimit, validate
    migrations/    numbered .sql, applied once
    services/      ALL business logic — recommendations.js is the interesting one
    integrations/  registry + one folder per capability
    routes/v1.js   the versioned API
  tests/

frontend/        plain ES modules, no build step
  js/api.js      the only place that calls fetch()
  js/views/      feed, watch, comments, share, auth, upload, pages

docs/
```

---

## Documentation

| | |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the pieces fit, and the scaling path |
| **[ADDING-AN-API.md](docs/ADDING-AN-API.md)** | **the guide the whole design exists to make short** |
| [ALGORITHM.md](docs/ALGORITHM.md) | how the feed decides, with real numbers |
| [API.md](docs/API.md) | every endpoint |
| [DATABASE.md](docs/DATABASE.md) | schema, migrations, view counting, backups |
| **[ANDROID.md](docs/ANDROID.md)** | **building the APK/AAB and publishing to Google Play** |

---

## Adding an API, in short

```js
// backend/src/integrations/copyright/index.js
class AcmeProvider extends BaseProvider {
  async scanVideo({ videoId, storageKey }) {
    const { body } = await this.request(`${this.apiUrl}/identify`, { … });
    return { result: MAP[body.outcome], licenseState: 'unknown', raw: body };
  }
  async healthCheck() { … }
}

module.exports = {
  fallback: 'null',
  adapters: { null: …, acme: (s) => new AcmeProvider(s) },   // <- register
};
```

```bash
COPYRIGHT_PROVIDER=acme
COPYRIGHT_API_KEY=…
```

That is the whole integration. Retries, timeouts, exponential backoff, the
circuit breaker, health tracking and the admin UI are already handled.

Two rules keep it that way:

1. **Adapters only translate.** They turn our request into theirs and their
   answer into our vocabulary. No policy.
2. **Services decide.** What to *do* about an answer lives in our code, in
   `services/`, versioned with the platform.

That is why swapping vendors is cheap — and why no vendor's model quietly
becomes your terms of service.

---

## Why the algorithm is the way it is

"Most views wins" is not an algorithm, it is a feedback loop:

```
popular  ->  shown more  ->  more popular  ->  shown more  ->  ...
```

Nothing new escapes zero. So three decisions are built into the scoring itself:

1. **Rates, not totals.** The heaviest weight in the model is completion rate —
   a number a creator with no audience can win on from their first upload.
2. **Audience size is discounted, not rewarded.** The small-creator boost decays
   smoothly with `log10(followers)`, so there is no threshold to farm.
3. **Every video gets a trial.** 30% of every feed is reserved for videos below
   the impression threshold.

And because an engagement-only objective learns that outrage works, fast-skips
and dislikes carry a large negative weight, and the safety pass runs **after**
ranking where a high score cannot outvote it.

From the seeded data, a signed-out viewer's feed:

```
 3. I built my first app today    @devkid          5 followers      60 views
10. YOU WONT BELIEVE THIS         @bigstudio  512,003 followers 890,000 views
```

The test suite asserts these properties, so a future tuning change cannot
quietly undo them.

---

## Status

**Phase 1–5 of the spec are implemented and working end to end.** Uploads,
feed, social, discovery and the Creator Studio all function; the integration
layer, event system, queue and admin registry are complete and tested.

Deliberately left as seams rather than half-built:

- **Livestreaming** — flagged off; needs an ingest server.
- **Monetization** — the payments capability exists with a null adapter; no
  financial code has been written, on purpose.
- **Object storage** — the local driver is complete and the S3/GCS adapter is a
  documented template.
- **Search at scale** — currently SQL `LIKE` with real ranking on top. The
  ranking functions stay as they are when you move to FTS5; only the candidate
  query changes.

Legal copy (terms, privacy policy, community guidelines) needs review by
qualified professionals — the infrastructure for it exists, the wording should
not be written by a programmer.
