'use strict';

/**
 * VIDEO PROCESSING PIPELINE (spec §10, §11).
 *
 * Runs entirely in background workers — never inside a web request.
 *
 *   video.process
 *     -> probe metadata (duration, dimensions)
 *     -> generate thumbnail
 *     -> transcode to the appropriate ladder of qualities
 *     -> copyright check      (its own job, so it can fail independently)
 *     -> safety/moderation    (same)
 *     -> mark ready
 *
 * TRANSCODING NOTE
 * Real transcoding needs ffmpeg, which is an external binary and a deployment
 * decision, so it is behind a capability check. When ffmpeg is present we build
 * a real quality ladder. When it is absent the pipeline still completes and the
 * original file plays — the platform works out of the box and gets better when
 * you install ffmpeg, rather than being broken until you do.
 */

const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const db = require('../core/db');
const queue = require('../core/queue');
const registry = require('../integrations/registry');
const uploads = require('./uploads');
const { EVENTS, publish } = require('../core/events');
const { logger } = require('../core/logger');

/**
 * The quality ladder. We only generate renditions at or below the source
 * resolution — upscaling wastes storage and helps nobody. (spec §11)
 */
const QUALITY_LADDER = [
  { quality: '360p', height: 360, bitrate: 800_000 },
  { quality: '480p', height: 480, bitrate: 1_400_000 },
  { quality: '720p', height: 720, bitrate: 2_800_000 },
  { quality: '1080p', height: 1080, bitrate: 5_000_000 },
  { quality: '1440p', height: 1440, bitrate: 10_000_000 },
  { quality: '2160p', height: 2160, bitrate: 20_000_000 },
];

let ffmpegAvailable = null; // cached capability probe

/** Is ffmpeg installed on this machine? Probed once. */
async function hasFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  ffmpegAvailable = await new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
  logger.info('processing', `ffmpeg ${ffmpegAvailable ? 'available' : 'not available'}`);
  if (!ffmpegAvailable) {
    logger.warn('processing',
      'Videos will be served in their original quality only. Install ffmpeg to enable multi-quality transcoding and generated thumbnails.');
  }
  return ffmpegAvailable;
}

/** Run a command, capturing stderr for diagnostics. */
function run(command, args, { timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * MAIN PIPELINE JOB.
 * Registered as 'video.process'.
 */
async function processVideo({ videoId }) {
  const video = db.get('SELECT * FROM videos WHERE id = :id', { id: videoId });
  if (!video) { logger.warn('processing', 'video vanished', { videoId }); return; }
  if (!video.storage_key) throw new Error('No uploaded file to process.');

  uploads.setStatus(videoId, 'processing');
  const storage = registry.get('storage');

  // Work on a local temp copy. With object storage this is a download; with
  // local storage it is effectively free.
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `loop-${videoId}-`));
  const localPath = path.join(workDir, 'source');

  try {
    const buffer = await storage.get(video.storage_key);
    await fs.writeFile(localPath, buffer);

    const ffmpeg = await hasFfmpeg();

    // --- Probe metadata ---
    let meta = { durationMs: video.duration_ms, width: video.width, height: video.height };
    if (ffmpeg) {
      try {
        meta = await probe(localPath);
      } catch (err) {
        logger.warn('processing', 'probe failed, continuing', { videoId, error: err.message });
      }
    }

    db.run(
      `UPDATE videos SET duration_ms = :duration, width = :width, height = :height, updated_at = :now
        WHERE id = :id`,
      {
        id: videoId,
        duration: meta.durationMs || 0,
        width: meta.width || null,
        height: meta.height || null,
        now: new Date().toISOString(),
      }
    );

    // --- Thumbnail ---
    if (ffmpeg && !video.thumbnail_key) {
      try {
        const key = await generateThumbnail({ videoId, localPath, workDir, meta });
        db.run('UPDATE videos SET thumbnail_key = :key WHERE id = :id', { id: videoId, key });
      } catch (err) {
        // A missing thumbnail is a cosmetic problem, not a reason to fail the
        // whole upload. The UI falls back to a poster frame from the player.
        logger.warn('processing', 'thumbnail failed', { videoId, error: err.message });
      }
    }

    // --- Transcode ---
    if (ffmpeg && meta.height) {
      try {
        const renditions = await transcodeLadder({ videoId, localPath, workDir, meta });
        db.run('UPDATE videos SET renditions = :r WHERE id = :id',
          { id: videoId, r: JSON.stringify(renditions) });
      } catch (err) {
        logger.warn('processing', 'transcode failed, serving original', {
          videoId, error: err.message,
        });
      }
    }

    publish(EVENTS.VIDEO_PROCESSED, { videoId, creatorId: video.creator_id });

    // --- Hand off to the check stages, each its own job so one can fail or be
    //     retried without redoing the expensive transcode. ---
    queue.enqueue('video.copyright', { videoId });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Read duration and dimensions with ffprobe. */
async function probe(localPath) {
  const { stderr } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=width,height',
    '-of', 'default=noprint_wrappers=1', localPath,
  ], { timeoutMs: 30_000 }).catch(async () => {
    // ffprobe writes to stdout; some builds need the fallback below.
    return { stderr: '' };
  });

  // ffprobe prints to stdout, so capture it properly instead.
  const output = await new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration:stream=width,height',
      '-of', 'default=noprint_wrappers=1', localPath,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', reject);
    proc.on('close', () => resolve(out));
  });

  const text = output || stderr;
  const duration = /duration=([\d.]+)/.exec(text);
  const width = /width=(\d+)/.exec(text);
  const height = /height=(\d+)/.exec(text);

  return {
    durationMs: duration ? Math.round(parseFloat(duration[1]) * 1000) : 0,
    width: width ? Number(width[1]) : null,
    height: height ? Number(height[1]) : null,
  };
}

