'use strict';

/**
 * CHANNEL SERVICE — creator profiles and the follow graph (spec §7, §53).
 *
 * The follow graph is the platform's social backbone: it drives the
 * subscriptions feed, upload notifications, and one of the recommendation
 * engine's strongest signals.
 */

const db = require('../core/db');
const errors = require('../core/errors');
const { EVENTS, publish } = require('../core/events');
const registry = require('../integrations/registry');

function present(row, { viewer = null } = {}) {
  if (!row) return null;
  const storage = registry.get('storage');

  const base = {
    id: row.id,
    handle: row.handle,
    name: row.name,
    description: row.description,
    avatarUrl: row.avatar_url,
    bannerUrl: row.banner_url,
    links: safeJson(row.links, []),
    followerCount: row.follower_count,
    videoCount: row.video_count,
    totalViews: row.total_views,
    createdAt: row.created_at,
    ownerId: row.owner_id,
  };

  if (viewer) {
    const following = db.get(
      'SELECT notify FROM follows WHERE follower_id = :u AND channel_id = :c',
      { u: viewer.id, c: row.id }
    );
    base.viewerState = {
      following: Boolean(following),
      notify: following ? Boolean(following.notify) : false,
      isOwner: row.owner_id === viewer.id,
    };
  }
  return base;
}

function findById(id) {
  return db.get(`SELECT * FROM channels WHERE id = :id AND status != 'deleted'`, { id });
}

function findByHandle(handle) {
  return db.get(`SELECT * FROM channels WHERE handle = :handle AND status != 'deleted'`,
    { handle: String(handle).toLowerCase().replace(/^@/, '') });
}

function findByOwner(userId) {
  return db.get(`SELECT * FROM channels WHERE owner_id = :id AND status = 'active'`, { id: userId });
}

/** Update the channel fields an owner controls. */
function update(channelId, viewer, fields) {
  const channel = findById(channelId);
  if (!channel) throw errors.notFound('Channel not found.');
  if (channel.owner_id !== viewer.id && !['admin'].includes(viewer.role)) {
    throw errors.forbidden('You can only edit your own channel.');
  }

  // A handle change must not collide with an existing one.
  if (fields.handle && fields.handle !== channel.handle) {
    const taken = db.get('SELECT id FROM channels WHERE handle = :h AND id != :id',
      { h: fields.handle, id: channelId });
    if (taken) throw errors.conflict('That handle is taken.', { handle: 'Already taken.' });
  }

  const columns = {
    handle: fields.handle,
    name: fields.name,
    description: fields.description,
    avatar_url: fields.avatarUrl,
    banner_url: fields.bannerUrl,
    links: fields.links ? JSON.stringify(fields.links.slice(0, 10)) : undefined,
  };

  const sets = [];
  const params = { id: channelId, now: new Date().toISOString() };
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    sets.push(`${column} = :${column}`);
    params[column] = value;
  }
  if (!sets.length) return findById(channelId);

  db.run(`UPDATE channels SET ${sets.join(', ')}, updated_at = :now WHERE id = :id`, params);
  return findById(channelId);
}

/**
 * Follow / unfollow (toggles).
 * Publishes USER_FOLLOWED so the notification service can tell the creator.
 */
function toggleFollow({ channelId, user }) {
  const channel = findById(channelId);
  if (!channel) throw errors.notFound('Channel not found.');
  if (channel.owner_id === user.id) {
    throw errors.badRequest('You cannot follow your own channel.');
  }

  const existing = db.get('SELECT 1 AS f FROM follows WHERE follower_id = :u AND channel_id = :c',
    { u: user.id, c: channelId });

  db.tx(() => {
    if (existing) {
      db.run('DELETE FROM follows WHERE follower_id = :u AND channel_id = :c',
        { u: user.id, c: channelId });
      db.run('UPDATE channels SET follower_count = MAX(0, follower_count - 1) WHERE id = :id',
        { id: channelId });
    } else {
      db.run(
        `INSERT INTO follows (follower_id, channel_id, notify, created_at)
         VALUES (:u, :c, 1, :now)`,
        { u: user.id, c: channelId, now: new Date().toISOString() }
      );
      db.run('UPDATE channels SET follower_count = follower_count + 1 WHERE id = :id',
        { id: channelId });
    }
  });

  if (!existing) {
    publish(EVENTS.USER_FOLLOWED, {
      channelId, userId: user.id, creatorId: channel.owner_id,
    });
  }

  const updated = findById(channelId);
  return { following: !existing, followerCount: updated.follower_count };
}

