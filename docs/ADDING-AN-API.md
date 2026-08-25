# Adding an API

This is the guide the whole architecture exists to make short.

When you bring a new external service — a copyright detector, a music
catalogue, a moderation model, a payment processor — you write **one adapter
file** and **set some environment variables**. Nothing else in the platform
changes.

---

## The idea in one picture

```
  Platform code
      |
      |  asks for a CAPABILITY, never for a company
      v
  Service            (services/copyright.js — OUR rules, OUR vocabulary)
      |
      v
  Registry           (integrations/registry.js — health, retries, circuit breaker)
      |
      v
  Provider adapter   (integrations/copyright/index.js — TRANSLATION ONLY)
      |
      v
  The external API
```

Two rules keep this working:

1. **Platform code never imports a provider.** It calls a service; the service
   asks the registry for whatever is configured.
2. **An adapter only translates.** It turns our request into their request and
   their answer into our vocabulary. It contains no policy. What to *do* about
   an answer is decided by the service, in our code.

That second rule is why swapping vendors is cheap, and why no vendor's model
quietly becomes your terms of service.

---

## The ten steps

### 1. Find the capability

Look in `backend/src/integrations/`. There is a folder per capability:

```
copyright/  music/  moderation/  storage/
notifications/  analytics/  payments/  ai/
```

Open the `index.js` in the one you want. The contract every adapter must
implement is documented at the top of the file. **Implement only the methods
your provider actually offers** — do not invent endpoints a vendor does not
have.

### 2. Write the adapter

Copy the `Example…Provider` class already in that file and edit it. Extend
`BaseProvider`, which gives you timeouts, retries with exponential backoff, and
safe logging for free.

```js
class AcmeCopyrightProvider extends BaseProvider {
  constructor(settings) {
    super('acme', settings);              // 'acme' is the name you'll configure
    this.apiUrl = settings.apiUrl || 'https://api.acme.com/v2';
  }

  async scanVideo({ videoId, storageKey, durationMs }) {
    const { body } = await this.request(`${this.apiUrl}/identify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.apiKey}` },
      body: { ref: videoId, asset: storageKey },
    });

    // Translate THEIR words into OURS. This mapping is the entire job.
    const map = {
      no_match: 'clear',
      possible: 'review',
      confirmed: 'match',
      rights_claim: 'claim',
      do_not_publish: 'block',
    };

    return {
      result: map[body.outcome] ?? 'review',
      confidence: body.score,
      matchedWork: body.work?.name ?? null,
      matchedRef: body.work?.id ?? null,
      // Only ever report 'licensed' when they explicitly say so.
      licenseState: body.rights?.granted === true ? 'licensed' : 'unknown',
      raw: body,
    };
  }

  // Required — this powers the admin dashboard's "Test" button.
  async healthCheck() {
    if (!this.settings.apiKey) throw new Error('COPYRIGHT_API_KEY is not set.');
    const { body } = await this.request(`${this.apiUrl}/ping`, {
      headers: { Authorization: `Bearer ${this.settings.apiKey}` },
      retries: 0,             // a health check should fail fast
    });
    return { message: 'Acme reachable.', details: { region: body.region } };
  }
}
```

### 3. Register it

At the bottom of the same file, add it to `adapters`:

```js
module.exports = {
  fallback: 'null',
  adapters: {
    null: (settings) => new NullCopyrightProvider(settings),
    example: (settings) => new ExampleCopyrightProvider(settings),
    acme: (settings) => new AcmeCopyrightProvider(settings),   // <-- yours
  },
};
```

### 4. Add credentials

In your environment (never in source, never in the frontend):

```bash
COPYRIGHT_PROVIDER=acme
COPYRIGHT_API_KEY=the-real-key
COPYRIGHT_API_URL=https://api.acme.com/v2
```

Add the variable names — with fake values — to `backend/.env.example` so the
next person knows they exist.

If the capability needs a config key that does not exist yet, add it to
`config.integrations` in `backend/src/core/config.js`.

### 5. Health checks — already done

You implemented `healthCheck()` in step 2. That is the whole integration. The
registry now tracks status, last success, last failure, average response time,
and consecutive failures automatically.

### 6. Logging — already done

`BaseProvider` logs every request with its duration, and strips query strings
from logged URLs because keys sometimes travel in them. Never `console.log` a
request body or a credential.

### 7. Error handling — already done

The registry wraps every async adapter method with a **circuit breaker**: after
5 consecutive failures it stops calling the provider for 60 seconds and fails
fast instead. `BaseProvider.request()` retries only on failures that are
plausibly transient (network errors, 429, 5xx) — a 400 or 403 is a real answer,
and retrying it just burns quota.

**What you must do:** make sure the *service* degrades sensibly when your
adapter throws. Look at `services/copyright.js` for the pattern — a provider
outage becomes "copyright check pending", never a blocked upload and never a
false "clear".

### 8. Test it

Two ways:

```bash
# From the admin dashboard: open /#/admin and press "Test" on the integration.
# From code:
node -e "
  require('./src/core/db').connect();
  const r = require('./src/integrations/registry');
  r.initialize();
  r.testConnection('copyright').then(console.log);
"
```

Then add a test to `backend/tests/platform.test.js`. At minimum assert what
happens when the provider is **down** — that is the case that actually matters
in production.

### 9. Enable it

Set the relevant feature flag if the capability has one
(`COPYRIGHT_CHECK_ENABLED`, `MUSIC_API_ENABLED`, `AI_MODERATION_ENABLED`,
`MONETIZATION_ENABLED`), then restart. An admin can also enable/disable at
runtime from the dashboard.

### 10. Monitor it

`GET /api/v1/admin/integrations` and the admin dashboard show status, last
success/failure, response time, and whether the circuit is open. Watch it for a
day after connecting anything new.

---

## How the frontend uses a new capability

It doesn't — not directly, and that is the point.

```
Browser  ->  our backend  ->  external provider
```

The browser never holds a credential and never learns which vendor you use. If
a feature needs to be visible in the UI, expose it through our own API:

```js
// backend/src/routes/v1.js
router.get(`${P}/sounds/search`, async (ctx) => {
  return sounds.search({ query: ctx.query.q });   // service decides the provider
});
```

```js
// frontend/js/api.js
searchSounds: (q) => api.get(`/sounds/search?q=${encodeURIComponent(q)}`),
```

---

## Testing locally without the real API

Register a fake adapter under a different name and point the environment at it:

```js
class FakeCopyrightProvider extends BaseProvider {
  constructor(s) { super('fake', s); }
  async scanVideo() { return { result: 'match', matchedWork: 'Test Song', licenseState: 'unknown' }; }
  async healthCheck() { return { message: 'Fake provider, always up.' }; }
}
```

```bash
COPYRIGHT_PROVIDER=fake npm start
```

This is also the easiest way to exercise the failure paths — make the fake throw
and check that the platform degrades instead of breaking.

---

## Checklist

- [ ] Adapter extends `BaseProvider`
- [ ] Implements only methods the provider genuinely has
- [ ] Translates the vendor's vocabulary into ours
- [ ] Contains **no policy decisions**
- [ ] Implements `healthCheck()`
- [ ] Registered in the capability's `adapters` map
- [ ] Variables added to `.env.example` with fake values
- [ ] No secret in source, in the frontend, or in a log line
- [ ] The service degrades gracefully when the provider is down
- [ ] A test covers the provider being offline
- [ ] Verified with the admin dashboard's "Test" button
