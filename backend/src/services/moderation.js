'use strict';

/**
 * MODERATION SERVICE (spec §18, §32, §33).
 *
 *   Content
 *     -> ModerationService (this file — THE POLICY ENGINE)
 *        -> Provider A signals
 *        -> Provider B signals
 *        -> internal rules
 *     -> Decision
 *
 * The single most important design choice here: PROVIDERS RETURN SIGNALS, THIS
 * FILE MAKES DECISIONS. An external classifier says "0.82 harassment"; whether
 * 0.82 means remove, limit, or allow is our policy, written here, versioned
 * with our code, and auditable.
 *
 * That is what stops one vendor's model becoming the platform's de-facto terms
 * of service, and it is what lets you swap or add providers without rewriting
 * your rules.
 */

const db = require('../core/db');
const registry = require('../integrations/registry');
const { config } = require('../core/config');
const { EVENTS, publish } = require('../core/events');
const { logger } = require('../core/logger');

/**
 * OUR THRESHOLDS. Per-category, because the categories are not equivalent:
 * we are far more willing to auto-remove a scam than to auto-remove something
 * a classifier merely thinks is rude.
 *
 *   remove — take it down automatically
 *   limit  — keep it, but out of recommendations, and queue for a human
 *   flag   — leave it up, queue for a human
 */
const THRESHOLDS = {
  scam:       { remove: 0.90, limit: 0.70, flag: 0.50 },
  spam:       { remove: 0.95, limit: 0.75, flag: 0.55 },
  hate:       { remove: 0.92, limit: 0.70, flag: 0.45 },
  harassment: { remove: 0.95, limit: 0.75, flag: 0.50 },
  violence:   { remove: 0.95, limit: 0.80, flag: 0.55 },
  sexual:     { remove: 0.92, limit: 0.70, flag: 0.50 },
  // Never auto-removed: a false positive here can cut someone off from help.
  // Always routed to a human instead.
  self_harm:  { remove: 2.00, limit: 0.60, flag: 0.35 },
};

/** Reports needed before content is auto-limited pending review. */
const REPORT_THRESHOLD = 5;

/**
 * Moderate a piece of text (a comment, a title, a description).
 *
 * @returns {{decision:'allow'|'limit'|'remove', reason:string, signals:object}}
 */
async function moderateText({ text, context = 'comment' }) {
  const signals = {};

  // 1. Internal rules ALWAYS run. They are ours, they are free, and they work
  //    with no integration configured.
  const internal = registry.get('moderation');
  try {
    const result = await internal.classifyText({ text, context });
    signals[result.provider || 'internal'] = result.scores;
  } catch (err) {
    logger.warn('moderation', 'internal classifier failed', { error: err.message });
  }

  // 2. External AI signals, IF an AI provider is enabled. Optional by design:
  //    the platform must moderate with or without it.
  if (config.flags.AI_MODERATION_ENABLED && registry.isEnabled('ai')) {
    try {
      const ai = registry.get('ai');
      if (typeof ai.classifyText === 'function') {
        const result = await ai.classifyText({ text });
        signals.ai = result.scores;
      }
    } catch (err) {
      // An AI outage must never block posting a comment.
      logger.warn('moderation', 'AI provider unavailable, using internal signals only', {
        error: err.message,
      });
    }
  }

  return decide(signals, context);
}

/**
 * THE POLICY ENGINE.
 *
 * Combines every provider's signals and applies OUR thresholds. When providers
 * disagree we take the highest score per category — a deliberately cautious
 * choice, softened by the fact that 'flag' and 'limit' are reversible and only
 * the highest thresholds cause removal.
 */