/** Toggle the notification bell for a channel you follow. */
function setNotify({ channelId, user, notify }) {
  const follow = db.get('SELECT 1 AS f FROM follows WHERE follower_id = :u AND channel_id = :c',
    { u: user.id, c: channelId });
  if (!follow) throw errors.badRequest('Follow the channel first.');

  db.run('UPDATE follows SET notify = :notify WHERE follower_id = :u AND channel_id = :c',
    { u: user.id, c: channelId, notify: notify ? 1 : 0 });
  return { notify: Boolean(notify) };
}

/** Channels a user follows — powers the Subscriptions tab. */
function listFollowing(userId, { limit = 50, cursor = 0 } = {}) {
  return db.all(
    `SELECT c.* FROM follows f JOIN channels c ON c.id = f.channel_id
      WHERE f.follower_id = :u AND c.status = 'active'
      ORDER BY f.created_at DESC LIMIT :limit OFFSET :cursor`,
    { u: userId, limit, cursor }
  ).map((c) => present(c));
}

/**
 * New videos from creators the user follows.
 * Chronological on purpose: this is the feed where people expect to see
 * everything from the creators they chose, not an algorithmic selection.
 */
function followingFeed(userId, { limit = 20, cursor = 0 } = {}) {
  const videos = require('./videos');
  const rows = db.all(
    `SELECT v.*, c.handle AS channel_handle, c.name AS channel_name,
            c.avatar_url AS channel_avatar, c.follower_count AS channel_followers,
            s.title AS sound_title, s.artist AS sound_artist
       FROM videos v
       JOIN channels c ON c.id = v.channel_id
       JOIN follows f ON f.channel_id = c.id
       LEFT JOIN sounds s ON s.id = v.sound_id
      WHERE f.follower_id = :u
        AND v.visibility = 'public' AND v.processing_status = 'ready'
        AND v.deleted_at IS NULL AND v.moderation_status IN ('approved','pending')
      ORDER BY v.published_at DESC
      LIMIT :limit OFFSET :cursor`,
    { u: userId, limit, cursor }
  );
  return rows.map((r) => videos.present(r, { viewer: { id: userId } }));
}

/**
 * Suggested creators to follow (spec §61).
 *
 * Deliberately NOT "the biggest channels". It mixes active small creators with
 * genuinely popular ones, so the suggestion surface is another place new
 * creators can be discovered rather than another rich-get-richer loop.
 */
function suggestedChannels(userId, { limit = 10 } = {}) {
  const following = userId
    ? db.all('SELECT channel_id FROM follows WHERE follower_id = :u', { u: userId }).map((r) => r.channel_id)
    : [];

  const exclude = [...following];
  const notIn = exclude.length
    ? `AND c.id NOT IN (${exclude.map((_, i) => `:e${i}`).join(',')})`
    : '';
  const params = Object.fromEntries(exclude.map((id, i) => [`e${i}`, id]));

  const since = new Date(Date.now() - 30 * 86400_000).toISOString();

  // Half from creators who posted recently and are still small.
  const rising = db.all(
    `SELECT c.* FROM channels c
      WHERE c.status = 'active' AND c.video_count > 0 AND c.follower_count < 1000
        AND EXISTS (SELECT 1 FROM videos v WHERE v.channel_id = c.id
                     AND v.published_at > :since AND v.visibility = 'public')
        ${notIn} AND (:userId IS NULL OR c.owner_id != :userId)
      ORDER BY RANDOM() LIMIT :limit`,
    { ...params, since, userId: userId || null, limit: Math.ceil(limit / 2) }
  );

  // Half from established, active channels.
  const established = db.all(
    `SELECT c.* FROM channels c
      WHERE c.status = 'active' AND c.video_count > 0
        ${notIn} AND (:userId IS NULL OR c.owner_id != :userId)
      ORDER BY c.follower_count DESC LIMIT :limit`,
    { ...params, userId: userId || null, limit: Math.floor(limit / 2) }
  );

  const seen = new Set();
  return [...rising, ...established]
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .slice(0, limit)
    .map((c) => present(c, userId ? { viewer: { id: userId } } : {}));
}

function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

module.exports = {
  present, findById, findByHandle, findByOwner, update,
  toggleFollow, setNotify, listFollowing, followingFeed, suggestedChannels,
};
