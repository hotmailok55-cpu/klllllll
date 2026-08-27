/**
 * THE FEED — the main scrolling surface.
 *
 * How it works:
 *   - CSS scroll-snap gives the one-video-per-swipe feel with no JS.
 *   - An IntersectionObserver decides which video is "active": it plays that
 *     one and pauses every other, so only one video ever has audio.
 *   - Watch time is measured per video and sent to the backend on scroll-away.
 *     That is what feeds view counting AND teaches the recommendation engine.
 *   - More pages load as you approach the end, so scrolling never stops.
 */

import { api, auth } from '../api.js';
import { el, render, count, avatar, toast, emptyState, loading, errorState } from '../ui.js';
import { openComments } from './comments.js';
import { openShare } from './share.js';

export async function feedView(container, { kind = 'short' } = {}) {
  render(container, loading('Finding something good…'));
  container.className = 'screen screen--feed';

  let state = { items: [], cursor: 0, loading: false, done: false, mode: null };

  try {
    const data = await api.feed({ kind, limit: 8 });
    state = { ...state, items: data.videos, cursor: data.nextCursor ?? 0, mode: data.mode };

    if (!data.videos.length) {
      // The backend tells us WHY it is empty and what to say. (spec §8, §9)
      return render(container, el('div', { class: 'feed' },
        emptyState(data.empty, { icon: data.mode === 'empty_platform' ? '🌱' : '🎉' })));
    }
  } catch (error) {
    return render(container, errorState(error, () => feedView(container, { kind })));
  }

  const scroller = el('div', { class: 'feed', tabindex: '-1' });
  render(container, scroller);

  const players = new Map();  // videoId -> controller

  for (const video of state.items) {
    const item = feedItem(video, players);
    scroller.append(item);
  }

  setupActiveVideoTracking(scroller, players);
  setupInfiniteScroll(scroller, state, players, kind);
  setupKeyboardNav(scroller);

  return scroller;
}

/**
 * One full-screen video with its overlay.
 * Returns the element; the player controller is registered in `players`.
 */
function feedItem(video, players) {
  const item = el('div', { class: 'feed-item', dataset: { videoId: video.id } });

  // --- Media ---
  let media;
  if (video.videoUrl) {
    media = el('video', {
      src: video.videoUrl,
      poster: video.thumbnailUrl || undefined,
      loop: true,
      playsinline: true,       // iOS: play inline, do not go fullscreen
      'webkit-playsinline': true,
      preload: 'metadata',
      muted: true,             // required for autoplay to be allowed
      tabindex: '-1',
      'aria-label': video.title,
    });
  } else {
    // A video still processing, or one whose file is missing. Never a broken
    // black box with no explanation.
    media = el('div', { class: 'video-placeholder' },
      el('div', { class: 'ph-icon' }, '🎬'),
      el('div', {}, 'This video is still processing'));
  }
  item.append(media);

  // --- Progress bar ---
  const progressFill = el('i');
  item.append(el('div', { class: 'feed-progress' }, progressFill));

  // --- Play/pause indicator ---
  const indicator = el('div', { class: 'play-indicator' }, el('span', {}, '▶'));
  item.append(indicator);

  // --- Overlay ---
  item.append(overlay(video, media));

  // --- Playback controller ---
  const controller = createController(video, media, progressFill, indicator);
  players.set(video.id, controller);

  // Tap anywhere on the video toggles play/pause.
  media.addEventListener('click', () => controller.toggle());

  return item;
}

/**
 * Per-video playback + watch-time tracking.
 *
 * Watch time is accumulated while playing and reported when the video is
 * scrolled away from. Reporting on scroll-away (rather than every second)
 * means one request per video instead of dozens.
 */