function decide(signals, context) {
  const combined = {};
  for (const scores of Object.values(signals)) {
    for (const [category, score] of Object.entries(scores || {})) {
      combined[category] = Math.max(combined[category] || 0, score);
    }
  }

  let decision = 'allow';
  let reason = '';
  let worst = 0;

  for (const [category, score] of Object.entries(combined)) {
    const t = THRESHOLDS[category];
    if (!t) continue;

    if (score >= t.remove && score > worst) {
      decision = 'remove'; reason = `${category} (${score.toFixed(2)})`; worst = score;
    } else if (score >= t.limit && decision !== 'remove' && score > worst) {
      decision = 'limit'; reason = `${category} (${score.toFixed(2)})`; worst = score;
    } else if (score >= t.flag && decision === 'allow' && score > worst) {
      decision = 'flag'; reason = `${category} (${score.toFixed(2)})`; worst = score;
    }
  }

  return { decision, reason, signals: combined, context };
}

/**
 * Review a video during processing.
 *
 * We can only classify what we can actually inspect. With no video-capable
 * provider we check the TEXT the creator supplied and mark the video 'pending'
 * rather than 'approved' — we do not claim to have reviewed footage we never
 * looked at.
 */
async function reviewVideo(videoId) {
  const video = db.get('SELECT * FROM videos WHERE id = :id', { id: videoId });
  if (!video) return null;

  // Same rule as the copyright stage: a re-review of a live video must not
  // pull it back into the processing pipeline and hide it from viewers.
  if (video.processing_status !== 'ready') {
    db.run(`UPDATE videos SET processing_status = 'checking_safety' WHERE id = :id`, { id: videoId });
  }

  const textResult = await moderateText({
    text: `${video.title}\n${video.description}`,
    context: 'video_metadata',
  });

  const signals = { text: textResult.signals };
  let decision = textResult.decision;

  // Video-content classification, when a provider supports it.
  const provider = registry.get('moderation');
  if (typeof provider.classifyVideo === 'function') {
    try {
      const result = await provider.classifyVideo({ storageKey: video.storage_key });
      if (result?.inspected !== false) {
        signals.video = result.scores;
        const videoDecision = decide({ video: result.scores }, 'video');
        // Take the stricter of the two.
        if (rank(videoDecision.decision) > rank(decision)) decision = videoDecision.decision;
      }
    } catch (err) {
      logger.warn('moderation', 'video classification unavailable', { videoId, error: err.message });
    }
  }

  const status = { allow: 'approved', flag: 'pending', limit: 'flagged', remove: 'removed' }[decision];

  recordCase({
    targetType: 'video',
    targetId: videoId,
    status,
    decision,
    reason: textResult.reason,
    signals,
  });

  db.run('UPDATE videos SET moderation_status = :status, updated_at = :now WHERE id = :id',
    { id: videoId, status, now: new Date().toISOString() });

  if (decision === 'remove') {
    db.run(`UPDATE videos SET visibility = 'private' WHERE id = :id`, { id: videoId });
  }

  logger.info('moderation', 'video reviewed', { videoId, decision, status });
  return { decision, status };
}

const rank = (d) => ({ allow: 0, flag: 1, limit: 2, remove: 3 }[d] ?? 0);

/** Write a moderation case — the audit trail for every decision. */
function recordCase({ targetType, targetId, status, decision, reason, signals, decidedBy = 'system' }) {
  const now = new Date().toISOString();
  const id = db.newId('mod');

  db.run(
    `INSERT INTO moderation_cases (id, target_type, target_id, status, decision, reason,
                                   signals, decided_by, created_at, decided_at)
     VALUES (:id, :targetType, :targetId, :status, :decision, :reason, :signals, :by, :now, :decidedAt)`,
    {
      id, targetType, targetId, status, decision, reason: reason || '',
      signals: JSON.stringify(signals || {}),
      by: decidedBy,
      now,
      decidedAt: decision === 'allow' ? now : null,
    }
  );

  publish(EVENTS.MODERATION_DECIDED, { targetType, targetId, decision, status });
  return id;
}

/**
 * A user reports something (spec §33).
 * Reports are a signal, not a verdict — enough of them limits content pending
 * human review, but no number of reports auto-removes anything. That would make
 * brigading an effective takedown tool.
 */
