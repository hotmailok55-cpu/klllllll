/**
 * SHARE + REPORT sheets.
 */

import { api, auth } from '../api.js';
import { el, sheet, toast, closeSheet } from '../ui.js';

export function openShare(video) {
  const url = `${location.origin}/#/watch/${video.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied', 'success');
    } catch {
      // Clipboard access can be refused; show the link so it can be copied by hand.
      prompt('Copy this link:', url);
    }
    api.share(video.id).catch(() => {});
  };

  // Use the OS share sheet when the browser offers one — it is what people expect on a phone.
  const nativeShare = async () => {
    try {
      await navigator.share({ title: video.title, url });
      api.share(video.id).catch(() => {});
      closeSheet();
    } catch { /* the user dismissed it */ }
  };

  const option = (icon, label, onClick) => el('button', {
      class: 'list-row',
      style: { width: '100%', textAlign: 'left' },
      onclick: onClick,
    },
    el('div', { class: 'avatar', 'aria-hidden': 'true' }, icon),
    el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, label)),
  );

  sheet({
    title: 'Share',
    body: el('div', {},
      navigator.share ? option('📤', 'Share via…', nativeShare) : null,
      option('🔗', 'Copy link', copy),
      option('🚩', 'Report this video', () => { closeSheet(); openReport('video', video.id); }),
    ),
  });
}

/** Report flow — used for videos, comments, and channels. (spec §33) */
export function openReport(targetType, targetId) {
  if (!auth.signedIn) {
    location.hash = '#/signin';
    return toast('Sign in to report');
  }

  const CATEGORIES = [
    ['spam', 'Spam or misleading'],
    ['harassment', 'Harassment or bullying'],
    ['unsafe', 'Dangerous or harmful'],
    ['scam', 'Scam or fraud'],
    ['copyright', 'Copyright concern'],
    ['impersonation', 'Impersonation'],
    ['other', 'Something else'],
  ];

  let selected = null;
  const details = el('textarea', {
    class: 'textarea',
    placeholder: 'Add any detail that would help us review this (optional)',
    'aria-label': 'Report details',
    maxlength: '1000',
  });

  const submit = el('button', { class: 'btn btn--primary btn--block', disabled: true }, 'Submit report');

  const options = CATEGORIES.map(([value, label]) => {
    const button = el('button', { class: 'chip', style: { textTransform: 'none' } }, label);
    button.addEventListener('click', () => {
      selected = value;
      for (const other of options) other.classList.remove('selected');
      button.classList.add('selected');
      submit.disabled = false;
    });
    return button;
  });

  submit.addEventListener('click', async () => {
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const path = targetType === 'video'
        ? `/videos/${targetId}/report`
        : `/comments/${targetId}/report`;
      await api.post(path, { category: selected, details: details.value.trim() });
      closeSheet();
      toast('Thanks — our team will review this.', 'success');
    } catch (error) {
      toast(error.message, 'error');
      submit.disabled = false;
      submit.textContent = 'Submit report';
    }
  });

  sheet({
    title: 'Report',
    body: el('div', {},
      el('p', { style: { color: 'var(--text-muted)', fontSize: '14px', marginTop: 0 } },
        'Reports are reviewed by our moderation team. Nothing is removed automatically because of a report.'),
      el('div', { class: 'chip-row', style: { marginBottom: '14px' } }, options),
      details,
    ),
    footer: submit,
  });
}
