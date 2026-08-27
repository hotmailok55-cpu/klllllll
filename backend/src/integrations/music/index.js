'use strict';

/**
 * MUSIC capability — the sound library behind "add sound" / "use this sound".
 *
 * Contract every music provider implements (spec §31):
 *
 *   searchMusic({ query, limit })  -> [{ ref, title, artist, durationMs, coverUrl, previewUrl }]
 *   getMetadata({ ref })           -> { ref, title, artist, durationMs, coverUrl, album? }
 *   identifyTrack({ storageKey })  -> { ref, title, artist, confidence } | null
 *   checkRights({ ref, usage })    -> { state, note, territories?, expiresAt? }
 *   reportUsage({ ref, videoId, plays }) -> { accepted: boolean }
 *
 * Implement only the methods your provider ACTUALLY offers. If a vendor has no
 * audio fingerprinting endpoint, do not fake `identifyTrack` — omit it, and
 * MusicService will treat the capability as absent. Never invent endpoints.
 *
 * `checkRights().state` is one of:
 *   'cleared'    we may offer this track in the picker
 *   'restricted' usable only under conditions recorded in `note`
 *   'blocked'    must not be offered
 *   'unknown'    we do not know — treat as NOT cleared
 *
 * The platform defaults to 'unknown' and only shows tracks whose rights are
 * explicitly 'cleared'. Connecting an API never by itself grants music rights.
 * (spec §81)
 */

const { BaseProvider } = require('../BaseProvider');

/**
 * Default provider: no external music service.
 *
 * The platform still works — creators use ORIGINAL sound from their own videos,
 * and any sound another creator made can be reused. Only the external catalogue
 * is missing.
 */
class NullMusicProvider extends BaseProvider {
  constructor(settings) { super('null', settings); }

  async searchMusic() { return []; }

  async getMetadata() { return null; }

  async checkRights() {
    return {
      state: 'unknown',
      note: 'No music provider is configured, so licensing cannot be confirmed.',
    };
  }

  async healthCheck() {
    return { message: 'No music provider configured. Original sounds still work; set MUSIC_PROVIDER and MUSIC_API_KEY to add a catalogue.' };
  }

  isConfigured() { return false; }
}

/**
 * EXAMPLE adapter — a template. Endpoints and field names are placeholders;
 * replace them with your provider's real, documented API.
 */
class ExampleMusicProvider extends BaseProvider {
  constructor(settings) {
    super('example', settings);
    this.apiUrl = settings.apiUrl || 'https://api.example-music.invalid/v1';
  }

  get authHeaders() {
    return { Authorization: `Bearer ${this.settings.apiKey}` };
  }

  async searchMusic({ query, limit = 20 }) {
    const url = `${this.apiUrl}/tracks?q=${encodeURIComponent(query)}&limit=${limit}`;
    const { body } = await this.request(url, { headers: this.authHeaders });
    return (body?.tracks || []).map((t) => ({
      ref: t.id,
      title: t.title,
      artist: t.artist_name,
      durationMs: t.duration_ms,
      coverUrl: t.artwork_url,
      previewUrl: t.preview_url,
    }));
  }

  async getMetadata({ ref }) {
    const { body } = await this.request(`${this.apiUrl}/tracks/${encodeURIComponent(ref)}`, {
      headers: this.authHeaders,
    });
    if (!body) return null;
    return {
      ref: body.id,
      title: body.title,
      artist: body.artist_name,
      durationMs: body.duration_ms,
      coverUrl: body.artwork_url,
      album: body.album_name,
    };
  }

  /**
   * Licensing is asked for EXPLICITLY, per intended usage, and we believe only
   * an affirmative answer. Anything unclear stays 'unknown' -> not offered.
   */
  async checkRights({ ref, usage = 'short_form_video' }) {
    const { body } = await this.request(`${this.apiUrl}/tracks/${encodeURIComponent(ref)}/rights`, {
      method: 'POST',
      headers: this.authHeaders,
      body: { usage },
    });
    const map = { granted: 'cleared', conditional: 'restricted', denied: 'blocked' };
    return {
      state: map[body?.status] || 'unknown',
      note: body?.note || '',
      territories: body?.territories || null,
      expiresAt: body?.expires_at || null,
    };
  }

  /** Usage reporting, where the provider's agreement requires it. */
  async reportUsage({ ref, videoId, plays }) {
    const { body } = await this.request(`${this.apiUrl}/usage`, {
      method: 'POST',
      headers: this.authHeaders,
      body: { track_id: ref, reference: videoId, plays },
    });
    return { accepted: body?.accepted === true };
  }

  async healthCheck() {
    if (!this.settings.apiKey) throw new Error('MUSIC_API_KEY is not set.');
    const { body } = await this.request(`${this.apiUrl}/health`, {
      headers: this.authHeaders, retries: 0,
    });
    return { message: 'Provider reachable.', details: { catalogue: body?.catalogue_size } };
  }
}

module.exports = {
  fallback: 'null',
  adapters: {
    null: (settings) => new NullMusicProvider(settings),
    example: (settings) => new ExampleMusicProvider(settings),
  },
  NullMusicProvider,
  ExampleMusicProvider,
};
