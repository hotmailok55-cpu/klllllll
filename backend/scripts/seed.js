'use strict';

/**
 * DEVELOPMENT SEED SCRIPT.
 *
 *   node scripts/seed.js
 *
 * Creates a believable small platform: a handful of creators of very different
 * sizes, videos with different quality profiles, sounds, follows and comments.
 *
 * It deliberately includes a BIG creator with a mediocre video and a TINY
 * creator with an excellent one, so you can open the feed and see the fairness
 * logic working rather than taking the tests' word for it.
 *
 * Every video gets a real, playable MP4 generated with ffmpeg when available,
 * so the feed is genuinely watchable in development.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const db = require('../src/core/db');
const registry = require('../src/integrations/registry');
const analytics = require('../src/services/analytics');
const users = require('../src/services/users');
const channels = require('../src/services/channels');
const sounds = require('../src/services/sounds');
const videosService = require('../src/services/videos');
const comments = require('../src/services/comments');
const recommendations = require('../src/services/recommendations');
const { logger } = require('../src/core/logger');

const CREATORS = [
  { username: 'maya', displayName: 'Maya', followers: 42000, bio: 'Cooking things that take 60 seconds.' },
  { username: 'devkid', displayName: 'Dev Kid', followers: 3, bio: 'Learning to code in public.' },
  { username: 'roblox850', displayName: 'Louis', followers: 34, bio: 'Roblox clips and baseball.' },
  { username: 'astro', displayName: 'Astro Notes', followers: 780, bio: 'Space, explained fast.' },
  { username: 'bigstudio', displayName: 'Big Studio', followers: 512000, bio: 'We post a lot.' },
];

const VIDEOS = [
  // creator, title, category, and a "quality" profile that drives the fake
  // watch data so the feed behaves realistically.
  { by: 'devkid', title: 'I built my first app today', category: 'technology', quality: 'excellent', views: 60 },
  { by: 'devkid', title: 'Why my code broke at 2am', category: 'technology', quality: 'good', views: 30 },
  { by: 'maya', title: '60 second garlic noodles', category: 'food', quality: 'excellent', views: 24000 },
  { by: 'maya', title: 'The trick to crispy tofu', category: 'food', quality: 'good', views: 9800 },
  { by: 'roblox850', title: 'Roblox dancing', category: 'gaming', quality: 'good', views: 445 },
  { by: 'roblox850', title: 'Best baseball plays this week', category: 'sports', quality: 'average', views: 120 },
  { by: 'astro', title: 'What a black hole actually does', category: 'science', quality: 'excellent', views: 3400 },
  { by: 'astro', title: 'Why Mars is red', category: 'science', quality: 'good', views: 1900 },
  { by: 'bigstudio', title: 'YOU WONT BELIEVE THIS', category: 'comedy', quality: 'poor', views: 890000 },
  { by: 'bigstudio', title: 'Top 10 things (number 7 shocked us)', category: 'comedy', quality: 'poor', views: 640000 },
  { by: 'bigstudio', title: 'Another daily upload', category: 'comedy', quality: 'average', views: 210000 },
];

// completion rate, and how many viewers bounce immediately
const QUALITY_PROFILES = {
  excellent: { completion: 0.93, skipRate: 0.04, likeRate: 0.14, saveRate: 0.05 },
  good:      { completion: 0.71, skipRate: 0.12, likeRate: 0.07, saveRate: 0.02 },
  average:   { completion: 0.44, skipRate: 0.28, likeRate: 0.03, saveRate: 0.008 },
  poor:      { completion: 0.09, skipRate: 0.68, likeRate: 0.004, saveRate: 0.0004 },
};

const COMMENTS = [
  'this is actually so helpful', 'wait how did you do that', 'first!',
  'saving this for later', 'the editing on this is clean',
  'I tried this and it worked', 'more like this please', 'underrated creator fr',
];

async function main() {
  db.connect();
  db.migrate();
  analytics.install();
  registry.initialize();

  const existing = db.get('SELECT COUNT(*) AS c FROM users');
  if (existing.c > 0) {
    console.log('\n  The database already has data. Delete data/platform.db first to reseed.\n');
    process.exit(0);
  }

  console.log('\n  Seeding Loop…\n');

  const hasFfmpeg = await checkFfmpeg();
  if (!hasFfmpeg) {
    console.log('  ffmpeg not found — seeding metadata only (videos will not play).');
  }

  const storage = registry.get('storage');
  const byUsername = new Map();

  // --- Creators ---
  for (const spec of CREATORS) {
    const { user } = users.register({
      username: spec.username,
      email: `${spec.username}@example.com`,
      password: 'password-for-development',
      displayName: spec.displayName,
    });
    const channel = channels.findByOwner(user.id);

    db.run('UPDATE channels SET follower_count = :followers, description = :bio WHERE id = :id',
      { followers: spec.followers, bio: spec.bio, id: channel.id });
    db.run('UPDATE users SET bio = :bio, email_verified = 1 WHERE id = :id',
      { bio: spec.bio, id: user.id });

    byUsername.set(spec.username, { user, channel });
    console.log(`  creator  @${spec.username} (${spec.followers.toLocaleString()} followers)`);
  }

  // Make the first account an admin so the admin dashboard is reachable.
  const admin = byUsername.get('maya');
  db.run(`UPDATE users SET role = 'admin' WHERE id = :id`, { id: admin.user.id });
  console.log(`  admin    @maya can open /#/admin`);

  // --- Videos ---
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-seed-'));
  const created = [];

  for (const spec of VIDEOS) {
    const { user, channel } = byUsername.get(spec.by);
    const videoId = db.newId('vid');
    const now = new Date();
    // Spread uploads over the past week so freshness scoring has something to do.
    const published = new Date(now.getTime() - Math.random() * 7 * 86400_000);

    let storageKey = null;
    let thumbnailKey = null;
    const durationMs = 8000 + Math.floor(Math.random() * 12000);

    if (hasFfmpeg) {
      const generated = await generateVideo(workDir, videoId, spec.title, durationMs);
      if (generated) {
        storageKey = `videos/${videoId}/original.mp4`;
        await storage.put(storageKey, fs.readFileSync(generated.video), { contentType: 'video/mp4' });
        thumbnailKey = `thumbnails/${videoId}/auto.jpg`;
        await storage.put(thumbnailKey, fs.readFileSync(generated.thumb), { contentType: 'image/jpeg' });
        fs.rmSync(generated.video, { force: true });
        fs.rmSync(generated.thumb, { force: true });
      }
    }

    db.run(
      `INSERT INTO videos (id, channel_id, creator_id, title, description, category, kind,
                           storage_key, thumbnail_key, duration_ms, width, height,
                           visibility, processing_status, copyright_status, moderation_status,
                           published_at, created_at, updated_at)
       VALUES (:id, :channelId, :creatorId, :title, :description, :category, 'short',
               :storageKey, :thumbnailKey, :duration, 720, 1280,
               'public', 'ready', 'clear', 'approved', :published, :published, :now)`,
      {
        id: videoId, channelId: channel.id, creatorId: user.id,
        title: spec.title,
        description: `${spec.title} — posted by @${spec.by}.`,
        category: spec.category,
        storageKey, thumbnailKey, duration: durationMs,
        published: published.toISOString(), now: now.toISOString(),
      }
    );

    db.run('UPDATE channels SET video_count = video_count + 1 WHERE id = :id', { id: channel.id });

    // Every video gets its own reusable "original sound".
    const video = db.get('SELECT * FROM videos WHERE id = :id', { id: videoId });
    sounds.createOriginalSound({ video, creatorName: byUsername.get(spec.by).user.username });

    // --- Fake engagement matching the quality profile ---
    seedEngagement(video, spec, published);

    created.push({ videoId, spec });
    console.log(`  video    "${spec.title}" (${spec.quality}, ${spec.views.toLocaleString()} views)`);
  }

  fs.rmSync(workDir, { recursive: true, force: true });

  // --- Viewers, follows and comments ---
  const viewers = [];
  for (let i = 1; i <= 6; i++) {
    const { user } = users.register({
      username: `viewer${i}`,
      email: `viewer${i}@example.com`,
      password: 'password-for-development',
      displayName: `Viewer ${i}`,
    });
    viewers.push(user);
    recommendations.setOnboardingInterests(user.id,
      ['technology', 'food', 'gaming', 'science', 'comedy'].slice(0, 2 + (i % 3)));
  }

  for (const viewer of viewers) {
    for (const spec of CREATORS) {
      if (Math.random() < 0.4) {
        const { channel } = byUsername.get(spec.username);
        try { channels.toggleFollow({ channelId: channel.id, user: viewer }); } catch { /* ignore */ }
      }
    }
  }

  for (const { videoId, spec } of created) {
    const profile = QUALITY_PROFILES[spec.quality];
    const commentCount = Math.max(0, Math.round(profile.likeRate * 40));
    for (let i = 0; i < Math.min(commentCount, 5); i++) {
      const viewer = viewers[Math.floor(Math.random() * viewers.length)];
      try {
        await comments.create({
          videoId, user: viewer,
          body: COMMENTS[Math.floor(Math.random() * COMMENTS.length)],
        });
      } catch { /* moderation may reject; that is fine */ }
    }
  }

  console.log(`
  Done.

    Creators   ${CREATORS.length}
    Videos     ${VIDEOS.length}
    Viewers    ${viewers.length}

  Sign in with any of these (password: password-for-development):

    maya@example.com        big food creator, ALSO ADMIN
    devkid@example.com      3 followers, excellent videos
    bigstudio@example.com   512k followers, poor retention

  Start the server:   npm start
  Then open:          http://localhost:${process.env.PORT || 4000}

  Watch for: @devkid's videos should appear high in the feed despite having
  almost no followers, because people finish them. @bigstudio's should sink
  despite huge view counts, because people bounce off them.
`);

  db.close();
}

