'use strict';

/**
 * USER SERVICE — accounts, authentication, sessions.
 *
 * Everything about identity lives here. Routes call these functions; they never
 * touch the users table directly.
 *
 * Security posture (spec §6, §38):
 *   - Passwords are scrypt-hashed, never stored or logged in plaintext.
 *   - Session tokens are stored HASHED; the raw token exists only in the
 *     client's hands.
 *   - Login says the same thing whether the email or the password was wrong, so
 *     the endpoint cannot be used to discover which emails have accounts.
 *   - Sessions are revocable per-device.
 */

const db = require('../core/db');
const { config } = require('../core/config');
const { hashPassword, verifyPassword, randomToken, sha256 } = require('../core/crypto');
const { EVENTS, publish } = require('../core/events');
const errors = require('../core/errors');
const { logger } = require('../core/logger');

// Salt for hashing non-secret identifiers (IPs, device keys) before storage.
// Not a password salt — it just stops raw values sitting in the database.
const IDENTITY_SALT = () => config.auth.secret || 'dev-identity-salt';

/** Public shape of a user — safe to send to any client. */
function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    isCreator: Boolean(row.is_creator),
    verified: row.verification_status === 'verified',
    createdAt: row.created_at,
  };
}

/** Fuller shape — only ever returned to the user themselves. */
function privateUser(row) {
  if (!row) return null;
  return {
    ...publicUser(row),
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    role: row.role,
    status: row.status,
    onboarded: Boolean(row.onboarded),
    privacySettings: safeJson(row.privacy_settings, {}),
    notificationSettings: safeJson(row.notification_settings, {}),
    preferences: safeJson(row.preferences, {}),
  };
}

function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

/**
 * Register a new account.
 * Creates the user AND their channel — on this platform everyone can post, so
 * there is no separate "become a creator" step to stumble over.
 */
function register({ username, email, password, displayName }) {
  if (!config.flags.REGISTRATION_ENABLED) {
    throw errors.forbidden('New sign-ups are paused right now. Please check back soon.');
  }

  const existingEmail = db.get('SELECT id FROM users WHERE email = :email', { email });
  if (existingEmail) {
    // Do not confirm which field collided beyond what the user typed.
    throw errors.conflict('An account with that email already exists.', { email: 'Already in use.' });
  }
  const existingUsername = db.get('SELECT id FROM users WHERE username = :username', { username });
  if (existingUsername) {
    throw errors.conflict('That username is taken.', { username: 'Already taken.' });
  }

  const now = new Date().toISOString();
  const userId = db.newId('usr');
  const channelId = db.newId('chn');

  db.tx(() => {
    db.run(
      `INSERT INTO users (id, username, display_name, email, password_hash, bio,
                          status, role, email_verified, created_at, updated_at)
       VALUES (:id, :username, :displayName, :email, :passwordHash, '',
               'active', 'user', 0, :now, :now)`,
      {
        id: userId, username, email,
        displayName: displayName || username,
        passwordHash: hashPassword(password),
        now,
      }
    );

    db.run(
      `INSERT INTO channels (id, owner_id, handle, name, created_at, updated_at)
       VALUES (:id, :ownerId, :handle, :name, :now, :now)`,
      { id: channelId, ownerId: userId, handle: username, name: displayName || username, now }
    );
  });

  publish(EVENTS.USER_REGISTERED, { userId, username });
  publish(EVENTS.CHANNEL_CREATED, { channelId, ownerId: userId, handle: username });

  logger.info('users', 'registered', { userId });
  const user = db.get('SELECT * FROM users WHERE id = :id', { id: userId });
  return { user: privateUser(user), channelId };
}

/**
 * Verify credentials. Returns the user row or throws a deliberately vague
 * error — the same message for "no such email" and "wrong password".
 */
function authenticate({ email, password }) {
  const user = db.get('SELECT * FROM users WHERE email = :email', { email });

  if (!user) {
    // Still spend the time a real hash would take, so response timing does not
    // reveal whether the account exists.
    verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    throw errors.unauthorized('That email or password is not correct.');
  }
  if (!verifyPassword(password, user.password_hash)) {
    throw errors.unauthorized('That email or password is not correct.');
  }
  if (user.status === 'suspended') {
    throw errors.forbidden('This account is suspended. Contact support if you think that is a mistake.');
  }
  if (user.status === 'deleted') {
    throw errors.unauthorized('That email or password is not correct.');
  }
  return user;
}

/**
 * Create a session and return the RAW token (the only time it exists in
 * readable form). We store only its hash.
 */
function createSession(userId, { deviceLabel = '', ip = '' } = {}) {
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.auth.tokenTtlSeconds * 1000);

  db.run(
    `INSERT INTO sessions (id, user_id, token_hash, device_label, ip_hash,
                           created_at, last_seen_at, expires_at)
     VALUES (:id, :userId, :tokenHash, :deviceLabel, :ipHash, :now, :now, :expiresAt)`,
    {
      id: db.newId('ses'),
      userId,
      tokenHash: sha256(token),
      deviceLabel: String(deviceLabel).slice(0, 120),
      ipHash: ip ? sha256(ip, IDENTITY_SALT()) : null,
      now: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }
  );

  return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * Resolve a raw session token to a user. Returns null for anything invalid —
 * unknown, expired, revoked, or belonging to a non-active account.
 */
