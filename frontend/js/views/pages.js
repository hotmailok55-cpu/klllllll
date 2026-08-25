/**
 * REMAINING SCREENS: explore/search, channel, sound, library, notifications,
 * Creator Studio, and the admin dashboard.
 *
 * They share the same shape: fetch, then render — with an empty state that
 * comes from the API rather than being hard-coded here.
 */

import { api, auth } from '../api.js';
import {
  el, render, count, duration, watchTime, timeAgo, avatar, toast,
  emptyState, loading, errorState, statusBadge, sheet, closeSheet,
} from '../ui.js';

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** A thumbnail tile, used in every grid. */
export function videoTile(video, { showStatus = false } = {}) {
  return el('a', {
      class: 'grid-item',
      href: `#/watch/${video.id}`,
      'aria-label': video.title,
    },
    video.thumbnailUrl
      ? el('img', { src: video.thumbnailUrl, alt: '', loading: 'lazy' })
      : el('div', { class: 'grid-fallback', 'aria-hidden': 'true' }, '🎬'),
    showStatus && video.processingStatus && video.processingStatus !== 'ready'
      ? el('div', { class: 'grid-status' }, String(video.processingStatus).replace(/_/g, ' '))
      : null,
    showStatus && video.visibility && video.visibility !== 'public'
      ? el('div', { class: 'grid-status', style: { left: 'auto', right: '5px' } }, video.visibility)
      : null,
    el('div', { class: 'grid-meta' }, '▶ ', count(video.stats?.views ?? 0)),
  );
}

function topbar(title, ...extras) {
  return el('div', { class: 'topbar' }, el('h1', {}, title), ...extras);
}

// ---------------------------------------------------------------------------
// EXPLORE + SEARCH
// ---------------------------------------------------------------------------

export async function exploreView(container) {
  container.className = 'screen';

  const searchInput = el('input', {
    class: 'input',
    placeholder: 'Search videos, creators, sounds',
    'aria-label': 'Search',
    type: 'search',
  });

  const results = el('div', {});
  let debounce = null;

  const runSearch = async (query) => {
    if (!query.trim()) return loadDiscover();
    render(results, loading('Searching…'));
    try {
      const data = await api.search(query);
      if (data.total === 0) {
        return render(results, emptyState(data.empty, { icon: '🔍' }));
      }

      render(results,
        data.channels?.length ? el('div', {},
          el('h3', {}, 'Creators'),
          data.channels.map((channel) => el('a', {
              class: 'list-row', href: `#/@${channel.handle}`,
            },
            avatar(channel.avatarUrl, channel.name),
            el('div', { class: 'row-main' },
              el('div', { class: 'row-title' }, channel.name),
              el('div', { class: 'row-sub' },
                `@${channel.handle} · ${count(channel.followerCount)} followers`)),
          )),
        ) : null,

        data.sounds?.length ? el('div', {},
          el('h3', {}, 'Sounds'),
          data.sounds.map(soundRow),
        ) : null,

        data.videos?.length ? el('div', {},
          el('h3', {}, 'Videos'),
          el('div', { class: 'video-grid' }, data.videos.map((v) => videoTile(v))),
        ) : null,
      );
    } catch (error) {
      render(results, errorState(error, () => runSearch(query)));
    }
  };

  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(searchInput.value), 260);
  });

  /** The default explore screen: trending, sounds, and creators to discover. */
  async function loadDiscover() {
    render(results, loading());
    try {
      const [trending, sounds, creators] = await Promise.all([
        api.trending({ limit: 18 }),
        api.trendingSounds().catch(() => ({ sounds: [] })),
        api.suggestedChannels().catch(() => ({ channels: [] })),
      ]);

      const sections = [];

      if (trending.videos.length) {
        sections.push(el('div', {},
          el('h3', {}, '🔥 Trending now'),
          el('p', { style: { color: 'var(--text-faint)', fontSize: '12.5px', marginTop: '-6px' } },
            'Ranked by how fast something is growing, not by lifetime views.'),
          el('div', { class: 'video-grid' }, trending.videos.map((v) => videoTile(v))),
        ));
      } else if (trending.empty) {
        sections.push(emptyState(trending.empty, { icon: '🔥' }));
      }

      if (creators.channels?.length) {
        sections.push(el('div', { style: { marginTop: '22px' } },
          el('h3', {}, '✨ Creators to discover'),
          el('p', { style: { color: 'var(--text-faint)', fontSize: '12.5px', marginTop: '-6px' } },
            'A mix of new and established — not just the biggest accounts.'),
          creators.channels.map((channel) => el('a', {
              class: 'list-row', href: `#/@${channel.handle}`,
            },
            avatar(channel.avatarUrl, channel.name),
            el('div', { class: 'row-main' },
              el('div', { class: 'row-title' }, channel.name),
              el('div', { class: 'row-sub' },
                `@${channel.handle} · ${count(channel.followerCount)} followers · ${channel.videoCount} videos`)),
          )),
        ));
      }

      if (sounds.sounds?.length) {
        sections.push(el('div', { style: { marginTop: '22px' } },
          el('h3', {}, '🎵 Sounds people are using'),
          sounds.sounds.map(soundRow),
        ));
      }

      render(results, sections.length ? sections : emptyState({
        title: 'Nothing to explore yet.',
        body: 'Once people start posting, this is where you will find what is taking off.',
        action: { label: 'Post a video', href: '/upload' },
      }, { icon: '🌱' }));
    } catch (error) {
      render(results, errorState(error, loadDiscover));
    }
  }

  render(container,
    el('div', { class: 'topbar' }, searchInput),
    el('div', { class: 'container' }, results),
  );

  loadDiscover();
}

