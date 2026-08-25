'use strict';

/**
 * SOUND SERVICE — music and audio as a first-class object.
 *
 * This is what makes "use this sound" work: a sound is a shared entity, so
 * tapping the sound name on any video opens a page of every video using it, and
 * a creator can start a new video from that sound. Audio becomes its own
 * discovery surface rather than an attribute of one video.
 *
 * LICENSING RULE (spec §81)
 * A sound is only offered in the picker when `rights_status = 'cleared'`, or
 * when it is an ORIGINAL sound created on this platform (which we know the
 * rights position of, because a creator made it here). Everything else stays
 * 'unknown' and is not offered. Connecting a music API never by itself makes a
 * track usable — rights are asked for explicitly and recorded per track.
 */

const db = require('../core/db');
const errors = require('../core/errors');
const registry = require('../integrations/registry');
const { config } = require('../core/config');
const { logger } = require('../core/logger');

function present(row, { includeRights = false } = {}) {
  if (!row) return null;
  const storage = registry.get('storage');
  const base = {
    id: row.id,
    title: row.title,
    artist: row.artist,
    source: row.source,
    coverUrl: row.cover_url,
    durationMs: row.duration_ms,
    audioUrl: row.storage_key ? storage.urlFor(row.storage_key) : null,
    useCount: row.use_count,
    isOriginal: row.source === 'original',
    createdAt: row.created_at,
  };
  if (includeRights) {
    base.rightsStatus = row.rights_status;
    base.rightsNote = row.rights_note;
    base.usable = isUsable(row);
  }
  return base;
}

/**
 * May a creator attach this sound to a new video?
 * Original sounds made on this platform: yes. External tracks: only if a rights
 * check explicitly cleared them.
 */
function isUsable(row) {
  if (!row) return false;
  if (row.rights_status === 'blocked' || row.rights_status === 'restricted') return false;
  if (row.source === 'original') return true;
  return row.rights_status === 'cleared';
}

/**
 * Create the "original sound" that belongs to a video.
 * Every upload gets one, so any video's audio can be reused by other creators —
 * the mechanism behind trends forming on the platform itself.
 */
function createOriginalSound({ video, creatorName }) {
  const id = db.newId('snd');
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO sounds (id, title, artist, source, origin_video_id, storage_key,
                         duration_ms, rights_status, created_by, created_at, updated_at)
     VALUES (:id, :title, :artist, 'original', :videoId, :storageKey,
             :duration, 'cleared', :createdBy, :now, :now)`,
    {
      id,
      title: `Original sound - ${creatorName}`,
      artist: creatorName,
      videoId: video.id,
      // Points at the video file: the audio track is extracted on playback.
      // A processing step can split it into a standalone file later.
      storageKey: video.storage_key,
      duration: video.duration_ms,
      createdBy: video.creator_id,
      now,
    }
  );

  db.run('UPDATE videos SET sound_id = :soundId WHERE id = :id',
    { soundId: id, id: video.id });

  return db.get('SELECT * FROM sounds WHERE id = :id', { id });
}

function findById(id) {
  return db.get('SELECT * FROM sounds WHERE id = :id', { id });
}

/**
 * Search sounds. Looks in our own library first, then asks the music provider
 * if one is connected.
 *
 * External results are NOT written to the database until someone actually uses
 * one — and at that point we check rights first.
 */
async function search({ query, limit = 20 }) {
  const local = db.all(
    `SELECT * FROM sounds
      WHERE (title LIKE :like OR artist LIKE :like)
        AND rights_status IN ('cleared','unknown')
      ORDER BY use_count DESC LIMIT :limit`,
    { like: `%${query}%`, limit }
  ).map((r) => present(r, { includeRights: true }));

  // Only reach out if a provider is actually configured and enabled.
  if (!config.flags.MUSIC_API_ENABLED || !registry.isEnabled('music')) {
    return { local, external: [], providerConnected: false };
  }

  try {
    const provider = registry.get('music');
    const external = await provider.searchMusic({ query, limit });
    return {
      local,
      external: external.map((t) => ({
        ref: t.ref,
        title: t.title,
        artist: t.artist,
        durationMs: t.durationMs,
        coverUrl: t.coverUrl,
        previewUrl: t.previewUrl,
        source: 'provider',
        // Rights are unknown until asked for. The UI shows this as
        // "check availability" rather than offering it as usable.
        rightsStatus: 'unknown',
        usable: false,
      })),
      providerConnected: true,
    };
  } catch (err) {
    // A music API outage must not break the sound picker — local sounds still
    // work, so creators can keep posting.
    logger.warn('sounds', 'music provider search failed', { error: err.message });
    return { local, external: [], providerConnected: true, providerError: 'Search is unavailable right now.' };
  }
}

/**
 * Import an external track into our library, checking rights FIRST.
 *
 * This is the one place an external track becomes usable, and it refuses unless
 * the provider explicitly grants the usage.
 */
async function importFromProvider({ ref, user }) {
  if (!config.flags.MUSIC_API_ENABLED || !registry.isEnabled('music')) {
    throw errors.serviceUnavailable('The music library is not available right now.');
  }

  const existing = db.get(
    'SELECT * FROM sounds WHERE provider_ref = :ref AND provider IS NOT NULL', { ref });
  if (existing) return present(existing, { includeRights: true });

  const provider = registry.get('music');

  const metadata = await provider.getMetadata({ ref });
  if (!metadata) throw errors.notFound('That track was not found.');

  // THE RIGHTS CHECK. Explicit, per-track, per-usage.
  let rights = { state: 'unknown', note: '' };
  if (typeof provider.checkRights === 'function') {
    try {
      rights = await provider.checkRights({ ref, usage: 'short_form_video' });
    } catch (err) {
      logger.warn('sounds', 'rights check failed', { ref, error: err.message });
      rights = { state: 'unknown', note: 'Rights could not be confirmed.' };
    }
  }

  if (rights.state !== 'cleared') {
    // Record it so we do not ask again on every attempt, but do not offer it.
    throw errors.forbidden(
      rights.state === 'blocked'
        ? 'That track cannot be used on this platform.'
        : 'We could not confirm the rights for that track, so it is not available to use yet.'
    );
  }

  const id = db.newId('snd');
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO sounds (id, title, artist, source, provider, provider_ref, duration_ms,
                         cover_url, rights_status, rights_note, rights_checked_at,
                         created_by, created_at, updated_at)
     VALUES (:id, :title, :artist, 'provider', :provider, :ref, :duration,
             :cover, 'cleared', :note, :now, :createdBy, :now, :now)`,
    {
      id, title: metadata.title, artist: metadata.artist,
      provider: provider.providerName, ref,
      duration: metadata.durationMs || 0, cover: metadata.coverUrl,
      note: rights.note || '', createdBy: user.id, now,
    }
  );

  logger.info('sounds', 'imported from provider', { soundId: id, provider: provider.providerName });
  return present(db.get('SELECT * FROM sounds WHERE id = :id', { id }), { includeRights: true });
}

