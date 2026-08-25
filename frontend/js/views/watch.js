/**
 * SINGLE VIDEO PAGE (the target of a shared link).
 *
 * Renders the video with the same player behaviour as the feed, then the
 * related videos underneath — which come from the same recommendation
 * pipeline, so there is one algorithm rather than two.
 */

import { api, auth } from '../api.js';
import { el, render, count, timeAgo, avatar, toast } from '../ui.js';
import { openComments } from './comments.js';
import { openShare } from './share.js';
import { videoTile } from './pages.js';

export default function renderSingle(container, { video, related }) {
  container.className = 'screen';

  const media = video.videoUrl
    ? el('video', {
        src: video.videoUrl,
        poster: video.thumbnailUrl || undefined,
        controls: true,          // full controls here, unlike the swipe feed
        playsinline: true,
        autoplay: true,
        loop: video.kind === 'short',
        style: { width: '100%', maxHeight: '70dvh', background: '#000', display: 'block' },
        'aria-label': video.title,
      })
    : el('div', { class: 'video-placeholder', style: { height: '48dvh' } },
        el('div', { class: 'ph-icon' }, '🎬'),
        el('div', {}, 'This video is still processing'));

  // Watch tracking, same contract as the feed: accumulate, report on leave.
  let watchedMs = 0;
  let lastTick = null;
  let reported = false;

  if (media.tagName === 'VIDEO') {
    media.addEventListener('timeupdate', () => {
      const now = performance.now();
      if (lastTick !== null && !media.paused) watchedMs += Math.min(now - lastTick, 1000);
      lastTick = now;
    });
  }

  const report = () => {
    if (reported || watchedMs < 300) return;
    reported = true;
    api.watch(video.id, { watchMs: Math.round(watchedMs), source: 'direct' }).catch(() => {});
  };
  window.addEventListener('pagehide', report, { once: true });

  const channel = video.channel || {};
  const viewerState = video.viewerState || {};

  const likeButton = el('button', {
    class: 'btn btn--sm',
    style: viewerState.liked ? { color: 'var(--accent)' } : {},
  }, `♥ ${count(video.stats.likes)}`);

  likeButton.addEventListener('click', async () => {
    if (!auth.signedIn) { location.hash = '#/signin'; return toast('Sign in to like'); }
    try {
      const result = await api.like(video.id);
      likeButton.textContent = `♥ ${count(result.likes)}`;
      likeButton.style.color = result.liked ? 'var(--accent)' : '';
    } catch (error) { toast(error.message, 'error'); }
  });

  const followButton = el('button', {
    class: `btn btn--sm ${viewerState.following ? '' : 'btn--primary'}`,
  }, viewerState.following ? 'Following' : 'Follow');

  followButton.addEventListener('click', async () => {
    if (!auth.signedIn) { location.hash = '#/signin'; return toast('Sign in to follow'); }
    try {
      const result = await api.follow(channel.id);
      followButton.textContent = result.following ? 'Following' : 'Follow';
      followButton.classList.toggle('btn--primary', !result.following);
    } catch (error) { toast(error.message, 'error'); }
  });

  render(container,
    el('div', { class: 'topbar' },
      el('a', { class: 'btn btn--sm', href: '#/', 'aria-label': 'Back' }, '←'),
      el('h1', {}, 'Video')),

    media,

    el('div', { class: 'container' },
      el('h2', { style: { fontSize: '18px', margin: '0 0 7px', lineHeight: '1.35' } }, video.title),
      el('div', { style: { color: 'var(--text-muted)', fontSize: '13.5px', marginBottom: '14px' } },
        `${count(video.stats.views)} views · ${timeAgo(video.publishedAt || video.createdAt)}`),

      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' } },
        likeButton,
        el('button', {
          class: 'btn btn--sm',
          onclick: () => openComments(video),
        }, `💬 ${count(video.stats.comments)}`),
        el('button', {
          class: 'btn btn--sm',
          onclick: () => openShare(video),
        }, '↗ Share'),
        el('button', {
          class: 'btn btn--sm',
          onclick: async () => {
            if (!auth.signedIn) { location.hash = '#/signin'; return toast('Sign in to save'); }
            try {
              const result = await api.save(video.id);
              toast(result.saved ? 'Saved' : 'Removed from saved');
            } catch (error) { toast(error.message, 'error'); }
          },
        }, '🔖 Save'),
      ),

      el('div', { class: 'list-row' },
        avatar(channel.avatarUrl, channel.name),
        el('a', { class: 'row-main', href: `#/@${channel.handle}` },
          el('div', { class: 'row-title' }, channel.name),
          el('div', { class: 'row-sub' }, `${count(channel.followerCount)} followers`)),
        viewerState.isOwner ? null : followButton,
      ),

      video.sound ? el('a', {
          class: 'feed-sound feed-sound--inline',
          href: `#/sound/${video.sound.id}`,
          style: { margin: '14px 0' },
        },
        el('span', { class: 'note', 'aria-hidden': 'true' }, '♪'),
        el('span', { class: 'label' },
          `${video.sound.title}${video.sound.artist ? ` · ${video.sound.artist}` : ''}`),
      ) : null,

      video.description
        ? el('p', { style: { fontSize: '14.5px', lineHeight: '1.6', whiteSpace: 'pre-wrap' } },
            video.description)
        : null,

      related?.length ? el('div', {},
        el('h3', {}, 'Up next'),
        el('div', { class: 'video-grid' }, related.map((v) => videoTile(v))),
      ) : null,
    ),
  );

  // Cleanup: report the watch and stop playback when navigating away.
  return () => { report(); if (media.pause) media.pause(); };
}
