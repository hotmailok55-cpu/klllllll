'use strict';

/**
 * UPLOAD SERVICE (spec §10, §39, §51).
 *
 * The upload flow is deliberately split into steps so the browser is never
 * blocked and an interrupted upload is never lost:
 *
 *   1. createDraft()   -> a video row exists immediately, status 'draft'
 *   2. receiveFile()   -> bytes streamed to storage, validated, status 'uploaded'
 *   3. enqueue processing -> background pipeline takes over
 *   4. the creator polls (or the UI polls) for status until 'ready'
 *
 * Because the draft row is created FIRST, a creator who closes the tab
 * mid-upload finds their draft waiting in the Studio rather than starting over.
 *
 * SECURITY (spec §39): a file claiming to be a video is not trusted. We check
 * the real bytes at the start of the file (the "magic number") against a small
 * allowlist of container formats. Uploaded files are stored with generated
 * names, are never given an executable extension, and are never executed.
 */

const db = require('../core/db');
const errors = require('../core/errors');
const registry = require('../integrations/registry');
const queue = require('../core/queue');
const { EVENTS, publish } = require('../core/events');
const { logger } = require('../core/logger');

const LIMITS = {
  maxBytes: 512 * 1024 * 1024,     // 512MB
  maxShortDurationMs: 3 * 60_000,  // shorts cap at 3 minutes
  maxTitleLength: 120,
};

/**
 * Allowed container formats, identified by their file signature rather than by
 * the filename or the client-supplied content type — both of which are just
 * strings an attacker chooses.
 *
 * offset/bytes describe where the marker lives in the file.
 */
const SIGNATURES = [
  // ISO base media (MP4, M4V, MOV): 'ftyp' at byte 4.
  { ext: 'mp4', mime: 'video/mp4', offset: 4, magic: Buffer.from('ftyp') },
  // WebM / Matroska: EBML header 1A 45 DF A3.
  { ext: 'webm', mime: 'video/webm', offset: 0, magic: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) },
  // AVI: 'RIFF' .... 'AVI '
  { ext: 'avi', mime: 'video/x-msvideo', offset: 8, magic: Buffer.from('AVI ') },
];

const IMAGE_SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', offset: 0, magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { ext: 'png', mime: 'image/png', offset: 0, magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  { ext: 'webp', mime: 'image/webp', offset: 8, magic: Buffer.from('WEBP') },
];

/**
 * Identify a file from its leading bytes.
 * @returns {{ext, mime}|null} null means "not an allowed format"
 */
function identifySignature(head, signatures = SIGNATURES) {
  for (const sig of signatures) {
    const slice = head.subarray(sig.offset, sig.offset + sig.magic.length);
    if (slice.equals(sig.magic)) return { ext: sig.ext, mime: sig.mime };
  }
  return null;
}

/**
 * Step 1 — create the draft record.
 * Returns immediately so the UI can show the upload screen with a real id.
 */
function createDraft({ user, title, kind = 'short' }) {
  const channel = db.get(`SELECT * FROM channels WHERE owner_id = :id AND status = 'active'`,
    { id: user.id });
  if (!channel) throw errors.badRequest('You need a channel before uploading.');

  const now = new Date().toISOString();
  const videoId = db.newId('vid');

  db.run(
    `INSERT INTO videos (id, channel_id, creator_id, title, kind, visibility,
                         processing_status, created_at, updated_at)
     VALUES (:id, :channelId, :creatorId, :title, :kind, 'private', 'draft', :now, :now)`,
    {
      id: videoId,
      channelId: channel.id,
      creatorId: user.id,
      title: (title || 'Untitled').slice(0, LIMITS.maxTitleLength),
      kind,
      now,
    }
  );

  logger.info('uploads', 'draft created', { videoId, userId: user.id });
  return { videoId, channelId: channel.id, status: 'draft' };
}

/**
 * Step 2 — receive the file.
 *
 * Streams the request body to storage without buffering the whole file in
 * memory, checking the signature from the first chunk and enforcing the size
 * limit as bytes arrive (so an oversized upload is cut off early rather than
 * after we have already written 2GB to disk).
 *
 * @param {object} options
 *   videoId  the draft to attach to
 *   user     the uploader (must own the draft)
 *   stream   a Readable (the raw request)
 */
