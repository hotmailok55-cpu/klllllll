'use strict';

/**
 * COPYRIGHT capability.
 *
 * Contract every copyright provider implements:
 *
 *   scanVideo({ videoId, storageKey, durationMs, soundId })
 *     -> { result, confidence?, matchedWork?, matchedRef?, licenseState?, raw? }
 *
 *   `result` is one of the platform's own vocabulary values:
 *     'clear'       nothing matched
 *     'review'      inconclusive, a human should look
 *     'match'       matched a known work
 *     'claim'       matched, and the rightsholder claims it
 *     'restrict'    matched, usage restricted (e.g. some territories)
 *     'block'       matched, must not be published
 *     'unavailable' we could not check right now (NOT a verdict)
 *
 * CRITICAL (spec §30, §81): a detection result is NOT a licence. `licenseState`
 * is reported separately and defaults to 'unknown'. The platform never assumes
 * "API connected = we may use every song." What ACTION follows a result is
 * decided by our CopyrightService, not by the vendor.
 *
 * To add a real provider: copy NullCopyrightProvider, implement scanVideo() and
 * healthCheck() against the vendor's ACTUAL documented endpoints (do not invent
 * endpoints), register it in `adapters` below, then set
 * COPYRIGHT_PROVIDER=<name> and COPYRIGHT_API_KEY=… in the environment.
 * Full walkthrough: docs/ADDING-AN-API.md
 */

const { BaseProvider } = require('../BaseProvider');

/**
 * The default. No external copyright service is connected.
 *
 * It reports 'unavailable' rather than 'clear' — we must never imply content
 * was checked and cleared when nothing checked it. The CopyrightService turns
 * 'unavailable' into a visible "Copyright check pending" state instead of
 * blocking the upload or crashing. (spec §35)
 */
class NullCopyrightProvider extends BaseProvider {
  constructor(settings) { super('null', settings); }

  async scanVideo() {
    return {
      result: 'unavailable',
      licenseState: 'unknown',
      note: 'No copyright provider is configured. The check was skipped, not passed.',
    };
  }

  async healthCheck() {
    return { message: 'No copyright provider configured. Set COPYRIGHT_PROVIDER and COPYRIGHT_API_KEY to connect one.' };
  }

  isConfigured() { return false; }
}

/**
 * EXAMPLE adapter — a template, not a working integration.
 *
 * The URLs and field names below are placeholders. Replace them with the real
 * ones from your provider's documentation when you actually connect a vendor.
 * Kept here so the shape of a real adapter is obvious.
 */
class ExampleCopyrightProvider extends BaseProvider {
  constructor(settings) {
    super('example', settings);
    this.apiUrl = settings.apiUrl || 'https://api.example-copyright.invalid/v1';
  }

  async scanVideo({ videoId, storageKey, durationMs }) {
    const { body } = await this.request(`${this.apiUrl}/scans`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.apiKey}` },
      body: { reference: videoId, asset: storageKey, duration_ms: durationMs },
    });

    // Translate the vendor's vocabulary into OURS. This mapping is the whole
    // point of an adapter: the rest of the platform never learns their words.
    const mapping = {
      no_match: 'clear',
      inconclusive: 'review',
      matched: 'match',
      claimed: 'claim',
      restricted: 'restrict',
      blocked: 'block',
    };

    return {
      result: mapping[body?.status] || 'review',
      confidence: body?.confidence ?? null,
      matchedWork: body?.work?.title ?? null,
      matchedRef: body?.work?.id ?? null,
      // Only trust an explicit licence statement from the provider.
      licenseState: body?.license?.granted === true ? 'licensed' : 'unknown',
      raw: body,
    };
  }

  async healthCheck() {
    if (!this.settings.apiKey) throw new Error('COPYRIGHT_API_KEY is not set.');
    const { body } = await this.request(`${this.apiUrl}/health`, {
      headers: { Authorization: `Bearer ${this.settings.apiKey}` },
      retries: 0,
    });
    return { message: 'Provider reachable.', details: { version: body?.version } };
  }
}

module.exports = {
  fallback: 'null',
  adapters: {
    null: (settings) => new NullCopyrightProvider(settings),
    example: (settings) => new ExampleCopyrightProvider(settings),
    // Add yours here:  acme: (settings) => new AcmeCopyrightProvider(settings),
  },
  NullCopyrightProvider,
  ExampleCopyrightProvider,
};
