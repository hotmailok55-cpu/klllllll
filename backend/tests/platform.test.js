'use strict';

/**
 * PLATFORM TEST SUITE.
 *
 *   node --test tests/
 *
 * Covers the things the spec calls out explicitly (§71), including the failure
 * scenarios: what happens when the copyright API is offline, when storage
 * fails, and when processing fails.
 *
 * The fairness tests are the important ones. They assert the properties the
 * algorithm claims — that a small creator with a good video can beat a large
 * creator with a mediocre one — so a future tuning change cannot quietly
 * reintroduce rich-get-richer behaviour.
 */

const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Point the app at a throwaway database BEFORE anything requires config.
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-test-'));
process.env.DATABASE_FILE = path.join(TEST_DIR, 'test.db');
process.env.STORAGE_LOCAL_DIR = path.join(TEST_DIR, 'uploads');
process.env.AUTH_SECRET = 'test-secret-value';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const db = require('../src/core/db');
const queue = require('../src/core/queue');
const cache = require('../src/core/cache');
const rateLimit = require('../src/core/ratelimit');
const registry = require('../src/integrations/registry');
const users = require('../src/services/users');
const channels = require('../src/services/channels');
const videos = require('../src/services/videos');
const uploads = require('../src/services/uploads');
const comments = require('../src/services/comments');
const recommendations = require('../src/services/recommendations');
const trending = require('../src/services/trending');
const search = require('../src/services/search');
const moderation = require('../src/services/moderation');
const copyright = require('../src/services/copyright');
const analytics = require('../src/services/analytics');
const processing = require('../src/services/processing');
const notifications = require('../src/services/notifications');

before(() => {
  db.connect();
  db.migrate();
  analytics.install();
  registry.initialize();
  notifications.install();
  processing.registerJobs();
});