function createController(video, media, progressFill, indicator) {
  let watchedMs = 0;
  let lastTick = null;
  let reported = false;
  let replayed = false;
  let isActive = false;

  const isVideo = media.tagName === 'VIDEO';

  const flashIndicator = (symbol) => {
    indicator.querySelector('span').textContent = symbol;
    indicator.classList.add('visible');
    setTimeout(() => indicator.classList.remove('visible'), 450);
  };

  if (isVideo) {
    media.addEventListener('timeupdate', () => {
      if (media.duration) {
        progressFill.style.width = `${(media.currentTime / media.duration) * 100}%`;
      }
      // Accumulate real elapsed time rather than trusting currentTime, which
      // jumps around on loop and seek.
      const now = performance.now();
      if (lastTick !== null && !media.paused) {
        watchedMs += Math.min(now - lastTick, 1000);
      }
      lastTick = now;
    });

    // A loop restart means they chose to watch it again — a strong positive
    // signal, tracked separately.
    media.addEventListener('seeked', () => {
      if (media.currentTime < 0.4 && watchedMs > 1500) replayed = true;
    });

    media.addEventListener('error', () => {
      progressFill.style.background = 'var(--danger)';
    });
  }

  return {
    video,

    async activate() {
      isActive = true;
      reported = false;
      lastTick = performance.now();
      if (!isVideo) return;
      try {
        // Unmute once the user has interacted with the page at least once;
        // browsers block audible autoplay before that.
        media.muted = !hasUserGesture();
        await media.play();
      } catch {
        // Autoplay refused. Leave the poster up; a tap will start it.
      }
    },

    deactivate() {
      if (!isActive) return;
      isActive = false;
      if (isVideo) { media.pause(); media.currentTime = 0; }
      progressFill.style.width = '0%';
      this.report();
    },

    toggle() {
      if (!isVideo) return;
      if (media.paused) {
        media.muted = false;
        media.play().catch(() => {});
        flashIndicator('▶');
      } else {
        media.pause();
        flashIndicator('❚❚');
      }
    },

    /**
     * Send the watch heartbeat. The backend decides whether it counts as a
     * view — the client never asserts that, which is what makes view counts
     * resistant to a scripted client. (spec §29)
     */
    report() {
      if (reported || watchedMs < 300) return;
      reported = true;
      api.watch(video.id, {
        watchMs: Math.round(watchedMs),
        source: 'feed',
        replayed,
      }).catch(() => { /* a lost heartbeat must never disturb the viewer */ });
      watchedMs = 0;
      lastTick = null;
      replayed = false;
    },
  };
}

// Browsers require a user gesture before audible playback.
let userGestured = false;
['pointerdown', 'keydown', 'touchstart'].forEach((event) => {
  window.addEventListener(event, () => { userGestured = true; }, { once: true, passive: true });
});
function hasUserGesture() { return userGestured; }

/** The overlay: creator info on the left, action rail on the right. */
function overlay(video, media) {
  const channel = video.channel || {};
  const viewerState = video.viewerState || {};

  // --- Action rail ---
  const likeBtn = actionButton({
    glyph: '♥',
    label: count(video.stats.likes),
    active: viewerState.liked,
    ariaLabel: 'Like',
    onClick: async (button) => {
      if (!requireAuth()) return;
      try {
        const result = await api.like(video.id);
        button.classList.toggle('active', result.liked);
        button.querySelector('.count').textContent = count(result.likes);
      } catch (error) { toast(error.message, 'error'); }
    },
  });

  const commentBtn = actionButton({
    glyph: '💬',
    label: count(video.stats.comments),
    ariaLabel: 'Comments',
    onClick: () => openComments(video),
  });

  const saveBtn = actionButton({
    glyph: '🔖',
    label: count(video.stats.saves),
    active: viewerState.saved,
    extraClass: 'saved',
    ariaLabel: 'Save',
    onClick: async (button) => {
      if (!requireAuth()) return;
      try {
        const result = await api.save(video.id);
        button.classList.toggle('active', result.saved);
        toast(result.saved ? 'Saved' : 'Removed from saved');
      } catch (error) { toast(error.message, 'error'); }
    },
  });

  const shareBtn = actionButton({
    glyph: '↗',
    label: count(video.stats.shares),
    ariaLabel: 'Share',
    onClick: () => openShare(video),
  });

  // --- Creator avatar with follow badge ---
  const avatarWrap = el('button', {
    class: `feed-avatar ${viewerState.following ? 'following' : ''}`,
    'aria-label': `${channel.name || 'Creator'} — open channel`,
    onclick: () => { location.hash = `#/@${channel.handle}`; },
  },
    avatar(channel.avatarUrl, channel.name, ''),
    el('span', {
      class: 'follow-badge',
      'aria-hidden': 'true',
      onclick: async (event) => {
        event.stopPropagation();
        if (!requireAuth()) return;
        try {
          const result = await api.follow(channel.id);
          avatarWrap.classList.toggle('following', result.following);
          event.target.textContent = result.following ? '✓' : '+';
          toast(result.following ? `Following ${channel.name}` : 'Unfollowed');
        } catch (error) { toast(error.message, 'error'); }
      },
    }, viewerState.following ? '✓' : '+'),
  );

  // --- Info column ---
  const title = el('div', { class: 'feed-title' }, video.title);
  title.addEventListener('click', () => title.classList.toggle('expanded'));

  const info = el('div', { class: 'feed-info' },
    el('a', {
      class: 'feed-handle',
      href: `#/@${channel.handle}`,
    }, `@${channel.handle || 'unknown'}`,
      channel.verified ? el('span', { class: 'verified' }, '✔') : null),
    title,
    // The sound chip: tapping it opens that sound's page. This is what makes
    // audio a discovery surface of its own.
    video.sound ? el('a', {
      class: 'feed-sound',
      href: `#/sound/${video.sound.id}`,
      'aria-label': `Sound: ${video.sound.title}`,
    },
      el('span', { class: 'note', 'aria-hidden': 'true' }, '♪'),
      el('span', { class: 'label' },
        `${video.sound.title}${video.sound.artist ? ` · ${video.sound.artist}` : ''}`),
    ) : null,
  );

  return el('div', { class: 'feed-overlay' },
    info,
    el('div', { class: 'feed-actions' },
      avatarWrap, likeBtn, commentBtn, saveBtn, shareBtn),
  );
}

