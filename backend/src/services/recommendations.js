'use strict';

/**
 * ============================================================================
 * RECOMMENDATION ENGINE  —  the scrolling feed's brain
 * ============================================================================
 *
 * This file is the most important piece of product logic in the platform, so it
 * is written to be READ. Every scoring decision is a named function with an
 * explanation of what it is trying to achieve and what it is trying to avoid.
 *
 * THE PIPELINE (spec §21)
 *
 *   1. candidateGeneration  gather a pool from several independent sources
 *   2. filtering            remove anything this viewer must not or should not see
 *   3. ranking              score each candidate on what we predict is useful
 *   4. diversity            stop the feed becoming 30 of the same thing
 *   5. safety               final policy pass before anything is shown
 *   6. finalFeed            assemble, record impressions, return
 *
 * WHAT THIS ALGORITHM REFUSES TO DO
 *
 * "Most views wins" is not an algorithm, it is a rich-get-richer loop. Once a
 * video is popular it gets shown more, which makes it more popular. New
 * creators never escape zero, and the feed converges on the same few videos.
 *
 * So three rules are built into the scoring itself, not bolted on afterwards:
 *
 *   1. WE SCORE RATES, NOT TOTALS.
 *      A video with 40 views where 90% watch to the end is a better video than
 *      one with 40,000 views where 5% do. Ranking is dominated by completion
 *      rate, like RATE and finish RATE — numbers a small creator can win on
 *      from their very first upload.
 *
 *   2. AUDIENCE SIZE IS DISCOUNTED, NOT REWARDED.
 *      `fairnessBoost` gives a real, bounded advantage to videos from smaller
 *      channels and to videos that have not had their fair chance yet. Big
 *      channels still win when their content genuinely performs — they just do
 *      not win automatically.
 *
 *   3. EVERY VIDEO GETS A TRIAL.
 *      A fixed share of every feed is reserved for exploration: fresh videos
 *      with almost no impressions. That is how a new upload gets its first
 *      real audience instead of waiting for luck.
 *
 * AND IT IS NOT ALLOWED TO OPTIMIZE FOR TIME ALONE (spec §60)
 *
 * An engagement-only objective learns that outrage and shock hold attention.
 * So the score explicitly includes negative signals (fast skips, dislikes) and
 * a safety pass runs LAST, after ranking, where it cannot be outvoted by a
 * high engagement score.
 */

const db = require('../core/db');
const cache = require('../core/cache');
const { logger } = require('../core/logger');

// ---------------------------------------------------------------------------
// TUNING. Every number the algorithm uses is here, named, in one place, so its
// behaviour can be adjusted without reading the code.
// ---------------------------------------------------------------------------
const TUNING = {
  // How much each ranking component contributes. These are relative weights.
  weights: {
    interestMatch:   2.6,  // does it match what they like?
    creatorAffinity: 2.0,  // do they like this creator specifically?
    following:       2.4,  // do they follow this creator?
    quality:         3.0,  // did other viewers watch it through?  <- biggest
    engagement:      1.6,  // likes/comments/shares, as RATES
    freshness:       1.4,  // is it new?
    fairness:        1.8,  // small-creator and under-shown boost
    negative:       -3.0,  // fast skips and dislikes push it DOWN, hard
    repetition:     -2.2,  // already seen / too much of one creator
  },

  // Share of the feed reserved for exploration — videos with little exposure.
  // This is the single most important fairness lever in the whole file.
  explorationShare: 0.30,

  // Diversity caps applied to the final feed.
  maxPerCreator: 2,        // at most N videos from one creator per page
  maxPerCategory: 4,       // at most N from one category per page

  // A video is "under-shown" while it has fewer than this many impressions.
  // Below the threshold it gets the full exploration boost.
  fairChanceImpressions: 500,

  // Freshness half-life: how quickly newness stops counting, in hours.
  freshnessHalfLifeHours: 48,

  // Do not re-show a video the viewer has already been shown within this many
  // hours, unless the pool is exhausted.
  impressionCooldownHours: 72,

  // How many candidates to gather before ranking. Bigger = better feed, more work.
  candidatePoolSize: 300,
};

/** Interest topics offered during onboarding (spec §22). */
const TOPICS = [
  'technology', 'gaming', 'sports', 'music', 'education',
  'comedy', 'news', 'science', 'travel', 'art',
  'food', 'fitness', 'fashion', 'animals', 'diy',
];

