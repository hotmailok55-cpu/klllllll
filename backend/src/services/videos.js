'use strict';

/**
 * VIDEO SERVICE — video records, visibility, permissions, reactions.
 *
 * Upload and processing live in their own services (uploads.js, processing.js);
 * this one owns the video RECORD and the rules about who may see it.
 */

const db = require('../core/db');
const errors = require('../core/errors');
const { EVENTS, publish } = require('../core/events');
const registry = require('../integrations/registry');
const analytics = require('./analytics');
const recommendations = require('./recommendations');
const { logger } = require('../core/logger');

const CATEGORIES = [
  'technology', 'gaming', 'sports', 'music', 'education', 'comedy',
  'news', 'science', 'travel', 'art', 'food', 'fitness', 'fashion',
  'animals', 'diy', 'other',
];

const VISIBILITIES = ['public', 'unlisted', 'private'];

/**
 * CENTRAL PERMISSION CHECK (spec §15).
 *
 * Every read path goes through this one function. Centralizing it is the whole
 * point: a visibility rule that lives in six places will eventually disagree
 * with itself, and that disagreement is a privacy leak.
 *
 * @returns {{allowed: boolean, reason?: string}}
 */
function canView(video, viewer) {
  if (!video || video.deleted_at) return { allowed: false, reason: 'not_found' };

  const isOwner = viewer && video.creator_id === viewer.id;
  const isStaff = viewer && ['admin', 'moderator'].includes(viewer.role);

  // Owners and staff can always see their own / all content, whatever its state.
  if (isOwner || isStaff) return { allowed: true };

  // Removed by moderation.
  if (video.moderation_status === 'removed') return { allowed: false, reason: 'removed' };

  // Blocked on copyright grounds.
  if (video.copyright_status === 'block') return { allowed: false, reason: 'copyright_block' };

  // Still being processed — not viewable by anyone else yet.
  if (video.processing_status !== 'ready') return { allowed: false, reason: 'not_ready' };

  switch (video.visibility) {
    case 'public':
      return { allowed: true };
    case 'unlisted':
      // Anyone with the link. Never appears in feeds or search — that is
      // enforced by the queries, which only ever select visibility='public'.
      return { allowed: true };
    case 'private':
      return { allowed: false, reason: 'private' };
    default:
      return { allowed: false, reason: 'unknown_visibility' };
  }
}

/** Only the owner (or staff) may modify a video. */
function canEdit(video, viewer) {
  if (!viewer) return false;
  if (['admin', 'moderator'].includes(viewer.role)) return true;
  return video.creator_id === viewer.id;
}

/**
 * Shape a video row for the API.
 * Media keys become URLs here, so the CDN swap happens in exactly one place.
 */
function present(row, { viewer = null, includePrivate = false } = {}) {
  if (!row) return null;
  const storage = registry.get('storage');

  const base = {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: row.kind,
    category: row.category,
    tags: safeJson(row.tags, []),
    durationMs: row.duration_ms,
    width: row.width,
    height: row.height,
    videoUrl: row.storage_key ? storage.urlFor(row.storage_key) : null,
    thumbnailUrl: row.thumbnail_key ? storage.urlFor(row.thumbnail_key) : null,
    renditions: safeJson(row.renditions, []).map((r) => ({
      quality: r.quality,
      url: storage.urlFor(r.key),
      bitrate: r.bitrate,
    })),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    stats: {
      views: row.view_count,
      likes: row.like_count,
      dislikes: row.dislike_count,
      comments: row.comment_count,
      shares: row.share_count,
      saves: row.save_count,
    },
    channel: row.channel_handle ? {
      id: row.channel_id,
      handle: row.channel_handle,
      name: row.channel_name,
      avatarUrl: row.channel_avatar,
      followerCount: row.channel_followers,
    } : { id: row.channel_id },
    sound: row.sound_id ? {
      id: row.sound_id,
      title: row.sound_title || 'Original sound',
      artist: row.sound_artist || '',
    } : null,
  };

  // The viewer's own relationship to this video, so the UI can render the
  // correct like/save state without a second request.
  if (viewer) {
    const reaction = db.get(
      'SELECT value FROM reactions WHERE user_id = :u AND video_id = :v',
      { u: viewer.id, v: row.id }
    );
    const saved = db.get(
      'SELECT 1 AS s FROM saves WHERE user_id = :u AND video_id = :v',
      { u: viewer.id, v: row.id }
    );
    const following = db.get(
      'SELECT 1 AS f FROM follows WHERE follower_id = :u AND channel_id = :c',
      { u: viewer.id, c: row.channel_id }
    );
    base.viewerState = {
      liked: reaction?.value === 1,
      disliked: reaction?.value === -1,
      saved: Boolean(saved),
      following: Boolean(following),
      isOwner: row.creator_id === viewer.id,
    };
  }

  // Owner-only fields: processing state, moderation state, private counters.
  if (includePrivate) {
    base.visibility = row.visibility;
    base.processingStatus = row.processing_status;
    base.processingError = row.processing_error;
    base.copyrightStatus = row.copyright_status;
    base.moderationStatus = row.moderation_status;
    base.watchTimeMs = row.total_watch_ms;
  }

  return base;
}

