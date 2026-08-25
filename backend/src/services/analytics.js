'use strict';

/**
 * ANALYTICS SERVICE — the event log, view counting, and creator stats.
 *
 * Core principle (spec §14, §28): counters on the `videos` row are a CACHE.
 * The truth is the event tables. Every statistic here can be recomputed from
 * `view_events` / `watch_events`, so a counter bug is repairable and new
 * metrics can be calculated retroactively.
 */

const db = require('../core/db');
const { setEventSink } = require('../core/events');
const registry = require('../integrations/registry');
const { logger } = require('../core/logger');
const { sha256 } = require('../core/crypto');
const { config } = require('../core/config');

// ---------------------------------------------------------------------------
// View counting rules (spec §29) — configurable, and deliberately conservative.
// ---------------------------------------------------------------------------
const VIEW_RULES = {
  // A viewer can only be counted once per video inside this window.
  dedupeWindowMs: 30 * 60 * 1000,       // 30 minutes
  // Minimum watch time before a view counts at all.
  minWatchMs: 2000,
  // For short videos, require a proportion watched instead of a flat time, so a
  // 4-second video is not trivially easier to farm than a 3-minute one.
  minCompletionShort: 0.30,
  // Above this many counted views per viewer per hour, stop counting: this
  // looks automated rather than human.
  maxViewsPerViewerPerHour: 120,
};

/**
 * Persist every published domain event. Wired into the event bus at boot, so
 * services never call this directly — they just `publish()`.
 */
function recordEvent(event) {
  const { name, at, payload } = event;
  db.run(
    `INSERT INTO analytics_events (id, name, actor_id, subject_id, payload, created_at)
     VALUES (:id, :name, :actorId, :subjectId, :payload, :at)`,
    {
      id: db.newId('evt'),
      name,
      actorId: payload.userId || payload.actorId || null,
      subjectId: payload.videoId || payload.channelId || payload.subjectId || null,
      payload: JSON.stringify(payload),
      at,
    }
  );

  // Optionally mirror to an external analytics tool. Failure here must never
  // affect the platform, so it is fire-and-forget with a caught error.
  if (registry.isEnabled('analytics')) {
    registry.get('analytics')
      .track({ name, actorId: payload.userId, subjectId: payload.videoId, payload, at })
      .catch((err) => logger.warn('analytics', 'external mirror failed', { error: err.message }));
  }
}

/** Install the sink. Called once at boot. */
function install() {
  setEventSink(recordEvent);
  logger.info('analytics', 'event sink installed');
}

/**
 * A stable, privacy-preserving key for one viewer.
 * Signed in -> their user id. Signed out -> a hash of IP + user agent, which is
 * good enough for dedupe without storing anything identifying.
 */
function viewerKey({ userId, ip, userAgent }) {
  if (userId) return `u:${userId}`;
  return `a:${sha256(`${ip}|${userAgent || ''}`, config.auth.secret || 'dev').slice(0, 32)}`;
}

/**
 * Record a watch heartbeat and decide whether it counts as a VIEW.
 *
 * Every heartbeat is stored in `watch_events` (needed for retention curves and
 * the algorithm's negative signals), but only some become `view_events`.
 *
 * @returns {{counted:boolean, reason:string}}
 */
function recordWatch({ videoId, userId, ip, userAgent, watchMs, durationMs, source = 'feed', replayed = false }) {
  const key = viewerKey({ userId, ip, userAgent });
  const now = new Date().toISOString();
  const completion = durationMs > 0 ? watchMs / durationMs : 0;
  // "Skipped fast" is the strongest negative signal a scrolling feed gives us:
  // the viewer saw it and immediately swiped away.
  const skippedFast = watchMs < 2000 && completion < 0.15;

  db.run(
    `INSERT INTO watch_events (id, video_id, user_id, viewer_key, watch_ms, duration_ms,
                               completion, replayed, skipped_fast, created_at)
     VALUES (:id, :videoId, :userId, :key, :watchMs, :durationMs,
             :completion, :replayed, :skipped, :now)`,
    {
      id: db.newId('wev'), videoId, userId: userId || null, key,
      watchMs: Math.max(0, Math.round(watchMs)),
      durationMs: Math.max(0, Math.round(durationMs)),
      completion, replayed, skipped: skippedFast, now,
    }
  );

  const decision = shouldCountView({ videoId, key, watchMs, durationMs, completion });
  if (decision.counted) {
    db.run(
      `INSERT INTO view_events (id, video_id, user_id, viewer_key, watch_ms, source, created_at)
       VALUES (:id, :videoId, :userId, :key, :watchMs, :source, :now)`,
      { id: db.newId('vev'), videoId, userId: userId || null, key,
        watchMs: Math.round(watchMs), source, now }
    );
    // Update the cached counters.
    db.run(
      `UPDATE videos SET view_count = view_count + 1,
                         total_watch_ms = total_watch_ms + :watchMs,
                         updated_at = :now
        WHERE id = :videoId`,
      { videoId, watchMs: Math.round(watchMs), now }
    );
    db.run(
      `UPDATE channels SET total_views = total_views + 1
        WHERE id = (SELECT channel_id FROM videos WHERE id = :videoId)`,
      { videoId }
    );
  } else {
    // Watch time still accrues even when the view itself does not count.
    db.run(
      `UPDATE videos SET total_watch_ms = total_watch_ms + :watchMs WHERE id = :videoId`,
      { videoId, watchMs: Math.round(watchMs) }
    );
  }

  return { ...decision, skippedFast, completion };
}

