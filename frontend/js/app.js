/**
 * APP ENTRY POINT + ROUTER.
 *
 * A hash router, because it needs no server-side rewrite rules and the whole
 * thing fits in one readable file.
 *
 * The session object is the single source of truth for "who is signed in", and
 * for platform state — which is what makes the new-platform experience
 * automatic rather than hard-coded.
 */

import { api, auth } from './api.js';
import { el, render, toast, count } from './ui.js';
import { feedView } from './views/feed.js';
import { signInView, welcomeView } from './views/auth.js';
import { uploadView } from './views/upload.js';
import {
  exploreView, channelView, soundView, libraryView,
  notificationsView, studioView, copyrightView, adminView,
} from './views/pages.js';

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const session = {
  user: null,
  channel: null,
  unread: 0,
  platform: null,

  /** Re-fetch who we are and what state the platform is in. */
  async refresh() {
    try {
      this.platform = await api.system();
    } catch {
      this.platform = null;
    }

    if (!auth.signedIn) {
      this.user = null;
      this.channel = null;
      this.unread = 0;
      renderNav();
      return;
    }

    try {
      const data = await api.me();
      this.user = data.user;
      this.channel = data.channel;
      this.unread = data.unreadNotifications || 0;
    } catch {
      // An invalid token was already cleared by the API client.
      this.user = null;
      this.channel = null;
    }
    renderNav();
  },
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Each route is [pattern, handler]. A `:param` segment is captured and passed
 * to the handler.
 */
const ROUTES = [
  ['/', (c) => feedView(c, { kind: 'short' })],
  ['/long', (c) => feedView(c, { kind: 'long' })],
  ['/explore', exploreView],
  ['/search', exploreView],
  ['/upload', uploadView],
  ['/library', libraryView],
  ['/notifications', (c) => notificationsView(c, { session })],
  ['/signin', (c) => signInView(c, { session })],
  ['/welcome', (c) => welcomeView(c, { session })],
  ['/studio', (c) => studioView(c, { session })],
  ['/studio/copyright', copyrightView],
  ['/studio/content', (c) => studioView(c, { session })],
  ['/admin', adminView],
  ['/sound/:id', (c, params) => soundView(c, params)],
  ['/watch/:id', (c, params) => watchView(c, params)],
  ['/@:handle', (c, params) => channelView(c, params)],
];

function matchRoute(path) {
  for (const [pattern, handler] of ROUTES) {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);

    // '/@handle' is one segment that both matches literally and captures.
    if (patternParts.length !== pathParts.length) continue;

    const params = {};
    let matched = true;

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      if (patternPart.startsWith('@:')) {
        if (!pathPart.startsWith('@')) { matched = false; break; }
        params[patternPart.slice(2)] = decodeURIComponent(pathPart.slice(1));
      } else if (patternPart.startsWith(':')) {
        params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      } else if (patternPart !== pathPart) {
        matched = false; break;
      }
    }

    if (matched) return { handler, params };
  }
  return null;
}

/** A single video page — reuses the feed renderer so playback behaves identically. */
async function watchView(container, { id }) {
  container.className = 'screen';
  render(container, el('div', { class: 'empty-state' },
    el('span', { class: 'spinner' }), el('p', {}, 'Loading video…')));

  try {
    const data = await api.video(id);
    // Render it as a one-item feed followed by the related videos, so the
    // player, overlay, and watch tracking are exactly the same code.
    const { default: renderSingle } = await import('./views/watch.js');
    renderSingle(container, data);
  } catch (error) {
    render(container, el('div', { class: 'empty-state' },
      el('div', { class: 'icon' }, '😕'),
      el('h2', {}, 'Video unavailable'),
      el('p', {}, error.message),
      el('div', { class: 'actions' },
        el('a', { class: 'btn btn--primary btn--block', href: '#/' }, 'Back to the feed')),
    ));
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { href: '#/', glyph: '⌂', label: 'Home' },
  { href: '#/explore', glyph: '⌕', label: 'Explore' },
  { href: '#/upload', glyph: '+', label: '', create: true },
  { href: '#/notifications', glyph: '♡', label: 'Inbox', badge: () => session.unread },
  { href: '#/library', glyph: '☰', label: 'You' },
];

function renderNav() {
  const nav = document.getElementById('nav');
  const current = location.hash.slice(1) || '/';

  render(nav, NAV_ITEMS.map((item) => {
    const isActive = current === item.href.slice(1)
      || (item.href === '#/library' && (current.startsWith('/studio') || current.startsWith('/@')));

    const badgeValue = item.badge ? item.badge() : 0;

    return el('a', {
        class: `nav-item ${item.create ? 'create' : ''} ${isActive ? 'active' : ''}`,
        href: item.href,
        'aria-label': item.label || 'Create',
        'aria-current': isActive ? 'page' : null,
      },
      el('span', { class: 'glyph', 'aria-hidden': 'true' }, item.glyph),
      item.label ? el('span', {}, item.label) : null,
      badgeValue > 0
        ? el('span', { class: 'nav-badge' }, count(badgeValue))
        : null,
    );
  }));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

let currentCleanup = null;

async function route() {
  const path = location.hash.slice(1) || '/';
  const container = document.getElementById('main');

  // Tear down the previous view (pauses videos, clears timers).
  if (currentCleanup) { try { currentCleanup(); } catch { /* ignore */ } }
  currentCleanup = null;

  const matched = matchRoute(path);

  if (!matched) {
    render(container, el('div', { class: 'empty-state' },
      el('div', { class: 'icon' }, '🧭'),
      el('h2', {}, 'Page not found'),
      el('p', {}, "That link does not lead anywhere on Loop."),
      el('div', { class: 'actions' },
        el('a', { class: 'btn btn--primary btn--block', href: '#/' }, 'Go to the feed')),
    ));
    renderNav();
    return;
  }

  try {
    const result = await matched.handler(container, { ...matched.params, session });
    if (typeof result === 'function') currentCleanup = result;
  } catch (error) {
    console.error('Route failed:', error);
    render(container, el('div', { class: 'empty-state' },
      el('div', { class: 'icon' }, '⚠️'),
      el('h2', {}, 'Something went wrong'),
      el('p', {}, error.message || 'Please try again.'),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn--primary btn--block', onclick: () => route() }, 'Try again')),
    ));
  }

  renderNav();
  container.scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

window.addEventListener('hashchange', route);

(async function start() {
  await session.refresh();
  await route();

  // Refresh the notification badge periodically, but only while the tab is
  // visible — polling a background tab is wasted work and wasted battery.
  setInterval(() => {
    if (!document.hidden && auth.signedIn) {
      api.me()
        .then((data) => {
          session.unread = data.unreadNotifications || 0;
          renderNav();
        })
        .catch(() => {});
    }
  }, 60_000);
})();

// Expose for debugging in the console.
window.loop = { session, api, auth };