// ===========================================================================
// ENTRY POINT
// ===========================================================================

/**
 * Build a personalized feed.
 *
 * @param {object} options
 *   userId    signed-in user id, or null
 *   viewerKey stable key for signed-out viewers (impression tracking)
 *   kind      'short' | 'long'
 *   limit     how many videos to return
 *   cursor    opaque pagination offset
 * @returns {{items: object[], mode: string, explain: object}}
 */
function buildFeed({ userId = null, viewerKey = null, kind = 'short', limit = 10, cursor = 0 }) {
  const key = userId ? `u:${userId}` : (viewerKey || 'anon');
  const started = Date.now();

  // --- COLD START: is there anything on the platform at all? (spec §22) ---
  const platform = platformState();
  if (platform.publicVideoCount === 0) {
    return {
      items: [],
      mode: 'empty_platform',
      platform,
      explain: { reason: 'No public videos exist yet on this platform.' },
    };
  }

  const profile = buildUserProfile(userId);

  // 1 — CANDIDATES
  const candidates = candidateGeneration({ profile, kind, key });

  // 2 — FILTER
  const permitted = filtering({ candidates, profile, key });

  // 3 — RANK
  const ranked = ranking({ candidates: permitted, profile, key });

  // 4 — DIVERSIFY
  const diversified = diversity({ ranked, limit: limit + Number(cursor) });

  // 5 — SAFETY (last, so a high score can never override it)
  const safe = safetyPass(diversified);

  // 6 — ASSEMBLE
  const page = safe.slice(Number(cursor), Number(cursor) + limit);
  recordImpressions(key, page);

  logger.debug('recommendations', 'feed built', {
    userId, kind, candidates: candidates.length, afterFilter: permitted.length,
    returned: page.length, ms: Date.now() - started,
  });

  return {
    items: page,
    mode: profile.isNew ? 'cold_start_user' : 'personalized',
    platform,
    nextCursor: page.length === limit ? Number(cursor) + limit : null,
    explain: {
      candidatesConsidered: candidates.length,
      afterFiltering: permitted.length,
      strategy: profile.isNew
        ? 'New viewer: using chosen interests, trending, and fresh uploads.'
        : 'Personalized from watch history, interests, and follows.',
      explorationShare: TUNING.explorationShare,
    },
  };
}

// ===========================================================================
// STEP 0 — WHO IS THIS VIEWER?
// ===========================================================================

/**
 * Assemble everything we know about a viewer into one object, so the ranking
 * functions stay pure and easy to test.
 */
function buildUserProfile(userId) {
  if (!userId) {
    return {
      userId: null, isNew: true, interests: new Map(),
      affinity: new Map(), following: new Set(), blocked: new Set(),
      recentCreators: new Map(), recentCategories: new Map(), watched: new Set(),
    };
  }

  const interests = new Map(
    db.all('SELECT topic, weight FROM user_interests WHERE user_id = :id', { id: userId })
      .map((r) => [r.topic, r.weight])
  );

  const affinity = new Map(
    db.all('SELECT channel_id, weight FROM user_creator_affinity WHERE user_id = :id', { id: userId })
      .map((r) => [r.channel_id, r.weight])
  );

  const following = new Set(
    db.all('SELECT channel_id FROM follows WHERE follower_id = :id', { id: userId })
      .map((r) => r.channel_id)
  );

  const blocked = new Set(
    db.all('SELECT blocked_id FROM blocks WHERE blocker_id = :id', { id: userId })
      .map((r) => r.blocked_id)
  );

  // Recent history drives the "don't show me the same thing again" signals.
  const recent = db.all(
    `SELECT w.video_id, v.channel_id, v.category
       FROM watch_events w JOIN videos v ON v.id = w.video_id
      WHERE w.user_id = :id
      ORDER BY w.created_at DESC LIMIT 60`,
    { id: userId }
  );

  const recentCreators = new Map();
  const recentCategories = new Map();
  const watched = new Set();
  for (const row of recent) {
    watched.add(row.video_id);
    recentCreators.set(row.channel_id, (recentCreators.get(row.channel_id) || 0) + 1);
    recentCategories.set(row.category, (recentCategories.get(row.category) || 0) + 1);
  }

  // "New" means we have no behavioural signal yet — interests alone don't count
  // as history, they are the cold-start substitute for it.
  const isNew = recent.length < 5;

  return { userId, isNew, interests, affinity, following, blocked, recentCreators, recentCategories, watched };
}

