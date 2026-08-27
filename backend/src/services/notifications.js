'use strict';

/**
 * NOTIFICATION SERVICE (spec §26).
 *
 * Entirely event-driven. Nothing calls "create a notification" directly — this
 * service SUBSCRIBES to domain events and reacts:
 *
 *   User likes a video
 *     -> videos.react() publishes VIDEO_LIKED
 *        -> this service hears it
 *           -> creates the creator's notification
 *
 * That is why the video service contains no notification code at all, and why
 * adding a new notification type never means editing the video service.
 */

const db = require('../core/db');
const { EVENTS, subscribe } = require('../core/events');
const registry = require('../integrations/registry');
const { logger } = require('../core/logger');
const queue = require('../core/queue');

/** Create an in-app notification. */
function create({ userId, type, title, body = '', link = null, actorId = null, subjectId = null }) {
  // Never notify someone about their own action.
  if (actorId && actorId === userId) return null;

  // Respect the user's notification preferences.
  const user = db.get(`SELECT notification_settings FROM users WHERE id = :id AND status = 'active'`,
    { id: userId });
  if (!user) return null;

  const settings = safeJson(user.notification_settings, {});
  if (settings[type] === false) return null;

  const id = db.newId('ntf');
  db.run(
    `INSERT INTO notifications (id, user_id, type, title, body, link, actor_id, subject_id, created_at)
     VALUES (:id, :userId, :type, :title, :body, :link, :actorId, :subjectId, :now)`,
    { id, userId, type, title, body, link, actorId, subjectId, now: new Date().toISOString() }
  );

  // Push/email delivery happens in the background so it never slows a request.
  queue.enqueue('notification.deliver', { notificationId: id }, { maxAttempts: 3 });
  return id;
}

/**
 * Wire every event -> notification rule. Called once at boot.
 * This function is the complete map of what generates a notification.
 */
