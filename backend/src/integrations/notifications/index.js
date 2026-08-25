'use strict';

/**
 * NOTIFICATIONS capability — DELIVERY of notifications to the outside world
 * (email, push, SMS).
 *
 * Contract:
 *   send({ to, channel, subject, body, link }) -> { delivered, ref? }
 *
 * Not to be confused with services/notifications.js, which creates the in-app
 * notification records. This integration is only about pushing a message OUT.
 * In-app notifications always work, even with no provider configured.
 */

const { BaseProvider } = require('../BaseProvider');
const { logger } = require('../../core/logger');

/**
 * Default: log-only delivery.
 *
 * In development this prints what WOULD have been sent, so you can copy an
 * email verification link out of the console without wiring up a mail service.
 */
class InternalNotificationProvider extends BaseProvider {
  constructor(settings) { super('internal', settings); }

  async send({ to, channel = 'email', subject, body, link }) {
    // `to` is an address — log it only in development, and never the body.
    logger.info('notifications', 'delivery (log-only provider)', {
      channel, subject, link, hasRecipient: Boolean(to),
    });
    if (process.env.NODE_ENV !== 'production' && link) {
      // Deliberately printed so local development is not blocked on email.
      process.stdout.write(`\n  ✉  ${subject}\n     ${link}\n\n`);
    }
    return { delivered: true, ref: 'log-only' };
  }

  async healthCheck() {
    return { message: 'Log-only delivery. In-app notifications work; set NOTIFICATIONS_PROVIDER to send real email or push.' };
  }

  isConfigured() { return true; }
}

/** EXAMPLE adapter template for a transactional email/push provider. */
class ExampleNotificationProvider extends BaseProvider {
  constructor(settings) {
    super('example', settings);
    this.apiUrl = settings.apiUrl || 'https://api.example-notify.invalid/v1';
  }

  async send({ to, channel, subject, body, link }) {
    const { body: res } = await this.request(`${this.apiUrl}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.apiKey}` },
      body: { to, channel, subject, text: body, url: link },
    });
    return { delivered: res?.status === 'queued', ref: res?.id };
  }

  async healthCheck() {
    if (!this.settings.apiKey) throw new Error('NOTIFICATIONS_API_KEY is not set.');
    await this.request(`${this.apiUrl}/health`, {
      headers: { Authorization: `Bearer ${this.settings.apiKey}` }, retries: 0,
    });
    return { message: 'Provider reachable.' };
  }
}

module.exports = {
  fallback: 'internal',
  adapters: {
    internal: (s) => new InternalNotificationProvider(s),
    null: (s) => new InternalNotificationProvider(s),
    example: (s) => new ExampleNotificationProvider(s),
  },
  InternalNotificationProvider,
};
