'use strict';

/**
 * COPYRIGHT SERVICE (spec §30, §81).
 *
 *   Video upload
 *     -> CopyrightService (this file — OUR policy)
 *        -> Copyright provider adapter (translation only)
 *           -> External API
 *     -> Copyright case record
 *     -> Action
 *
 * TWO IDEAS KEPT DELIBERATELY SEPARATE
 *
 *   DETECTION  — "this audio matches a known recording"
 *   LICENSING  — "we are permitted to use this recording"
 *
 * These are not the same thing and the platform never conflates them. A
 * detection provider telling us what a track IS does not tell us we may USE it.
 * `license_state` is a separate column, defaults to 'unknown', and is only set
 * to 'licensed' when a provider explicitly says the usage is granted or a
 * licence record exists on our side.
 *
 * WHAT HAPPENS WHEN THE PROVIDER IS DOWN
 *
 * The result is 'unavailable' — never 'clear'. The video is marked "copyright
 * check pending" and stays publishable, because a provider outage must not
 * become a de-facto ban on uploading (spec §35). It also must not become a
 * silent free pass: the case stays open and the admin queue shows it.
 */

const db = require('../core/db');
const registry = require('../integrations/registry');
const { config } = require('../core/config');
const { EVENTS, publish } = require('../core/events');
const { logger } = require('../core/logger');

/**
 * What the platform DOES for each detection result.
 *
 * This mapping is our policy, in our code — not the vendor's. A different
 * agreement or jurisdiction changes this table, and nothing else.
 */
const POLICY = {
  clear:       { action: 'none',             visibility: 'allow' },
  review:      { action: 'none',             visibility: 'allow' },  // allow, flag for humans
  match:       { action: 'none',             visibility: 'allow' },  // attribute, do not punish
  claim:       { action: 'none',             visibility: 'allow' },  // rightsholder claims revenue
  restrict:    { action: 'limit_visibility', visibility: 'limit' },
  block:       { action: 'block',            visibility: 'block' },
  unavailable: { action: 'none',             visibility: 'allow' },  // pending, not cleared
};

/**
 * Run the copyright check for one video. Called from the processing pipeline.
 */
async function checkVideo(videoId) {
  const video = db.get('SELECT * FROM videos WHERE id = :id', { id: videoId });
  if (!video) return null;

  // Feature-flagged off: record why, do not pretend it passed.
  if (!config.flags.COPYRIGHT_CHECK_ENABLED) {
    return recordCase(videoId, {
      provider: 'disabled',
      result: 'unavailable',
      licenseState: 'unknown',
      note: 'Copyright checking is disabled by configuration.',
    });
  }

  // Only advance the pipeline status while the video is still IN the pipeline.
  // A re-check on an already-published video (a manual re-scan, or a new
  // provider being connected later) must never knock it back into "processing"
  // and make it disappear for viewers.
  if (video.processing_status !== 'ready') {
    db.run(`UPDATE videos SET processing_status = 'checking_copyright' WHERE id = :id`, { id: videoId });
  }

  const provider = registry.get('copyright');
  let outcome;

  try {
    outcome = await provider.scanVideo({
      videoId,
      storageKey: video.storage_key,
      durationMs: video.duration_ms,
      soundId: video.sound_id,
    });
  } catch (err) {
    // Provider failure (including an open circuit breaker). Degrade, do not
    // block: the creator sees "check pending", not an error.
    logger.warn('copyright', 'provider unavailable, marking pending', {
      videoId, error: err.message,
    });
    return recordCase(videoId, {
      provider: provider.providerName,
      result: 'unavailable',
      licenseState: 'unknown',
      note: `Copyright check could not run: ${err.message}`,
    });
  }

  return recordCase(videoId, {
    provider: provider.providerName,
    result: outcome.result || 'review',
    confidence: outcome.confidence,
    matchedWork: outcome.matchedWork,
    matchedRef: outcome.matchedRef,
    // Trust ONLY an explicit 'licensed'. Anything else stays unknown.
    licenseState: outcome.licenseState === 'licensed' ? 'licensed' : 'unknown',
    note: outcome.note || '',
    raw: outcome.raw,
  });
}

