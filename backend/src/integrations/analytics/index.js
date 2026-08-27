'use strict';

/**
 * ANALYTICS capability — optionally MIRROR events to an external product
 * analytics tool.
 *
 * Contract:
 *   track({ name, actorId, subjectId, payload, at }) -> { accepted }
 *
 * The platform's own analytics never depend on this. Every event is always
 * written to our `analytics_events` table first (services/analytics.js); this
 * integration is an extra copy for teams that also want an external dashboard.
 * If it fails, creator analytics keep working. (spec §67 — no vendor lock-in)
 */

const { BaseProvider } = require('../BaseProvider');

/** Default: internal-only. Events stay in our database. */
class InternalAnalyticsProvider extends BaseProvider {
  constructor(settings) { super('internal', settings); }

  async track() {
    // Already persisted by services/analytics.js; nothing to forward.
    return { accepted: true };
  }

  async healthCheck() {
    return { message: 'Using the built-in event store. No external analytics provider is connected.' };
  }

  isConfigured() { return true; }
}

/** EXAMPLE adapter template. */
class ExampleAnalyticsProvider extends BaseProvider {
  constructor(settings) {
    super('example', settings);
    this.apiUrl = settings.apiUrl || 'https://api.example-analytics.invalid/v1';
  }

  async track({ name, actorId, subjectId, payload, at }) {
    const { body } = await this.request(`${this.apiUrl}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.apiKey}` },
      // Note: we send IDs, never emails or other personal data. (spec §69)
      body: { event: name, user_id: actorId, object_id: subjectId, properties: payload, timestamp: at },
    });
    return { accepted: body?.ok === true };
  }

  async healthCheck() {
    if (!this.settings.apiKey) throw new Error('ANALYTICS_API_KEY is not set.');
    await this.request(`${this.apiUrl}/health`, {
      headers: { Authorization: `Bearer ${this.settings.apiKey}` }, retries: 0,
    });
    return { message: 'Provider reachable.' };
  }
}

module.exports = {
  fallback: 'internal',
  adapters: {
    internal: (s) => new InternalAnalyticsProvider(s),
    null: (s) => new InternalAnalyticsProvider(s),
    example: (s) => new ExampleAnalyticsProvider(s),
  },
  InternalAnalyticsProvider,
};