function soundRow(sound) {
  return el('a', { class: 'list-row', href: `#/sound/${sound.id}` },
    el('div', { class: 'avatar', 'aria-hidden': 'true' }, '♪'),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, sound.title),
      el('div', { class: 'row-sub' },
        `${sound.artist || 'Original'} · ${count(sound.useCount)} videos`),
    ),
    sound.isOriginal ? el('span', { class: 'badge badge--muted' }, 'original') : null,
  );
}

// ---------------------------------------------------------------------------
// SOUND PAGE — "use this sound"
// ---------------------------------------------------------------------------

export async function soundView(container, { id }) {
  container.className = 'screen';
  render(container, loading());

  try {
    const data = await api.sound(id);
    const { sound, videos } = data;

    render(container,
      topbar('Sound'),
      el('div', { class: 'container' },
        el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '18px' } },
          el('div', {
            class: 'avatar avatar--lg',
            style: { fontSize: '30px' },
            'aria-hidden': 'true',
          }, '♪'),
          el('div', { style: { flex: '1', minWidth: 0 } },
            el('h2', { style: { margin: '0 0 4px' } }, sound.title),
            el('div', { style: { color: 'var(--text-muted)', fontSize: '14px' } },
              sound.artist || 'Original sound'),
            el('div', { style: { color: 'var(--text-faint)', fontSize: '13px', marginTop: '3px' } },
              `${count(sound.useCount)} videos · ${duration(sound.durationMs)}`),
          ),
        ),

        // Licensing is surfaced honestly rather than hidden. (spec §81)
        sound.usable === false
          ? el('div', { class: 'card', style: { borderColor: 'var(--warning)' } },
              el('div', { style: { fontWeight: '600', marginBottom: '4px' } },
                '⚠️ Not available to use'),
              el('div', { style: { fontSize: '13.5px', color: 'var(--text-muted)' } },
                sound.rightsNote || 'We have not confirmed the rights for this sound, so it cannot be added to new videos.'))
          : el('button', {
              class: 'btn btn--primary btn--block',
              onclick: () => {
                sessionStorage.setItem('loop.pendingSound', sound.id);
                location.hash = '#/upload';
              },
            }, '🎬  Use this sound'),

        el('h3', { style: { marginTop: '24px' } }, 'Videos with this sound'),
        videos.length
          ? el('div', { class: 'video-grid' }, videos.map((v) => videoTile(v)))
          : emptyState({
              title: 'No videos yet.',
              body: 'Be the first to make something with this sound.',
            }, { icon: '🎵' }),
      ),
    );
  } catch (error) {
    render(container, errorState(error, () => soundView(container, { id })));
  }
}