function install() {
  // Someone liked your video.
  subscribe(EVENTS.VIDEO_LIKED, ({ payload }) => {
    const actor = getUser(payload.userId);
    const video = db.get('SELECT title FROM videos WHERE id = :id', { id: payload.videoId });
    if (!actor || !video) return;

    create({
      userId: payload.creatorId,
      type: 'like',
      title: `${actor.display_name} liked your video`,
      body: video.title,
      link: `/watch/${payload.videoId}`,
      actorId: payload.userId,
      subjectId: payload.videoId,
    });
  });

  // Someone commented, or replied to a comment.
  subscribe(EVENTS.COMMENT_CREATED, ({ payload }) => {
    const actor = getUser(payload.userId);
    if (!actor) return;

    if (payload.parentId) {
      // Notify the parent comment's author about the reply.
      const parent = db.get('SELECT user_id FROM comments WHERE id = :id', { id: payload.parentId });
      if (parent) {
        create({
          userId: parent.user_id,
          type: 'reply',
          title: `${actor.display_name} replied to your comment`,
          body: payload.preview,
          link: `/watch/${payload.videoId}`,
          actorId: payload.userId,
          subjectId: payload.commentId,
        });
      }
      // Do not also notify the creator about every nested reply — that gets
      // noisy fast on a busy video.
      return;
    }

    create({
      userId: payload.creatorId,
      type: 'comment',
      title: `${actor.display_name} commented on your video`,
      body: payload.preview,
      link: `/watch/${payload.videoId}`,
      actorId: payload.userId,
      subjectId: payload.commentId,
    });
  });

  // Someone liked your comment.
  subscribe(EVENTS.COMMENT_LIKED, ({ payload }) => {
    const actor = getUser(payload.userId);
    if (!actor) return;
    create({
      userId: payload.authorId,
      type: 'like',
      title: `${actor.display_name} liked your comment`,
      link: `/watch/${payload.videoId}`,
      actorId: payload.userId,
      subjectId: payload.commentId,
    });
  });

  // New follower.
  subscribe(EVENTS.USER_FOLLOWED, ({ payload }) => {
    const actor = getUser(payload.userId);
    if (!actor) return;
    create({
      userId: payload.creatorId,
      type: 'follow',
      title: `${actor.display_name} started following you`,
      link: `/@${actor.username}`,
      actorId: payload.userId,
      subjectId: payload.channelId,
    });
  });

  // A creator you follow posted. Fan-out to followers who kept the bell on.
  subscribe(EVENTS.VIDEO_PUBLISHED, ({ payload }) => {
    const channel = db.get('SELECT * FROM channels WHERE id = :id', { id: payload.channelId });
    const video = db.get('SELECT title FROM videos WHERE id = :id', { id: payload.videoId });
    if (!channel || !video) return;

    const followers = db.all(
      'SELECT follower_id FROM follows WHERE channel_id = :id AND notify = 1',
      { id: payload.channelId }
    );

    // Fine at this scale. At large scale this becomes a fan-out job so one
    // upload does not create a million rows inside one request.
    for (const follower of followers) {
      create({
        userId: follower.follower_id,
        type: 'upload',
        title: `${channel.name} posted a new video`,
        body: video.title,
        link: `/watch/${payload.videoId}`,
        actorId: channel.owner_id,
        subjectId: payload.videoId,
      });
    }
  });

  // Moderation outcomes the creator needs to know about.
  subscribe(EVENTS.MODERATION_DECIDED, ({ payload }) => {
    if (payload.targetType !== 'video') return;
    if (!['limit', 'remove'].includes(payload.decision)) return;

    const video = db.get('SELECT creator_id, title FROM videos WHERE id = :id',
      { id: payload.targetId });
    if (!video) return;

    create({
      userId: video.creator_id,
      type: 'moderation',
      title: payload.decision === 'remove'
        ? 'A video was removed'
        : 'A video has limited visibility',
      body: `${video.title} — you can appeal this decision.`,
      link: `/studio/content`,
      subjectId: payload.targetId,
    });
  });

  // Copyright outcomes worth telling the creator about.
  subscribe(EVENTS.COPYRIGHT_DECIDED, ({ payload }) => {
    if (['clear', 'unavailable'].includes(payload.result)) return;

    const video = db.get('SELECT creator_id, title FROM videos WHERE id = :id',
      { id: payload.videoId });
    if (!video) return;

    create({
      userId: video.creator_id,
      type: 'moderation',
      title: 'Copyright update on your video',
      body: `${video.title} — see your copyright dashboard for details.`,
      link: '/studio/copyright',
      subjectId: payload.videoId,
    });
  });

  // Delivery job: push the notification out through the provider.
  queue.register('notification.deliver', async ({ notificationId }) => {
    const notification = db.get('SELECT * FROM notifications WHERE id = :id',
      { id: notificationId });
    if (!notification) return;

    const user = db.get('SELECT email, notification_settings FROM users WHERE id = :id',
      { id: notification.user_id });
    if (!user) return;

    const settings = safeJson(user.notification_settings, {});
    // In-app only unless the user opted into external delivery.
    if (settings.emailEnabled !== true) return;

    await registry.get('notifications').send({
      to: user.email,
      channel: 'email',
      subject: notification.title,
      body: notification.body,
      link: notification.link,
    });
  });

  logger.info('notifications', 'event subscriptions installed');
}

function getUser(userId) {
  if (!userId) return null;
  return db.get('SELECT id, username, display_name FROM users WHERE id = :id', { id: userId });
}

/** A user's notifications. */
function list(userId, { limit = 30, cursor = 0, unreadOnly = false } = {}) {
  const rows = db.all(
    `SELECT n.*, u.username AS actor_username, u.avatar_url AS actor_avatar
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = :userId
        AND (:unreadOnly = 0 OR n.read_at IS NULL)
      ORDER BY n.created_at DESC LIMIT :limit OFFSET :cursor`,
    { userId, limit, cursor, unreadOnly: unreadOnly ? 1 : 0 }
  );

  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    read: Boolean(n.read_at),
    createdAt: n.created_at,
    actor: n.actor_id ? { id: n.actor_id, username: n.actor_username, avatarUrl: n.actor_avatar } : null,
  }));
}

function unreadCount(userId) {
  const row = db.get(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = :id AND read_at IS NULL',
    { id: userId }
  );
  return row.c;
}

function markRead(userId, notificationIds = null) {
  const now = new Date().toISOString();
  if (!notificationIds) {
    db.run('UPDATE notifications SET read_at = :now WHERE user_id = :id AND read_at IS NULL',
      { id: userId, now });
  } else {
    for (const id of notificationIds) {
      db.run('UPDATE notifications SET read_at = :now WHERE id = :nid AND user_id = :id',
        { nid: id, id: userId, now });
    }
  }
  return { unread: unreadCount(userId) };
}

function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

module.exports = { install, create, list, unreadCount, markRead };