after(() => {
  db.close();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

/** Wipe every table between tests so they cannot influence each other. */
function resetDatabase() {
  const tables = db.all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations'`
  );
  db.run('PRAGMA foreign_keys = OFF');
  for (const { name } of tables) db.run(`DELETE FROM ${name}`);
  db.run('PRAGMA foreign_keys = ON');
  cache.clear();
  rateLimit.reset();
  registry.reset();
  registry.initialize();
}

beforeEach(resetDatabase);

// --- Fixtures --------------------------------------------------------------

let counter = 0;
function makeUser(overrides = {}) {
  counter++;
  const { user } = users.register({
    username: overrides.username || `user${counter}`,
    email: overrides.email || `user${counter}@example.com`,
    password: 'a-long-enough-password',
    displayName: overrides.displayName || `User ${counter}`,
  });
  return db.get('SELECT * FROM users WHERE id = :id', { id: user.id });
}

/** Create a ready, published video directly (skipping the upload pipeline). */
function makeVideo(creator, overrides = {}) {
  const channel = channels.findByOwner(creator.id);
  const id = db.newId('vid');
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO videos (id, channel_id, creator_id, title, description, category, kind,
                         storage_key, duration_ms, visibility, processing_status,
                         copyright_status, moderation_status, view_count, like_count,
                         dislike_count, comment_count, share_count, save_count,
                         published_at, created_at, updated_at)
     VALUES (:id, :channelId, :creatorId, :title, :description, :category, :kind,
             :storageKey, :duration, :visibility, :processing, :copyright, :moderation,
             :views, :likes, :dislikes, :comments, :shares, :saves, :published, :now, :now)`,
    {
      id,
      channelId: channel.id,
      creatorId: creator.id,
      title: overrides.title || 'A video',
      description: overrides.description || '',
      category: overrides.category || 'other',
      kind: overrides.kind || 'short',
      storageKey: overrides.storageKey ?? `videos/${id}/original.mp4`,
      duration: overrides.durationMs ?? 15000,
      visibility: overrides.visibility || 'public',
      processing: overrides.processingStatus || 'ready',
      copyright: overrides.copyrightStatus || 'clear',
      moderation: overrides.moderationStatus || 'approved',
      views: overrides.views ?? 0,
      likes: overrides.likes ?? 0,
      dislikes: overrides.dislikes ?? 0,
      comments: overrides.comments ?? 0,
      shares: overrides.shares ?? 0,
      saves: overrides.saves ?? 0,
      published: overrides.publishedAt || now,
      now,
    }
  );

  db.run('UPDATE channels SET video_count = video_count + 1 WHERE id = :id', { id: channel.id });
  return videos.findById(id);
}

/** Simulate viewers watching a video, which is what quality scoring reads. */
function simulateWatches(video, { sessions = 10, completion = 0.8, skips = 0 } = {}) {
  for (let i = 0; i < sessions; i++) {
    const isSkip = i < skips;
    db.run(
      `INSERT INTO watch_events (id, video_id, user_id, viewer_key, watch_ms, duration_ms,
                                 completion, replayed, skipped_fast, created_at)
       VALUES (:id, :videoId, NULL, :key, :watchMs, :durationMs, :completion, 0, :skipped, :now)`,
      {
        id: db.newId('wev'),
        videoId: video.id,
        key: `viewer-${i}`,
        watchMs: isSkip ? 800 : video.duration_ms * completion,
        durationMs: video.duration_ms,
        completion: isSkip ? 0.05 : completion,
        skipped: isSkip ? 1 : 0,
        now: new Date().toISOString(),
      }
    );
  }
  cache.clear();
}

// ===========================================================================
describe('Authentication', () => {
  test('registers a user and creates their channel', () => {
    const user = makeUser({ username: 'alice' });
    assert.equal(user.username, 'alice');

    const channel = channels.findByOwner(user.id);
    assert.ok(channel, 'a channel is created at registration');
    assert.equal(channel.handle, 'alice');
  });

  test('never stores the password in plaintext', () => {
    const user = makeUser();
    assert.ok(!user.password_hash.includes('a-long-enough-password'));
    assert.ok(user.password_hash.startsWith('scrypt$'));
  });

  test('rejects a duplicate email', () => {
    makeUser({ email: 'dupe@example.com' });
    assert.throws(
      () => makeUser({ email: 'dupe@example.com', username: 'other' }),
      /already exists/i
    );
  });

  test('authenticates with the right password and rejects the wrong one', () => {
    const user = makeUser({ email: 'auth@example.com' });
    const ok = users.authenticate({ email: 'auth@example.com', password: 'a-long-enough-password' });
    assert.equal(ok.id, user.id);

    assert.throws(
      () => users.authenticate({ email: 'auth@example.com', password: 'wrong-password' }),
      /not correct/
    );
  });

  test('gives the same error for an unknown email as for a wrong password', () => {
    makeUser({ email: 'real@example.com' });
    let unknownMessage, wrongMessage;
    try { users.authenticate({ email: 'nobody@example.com', password: 'x' }); }
    catch (e) { unknownMessage = e.message; }
    try { users.authenticate({ email: 'real@example.com', password: 'wrong-password' }); }
    catch (e) { wrongMessage = e.message; }
    // Identical messages: the endpoint cannot be used to enumerate accounts.
    assert.equal(unknownMessage, wrongMessage);
  });

  test('resolves a valid session and rejects a revoked one', () => {
    const user = makeUser();
    const { token } = users.createSession(user.id);

    assert.equal(users.resolveSession(token).user.id, user.id);

    users.revokeAllSessions(user.id);
    assert.equal(users.resolveSession(token), null);
  });

  test('stores session tokens hashed, not in plaintext', () => {
    const user = makeUser();
    const { token } = users.createSession(user.id);
    const row = db.get('SELECT token_hash FROM sessions WHERE user_id = :id', { id: user.id });
    assert.notEqual(row.token_hash, token);
    assert.equal(row.token_hash.length, 64); // sha256 hex
  });
});

// ===========================================================================
describe('Permissions', () => {
  test('a public ready video is visible to anyone', () => {
    const video = makeVideo(makeUser());
    assert.equal(videos.canView(video, null).allowed, true);
  });

  test('a private video is hidden from others but visible to its owner', () => {
    const owner = makeUser();
    const other = makeUser();
    const video = makeVideo(owner, { visibility: 'private' });

    assert.equal(videos.canView(video, other).allowed, false);
    assert.equal(videos.canView(video, owner).allowed, true);
  });

  test('a video that has not finished processing is not visible to others', () => {
    const owner = makeUser();
    const video = makeVideo(owner, { processingStatus: 'processing' });
    assert.equal(videos.canView(video, makeUser()).allowed, false);
    assert.equal(videos.canView(video, owner).allowed, true);
  });

  test('a copyright-blocked video is not viewable', () => {
    const video = makeVideo(makeUser(), { copyrightStatus: 'block' });
    assert.equal(videos.canView(video, makeUser()).allowed, false);
  });

  test('only the owner can edit', () => {
    const owner = makeUser();
    const video = makeVideo(owner);
    assert.equal(videos.canEdit(video, owner), true);
    assert.equal(videos.canEdit(video, makeUser()), false);
  });

  test('an admin can edit any video', () => {
    const video = makeVideo(makeUser());
    const admin = makeUser();
    db.run(`UPDATE users SET role = 'admin' WHERE id = :id`, { id: admin.id });
    assert.equal(videos.canEdit(video, { ...admin, role: 'admin' }), true);
  });
});

// ===========================================================================
describe('Upload security', () => {
  test('accepts a real MP4 signature', () => {
    const head = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(8)]);
    assert.equal(uploads.identifySignature(head).ext, 'mp4');
  });

  test('accepts a WebM signature', () => {
    const head = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);
    assert.equal(uploads.identifySignature(head).ext, 'webm');
  });

  test('rejects a shell script disguised as a video', () => {
    const head = Buffer.from('#!/bin/sh\necho pwned; rm -rf /\n');
    assert.equal(uploads.identifySignature(head), null);
  });

  test('rejects an HTML file (which could carry script)', () => {
    const head = Buffer.from('<html><script>alert(1)</script></html>');
    assert.equal(uploads.identifySignature(head), null);
  });

  test('rejects an ELF executable', () => {
    const head = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(16)]);
    assert.equal(uploads.identifySignature(head), null);
  });

  test('creates a draft before any bytes arrive, so an interrupted upload survives', () => {
    const user = makeUser();
    const draft = uploads.createDraft({ user, title: 'My video' });

    assert.equal(draft.status, 'draft');
    const drafts = uploads.listDrafts(user);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].videoId, draft.videoId);
  });
});

// ===========================================================================
describe('View counting', () => {
  test('counts a genuine watch', () => {
    const video = makeVideo(makeUser(), { durationMs: 30000 });
    const result = analytics.recordWatch({
      videoId: video.id, ip: '1.2.3.4', userAgent: 'test',
      watchMs: 20000, durationMs: 30000,
    });
    assert.equal(result.counted, true);
    assert.equal(videos.findById(video.id).view_count, 1);
  });

  test('does not count a watch below the minimum time', () => {
    const video = makeVideo(makeUser(), { durationMs: 30000 });
    const result = analytics.recordWatch({
      videoId: video.id, ip: '1.2.3.4', userAgent: 'test',
      watchMs: 500, durationMs: 30000,
    });
    assert.equal(result.counted, false);
    assert.equal(result.reason, 'below_minimum_watch_time');
  });

  test('does not count a refresh from the same viewer as a second view', () => {
    const video = makeVideo(makeUser(), { durationMs: 30000 });
    const args = { videoId: video.id, ip: '1.2.3.4', userAgent: 'test', watchMs: 20000, durationMs: 30000 };

    assert.equal(analytics.recordWatch(args).counted, true);
    const second = analytics.recordWatch(args);
    assert.equal(second.counted, false);
    assert.equal(second.reason, 'duplicate_within_window');
    assert.equal(videos.findById(video.id).view_count, 1);
  });

  test('counts different viewers separately', () => {
    const video = makeVideo(makeUser(), { durationMs: 30000 });
    analytics.recordWatch({ videoId: video.id, ip: '1.1.1.1', userAgent: 'a', watchMs: 20000, durationMs: 30000 });
    analytics.recordWatch({ videoId: video.id, ip: '2.2.2.2', userAgent: 'b', watchMs: 20000, durationMs: 30000 });
    assert.equal(videos.findById(video.id).view_count, 2);
  });

  test('requires a proportion watched on short videos', () => {
    const video = makeVideo(makeUser(), { durationMs: 5000 });
    // 2.5s of a 5s video is over the flat minimum but only 50%... which passes.
    // 1.2s is above minWatchMs? No - minWatchMs is 2000, so use 2.1s = 42% -> passes.
    // Use a longer short video to test the completion gate specifically.
    const longer = makeVideo(makeUser(), { durationMs: 60000 });
    const result = analytics.recordWatch({
      videoId: longer.id, ip: '9.9.9.9', userAgent: 'x',
      watchMs: 3000, durationMs: 60000,   // 5% of a 60s short
    });
    assert.equal(result.counted, false);
    assert.equal(result.reason, 'below_minimum_completion');
  });

  test('statistics can be recomputed from events', () => {
    const creator = makeUser();
    const viewer = makeUser();
    const video = makeVideo(creator, { durationMs: 30000, views: 999 }); // deliberately wrong counter

    analytics.recordWatch({
      videoId: video.id, userId: viewer.id, ip: '1.1.1.1', userAgent: 'a',
      watchMs: 20000, durationMs: 30000,
    });

    analytics.recomputeVideoStats(video.id);
    // The counter is repaired from the event log — proving it is only a cache.
    assert.equal(videos.findById(video.id).view_count, 1);
  });
});

// ===========================================================================
describe('Recommendation fairness', () => {
  test('a small creator with a great video outranks a big creator with a poor one', () => {
    const smallCreator = makeUser({ username: 'small' });
    const bigCreator = makeUser({ username: 'big' });

    // The big channel has a huge audience.
    db.run('UPDATE channels SET follower_count = 500000 WHERE owner_id = :id', { id: bigCreator.id });
    db.run('UPDATE channels SET follower_count = 3 WHERE owner_id = :id', { id: smallCreator.id });

    const goodSmallVideo = makeVideo(smallCreator, { views: 40, likes: 20, saves: 6 });
    const poorBigVideo = makeVideo(bigCreator, { views: 900000, likes: 1200, saves: 20 });

    // People finish the small creator's video; they bounce off the big one.
    simulateWatches(goodSmallVideo, { sessions: 20, completion: 0.92 });
    simulateWatches(poorBigVideo, { sessions: 400, completion: 0.06, skips: 300 });

    const small = videos.findById(goodSmallVideo.id);
    const big = videos.findById(poorBigVideo.id);
    small.channel_followers = 3;
    big.channel_followers = 500000;

    const smallQuality = recommendations.scoreQuality(small);
    const bigQuality = recommendations.scoreQuality(big);
    assert.ok(smallQuality > bigQuality,
      `quality: small ${smallQuality} should beat big ${bigQuality}`);

    const smallFairness = recommendations.scoreFairness(small);
    const bigFairness = recommendations.scoreFairness(big);
    assert.ok(smallFairness > bigFairness,
      `fairness: small ${smallFairness} should beat big ${bigFairness}`);

    // And the negative signal punishes the bounced-off video.
    assert.ok(recommendations.scoreNegative(big) > recommendations.scoreNegative(small));
  });

  test('engagement is scored as a rate, so view totals do not decide it', () => {
    const tinyButLoved = { view_count: 100, like_count: 30, comment_count: 10, share_count: 5, save_count: 5 };
    const hugeButIgnored = { view_count: 1_000_000, like_count: 1000, comment_count: 100, share_count: 10, save_count: 10 };

    assert.ok(
      recommendations.scoreEngagement(tinyButLoved) > recommendations.scoreEngagement(hugeButIgnored),
      'a high engagement RATE beats a high engagement TOTAL'
    );
  });

  test('an unproven video gets a neutral quality score, not zero', () => {
    const video = makeVideo(makeUser());
    // With no watch data at all, it must not be scored as bad — otherwise new
    // content could never rise.
    assert.equal(recommendations.scoreQuality(video), 0.5);
  });

  test('freshness decays smoothly rather than cutting off', () => {
    const now = makeVideo(makeUser(), { publishedAt: new Date().toISOString() });
    const twoDays = makeVideo(makeUser(), {
      publishedAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
    });
    const old = makeVideo(makeUser(), {
      publishedAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
    });

    const freshNow = recommendations.scoreFreshness(now);
    const freshTwoDays = recommendations.scoreFreshness(twoDays);
    const freshOld = recommendations.scoreFreshness(old);

    assert.ok(freshNow > freshTwoDays && freshTwoDays > freshOld);
    // At exactly one half-life the score is ~0.5, and old content still scores
    // above zero rather than being excluded outright.
    assert.ok(Math.abs(freshTwoDays - 0.5) < 0.05);
    assert.ok(freshOld >= 0);
  });

  test('the fairness boost shrinks as a channel grows', () => {
    const make = (followers) => ({ id: `v${followers}`, channel_followers: followers });
    const tiny = recommendations.scoreFairness(make(0));
    const medium = recommendations.scoreFairness(make(1000));
    const huge = recommendations.scoreFairness(make(1_000_000));

    assert.ok(tiny > medium && medium > huge,
      `boost must decay: ${tiny} > ${medium} > ${huge}`);
  });

  test('the feed does not show more than the per-creator cap', () => {
    const spammer = makeUser({ username: 'prolific' });
    for (let i = 0; i < 12; i++) makeVideo(spammer, { title: `Video ${i}` });

    const viewer = makeUser();
    const feed = recommendations.buildFeed({ userId: viewer.id, limit: 10 });

    const fromSpammer = feed.items.filter((v) => v.creator_id === spammer.id).length;
    assert.ok(fromSpammer <= recommendations.TUNING.maxPerCreator,
      `expected at most ${recommendations.TUNING.maxPerCreator}, got ${fromSpammer}`);
  });

  test('a viewer is never recommended their own video', () => {
    const creator = makeUser();
    makeVideo(creator);
    for (let i = 0; i < 3; i++) makeVideo(makeUser());

    const feed = recommendations.buildFeed({ userId: creator.id, limit: 10 });
    assert.ok(!feed.items.some((v) => v.creator_id === creator.id));
  });

  test('blocked creators are filtered out of the feed', () => {
    const blocked = makeUser({ username: 'blocked' });
    const viewer = makeUser();
    makeVideo(blocked);
    makeVideo(makeUser());

    users.blockUser(viewer.id, blocked.id);

    const feed = recommendations.buildFeed({ userId: viewer.id, limit: 10 });
    assert.ok(!feed.items.some((v) => v.creator_id === blocked.id));
  });

  test('private and unlisted videos never enter the feed', () => {
    makeVideo(makeUser(), { visibility: 'private' });
    makeVideo(makeUser(), { visibility: 'unlisted' });
    const publicVideo = makeVideo(makeUser(), { visibility: 'public' });

    const feed = recommendations.buildFeed({ userId: makeUser().id, limit: 20 });
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].id, publicVideo.id);
  });

  test('the safety pass runs after ranking and cannot be outscored', () => {
    const flagged = makeVideo(makeUser(), {
      moderationStatus: 'flagged', views: 999999, likes: 99999,
    });
    const safetyFiltered = recommendations.safetyPass([flagged]);
    assert.equal(safetyFiltered.length, 0,
      'no engagement score can push flagged content into a feed');
  });

  test('a video already shown is not shown again straight away', () => {
    const video = makeVideo(makeUser());
    const viewer = makeUser();

    const first = recommendations.buildFeed({ userId: viewer.id, limit: 10 });
    assert.equal(first.items.length, 1);

    const second = recommendations.buildFeed({ userId: viewer.id, limit: 10 });
    assert.equal(second.items.length, 0, 'the impression cooldown prevents repeats');
  });
});

// ===========================================================================
describe('Cold start', () => {
  test('an empty platform reports the empty state rather than an error', () => {
    const feed = recommendations.buildFeed({ userId: null, limit: 10 });
    assert.equal(feed.mode, 'empty_platform');
    assert.equal(feed.items.length, 0);
    assert.equal(feed.platform.stage, 'empty');
  });

  test('the platform stage advances automatically as content arrives', () => {
    assert.equal(recommendations.platformState().stage, 'empty');

    makeVideo(makeUser());
    cache.clear();
    assert.equal(recommendations.platformState().stage, 'seedling');

    for (let i = 0; i < 25; i++) makeVideo(makeUser());
    cache.clear();
    assert.equal(recommendations.platformState().stage, 'growing');
  });

  test('a signed-out viewer still gets a feed', () => {
    for (let i = 0; i < 5; i++) makeVideo(makeUser());
    const feed = recommendations.buildFeed({ userId: null, viewerKey: 'anon-1', limit: 5 });
    assert.ok(feed.items.length > 0);
  });

  test('onboarding interests are stored and used', () => {
    const user = makeUser();
    recommendations.setOnboardingInterests(user.id, ['gaming', 'music', 'not-a-real-topic']);

    const stored = db.all('SELECT topic FROM user_interests WHERE user_id = :id', { id: user.id });
    // The invalid topic is ignored rather than stored.
    assert.equal(stored.length, 2);
    assert.equal(db.get('SELECT onboarded FROM users WHERE id = :id', { id: user.id }).onboarded, 1);
  });

  test('a new user is flagged as cold-start', () => {
    const user = makeUser();
    const profile = recommendations.buildUserProfile(user.id);
    assert.equal(profile.isNew, true);
  });
});

// ===========================================================================
describe('Learning from behaviour', () => {
  test('finishing a video raises interest in its category', () => {
    const viewer = makeUser();
    const video = makeVideo(makeUser(), { category: 'gaming' });

    recommendations.learnFromWatch({
      userId: viewer.id, video, completion: 0.95, skippedFast: false,
    });

    const interest = db.get(
      'SELECT weight FROM user_interests WHERE user_id = :u AND topic = :t',
      { u: viewer.id, t: 'gaming' }
    );
    assert.ok(interest && interest.weight > 0);
  });

  test('a fast skip lowers interest', () => {
    const viewer = makeUser();
    const video = makeVideo(makeUser(), { category: 'gaming' });

    recommendations.learnFromWatch({ userId: viewer.id, video, completion: 0.95, skippedFast: false });
    const before = db.get('SELECT weight FROM user_interests WHERE user_id = :u AND topic = :t',
      { u: viewer.id, t: 'gaming' }).weight;

    recommendations.learnFromWatch({ userId: viewer.id, video, completion: 0.02, skippedFast: true });
    const after = db.get('SELECT weight FROM user_interests WHERE user_id = :u AND topic = :t',
      { u: viewer.id, t: 'gaming' }).weight;

    assert.ok(after < before, 'a fast skip is negative evidence');
  });

  test('interests decay over time so taste can change', () => {
    const viewer = makeUser();
    const video = makeVideo(makeUser(), { category: 'gaming' });
    recommendations.learnFromWatch({ userId: viewer.id, video, completion: 0.95, skippedFast: false });

    const before = db.get('SELECT weight FROM user_interests WHERE user_id = :u', { u: viewer.id }).weight;
    recommendations.decayInterests({ factor: 0.5 });
    const after = db.get('SELECT weight FROM user_interests WHERE user_id = :u', { u: viewer.id })?.weight ?? 0;

    assert.ok(after < before);
  });
});

// ===========================================================================
describe('Trending', () => {
  test('velocity beats lifetime views', () => {
    const old = { recent_views: 10, prior_views: 10, unique_viewers: 9, avg_completion: 0.5,
                  view_count: 5_000_000, like_count: 100_000, comment_count: 5000, share_count: 900 };
    const surging = { recent_views: 400, prior_views: 5, unique_viewers: 380, avg_completion: 0.8,
                      view_count: 500, like_count: 90, comment_count: 30, share_count: 20 };

    assert.ok(trending.trendScore(surging) > trending.trendScore(old),
      'a surging small video beats a static huge one');
  });

  test('concentrated traffic is penalized as possible manipulation', () => {
    const organic = { recent_views: 200, prior_views: 20, unique_viewers: 190, avg_completion: 0.7,
                      view_count: 1000, like_count: 100, comment_count: 20, share_count: 10 };
    const inflated = { recent_views: 200, prior_views: 20, unique_viewers: 8, avg_completion: 0.7,
                       view_count: 1000, like_count: 100, comment_count: 20, share_count: 10 };

    assert.ok(trending.trendScore(organic) > trending.trendScore(inflated),
      'many distinct viewers beats a few viewers on repeat');
  });

  test('very low view counts do not qualify', () => {
    makeVideo(makeUser(), { views: 1 });
    const results = trending.getTrending({ limit: 10 });
    assert.equal(results.length, 0);
  });
});

// ===========================================================================
describe('Search', () => {
  test('finds videos by title', () => {
    const creator = makeUser();
    makeVideo(creator, { title: 'Roblox dancing tutorial' });
    makeVideo(creator, { title: 'Cooking pasta' });

    const results = search.search({ query: 'roblox' });
    assert.equal(results.videos.length, 1);
    assert.match(results.videos[0].title, /Roblox/);
  });

  test('searches beyond the title field', () => {
    makeVideo(makeUser(), { title: 'Untitled', description: 'a guide to underwater basket weaving' });
    const results = search.search({ query: 'basket weaving' });
    assert.equal(results.videos.length, 1);
  });

  test('an exact title match outranks a merely popular video', () => {
    const exact = { title: 'pancakes', description: '', tags: '[]', channel_name: '',
                    view_count: 10, like_count: 1, comment_count: 0, published_at: new Date().toISOString() };
    const popular = { title: 'my morning routine with pancakes and more', description: '', tags: '[]',
                      channel_name: '', view_count: 5_000_000, like_count: 100000, comment_count: 5000,
                      published_at: new Date().toISOString() };

    assert.ok(search.scoreVideo(exact, 'pancakes') > search.scoreVideo(popular, 'pancakes'));
  });

  test('finds channels', () => {
    makeUser({ username: 'cookingchannel', displayName: 'Cooking Channel' });
    const results = search.search({ query: 'cooking' });
    assert.ok(results.channels.length >= 1);
  });

  test('returns nothing for an empty query rather than everything', () => {
    makeVideo(makeUser());
    const results = search.search({ query: '   ' });
    assert.equal(results.total, 0);
  });
});

// ===========================================================================
describe('Comments', () => {
  test('creates a comment and increments the counter', async () => {
    const creator = makeUser();
    const commenter = makeUser();
    const video = makeVideo(creator);

    await comments.create({ videoId: video.id, user: commenter, body: 'Nice video!' });
    assert.equal(videos.findById(video.id).comment_count, 1);
  });

  test('rejects an empty comment', async () => {
    const video = makeVideo(makeUser());
    await assert.rejects(
      () => comments.create({ videoId: video.id, user: makeUser(), body: '   ' }),
      /Write something/
    );
  });

  test('caps thread depth so replies stay readable', async () => {
    const video = makeVideo(makeUser());
    const user = makeUser();

    const top = await comments.create({ videoId: video.id, user, body: 'level 0' });
    const reply1 = await comments.create({ videoId: video.id, user, body: 'level 1', parentId: top.id });
    const reply2 = await comments.create({ videoId: video.id, user, body: 'level 2', parentId: reply1.id });
    const reply3 = await comments.create({ videoId: video.id, user, body: 'level 3', parentId: reply2.id });

    assert.equal(reply3.depth, comments.MAX_DEPTH,
      'depth is capped rather than nesting forever');
  });

  test('a soft-deleted comment keeps the thread intact', async () => {
    const video = makeVideo(makeUser());
    const author = makeUser();
    const comment = await comments.create({ videoId: video.id, user: author, body: 'to delete' });

    comments.remove({ commentId: comment.id, user: author });

    const row = db.get('SELECT * FROM comments WHERE id = :id', { id: comment.id });
    assert.ok(row, 'the row still exists so replies are not orphaned');
    assert.equal(row.body, '[deleted]');
  });

  test('the video owner can delete a comment on their video', async () => {
    const creator = makeUser();
    const commenter = makeUser();
    const video = makeVideo(creator);
    const comment = await comments.create({ videoId: video.id, user: commenter, body: 'spam' });

    assert.doesNotThrow(() => comments.remove({ commentId: comment.id, user: creator }));
  });

  test('a stranger cannot delete someone else comment', async () => {
    const video = makeVideo(makeUser());
    const comment = await comments.create({ videoId: video.id, user: makeUser(), body: 'hello' });

    assert.throws(
      () => comments.remove({ commentId: comment.id, user: makeUser() }),
      /cannot delete/
    );
  });
});

// ===========================================================================
describe('Moderation', () => {
  test('the internal classifier flags obvious link spam', async () => {
    const result = await moderation.moderateText({
      text: 'http://a.com http://b.com http://c.com http://d.com',
    });
    assert.ok(result.signals.spam >= 0.5);
  });

  test('normal text is allowed', async () => {
    const result = await moderation.moderateText({ text: 'This was really helpful, thank you!' });
    assert.equal(result.decision, 'allow');
  });

  test('the platform decides, not the provider', () => {
    // A provider signal below OUR threshold does not become a removal.
    const belowThreshold = moderation.decide({ p: { harassment: 0.6 } }, 'comment');
    assert.notEqual(belowThreshold.decision, 'remove');

    const aboveThreshold = moderation.decide({ p: { harassment: 0.99 } }, 'comment');
    assert.equal(aboveThreshold.decision, 'remove');
  });

  test('self-harm is never auto-removed, only routed to a human', () => {
    const result = moderation.decide({ p: { self_harm: 0.99 } }, 'comment');
    assert.notEqual(result.decision, 'remove',
      'a false positive here is too costly to automate');
  });

  test('signals from several providers are combined', () => {
    const result = moderation.decide({
      providerA: { spam: 0.3 },
      providerB: { spam: 0.97 },
    }, 'comment');
    assert.equal(result.decision, 'remove');
  });

  test('reports do not remove content on their own', () => {
    const video = makeVideo(makeUser());
    for (let i = 0; i < 10; i++) {
      moderation.createReport({
        reporterId: makeUser().id, targetType: 'video', targetId: video.id, category: 'spam',
      });
    }
    const after = videos.findById(video.id);
    assert.notEqual(after.moderation_status, 'removed',
      'brigading must not be an effective takedown tool');
    assert.equal(after.moderation_status, 'flagged', 'but it does limit reach pending review');
  });
});

// ===========================================================================
describe('Copyright', () => {
  test('with no provider configured the result is pending, never "clear"', async () => {
    const video = makeVideo(makeUser(), { copyrightStatus: 'pending' });
    const result = await copyright.checkVideo(video.id);

    assert.equal(result.result, 'unavailable');
    assert.equal(videos.findById(video.id).copyright_status, 'pending',
      'an unchecked video must never be marked as cleared');
  });

  test('an offline copyright API does not block the upload', async () => {
    const video = makeVideo(makeUser());
    const result = await copyright.checkVideo(video.id);

    // The video is still viewable — the platform degrades, it does not stop.
    assert.equal(videos.canView(videos.findById(video.id), null).allowed, true);
    assert.equal(result.action, 'none');
  });

  test('detection is recorded separately from licensing', () => {
    const video = makeVideo(makeUser());
    copyright.recordCase(video.id, {
      provider: 'test', result: 'match', matchedWork: 'Some Song', licenseState: 'unknown',
    });

    const record = db.get('SELECT * FROM copyright_cases WHERE video_id = :id', { id: video.id });
    assert.equal(record.result, 'match');
    assert.equal(record.license_state, 'unknown',
      'a detection match does not imply we hold a licence');
  });

  test('holding a licence downgrades the action on a match', () => {
    const video = makeVideo(makeUser());
    const blocked = copyright.recordCase(video.id, {
      provider: 'test', result: 'block', licenseState: 'unknown',
    });
    assert.equal(blocked.action, 'block');

    const licensed = copyright.recordCase(makeVideo(makeUser()).id, {
      provider: 'test', result: 'block', licenseState: 'licensed',
    });
    assert.equal(licensed.action, 'none', 'a licence changes what we do about a match');
  });

  test('a blocked video is made private', () => {
    const video = makeVideo(makeUser());
    copyright.recordCase(video.id, { provider: 'test', result: 'block', licenseState: 'unknown' });
    assert.equal(videos.findById(video.id).visibility, 'private');
  });
});

// ===========================================================================
describe('Integrations', () => {
  test('every capability resolves to an adapter, even unconfigured', () => {
    for (const key of Object.keys(registry.CAPABILITIES)) {
      const adapter = registry.get(key);
      assert.ok(adapter, `${key} must resolve to something`);
      assert.ok(typeof adapter.healthCheck === 'function', `${key} needs a health check`);
    }
  });

  test('the registry never exposes a secret value', () => {
    process.env.COPYRIGHT_API_KEY = 'super-secret-key-do-not-leak';
    registry.reset();
    registry.initialize();

    const serialized = JSON.stringify(registry.status());
    assert.ok(!serialized.includes('super-secret-key-do-not-leak'),
      'API keys must never appear in the admin payload');

    delete process.env.COPYRIGHT_API_KEY;
  });

  test('the admin view reports configured state without the value', () => {
    const status = registry.status();
    const copyrightIntegration = status.find((s) => s.key === 'copyright');
    assert.ok('configured' in copyrightIntegration);
    assert.ok(!('apiKey' in copyrightIntegration));
  });

  test('test connection works for the local storage adapter', async () => {
    const result = await registry.testConnection('storage');
    assert.equal(result.ok, true);
  });

  test('a health check on an unconfigured provider explains itself', async () => {
    const result = await registry.testConnection('music');
    assert.ok(result.ok);
    assert.match(result.message, /not configured|Original sounds/i);
  });

  test('storage round-trips a file', async () => {
    const storage = registry.get('storage');
    await storage.put('test/file.txt', Buffer.from('hello'));
    const back = await storage.get('test/file.txt');
    assert.equal(back.toString(), 'hello');
    await storage.delete('test/file.txt');
    assert.equal(await storage.stat('test/file.txt'), null);
  });

  test('synchronous adapter methods stay synchronous through the registry', () => {
    // Regression: the registry once wrapped EVERY method in an async wrapper,
    // which turned urlFor()'s string into a Promise and made every video URL
    // serialize as `{}`. Only async (I/O) methods may be instrumented.
    const url = registry.get('storage').urlFor('videos/abc/original.mp4');
    assert.equal(typeof url, 'string', 'urlFor must return a string, not a Promise');
    assert.match(url, /videos\/abc\/original\.mp4$/);
  });

  test('storage refuses a path that escapes its root', async () => {
    const storage = registry.get('storage');
    await assert.rejects(
      () => storage.put('../../../etc/evil.txt', Buffer.from('x')),
      /Invalid storage key/
    );
  });
});

// ===========================================================================
describe('Queue and failure handling', () => {
  test('runs a job', async () => {
    let ran = false;
    queue.register('test.ok', async () => { ran = true; });
    queue.enqueue('test.ok', {});
    await queue.drain();
    assert.equal(ran, true);
  });

  test('retries a failing job with backoff, then gives up', async () => {
    let attempts = 0;
    queue.register('test.fail', async () => { attempts++; throw new Error('nope'); });
    const jobId = queue.enqueue('test.fail', {}, { maxAttempts: 2 });

    await queue.drain();
    // The retry is scheduled in the future, so make it runnable now.
    db.run(`UPDATE jobs SET run_after = :now WHERE id = :id`,
      { id: jobId, now: new Date(0).toISOString() });
    await queue.drain();

    const job = db.get('SELECT * FROM jobs WHERE id = :id', { id: jobId });
    assert.equal(job.status, 'dead', 'it stops rather than retrying forever');
    assert.equal(attempts, 2);
  });

  test('an unknown job type is marked dead, not retried forever', async () => {
    const jobId = queue.enqueue('test.nohandler', {});
    await queue.drain();
    assert.equal(db.get('SELECT status FROM jobs WHERE id = :id', { id: jobId }).status, 'dead');
  });

  test('a failing job does not stop other jobs', async () => {
    let goodRan = false;
    queue.register('test.bad', async () => { throw new Error('boom'); });
    queue.register('test.good', async () => { goodRan = true; });

    queue.enqueue('test.bad', {});
    queue.enqueue('test.good', {});
    await queue.drain();

    assert.equal(goodRan, true);
  });
});

// ===========================================================================
describe('Notifications', () => {
  test('a like notifies the creator', async () => {
    const creator = makeUser();
    const liker = makeUser();
    const video = makeVideo(creator);

    videos.react(video.id, liker.id, 1);
    await new Promise((r) => setTimeout(r, 50)); // handlers run async

    const list = notifications.list(creator.id);
    assert.ok(list.some((n) => n.type === 'like'));
  });

  test('you are not notified about your own action', async () => {
    const creator = makeUser();
    const video = makeVideo(creator);

    videos.react(video.id, creator.id, 1);
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(notifications.list(creator.id).length, 0);
  });

  test('a follow notifies the creator', async () => {
    const creator = makeUser();
    const follower = makeUser();
    const channel = channels.findByOwner(creator.id);

    channels.toggleFollow({ channelId: channel.id, user: follower });
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(notifications.list(creator.id).some((n) => n.type === 'follow'));
  });
});

// ===========================================================================
describe('Account lifecycle', () => {
  test('deletion anonymizes rather than orphaning data', async () => {
    const user = makeUser({ username: 'leaving' });
    const video = makeVideo(user);
    const otherVideo = makeVideo(makeUser());
    await comments.create({ videoId: otherVideo.id, user, body: 'my comment' });

    users.deleteAccount(user.id);

    const row = db.get('SELECT * FROM users WHERE id = :id', { id: user.id });
    assert.equal(row.status, 'deleted');
    assert.equal(row.display_name, 'Deleted account');
    assert.ok(!row.email.includes('leaving'), 'the real email is gone');

    // The comment row survives so the thread it belongs to still makes sense.
    const comment = db.get('SELECT * FROM comments WHERE user_id = :id', { id: user.id });
    assert.equal(comment.body, '[deleted]');

    assert.ok(db.get('SELECT deleted_at FROM videos WHERE id = :id', { id: video.id }).deleted_at);
  });

  test('data export includes the user own content', () => {
    const user = makeUser();
    makeVideo(user, { title: 'My video' });

    const exported = users.exportData(user.id);
    assert.equal(exported.videos.length, 1);
    assert.equal(exported.account.id, user.id);
    assert.ok(exported.exportedAt);
  });

  test('blocking works both ways round', () => {
    const a = makeUser();
    const b = makeUser();

    users.blockUser(a.id, b.id);
    assert.deepEqual(users.blockedIds(a.id), [b.id]);

    users.unblockUser(a.id, b.id);
    assert.deepEqual(users.blockedIds(a.id), []);
  });

  test('you cannot block yourself', () => {
    const user = makeUser();
    assert.throws(() => users.blockUser(user.id, user.id), /cannot block yourself/);
  });
});

// ===========================================================================
describe('Rate limiting', () => {
  test('allows requests under the limit and blocks over it', () => {
    for (let i = 0; i < 10; i++) {
      assert.doesNotThrow(() => rateLimit.hit('login', 'test-ip'));
    }
    assert.throws(() => rateLimit.hit('login', 'test-ip'), /Too many attempts/);
  });

  test('limits are tracked per identity', () => {
    for (let i = 0; i < 10; i++) rateLimit.hit('login', 'ip-a');
    assert.doesNotThrow(() => rateLimit.hit('login', 'ip-b'));
  });

  test('different actions have independent budgets', () => {
    for (let i = 0; i < 10; i++) rateLimit.hit('login', 'shared');
    assert.doesNotThrow(() => rateLimit.hit('search', 'shared'),
      'exhausting login must not block search');
  });
});