// ---------------------------------------------------------------------------
// CHANNEL
// ---------------------------------------------------------------------------

export async function channelView(container, { handle }) {
  container.className = 'screen';
  render(container, loading());

  try {
    const data = await api.channel(handle);
    const { channel, videos } = data;

    const followButton = el('button', {
      class: `btn ${channel.viewerState?.following ? '' : 'btn--primary'}`,
      style: { flex: '1' },
    }, channel.viewerState?.following ? 'Following' : 'Follow');

    followButton.addEventListener('click', async () => {
      if (!auth.signedIn) { location.hash = '#/signin'; return toast('Sign in to follow'); }
      try {
        const result = await api.follow(channel.id);
        followButton.textContent = result.following ? 'Following' : 'Follow';
        followButton.classList.toggle('btn--primary', !result.following);
        followerCount.textContent = count(result.followerCount);
      } catch (error) { toast(error.message, 'error'); }
    });

    const followerCount = el('strong', {}, count(channel.followerCount));

    render(container,
      topbar(`@${channel.handle}`),
      el('div', { class: 'container' },
        el('div', { style: { textAlign: 'center', marginBottom: '18px' } },
          avatar(channel.avatarUrl, channel.name, 'avatar avatar--lg'),
          el('h2', { style: { margin: '10px 0 3px' } }, channel.name),
          el('div', { style: { color: 'var(--text-muted)', fontSize: '14px' } }, `@${channel.handle}`),
        ),

        el('div', {
          style: { display: 'flex', justifyContent: 'center', gap: '26px', marginBottom: '16px', fontSize: '14px' },
        },
          el('div', { style: { textAlign: 'center' } }, followerCount,
            el('div', { style: { color: 'var(--text-muted)', fontSize: '12.5px' } }, 'Followers')),
          el('div', { style: { textAlign: 'center' } }, el('strong', {}, count(channel.videoCount)),
            el('div', { style: { color: 'var(--text-muted)', fontSize: '12.5px' } }, 'Videos')),
          el('div', { style: { textAlign: 'center' } }, el('strong', {}, count(channel.totalViews)),
            el('div', { style: { color: 'var(--text-muted)', fontSize: '12.5px' } }, 'Views')),
        ),

        channel.description
          ? el('p', { style: { textAlign: 'center', fontSize: '14px', color: 'var(--text-muted)' } },
              channel.description)
          : null,

        el('div', { style: { display: 'flex', gap: '9px', marginBottom: '20px' } },
          channel.viewerState?.isOwner
            ? el('a', { class: 'btn', style: { flex: '1' }, href: '#/studio' }, 'Creator Studio')
            : followButton,
        ),

        videos.length
          ? el('div', { class: 'video-grid' }, videos.map((v) => videoTile(v)))
          : emptyState({
              title: 'No videos yet.',
              body: channel.viewerState?.isOwner
                ? 'Post your first video and it will show up here.'
                : `${channel.name} has not posted anything yet.`,
              action: channel.viewerState?.isOwner
                ? { label: 'Post a video', href: '/upload' } : null,
            }, { icon: '🎬' }),
      ),
    );
  } catch (error) {
    render(container, errorState(error, () => channelView(container, { handle })));
  }
}

// ---------------------------------------------------------------------------
// LIBRARY (saved, playlists, following)
// ---------------------------------------------------------------------------

