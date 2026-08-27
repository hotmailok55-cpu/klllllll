'use strict';

/**
 * COMMENT SERVICE (spec §17, §18).
 *
 * Threads are capped at MAX_DEPTH levels. Beyond that, a reply attaches to its
 * grandparent instead of nesting further — deep threads become unreadable on a
 * phone, and this keeps the shape flat enough to render while still letting
 * conversations continue.
 *
 * Every comment passes through the moderation service before it appears.
 */

const db = require('../core/db');
const errors = require('../core/errors');
const { EVENTS, publish } = require('../core/events');
const moderation = require('./moderation');
const users = require('./users');

const MAX_DEPTH = 2;      // top level (0) -> reply (1) -> reply to reply (2)
const MAX_LENGTH = 2000;

/** Post a comment or a reply. */
async function create({ videoId, user, body, parentId = null }) {
  const video = db.get('SELECT * FROM videos WHERE id = :id AND deleted_at IS NULL', { id: videoId });
  if (!video) throw errors.notFound('Video not found.');

  const text = String(body || '').trim();
  if (!text) throw errors.validation('Write something first.', { body: 'Cannot be empty.' });
  if (text.length > MAX_LENGTH) {
    throw errors.validation('That comment is too long.', { body: `Keep it under ${MAX_LENGTH} characters.` });
  }

  // Work out the depth, flattening past the cap.
  let depth = 0;
  let effectiveParentId = null;
  if (parentId) {
    const parent = db.get('SELECT * FROM comments WHERE id = :id AND deleted_at IS NULL',
      { id: parentId });
    if (!parent) throw errors.notFound('That comment no longer exists.');
    if (parent.video_id !== videoId) throw errors.badRequest('That comment belongs to another video.');

    if (parent.depth >= MAX_DEPTH) {
      // Attach to the parent's parent so the thread stays at the cap.
      effectiveParentId = parent.parent_id || parent.id;
      depth = MAX_DEPTH;
    } else {
      effectiveParentId = parent.id;
      depth = parent.depth + 1;
    }
  }

  // Moderation runs BEFORE the comment is visible.
  const verdict = await moderation.moderateText({ text, context: 'comment' });
  if (verdict.decision === 'remove') {
    throw errors.badRequest('That comment goes against our community guidelines.');
  }

  const status = { allow: 'approved', flag: 'approved', limit: 'pending' }[verdict.decision] || 'approved';

  const id = db.newId('cmt');
  const now = new Date().toISOString();

  db.tx(() => {
    db.run(
      `INSERT INTO comments (id, video_id, user_id, parent_id, depth, body,
                             moderation_status, created_at)
       VALUES (:id, :videoId, :userId, :parentId, :depth, :body, :status, :now)`,
      { id, videoId, userId: user.id, parentId: effectiveParentId, depth, body: text, status, now }
    );

    if (effectiveParentId) {
      db.run('UPDATE comments SET reply_count = reply_count + 1 WHERE id = :id',
        { id: effectiveParentId });
    }
    db.run('UPDATE videos SET comment_count = comment_count + 1 WHERE id = :id', { id: videoId });
  });

  // Flagged-but-visible comments still go to the human queue.
  if (verdict.decision === 'flag' || verdict.decision === 'limit') {
    moderation.recordCase({
      targetType: 'comment', targetId: id,
      status: status === 'pending' ? 'pending' : 'flagged',
      decision: verdict.decision, reason: verdict.reason, signals: verdict.signals,
    });
  }

  publish(EVENTS.COMMENT_CREATED, {
    commentId: id, videoId, userId: user.id,
    creatorId: video.creator_id, parentId: effectiveParentId,
    // Included so the notification service can build the message without a
    // second query.
    preview: text.slice(0, 120),
  });

  return present(db.get('SELECT * FROM comments WHERE id = :id', { id }), user);
}

/**
 * List comments for a video.
 *
 * Returns top-level comments with their first few replies inlined, which is how
 * the UI actually renders them — one request instead of N+1.
 */
function list({ videoId, viewer = null, sort = 'top', limit = 20, cursor = 0 }) {
  const blocked = viewer ? users.blockedIds(viewer.id) : [];
  const blockFilter = blocked.length
    ? `AND c.user_id NOT IN (${blocked.map((_, i) => `:b${i}`).join(',')})`
    : '';
  const blockParams = Object.fromEntries(blocked.map((id, i) => [`b${i}`, id]));

  // 'top' ranks by likes then recency; 'new' is purely chronological.
  const order = sort === 'new'
    ? 'c.created_at DESC'
    : 'c.like_count DESC, c.created_at DESC';

  const top = db.all(
    `SELECT c.*, u.username, u.display_name, u.avatar_url, u.verification_status
       FROM comments c
       JOIN users u ON u.id = c.user_id
      WHERE c.video_id = :videoId AND c.parent_id IS NULL
        AND c.deleted_at IS NULL AND c.moderation_status IN ('approved','flagged')
        ${blockFilter}
      ORDER BY ${order}
      LIMIT :limit OFFSET :cursor`,
    { videoId, limit, cursor, ...blockParams }
  );

  return top.map((comment) => {
    const replies = db.all(
      `SELECT c.*, u.username, u.display_name, u.avatar_url, u.verification_status
         FROM comments c
         JOIN users u ON u.id = c.user_id
        WHERE c.parent_id = :parentId AND c.deleted_at IS NULL
          AND c.moderation_status IN ('approved','flagged')
        ORDER BY c.created_at ASC LIMIT 3`,
      { parentId: comment.id }
    );
    return {
      ...present(comment, viewer),
      replies: replies.map((r) => present(r, viewer)),
      hasMoreReplies: comment.reply_count > replies.length,
    };
  });
}

