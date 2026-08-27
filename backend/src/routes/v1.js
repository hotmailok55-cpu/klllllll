'use strict';

/**
 * ============================================================================
 * API v1 — every route the platform exposes.
 * ============================================================================
 *
 * The whole API is versioned under /api/v1 (spec §64). When a change would
 * break existing clients, add /api/v2 alongside rather than editing these.
 *
 * Route handlers stay THIN on purpose. They:
 *   1. rate-limit
 *   2. require auth where needed
 *   3. validate input
 *   4. call ONE service function
 *   5. return plain data
 *
 * All real logic lives in services/. If a handler here grows past a dozen
 * lines, that is a signal the logic belongs in a service.
 */

const { Router } = require('../core/http');
const { validate, rules } = require('../core/validate');
const rateLimit = require('../core/ratelimit');
const errors = require('../core/errors');
const { config } = require('../core/config');
const { sha256 } = require('../core/crypto');

const users = require('../services/users');
const channels = require('../services/channels');
const videosService = require('../services/videos');
const uploads = require('../services/uploads');
const comments = require('../services/comments');
const recommendations = require('../services/recommendations');
const trending = require('../services/trending');
const search = require('../services/search');
const notifications = require('../services/notifications');
const playlists = require('../services/playlists');
const sounds = require('../services/sounds');
const analytics = require('../services/analytics');
const moderation = require('../services/moderation');
const copyright = require('../services/copyright');
const registry = require('../integrations/registry');
const queue = require('../core/queue');
const db = require('../core/db');

const router = new Router();
const P = '/api/v1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Require a signed-in user. */
function requireAuth(ctx) {
  if (!ctx.user) throw errors.unauthorized('Please sign in to do that.');
  return ctx.user;
}

/** Require a specific role. */
function requireRole(ctx, ...roles) {
  const user = requireAuth(ctx);
  if (!roles.includes(user.role)) throw errors.forbidden('You do not have access to that.');
  return user;
}

/** Rate-limit identity: the user when known, otherwise a hashed IP. */
function identity(ctx) {
  return ctx.user ? `u:${ctx.user.id}` : `ip:${sha256(ctx.ip, config.auth.secret || 'dev').slice(0, 24)}`;
}