function resolveSession(token) {
  if (!token) return null;

  const session = db.get(
    `SELECT s.*, u.status AS user_status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = :hash`,
    { hash: sha256(token) }
  );
  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at) <= new Date()) return null;
  if (session.user_status !== 'active') return null;

  // Track activity, but only once a minute — this runs on every request.
  const lastSeen = new Date(session.last_seen_at).getTime();
  if (Date.now() - lastSeen > 60_000) {
    db.run('UPDATE sessions SET last_seen_at = :now WHERE id = :id', {
      id: session.id, now: new Date().toISOString(),
    });
  }

  const user = db.get('SELECT * FROM users WHERE id = :id', { id: session.user_id });
  return { user, sessionId: session.id };
}

/** Sign out one session. */
function revokeSession(sessionId, userId) {
  db.run(
    `UPDATE sessions SET revoked_at = :now WHERE id = :id AND user_id = :userId`,
    { id: sessionId, userId, now: new Date().toISOString() }
  );
}

/** Sign out everywhere — used after a password change or a security scare. */
function revokeAllSessions(userId, { exceptSessionId } = {}) {
  db.run(
    `UPDATE sessions SET revoked_at = :now
      WHERE user_id = :userId AND revoked_at IS NULL
        AND (:except IS NULL OR id != :except)`,
    { userId, now: new Date().toISOString(), except: exceptSessionId || null }
  );
}

/** Active devices, for the security settings screen. (spec §6) */
function listSessions(userId, currentSessionId) {
  return db.all(
    `SELECT id, device_label, created_at, last_seen_at, expires_at
       FROM sessions
      WHERE user_id = :userId AND revoked_at IS NULL AND expires_at > :now
      ORDER BY last_seen_at DESC`,
    { userId, now: new Date().toISOString() }
  ).map((s) => ({
    id: s.id,
    deviceLabel: s.device_label || 'Unknown device',
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    current: s.id === currentSessionId,
  }));
}

/**
 * Issue a single-use token for email verification or password reset.
 * Returns the raw token for the delivery layer; only the hash is stored.
 */
function issueAuthToken(userId, purpose, ttlSeconds = 3600) {
  const token = randomToken(32);
  db.run(
    `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at, created_at)
     VALUES (:id, :userId, :purpose, :hash, :expiresAt, :now)`,
    {
      id: db.newId('tok'), userId, purpose,
      hash: sha256(token),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      now: new Date().toISOString(),
    }
  );
  return token;
}

/** Consume a single-use token. Returns the user id, or throws. */
function consumeAuthToken(token, purpose) {
  const row = db.get(
    `SELECT * FROM auth_tokens WHERE token_hash = :hash AND purpose = :purpose`,
    { hash: sha256(token), purpose }
  );
  if (!row || row.used_at || new Date(row.expires_at) <= new Date()) {
    throw errors.badRequest('That link is invalid or has expired. Please request a new one.');
  }
  db.run('UPDATE auth_tokens SET used_at = :now WHERE id = :id', {
    id: row.id, now: new Date().toISOString(),
  });
  return row.user_id;
}

function markEmailVerified(userId) {
  db.run('UPDATE users SET email_verified = 1, updated_at = :now WHERE id = :id', {
    id: userId, now: new Date().toISOString(),
  });
}

/** Change the password and sign every other device out. */
function setPassword(userId, newPassword) {
  db.run('UPDATE users SET password_hash = :hash, updated_at = :now WHERE id = :id', {
    id: userId, hash: hashPassword(newPassword), now: new Date().toISOString(),
  });
  revokeAllSessions(userId);
  logger.info('users', 'password changed', { userId });
}

function findById(id) {
  return db.get(`SELECT * FROM users WHERE id = :id AND status != 'deleted'`, { id });
}

function findByUsername(username) {
  return db.get(`SELECT * FROM users WHERE username = :username AND status != 'deleted'`, {
    username: String(username).toLowerCase(),
  });
}

/** Update the profile fields a user is allowed to change themselves. */
function updateProfile(userId, fields) {
  const allowed = {
    display_name: fields.displayName,
    bio: fields.bio,
    avatar_url: fields.avatarUrl,
    privacy_settings: fields.privacySettings ? JSON.stringify(fields.privacySettings) : undefined,
    notification_settings: fields.notificationSettings ? JSON.stringify(fields.notificationSettings) : undefined,
    preferences: fields.preferences ? JSON.stringify(fields.preferences) : undefined,
  };

  const sets = [];
  const params = { id: userId, now: new Date().toISOString() };
  for (const [column, value] of Object.entries(allowed)) {
    if (value === undefined) continue;
    sets.push(`${column} = :${column}`);
    params[column] = value;
  }
  if (!sets.length) return findById(userId);

  db.run(`UPDATE users SET ${sets.join(', ')}, updated_at = :now WHERE id = :id`, params);
  return findById(userId);
}

