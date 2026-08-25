-- ============================================================================
-- 001_initial_schema.sql — Loop platform core schema
--
-- Design rules followed here:
--  * Video BINARY data never lives in this database. Only metadata + a
--    `storage_key` pointing into object storage. (spec §12)
--  * Counter columns (views, likes...) are CACHES for fast reads. The truth is
--    the event tables (`view_events`, `watch_events`, `analytics_events`), so
--    every statistic can be recomputed. (spec §14, §28, §29)
--  * Indexes are added for the queries we actually run, listed next to them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- USERS & AUTH
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  username            TEXT NOT NULL UNIQUE,          -- lowercase, unique handle
  display_name        TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,          -- stored lowercase
  password_hash       TEXT NOT NULL,                 -- scrypt; never plaintext
  avatar_url          TEXT,
  bio                 TEXT NOT NULL DEFAULT '',

  -- lifecycle / trust
  status              TEXT NOT NULL DEFAULT 'active',    -- active|suspended|deactivated|deleted
  role                TEXT NOT NULL DEFAULT 'user',      -- user|moderator|admin
  email_verified      INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'none',      -- none|verified
  moderation_status   TEXT NOT NULL DEFAULT 'clear',     -- clear|flagged|restricted
  is_creator          INTEGER NOT NULL DEFAULT 0,

  -- JSON blobs keep the shape flexible while the product settles. Promote a
  -- field to a real column once it needs to be queried or indexed.
  privacy_settings      TEXT NOT NULL DEFAULT '{}',
  notification_settings TEXT NOT NULL DEFAULT '{}',
  preferences           TEXT NOT NULL DEFAULT '{}',

  -- Cold-start onboarding: interests chosen at signup seed recommendations
  -- before the user has any watch history. (spec §22)
  onboarded           INTEGER NOT NULL DEFAULT 0,

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT
);
CREATE INDEX idx_users_status ON users(status);

-- Session tokens. Stored HASHED so a database leak does not hand over live
-- sessions. Supports device/session management + revocation. (spec §6)
CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  device_label   TEXT NOT NULL DEFAULT '',
  ip_hash        TEXT,                              -- hashed, not raw IP
  created_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);          -- list my devices
CREATE INDEX idx_sessions_expires ON sessions(expires_at);    -- cleanup job

-- One table for short-lived one-time tokens: email verification, password
-- reset, account recovery. `purpose` distinguishes them.
CREATE TABLE auth_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL,                        -- email_verify|password_reset
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id, purpose);