export async function libraryView(container) {
  container.className = 'screen';

  if (!auth.signedIn) {
    return render(container,
      topbar('Library'),
      emptyState({
        title: 'Sign in to see your library',
        body: 'Saved videos, playlists, and the creators you follow all live here.',
        action: { label: 'Sign in', href: '/signin' },
      }, { icon: '📚' }));
  }

  render(container, loading());

  try {
    const [saved, playlists, subs] = await Promise.all([
      api.saved(),
      api.playlists(),
      api.subscriptions(),
    ]);

    render(container,
      topbar('Library'),
      el('div', { class: 'container' },
        el('h3', {}, 'Saved'),
        saved.videos.length
          ? el('div', { class: 'video-grid' }, saved.videos.slice(0, 12).map((v) => videoTile(v)))
          : emptyState(saved.empty, { icon: '🔖' }),

        el('h3', { style: { marginTop: '24px' } }, 'Playlists'),
        playlists.playlists.length
          ? playlists.playlists.map((playlist) => el('div', { class: 'list-row' },
              el('div', { class: 'avatar', 'aria-hidden': 'true' }, '☰'),
              el('div', { class: 'row-main' },
                el('div', { class: 'row-title' }, playlist.name),
                el('div', { class: 'row-sub' },
                  `${playlist.videoCount} videos · ${playlist.visibility}`)),
            ))
          : emptyState(playlists.empty, { icon: '☰' }),

        el('h3', { style: { marginTop: '24px' } }, 'From creators you follow'),
        subs.videos.length
          ? el('div', { class: 'video-grid' }, subs.videos.slice(0, 12).map((v) => videoTile(v)))
          : emptyState(subs.empty, { icon: '👥', onAction: () => { location.hash = '#/explore'; } }),
      ),
    );
  } catch (error) {
    render(container, errorState(error, () => libraryView(container)));
  }
}

// ---------------------------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------------------------

export async function notificationsView(container, { session }) {
  container.className = 'screen';

  if (!auth.signedIn) {
    return render(container, topbar('Notifications'), emptyState({
      title: 'Sign in to see notifications',
      action: { label: 'Sign in', href: '/signin' },
    }, { icon: '🔔' }));
  }

  render(container, loading());

  try {
    const data = await api.notifications();

    // Mark read on view, then refresh the badge.
    if (data.unread > 0) {
      api.markNotificationsRead().then(() => session.refresh()).catch(() => {});
    }

    const ICONS = {
      like: '♥', comment: '💬', reply: '↩', follow: '👤',
      upload: '🎬', moderation: '⚠️', system: 'ℹ️', security: '🔒',
    };

    render(container,
      topbar('Notifications'),
      el('div', { class: 'container' },
        data.notifications.length
          ? data.notifications.map((n) => el('a', {
              class: 'list-row',
              href: n.link ? `#${n.link}` : '#/',
              style: n.read ? {} : { background: 'var(--accent-soft)', borderRadius: '10px', padding: '11px 10px' },
            },
            el('div', { class: 'avatar', 'aria-hidden': 'true' }, ICONS[n.type] || '•'),
            el('div', { class: 'row-main' },
              el('div', { class: 'row-title' }, n.title),
              el('div', { class: 'row-sub' },
                `${n.body ? n.body + ' · ' : ''}${timeAgo(n.createdAt)}`)),
          ))
          : emptyState(data.empty, { icon: '🎉' }),
      ),
    );
  } catch (error) {
    render(container, errorState(error, () => notificationsView(container, { session })));
  }
}

// ---------------------------------------------------------------------------
// CREATOR STUDIO
// ---------------------------------------------------------------------------