/**
 * The view-counting policy. Separated out so it is easy to read, tune, and test
 * against the abuse cases in spec §29.
 */
function shouldCountView({ videoId, key, watchMs, durationMs, completion }) {
  // 1. Did they actually watch anything?
  if (watchMs < VIEW_RULES.minWatchMs) {
    return { counted: false, reason: 'below_minimum_watch_time' };
  }

  // 2. Short videos: require a proportion, not just a couple of seconds.
  const isShort = durationMs > 0 && durationMs <= 60_000;
  if (isShort && completion < VIEW_RULES.minCompletionShort) {
    return { counted: false, reason: 'below_minimum_completion' };
  }

  // 3. Same viewer, same video, recently? A refresh is not a new view.
  const since = new Date(Date.now() - VIEW_RULES.dedupeWindowMs).toISOString();
  const recent = db.get(
    `SELECT id FROM view_events
      WHERE video_id = :videoId AND viewer_key = :key AND created_at > :since
      LIMIT 1`,
    { videoId, key, since }
  );
  if (recent) return { counted: false, reason: 'duplicate_within_window' };

  // 4. Volume check: a viewer racking up views far faster than a person could.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const recentCount = db.get(
    `SELECT COUNT(*) AS count FROM view_events WHERE viewer_key = :key AND created_at > :since`,
    { key, since: hourAgo }
  );
  if (recentCount.count >= VIEW_RULES.maxViewsPerViewerPerHour) {
    return { counted: false, reason: 'rate_exceeded' };
  }

  return { counted: true, reason: 'counted' };
}

/**
 * Recompute a video's cached counters from the event tables.
 * This is what makes counters safe to treat as a cache — if they ever drift,
 * this is the repair. (spec §14)
 */
function recomputeVideoStats(videoId) {
  const views = db.get('SELECT COUNT(*) AS c, COALESCE(SUM(watch_ms),0) AS ms FROM view_events WHERE video_id = :id', { id: videoId });
  const likes = db.get('SELECT COUNT(*) AS c FROM reactions WHERE video_id = :id AND value = 1', { id: videoId });
  const dislikes = db.get('SELECT COUNT(*) AS c FROM reactions WHERE video_id = :id AND value = -1', { id: videoId });
  const comments = db.get('SELECT COUNT(*) AS c FROM comments WHERE video_id = :id AND deleted_at IS NULL', { id: videoId });
  const saves = db.get('SELECT COUNT(*) AS c FROM saves WHERE video_id = :id', { id: videoId });
  const watch = db.get('SELECT COALESCE(SUM(watch_ms),0) AS ms FROM watch_events WHERE video_id = :id', { id: videoId });

  db.run(
    `UPDATE videos SET view_count=:views, like_count=:likes, dislike_count=:dislikes,
                       comment_count=:comments, save_count=:saves, total_watch_ms=:watchMs,
                       updated_at=:now
      WHERE id = :id`,
    {
      id: videoId, views: views.c, likes: likes.c, dislikes: dislikes.c,
      comments: comments.c, saves: saves.c, watchMs: watch.ms,
      now: new Date().toISOString(),
    }
  );
  return { views: views.c, likes: likes.c, comments: comments.c };
}

/**
 * Creator analytics for one video (spec §28).
 * Everything here is derived from events, including the retention curve.
 */