-- ---------------------------------------------------------------------------
-- CHANNELS (creator profiles)
-- ---------------------------------------------------------------------------
CREATE TABLE channels (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  handle          TEXT NOT NULL UNIQUE,             -- @handle, lowercase
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  avatar_url      TEXT,
  banner_url      TEXT,
  links           TEXT NOT NULL DEFAULT '[]',       -- JSON array of {label,url}

  -- Denormalized counters (caches; recomputable from source tables).
  follower_count  INTEGER NOT NULL DEFAULT 0,
  video_count     INTEGER NOT NULL DEFAULT 0,
  total_views     INTEGER NOT NULL DEFAULT 0,

  status          TEXT NOT NULL DEFAULT 'active',   -- active|suspended|deleted
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_channels_owner ON channels(owner_id);

-- ---------------------------------------------------------------------------
-- SOUNDS  (music / audio as a first-class object)
--
-- A sound is reusable: creators attach an existing sound to a new video
-- ("use this sound"), which makes audio a discovery surface of its own.
--
-- IMPORTANT (spec §81): `rights_status` is SEPARATE from copyright detection.
-- Detecting a track is not the same as being licensed to use it. A sound is
-- only offered in the picker when rights_status = 'cleared'.
-- ---------------------------------------------------------------------------
CREATE TABLE sounds (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  artist         TEXT NOT NULL DEFAULT '',

  -- Where the sound came from.
  source         TEXT NOT NULL DEFAULT 'original',  -- original|library|provider
  provider       TEXT,                              -- music provider name, if any
  provider_ref   TEXT,                              -- provider's own track id
  origin_video_id TEXT,                             -- if extracted from a video

  storage_key    TEXT,                              -- object storage, not the DB
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  cover_url      TEXT,

  -- Licensing state. Deliberately conservative by default.
  rights_status  TEXT NOT NULL DEFAULT 'unknown',   -- unknown|cleared|restricted|blocked
  rights_note    TEXT NOT NULL DEFAULT '',
  rights_checked_at TEXT,

  use_count      INTEGER NOT NULL DEFAULT 0,        -- how many videos use it
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_sounds_use_count ON sounds(use_count DESC);        -- "popular sounds"
CREATE INDEX idx_sounds_rights ON sounds(rights_status);            -- pickable sounds
CREATE UNIQUE INDEX idx_sounds_provider_ref ON sounds(provider, provider_ref)
  WHERE provider IS NOT NULL AND provider_ref IS NOT NULL;

-- ---------------------------------------------------------------------------
-- VIDEOS
-- ---------------------------------------------------------------------------
CREATE TABLE videos (
  id                 TEXT PRIMARY KEY,
  channel_id         TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  creator_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  category           TEXT NOT NULL DEFAULT 'other',
  tags               TEXT NOT NULL DEFAULT '[]',    -- JSON array of strings

  -- 'short' = vertical, swipeable, the main feed surface.
  -- 'long'  = standard landscape watch page.
  kind               TEXT NOT NULL DEFAULT 'short', -- short|long
  sound_id           TEXT REFERENCES sounds(id) ON DELETE SET NULL,

  -- Storage pointers. NEVER the file bytes themselves.
  storage_key        TEXT,
  thumbnail_key      TEXT,
  duration_ms        INTEGER NOT NULL DEFAULT 0,
  width              INTEGER,
  height             INTEGER,
  -- Available transcoded renditions, JSON: [{quality:'720p',key:'…',bitrate:…}]
  renditions         TEXT NOT NULL DEFAULT '[]',

  visibility         TEXT NOT NULL DEFAULT 'private', -- public|unlisted|private
  -- The pipeline the upload moves through, surfaced to the creator verbatim so
  -- they always know what is happening. (spec §72)
  processing_status  TEXT NOT NULL DEFAULT 'draft',
    -- draft|uploading|uploaded|processing|checking_copyright|checking_safety|ready|failed
  processing_error   TEXT,
  copyright_status   TEXT NOT NULL DEFAULT 'pending', -- pending|clear|review|match|claim|restrict|block
  moderation_status  TEXT NOT NULL DEFAULT 'pending', -- pending|approved|flagged|removed

  -- Counter caches. Recomputable from event tables.
  view_count         INTEGER NOT NULL DEFAULT 0,
  like_count         INTEGER NOT NULL DEFAULT 0,
  dislike_count      INTEGER NOT NULL DEFAULT 0,
  comment_count      INTEGER NOT NULL DEFAULT 0,
  share_count        INTEGER NOT NULL DEFAULT 0,
  save_count         INTEGER NOT NULL DEFAULT 0,
  total_watch_ms     INTEGER NOT NULL DEFAULT 0,

  published_at       TEXT,                          -- set when it goes live
  scheduled_at       TEXT,                          -- future: scheduled publish
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT
);
-- Feed/candidate generation: newest public+ready videos of a kind.
CREATE INDEX idx_videos_feed ON videos(visibility, processing_status, kind, published_at DESC);
-- A creator's own content list (Studio).
CREATE INDEX idx_videos_channel ON videos(channel_id, created_at DESC);
-- "More videos using this sound".
CREATE INDEX idx_videos_sound ON videos(sound_id);
CREATE INDEX idx_videos_category ON videos(category, published_at DESC);

-- Creator-uploaded or generated captions. Separate table so one video can have
-- several languages and several sources. (spec §47)
CREATE TABLE captions (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  language    TEXT NOT NULL DEFAULT 'en',
  source      TEXT NOT NULL DEFAULT 'creator',      -- creator|auto|provider
  storage_key TEXT,
  content     TEXT,                                 -- inline WebVTT for small files
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_captions_video ON captions(video_id);

-- ---------------------------------------------------------------------------
-- SOCIAL GRAPH & INTERACTIONS
-- ---------------------------------------------------------------------------
CREATE TABLE follows (
  follower_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id   TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  notify       INTEGER NOT NULL DEFAULT 1,          -- bell: notify on new upload
  created_at   TEXT NOT NULL,
  PRIMARY KEY (follower_id, channel_id)
);
CREATE INDEX idx_follows_channel ON follows(channel_id);   -- who follows me

-- Reactions. One row per (user, video); `value` flips between like/dislike.
CREATE TABLE reactions (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  value      INTEGER NOT NULL,                      -- 1 = like, -1 = dislike
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX idx_reactions_video ON reactions(video_id, value);

CREATE TABLE saves (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, video_id)
);

CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

-- ---------------------------------------------------------------------------
-- COMMENTS
-- `depth` is capped by the comment service so threads stay usable. (spec §17)
-- ---------------------------------------------------------------------------
CREATE TABLE comments (
  id                TEXT PRIMARY KEY,
  video_id          TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id         TEXT REFERENCES comments(id) ON DELETE CASCADE,
  depth             INTEGER NOT NULL DEFAULT 0,
  body              TEXT NOT NULL,
  like_count        INTEGER NOT NULL DEFAULT 0,
  reply_count       INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'approved', -- approved|pending|flagged|removed
  edited_at         TEXT,
  created_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX idx_comments_video ON comments(video_id, parent_id, created_at DESC);

CREATE TABLE comment_likes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, comment_id)
);

-- ---------------------------------------------------------------------------
-- PLAYLISTS
-- ---------------------------------------------------------------------------
CREATE TABLE playlists (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL DEFAULT 'private',      -- public|unlisted|private
  video_count INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_playlists_owner ON playlists(owner_id);

CREATE TABLE playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  added_at    TEXT NOT NULL,
  PRIMARY KEY (playlist_id, video_id)
);
CREATE INDEX idx_playlist_items_order ON playlist_items(playlist_id, position);

-- ---------------------------------------------------------------------------
-- EVENT / STATISTICS TABLES  — the source of truth for analytics
-- ---------------------------------------------------------------------------

-- One row per COUNTED view. The view service decides what counts (dedupe
-- window, minimum watch time, bot signals) before inserting. (spec §29)
CREATE TABLE view_events (
  id          TEXT PRIMARY KEY,
  video_id    TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,  -- null = signed out
  viewer_key  TEXT NOT NULL,                       -- hashed user-or-device key
  watch_ms    INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'feed',        -- feed|search|channel|sound|direct
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_view_events_video_time ON view_events(video_id, created_at DESC);
-- Dedupe lookups: "has this viewer been counted for this video recently?"
CREATE INDEX idx_view_events_dedupe ON view_events(video_id, viewer_key, created_at DESC);

-- Every watch heartbeat, counted or not. Powers retention curves, completion
-- rate, and the "did they scroll away instantly?" negative signal.
CREATE TABLE watch_events (
  id             TEXT PRIMARY KEY,
  video_id       TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  viewer_key     TEXT NOT NULL,
  watch_ms       INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  completion     REAL NOT NULL DEFAULT 0,           -- 0..1 (can exceed 1 on loops)
  replayed       INTEGER NOT NULL DEFAULT 0,
  skipped_fast   INTEGER NOT NULL DEFAULT 0,        -- left in the first ~2s
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_watch_events_video ON watch_events(video_id, created_at DESC);
CREATE INDEX idx_watch_events_user ON watch_events(user_id, created_at DESC);

-- Generic append-only event log. Every published domain event lands here so
-- statistics can be rebuilt and new metrics added retroactively. (spec §27/§28)
CREATE TABLE analytics_events (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  actor_id   TEXT,
  subject_id TEXT,
  payload    TEXT NOT NULL DEFAULT '{}',           -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX idx_analytics_name_time ON analytics_events(name, created_at DESC);
CREATE INDEX idx_analytics_subject ON analytics_events(subject_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- PERSONALIZATION
-- ---------------------------------------------------------------------------

-- Interests chosen during onboarding AND learned from behaviour. `weight`
-- rises as the user watches a topic and decays over time, so the profile
-- follows changing taste instead of freezing at signup. (spec §22)
CREATE TABLE user_interests (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic      TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1.0,
  source     TEXT NOT NULL DEFAULT 'onboarding',   -- onboarding|behavior
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, topic)
);

-- Affinity toward a specific creator, learned from watch behaviour.
CREATE TABLE user_creator_affinity (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  weight     REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

-- What we have already shown this user, so the feed does not repeat itself.
CREATE TABLE feed_impressions (
  user_key   TEXT NOT NULL,                        -- user id, or device key
  video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  shown_at   TEXT NOT NULL,
  PRIMARY KEY (user_key, video_id)
);
CREATE INDEX idx_impressions_time ON feed_impressions(user_key, shown_at DESC);

CREATE TABLE search_queries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  query      TEXT NOT NULL,
  results    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_search_user ON search_queries(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- follow|like|comment|reply|mention|upload|system|moderation|security
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject_id TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- TRUST & SAFETY
-- ---------------------------------------------------------------------------
CREATE TABLE reports (
  id           TEXT PRIMARY KEY,
  reporter_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_type  TEXT NOT NULL,   -- video|comment|channel|user
  target_id    TEXT NOT NULL,
  category     TEXT NOT NULL,   -- spam|harassment|copyright|impersonation|unsafe|scam|other
  details      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open',  -- open|reviewing|resolved|dismissed
  resolution   TEXT,
  handled_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);
CREATE INDEX idx_reports_queue ON reports(status, created_at);
CREATE INDEX idx_reports_target ON reports(target_type, target_id);

-- A moderation decision, whoever/whatever made it. `signals` records what each
-- provider said so a human can audit why. (spec §32)
CREATE TABLE moderation_cases (
  id           TEXT PRIMARY KEY,
  target_type  TEXT NOT NULL,   -- video|comment|channel|user
  target_id    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|approved|flagged|removed|appealed
  decision     TEXT,            -- allow|limit|remove
  reason       TEXT NOT NULL DEFAULT '',
  signals      TEXT NOT NULL DEFAULT '{}',      -- JSON: provider -> raw scores
  decided_by   TEXT NOT NULL DEFAULT 'system',  -- system|<user id>
  created_at   TEXT NOT NULL,
  decided_at   TEXT
);
CREATE INDEX idx_moderation_queue ON moderation_cases(status, created_at);
CREATE INDEX idx_moderation_target ON moderation_cases(target_type, target_id);

-- Copyright is its own subsystem with its own case record. Detection results
-- and LICENSING are tracked separately on purpose. (spec §30, §81)
CREATE TABLE copyright_cases (
  id             TEXT PRIMARY KEY,
  video_id       TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL DEFAULT 'none',
  result         TEXT NOT NULL DEFAULT 'pending', -- pending|clear|review|match|claim|restrict|block|unavailable
  matched_work   TEXT,                            -- title/identifier of the match
  matched_ref    TEXT,                            -- provider's work id
  confidence     REAL,
  -- Licensed-ness is NOT implied by a detection result. It is set only from an
  -- actual licence record or provider rights response.
  license_state  TEXT NOT NULL DEFAULT 'unknown', -- unknown|licensed|not_licensed|pending
  license_note   TEXT NOT NULL DEFAULT '',
  action_taken   TEXT,                            -- none|limit_visibility|mute|block
  raw_response   TEXT,                            -- JSON, for audit
  status         TEXT NOT NULL DEFAULT 'open',    -- open|resolved|disputed
  created_at     TEXT NOT NULL,
  resolved_at    TEXT
);
CREATE INDEX idx_copyright_video ON copyright_cases(video_id);
CREATE INDEX idx_copyright_queue ON copyright_cases(status, created_at);

-- Append-only audit trail of privileged actions. (spec §38)
CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  meta       TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_time ON audit_log(created_at DESC);

-- ---------------------------------------------------------------------------
-- INFRASTRUCTURE: jobs & integrations
-- ---------------------------------------------------------------------------

-- Background job queue. Expensive work (transcode, copyright, moderation)
-- never runs inside a web request. (spec §42)
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  payload       TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued|running|done|failed|dead
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 5,
  last_error    TEXT,
  run_after     TEXT NOT NULL,                   -- enables exponential backoff
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT
);
-- The worker's claim query: next runnable job.
CREATE INDEX idx_jobs_claim ON jobs(status, run_after);

-- The API registry an admin sees. Secrets are NEVER stored or shown here —
-- only whether a key is configured, and health data. (spec §5, §35, §77)
CREATE TABLE api_integrations (
  key                TEXT PRIMARY KEY,   -- copyright|music|moderation|analytics|...
  label              TEXT NOT NULL,
  provider           TEXT NOT NULL DEFAULT 'null',
  enabled            INTEGER NOT NULL DEFAULT 0,
  configured         INTEGER NOT NULL DEFAULT 0,  -- is a credential present?
  status             TEXT NOT NULL DEFAULT 'not_connected',
    -- not_connected|connected|degraded|error|disabled
  last_success_at    TEXT,
  last_failure_at    TEXT,
  last_error         TEXT,
  last_test_at       TEXT,
  avg_response_ms    INTEGER,
  rate_limit_info    TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_open_until TEXT,                        -- circuit breaker
  updated_at         TEXT NOT NULL
);