/**
 * Account deletion (spec §57).
 *
 * We ANONYMIZE rather than hard-delete, because a hard delete would tear holes
 * in other people's conversations — replies to a deleted comment would vanish
 * mid-thread. Personal data goes; the structure other users depend on stays.
 * Videos are soft-deleted and stop being served.
 */
function deleteAccount(userId) {
  const now = new Date().toISOString();

  db.tx(() => {
    db.run(
      `UPDATE users
          SET status='deleted', deleted_at=:now, updated_at=:now,
              email = 'deleted+' || id || '@deleted.invalid',
              username = 'deleted_' || substr(id, 5, 8),
              display_name = 'Deleted account',
              password_hash = 'deleted', bio = '', avatar_url = NULL,
              privacy_settings='{}', notification_settings='{}', preferences='{}'
        WHERE id = :id`,
      { id: userId, now }
    );

    db.run(`UPDATE channels SET status='deleted', name='Deleted account',
                   description='', avatar_url=NULL, banner_url=NULL, updated_at=:now
             WHERE owner_id = :id`, { id: userId, now });

    db.run(`UPDATE videos SET deleted_at=:now, visibility='private', updated_at=:now
             WHERE creator_id = :id AND deleted_at IS NULL`, { id: userId, now });

    // Comments stay so threads remain readable, but the text is cleared.
    db.run(`UPDATE comments SET body='[deleted]', deleted_at=:now
             WHERE user_id = :id AND deleted_at IS NULL`, { id: userId, now });

    db.run('UPDATE sessions SET revoked_at=:now WHERE user_id=:id AND revoked_at IS NULL',
      { id: userId, now });

    // Personalization data is genuinely deleted — nobody else depends on it.
    db.run('DELETE FROM user_interests WHERE user_id = :id', { id: userId });
    db.run('DELETE FROM user_creator_affinity WHERE user_id = :id', { id: userId });
    db.run('DELETE FROM search_queries WHERE user_id = :id', { id: userId });
  });

  logger.info('users', 'account deleted (anonymized)', { userId });
}

/**
 * Export everything we hold about a user (spec §56).
 * Returns a plain object the route serializes as a JSON download.
 */
function exportData(userId) {
  const user = findById(userId);
  if (!user) throw errors.notFound('Account not found.');

  return {
    exportedAt: new Date().toISOString(),
    account: privateUser(user),
    channels: db.all('SELECT * FROM channels WHERE owner_id = :id', { id: userId }),
    videos: db.all(
      `SELECT id, title, description, visibility, created_at, published_at, view_count, like_count
         FROM videos WHERE creator_id = :id`, { id: userId }),
    comments: db.all(
      `SELECT id, video_id, body, created_at FROM comments
        WHERE user_id = :id AND deleted_at IS NULL`, { id: userId }),
    follows: db.all('SELECT channel_id, created_at FROM follows WHERE follower_id = :id', { id: userId }),
    reactions: db.all('SELECT video_id, value, created_at FROM reactions WHERE user_id = :id', { id: userId }),
    playlists: db.all('SELECT * FROM playlists WHERE owner_id = :id', { id: userId }),
    interests: db.all('SELECT topic, weight, source FROM user_interests WHERE user_id = :id', { id: userId }),
    searchHistory: db.all('SELECT query, created_at FROM search_queries WHERE user_id = :id', { id: userId }),
  };
}

/** Block / unblock another account (spec §55). */
function blockUser(blockerId, blockedId) {
  if (blockerId === blockedId) throw errors.badRequest('You cannot block yourself.');
  db.run(
    `INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at)
     VALUES (:blocker, :blocked, :now)`,
    { blocker: blockerId, blocked: blockedId, now: new Date().toISOString() }
  );
  return { blocked: true };
}

function unblockUser(blockerId, blockedId) {
  db.run('DELETE FROM blocks WHERE blocker_id = :blocker AND blocked_id = :blocked',
    { blocker: blockerId, blocked: blockedId });
  return { blocked: false };
}

/** Ids this user has blocked — used to filter feeds and comments. */
function blockedIds(userId) {
  if (!userId) return [];
  return db.all('SELECT blocked_id FROM blocks WHERE blocker_id = :id', { id: userId })
    .map((r) => r.blocked_id);
}

module.exports = {
  publicUser, privateUser,
  register, authenticate,
  createSession, resolveSession, revokeSession, revokeAllSessions, listSessions,
  issueAuthToken, consumeAuthToken, markEmailVerified, setPassword,
  findById, findByUsername, updateProfile,
  deleteAccount, exportData,
  blockUser, unblockUser, blockedIds,
};