/** Fetch a video with its channel/sound joined. */
function findById(id) {
  return db.get(
    `SELECT v.*, c.handle AS channel_handle, c.name AS channel_name,
            c.avatar_url AS channel_avatar, c.follower_count AS channel_followers,
            s.title AS sound_title, s.artist AS sound_artist
       FROM videos v
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN sounds s ON s.id = v.sound_id
      WHERE v.id = :id`,
    { id }
  );
}

/** Fetch and authorize in one step. Throws if the viewer may not see it. */
function getForViewer(id, viewer) {
  const video = findById(id);
  const check = canView(video, viewer);
  if (!check.allowed) {
    // 'not_found' for private content too: confirming a private video exists is
    // itself an information leak.
    if (check.reason === 'private' || check.reason === 'not_found') {
      throw errors.notFound('That video is not available.');
    }
    if (check.reason === 'not_ready') {
      throw errors.notFound('That video is still being processed.');
    }
    throw errors.forbidden('That video is not available.');
  }
  return video;
}

/** Update the metadata a creator controls. */
function update(videoId, viewer, fields) {
  const video = findById(videoId);
  if (!video) throw errors.notFound('Video not found.');
  if (!canEdit(video, viewer)) throw errors.forbidden('You can only edit your own videos.');

  const columns = {
    title: fields.title,
    description: fields.description,
    category: fields.category && CATEGORIES.includes(fields.category) ? fields.category : undefined,
    tags: fields.tags ? JSON.stringify(fields.tags.slice(0, 20)) : undefined,
    visibility: fields.visibility && VISIBILITIES.includes(fields.visibility) ? fields.visibility : undefined,
    sound_id: fields.soundId,
  };

  const sets = [];
  const params = { id: videoId, now: new Date().toISOString() };
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    sets.push(`${column} = :${column}`);
    params[column] = value;
  }
  if (!sets.length) return findById(videoId);

  // Going public for the first time is a publish event.
  const becomingPublic = columns.visibility === 'public' && video.visibility !== 'public';
  if (becomingPublic && !video.published_at) {
    sets.push('published_at = :now');
  }

  db.run(`UPDATE videos SET ${sets.join(', ')}, updated_at = :now WHERE id = :id`, params);

  if (becomingPublic) {
    publish(EVENTS.VIDEO_PUBLISHED, {
      videoId, channelId: video.channel_id, creatorId: video.creator_id,
    });
    require('./trending').invalidate();
    // The platform-state cache decides which empty/onboarding experience the
    // frontend shows. Publishing the very first video must flip that
    // immediately, not up to 30 seconds later. (spec §8, §62)
    require('../core/cache').invalidate('platform:state');
  }

  return findById(videoId);
}

/** Soft delete. Keeps the row so comments and analytics stay coherent. */
function remove(videoId, viewer) {
  const video = findById(videoId);
  if (!video) throw errors.notFound('Video not found.');
  if (!canEdit(video, viewer)) throw errors.forbidden('You can only delete your own videos.');

  const now = new Date().toISOString();
  db.tx(() => {
    db.run(`UPDATE videos SET deleted_at = :now, visibility = 'private', updated_at = :now WHERE id = :id`,
      { id: videoId, now });
    db.run('UPDATE channels SET video_count = MAX(0, video_count - 1) WHERE id = :id',
      { id: video.channel_id });
  });

  logger.info('videos', 'deleted', { videoId, by: viewer.id });
  return { deleted: true };
}

/**
 * React to a video (like / dislike / clear).
 *
 * Tapping like twice removes the like — the same control toggles, which is what
 * users expect from a heart button.
 */
function react(videoId, userId, value) {
  const video = findById(videoId);
  if (!video) throw errors.notFound('Video not found.');

  const existing = db.get('SELECT value FROM reactions WHERE user_id = :u AND video_id = :v',
    { u: userId, v: videoId });

  let finalValue = value;
  if (existing && existing.value === value) finalValue = 0; // toggle off

  db.tx(() => {
    if (finalValue === 0) {
      db.run('DELETE FROM reactions WHERE user_id = :u AND video_id = :v', { u: userId, v: videoId });
    } else {
      db.run(
        `INSERT INTO reactions (user_id, video_id, value, created_at)
         VALUES (:u, :v, :value, :now)
         ON CONFLICT(user_id, video_id) DO UPDATE SET value = :value, created_at = :now`,
        { u: userId, v: videoId, value: finalValue, now: new Date().toISOString() }
      );
    }
    analytics.recomputeVideoStats(videoId);
  });

  if (finalValue === 1) {
    publish(EVENTS.VIDEO_LIKED, {
      videoId, userId, creatorId: video.creator_id, channelId: video.channel_id,
    });
  } else if (finalValue === -1) {
    publish(EVENTS.VIDEO_DISLIKED, { videoId, userId, creatorId: video.creator_id });
  }

  // A like is a strong interest signal — feed it straight back into the profile.
  if (finalValue === 1) {
    recommendations.learnFromWatch({
      userId, video, completion: 1, skippedFast: false, liked: true,
    });
  }

  const updated = findById(videoId);
  return {
    liked: finalValue === 1,
    disliked: finalValue === -1,
    likes: updated.like_count,
    dislikes: updated.dislike_count,
  };
}