/** Write the case, apply the policy, and update the video. */
function recordCase(videoId, {
  provider, result, confidence = null, matchedWork = null, matchedRef = null,
  licenseState = 'unknown', note = '', raw = null,
}) {
  const policy = POLICY[result] || POLICY.review;
  const now = new Date().toISOString();

  // A match that we DO hold a licence for is not a problem — downgrade the
  // action. This is exactly why licence state is tracked separately.
  const effectiveAction = licenseState === 'licensed' ? 'none' : policy.action;

  const caseId = db.newId('cpr');
  db.run(
    `INSERT INTO copyright_cases (id, video_id, provider, result, matched_work, matched_ref,
                                  confidence, license_state, license_note, action_taken,
                                  raw_response, status, created_at)
     VALUES (:id, :videoId, :provider, :result, :work, :ref, :confidence,
             :licenseState, :note, :action, :raw, :status, :now)`,
    {
      id: caseId, videoId, provider, result,
      work: matchedWork, ref: matchedRef, confidence,
      licenseState, note, action: effectiveAction,
      raw: raw ? JSON.stringify(raw).slice(0, 20000) : null,
      // 'clear' resolves immediately; everything else stays open for review.
      status: result === 'clear' ? 'resolved' : 'open',
      now,
    }
  );

  db.run('UPDATE videos SET copyright_status = :status, updated_at = :now WHERE id = :id',
    { id: videoId, status: result === 'unavailable' ? 'pending' : result, now });

  // Apply the action.
  if (effectiveAction === 'block') {
    db.run(`UPDATE videos SET visibility = 'private', updated_at = :now WHERE id = :id`,
      { id: videoId, now });
  } else if (effectiveAction === 'limit_visibility') {
    db.run(`UPDATE videos SET visibility = 'unlisted', updated_at = :now WHERE id = :id`,
      { id: videoId, now });
  }

  publish(EVENTS.COPYRIGHT_DECIDED, { videoId, result, action: effectiveAction, licenseState });

  logger.info('copyright', 'case recorded', {
    videoId, provider, result, action: effectiveAction, licenseState,
  });

  return { caseId, result, action: effectiveAction, licenseState, note };
}

/** Cases for one creator — the Studio's copyright tab. */
function listForCreator(userId, { status = null } = {}) {
  return db.all(
    `SELECT cc.*, v.title AS video_title
       FROM copyright_cases cc
       JOIN videos v ON v.id = cc.video_id
      WHERE v.creator_id = :userId
        AND (:status IS NULL OR cc.status = :status)
      ORDER BY cc.created_at DESC
      LIMIT 100`,
    { userId, status }
  ).map(present);
}

/** The admin queue of unresolved cases. */
function listQueue({ status = 'open', limit = 50 } = {}) {
  return db.all(
    `SELECT cc.*, v.title AS video_title, v.creator_id
       FROM copyright_cases cc
       JOIN videos v ON v.id = cc.video_id
      WHERE cc.status = :status
      ORDER BY cc.created_at ASC LIMIT :limit`,
    { status, limit }
  ).map(present);
}

/**
 * A human resolves a case — including recording that we hold a licence, which
 * is the manual counterpart to a provider's rights response.
 */
function resolveCase(caseId, { decision, note = '', licenseState, actor }) {
  const record = db.get('SELECT * FROM copyright_cases WHERE id = :id', { id: caseId });
  if (!record) return null;

  const now = new Date().toISOString();
  db.run(
    `UPDATE copyright_cases
        SET status = 'resolved', action_taken = :decision, license_note = :note,
            license_state = COALESCE(:licenseState, license_state), resolved_at = :now
      WHERE id = :id`,
    { id: caseId, decision, note, licenseState: licenseState || null, now }
  );

  // Restore visibility if a human cleared it.
  if (decision === 'none') {
    db.run(`UPDATE videos SET copyright_status = 'clear', updated_at = :now WHERE id = :id`,
      { id: record.video_id, now });
  } else if (decision === 'block') {
    db.run(`UPDATE videos SET copyright_status = 'block', visibility = 'private', updated_at = :now WHERE id = :id`,
      { id: record.video_id, now });
  }

  db.run(
    `INSERT INTO audit_log (id, actor_id, action, target, meta, created_at)
     VALUES (:id, :actor, 'copyright.resolve', :target, :meta, :now)`,
    {
      id: db.newId('aud'), actor: actor?.id || null, target: caseId,
      meta: JSON.stringify({ decision, licenseState }), now,
    }
  );

  return { resolved: true };
}

function present(row) {
  return {
    id: row.id,
    videoId: row.video_id,
    videoTitle: row.video_title,
    provider: row.provider,
    result: row.result,
    matchedWork: row.matched_work,
    confidence: row.confidence,
    licenseState: row.license_state,
    licenseNote: row.license_note,
    actionTaken: row.action_taken,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    // Plain-language explanation for the creator.
    explanation: explain(row),
  };
}

/** Turn a case into something a creator can actually act on. */
function explain(row) {
  switch (row.result) {
    case 'clear':
      return 'No copyright matches were found.';
    case 'review':
      return 'This video needs a closer look. It stays visible while we check.';
    case 'match':
      return `Matched ${row.matched_work || 'a known work'}. The rightsholder has been credited; your video is unaffected.`;
    case 'claim':
      return `${row.matched_work || 'A rightsholder'} has claimed this content. Your video stays up; any revenue goes to them.`;
    case 'restrict':
      return 'This content is restricted, so the video is unlisted. You can dispute this if you have the rights.';
    case 'block':
      return 'This video matched protected content and cannot be published. You can dispute this if you have the rights.';
    default:
      return 'The copyright check has not finished yet. Your video is not affected while we wait.';
  }
}

module.exports = { checkVideo, recordCase, listForCreator, listQueue, resolveCase, POLICY };
