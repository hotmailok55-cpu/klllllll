'use strict';

/**
 * Central event bus (spec §27).
 *
 * Services PUBLISH domain events; other services SUBSCRIBE to them. This is how
 * we keep services decoupled: the video service does not know that liking a
 * video should create a notification — it just emits VIDEO_LIKED, and the
 * notification service reacts.
 *
 * Every published event is also persisted to `analytics_events` so analytics
 * and view-counting can be recomputed from the event log rather than trusting
 * mutable counters (spec §14, §28).
 *
 * This in-process implementation is deliberately simple. In production you swap
 * the internals for a real message queue (SQS/Kafka/Redis Streams) — the
 * `publish` / `subscribe` surface stays the same, so services don't change.
 */

const { logger } = require('./logger');

/** Canonical event names. Keep this list as the source of truth. */
const EVENTS = Object.freeze({
  USER_REGISTERED: 'USER_REGISTERED',
  CHANNEL_CREATED: 'CHANNEL_CREATED',
  VIDEO_UPLOADED: 'VIDEO_UPLOADED',
  VIDEO_PROCESSED: 'VIDEO_PROCESSED',
  VIDEO_PUBLISHED: 'VIDEO_PUBLISHED',
  VIDEO_VIEWED: 'VIDEO_VIEWED',
  VIDEO_LIKED: 'VIDEO_LIKED',
  VIDEO_DISLIKED: 'VIDEO_DISLIKED',
  VIDEO_SHARED: 'VIDEO_SHARED',
  COMMENT_CREATED: 'COMMENT_CREATED',
  COMMENT_LIKED: 'COMMENT_LIKED',
  USER_FOLLOWED: 'USER_FOLLOWED',
  REPORT_CREATED: 'REPORT_CREATED',
  MODERATION_DECIDED: 'MODERATION_DECIDED',
  COPYRIGHT_DECIDED: 'COPYRIGHT_DECIDED',
});

const handlers = new Map(); // eventName -> Set<handler>

/** Subscribe a handler to an event. Returns an unsubscribe function. */
function subscribe(eventName, handler) {
  if (!handlers.has(eventName)) handlers.set(eventName, new Set());
  handlers.get(eventName).add(handler);
  return () => handlers.get(eventName)?.delete(handler);
}

// Injected by the analytics service to persist the event stream, so core has
// no hard dependency on a service. Set via `setEventSink`.
let sink = null;
function setEventSink(fn) { sink = fn; }

/**
 * Publish an event. Handlers run asynchronously and are isolated: one throwing
 * handler never breaks the publisher or the other handlers.
 *
 * @param {string} eventName one of EVENTS
 * @param {object} payload   plain data describing what happened
 */
function publish(eventName, payload = {}) {
  const event = {
    name: eventName,
    at: new Date().toISOString(),
    payload,
  };

  // Persist to the event log (fire-and-forget; never blocks the request).
  if (sink) {
    Promise.resolve()
      .then(() => sink(event))
      .catch((err) => logger.error('events', 'event sink failed', { eventName, error: err.message }));
  }

  const subs = handlers.get(eventName);
  if (subs) {
    for (const handler of subs) {
      Promise.resolve()
        .then(() => handler(event))
        .catch((err) => logger.error('events', 'handler failed', { eventName, error: err.message }));
    }
  }
  return event;
}

module.exports = { EVENTS, subscribe, publish, setEventSink };