/**
 * Generate fake engagement consistent with the quality profile.
 * This is what makes the seeded feed behave like a real one.
 */
function seedEngagement(video, spec, published) {
  const profile = QUALITY_PROFILES[spec.quality];
  // Sample the watch sessions rather than writing 890,000 rows.
  const sessions = Math.min(spec.views, 300);
  const scale = spec.views / sessions;

  for (let i = 0; i < sessions; i++) {
    const skipped = Math.random() < profile.skipRate;
    const completion = skipped
      ? Math.random() * 0.1
      : Math.min(1.2, profile.completion + (Math.random() - 0.5) * 0.25);
    const watchMs = Math.round(video.duration_ms * completion);
    const at = new Date(published.getTime() + Math.random() * (Date.now() - published.getTime()));

    db.run(
      `INSERT INTO watch_events (id, video_id, user_id, viewer_key, watch_ms, duration_ms,
                                 completion, replayed, skipped_fast, created_at)
       VALUES (:id, :videoId, NULL, :key, :watchMs, :duration, :completion, :replayed, :skipped, :at)`,
      {
        id: db.newId('wev'), videoId: video.id, key: `seed-${video.id}-${i}`,
        watchMs, duration: video.duration_ms, completion,
        replayed: !skipped && Math.random() < 0.15 ? 1 : 0,
        skipped: skipped ? 1 : 0,
        at: at.toISOString(),
      }
    );

    if (!skipped) {
      db.run(
        `INSERT INTO view_events (id, video_id, user_id, viewer_key, watch_ms, source, created_at)
         VALUES (:id, :videoId, NULL, :key, :watchMs, 'feed', :at)`,
        { id: db.newId('vev'), videoId: video.id, key: `seed-${video.id}-${i}`, watchMs, at: at.toISOString() }
      );
    }
  }

  db.run(
    `UPDATE videos SET view_count = :views, like_count = :likes, dislike_count = :dislikes,
                       share_count = :shares, save_count = :saves,
                       total_watch_ms = :watchMs
      WHERE id = :id`,
    {
      id: video.id,
      views: spec.views,
      likes: Math.round(spec.views * profile.likeRate),
      dislikes: Math.round(spec.views * profile.likeRate * 0.1),
      shares: Math.round(spec.views * profile.saveRate * 0.5),
      saves: Math.round(spec.views * profile.saveRate),
      watchMs: Math.round(spec.views * video.duration_ms * profile.completion * scale / scale),
    }
  );

  db.run('UPDATE channels SET total_views = total_views + :views WHERE id = :id',
    { views: spec.views, id: video.channel_id });
}