export async function studioView(container, { session }) {
  container.className = 'screen';

  if (!auth.signedIn) { location.hash = '#/signin'; return; }
  render(container, loading());

  try {
    const data = await api.studio();
    const { analytics, recentVideos, processing } = data;

    const stat = (label, value, sub) => el('div', { class: 'stat' },
      el('div', { class: 'stat-label' }, label),
      el('div', { class: 'stat-value' }, value),
      sub ? el('div', { class: 'stat-sub' }, sub) : null,
    );

    // Views-per-day chart, drawn from real event data.
    const daily = analytics.daily || [];
    const maxViews = Math.max(...daily.map((d) => d.views), 1);

    render(container,
      topbar('Creator Studio',
        el('a', { class: 'btn btn--sm btn--primary', href: '#/upload' }, '+ New')),
      el('div', { class: 'container' },
        data.empty ? emptyState(data.empty, { icon: '🎬' }) : null,

        processing.length ? el('div', { class: 'card' },
          el('div', { style: { fontWeight: '600', marginBottom: '9px' } }, 'Processing'),
          processing.map((p) => el('div', {
              style: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', gap: '10px' },
            },
            el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.title),
            statusBadge(p.status))),
        ) : null,

        el('div', { class: 'stat-grid' },
          stat('Views (28 days)', count(analytics.recent.views)),
          stat('New followers', `+${count(analytics.recent.newFollowers)}`),
          stat('Total views', count(analytics.totals.views)),
          stat('Watch time', watchTime(analytics.totals.watchTimeMs)),
        ),

        daily.length ? el('div', { class: 'card' },
          el('div', { class: 'stat-label' }, 'Views per day'),
          el('div', { class: 'chart' },
            daily.map((d) => el('div', {
              class: 'chart-bar',
              style: { height: `${(d.views / maxViews) * 100}%` },
              title: `${d.day}: ${d.views} views`,
            }))),
        ) : null,

        el('h3', {}, 'Your videos'),
        recentVideos.length
          ? el('div', { class: 'video-grid' },
              recentVideos.map((v) => videoTile(v, { showStatus: true })))
          : null,

        el('div', { style: { marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' } },
          el('a', { class: 'btn btn--block', href: '#/studio/copyright' }, 'Copyright dashboard'),
          session.user?.role === 'admin'
            ? el('a', { class: 'btn btn--block', href: '#/admin' }, 'Admin dashboard')
            : null,
          el('button', {
            class: 'btn btn--block',
            onclick: async () => {
              await api.logout().catch(() => {});
              auth.token = null;
              await session.refresh();
              location.hash = '#/';
              toast('Signed out');
            },
          }, 'Sign out'),
        ),
      ),
    );
  } catch (error) {
    render(container, errorState(error, () => studioView(container, { session })));
  }
}

/** Copyright dashboard — what matched, and what it means for the creator. */
export async function copyrightView(container) {
  container.className = 'screen';
  if (!auth.signedIn) { location.hash = '#/signin'; return; }
  render(container, loading());

  try {
    const data = await api.studioCopyright();
    render(container,
      topbar('Copyright'),
      el('div', { class: 'container' },
        el('p', { style: { color: 'var(--text-muted)', fontSize: '13.5px' } },
          'Copyright checks run automatically on every upload. A check that has not finished does not block your video.'),
        data.cases.length
          ? data.cases.map((item) => el('div', { class: 'card' },
              el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', marginBottom: '7px' } },
                el('strong', {}, item.videoTitle),
                statusBadge(item.result)),
              el('div', { style: { fontSize: '13.5px', color: 'var(--text-muted)', lineHeight: '1.5' } },
                item.explanation),
              item.licenseState && item.licenseState !== 'unknown'
                ? el('div', { style: { marginTop: '8px' } },
                    el('span', { class: 'badge badge--info' }, `licence: ${item.licenseState}`))
                : null,
            ))
          : emptyState({
              title: 'No copyright issues.',
              body: 'Nothing on your channel has been flagged.',
            }, { icon: '✅' }),
      ),
    );
  } catch (error) {
    render(container, errorState(error, () => copyrightView(container)));
  }
}

// ---------------------------------------------------------------------------
// ADMIN — the API registry (spec §5, §77)
// ---------------------------------------------------------------------------