/** Grab a frame from ~1 second in (or 10% through, for very short clips). */
async function generateThumbnail({ videoId, localPath, workDir, meta }) {
  const seekSeconds = meta.durationMs > 3000 ? 1 : (meta.durationMs / 1000) * 0.1;
  const outPath = path.join(workDir, 'thumb.jpg');

  await run('ffmpeg', [
    '-ss', String(seekSeconds), '-i', localPath,
    '-frames:v', '1', '-q:v', '3', '-y', outPath,
  ], { timeoutMs: 60_000 });

  const key = `thumbnails/${videoId}/auto.jpg`;
  await registry.get('storage').put(key, await fs.readFile(outPath), { contentType: 'image/jpeg' });
  return key;
}

/**
 * Build the quality ladder, never exceeding the source resolution.
 * Each rendition is uploaded and recorded so the player can switch between them.
 */
async function transcodeLadder({ videoId, localPath, workDir, meta }) {
  const targets = QUALITY_LADDER.filter((q) => q.height <= (meta.height || 0));
  // Always produce at least one rendition, even for a tiny source.
  if (!targets.length) targets.push(QUALITY_LADDER[0]);

  const storage = registry.get('storage');
  const renditions = [];

  for (const target of targets) {
    const outPath = path.join(workDir, `${target.quality}.mp4`);
    try {
      await run('ffmpeg', [
        '-i', localPath,
        // -2 keeps width even and preserves aspect ratio.
        '-vf', `scale=-2:${target.height}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-maxrate', String(target.bitrate), '-bufsize', String(target.bitrate * 2),
        '-c:a', 'aac', '-b:a', '128k',
        // Move the index to the front so playback can start before the whole
        // file has downloaded.
        '-movflags', '+faststart',
        '-y', outPath,
      ], { timeoutMs: 600_000 });

      const key = `videos/${videoId}/${target.quality}.mp4`;
      const data = await fs.readFile(outPath);
      await storage.put(key, data, { contentType: 'video/mp4' });
      renditions.push({ quality: target.quality, key, bitrate: target.bitrate, bytes: data.length });
      logger.info('processing', 'rendition ready', { videoId, quality: target.quality });
    } catch (err) {
      logger.warn('processing', 'rendition failed', {
        videoId, quality: target.quality, error: err.message,
      });
    }
  }
  return renditions;
}

/** Register every processing job handler. Called once at boot. */
function registerJobs() {
  queue.register('video.process', processVideo);

  // Copyright stage — delegates to the copyright service, which owns policy.
  queue.register('video.copyright', async ({ videoId }) => {
    await require('./copyright').checkVideo(videoId);
    queue.enqueue('video.moderate', { videoId });
  });

  // Safety stage — then the video becomes ready.
  queue.register('video.moderate', async ({ videoId }) => {
    await require('./moderation').reviewVideo(videoId);
    finalize(videoId);
  });

  // Periodic maintenance.
  queue.register('maintenance.decayInterests', async () => {
    require('./recommendations').decayInterests();
  });

  queue.register('maintenance.cleanSessions', async () => {
    const removed = db.run('DELETE FROM sessions WHERE expires_at < :now',
      { now: new Date().toISOString() });
    logger.info('maintenance', 'expired sessions removed', { count: removed.changes });
  });
}

/**
 * Mark the video ready.
 *
 * Note it becomes 'ready', not automatically public: publishing is the
 * creator's decision, made in the upload form. A video whose copyright result
 * is 'block' never becomes ready.
 */
function finalize(videoId) {
  const video = db.get('SELECT * FROM videos WHERE id = :id', { id: videoId });
  if (!video) return;

  if (video.copyright_status === 'block') {
    uploads.setStatus(videoId, 'failed',
      'This video could not be published because it matched protected content.');
    return;
  }

  uploads.setStatus(videoId, 'ready');
  db.run('UPDATE channels SET video_count = video_count + 1 WHERE id = :id',
    { id: video.channel_id });

  logger.info('processing', 'video ready', { videoId });
}

module.exports = {
  QUALITY_LADDER, processVideo, registerJobs, finalize, hasFfmpeg, probe,
};