/** Attach a sound to a video, refusing anything not cleared for use. */
function attachToVideo({ videoId, soundId, user }) {
  const video = db.get('SELECT * FROM videos WHERE id = :id', { id: videoId });
  if (!video) throw errors.notFound('Video not found.');
  if (video.creator_id !== user.id) throw errors.forbidden('That is not your video.');

  const sound = findById(soundId);
  if (!sound) throw errors.notFound('Sound not found.');
  if (!isUsable(sound)) {
    throw errors.forbidden('That sound is not cleared for use on this platform.');
  }

  db.tx(() => {
    // Decrement the previous sound's counter if we are replacing one.
    if (video.sound_id && video.sound_id !== soundId) {
      db.run('UPDATE sounds SET use_count = MAX(0, use_count - 1) WHERE id = :id',
        { id: video.sound_id });
    }
    db.run('UPDATE videos SET sound_id = :soundId, updated_at = :now WHERE id = :id',
      { soundId, id: videoId, now: new Date().toISOString() });
    db.run('UPDATE sounds SET use_count = use_count + 1 WHERE id = :id', { id: soundId });
  });

  return present(findById(soundId), { includeRights: true });
}

/** Popular sounds — the "explore more sounds" surface. */
function listPopular({ limit = 20 } = {}) {
  return db.all(
    `SELECT * FROM sounds
      WHERE rights_status IN ('cleared','unknown')
        AND (source = 'original' OR rights_status = 'cleared')
      ORDER BY use_count DESC, created_at DESC LIMIT :limit`,
    { limit }
  ).map((r) => present(r, { includeRights: true }));
}

/**
 * Report usage back to the provider, where the agreement requires it.
 * Runs as a background job so playback is never blocked by it.
 */
async function reportUsage({ soundId, videoId, plays }) {
  const sound = findById(soundId);
  if (!sound?.provider || !sound.provider_ref) return { skipped: true };
  if (!registry.isEnabled('music')) return { skipped: true };

  const provider = registry.get('music');
  if (typeof provider.reportUsage !== 'function') return { skipped: true };

  return provider.reportUsage({ ref: sound.provider_ref, videoId, plays });
}

module.exports = {
  present, isUsable, createOriginalSound, findById, search,
  importFromProvider, attachToVideo, listPopular, reportUsage,
};
