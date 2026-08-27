'use strict';

/**
 * AI capability — optional assistance, never a dependency. (spec §76)
 *
 * Contract (implement only what your provider offers):
 *   generateCaptions({ storageKey, language }) -> { vtt, language, confidence }
 *   categorize({ title, description, tags })   -> { category, topics: [] }
 *   embed({ text })                            -> { vector: number[] }
 *
 * Every feature that uses AI must work — with reduced quality — when this is
 * absent. Categorization falls back to the creator's own choice; captions fall
 * back to creator-uploaded ones; search falls back to lexical ranking.
 * If a provider changes its API, the platform degrades, it does not collapse.
 */

const { BaseProvider } = require('../BaseProvider');

class NullAiProvider extends BaseProvider {
  constructor(settings) { super('null', settings); }

  async generateCaptions() { return null; }
  async categorize() { return null; }
  async embed() { return null; }

  async healthCheck() {
    return { message: 'No AI provider configured. Auto-captions and auto-categorization are unavailable; everything else works normally.' };
  }

  isConfigured() { return false; }
}

module.exports = {
  fallback: 'null',
  adapters: { null: (s) => new NullAiProvider(s) },
  NullAiProvider,
};
