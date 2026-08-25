'use strict';

/**
 * PLAYLIST SERVICE (spec §48).
 *
 * Playlists reuse the same three visibility levels as videos, and the same
 * permission-check pattern, so there is one mental model for "who can see this"
 * across the whole platform.
 */

const db = require('../core/db');
const errors = require('../core/errors');
const videos = require('./videos');

const VISIBILITIES = ['public', 'unlisted', 'private'];

function present(row, { viewer = null, items = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    videoCount: row.video_count,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOwner: viewer ? row.owner_id === viewer.id : false,
    ...(items ? { videos: items } : {}),
  };
}

/** Same centralized-permission approach as videos.canView. */
function canView(playlist, viewer) {
  if (!playlist) return false;
  if (viewer && playlist.owner_id === viewer.id) return true;
  if (viewer && viewer.role === 'admin') return true;
  return playlist.visibility === 'public' || playlist.visibility === 'unlisted';
}

function create({ user, name, description = '', visibility = 'private' }) {
  if (!VISIBILITIES.includes(visibility)) visibility = 'private';

  const id = db.newId('pls');
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO playlists (id, owner_id, name, description, visibility, created_at, updated_at)
     VALUES (:id, :ownerId, :name, :description, :visibility, :now, :now)`,
    { id, ownerId: user.id, name: name.slice(0, 120), description: description.slice(0, 1000), visibility, now }
  );
  return present(db.get('SELECT * FROM playlists WHERE id = :id', { id }), { viewer: user });
}

function findById(id) {
  return db.get('SELECT * FROM playlists WHERE id = :id', { id });
}

/** Get a playlist with its videos, respecting each video's own visibility. */
function get(playlistId, viewer) {
  const playlist = findById(playlistId);
  if (!playlist || !canView(playlist, viewer)) {
    throw errors.notFound('Playlist not found.');
  }

  const rows = db.all(
    `SELECT v.*, c.handle AS channel_handle, c.name AS channel_name,
            c.avatar_url AS channel_avatar, c.follower_count AS channel_followers,
            s.title AS sound_title, s.artist AS sound_artist, pi.position
       FROM playlist_items pi
       JOIN videos v ON v.id = pi.video_id
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN sounds s ON s.id = v.sound_id
      WHERE pi.playlist_id = :id AND v.deleted_at IS NULL
      ORDER BY pi.position ASC`,
    { id: playlistId }
  );

  // A private video inside a public playlist stays private — the playlist does
  // not grant access to its contents.
  const visible = rows.filter((row) => videos.canView(row, viewer).allowed);

  return present(playlist, {
    viewer,
    items: visible.map((r) => videos.present(r, { viewer })),
  });
}

function update(playlistId, viewer, fields) {
  const playlist = findById(playlistId);
  if (!playlist) throw errors.notFound('Playlist not found.');
  if (playlist.owner_id !== viewer.id) throw errors.forbidden('That is not your playlist.');

  const columns = {
    name: fields.name,
    description: fields.description,
    visibility: fields.visibility && VISIBILITIES.includes(fields.visibility) ? fields.visibility : undefined,
  };

  const sets = [];
  const params = { id: playlistId, now: new Date().toISOString() };
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    sets.push(`${column} = :${column}`);
    params[column] = value;
  }
  if (!sets.length) return present(playlist, { viewer });

  db.run(`UPDATE playlists SET ${sets.join(', ')}, updated_at = :now WHERE id = :id`, params);
  return present(findById(playlistId), { viewer });
}

function remove(playlistId, viewer) {
  const playlist = findById(playlistId);
  if (!playlist) throw errors.notFound('Playlist not found.');
  if (playlist.owner_id !== viewer.id) throw errors.forbidden('That is not your playlist.');

  db.run('DELETE FROM playlists WHERE id = :id', { id: playlistId });
  return { deleted: true };
}

/** Append a video. New items go to the end. */
function addVideo({ playlistId, videoId, viewer }) {
  const playlist = findById(playlistId);
  if (!playlist) throw errors.notFound('Playlist not found.');
  if (playlist.owner_id !== viewer.id) throw errors.forbidden('That is not your playlist.');

  const video = videos.findById(videoId);
  if (!video || !videos.canView(video, viewer).allowed) {
    throw errors.notFound('Video not found.');
  }

  const existing = db.get(
    'SELECT 1 AS e FROM playlist_items WHERE playlist_id = :p AND video_id = :v',
    { p: playlistId, v: videoId }
  );
  if (existing) return { added: false, reason: 'already_in_playlist' };

  const max = db.get(
    'SELECT COALESCE(MAX(position), -1) AS max FROM playlist_items WHERE playlist_id = :p',
    { p: playlistId }
  );

  db.tx(() => {
    db.run(
      `INSERT INTO playlist_items (playlist_id, video_id, position, added_at)
       VALUES (:p, :v, :position, :now)`,
      { p: playlistId, v: videoId, position: max.max + 1, now: new Date().toISOString() }
    );
    db.run('UPDATE playlists SET video_count = video_count + 1, updated_at = :now WHERE id = :p',
      { p: playlistId, now: new Date().toISOString() });
  });

  return { added: true };
}

function removeVideo({ playlistId, videoId, viewer }) {
  const playlist = findById(playlistId);
  if (!playlist) throw errors.notFound('Playlist not found.');
  if (playlist.owner_id !== viewer.id) throw errors.forbidden('That is not your playlist.');

  db.tx(() => {
    const result = db.run('DELETE FROM playlist_items WHERE playlist_id = :p AND video_id = :v',
      { p: playlistId, v: videoId });
    if (result.changes) {
      db.run('UPDATE playlists SET video_count = MAX(0, video_count - 1), updated_at = :now WHERE id = :p',
        { p: playlistId, now: new Date().toISOString() });
    }
  });

  return { removed: true };
}

/** Reorder by supplying the full ordered list of video ids. */
function reorder({ playlistId, viewer, videoIds }) {
  const playlist = findById(playlistId);
  if (!playlist) throw errors.notFound('Playlist not found.');
  if (playlist.owner_id !== viewer.id) throw errors.forbidden('That is not your playlist.');

  db.tx(() => {
    videoIds.forEach((videoId, index) => {
      db.run('UPDATE playlist_items SET position = :pos WHERE playlist_id = :p AND video_id = :v',
        { pos: index, p: playlistId, v: videoId });
    });
    db.run('UPDATE playlists SET updated_at = :now WHERE id = :p',
      { p: playlistId, now: new Date().toISOString() });
  });

  return { reordered: true };
}

/** A user's playlists. Visitors see only the public ones. */
function listForUser(ownerId, viewer) {
  const isOwner = viewer && viewer.id === ownerId;
  return db.all(
    `SELECT * FROM playlists
      WHERE owner_id = :ownerId AND (:isOwner = 1 OR visibility = 'public')
      ORDER BY updated_at DESC`,
    { ownerId, isOwner: isOwner ? 1 : 0 }
  ).map((p) => present(p, { viewer }));
}

/** Videos the user saved — rendered as a built-in playlist in the Library. */
function savedVideos(userId, { limit = 50, cursor = 0 } = {}) {
  const rows = db.all(
    `SELECT v.*, c.handle AS channel_handle, c.name AS channel_name,
            c.avatar_url AS channel_avatar, c.follower_count AS channel_followers,
            s.title AS sound_title, s.artist AS sound_artist
       FROM saves sv
       JOIN videos v ON v.id = sv.video_id
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN sounds s ON s.id = v.sound_id
      WHERE sv.user_id = :id AND v.deleted_at IS NULL
      ORDER BY sv.created_at DESC LIMIT :limit OFFSET :cursor`,
    { id: userId, limit, cursor }
  );
  return rows.map((r) => videos.present(r, { viewer: { id: userId } }));
}

module.exports = {
  VISIBILITIES, present, canView, create, findById, get, update, remove,
  addVideo, removeVideo, reorder, listForUser, savedVideos,
};
