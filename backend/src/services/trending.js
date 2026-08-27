'use strict';

/**
 * TRENDING SERVICE (spec §23).
 *
 * Trending is NOT "most lifetime views". That list barely changes and always
 * shows the same videos, which makes it useless as a discovery surface.
 *
 * Trending here means VELOCITY: what is growing right now, relative to its own
 * recent history. A video that jumped from 20 views to 400 views today is more
 * "trending" than one sitting at a steady million.
 *
 * The score combines:
 *   - recent view velocity      (views in the last window vs the window before)
 *   - engagement in the window  (likes/comments/shares, as rates)
 *   - unique viewers            (breadth, not one person on repeat)
 *   - watch quality             (are people actually watching it through?)
 *   - manipulation penalty      (concentrated or bot-like traffic loses)
 */

const db = require('../core/db');
const cache = require('../core/cache');

const CONFIG = {
  windowHours: 24,        // the "now" window
  compareWindowHours: 48, // the window before, for growth comparison
  minViewsToQualify: 5,   // avoid noise from 1-2 view videos
  cacheSeconds: 120,
};

/**
 * Get trending videos.
 * Cached briefly — this is a relatively expensive query and every viewer sees
 * substantially the same answer.
 */
function getTrending({ kind = null, category = null, limit = 20 } = {}) {
  const cacheKey = `trending:${kind || 'all'}:${category || 'all'}:${limit}`;
  return cache.remember(cacheKey, CONFIG.cacheSeconds, () => compute({ kind, category, limit }));
}

function compute({ kind, category, limit }) {
  const now = Date.now();
  const windowStart = new Date(now - CONFIG.windowHours * 3600_000).toISOString();
  const priorStart = new Date(now - CONFIG.compareWindowHours * 3600_000).toISOString();

  // Candidates: anything that got views in the recent window.
  const candidates = db.all(
    `SELECT v.*, c.handle AS channel_handle, c.name AS channel_name,
            c.avatar_url AS channel_avatar, c.follower_count AS channel_followers,
            s.title AS sound_title, s.artist AS sound_artist,
            (SELECT COUNT(*) FROM view_events e
              WHERE e.video_id = v.id AND e.created_at > :windowStart) AS recent_views,
            (SELECT COUNT(*) FROM view_events e
              WHERE e.video_id = v.id AND e.created_at > :priorStart
                AND e.created_at <= :windowStart) AS prior_views,
            (SELECT COUNT(DISTINCT e.viewer_key) FROM view_events e
              WHERE e.video_id = v.id AND e.created_at > :windowStart) AS unique_viewers,
            (SELECT COALESCE(AVG(w.completion),0) FROM watch_events w
              WHERE w.video_id = v.id AND w.created_at > :windowStart) AS avg_completion
       FROM videos v
       JOIN channels c ON c.id = v.channel_id
       LEFT JOIN sounds s ON s.id = v.sound_id
      WHERE v.visibility = 'public'
        AND v.processing_status = 'ready'
        AND v.deleted_at IS NULL
        AND v.moderation_status IN ('approved','pending')
        AND v.copyright_status NOT IN ('block','restrict')
        AND c.status = 'active'
        AND (:kind IS NULL OR v.kind = :kind)
        AND (:category IS NULL OR v.category = :category)
        AND v.published_at IS NOT NULL
      ORDER BY recent_views DESC
      LIMIT 200`,
    { windowStart, priorStart, kind: kind || null, category: category || null }
  );

  const scored = candidates
    .filter((v) => v.recent_views >= CONFIG.minViewsToQualify)
    .map((v) => ({ ...v, _trendScore: trendScore(v), sources: ['trending'] }))
    .sort((a, b) => b._trendScore - a._trendScore);

  return scored.slice(0, limit);
}

/**
 * The trending score for one video.
 * Each term is explained because tuning this by feel is how trending pages go
 * wrong.
 */
function trendScore(v) {
  // --- 1. GROWTH. The core of "trending" ---
  // Ratio of this window to the previous one. +1 on the denominator so a video
  // going 0 -> 50 is a huge jump without dividing by zero.
  const growth = (v.recent_views + 1) / (v.prior_views + 1);
  // Log-scale it: 10x growth should beat 5x, but not by 2x in the final score.
  const growthScore = Math.log2(1 + growth);

  // --- 2. VOLUME, dampened ---
  // Recent views matter, but on a log scale so a mega-video cannot simply buy
  // the top spot with raw numbers.
  const volumeScore = Math.log10(1 + v.recent_views);

  // --- 3. BREADTH ---
  // The ratio of unique viewers to views. Near 1 means lots of different
  // people; low means a few accounts watching repeatedly, which is either
  // niche-obsessive or manipulation. Either way it is not "trending".
  const breadth = v.recent_views > 0 ? v.unique_viewers / v.recent_views : 0;

  // --- 4. QUALITY ---
  // Are the people arriving actually watching? Stops clickbait trending.
  const quality = Math.min(v.avg_completion, 1);

  // --- 5. ENGAGEMENT, as a rate ---
  const views = Math.max(v.view_count, 1);
  const engagement = Math.min(
    (v.like_count / views) * 3 + (v.comment_count / views) * 6 + (v.share_count / views) * 9,
    1
  );

  // --- 6. MANIPULATION PENALTY (spec §23) ---
  // Very low breadth alongside a large view count is the signature of inflated
  // traffic. Penalize rather than hard-block: legitimate niche content can look
  // similar, and a human should make the removal call, not this function.
  const suspicious = breadth < 0.3 && v.recent_views > 50 ? 0.5 : 1;

  return (
    growthScore * 3.0 +
    volumeScore * 1.5 +
    breadth * 2.0 +
    quality * 2.5 +
    engagement * 2.0
  ) * suspicious;
}

/** Trending sounds — "what audio is everyone using right now". */
function getTrendingSounds({ limit = 20 } = {}) {
  return cache.remember(`trending:sounds:${limit}`, CONFIG.cacheSeconds, () => {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    return db.all(
      `SELECT s.*,
              (SELECT COUNT(*) FROM videos v
                WHERE v.sound_id = s.id AND v.created_at > :since
                  AND v.deleted_at IS NULL AND v.visibility='public') AS recent_uses
         FROM sounds s
        WHERE s.rights_status IN ('cleared','unknown')
        ORDER BY recent_uses DESC, s.use_count DESC
        LIMIT :limit`,
      { since, limit }
    );
  });
}

/** Invalidate cached trending data — call after significant content changes. */
function invalidate() {
  cache.invalidate('trending:', { prefix: true });
}

module.exports = { getTrending, getTrendingSounds, trendScore, invalidate, CONFIG };