function actionButton({ glyph, label, active, onClick, ariaLabel, extraClass = '' }) {
  const button = el('button', {
      class: `action-btn ${active ? 'active' : ''} ${extraClass}`,
      'aria-label': ariaLabel,
    },
    el('span', { class: 'glyph', 'aria-hidden': 'true' }, glyph),
    el('span', { class: 'count' }, label),
  );
  button.addEventListener('click', () => onClick(button));
  return button;
}

function requireAuth() {
  if (auth.signedIn) return true;
  location.hash = '#/signin';
  toast('Sign in to do that');
  return false;
}

/**
 * Play exactly one video at a time.
 *
 * The 60% threshold means a video becomes active only once it is genuinely the
 * one on screen, which avoids flickering between two during a fast swipe.
 */
function setupActiveVideoTracking(scroller, players) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.dataset.videoId;
      const controller = players.get(id);
      if (!controller) continue;

      if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
        // Pause everything else first, so audio never overlaps.
        for (const [otherId, other] of players) {
          if (otherId !== id) other.deactivate();
        }
        controller.activate();
      }
    }
  }, { root: scroller, threshold: [0, 0.6, 1] });

  for (const item of scroller.querySelectorAll('.feed-item')) observer.observe(item);
  scroller._observer = observer;

  // Report watch time if the user leaves or backgrounds the tab, so a session
  // that ends by closing the app is not lost.
  const flush = () => { for (const controller of players.values()) controller.report(); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { flush(); for (const c of players.values()) c.deactivate(); }
  });
  window.addEventListener('pagehide', flush);
}

/** Load the next page as the end approaches. */
function setupInfiniteScroll(scroller, state, players, kind) {
  scroller.addEventListener('scroll', async () => {
    if (state.loading || state.done) return;

    const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (remaining > scroller.clientHeight * 2) return;

    state.loading = true;
    try {
      const data = await api.feed({ kind, cursor: state.cursor, limit: 8 });
      if (!data.videos.length) { state.done = true; return; }

      for (const video of data.videos) {
        const item = feedItem(video, players);
        scroller.append(item);
        scroller._observer.observe(item);
      }
      state.cursor = data.nextCursor ?? state.cursor + data.videos.length;
      if (!data.nextCursor) state.done = true;
    } catch {
      // Silent: the user still has plenty to scroll. We retry on the next scroll.
    } finally {
      state.loading = false;
    }
  }, { passive: true });
}

/** Arrow keys and space, so the feed is usable without a touchscreen. (spec §45) */
function setupKeyboardNav(scroller) {
  scroller.addEventListener('keydown', (event) => {
    const height = scroller.clientHeight;
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      scroller.scrollBy({ top: height, behavior: 'smooth' });
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      scroller.scrollBy({ top: -height, behavior: 'smooth' });
    }
  });
  scroller.setAttribute('tabindex', '0');
  scroller.setAttribute('aria-label', 'Video feed. Use arrow keys to move between videos.');
}
