/**
 * SIGN IN / SIGN UP / ONBOARDING.
 *
 * The onboarding interest picker is not decoration: those choices become the
 * cold-start signal the recommendation engine uses before the user has any
 * watch history at all. (spec §22)
 */

import { api, auth } from '../api.js';
import { el, render, toast, loading } from '../ui.js';

export function signInView(container, { session }) {
  container.className = 'screen';
  let mode = 'signin';

  const errorBox = el('div', { class: 'field error', style: { display: 'none' } });

  const fields = {
    email: el('input', { class: 'input', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' }),
    password: el('input', { class: 'input', type: 'password', placeholder: 'Your password', autocomplete: 'current-password' }),
    username: el('input', { class: 'input', placeholder: 'yourname', autocomplete: 'username' }),
    displayName: el('input', { class: 'input', placeholder: 'How you want to be known' }),
  };

  const usernameField = el('div', { class: 'field', style: { display: 'none' } },
    el('label', { for: 'username' }, 'Username'),
    fields.username,
    el('div', { class: 'hint' }, 'Letters, numbers, dots and underscores. This becomes your @handle.'),
  );

  const displayNameField = el('div', { class: 'field', style: { display: 'none' } },
    el('label', {}, 'Display name'),
    fields.displayName,
  );

  const submit = el('button', { class: 'btn btn--primary btn--block' }, 'Sign in');

  const toggle = el('button', {
    class: 'btn btn--block',
    style: { marginTop: '10px' },
  }, 'Create an account instead');

  toggle.addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    const signup = mode === 'signup';
    usernameField.style.display = signup ? 'block' : 'none';
    displayNameField.style.display = signup ? 'block' : 'none';
    submit.textContent = signup ? 'Create account' : 'Sign in';
    toggle.textContent = signup ? 'I already have an account' : 'Create an account instead';
    fields.password.autocomplete = signup ? 'new-password' : 'current-password';
    fields.password.placeholder = signup ? 'At least 10 characters' : 'Your password';
    errorBox.style.display = 'none';
  });

  const doSubmit = async () => {
    errorBox.style.display = 'none';
    submit.disabled = true;
    submit.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';

    try {
      const payload = {
        email: fields.email.value.trim(),
        password: fields.password.value,
      };
      if (mode === 'signup') {
        payload.username = fields.username.value.trim();
        payload.displayName = fields.displayName.value.trim() || payload.username;
      }

      const result = mode === 'signup' ? await api.register(payload) : await api.login(payload);
      auth.token = result.token;
      await session.refresh();

      // A brand-new account goes straight to interest selection, so their very
      // first feed is already personalized rather than random.
      location.hash = mode === 'signup' ? '#/welcome' : '#/';
      toast(mode === 'signup' ? 'Welcome to LJBMK Social' : 'Signed in', 'success');
    } catch (error) {
      // Field-level errors from the API render next to the message.
      const detail = error.details
        ? Object.entries(error.details).map(([k, v]) => `${k}: ${v}`).join('  ')
        : '';
      errorBox.textContent = `${error.message} ${detail}`.trim();
      errorBox.style.display = 'block';
      submit.disabled = false;
      submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    }
  };

  submit.addEventListener('click', doSubmit);
  for (const input of Object.values(fields)) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });
  }

  render(container,
    el('div', { class: 'container', style: { paddingTop: '40px', maxWidth: '400px' } },
      el('div', { style: { textAlign: 'center', marginBottom: '26px' } },
        // The real logo, not a placeholder emoji.
        el('img', {
          src: '/assets/logo-wordmark.png',
          alt: 'LJBMK Social',
          style: { height: '44px', width: 'auto', marginBottom: '10px' },
        }),
        el('p', { style: { color: 'var(--text-muted)', margin: 0, fontSize: '14.5px' } },
          'Where a first video can find its audience.'),
      ),
      usernameField,
      displayNameField,
      el('div', { class: 'field' }, el('label', {}, 'Email'), fields.email),
      el('div', { class: 'field' }, el('label', {}, 'Password'), fields.password),
      errorBox,
      submit,
      toggle,
      el('p', {
        style: { textAlign: 'center', marginTop: '18px', fontSize: '13px', color: 'var(--text-faint)' },
      }, 'You can browse without an account — sign in to post, like, and comment.'),
    ),
  );
}

/**
 * Onboarding: pick interests.
 * These seed `user_interests` and give the cold-start feed something real to
 * work with on the very first scroll.
 */
export async function welcomeView(container, { session }) {
  container.className = 'screen';

  let topics = [];
  try {
    const system = await api.system();
    topics = system.topics;
  } catch {
    topics = ['technology', 'gaming', 'sports', 'music', 'education', 'comedy'];
  }

  const selected = new Set();
  const submit = el('button', { class: 'btn btn--primary btn--block', disabled: true },
    'Pick a few to continue');

  const chips = topics.map((topic) => {
    const chip = el('button', { class: 'chip' }, topic);
    chip.addEventListener('click', () => {
      if (selected.has(topic)) { selected.delete(topic); chip.classList.remove('selected'); }
      else { selected.add(topic); chip.classList.add('selected'); }

      submit.disabled = selected.size === 0;
      submit.textContent = selected.size === 0
        ? 'Pick a few to continue'
        : `Continue with ${selected.size} selected`;
    });
    return chip;
  });

  submit.addEventListener('click', async () => {
    submit.disabled = true;
    try {
      await api.setInterests([...selected]);
      await session.refresh();
      location.hash = '#/';
      toast('Your feed is ready', 'success');
    } catch (error) {
      toast(error.message, 'error');
      submit.disabled = false;
    }
  });

  render(container,
    el('div', { class: 'container', style: { paddingTop: '36px' } },
      el('h1', { style: { marginTop: 0 } }, 'What are you into?'),
      el('p', { style: { color: 'var(--text-muted)', marginBottom: '22px', lineHeight: '1.55' } },
        'Pick anything that sounds good. This is what your feed starts from — it learns and changes as you watch.'),
      el('div', { class: 'chip-row' }, chips),
      el('div', { style: { marginTop: '28px' } },
        submit,
        el('button', {
          class: 'btn btn--block',
          style: { marginTop: '9px' },
          onclick: () => { location.hash = '#/'; },
        }, 'Skip for now'),
      ),
    ),
  );
}