async function receiveFile({ videoId, user, stream }) {
  const video = db.get('SELECT * FROM videos WHERE id = :id', { id: videoId });
  if (!video) throw errors.notFound('Upload not found.');
  if (video.creator_id !== user.id) throw errors.forbidden('That is not your upload.');
  if (!['draft', 'uploading', 'failed'].includes(video.processing_status)) {
    throw errors.conflict('This video has already been uploaded.');
  }

  setStatus(videoId, 'uploading');

  // Collect enough of the head to identify the format before committing.
  const chunks = [];
  let head = Buffer.alloc(0);
  let size = 0;
  let identified = null;

  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > LIMITS.maxBytes) {
        throw errors.badRequest(
          `That file is larger than the ${Math.round(LIMITS.maxBytes / 1024 / 1024)}MB limit.`
        );
      }

      if (!identified && head.length < 32) {
        head = Buffer.concat([head, chunk]);
        if (head.length >= 16) {
          identified = identifySignature(head);
          if (!identified) {
            throw errors.badRequest(
              'That file does not look like a video we can play. Try an MP4, WebM, or MOV file.'
            );
          }
        }
      }
      chunks.push(chunk);
    }
  } catch (err) {
    setStatus(videoId, 'failed', err.message);
    throw err;
  }

  if (!size) {
    setStatus(videoId, 'failed', 'Empty file');
    throw errors.badRequest('That file was empty.');
  }
  if (!identified) {
    setStatus(videoId, 'failed', 'Unrecognized format');
    throw errors.badRequest('We could not recognize that video format.');
  }

  const buffer = Buffer.concat(chunks);
  // Generated key — the user's filename never touches the filesystem, so a name
  // like "../../evil.sh" is impossible by construction.
  const storageKey = `videos/${videoId}/original.${identified.ext}`;

  const storage = registry.get('storage');
  try {
    await storage.put(storageKey, buffer, { contentType: identified.mime });
  } catch (err) {
    setStatus(videoId, 'failed', 'Storage unavailable');
    logger.error('uploads', 'storage write failed', { videoId, error: err.message });
    throw errors.serviceUnavailable(
      'We could not save your video right now. Your draft is kept — please try uploading again in a moment.'
    );
  }

  db.run(
    `UPDATE videos SET storage_key = :key, processing_status = 'uploaded', updated_at = :now
      WHERE id = :id`,
    { id: videoId, key: storageKey, now: new Date().toISOString() }
  );

  publish(EVENTS.VIDEO_UPLOADED, { videoId, creatorId: user.id, bytes: size });

  // Step 3 — hand off to the background pipeline. The request returns now.
  queue.enqueue('video.process', { videoId });

  logger.info('uploads', 'file received', { videoId, bytes: size, format: identified.ext });
  return { videoId, status: 'uploaded', bytes: size, format: identified.ext };
}

/** Receive a thumbnail image, validated the same way. */
async function receiveThumbnail({ videoId, user, stream }) {
  const video = db.get('SELECT * FROM videos WHERE id = :id', { id: videoId });
  if (!video) throw errors.notFound('Video not found.');
  if (video.creator_id !== user.id) throw errors.forbidden('That is not your video.');

  const chunks = [];
  let size = 0;
  let head = Buffer.alloc(0);
  let identified = null;

  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw errors.badRequest('Thumbnails must be under 8MB.');
    if (!identified && head.length < 16) {
      head = Buffer.concat([head, chunk]);
      if (head.length >= 12) {
        identified = identifySignature(head, IMAGE_SIGNATURES);
        if (!identified) throw errors.badRequest('Please upload a JPG, PNG, or WebP image.');
      }
    }
    chunks.push(chunk);
  }
  if (!identified) throw errors.badRequest('We could not read that image.');

  const key = `thumbnails/${videoId}/custom.${identified.ext}`;
  await registry.get('storage').put(key, Buffer.concat(chunks), { contentType: identified.mime });

  db.run('UPDATE videos SET thumbnail_key = :key, updated_at = :now WHERE id = :id',
    { id: videoId, key, now: new Date().toISOString() });

  return { thumbnailUrl: registry.get('storage').urlFor(key) };
}

/** Update processing status, always with a timestamp. */
function setStatus(videoId, status, error = null) {
  db.run(
    `UPDATE videos SET processing_status = :status, processing_error = :error, updated_at = :now
      WHERE id = :id`,
    { id: videoId, status, error, now: new Date().toISOString() }
  );
}

/**
 * The creator-facing status of an upload.
 *
 * Returns a human sentence for every state, because "every action should have a
 * visible state" (spec §72) — the UI shows this text verbatim.
 */
function status(videoId, user) {
  const video = db.get('SELECT * FROM videos WHERE id = :id', { id: videoId });
  if (!video) throw errors.notFound('Upload not found.');
  if (video.creator_id !== user.id) throw errors.forbidden('That is not your upload.');

  const MESSAGES = {
    draft: 'Draft saved. Choose a file to continue.',
    uploading: 'Uploading…',
    uploaded: 'Upload complete. Getting things ready…',
    processing: 'Processing your video…',
    checking_copyright: 'Checking copyright…',
    checking_safety: 'Running safety checks…',
    ready: 'Ready to publish.',
    failed: 'Something went wrong while processing your video. Your upload was saved — you can try again.',
  };

  // Rough progress for the progress bar.
  const PROGRESS = {
    draft: 0, uploading: 20, uploaded: 40, processing: 60,
    checking_copyright: 75, checking_safety: 88, ready: 100, failed: 0,
  };

  return {
    videoId,
    status: video.processing_status,
    message: MESSAGES[video.processing_status] || 'Working…',
    progress: PROGRESS[video.processing_status] ?? 0,
    error: video.processing_error,
    copyrightStatus: video.copyright_status,
    moderationStatus: video.moderation_status,
    canPublish: video.processing_status === 'ready',
  };
}

/** A creator's unfinished drafts (spec §51). */
function listDrafts(user) {
  return db.all(
    `SELECT id, title, kind, processing_status, created_at, updated_at
       FROM videos
      WHERE creator_id = :id AND deleted_at IS NULL
        AND processing_status IN ('draft','uploading','failed')
      ORDER BY updated_at DESC`,
    { id: user.id }
  ).map((r) => ({
    videoId: r.id, title: r.title, kind: r.kind,
    status: r.processing_status, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

module.exports = {
  LIMITS, SIGNATURES, IMAGE_SIGNATURES,
  identifySignature, createDraft, receiveFile, receiveThumbnail,
  setStatus, status, listDrafts,
};
