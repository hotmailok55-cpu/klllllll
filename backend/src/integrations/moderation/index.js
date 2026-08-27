'use strict';

/**
 * MODERATION capability.
 *
 * Contract:
 *   classifyText({ text, context })   -> { scores: {category: 0..1}, flags: [category] }
 *   classifyImage({ storageKey })     -> { scores, flags }
 *   classifyVideo({ storageKey })     -> { scores, flags }
 *
 * An adapter returns SIGNALS ONLY — scores and flags. It never returns a
 * decision. Deciding what to do belongs to the platform's own policy engine in
 * services/moderation.js, which combines internal rules with any external
 * signals. External AI is a tool, never the whole policy. (spec §18, §32)
 *
 * That separation is what lets you add, remove, or run several providers side
 * by side without your rules changing.
 */

const { BaseProvider } = require('../BaseProvider');

/** Shared category vocabulary. Providers map their labels onto these. */
const CATEGORIES = ['harassment', 'hate', 'sexual', 'violence', 'self_harm', 'spam', 'scam'];

/**
 * The default provider: fast, local, no external service, no data leaving the
 * platform. Deliberately conservative and simple — it catches obvious spam
 * patterns and leaves nuanced judgement to humans or a connected provider.
 *
 * This is a real, useful baseline, not a stub: the platform must moderate
 * something even with zero integrations configured.
 */
class InternalModerationProvider extends BaseProvider {
  constructor(settings) { super('internal', settings); }

  async classifyText({ text }) {
    const value = String(text || '');
    const lower = value.toLowerCase();
    const scores = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));

    // --- Spam heuristics (structure, not vocabulary) ---
    const urls = (value.match(/https?:\/\/\S+/g) || []).length;
    if (urls >= 3) scores.spam = Math.max(scores.spam, 0.8);
    else if (urls === 2) scores.spam = Math.max(scores.spam, 0.5);

    // Shouting: mostly capitals in a reasonably long message.
    const letters = value.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 20) {
      const caps = (value.match(/[A-Z]/g) || []).length / letters.length;
      if (caps > 0.7) scores.spam = Math.max(scores.spam, 0.45);
    }

    // A character repeated many times ("aaaaaaaaaa", "!!!!!!!!!!").
    if (/(.)\1{9,}/.test(value)) scores.spam = Math.max(scores.spam, 0.5);

    // Classic money/contact-bait patterns.
    if (/\b(free\s+(money|robux|gift\s?cards?)|click\s+here\s+now|dm\s+me\s+to\s+earn)\b/i.test(lower)) {
      scores.scam = Math.max(scores.scam, 0.7);
    }

    const flags = CATEGORIES.filter((c) => scores[c] >= 0.5);
    return { scores, flags, provider: this.providerName };
  }

  /**
   * No local vision model. Return neutral signals and say so explicitly, so the
   * policy engine knows images were NOT actually inspected — rather than
   * assuming they were found safe.
   */
  async classifyImage() {
    return { scores: {}, flags: [], inspected: false, provider: this.providerName };
  }

  async classifyVideo() {
    return { scores: {}, flags: [], inspected: false, provider: this.providerName };
  }

  async healthCheck() {
    return { message: 'Internal moderation rules are active (text heuristics only, no external service).' };
  }

  isConfigured() { return true; }
}

/**
 * EXAMPLE external adapter — a template. Replace the endpoint and the label
 * mapping with your provider's real API.
 */
class ExampleModerationProvider extends BaseProvider {
  constructor(settings) {
    super('example', settings);
    this.apiUrl = settings.apiUrl || 'https://api.example-moderation.invalid/v1';
  }

  async classifyText({ text }) {
    const { body } = await this.request(`${this.apiUrl}/moderate/text`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.apiKey}` },
      body: { input: text },
    });

    // Map their category names onto OUR shared vocabulary.
    const labelMap = {
      harassment: 'harassment', hate_speech: 'hate', sexual_content: 'sexual',
      violence: 'violence', self_harm: 'self_harm', spam: 'spam', fraud: 'scam',
    };
    const scores = {};
    for (const [label, score] of Object.entries(body?.categories || {})) {
      const ours = labelMap[label];
      if (ours) scores[ours] = score;
    }
    return {
      scores,
      flags: Object.entries(scores).filter(([, s]) => s >= 0.5).map(([c]) => c),
      provider: this.providerName,
    };
  }

  async healthCheck() {
    if (!this.settings.apiKey) throw new Error('MODERATION_API_KEY is not set.');
    await this.request(`${this.apiUrl}/health`, {
      headers: { Authorization: `Bearer ${this.settings.apiKey}` }, retries: 0,
    });
    return { message: 'Provider reachable.' };
  }
}

module.exports = {
  fallback: 'internal',
  adapters: {
    internal: (settings) => new InternalModerationProvider(settings),
    null: (settings) => new InternalModerationProvider(settings),
    example: (settings) => new ExampleModerationProvider(settings),
  },
  CATEGORIES,
  InternalModerationProvider,
  ExampleModerationProvider,
};
