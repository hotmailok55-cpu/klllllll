'use strict';

/**
 * Base class every provider adapter extends.
 *
 * It gives you the boring-but-essential parts for free so a new adapter is
 * mostly just "translate our request into their request":
 *   - `request()` with timeout, retries and exponential backoff  (spec §36)
 *   - a `healthCheck()` contract for the admin "Test Connection" button
 *   - safe logging that never prints credentials                 (spec §69)
 *
 * A provider adapter's job is ONLY translation. It must not contain platform
 * policy — what to DO with a result is the service's decision, not the
 * vendor's. (spec §32, §67)
 */

const { logger } = require('../core/logger');

class BaseProvider {
  /**
   * @param {string} providerName short id, e.g. 'null' | 'internal' | 'acme'
   * @param {object} settings     from config.integrations[capability]
   */
  constructor(providerName, settings = {}) {
    this.providerName = providerName;
    this.settings = settings;
    this.timeoutMs = settings.timeoutMs || 10_000;
    this.maxRetries = settings.maxRetries ?? 2;
  }

  /**
   * Make an HTTP request to the external API with timeout + retry + backoff.
   *
   * Retries only on failures that are plausibly transient (network errors,
   * 429, 5xx). A 400/401/403 is a real answer — retrying it just wastes
   * everyone's quota. (spec §36)
   *
   * @param {string} url
   * @param {object} options  fetch options; `body` may be a plain object
   * @returns {Promise<{status:number, headers:Headers, body:any}>}
   */
  async request(url, options = {}) {
    const { retries = this.maxRetries, ...fetchOptions } = options;

    if (fetchOptions.body && typeof fetchOptions.body === 'object' && !(fetchOptions.body instanceof Buffer)) {
      fetchOptions.body = JSON.stringify(fetchOptions.body);
      fetchOptions.headers = { 'Content-Type': 'application/json', ...fetchOptions.headers };
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const started = Date.now();

      try {
        const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
        clearTimeout(timer);

        const text = await response.text();
        let body;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }

        if (response.ok) {
          this.log('debug', 'request ok', {
            url: redactUrl(url), status: response.status, ms: Date.now() - started, attempt,
          });
          return { status: response.status, headers: response.headers, body };
        }

        const retryable = response.status === 429 || response.status >= 500;
        const error = new Error(
          `${this.providerName} responded ${response.status}` +
          (typeof body === 'object' && body?.message ? `: ${body.message}` : '')
        );
        error.status = response.status;
        error.body = body;
        error.retryable = retryable;

        if (!retryable || attempt === retries) throw error;
        lastError = error;
      } catch (err) {
        clearTimeout(timer);
        // An abort is our own timeout firing.
        if (err.name === 'AbortError') {
          lastError = new Error(`${this.providerName} timed out after ${this.timeoutMs}ms`);
          lastError.retryable = true;
        } else if (err.retryable === false) {
          throw err;
        } else {
          lastError = err;
        }
        if (attempt === retries) break;
      }

      // Exponential backoff with jitter, so retries from many servers do not
      // synchronize into a thundering herd.
      const backoff = Math.min(2 ** attempt * 250, 4000);
      const jitter = Math.random() * 250;
      this.log('warn', 'retrying after failure', {
        url: redactUrl(url), attempt: attempt + 1, waitMs: Math.round(backoff + jitter),
        error: lastError?.message,
      });
      await new Promise((r) => setTimeout(r, backoff + jitter));
    }

    throw lastError || new Error(`${this.providerName} request failed`);
  }

  /**
   * Report whether the provider is reachable and configured.
   * Every adapter must implement this — it powers "Test Connection".
   * @returns {Promise<{message:string, [details]:object}>}
   */
  async healthCheck() {
    throw new Error(`${this.providerName}: healthCheck() not implemented`);
  }

  /** Whether credentials are present. Used for the "Configured" badge. */
  isConfigured() {
    return Boolean(this.settings.apiKey);
  }

  log(level, message, meta) {
    logger[level](`provider:${this.providerName}`, message, meta);
  }
}

/** Strip query strings from logged URLs — keys sometimes ride in them. */
function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url).split('?')[0];
  }
}

module.exports = { BaseProvider };