// ===========================================================================
// STEP 1 — CANDIDATE GENERATION
// ===========================================================================

/**
 * Gather a pool of possibly-interesting videos from SEVERAL INDEPENDENT
 * SOURCES. Using several sources matters: any single source has a bias, and
 * mixing them is what stops the feed collapsing into one narrow lane.
 *
 * Sources:
 *   a. followed creators      — content they asked for
 *   b. interest match         — topics they chose or we learned
 *   c. trending               — what is genuinely moving right now
 *   d. fresh uploads          — recent content, regardless of performance
 *   e. EXPLORATION            — under-shown videos that deserve a trial
 *   f. similar-creator        — creators whose audience overlaps theirs
 */
function candidateGeneration({ profile, kind, key }) {
  const pool = new Map(); // videoId -> candidate (deduped, source recorded)
  const perSource = Math.ceil(TUNING.candidatePoolSize / 5);

  const add = (rows, source) => {
    for (const row of rows) {
      const existing = pool.get(row.id);
      if (existing) { existing.sources.push(source); continue; }
      pool.set(row.id, { ...row, sources: [source] });
    }
  };

  // (a) From creators they follow.
  if (profile.following.size) {
    const ids = [...profile.following];
    add(queryVideos({
      kind,
      where: `v.channel_id IN (${ids.map((_, i) => `:ch${i}`).join(',')})`,
      params: Object.fromEntries(ids.map((id, i) => [`ch${i}`, id])),
      order: 'v.published_at DESC',
      limit: perSource,
    }), 'following');
  }

  // (b) Matching their interests.
  const topics = [...profile.interests.keys()];
  if (topics.length) {
    add(queryVideos({
      kind,
      where: `v.category IN (${topics.map((_, i) => `:t${i}`).join(',')})`,
      params: Object.fromEntries(topics.map((t, i) => [`t${i}`, t])),
      order: 'v.published_at DESC',
      limit: perSource,
    }), 'interest');
  }

  // (c) Trending — computed by its own service, not "most views ever".
  add(trendingCandidates(kind, perSource), 'trending');

  // (d) Fresh uploads. Deliberately unfiltered by performance: this is the
  //     door through which brand-new content enters the system at all.
  add(queryVideos({ kind, order: 'v.published_at DESC', limit: perSource }), 'fresh');

  // (e) EXPLORATION — the fairness engine. Videos that have barely been shown
  //     to anyone yet, ordered by fewest impressions first.
  add(explorationCandidates(kind, perSource), 'exploration');

  // (f) Creators similar to ones they already watch.
  if (profile.affinity.size) {
    add(similarCreatorCandidates(profile, kind, Math.ceil(perSource / 2)), 'similar');
  }

  return [...pool.values()];
}

/**
 * Shared video query. Only ever returns videos that are publicly visible,
 * finished processing, and not deleted — the baseline every source respects.
 */
function queryVideos({ kind, where = '1=1', params = {}, order = 'v.published_at DESC', limit = 50 }) {
  return db.all(
    `SELECT v.*, c.handle AS channel_handle, c.name AS channel_name,
            c.avatar_url AS channel_avatar, c.follower_count AS channel_followers,
            s.title AS sound_title, s.artist AS sound_artist
       FROM videos v
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN sounds s ON s.id = v.sound_id
      WHERE v.visibility = 'public'
        AND v.processing_status = 'ready'
        AND v.deleted_at IS NULL
        AND v.moderation_status IN ('approved','pending')
        AND c.status = 'active'
        AND (:kind IS NULL OR v.kind = :kind)
        AND ${where}
      ORDER BY ${order}
      LIMIT :limit`,
    { ...params, kind: kind || null, limit }
  );
}

/**
 * EXPLORATION POOL — videos that have not yet had a fair chance.
 *
 * We count how many times each video has been shown to anyone and take the
 * least-shown recent videos. This is what guarantees that a first upload from
 * an account with zero followers actually reaches human eyes.
 */