/** Save / unsave (the bookmark control). */
function toggleSave(videoId, userId) {
  const existing = db.get('SELECT 1 AS s FROM saves WHERE user_id = :u AND video_id = :v',
    { u: userId, v: videoId });

  if (existing) {
    db.run('DELETE FROM saves WHERE user_id = :u AND video_id = :v', { u: userId, v: videoId });
  } else {
    db.run('INSERT INTO saves (user_id, video_id, created_at) VALUES (:u, :v, :now)',
      { u: userId, v: videoId, now: new Date().toISOString() });
  }
  analytics.recomputeVideoStats(videoId);
  return { saved: !existing };
}

/** Record a share. */
function share(videoId, userId) {
  const video = findById(videoId);
  if (!video) throw errors.notFound('Video not found.');

  db.run('UPDATE videos SET share_count = share_count + 1 WHERE id = :id', { id: videoId });
  publish(EVENTS.VIDEO_SHARED, { videoId, userId, creatorId: video.creator_id });

  return { shares: video.share_count + 1 };
}

/**
 * Record a watch heartbeat: counts the view if it qualifies AND teaches the
 * recommendation profile.
 */
function recordWatch({ videoId, viewer, ip, userAgent, watchMs, source, replayed }) {
  const video = findById(videoId);
  if (!video) throw errors.notFound('Video not found.');

  const result = analytics.recordWatch({
    videoId,
    userId: viewer?.id || null,
    ip, userAgent,
    watchMs,
    durationMs: video.duration_ms,
    source,
    replayed,
  });

  if (viewer) {
    recommendations.learnFromWatch({
      userId: viewer.id,
      video,
      completion: result.completion,
      skippedFast: result.skippedFast,
      liked: false,
    });
  }

  if (result.counted) {
    publish(EVENTS.VIDEO_VIEWED, {
      videoId, userId: viewer?.id || null, creatorId: video.creator_id, watchMs,
    });
  }

  return { counted: result.counted, views: findById(videoId).view_count };
}

/** A channel's videos. Owners see everything; visitors see public only. */
function listByChannel(channelId, { viewer = null, limit = 24, cursor = 0 } = {}) {
  const channel = db.get('SELECT * FROM channels WHERE id = :id', { id: channelId });
  if (!channel) throw errors.notFound('Channel not found.');

  const isOwner = viewer && channel.owner_id === viewer.id;

  const rows = db.all(
    `SELECT v.*, c.handle AS channel_handle, c.name AS channel_name,
            c.avatar_url AS channel_avatar, c.follower_count AS channel_followers,
            s.title AS sound_title, s.artist AS sound_artist
       FROM videos v
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN sounds s ON s.id = v.sound_id
      WHERE v.channel_id = :channelId
        AND v.deleted_at IS NULL
        AND (:isOwner = 1 OR (v.visibility = 'public' AND v.processing_status = 'ready'))
      ORDER BY COALESCE(v.published_at, v.created_at) DESC
      LIMIT :limit OFFSET :cursor`,
    { channelId, isOwner: isOwner ? 1 : 0, limit, cursor }
  );

  return rows.map((r) => present(r, { viewer, includePrivate: isOwner }));
}

/** Videos that use a given sound — the "use this sound" discovery page. */
function listBySound(soundId, { viewer = null, limit = 24, cursor = 0 } = {}) {
  const rows = db.all(
    `SELECT v.*, c.handle AS channel_handle, c.name AS channel_name,
            c.avatar_url AS channel_avatar, c.follower_count AS channel_followers,
            s.title AS sound_title, s.artist AS sound_artist
       FROM videos v
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN sounds s ON s.id = v.sound_id
      WHERE v.sound_id = :soundId
        AND v.visibility = 'public' AND v.processing_status = 'ready'
        AND v.deleted_at IS NULL AND c.status = 'active'
      ORDER BY v.view_count DESC, v.published_at DESC
      LIMIT :limit OFFSET :cursor`,
    { soundId, limit, cursor }
  );
  return rows.map((r) => present(r, { viewer }));
}

function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

module.exports = {
  CATEGORIES, VISIBILITIES,
  canView, canEdit, present, findById, getForViewer,
  update, remove, react, toggleSave, share, recordWatch,
  listByChannel, listBySound,
};