/** Generate a short, real, playable MP4 with a title card. */
async function generateVideo(workDir, videoId, title, durationMs) {
  const videoPath = path.join(workDir, `${videoId}.mp4`);
  const thumbPath = path.join(workDir, `${videoId}.jpg`);
  const seconds = (durationMs / 1000).toFixed(1);

  // A moving gradient so the feed does not look like a wall of static colour.
  const hue = Math.floor(Math.random() * 360);
  const filter =
    `color=c=0x${hslToHex(hue)}:s=720x1280:d=${seconds},` +
    `drawbox=x=0:y=0:w=720:h=1280:color=black@0.25:t=fill,` +
    `drawtext=text='${escapeDrawText(title)}':fontcolor=white:fontsize=48:` +
    `x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12`;

  const ok = await runCommand('ffmpeg', [
    '-f', 'lavfi', '-i', filter,
    '-f', 'lavfi', '-i', `sine=frequency=${220 + Math.floor(Math.random() * 300)}:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
    '-t', seconds, '-y', videoPath,
  ]);
  if (!ok) return null;

  await runCommand('ffmpeg', ['-i', videoPath, '-frames:v', '1', '-q:v', '4', '-y', thumbPath]);
  return { video: videoPath, thumb: thumbPath };
}

function escapeDrawText(text) {
  return String(text).replace(/[':\\]/g, '').slice(0, 40);
}

function hslToHex(hue) {
  // Rough HSL(hue, 60%, 45%) -> hex, enough for a pleasant background.
  const h = hue / 360, s = 0.6, l = 0.45;
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const proc = spawn(command, args);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

function checkFfmpeg() {
  return runCommand('ffmpeg', ['-version']);
}

main().catch((err) => {
  logger.error('seed', 'failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