/** All replies to one comment, for "show more replies". */
function listReplies({ commentId, viewer = null, limit = 20, cursor = 0 }) {
  return db.all(
    `SELECT c.*, u.username, u.display_name, u.avatar_url, u.verification_status
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.parent_id = :commentId AND c.deleted_at IS NULL
        AND c.moderation_status IN ('approved','flagged')
      ORDER BY c.created_at ASC LIMIT :limit OFFSET :cursor`,
    { commentId, limit, cursor }
  ).map((r) => present(r, viewer));
}

/** Edit your own comment. Re-moderated, and marked as edited. */
async function update({ commentId, user, body }) {
  const comment = db.get('SELECT * FROM comments WHERE id = :id AND deleted_at IS NULL',
    { id: commentId });
  if (!comment) throw errors.notFound('Comment not found.');
  if (comment.user_id !== user.id) throw errors.forbidden('You can only edit your own comments.');

  const text = String(body || '').trim();
  if (!text) throw errors.validation('Write something first.', { body: 'Cannot be empty.' });

  const verdict = await moderation.moderateText({ text, context: 'comment' });
  if (verdict.decision === 'remove') {
    throw errors.badRequest('That comment goes against our community guidelines.');
  }

  db.run('UPDATE comments SET body = :body, edited_at = :now WHERE id = :id',
    { id: commentId, body: text, now: new Date().toISOString() });

  return present(db.get('SELECT * FROM comments WHERE id = :id', { id: commentId }), user);
}

/**
 * Delete a comment. Soft delete, because hard-deleting a parent would orphan
 * every reply under it.
 */
function remove({ commentId, user }) {
  const comment = db.get('SELECT * FROM comments WHERE id = :id AND deleted_at IS NULL',
    { id: commentId });
  if (!comment) throw errors.notFound('Comment not found.');

  const video = db.get('SELECT creator_id FROM videos WHERE id = :id', { id: comment.video_id });
  const isAuthor = comment.user_id === user.id;
  const isVideoOwner = video?.creator_id === user.id;   // creators moderate their own comments
  const isStaff = ['admin', 'moderator'].includes(user.role);

  if (!isAuthor && !isVideoOwner && !isStaff) {
    throw errors.forbidden('You cannot delete that comment.');
  }

  const now = new Date().toISOString();
  db.tx(() => {
    db.run(`UPDATE comments SET deleted_at = :now, body = '[deleted]' WHERE id = :id`,
      { id: commentId, now });
    db.run('UPDATE videos SET comment_count = MAX(0, comment_count - 1) WHERE id = :id',
      { id: comment.video_id });
    if (comment.parent_id) {
      db.run('UPDATE comments SET reply_count = MAX(0, reply_count - 1) WHERE id = :id',
        { id: comment.parent_id });
    }
  });

  return { deleted: true };
}

/** Like / unlike a comment (toggles). */
function toggleLike({ commentId, user }) {
  const comment = db.get('SELECT * FROM comments WHERE id = :id AND deleted_at IS NULL',
    { id: commentId });
  if (!comment) throw errors.notFound('Comment not found.');

  const existing = db.get('SELECT 1 AS l FROM comment_likes WHERE user_id = :u AND comment_id = :c',
    { u: user.id, c: commentId });

  db.tx(() => {
    if (existing) {
      db.run('DELETE FROM comment_likes WHERE user_id = :u AND comment_id = :c',
        { u: user.id, c: commentId });
      db.run('UPDATE comments SET like_count = MAX(0, like_count - 1) WHERE id = :id',
        { id: commentId });
    } else {
      db.run('INSERT INTO comment_likes (user_id, comment_id, created_at) VALUES (:u, :c, :now)',
        { u: user.id, c: commentId, now: new Date().toISOString() });
      db.run('UPDATE comments SET like_count = like_count + 1 WHERE id = :id', { id: commentId });
    }
  });

  if (!existing) {
    publish(EVENTS.COMMENT_LIKED, {
      commentId, userId: user.id, authorId: comment.user_id, videoId: comment.video_id,
    });
  }

  const updated = db.get('SELECT like_count FROM comments WHERE id = :id', { id: commentId });
  return { liked: !existing, likes: updated.like_count };
}

function present(row, viewer) {
  if (!row) return null;
  const liked = viewer
    ? Boolean(db.get('SELECT 1 AS l FROM comment_likes WHERE user_id = :u AND comment_id = :c',
        { u: viewer.id, c: row.id }))
    : false;

  return {
    id: row.id,
    videoId: row.video_id,
    parentId: row.parent_id,
    depth: row.depth,
    body: row.body,
    likes: row.like_count,
    replyCount: row.reply_count,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deleted: Boolean(row.deleted_at),
    author: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      verified: row.verification_status === 'verified',
    },
    viewerState: viewer ? { liked, isAuthor: row.user_id === viewer.id } : undefined,
  };
}

module.exports = {
  MAX_DEPTH, MAX_LENGTH,
  create, list, listReplies, update, remove, toggleLike, present,
};