function videoAnalytics(videoId, { days = 28 } = {}) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const video = db.get('SELECT * FROM videos WHERE id = :id', { id: videoId });
  if (!video) return null;

  const daily = db.all(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS views,
            COALESCE(SUM(watch_ms),0) AS watch_ms
       FROM view_events WHERE video_id = :id AND created_at > :since
      GROUP BY day ORDER BY day`,
    { id: videoId, since }
  );

  const watch = db.get(
    `SELECT COUNT(*) AS sessions, COALESCE(AVG(watch_ms),0) AS avg_ms,
            COALESCE(AVG(completion),0) AS avg_completion,
            COALESCE(SUM(replayed),0) AS replays,
            COALESCE(SUM(skipped_fast),0) AS skips
       FROM watch_events WHERE video_id = :id`,
    { id: videoId }
  );

  const sources = db.all(
    `SELECT source, COUNT(*) AS views FROM view_events
      WHERE video_id = :id GROUP BY source ORDER BY views DESC`,
    { id: videoId }
  );

  const uniqueViewers = db.get(
    'SELECT COUNT(DISTINCT viewer_key) AS c FROM view_events WHERE video_id = :id',
    { id: videoId }
  );

  return {
    videoId,
    title: video.title,
    totals: {
      views: video.view_count,
      uniqueViewers: uniqueViewers.c,
      likes: video.like_count,
      dislikes: video.dislike_count,
      comments: video.comment_count,
      shares: video.share_count,
      saves: video.save_count,
      watchTimeMs: video.total_watch_ms,
    },
    averageViewDurationMs: Math.round(watch.avg_ms),
    averageCompletion: +watch.avg_completion.toFixed(3),
    replays: watch.replays,
    fastSkips: watch.skips,
    retentionCurve: retentionCurve(videoId, video.duration_ms),
    daily: daily.map((d) => ({ day: d.day, views: d.views, watchTimeMs: d.watch_ms })),
    trafficSources: sources.map((s) => ({ source: s.source, views: s.views })),
  };
}

/**
 * Audience retention: what fraction of viewers were still watching at each
 * point through the video. Bucketed into 20 steps.
 */
function retentionCurve(videoId, durationMs, buckets = 20) {
  if (!durationMs) return [];
  const rows = db.all(
    'SELECT watch_ms FROM watch_events WHERE video_id = :id AND watch_ms > 0',
    { id: videoId }
  );
  if (!rows.length) return [];

  const curve = [];
  for (let i = 0; i < buckets; i++) {
    const atMs = (durationMs * i) / buckets;
    const stillWatching = rows.filter((r) => r.watch_ms >= atMs).length;
    curve.push({
      atMs: Math.round(atMs),
      percent: +((stillWatching / rows.length) * 100).toFixed(1),
    });
  }
  return curve;
}

/** Channel-level analytics for the Creator Studio dashboard. */
function channelAnalytics(channelId, { days = 28 } = {}) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // Only finished videos count as "content". Drafts and failed uploads appear
  // in the Studio's content list, but they would distort the numbers here.
  const totals = db.get(
    `SELECT COUNT(*) AS videos, COALESCE(SUM(view_count),0) AS views,
            COALESCE(SUM(like_count),0) AS likes, COALESCE(SUM(comment_count),0) AS comments,
            COALESCE(SUM(total_watch_ms),0) AS watch_ms
       FROM videos
      WHERE channel_id = :id AND deleted_at IS NULL AND processing_status = 'ready'`,
    { id: channelId }
  );

  const recentViews = db.get(
    `SELECT COUNT(*) AS c FROM view_events
      WHERE created_at > :since
        AND video_id IN (SELECT id FROM videos WHERE channel_id = :id)`,
    { id: channelId, since }
  );

  const newFollowers = db.get(
    'SELECT COUNT(*) AS c FROM follows WHERE channel_id = :id AND created_at > :since',
    { id: channelId, since }
  );

  const topVideos = db.all(
    `SELECT id, title, view_count, like_count, thumbnail_key
       FROM videos WHERE channel_id = :id AND deleted_at IS NULL
      ORDER BY view_count DESC LIMIT 5`,
    { id: channelId }
  );

  const daily = db.all(
    `SELECT substr(created_at,1,10) AS day, COUNT(*) AS views
       FROM view_events
      WHERE created_at > :since AND video_id IN (SELECT id FROM videos WHERE channel_id = :id)
      GROUP BY day ORDER BY day`,
    { id: channelId, since }
  );

  return {
    channelId,
    windowDays: days,
    totals: {
      videos: totals.videos,
      views: totals.views,
      likes: totals.likes,
      comments: totals.comments,
      watchTimeMs: totals.watch_ms,
    },
    recent: {
      views: recentViews.c,
      newFollowers: newFollowers.c,
    },
    topVideos: topVideos.map((v) => ({
      id: v.id, title: v.title, views: v.view_count, likes: v.like_count,
    })),
    daily: daily.map((d) => ({ day: d.day, views: d.views })),
  };
}

module.exports = {
  install, recordEvent, recordWatch, shouldCountView, viewerKey,
  recomputeVideoStats, videoAnalytics, channelAnalytics, retentionCurve,
  VIEW_RULES,
};
