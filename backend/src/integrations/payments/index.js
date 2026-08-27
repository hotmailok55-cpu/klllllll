'use strict';

/**
 * PAYMENTS / MONETIZATION capability.
 *
 * Monetization is OFF at launch (MONETIZATION_ENABLED=false), but the seam
 * exists now so adding it later does not mean re-plumbing the platform.
 * (spec §58)
 *
 * Contract (implement what your provider actually supports):
 *   createAccount({ userId, country })      -> { accountRef, onboardingUrl }
 *   accountStatus({ accountRef })           -> { state, payoutsEnabled }
 *   createPayment({ amountCents, currency, fromUserId, toAccountRef, memo })
 *                                           -> { paymentRef, status, clientSecret? }
 *   refund({ paymentRef, amountCents })     -> { refundRef, status }
 *
 * Financial code stays in its own service and its own tables, deliberately
 * separate from the video service. Money bugs and video bugs should never be
 * able to reach each other.
 */

const { BaseProvider } = require('../BaseProvider');

class NullPaymentsProvider extends BaseProvider {
  constructor(settings) { super('null', settings); }

  async createAccount() {
    throw new Error('Monetization is not enabled on this platform yet.');
  }

  async healthCheck() {
    return { message: 'Monetization is not enabled. Set MONETIZATION_ENABLED=true and configure PAYMENTS_PROVIDER when you are ready.' };
  }

  isConfigured() { return false; }
}

module.exports = {
  fallback: 'null',
  adapters: { null: (s) => new NullPaymentsProvider(s) },
  NullPaymentsProvider,
};