function explorationCandidates(kind, limit) {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  return db.all(
    `SELECT v.*, c.handle AS channel_handle, c.name AS channel_name,
            c.avatar_url AS channel_avatar, c.follower_count AS channel_followers,
            s.title AS sound_title, s.artist AS sound_artist,
            (SELECT COUNT(*) FROM feed_impressions fi WHERE fi.video_id = v.id) AS impression_count
       FROM videos v
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN sounds s ON s.id = v.sound_id
      WHERE v.visibility = 'public' AND v.processing_status = 'ready'
        AND v.deleted_at IS NULL AND c.status = 'active'
        AND v.moderation_status IN ('approved','pending')
        AND (:kind IS NULL OR v.kind = :kind)
        AND v.published_at > :since
      ORDER BY impression_count ASC, v.published_at DESC
      LIMIT :limit`,
    { kind: kind || null, since, limit }
  );
}

/** Trending candidates, cached briefly because the computation is shared. */
function trendingCandidates(kind, limit) {
  const trending = require('./trending');
  return trending.getTrending({ kind, limit });
}

/**
 * Creators whose videos are watched by people who also watch the creators this
 * viewer likes. A cheap collaborative-filtering signal that needs no ML.
 */
function similarCreatorCandidates(profile, kind, limit) {
  const liked = [...profile.affinity.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  if (!liked.length) return [];

  const placeholders = liked.map((_, i) => `:a${i}`).join(',');
  const params = Object.fromEntries(liked.map((id, i) => [`a${i}`, id]));

  // Find channels co-watched with the viewer's favourites by OTHER users.
  const related = db.all(
    `SELECT v2.channel_id, COUNT(*) AS overlap
       FROM watch_events w1
       JOIN videos v1 ON v1.id = w1.video_id
       JOIN watch_events w2 ON w2.user_id = w1.user_id
       JOIN videos v2 ON v2.id = w2.video_id
      WHERE v1.channel_id IN (${placeholders})
        AND v2.channel_id NOT IN (${placeholders})
        AND w1.user_id IS NOT NULL
      GROUP BY v2.channel_id
      ORDER BY overlap DESC
      LIMIT 10`,
    params
  );
  if (!related.length) return [];

  const ids = related.map((r) => r.channel_id);
  return queryVideos({
    kind,
    where: `v.channel_id IN (${ids.map((_, i) => `:r${i}`).join(',')})`,
    params: Object.fromEntries(ids.map((id, i) => [`r${i}`, id])),
    order: 'v.published_at DESC',
    limit,
  });
}

// ===========================================================================
// STEP 2 — FILTERING
// ===========================================================================

/**
 * Remove anything this viewer must not, or should not, receive. (spec §21)
 *
 * This is a HARD gate. Nothing downstream can score its way back in — which is
 * exactly why filtering happens before ranking rather than as a penalty.
 */
function filtering({ candidates, profile, key }) {
  const cooldown = new Date(Date.now() - TUNING.impressionCooldownHours * 3600_000).toISOString();
  const recentlyShown = new Set(
    db.all(
      'SELECT video_id FROM feed_impressions WHERE user_key = :key AND shown_at > :since',
      { key, since: cooldown }
    ).map((r) => r.video_id)
  );

  return candidates.filter((video) => {
    // Blocked creators are invisible, full stop. (spec §55)
    if (profile.blocked.has(video.creator_id)) return false;

    // Never recommend a video to the person who made it.
    if (profile.userId && video.creator_id === profile.userId) return false;

    // Removed by moderation.
    if (video.moderation_status === 'removed') return false;

    // Copyright outcomes that forbid distribution.
    if (['block', 'restrict'].includes(video.copyright_status)) return false;

    // Already shown recently — keep the feed moving forward.
    if (recentlyShown.has(video.id)) return false;

    // Already watched.
    if (profile.watched.has(video.id)) return false;

    // Must actually be playable.
    if (!video.storage_key) return false;

    return true;
  });
}

// ===========================================================================
// STEP 3 — RANKING
// ===========================================================================

/**
 * Score every candidate. The score is a weighted sum of named components, and
 * each component returns roughly 0..1 (negatives return 0..1 too, and get a
 * negative weight) so the weights in TUNING are directly comparable.
 */
function ranking({ candidates, profile, key }) {
  return candidates
    .map((video) => {
      const components = {
        interestMatch:   scoreInterestMatch(video, profile),
        creatorAffinity: scoreCreatorAffinity(video, profile),
        following:       profile.following.has(video.channel_id) ? 1 : 0,
        quality:         scoreQuality(video),
        engagement:      scoreEngagement(video),
        freshness:       scoreFreshness(video),
        fairness:        scoreFairness(video),
        negative:        scoreNegative(video),
        repetition:      scoreRepetition(video, profile),
      };

      let score = 0;
      for (const [name, value] of Object.entries(components)) {
        score += value * TUNING.weights[name];
      }

      // A small random nudge. Without it the feed is deterministic and every
      // viewer with similar taste sees an identical ordering forever, which
      // quietly re-creates the winner-take-all problem.
      score += Math.random() * 0.35;

      return { ...video, _score: score, _components: components };
    })
    .sort((a, b) => b._score - a._score);
}

/**
 * QUALITY — the most heavily weighted component, and deliberately a RATE.
 *
 * "Did people who saw this actually watch it?" A brand new video with 12 views
 * and 85% completion scores higher here than a video with a million views and
 * 6% completion. This is the core of making the algorithm fair: it measures the
 * video, not the size of the audience it started with.
 */
function scoreQuality(video) {
  const stats = videoWatchStats(video.id);
  if (stats.sessions < 3) {
    // Not enough data to judge. Return a neutral 0.5 rather than 0 — an unproven
    // video must not be punished for being unproven, or nothing new ever rises.
    return 0.5;
  }

  // Completion is capped at 1 even though loops can exceed it; a rewatched
  // 5-second video should not outrank everything on the platform.
  const completion = Math.min(stats.avgCompletion, 1);

  // Replays are a strong positive: people chose to watch it again.
  const replayRate = stats.sessions ? stats.replays / stats.sessions : 0;

  return clamp(completion * 0.8 + Math.min(replayRate, 0.5) * 0.4);
}

/**
 * ENGAGEMENT — likes, comments, shares and saves, all as rates per view.
 *
 * Again rates, not totals, so audience size does not decide this. Saves and
 * shares are weighted highest: they cost the viewer something, so they are
 * harder to fake and a better signal of genuine value than a tap on a heart.
 */
function scoreEngagement(video) {
  const views = Math.max(video.view_count, 1);
  const likeRate = video.like_count / views;
  const commentRate = video.comment_count / views;
  const shareRate = video.share_count / views;
  const saveRate = video.save_count / views;

  // Typical healthy rates are a few percent, so we scale up before clamping.
  return clamp(
    likeRate * 4 + commentRate * 8 + shareRate * 12 + saveRate * 12
  );
}

/**
 * NEGATIVE FEEDBACK — this is what stops the feed optimizing for outrage.
 *
 * Fast skips (viewer swiped away almost immediately) and dislikes push a video
 * DOWN. The weight on this is large and negative on purpose: content that
 * people bounce off should lose, even if it also collects engagement.
 */
function scoreNegative(video) {
  const stats = videoWatchStats(video.id);
  const skipRate = stats.sessions ? stats.skips / stats.sessions : 0;

  const reactions = video.like_count + video.dislike_count;
  const dislikeRate = reactions > 3 ? video.dislike_count / reactions : 0;

  return clamp(skipRate * 0.7 + dislikeRate * 0.6);
}

/**
 * FAIRNESS — the explicit counterweight to rich-get-richer. (spec §61)
 *
 * Two boosts, both bounded so they help without becoming exploitable:
 *
 *   1. Small-channel boost, decaying smoothly as a channel grows. A channel
 *      with 10 followers gets a real lift; one with 100,000 gets none. It is
 *      not a cliff, so there is no threshold to farm.
 *
 *   2. Under-shown boost, for videos below `fairChanceImpressions`. Every video
 *      gets a genuine trial run before the platform decides about it.
 */
function scoreFairness(video) {
  const followers = video.channel_followers || 0;
  // log-based decay: 0 followers -> 1.0, ~1k -> ~0.5, ~100k -> ~0.15
  const smallChannelBoost = 1 / (1 + Math.log10(1 + followers));

  const impressions = videoImpressionCount(video.id);
  const underShown = impressions < TUNING.fairChanceImpressions
    ? 1 - impressions / TUNING.fairChanceImpressions
    : 0;

  return clamp(smallChannelBoost * 0.5 + underShown * 0.5);
}

/**
 * FRESHNESS — exponential decay with a configurable half-life.
 *
 * Smooth decay, not a hard cutoff: a genuinely good week-old video can still
 * surface, it just needs to be better than the new ones.
 */
function scoreFreshness(video) {
  if (!video.published_at) return 0;
  const ageHours = (Date.now() - new Date(video.published_at).getTime()) / 3600_000;
  if (ageHours < 0) return 1;
  return Math.pow(0.5, ageHours / TUNING.freshnessHalfLifeHours);
}

/** Does the category match a topic this viewer likes? */
function scoreInterestMatch(video, profile) {
  if (!profile.interests.size) return 0.3; // neutral for viewers with no profile
  const weight = profile.interests.get(video.category) || 0;
  const max = Math.max(...profile.interests.values(), 1);
  return clamp(weight / max);
}

/** How much has this viewer engaged with this creator before? */
function scoreCreatorAffinity(video, profile) {
  const weight = profile.affinity.get(video.channel_id) || 0;
  if (weight <= 0) return 0;
  const max = Math.max(...profile.affinity.values(), 1);
  return clamp(weight / max);
}

/**
 * REPETITION penalty — "I have had enough of this creator/topic for now."
 *
 * Separate from the hard diversity pass: this softly discourages sameness
 * during ranking, so variety competes on score rather than only being enforced
 * afterwards.
 */
function scoreRepetition(video, profile) {
  const fromCreator = profile.recentCreators.get(video.channel_id) || 0;
  const fromCategory = profile.recentCategories.get(video.category) || 0;
  return clamp(fromCreator / 8 + fromCategory / 20);
}

// ===========================================================================
// STEP 4 — DIVERSITY
// ===========================================================================

/**
 * Enforce variety in the final ordering. (spec §21)
 *
 * Ranking alone will happily return eight videos from the same creator if that
 * creator scores well. This walks the ranked list and skips anything that would
 * break a cap, holding it back for later rather than discarding it.
 *
 * It also guarantees the exploration share: if fewer than
 * `explorationShare` of the chosen items are under-shown videos, we
 * deliberately pull exploration candidates in. Fairness is not left to chance.
 */
function diversity({ ranked, limit }) {
  const chosen = [];
  const held = [];
  const perCreator = new Map();
  const perCategory = new Map();

  const wouldExceedCaps = (video) => {
    const c = perCreator.get(video.channel_id) || 0;
    const k = perCategory.get(video.category) || 0;
    return c >= TUNING.maxPerCreator || k >= TUNING.maxPerCategory;
  };

  const take = (video) => {
    chosen.push(video);
    perCreator.set(video.channel_id, (perCreator.get(video.channel_id) || 0) + 1);
    perCategory.set(video.category, (perCategory.get(video.category) || 0) + 1);
  };

  for (const video of ranked) {
    if (chosen.length >= limit) break;
    if (wouldExceedCaps(video)) { held.push(video); continue; }
    take(video);
  }

  // Guarantee the exploration quota.
  const explorationTarget = Math.floor(chosen.length * TUNING.explorationShare);
  const explorationCount = chosen.filter((v) => v.sources?.includes('exploration')).length;

  if (explorationCount < explorationTarget) {
    const needed = explorationTarget - explorationCount;
    const extras = ranked.filter(
      (v) => v.sources?.includes('exploration') && !chosen.includes(v)
    ).slice(0, needed);

    for (const extra of extras) {
      // Replace the lowest-scoring NON-exploration item, so the quota is met
      // without simply growing the page.
      const replaceIndex = findLastIndex(chosen, (v) => !v.sources?.includes('exploration'));
      if (replaceIndex >= 0) chosen[replaceIndex] = extra;
      else break;
    }
  }

  // If the page is short, we deliberately DO NOT backfill past the caps.
  //
  // On a young platform the candidate pool is often dominated by one prolific
  // creator, and filling the page from `held` would hand them the entire feed —
  // exactly the outcome the caps exist to prevent. A short feed is the honest
  // answer: there genuinely is not more variety to show yet, and the viewer
  // reaches the "you're all caught up" state instead of a wall of one account.
  //
  // `held` is intentionally unused for backfill; it is kept for observability
  // so it is visible how much was set aside by the caps.
  return chosen;
}

// ===========================================================================
// STEP 5 — SAFETY
// ===========================================================================

/**
 * The final policy gate, applied AFTER ranking. (spec §60)
 *
 * Ordering matters enormously here. If safety were a scoring component, a
 * sufficiently engaging piece of harmful content could out-score its own
 * safety penalty. As a separate final pass, it simply cannot be outvoted.
 */
function safetyPass(videos) {
  return videos.filter((video) => {
    if (video.moderation_status === 'removed') return false;
    if (video.moderation_status === 'flagged') return false;
    if (['block', 'restrict'].includes(video.copyright_status)) return false;
    return true;
  });
}

// ===========================================================================
// STEP 6 — IMPRESSIONS
// ===========================================================================

/**
 * Record that these videos were shown. Feeds the "already seen" filter AND the
 * exploration fairness signal, so it must happen for every served feed.
 */
function recordImpressions(userKey, videos) {
  if (!videos.length) return;
  const now = new Date().toISOString();
  db.tx(() => {
    for (const video of videos) {
      db.run(
        `INSERT INTO feed_impressions (user_key, video_id, shown_at)
         VALUES (:key, :videoId, :now)
         ON CONFLICT(user_key, video_id) DO UPDATE SET shown_at = :now`,
        { key: userKey, videoId: video.id, now }
      );
    }
  });
}

// ===========================================================================
// LEARNING — how the profile updates itself
// ===========================================================================

/**
 * Learn from a watch. Called by the video service after each watch heartbeat.
 *
 * The rule: reward what people FINISH, not what they merely open. A tap that
 * bounces in 800ms is negative evidence, and is treated as such.
 */
function learnFromWatch({ userId, video, completion, skippedFast, liked }) {
  if (!userId) return;
  const now = new Date().toISOString();

  // Interest weight: positive for a real watch, negative for a fast skip.
  let delta = 0;
  if (skippedFast) delta = -0.25;
  else if (completion >= 0.8) delta = 0.5;
  else if (completion >= 0.4) delta = 0.25;
  else delta = 0.05;
  if (liked) delta += 0.4;

  bumpInterest(userId, video.category, delta, now);

  // Creator affinity moves with the same evidence, a little more gently.
  bumpAffinity(userId, video.channel_id, delta * 0.8, now);
}

function bumpInterest(userId, topic, delta, now) {
  if (!topic) return;
  const existing = db.get(
    'SELECT weight FROM user_interests WHERE user_id = :u AND topic = :t',
    { u: userId, t: topic }
  );
  if (existing) {
    // Clamp so a single topic cannot dominate forever, and cannot go negative
    // enough to become un-recoverable if taste changes back.
    const weight = clampRange(existing.weight + delta, 0, 10);
    db.run(
      `UPDATE user_interests SET weight = :w, source = 'behavior', updated_at = :now WHERE user_id = :u AND topic = :t`,
      { u: userId, t: topic, w: weight, now }
    );
  } else if (delta > 0) {
    db.run(
      `INSERT INTO user_interests (user_id, topic, weight, source, updated_at)
       VALUES (:u, :t, :w, 'behavior', :now)`,
      { u: userId, t: topic, w: delta, now }
    );
  }
}

function bumpAffinity(userId, channelId, delta, now) {
  const existing = db.get(
    'SELECT weight FROM user_creator_affinity WHERE user_id = :u AND channel_id = :c',
    { u: userId, c: channelId }
  );
  if (existing) {
    db.run(
      'UPDATE user_creator_affinity SET weight = :w, updated_at = :now WHERE user_id = :u AND channel_id = :c',
      { u: userId, c: channelId, w: clampRange(existing.weight + delta, -2, 10), now }
    );
  } else if (delta > 0) {
    db.run(
      `INSERT INTO user_creator_affinity (user_id, channel_id, weight, updated_at)
       VALUES (:u, :c, :w, :now)`,
      { u: userId, c: channelId, w: delta, now }
    );
  }
}

/**
 * Decay every interest weight slightly.
 *
 * Without decay a profile is a permanent record of everything you ever clicked,
 * and the feed slowly becomes a museum of your past self. Run periodically by
 * the worker. (spec §20 — "learn what users appear interested in", present tense)
 */
function decayInterests({ factor = 0.98 } = {}) {
  const now = new Date().toISOString();
  db.run(`UPDATE user_interests SET weight = weight * :factor, updated_at = :now WHERE source = 'behavior'`,
    { factor, now });
  db.run('UPDATE user_creator_affinity SET weight = weight * :factor, updated_at = :now',
    { factor, now });
  // Drop weights that have decayed into noise.
  db.run(`DELETE FROM user_interests WHERE weight < 0.05 AND source = 'behavior'`);
  db.run('DELETE FROM user_creator_affinity WHERE weight < 0.05');
}

/** Save the interests a user picks during onboarding. (spec §22) */
function setOnboardingInterests(userId, topics) {
  const now = new Date().toISOString();
  db.tx(() => {
    db.run(`DELETE FROM user_interests WHERE user_id = :u AND source = 'onboarding'`, { u: userId });
    for (const topic of topics) {
      if (!TOPICS.includes(topic)) continue;
      db.run(
        `INSERT INTO user_interests (user_id, topic, weight, source, updated_at)
         VALUES (:u, :t, 2.0, 'onboarding', :now)
         ON CONFLICT(user_id, topic) DO UPDATE SET weight = 2.0, updated_at = :now`,
        { u: userId, t: topic, now }
      );
    }
    db.run('UPDATE users SET onboarded = 1, updated_at = :now WHERE id = :u', { u: userId, now });
  });
  return { topics };
}

// ===========================================================================
// HELPERS
// ===========================================================================

/**
 * Watch statistics for one video, cached for 60s.
 * Ranking touches this once per candidate, so the cache matters.
 */
function videoWatchStats(videoId) {
  return cache.remember(`watchstats:${videoId}`, 60, () => {
    const row = db.get(
      `SELECT COUNT(*) AS sessions, COALESCE(AVG(completion),0) AS avg_completion,
              COALESCE(SUM(replayed),0) AS replays, COALESCE(SUM(skipped_fast),0) AS skips
         FROM watch_events WHERE video_id = :id`,
      { id: videoId }
    );
    return {
      sessions: row.sessions,
      avgCompletion: row.avg_completion,
      replays: row.replays,
      skips: row.skips,
    };
  });
}

function videoImpressionCount(videoId) {
  return cache.remember(`impressions:${videoId}`, 120, () => {
    const row = db.get('SELECT COUNT(*) AS c FROM feed_impressions WHERE video_id = :id', { id: videoId });
    return row.c;
  });
}

/**
 * Platform-wide state. This is what powers "the platform knows it is new"
 * (spec §8, §62) — nothing is hard-coded; the UI reacts to these numbers.
 */
function platformState() {
  return cache.remember('platform:state', 30, () => {
    const videos = db.get(
      `SELECT COUNT(*) AS c FROM videos
        WHERE visibility='public' AND processing_status='ready' AND deleted_at IS NULL`
    );
    const creators = db.get('SELECT COUNT(*) AS c FROM channels WHERE video_count > 0');
    const users = db.get(`SELECT COUNT(*) AS c FROM users WHERE status='active'`);

    // The stage the platform is in decides which copy and which feed sections
    // the frontend shows. It transitions automatically as content arrives.
    let stage = 'empty';
    if (videos.c > 0) stage = 'seedling';
    if (videos.c >= 25) stage = 'growing';
    if (videos.c >= 250) stage = 'established';

    return {
      publicVideoCount: videos.c,
      creatorCount: creators.c,
      userCount: users.c,
      stage,
      isNewPlatform: stage === 'empty' || stage === 'seedling',
    };
  });
}

const clamp = (n) => Math.max(0, Math.min(1, n));
const clampRange = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function findLastIndex(array, predicate) {
  for (let i = array.length - 1; i >= 0; i--) if (predicate(array[i])) return i;
  return -1;
}

module.exports = {
  buildFeed, buildUserProfile, platformState,
  candidateGeneration, filtering, ranking, diversity, safetyPass,
  learnFromWatch, decayInterests, setOnboardingInterests,
  scoreQuality, scoreEngagement, scoreFairness, scoreFreshness, scoreNegative,
  TUNING, TOPICS,
};
