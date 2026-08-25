'use strict';

/**
 * SEARCH SERVICE (spec §19, §52).
 *
 * Not a title LIKE query. Results are RANKED on several signals:
 *
 *   text relevance  where the match happened (title beats tags beats description)
 *   popularity      dampened with log() so big videos do not own every query
 *   freshness       recent content surfaces
 *   engagement      as rates, not totals — same fairness rule as the feed
 *
 * Searches across videos, channels, and sounds, each with its own ranking, then
 * exposes them separately so the UI can show tabbed results.
 *
 * SCALING NOTE: this uses SQL LIKE, which is honest and correct but does a
 * table scan. When the catalogue grows, move to SQLite FTS5 or a search engine
 * — the ranking functions below stay exactly as they are, only `findCandidates`
 * changes.
 */

const db = require('../core/db');
const videos = require('./videos');
const channels = require('./channels');
const sounds = require('./sounds');

/** Full search across every entity type. */
function search({ query, viewer = null, type = 'all', filters = {}, limit = 20 }) {
  const q = String(query || '').trim();
  if (!q) {
    return { query: q, videos: [], channels: [], sounds: [], total: 0 };
  }

  recordQuery({ userId: viewer?.id, query: q });

  const result = { query: q, videos: [], channels: [], sounds: [] };

  if (type === 'all' || type === 'video') {
    result.videos = searchVideos({ query: q, viewer, filters, limit });
  }
  if (type === 'all' || type === 'channel') {
    result.channels = searchChannels({ query: q, viewer, limit: type === 'all' ? 5 : limit });
  }
  if (type === 'all' || type === 'sound') {
    result.sounds = searchSounds({ query: q, limit: type === 'all' ? 5 : limit });
  }

  result.total = result.videos.length + result.channels.length + result.sounds.length;

  // Update the recorded result count, so we can find queries that return
  // nothing and improve them.
  db.run(
    `UPDATE search_queries SET results = :results
      WHERE id = (SELECT id FROM search_queries
                   WHERE query = :query AND (:userId IS NULL OR user_id = :userId)
                   ORDER BY created_at DESC LIMIT 1)`,
    { results: result.total, query: q, userId: viewer?.id || null }
  );

  return result;
}

/** Search and rank videos. */
function searchVideos({ query, viewer, filters = {}, limit = 20 }) {
  const like = `%${query}%`;

  // Filters (spec §52).
  const conditions = [];
  const params = { like, limit: limit * 3 };

  if (filters.category) {
    conditions.push('v.category = :category');
    params.category = filters.category;
  }
  if (filters.kind) {
    conditions.push('v.kind = :kind');
    params.kind = filters.kind;
  }
  if (filters.uploadedAfter) {
    conditions.push('v.published_at > :after');
    params.after = filters.uploadedAfter;
  }
  if (filters.maxDurationMs) {
    conditions.push('v.duration_ms <= :maxDuration');
    params.maxDuration = filters.maxDurationMs;
  }
  if (filters.minDurationMs) {
    conditions.push('v.duration_ms >= :minDuration');
    params.minDuration = filters.minDurationMs;
  }

  const extra = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  // Fetch a wider candidate set than we need, then rank in JS where the logic
  // is readable and testable.
  const candidates = db.all(
    `SELECT v.*, c.handle AS channel_handle, c.name AS channel_name,
            c.avatar_url AS channel_avatar, c.follower_count AS channel_followers,
            s.title AS sound_title, s.artist AS sound_artist
       FROM videos v
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN sounds s ON s.id = v.sound_id
      WHERE v.visibility = 'public' AND v.processing_status = 'ready'
        AND v.deleted_at IS NULL AND c.status = 'active'
        AND v.moderation_status IN ('approved','pending')
        AND v.copyright_status NOT IN ('block','restrict')
        AND (v.title LIKE :like OR v.description LIKE :like
             OR v.tags LIKE :like OR c.name LIKE :like)
        ${extra}
      LIMIT :limit`,
    params
  );

  return candidates
    .map((v) => ({ video: v, score: scoreVideo(v, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ video }) => videos.present(video, { viewer }));
}

/**
 * Rank one video against a query.
 * Each term is separate and commented so the ranking can be reasoned about.
 */
function scoreVideo(video, query) {
  const q = query.toLowerCase();
  const title = (video.title || '').toLowerCase();
  const description = (video.description || '').toLowerCase();
  const tags = (video.tags || '').toLowerCase();
  const channel = (video.channel_name || '').toLowerCase();

  // --- 1. TEXT RELEVANCE. Where the match is matters a lot. ---
  let relevance = 0;
  if (title === q) relevance += 12;                    // exact title
  else if (title.startsWith(q)) relevance += 8;        // title starts with it
  else if (title.includes(q)) relevance += 6;          // title contains it
  if (tags.includes(q)) relevance += 4;                // tagged
  if (channel.includes(q)) relevance += 3;             // creator name
  if (description.includes(q)) relevance += 1.5;       // buried in description

  // Multi-word queries: reward matching more of the words.
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  if (words.length > 1) {
    const matched = words.filter((w) => title.includes(w) || tags.includes(w)).length;
    relevance += (matched / words.length) * 4;
  }

  // Nothing matched anywhere meaningful.
  if (relevance === 0) return 0;

  // --- 2. POPULARITY, log-dampened. ---
  // log10 so 1M views is worth ~6 and 100 views ~2 — a real advantage, not an
  // insurmountable one. A perfect title match on a small video still wins.
  const popularity = Math.log10(1 + video.view_count);

  // --- 3. ENGAGEMENT, as a rate. ---
  const views = Math.max(video.view_count, 1);
  const engagement = Math.min(
    (video.like_count / views) * 5 + (video.comment_count / views) * 8, 2
  );

  // --- 4. FRESHNESS. Gentle: relevance should dominate a search. ---
  const ageDays = video.published_at
    ? (Date.now() - new Date(video.published_at).getTime()) / 86400_000
    : 999;
  const freshness = Math.max(0, 1 - ageDays / 365);

  return relevance * 3 + popularity * 1.2 + engagement * 1.5 + freshness * 1.0;
}

function searchChannels({ query, viewer, limit = 10 }) {
  const like = `%${query}%`;
  const candidates = db.all(
    `SELECT * FROM channels
      WHERE status = 'active'
        AND (name LIKE :like OR handle LIKE :like OR description LIKE :like)
      LIMIT :limit`,
    { like, limit: limit * 3 }
  );

  return candidates
    .map((c) => {
      const q = query.toLowerCase();
      const name = (c.name || '').toLowerCase();
      const handle = (c.handle || '').toLowerCase();

      let relevance = 0;
      if (handle === q || name === q) relevance += 12;
      else if (handle.startsWith(q) || name.startsWith(q)) relevance += 8;
      else if (handle.includes(q) || name.includes(q)) relevance += 5;
      else if ((c.description || '').toLowerCase().includes(q)) relevance += 1;

      // Followers help, log-damped, and only if the name already matched.
      const popularity = Math.log10(1 + c.follower_count);
      // A channel with no videos is not a useful result.
      const active = c.video_count > 0 ? 1 : 0;

      return { channel: c, score: relevance * 3 + popularity + active * 2 };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ channel }) => channels.present(channel, { viewer }));
}