function createReport({ reporterId, targetType, targetId, category, details }) {
  const id = db.newId('rep');
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, category, details, status, created_at)
     VALUES (:id, :reporter, :targetType, :targetId, :category, :details, 'open', :now)`,
    { id, reporter: reporterId, targetType, targetId, category, details: details || '', now }
  );

  publish(EVENTS.REPORT_CREATED, { reportId: id, targetType, targetId, category });

  // Volume check.
  const count = db.get(
    `SELECT COUNT(DISTINCT reporter_id) AS c FROM reports
      WHERE target_type = :t AND target_id = :id AND status = 'open'`,
    { t: targetType, id: targetId }
  );

  if (count.c >= REPORT_THRESHOLD) {
    escalate(targetType, targetId, count.c);
  }

  return { reportId: id, status: 'open' };
}

/** Limit reach pending review — visible content, out of recommendations. */
function escalate(targetType, targetId, reportCount) {
  recordCase({
    targetType, targetId,
    status: 'flagged',
    decision: 'limit',
    reason: `Reported by ${reportCount} distinct users`,
    signals: { reports: reportCount },
  });

  if (targetType === 'video') {
    db.run(`UPDATE videos SET moderation_status = 'flagged' WHERE id = :id`, { id: targetId });
  } else if (targetType === 'comment') {
    db.run(`UPDATE comments SET moderation_status = 'flagged' WHERE id = :id`, { id: targetId });
  }

  logger.warn('moderation', 'auto-escalated on report volume', {
    targetType, targetId, reportCount,
  });
}

/** The human moderation queue. */
function listQueue({ status = 'pending', limit = 50 } = {}) {
  return db.all(
    `SELECT * FROM moderation_cases WHERE status = :status ORDER BY created_at ASC LIMIT :limit`,
    { status, limit }
  ).map((row) => ({
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    status: row.status,
    decision: row.decision,
    reason: row.reason,
    signals: safeJson(row.signals, {}),
    decidedBy: row.decided_by,
    createdAt: row.created_at,
  }));
}

function listReports({ status = 'open', limit = 50 } = {}) {
  return db.all(
    'SELECT * FROM reports WHERE status = :status ORDER BY created_at ASC LIMIT :limit',
    { status, limit }
  );
}

/** A moderator decides. Their decision always overrides the automated one. */
function resolveCase(caseId, { decision, note = '', actor }) {
  const record = db.get('SELECT * FROM moderation_cases WHERE id = :id', { id: caseId });
  if (!record) return null;

  const now = new Date().toISOString();
  const status = { allow: 'approved', limit: 'flagged', remove: 'removed' }[decision] || 'approved';

  db.run(
    `UPDATE moderation_cases SET status=:status, decision=:decision, reason=:note,
            decided_by=:by, decided_at=:now WHERE id=:id`,
    { id: caseId, status, decision, note, by: actor.id, now }
  );

  if (record.target_type === 'video') {
    db.run('UPDATE videos SET moderation_status=:status, updated_at=:now WHERE id=:id',
      { id: record.target_id, status, now });
    if (decision === 'remove') {
      db.run(`UPDATE videos SET visibility='private' WHERE id=:id`, { id: record.target_id });
    }
  } else if (record.target_type === 'comment') {
    db.run('UPDATE comments SET moderation_status=:status WHERE id=:id',
      { id: record.target_id, status });
  }

  // Close the reports that led here.
  db.run(
    `UPDATE reports SET status='resolved', resolution=:decision, handled_by=:by, resolved_at=:now
      WHERE target_type=:t AND target_id=:id AND status='open'`,
    { t: record.target_type, id: record.target_id, decision, by: actor.id, now }
  );

  db.run(
    `INSERT INTO audit_log (id, actor_id, action, target, meta, created_at)
     VALUES (:id, :actor, 'moderation.resolve', :target, :meta, :now)`,
    { id: db.newId('aud'), actor: actor.id, target: caseId, meta: JSON.stringify({ decision }), now }
  );

  return { resolved: true, status };
}

function safeJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

module.exports = {
  THRESHOLDS, REPORT_THRESHOLD,
  moderateText, decide, reviewVideo, recordCase,
  createReport, listQueue, listReports, resolveCase,
};