export async function adminView(container) {
  container.className = 'screen';
  render(container, loading());

  try {
    const [overview, integrations] = await Promise.all([
      api.adminOverview(),
      api.adminIntegrations(),
    ]);

    const stat = (label, value) => el('div', { class: 'stat' },
      el('div', { class: 'stat-label' }, label),
      el('div', { class: 'stat-value' }, count(value)),
    );

    render(container,
      topbar('Admin'),
      el('div', { class: 'container' },
        el('div', { class: 'stat-grid' },
          stat('Users', overview.counts.users),
          stat('Videos', overview.counts.videos),
          stat('Open reports', overview.counts.openReports),
          stat('Moderation queue', overview.counts.pendingModeration),
        ),

        el('h3', {}, 'API integrations'),
        el('p', { style: { color: 'var(--text-faint)', fontSize: '12.5px', marginTop: '-6px' } },
          'Secret values are never shown here — only whether a credential is configured.'),

        integrations.integrations.map((integration) => integrationCard(integration)),

        el('h3', { style: { marginTop: '24px' } }, 'System'),
        el('div', { class: 'card' },
          row('Queue', `${overview.queue.queued} queued · ${overview.queue.running} running · ${overview.queue.dead} dead`),
          row('Memory', `${overview.memory.heapUsedMb} MB`),
          row('Uptime', `${Math.round(overview.memory.uptimeSeconds / 60)} min`),
          row('Platform stage', overview.platform.stage),
        ),
      ),
    );
  } catch (error) {
    render(container, errorState(error, () => adminView(container)));
  }
}

function row(label, value) {
  return el('div', {
      style: { display: 'flex', justifyContent: 'space-between', padding: '7px 0', fontSize: '14px', gap: '10px' },
    },
    el('span', { style: { color: 'var(--text-muted)' } }, label),
    el('strong', {}, String(value)),
  );
}

/** One integration row with Test / Enable controls. */
function integrationCard(integration) {
  const testButton = el('button', { class: 'btn btn--sm' }, 'Test');
  const resultLine = el('div', {
    style: { fontSize: '12.5px', marginTop: '8px', color: 'var(--text-muted)' },
  });

  testButton.addEventListener('click', async () => {
    testButton.disabled = true;
    testButton.textContent = 'Testing…';
    try {
      const { result } = await api.testIntegration(integration.key);
      resultLine.textContent = `${result.ok ? '✅' : '❌'} ${result.message} (${result.ms}ms)`;
      resultLine.style.color = result.ok ? 'var(--success)' : 'var(--danger)';
    } catch (error) {
      resultLine.textContent = `❌ ${error.message}`;
      resultLine.style.color = 'var(--danger)';
    } finally {
      testButton.disabled = false;
      testButton.textContent = 'Test';
    }
  });

  const toggleButton = el('button', { class: 'btn btn--sm' },
    integration.enabled ? 'Disable' : 'Enable');

  toggleButton.addEventListener('click', async () => {
    try {
      const result = await api.setIntegrationEnabled(integration.key, !integration.enabled);
      integration.enabled = result.integration.enabled;
      toggleButton.textContent = integration.enabled ? 'Disable' : 'Enable';
      toast(`${integration.label} ${integration.enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  });

  return el('div', { class: 'card' },
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '9px' } },
      el('strong', { style: { flex: '1' } }, integration.label),
      statusBadge(integration.status)),

    row('Provider', integration.provider),
    row('Credential', integration.configured ? 'Configured' : 'Not configured'),
    row('Last success', integration.lastSuccessAt ? timeAgo(integration.lastSuccessAt) : '—'),
    row('Last test', integration.lastTestAt ? timeAgo(integration.lastTestAt) : 'Never'),
    integration.avgResponseMs ? row('Avg response', `${integration.avgResponseMs} ms`) : null,
    integration.circuitOpen
      ? el('div', { class: 'badge badge--danger', style: { marginTop: '6px' } },
          'Circuit open — calls paused')
      : null,
    integration.lastError
      ? el('div', { style: { fontSize: '12px', color: 'var(--danger)', marginTop: '6px' } },
          integration.lastError)
      : null,

    el('div', { style: { display: 'flex', gap: '8px', marginTop: '11px' } },
      testButton, toggleButton),
    resultLine,
  );
}
