# API reference

Base path: **`/api/v1`**

Every breaking change gets a new version (`/api/v2`) rather than editing these.

---

## Conventions

**Success** — always wrapped in `data`:

```json
{ "data": { "video": { "id": "vid_abc", "title": "..." } } }
```

**Error** — always wrapped in `error`, with a stable machine `code`, a message
safe to show a user, and a `requestId` that appears in the server logs:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please check the highlighted fields.",
    "details": { "email": "Enter a valid email address." },
    "requestId": "0f8c…"
  }
}
```

| Code | Status | Meaning |
|---|---:|---|
| `BAD_REQUEST` | 400 | malformed request |
| `UNAUTHORIZED` | 401 | sign-in required, or bad credentials |
| `FORBIDDEN` | 403 | signed in, but not allowed |
| `NOT_FOUND` | 404 | missing — also returned for private content |
| `CONFLICT` | 409 | username/email/handle already taken |
| `VALIDATION_ERROR` | 422 | field-level problems in `details` |
| `RATE_LIMITED` | 429 | slow down |
| `SERVICE_UNAVAILABLE` | 503 | a dependency is down; retry |
| `INTERNAL_ERROR` | 500 | unexpected; `requestId` is in the logs |

**Authentication** — a bearer token from register/login:

```
Authorization: Bearer <token>
```

**Empty states** — list endpoints return an `empty` object when there is
nothing to show. It carries the copy and call-to-action, so the UI never
hard-codes "no results" text:

```json
{
  "videos": [],
  "empty": {
    "title": "No videos yet.",
    "body": "Be one of the first creators to share something.",
    "action": { "label": "Post your first video", "href": "/upload" }
  }
}
```

---

## System

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/system/state` | — | platform stage, counts, feature flags, categories, topics |
| `GET` | `/system/health` | — | liveness probe: database, queue depth, uptime |

`GET /system/state` is what makes the "new platform" experience automatic —
the UI renders from `platform.stage` (`empty` → `seedling` → `growing` →
`established`) rather than from hard-coded copy.

---

## Auth

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `POST` | `/auth/register` | — | create an account (also creates the channel) |
| `POST` | `/auth/login` | — | sign in |
| `POST` | `/auth/logout` | ✓ | revoke the current session |
| `GET` | `/auth/me` | ✓ | current user, channel, unread count |
| `GET` | `/auth/sessions` | ✓ | active devices |
| `DELETE` | `/auth/sessions/:id` | ✓ | sign out one device |
| `POST` | `/auth/verify-email` | — | consume a verification token |
| `POST` | `/auth/forgot-password` | — | request a reset link |
| `POST` | `/auth/reset-password` | — | set a new password with a token |

```http
POST /api/v1/auth/register
{ "username": "louis", "email": "l@example.com",
  "password": "at-least-ten-chars", "displayName": "Louis" }
```

`forgot-password` always returns the same message whether or not the account
exists, so it cannot be used to discover which emails are registered.

---

## Users

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `PATCH` | `/users/me` | ✓ | update profile / privacy / notification settings |
| `POST` | `/users/me/interests` | ✓ | onboarding topics (the cold-start signal) |
| `GET` | `/users/me/export` | ✓ | download everything we hold about you |
| `DELETE` | `/users/me` | ✓ | delete account (`confirm` must equal your username) |
| `POST` | `/users/:id/block` | ✓ | block an account |
| `DELETE` | `/users/:id/block` | ✓ | unblock |

---

## Feed & discovery

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/feed` | opt | **the main scrolling feed** |
| `GET` | `/trending` | opt | velocity-ranked, not lifetime views |
| `GET` | `/me/subscriptions` | ✓ | chronological, from creators you follow |
| `GET` | `/channels` | opt | suggested creators (mixes new and established) |

```http
GET /api/v1/feed?kind=short&limit=10&cursor=0
```

```json
{
  "videos": [ … ],
  "mode": "personalized",
  "platform": { "stage": "growing", "publicVideoCount": 142 },
  "nextCursor": 10,
  "explain": {
    "candidatesConsidered": 187,
    "afterFiltering": 96,
    "strategy": "Personalized from watch history, interests, and follows.",
    "explorationShare": 0.3
  }
}
```

`mode` is one of `empty_platform`, `cold_start_user`, `personalized`.
`explain` is returned so the ranking is inspectable rather than opaque.

---

## Videos

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/videos/:id` | opt | video + related (from the same pipeline) |
| `PATCH` | `/videos/:id` | ✓ | title, description, category, tags, visibility |
| `DELETE` | `/videos/:id` | ✓ | soft delete |
| `POST` | `/videos/:id/like` | ✓ | toggle like |
| `POST` | `/videos/:id/dislike` | ✓ | toggle dislike |
| `POST` | `/videos/:id/save` | ✓ | toggle save |
| `POST` | `/videos/:id/share` | opt | record a share |
| `POST` | `/videos/:id/watch` | opt | **watch heartbeat** |
| `POST` | `/videos/:id/report` | ✓ | report |
| `POST` | `/videos/:id/sound` | ✓ | attach a sound |

The watch heartbeat drives both view counting and the recommendation profile:

```http
POST /api/v1/videos/vid_abc/watch
{ "watchMs": 8200, "source": "feed", "replayed": false }

→ { "counted": true, "views": 446 }
```

