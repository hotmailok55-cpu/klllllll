/**
 * UI PRIMITIVES.
 *
 * Small helpers shared by every view: safe DOM building, formatting, toasts,
 * and bottom sheets.
 *
 * SECURITY NOTE: `el()` sets text via textContent, never innerHTML, so any
 * user-supplied string (a video title, a comment, a display name) cannot inject
 * markup. This is the frontend half of "never trust data from the browser".
 */

/**
 * Build an element.
 *   el('div', { class: 'card' }, 'text', childElement)
 * `html:` is available for trusted, developer-authored markup only — never
 * pass user content to it.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, value);
    }
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replace an element's contents. */
export function render(target, ...children) {
  target.replaceChildren(...children.flat().filter(Boolean));
  return target;
}

// --- Formatting -----------------------------------------------------------

/** 1234 -> "1.2K". Keeps counts readable in the tight action rail. */
export function count(n) {
  const value = Number(n) || 0;
  if (value < 1000) return String(value);
  if (value < 1_000_000) return (value / 1000).toFixed(value < 10_000 ? 1 : 0).replace('.0', '') + 'K';
  if (value < 1_000_000_000) return (value / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  return (value / 1_000_000_000).toFixed(1).replace('.0', '') + 'B';
}

/** Milliseconds -> "1:05". */
export function duration(ms) {
  const total = Math.round((Number(ms) || 0) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Watch time in a human unit. */
export function watchTime(ms) {
  const hours = (Number(ms) || 0) / 3_600_000;
  if (hours >= 1) return `${hours.toFixed(1)} h`;
  const minutes = (Number(ms) || 0) / 60_000;
  if (minutes >= 1) return `${Math.round(minutes)} min`;
  return `${Math.round((Number(ms) || 0) / 1000)} s`;
}

/** "3 days ago". */
export function timeAgo(iso) {
  if (!iso) return '';
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  const steps = [
    [31536000, 'y'], [2592000, 'mo'], [604800, 'w'],
    [86400, 'd'], [3600, 'h'], [60, 'm'],
  ];
  for (const [size, label] of steps) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${label} ago`;
  }
  return 'just now';
}

/** Deterministic avatar fallback: initials on a colour derived from the name. */
export function avatar(source, name, className = 'avatar') {
  if (source) {
    return el('img', { class: className, src: source, alt: '', loading: 'lazy' });
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  // Hash the name so the same person always gets the same colour.
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return el('div', {
    class: className,
    style: { background: `hsl(${hash}, 55%, 42%)`, color: '#fff' },
    'aria-hidden': 'true',
  }, initial);
}

// --- Toasts ---------------------------------------------------------------

export function toast(message, variant = '') {
  const root = document.getElementById('toasts');
  const node = el('div', { class: `toast ${variant ? `toast--${variant}` : ''}` }, message);
  root.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 0.25s';
    setTimeout(() => node.remove(), 250);
  }, 2600);
}

// --- Bottom sheets --------------------------------------------------------

let activeSheet = null;

/**
 * Open a bottom sheet. Returns a close function.
 * Handles Escape, backdrop click, and focus, so every sheet behaves the same.
 */
export function sheet({ title, body, footer, onClose }) {
  closeSheet();

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    activeSheet = null;
    if (onClose) onClose();
  };

  const onKey = (event) => { if (event.key === 'Escape') close(); };

  const panel = el('div', {
      class: 'sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title || 'Dialog',
      onclick: (e) => e.stopPropagation(),
    },
    el('div', { class: 'grabber' }),
    title ? el('div', { class: 'sheet-header' },
      el('h3', {}, title),
      el('button', { class: 'btn btn--sm', onclick: close, 'aria-label': 'Close' }, '✕')
    ) : null,
    el('div', { class: 'sheet-body' }, body),
    footer ? el('div', { class: 'sheet-footer' }, footer) : null,
  );

  const backdrop = el('div', { class: 'sheet-backdrop', onclick: close }, panel);
  document.getElementById('sheet-root').append(backdrop);
  document.addEventListener('keydown', onKey);
  activeSheet = { close, panel };

  // Move focus into the sheet for keyboard and screen-reader users.
  const focusable = panel.querySelector('input, textarea, button');
  if (focusable) setTimeout(() => focusable.focus(), 60);

  return close;
}

export function closeSheet() {
  if (activeSheet) activeSheet.close();
}

export function currentSheet() { return activeSheet; }

// --- Empty states ---------------------------------------------------------

/**
 * Render an empty state from the API's own `empty` object, so the copy comes
 * from the backend's understanding of the situation rather than being
 * hard-coded in the UI. (spec §8 — "do NOT hard-code the message")
 */
export function emptyState(data, { icon = '✨', onAction } = {}) {
  if (!data) return null;

  const button = (action, primary) => action
    ? el('button', {
        class: `btn ${primary ? 'btn--primary' : ''} btn--block`,
        onclick: () => (onAction ? onAction(action) : (location.hash = action.href)),
      }, action.label)
    : null;

  return el('div', { class: 'empty-state' },
    el('div', { class: 'icon', 'aria-hidden': 'true' }, icon),
    el('h2', {}, data.title),
    data.body ? el('p', {}, data.body) : null,
    (data.action || data.secondaryAction)
      ? el('div', { class: 'actions' },
          button(data.action, true),
          button(data.secondaryAction, false))
      : null,
  );
}

/** A full-screen loading state. */
export function loading(message = 'Loading…') {
  return el('div', { class: 'empty-state' },
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    el('p', {}, message),
  );
}

/** Consistent error display, with a retry affordance where possible. */
export function errorState(error, onRetry) {
  return el('div', { class: 'empty-state' },
    el('div', { class: 'icon', 'aria-hidden': 'true' }, '⚠️'),
    el('h2', {}, 'Something went wrong'),
    el('p', {}, error?.message || 'Please try again.'),
    onRetry ? el('div', { class: 'actions' },
      el('button', { class: 'btn btn--primary btn--block', onclick: onRetry }, 'Try again')
    ) : null,
  );
}

/** Status badge with a sensible colour per state. */
export function statusBadge(status) {
  const map = {
    ready: 'success', approved: 'success', clear: 'success', connected: 'success', cleared: 'success',
    processing: 'info', uploading: 'info', uploaded: 'info', pending: 'warning',
    checking_copyright: 'info', checking_safety: 'info', draft: 'muted',
    review: 'warning', match: 'warning', claim: 'warning', flagged: 'warning',
    degraded: 'warning', not_connected: 'muted', disabled: 'muted', unknown: 'muted',
    failed: 'danger', removed: 'danger', block: 'danger', blocked: 'danger',
    restrict: 'danger', error: 'danger',
  };
  return el('span', { class: `badge badge--${map[status] || 'muted'}` },
    String(status).replace(/_/g, ' '));
}