/** Stable key for a signed-out viewer, used for feed impressions. */
function viewerKey(ctx) {
  return ctx.user
    ? `u:${ctx.user.id}`
    : analytics.viewerKey({ ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
}

const int = (value, fallback, max = 100) => {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
};

// ===========================================================================
// SYSTEM  — platform state, feature flags, health
// ===========================================================================

/**
 * The frontend calls this first. It is what makes the "new platform" experience
 * automatic (spec §8, §62): the UI renders from these numbers, so it transitions
 * from empty -> seedling -> growing on its own with no hard-coded copy.
 */
router.get(`${P}/system/state`, (ctx) => {
  const state = recommendations.platformState();
  return {
    platform: state,
    // Only flags the frontend legitimately needs. Secrets never appear here.
    features: {
      shorts: config.flags.SHORTS_ENABLED,
      liveStreaming: config.flags.LIVE_STREAMING_ENABLED,
      monetization: config.flags.MONETIZATION_ENABLED,
      musicLibrary: config.flags.MUSIC_API_ENABLED,
      registration: config.flags.REGISTRATION_ENABLED,
    },
    categories: videosService.CATEGORIES,
    topics: recommendations.TOPICS,
  };
});

/** Liveness/readiness probe for monitoring. (spec §70) */
router.get(`${P}/system/health`, () => {
  const checks = {};
  let healthy = true;

  try {
    db.get('SELECT 1 AS ok');
    checks.database = { ok: true };
  } catch (err) {
    checks.database = { ok: false, error: err.message };
    healthy = false;
  }

  checks.queue = { ok: true, ...queue.stats() };

  return { healthy, checks, uptime: Math.round(process.uptime()), env: config.env };
});

// ===========================================================================
// AUTH
// ===========================================================================

router.post(`${P}/auth/register`, async (ctx) => {
  rateLimit.hit('register', identity(ctx));

  const input = validate(ctx.body, {
    username: rules.username,
    email: rules.email,
    password: rules.password,
    displayName: { type: 'string', max: 50 },
  });

  const { user } = users.register(input);
  const session = users.createSession(user.id, {
    deviceLabel: ctx.req.headers['user-agent'] || '',
    ip: ctx.ip,
  });

  // Email verification link. With no mail provider configured it is printed to
  // the server console so local development is never blocked.
  const token = users.issueAuthToken(user.id, 'email_verify', 24 * 3600);
  registry.get('notifications').send({
    to: input.email,
    channel: 'email',
    subject: 'Confirm your email',
    body: 'Welcome! Confirm your email address to finish setting up your account.',
    link: `${config.server.publicUrl}/verify?token=${token}`,
  }).catch(() => {});

  return { user, token: session.token, expiresAt: session.expiresAt };
});

router.post(`${P}/auth/login`, (ctx) => {
  rateLimit.hit('login', identity(ctx));

  const input = validate(ctx.body, {
    email: rules.email,
    password: { type: 'string', required: true, trim: false },
  });

  const user = users.authenticate(input);
  const session = users.createSession(user.id, {
    deviceLabel: ctx.req.headers['user-agent'] || '',
    ip: ctx.ip,
  });

  return { user: users.privateUser(user), token: session.token, expiresAt: session.expiresAt };
}, { status: 200 });

router.post(`${P}/auth/logout`, (ctx) => {
  requireAuth(ctx);
  users.revokeSession(ctx.sessionId, ctx.user.id);
  return { signedOut: true };
}, { status: 200 });

router.get(`${P}/auth/me`, (ctx) => {
  requireAuth(ctx);
  const channel = channels.findByOwner(ctx.user.id);
  return {
    user: users.privateUser(ctx.user),
    channel: channel ? channels.present(channel, { viewer: ctx.user }) : null,
    unreadNotifications: notifications.unreadCount(ctx.user.id),
  };
});

router.get(`${P}/auth/sessions`, (ctx) => {
  requireAuth(ctx);
  return { sessions: users.listSessions(ctx.user.id, ctx.sessionId) };
});

router.delete(`${P}/auth/sessions/:id`, (ctx) => {
  requireAuth(ctx);
  users.revokeSession(ctx.params.id, ctx.user.id);
  return { revoked: true };
}, { status: 200 });

router.post(`${P}/auth/verify-email`, (ctx) => {
  const { token } = validate(ctx.body, { token: { type: 'string', required: true } });
  const userId = users.consumeAuthToken(token, 'email_verify');
  users.markEmailVerified(userId);
  return { verified: true };
}, { status: 200 });

router.post(`${P}/auth/forgot-password`, (ctx) => {
  rateLimit.hit('passwordReset', identity(ctx));
  const { email } = validate(ctx.body, { email: rules.email });

  const user = db.get(`SELECT * FROM users WHERE email = :email AND status = 'active'`, { email });
  if (user) {
    const token = users.issueAuthToken(user.id, 'password_reset', 3600);
    registry.get('notifications').send({
      to: email, channel: 'email',
      subject: 'Reset your password',
      body: 'Use the link below to choose a new password. It expires in one hour.',
      link: `${config.server.publicUrl}/reset?token=${token}`,
    }).catch(() => {});
  }

  // Always the same answer, so this endpoint cannot enumerate accounts.
  return { message: 'If an account exists for that email, we have sent a reset link.' };
}, { status: 200 });

router.post(`${P}/auth/reset-password`, (ctx) => {
  const input = validate(ctx.body, {
    token: { type: 'string', required: true },
    password: rules.password,
  });
  const userId = users.consumeAuthToken(input.token, 'password_reset');
  users.setPassword(userId, input.password);
  return { reset: true };
}, { status: 200 });

// ===========================================================================
// USERS
// ===========================================================================

router.patch(`${P}/users/me`, (ctx) => {
  requireAuth(ctx);
  const input = validate(ctx.body, {
    displayName: { type: 'string', max: 50 },
    bio: { type: 'string', max: 500 },
    avatarUrl: { type: 'string', max: 500 },
    privacySettings: { type: 'object' },
    notificationSettings: { type: 'object' },
    preferences: { type: 'object' },
  });
  return { user: users.privateUser(users.updateProfile(ctx.user.id, input)) };
}, { status: 200 });

/** Onboarding interests — the cold-start signal. (spec §22) */
router.post(`${P}/users/me/interests`, (ctx) => {
  requireAuth(ctx);
  const { topics } = validate(ctx.body, {
    topics: { type: 'array', of: 'string', required: true, max: 15 },
  });
  return recommendations.setOnboardingInterests(ctx.user.id, topics);
}, { status: 200 });

router.get(`${P}/users/me/export`, (ctx) => {
  requireAuth(ctx);
  ctx.setHeader('Content-Disposition', 'attachment; filename="my-data.json"');
  return users.exportData(ctx.user.id);
});

router.delete(`${P}/users/me`, (ctx) => {
  requireAuth(ctx);
  const { confirm } = validate(ctx.body, { confirm: { type: 'string', required: true } });
  if (confirm !== ctx.user.username) {
    throw errors.badRequest('Type your username exactly to confirm deletion.');
  }
  users.deleteAccount(ctx.user.id);
  return { deleted: true };
}, { status: 200 });

router.post(`${P}/users/:id/block`, (ctx) => {
  requireAuth(ctx);
  return users.blockUser(ctx.user.id, ctx.params.id);
}, { status: 200 });

router.delete(`${P}/users/:id/block`, (ctx) => {
  requireAuth(ctx);
  return users.unblockUser(ctx.user.id, ctx.params.id);
}, { status: 200 });

// ===========================================================================
// CHANNELS
// ===========================================================================

router.get(`${P}/channels/:handle`, (ctx) => {
  const channel = channels.findByHandle(ctx.params.handle) || channels.findById(ctx.params.handle);
  if (!channel) throw errors.notFound('That channel does not exist.');
  return {
    channel: channels.present(channel, { viewer: ctx.user }),
    videos: videosService.listByChannel(channel.id, { viewer: ctx.user, limit: 24 }),
    playlists: playlists.listForUser(channel.owner_id, ctx.user),
  };
});

router.patch(`${P}/channels/:id`, (ctx) => {
  requireAuth(ctx);
  const input = validate(ctx.body, {
    handle: { type: 'string', min: 3, max: 24, lower: true, pattern: /^[a-z0-9_.]+$/ },
    name: { type: 'string', max: 60 },
    description: { type: 'string', max: 2000 },
    avatarUrl: { type: 'string', max: 500 },
    bannerUrl: { type: 'string', max: 500 },
    links: { type: 'array', max: 10 },
  });
  const channel = channels.update(ctx.params.id, ctx.user, input);
  return { channel: channels.present(channel, { viewer: ctx.user }) };
}, { status: 200 });

router.post(`${P}/channels/:id/follow`, (ctx) => {
  requireAuth(ctx);
  return channels.toggleFollow({ channelId: ctx.params.id, user: ctx.user });
}, { status: 200 });

router.post(`${P}/channels/:id/notify`, (ctx) => {
  requireAuth(ctx);
  const { notify } = validate(ctx.body, { notify: { type: 'boolean', default: true } });
  return channels.setNotify({ channelId: ctx.params.id, user: ctx.user, notify });
}, { status: 200 });

router.get(`${P}/channels/:id/videos`, (ctx) => ({
  videos: videosService.listByChannel(ctx.params.id, {
    viewer: ctx.user,
    limit: int(ctx.query.limit, 24, 50),
    cursor: int(ctx.query.cursor, 0, 10000),
  }),
}));

router.get(`${P}/me/following`, (ctx) => {
  requireAuth(ctx);
  return { channels: channels.listFollowing(ctx.user.id) };
});

router.get(`${P}/me/subscriptions`, (ctx) => {
  requireAuth(ctx);
  const videos = channels.followingFeed(ctx.user.id, {
    limit: int(ctx.query.limit, 20, 50),
    cursor: int(ctx.query.cursor, 0, 10000),
  });
  return {
    videos,
    // The empty state is data, not a hard-coded string in the UI. (spec §9)
    empty: videos.length === 0 ? {
      title: "You aren't following any creators yet.",
      body: 'Discover creators you might like.',
      action: { label: 'Find creators', href: '/explore' },
    } : null,
  };
});

router.get(`${P}/channels`, (ctx) => ({
  channels: channels.suggestedChannels(ctx.user?.id, { limit: int(ctx.query.limit, 10, 30) }),
}));

// ===========================================================================
// FEED  — the scrolling surface
// ===========================================================================

/**
 * THE MAIN FEED. Runs the full recommendation pipeline.
 * Works signed-out (cold start), and works on a platform with zero videos.
 */
router.get(`${P}/feed`, (ctx) => {
  rateLimit.hit('feed', identity(ctx));

  const feed = recommendations.buildFeed({
    userId: ctx.user?.id || null,
    viewerKey: viewerKey(ctx),
    kind: ctx.query.kind || 'short',
    limit: int(ctx.query.limit, 10, 30),
    cursor: int(ctx.query.cursor, 0, 10000),
  });

  return {
    videos: feed.items.map((v) => videosService.present(v, { viewer: ctx.user })),
    mode: feed.mode,
    platform: feed.platform,
    nextCursor: feed.nextCursor,
    explain: feed.explain,
    // Empty-state copy chosen from real platform state. (spec §8, §9, §62)
    empty: feed.items.length === 0 ? emptyFeedState(feed) : null,
  };
});

/** Chooses honest copy for whatever "empty" actually means right now. */
function emptyFeedState(feed) {
  if (feed.mode === 'empty_platform') {
    return {
      title: 'No videos yet.',
      body: 'Be one of the first creators to share something.',
      action: { label: 'Post your first video', href: '/upload' },
      secondaryAction: { label: 'Explore the platform', href: '/explore' },
    };
  }
  return {
    title: "You're all caught up.",
    body: "You've seen everything new for now. Check back soon, or post something yourself.",
    action: { label: 'Post a video', href: '/upload' },
  };
}

router.get(`${P}/trending`, (ctx) => {
  const videos = trending.getTrending({
    kind: ctx.query.kind || null,
    category: ctx.query.category || null,
    limit: int(ctx.query.limit, 20, 50),
  });
  return {
    videos: videos.map((v) => videosService.present(v, { viewer: ctx.user })),
    empty: videos.length === 0 ? {
      title: 'Nothing is trending yet.',
      body: 'Trending needs a bit of activity first. Be the one who starts it.',
      action: { label: 'Post a video', href: '/upload' },
    } : null,
  };
});

// ===========================================================================
// VIDEOS
// ===========================================================================

router.get(`${P}/videos/:id`, (ctx) => {
  const video = videosService.getForViewer(ctx.params.id, ctx.user);
  const isOwner = ctx.user && video.creator_id === ctx.user.id;

  // Related videos: reuse the recommendation pipeline rather than a separate
  // "related" query, so one algorithm serves both surfaces.
  const related = recommendations.buildFeed({
    userId: ctx.user?.id || null,
    viewerKey: viewerKey(ctx),
    kind: video.kind,
    limit: 10,
  });

  return {
    video: videosService.present(video, { viewer: ctx.user, includePrivate: isOwner }),
    related: related.items
      .filter((v) => v.id !== video.id)
      .map((v) => videosService.present(v, { viewer: ctx.user })),
  };
});

router.patch(`${P}/videos/:id`, (ctx) => {
  requireAuth(ctx);
  const input = validate(ctx.body, {
    title: { type: 'string', max: 120 },
    description: { type: 'string', max: 5000 },
    category: { type: 'string', enum: videosService.CATEGORIES },
    tags: { type: 'array', of: 'string', max: 20 },
    visibility: { type: 'string', enum: videosService.VISIBILITIES },
    soundId: { type: 'string', max: 64 },
  });
  const video = videosService.update(ctx.params.id, ctx.user, input);
  return { video: videosService.present(video, { viewer: ctx.user, includePrivate: true }) };
}, { status: 200 });

router.delete(`${P}/videos/:id`, (ctx) => {
  requireAuth(ctx);
  return videosService.remove(ctx.params.id, ctx.user);
}, { status: 200 });

router.post(`${P}/videos/:id/like`, (ctx) => {
  requireAuth(ctx);
  rateLimit.hit('reaction', identity(ctx));
  return videosService.react(ctx.params.id, ctx.user.id, 1);
}, { status: 200 });

router.post(`${P}/videos/:id/dislike`, (ctx) => {
  requireAuth(ctx);
  rateLimit.hit('reaction', identity(ctx));
  return videosService.react(ctx.params.id, ctx.user.id, -1);
}, { status: 200 });

router.post(`${P}/videos/:id/save`, (ctx) => {
  requireAuth(ctx);
  return videosService.toggleSave(ctx.params.id, ctx.user.id);
}, { status: 200 });

router.post(`${P}/videos/:id/share`, (ctx) => {
  return videosService.share(ctx.params.id, ctx.user?.id || null);
}, { status: 200 });

/**
 * Watch heartbeat. The player posts this periodically and on scroll-away.
 * Drives view counting AND teaches the recommendation profile.
 */
router.post(`${P}/videos/:id/watch`, (ctx) => {
  rateLimit.hit('view', identity(ctx));
  const input = validate(ctx.body, {
    watchMs: { type: 'integer', required: true, min: 0, max: 24 * 3600_000 },
    source: { type: 'string', default: 'feed', enum: ['feed', 'search', 'channel', 'sound', 'direct', 'trending'] },
    replayed: { type: 'boolean', default: false },
  });

  return videosService.recordWatch({
    videoId: ctx.params.id,
    viewer: ctx.user,
    ip: ctx.ip,
    userAgent: ctx.req.headers['user-agent'],
    watchMs: input.watchMs,
    source: input.source,
    replayed: input.replayed,
  });
}, { status: 200 });

router.post(`${P}/videos/:id/report`, (ctx) => {
  requireAuth(ctx);
  rateLimit.hit('report', identity(ctx));
  const input = validate(ctx.body, {
    category: {
      type: 'string', required: true,
      enum: ['spam', 'harassment', 'copyright', 'impersonation', 'unsafe', 'scam', 'other'],
    },
    details: { type: 'string', max: 1000 },
  });
  return moderation.createReport({
    reporterId: ctx.user.id,
    targetType: 'video',
    targetId: ctx.params.id,
    ...input,
  });
});

// ===========================================================================
// UPLOAD
// ===========================================================================

router.post(`${P}/uploads`, (ctx) => {
  requireAuth(ctx);
  rateLimit.hit('upload', identity(ctx));
  const input = validate(ctx.body, {
    title: { type: 'string', max: 120 },
    kind: { type: 'string', default: 'short', enum: ['short', 'long'] },
  });
  return uploads.createDraft({ user: ctx.user, ...input });
});

/**
 * The raw file body. `rawBody: true` stops the JSON parser touching it, so the
 * upload streams straight to storage instead of buffering as text.
 */
router.post(`${P}/uploads/:id/file`, async (ctx) => {
  requireAuth(ctx);
  return uploads.receiveFile({ videoId: ctx.params.id, user: ctx.user, stream: ctx.req });
}, { rawBody: true, status: 200 });

router.post(`${P}/uploads/:id/thumbnail`, async (ctx) => {
  requireAuth(ctx);
  return uploads.receiveThumbnail({ videoId: ctx.params.id, user: ctx.user, stream: ctx.req });
}, { rawBody: true, status: 200 });

/** Polled by the upload UI to show live progress. (spec §72) */
router.get(`${P}/uploads/:id/status`, (ctx) => {
  requireAuth(ctx);
  return uploads.status(ctx.params.id, ctx.user);
});

router.get(`${P}/uploads/drafts`, (ctx) => {
  requireAuth(ctx);
  const drafts = uploads.listDrafts(ctx.user);
  return {
    drafts,
    empty: drafts.length === 0 ? { title: 'No drafts.', body: 'Unfinished uploads show up here.' } : null,
  };
});

// ===========================================================================
// COMMENTS
// ===========================================================================

router.get(`${P}/videos/:id/comments`, (ctx) => {
  const items = comments.list({
    videoId: ctx.params.id,
    viewer: ctx.user,
    sort: ctx.query.sort === 'new' ? 'new' : 'top',
    limit: int(ctx.query.limit, 20, 50),
    cursor: int(ctx.query.cursor, 0, 10000),
  });
  return {
    comments: items,
    empty: items.length === 0 ? {
      title: 'No comments yet.',
      body: 'Be the first to start the conversation.',
    } : null,
  };
});

router.post(`${P}/videos/:id/comments`, async (ctx) => {
  requireAuth(ctx);
  rateLimit.hit('comment', identity(ctx));
  const input = validate(ctx.body, {
    body: { type: 'string', required: true, max: comments.MAX_LENGTH },
    parentId: { type: 'string', max: 64 },
  });
  const comment = await comments.create({
    videoId: ctx.params.id, user: ctx.user, ...input,
  });
  return { comment };
});

router.get(`${P}/comments/:id/replies`, (ctx) => ({
  replies: comments.listReplies({
    commentId: ctx.params.id,
    viewer: ctx.user,
    limit: int(ctx.query.limit, 20, 50),
    cursor: int(ctx.query.cursor, 0, 10000),
  }),
}));

router.patch(`${P}/comments/:id`, async (ctx) => {
  requireAuth(ctx);
  const { body } = validate(ctx.body, {
    body: { type: 'string', required: true, max: comments.MAX_LENGTH },
  });
  return { comment: await comments.update({ commentId: ctx.params.id, user: ctx.user, body }) };
}, { status: 200 });

router.delete(`${P}/comments/:id`, (ctx) => {
  requireAuth(ctx);
  return comments.remove({ commentId: ctx.params.id, user: ctx.user });
}, { status: 200 });

router.post(`${P}/comments/:id/like`, (ctx) => {
  requireAuth(ctx);
  rateLimit.hit('reaction', identity(ctx));
  return comments.toggleLike({ commentId: ctx.params.id, user: ctx.user });
}, { status: 200 });

router.post(`${P}/comments/:id/report`, (ctx) => {
  requireAuth(ctx);
  rateLimit.hit('report', identity(ctx));
  const input = validate(ctx.body, {
    category: {
      type: 'string', required: true,
      enum: ['spam', 'harassment', 'copyright', 'impersonation', 'unsafe', 'scam', 'other'],
    },
    details: { type: 'string', max: 1000 },
  });
  return moderation.createReport({
    reporterId: ctx.user.id, targetType: 'comment', targetId: ctx.params.id, ...input,
  });
});

// ===========================================================================
// SEARCH
// ===========================================================================

router.get(`${P}/search`, (ctx) => {
  rateLimit.hit('search', identity(ctx));

  const results = search.search({
    query: ctx.query.q || '',
    viewer: ctx.user,
    type: ctx.query.type || 'all',
    filters: {
      category: ctx.query.category,
      kind: ctx.query.kind,
      uploadedAfter: ctx.query.uploadedAfter,
      minDurationMs: ctx.query.minDuration ? Number(ctx.query.minDuration) : undefined,
      maxDurationMs: ctx.query.maxDuration ? Number(ctx.query.maxDuration) : undefined,
    },
    limit: int(ctx.query.limit, 20, 50),
  });

  return {
    ...results,
    empty: results.total === 0 && results.query ? {
      title: 'No results found.',
      body: 'Try another search.',
    } : null,
  };
});

router.get(`${P}/search/suggest`, (ctx) => ({
  suggestions: search.suggest({ query: ctx.query.q || '', limit: int(ctx.query.limit, 8, 20) }),
}));

router.get(`${P}/search/recent`, (ctx) => ({
  recent: search.recentSearches(ctx.user?.id),
}));

router.delete(`${P}/search/recent`, (ctx) => {
  requireAuth(ctx);
  return search.clearHistory(ctx.user.id);
}, { status: 200 });

// ===========================================================================
// SOUNDS
// ===========================================================================

router.get(`${P}/sounds/popular`, () => ({ sounds: sounds.listPopular({ limit: 30 }) }));

router.get(`${P}/sounds/trending`, () => ({ sounds: trending.getTrendingSounds({ limit: 20 }) }));

router.get(`${P}/sounds/search`, async (ctx) => {
  rateLimit.hit('search', identity(ctx));
  return sounds.search({ query: ctx.query.q || '', limit: int(ctx.query.limit, 20, 50) });
});

router.get(`${P}/sounds/:id`, (ctx) => {
  const sound = sounds.findById(ctx.params.id);
  if (!sound) throw errors.notFound('Sound not found.');
  return {
    sound: sounds.present(sound, { includeRights: true }),
    videos: videosService.listBySound(ctx.params.id, {
      viewer: ctx.user, limit: int(ctx.query.limit, 24, 50),
    }),
  };
});

router.post(`${P}/sounds/import`, async (ctx) => {
  requireAuth(ctx);
  const { ref } = validate(ctx.body, { ref: { type: 'string', required: true, max: 200 } });
  return { sound: await sounds.importFromProvider({ ref, user: ctx.user }) };
});

router.post(`${P}/videos/:id/sound`, (ctx) => {
  requireAuth(ctx);
  const { soundId } = validate(ctx.body, { soundId: { type: 'string', required: true, max: 64 } });
  return { sound: sounds.attachToVideo({ videoId: ctx.params.id, soundId, user: ctx.user }) };
}, { status: 200 });

// ===========================================================================
// NOTIFICATIONS
// ===========================================================================

router.get(`${P}/notifications`, (ctx) => {
  requireAuth(ctx);
  const items = notifications.list(ctx.user.id, {
    limit: int(ctx.query.limit, 30, 50),
    cursor: int(ctx.query.cursor, 0, 10000),
    unreadOnly: ctx.query.unread === 'true',
  });
  return {
    notifications: items,
    unread: notifications.unreadCount(ctx.user.id),
    empty: items.length === 0 ? {
      title: "You're all caught up.",
      body: 'New likes, comments, and followers will show up here.',
    } : null,
  };
});

router.post(`${P}/notifications/read`, (ctx) => {
  requireAuth(ctx);
  const { ids } = validate(ctx.body, { ids: { type: 'array', of: 'string', max: 100 } });
  return notifications.markRead(ctx.user.id, ids || null);
}, { status: 200 });

// ===========================================================================
// PLAYLISTS & LIBRARY
// ===========================================================================

router.get(`${P}/playlists`, (ctx) => {
  requireAuth(ctx);
  const items = playlists.listForUser(ctx.user.id, ctx.user);
  return {
    playlists: items,
    empty: items.length === 0 ? {
      title: "You haven't created any playlists yet.",
      body: 'Playlists are a good way to group videos you want to keep.',
    } : null,
  };
});

router.post(`${P}/playlists`, (ctx) => {
  requireAuth(ctx);
  const input = validate(ctx.body, {
    name: { type: 'string', required: true, max: 120 },
    description: { type: 'string', max: 1000 },
    visibility: { type: 'string', default: 'private', enum: playlists.VISIBILITIES },
  });
  return { playlist: playlists.create({ user: ctx.user, ...input }) };
});

router.get(`${P}/playlists/:id`, (ctx) => ({
  playlist: playlists.get(ctx.params.id, ctx.user),
}));

router.patch(`${P}/playlists/:id`, (ctx) => {
  requireAuth(ctx);
  const input = validate(ctx.body, {
    name: { type: 'string', max: 120 },
    description: { type: 'string', max: 1000 },
    visibility: { type: 'string', enum: playlists.VISIBILITIES },
  });
  return { playlist: playlists.update(ctx.params.id, ctx.user, input) };
}, { status: 200 });

router.delete(`${P}/playlists/:id`, (ctx) => {
  requireAuth(ctx);
  return playlists.remove(ctx.params.id, ctx.user);
}, { status: 200 });

router.post(`${P}/playlists/:id/videos`, (ctx) => {
  requireAuth(ctx);
  const { videoId } = validate(ctx.body, { videoId: { type: 'string', required: true, max: 64 } });
  return playlists.addVideo({ playlistId: ctx.params.id, videoId, viewer: ctx.user });
}, { status: 200 });

router.delete(`${P}/playlists/:id/videos/:videoId`, (ctx) => {
  requireAuth(ctx);
  return playlists.removeVideo({
    playlistId: ctx.params.id, videoId: ctx.params.videoId, viewer: ctx.user,
  });
}, { status: 200 });

router.get(`${P}/me/saved`, (ctx) => {
  requireAuth(ctx);
  const videos = playlists.savedVideos(ctx.user.id, { limit: int(ctx.query.limit, 50, 100) });
  return {
    videos,
    empty: videos.length === 0 ? {
      title: 'Nothing saved yet.',
      body: 'Tap the bookmark on any video to keep it here.',
    } : null,
  };
});

// ===========================================================================
// CREATOR STUDIO
// ===========================================================================

router.get(`${P}/studio/dashboard`, (ctx) => {
  requireAuth(ctx);
  const channel = channels.findByOwner(ctx.user.id);
  if (!channel) throw errors.notFound('You do not have a channel yet.');

  const stats = analytics.channelAnalytics(channel.id, { days: 28 });
  const recent = videosService.listByChannel(channel.id, { viewer: ctx.user, limit: 5 });
  const processing = db.all(
    `SELECT id, title, processing_status FROM videos
      WHERE channel_id = :id AND processing_status NOT IN ('ready','draft')
        AND deleted_at IS NULL`,
    { id: channel.id }
  );

  return {
    channel: channels.present(channel, { viewer: ctx.user }),
    analytics: stats,
    recentVideos: recent,
    processing: processing.map((p) => ({
      videoId: p.id, title: p.title, status: p.processing_status,
    })),
    notifications: notifications.list(ctx.user.id, { limit: 5 }),
    empty: stats.totals.videos === 0 ? {
      title: 'Your studio is ready.',
      body: 'Post your first video to start seeing analytics here.',
      action: { label: 'Post a video', href: '/upload' },
    } : null,
  };
});

router.get(`${P}/studio/content`, (ctx) => {
  requireAuth(ctx);
  const channel = channels.findByOwner(ctx.user.id);
  if (!channel) throw errors.notFound('You do not have a channel yet.');
  return {
    videos: videosService.listByChannel(channel.id, {
      viewer: ctx.user,
      limit: int(ctx.query.limit, 50, 100),
      cursor: int(ctx.query.cursor, 0, 10000),
    }),
  };
});

router.get(`${P}/studio/videos/:id/analytics`, (ctx) => {
  requireAuth(ctx);
  const video = videosService.findById(ctx.params.id);
  if (!video) throw errors.notFound('Video not found.');
  if (!videosService.canEdit(video, ctx.user)) {
    throw errors.forbidden('You can only see analytics for your own videos.');
  }
  return analytics.videoAnalytics(ctx.params.id, { days: int(ctx.query.days, 28, 365) });
});

router.get(`${P}/studio/copyright`, (ctx) => {
  requireAuth(ctx);
  return { cases: copyright.listForCreator(ctx.user.id) };
});

// ===========================================================================
// ADMIN  — integrations, moderation queue, system health
// ===========================================================================

/**
 * THE API REGISTRY VIEW (spec §5, §77).
 * Shows provider, status, health and whether a credential is configured.
 * It never returns a secret value — there is no code path that could.
 */
router.get(`${P}/admin/integrations`, (ctx) => {
  requireRole(ctx, 'admin');
  return { integrations: registry.status() };
});

router.post(`${P}/admin/integrations/:key/test`, async (ctx) => {
  requireRole(ctx, 'admin');
  return { result: await registry.testConnection(ctx.params.key) };
}, { status: 200 });

router.post(`${P}/admin/integrations/:key/enabled`, (ctx) => {
  requireRole(ctx, 'admin');
  const { enabled } = validate(ctx.body, { enabled: { type: 'boolean', required: true } });
  return { integration: registry.setEnabled(ctx.params.key, enabled) };
}, { status: 200 });

router.get(`${P}/admin/overview`, (ctx) => {
  requireRole(ctx, 'admin', 'moderator');

  const counts = {
    users: db.get(`SELECT COUNT(*) AS c FROM users WHERE status='active'`).c,
    videos: db.get('SELECT COUNT(*) AS c FROM videos WHERE deleted_at IS NULL').c,
    comments: db.get('SELECT COUNT(*) AS c FROM comments WHERE deleted_at IS NULL').c,
    openReports: db.get(`SELECT COUNT(*) AS c FROM reports WHERE status='open'`).c,
    pendingModeration: db.get(`SELECT COUNT(*) AS c FROM moderation_cases WHERE status='pending'`).c,
    openCopyright: db.get(`SELECT COUNT(*) AS c FROM copyright_cases WHERE status='open'`).c,
  };

  return {
    counts,
    queue: queue.stats(),
    integrations: registry.status(),
    platform: recommendations.platformState(),
    memory: {
      heapUsedMb: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
      uptimeSeconds: Math.round(process.uptime()),
    },
  };
});

router.get(`${P}/admin/moderation`, (ctx) => {
  requireRole(ctx, 'admin', 'moderator');
  return {
    cases: moderation.listQueue({ status: ctx.query.status || 'pending' }),
    reports: moderation.listReports({ status: 'open' }),
  };
});

router.post(`${P}/admin/moderation/:id/resolve`, (ctx) => {
  const actor = requireRole(ctx, 'admin', 'moderator');
  const input = validate(ctx.body, {
    decision: { type: 'string', required: true, enum: ['allow', 'limit', 'remove'] },
    note: { type: 'string', max: 1000 },
  });
  return moderation.resolveCase(ctx.params.id, { ...input, actor });
}, { status: 200 });

router.get(`${P}/admin/copyright`, (ctx) => {
  requireRole(ctx, 'admin', 'moderator');
  return { cases: copyright.listQueue({ status: ctx.query.status || 'open' }) };
});

router.post(`${P}/admin/copyright/:id/resolve`, (ctx) => {
  const actor = requireRole(ctx, 'admin', 'moderator');
  const input = validate(ctx.body, {
    decision: { type: 'string', required: true, enum: ['none', 'limit_visibility', 'mute', 'block'] },
    licenseState: { type: 'string', enum: ['unknown', 'licensed', 'not_licensed', 'pending'] },
    note: { type: 'string', max: 1000 },
  });
  return copyright.resolveCase(ctx.params.id, { ...input, actor });
}, { status: 200 });

module.exports = { router, requireAuth, requireRole };