function searchSounds({ query, limit = 10 }) {
  const like = `%${query}%`;
  return db.all(
    `SELECT * FROM sounds
      WHERE (title LIKE :like OR artist LIKE :like)
        AND (source = 'original' OR rights_status = 'cleared')
      ORDER BY use_count DESC LIMIT :limit`,
    { like, limit }
  ).map((s) => sounds.present(s, { includeRights: true }));
}

/**
 * Autocomplete suggestions (spec §52).
 * Built from real video titles, channel handles, and what people have actually
 * searched for — no separate suggestion corpus to maintain.
 */
function suggest({ query, limit = 8 }) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const like = `${q}%`;
  const contains = `%${q}%`;
  const suggestions = new Set();

  // Popular past searches that start with this prefix.
  for (const row of db.all(
    `SELECT query, COUNT(*) AS uses FROM search_queries
      WHERE query LIKE :like AND results > 0
      GROUP BY query ORDER BY uses DESC LIMIT :limit`,
    { like, limit }
  )) suggestions.add(row.query);

  // Channel handles.
  for (const row of db.all(
    `SELECT handle FROM channels WHERE handle LIKE :like AND status='active' AND video_count > 0
      ORDER BY follower_count DESC LIMIT 3`,
    { like }
  )) suggestions.add(`@${row.handle}`);

  // Video titles.
  for (const row of db.all(
    `SELECT title FROM videos
      WHERE title LIKE :contains AND visibility='public' AND processing_status='ready'
        AND deleted_at IS NULL
      ORDER BY view_count DESC LIMIT :limit`,
    { contains, limit }
  )) suggestions.add(row.title);

  return [...suggestions].slice(0, limit);
}

function recordQuery({ userId, query }) {
  db.run(
    `INSERT INTO search_queries (id, user_id, query, results, created_at)
     VALUES (:id, :userId, :query, 0, :now)`,
    { id: db.newId('sq'), userId: userId || null, query, now: new Date().toISOString() }
  );
}

/** A user's recent searches, for the search screen. */
function recentSearches(userId, { limit = 8 } = {}) {
  if (!userId) return [];
  return db.all(
    `SELECT DISTINCT query FROM search_queries
      WHERE user_id = :id ORDER BY created_at DESC LIMIT :limit`,
    { id: userId, limit }
  ).map((r) => r.query);
}

function clearHistory(userId) {
  db.run('DELETE FROM search_queries WHERE user_id = :id', { id: userId });
  return { cleared: true };
}

module.exports = {
  search, searchVideos, searchChannels, searchSounds,
  suggest, recentSearches, clearHistory, scoreVideo,
};
