'use strict';

/**
 * STORAGE capability — where video and image FILES live.
 *
 * Contract:
 *   put(key, buffer, { contentType })     -> { key, size }
 *   putStream(key, readable, { contentType }) -> { key, size }
 *   get(key)                              -> Buffer
 *   createReadStream(key, { range })      -> Readable
 *   stat(key)                             -> { size, contentType } | null
 *   delete(key)                           -> boolean
 *   urlFor(key)                           -> string   (CDN URL when configured)
 *   usage()                               -> { bytes, files }
 *
 * The database only ever stores the KEY. Bytes live here. (spec §12)
 *
 * `urlFor()` is how the CDN gets in front of delivery (spec §13): set CDN_URL
 * and every media URL points at the CDN instead of the app server, with no
 * change anywhere else in the platform.
 *
 * The local driver below is a complete, working implementation for development
 * and small deployments. Add an S3/GCS adapter later with the same methods.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { BaseProvider } = require('../BaseProvider');
const { config } = require('../../core/config');

/** Local filesystem storage. */
class LocalStorageProvider extends BaseProvider {
  constructor(settings) {
    super('local', settings);
    this.root = config.storage.localDir;
    fs.mkdirSync(this.root, { recursive: true });
  }

  /**
   * Resolve a storage key to an absolute path, refusing anything that escapes
   * the storage root. Keys come from our own code, but path traversal is
   * exactly the kind of bug that becomes critical later. (spec §39)
   */
  resolve(key) {
    const clean = String(key).replace(/^\/+/, '');
    const full = path.resolve(this.root, clean);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error('Invalid storage key.');
    }
    return full;
  }

  async put(key, buffer, { contentType } = {}) {
    const full = this.resolve(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, buffer);
    if (contentType) await this.writeMeta(full, { contentType });
    return { key, size: buffer.length };
  }

  async putStream(key, readable, { contentType } = {}) {
    const full = this.resolve(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    let size = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(full);
      readable.on('data', (c) => { size += c.length; });
      readable.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      readable.pipe(out);
    });
    if (contentType) await this.writeMeta(full, { contentType });
    return { key, size };
  }

  async get(key) {
    return fsp.readFile(this.resolve(key));
  }

  /** Streaming read, with HTTP range support so the player can seek. */
  createReadStream(key, { start, end } = {}) {
    return fs.createReadStream(this.resolve(key), { start, end });
  }

  async stat(key) {
    try {
      const full = this.resolve(key);
      const s = await fsp.stat(full);
      const meta = await this.readMeta(full);
      return { size: s.size, contentType: meta?.contentType || 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  async delete(key) {
    try {
      const full = this.resolve(key);
      await fsp.unlink(full);
      await fsp.unlink(full + '.meta').catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Public URL for a stored object.
   * With CDN_URL set, media is served by the CDN and never touches the app
   * server. Without it, we fall back to our own streaming route.
   */
  urlFor(key) {
    if (!key) return null;
    if (config.storage.cdnUrl) {
      return `${config.storage.cdnUrl.replace(/\/$/, '')}/${key}`;
    }
    return `/api/v1/media/${key}`;
  }

  async usage() {
    let bytes = 0;
    let files = 0;
    const walk = async (dir) => {
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (!entry.name.endsWith('.meta')) {
          const s = await fsp.stat(full).catch(() => null);
          if (s) { bytes += s.size; files++; }
        }
      }
    };
    await walk(this.root);
    return { bytes, files };
  }

  async writeMeta(fullPath, meta) {
    await fsp.writeFile(fullPath + '.meta', JSON.stringify(meta));
  }

  async readMeta(fullPath) {
    try { return JSON.parse(await fsp.readFile(fullPath + '.meta', 'utf8')); } catch { return null; }
  }

  async healthCheck() {
    // A real check: write, read back, delete.
    const probe = `.health/${Date.now()}.txt`;
    await this.put(probe, Buffer.from('ok'));
    const back = await this.get(probe);
    await this.delete(probe);
    if (back.toString() !== 'ok') throw new Error('Storage read-back mismatch.');
    const { bytes, files } = await this.usage();
    return {
      message: 'Local storage is writable.',
      details: { root: this.root, files, megabytes: +(bytes / 1024 / 1024).toFixed(2) },
    };
  }

  isConfigured() { return true; }
}

/**
 * TEMPLATE for object storage (S3, GCS, R2, …).
 *
 * Implement the same methods with your SDK of choice and register it below.
 * Note `urlFor()` should return a CDN or signed URL so large files never stream
 * through the application server. (spec §13)
 */
class ObjectStorageProviderTemplate extends BaseProvider {
  constructor(settings) {
    super('object', settings);
    this.bucket = config.storage.bucket;
  }

  async healthCheck() {
    throw new Error('Object storage adapter is not implemented yet. See docs/ADDING-AN-API.md.');
  }
}

module.exports = {
  fallback: 'local',
  adapters: {
    local: (settings) => new LocalStorageProvider(settings),
    null: (settings) => new LocalStorageProvider(settings),
    object: (settings) => new ObjectStorageProviderTemplate(settings),
  },
  LocalStorageProvider,
};