The **client never asserts a view**. It reports time watched; the server
decides whether that counts (see [DATABASE.md](DATABASE.md#view-counting)).

---

## Upload

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `POST` | `/uploads` | ✓ | create a draft (before any bytes) |
| `POST` | `/uploads/:id/file` | ✓ | raw video body |
| `POST` | `/uploads/:id/thumbnail` | ✓ | raw image body |
| `GET` | `/uploads/:id/status` | ✓ | pipeline progress |
| `GET` | `/uploads/drafts` | ✓ | unfinished uploads |

The draft exists before the upload starts, so an interrupted upload is
recoverable rather than lost.

```http
GET /api/v1/uploads/vid_abc/status

{ "status": "checking_copyright",
  "message": "Checking copyright…",
  "progress": 75,
  "canPublish": false }
```

`message` is meant to be shown verbatim — the backend owns the wording so the
user always knows what is happening.

---

## Comments

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/videos/:id/comments` | opt | `?sort=top\|new`, replies inlined |
| `POST` | `/videos/:id/comments` | ✓ | comment or reply (`parentId`) |
| `GET` | `/comments/:id/replies` | opt | full reply list |
| `PATCH` | `/comments/:id` | ✓ | edit your own |
| `DELETE` | `/comments/:id` | ✓ | author, video owner, or staff |
| `POST` | `/comments/:id/like` | ✓ | toggle |
| `POST` | `/comments/:id/report` | ✓ | report |

Threads cap at depth 2; deeper replies attach to the grandparent.

---

## Search

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/search` | opt | videos, channels and sounds, ranked |
| `GET` | `/search/suggest` | opt | autocomplete |
| `GET` | `/search/recent` | opt | recent searches |
| `DELETE` | `/search/recent` | ✓ | clear history |

```http
GET /api/v1/search?q=roblox&type=video&category=gaming&maxDuration=60000
```

Filters: `type`, `category`, `kind`, `uploadedAfter`, `minDuration`,
`maxDuration`.

---

## Sounds

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/sounds/popular` | — | most-used sounds |
| `GET` | `/sounds/trending` | — | rising this week |
| `GET` | `/sounds/search` | opt | local library + provider, if connected |
| `GET` | `/sounds/:id` | opt | the sound + every video using it |
| `POST` | `/sounds/import` | ✓ | import an external track (rights-checked) |

`/sounds/import` **refuses** unless the provider explicitly grants the usage.
Connecting a music API does not make its catalogue usable.

---

## Channels

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/channels/:handle` | opt | profile, videos, playlists |
| `PATCH` | `/channels/:id` | ✓ | handle, name, description, images, links |
| `POST` | `/channels/:id/follow` | ✓ | toggle follow |
| `POST` | `/channels/:id/notify` | ✓ | notification bell |
| `GET` | `/channels/:id/videos` | opt | paginated videos |
| `GET` | `/me/following` | ✓ | channels you follow |

---

## Library & notifications

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/notifications` | ✓ | list + unread count |
| `POST` | `/notifications/read` | ✓ | mark read (all, or by `ids`) |
| `GET` | `/playlists` | ✓ | your playlists |
| `POST` | `/playlists` | ✓ | create |
| `GET` | `/playlists/:id` | opt | playlist + videos |
| `PATCH` | `/playlists/:id` | ✓ | update |
| `DELETE` | `/playlists/:id` | ✓ | delete |
| `POST` | `/playlists/:id/videos` | ✓ | add a video |
| `DELETE` | `/playlists/:id/videos/:videoId` | ✓ | remove |
| `GET` | `/me/saved` | ✓ | saved videos |

---

## Creator Studio

| Method | Path | Auth | Description |
|---|---|:--:|---|
| `GET` | `/studio/dashboard` | ✓ | stats, recent videos, processing status |
| `GET` | `/studio/content` | ✓ | all your videos, including drafts |
| `GET` | `/studio/videos/:id/analytics` | ✓ | retention curve, traffic sources, daily views |
| `GET` | `/studio/copyright` | ✓ | your copyright cases, in plain language |

---

## Admin

Requires `role = admin` (moderator for the queues).

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/overview` | counts, queue depth, memory, integrations |
| `GET` | `/admin/integrations` | **the API registry** |
| `POST` | `/admin/integrations/:key/test` | safe "Test Connection" |
| `POST` | `/admin/integrations/:key/enabled` | enable / disable |
| `GET` | `/admin/moderation` | moderation queue + open reports |
| `POST` | `/admin/moderation/:id/resolve` | `allow` / `limit` / `remove` |
| `GET` | `/admin/copyright` | copyright case queue |
| `POST` | `/admin/copyright/:id/resolve` | decide, and record licence state |

```json
{
  "integrations": [
    {
      "key": "copyright",
      "label": "Copyright Detection",
      "provider": "null",
      "enabled": true,
      "configured": false,
      "status": "not_connected",
      "lastSuccessAt": null,
      "avgResponseMs": null,
      "circuitOpen": false
    }
  ]
}
```

**No secret value is ever returned here** — only `configured: true/false`.
There is no code path that could return a key.

---

## Media

| Method | Path | Description |
|---|---|---|
| `GET` | `/media/*` | streams a stored file, with HTTP range support |

Only used when `CDN_URL` is unset. With a CDN configured, every media URL
points at the CDN and large files never touch the application server.

---

## Rate limits

| Bucket | Limit |
|---|---|
| `login` | 10 / 15 min |
| `register` | 5 / hour |
| `passwordReset` | 5 / hour |
| `upload` | 30 / hour |
| `comment` | 15 / min |
| `reaction` | 60 / min |
| `report` | 20 / hour |
| `search` | 60 / min |
| `feed` | 120 / min |
| `view` | 240 / min |

Identified by user id when signed in, otherwise by hashed IP.
