/**
 * API CLIENT.
 *
 * The single place the frontend talks to the backend. Nothing else in the UI
 * uses fetch() directly, so auth, error shaping, and the base URL are all
 * handled once.
 *
 * NOTE (spec §4, §83): there are no API keys in this file, or anywhere in the
 * frontend. The browser only ever talks to OUR backend; the backend is what
 * holds credentials and talks to external providers.
 */

const BASE = '/api/v1';
const TOKEN_KEY = 'loop.token';

/** The session token lives in localStorage; it is opaque and server-revocable. */
export const auth = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set token(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* private browsing — the session just won't persist */ }
  },
  get signedIn() { return Boolean(this.token); },
};

/** An error carrying the API's structured detail, so forms can show it. */
export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.message || 'Something went wrong.');
    this.status = status;
    this.code = payload?.code || 'UNKNOWN';
    this.details = payload?.details || null;
    this.requestId = payload?.requestId;
  }
}

async function request(method, path, { body, raw, signal } = {}) {
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (body && !raw) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers,
      body: raw ? body : (body ? JSON.stringify(body) : undefined),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // A network failure gets a human explanation, not "TypeError: failed to fetch".
    throw new ApiError(0, {
      code: 'NETWORK',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    // An expired or revoked session: clear it so the UI can prompt a sign-in.
    if (response.status === 401 && auth.token) auth.token = null;
    throw new ApiError(response.status, payload?.error);
  }

  return payload?.data;
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { body, ...options }),
  patch: (path, body, options) => request('PATCH', path, { body, ...options }),
  delete: (path, body, options) => request('DELETE', path, { body, ...options }),

  /** Raw binary upload (video file / thumbnail). */
  upload: (path, blob) => request('POST', path, { body: blob, raw: true }),

  // --- Convenience wrappers, so views read like the product ---

  system: () => api.get('/system/state'),
  health: () => api.get('/system/health'),

  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),

  feed: ({ kind = 'short', cursor = 0, limit = 10 } = {}) =>
    api.get(`/feed?kind=${kind}&cursor=${cursor}&limit=${limit}`),
  trending: ({ kind, limit = 20 } = {}) =>
    api.get(`/trending?limit=${limit}${kind ? `&kind=${kind}` : ''}`),
  subscriptions: () => api.get('/me/subscriptions'),

  video: (id) => api.get(`/videos/${id}`),
  updateVideo: (id, data) => api.patch(`/videos/${id}`, data),
  deleteVideo: (id) => api.delete(`/videos/${id}`),
  like: (id) => api.post(`/videos/${id}/like`),
  dislike: (id) => api.post(`/videos/${id}/dislike`),
  save: (id) => api.post(`/videos/${id}/save`),
  share: (id) => api.post(`/videos/${id}/share`),
  watch: (id, data) => api.post(`/videos/${id}/watch`, data),
  reportVideo: (id, data) => api.post(`/videos/${id}/report`, data),

  comments: (videoId, sort = 'top') => api.get(`/videos/${videoId}/comments?sort=${sort}`),
  comment: (videoId, data) => api.post(`/videos/${videoId}/comments`, data),
  likeComment: (id) => api.post(`/comments/${id}/like`),
  deleteComment: (id) => api.delete(`/comments/${id}`),

  channel: (handle) => api.get(`/channels/${handle}`),
  follow: (channelId) => api.post(`/channels/${channelId}/follow`),
  updateChannel: (id, data) => api.patch(`/channels/${id}`, data),
  suggestedChannels: () => api.get('/channels'),

  createUpload: (data) => api.post('/uploads', data),
  uploadFile: (id, blob) => api.upload(`/uploads/${id}/file`, blob),
  uploadStatus: (id) => api.get(`/uploads/${id}/status`),
  drafts: () => api.get('/uploads/drafts'),

  search: (q, options = {}) => {
    const params = new URLSearchParams({ q, ...options });
    return api.get(`/search?${params}`);
  },
  suggest: (q) => api.get(`/search/suggest?q=${encodeURIComponent(q)}`),
  recentSearches: () => api.get('/search/recent'),

  sounds: () => api.get('/sounds/popular'),
  trendingSounds: () => api.get('/sounds/trending'),
  sound: (id) => api.get(`/sounds/${id}`),
  searchSounds: (q) => api.get(`/sounds/search?q=${encodeURIComponent(q)}`),
  attachSound: (videoId, soundId) => api.post(`/videos/${videoId}/sound`, { soundId }),

  notifications: () => api.get('/notifications'),
  markNotificationsRead: () => api.post('/notifications/read', {}),

  playlists: () => api.get('/playlists'),
  createPlaylist: (data) => api.post('/playlists', data),
  saved: () => api.get('/me/saved'),

  setInterests: (topics) => api.post('/users/me/interests', { topics }),
  updateProfile: (data) => api.patch('/users/me', data),

  studio: () => api.get('/studio/dashboard'),
  studioContent: () => api.get('/studio/content'),
  videoAnalytics: (id) => api.get(`/studio/videos/${id}/analytics`),
  studioCopyright: () => api.get('/studio/copyright'),

  adminOverview: () => api.get('/admin/overview'),
  adminIntegrations: () => api.get('/admin/integrations'),
  testIntegration: (key) => api.post(`/admin/integrations/${key}/test`),
  setIntegrationEnabled: (key, enabled) =>
    api.post(`/admin/integrations/${key}/enabled`, { enabled }),
  adminModeration: () => api.get('/admin/moderation'),
};
