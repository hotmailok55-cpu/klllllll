/**
 * UPLOAD FLOW (spec §50, §72).
 *
 * Every stage is visible. The user always knows whether the app is working,
 * what it is doing, and what happens next:
 *
 *   Choose file -> Uploading (%) -> Processing -> Checking copyright ->
 *   Checking safety -> Ready -> Details -> Publish
 *
 * The draft is created on the server BEFORE the bytes are sent, so an
 * interrupted upload can be resumed from the Studio instead of lost.
 */

import { api, auth } from '../api.js';
import { el, render, toast, statusBadge } from '../ui.js';

export function uploadView(container) {
  container.className = 'screen';

  if (!auth.signedIn) {
    location.hash = '#/signin';
    return;
  }

  let videoId = null;
  let pollTimer = null;

  // --- Step 1: choose a file ---
  const fileInput = el('input', {
    type: 'file',
    accept: 'video/mp4,video/webm,video/quicktime,video/*',
    style: { display: 'none' },
  });

  const dropZone = el('button', {
      class: 'card',
      style: {
        width: '100%', padding: '46px 20px', textAlign: 'center',
        border: '2px dashed var(--border)', cursor: 'pointer',
      },
      onclick: () => fileInput.click(),
    },
    el('div', { style: { fontSize: '40px', marginBottom: '10px' } }, '🎬'),
    el('div', { style: { fontWeight: '700', fontSize: '16px' } }, 'Choose a video'),
    el('div', { style: { color: 'var(--text-muted)', fontSize: '13.5px', marginTop: '5px' } },
      'MP4, WebM or MOV · up to 512MB'),
  );

  // --- Progress panel ---
  const progressBar = el('i', { style: { width: '0%' } });
  const statusLine = el('div', { style: { fontWeight: '600', fontSize: '15px' } }, 'Preparing…');
  const statusDetail = el('div', {
    style: { color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' },
  });

  const progressPanel = el('div', { class: 'card', style: { display: 'none' } },
    statusLine,
    statusDetail,
    el('div', { class: 'progress', style: { marginTop: '12px' } }, progressBar),
  );

  // --- Step 2: details form ---
  const titleInput = el('input', { class: 'input', placeholder: 'Add a title', maxlength: '120' });
  const descInput = el('textarea', { class: 'textarea', placeholder: 'Say something about it (optional)', maxlength: '5000' });
  const categorySelect = el('select', { class: 'select' });
  const visibilitySelect = el('select', { class: 'select' },
    el('option', { value: 'public' }, 'Public — anyone can find and watch'),
    el('option', { value: 'unlisted' }, 'Unlisted — only people with the link'),
    el('option', { value: 'private' }, 'Private — only you'),
  );

  const publishButton = el('button', { class: 'btn btn--primary btn--block', disabled: true },
    'Waiting for processing…');

  const detailsPanel = el('div', { style: { display: 'none' } },
    el('div', { class: 'field' }, el('label', {}, 'Title'), titleInput),
    el('div', { class: 'field' }, el('label', {}, 'Description'), descInput),
    el('div', { class: 'field' }, el('label', {}, 'Category'), categorySelect),
    el('div', { class: 'field' },
      el('label', {}, 'Who can see this'),
      visibilitySelect,
      el('div', { class: 'hint' }, 'You can change this at any time from your Studio.'),
    ),
    publishButton,
  );

  // Populate categories from the API so the list never drifts from the backend.
  api.system().then((system) => {
    for (const category of system.categories) {
      categorySelect.append(el('option', { value: category },
        category.charAt(0).toUpperCase() + category.slice(1)));
    }
  }).catch(() => {});

  // --- File chosen ---
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (file.size > 512 * 1024 * 1024) {
      return toast('That file is larger than 512MB.', 'error');
    }

    dropZone.style.display = 'none';
    progressPanel.style.display = 'block';
    statusLine.textContent = 'Starting upload…';

    try {
      // Create the draft FIRST, so the upload is recoverable from here on.
      const draft = await api.createUpload({
        title: file.name.replace(/\.[^.]+$/, '').slice(0, 120),
        kind: 'short',
      });
      videoId = draft.videoId;
      titleInput.value = file.name.replace(/\.[^.]+$/, '').slice(0, 120);

      await uploadWithProgress(videoId, file, (percent) => {
        progressBar.style.width = `${percent * 0.4}%`;   // upload is the first 40%
        statusLine.textContent = 'Uploading…';
        statusDetail.textContent = `${Math.round(percent)}%`;
      });

      detailsPanel.style.display = 'block';
      pollStatus();
    } catch (error) {
      statusLine.textContent = 'Upload failed';
      statusDetail.textContent = error.message;
      progressBar.style.background = 'var(--danger)';

      // Recovery, always offered. (spec §73)
      progressPanel.append(el('button', {
        class: 'btn btn--block',
        style: { marginTop: '12px' },
        onclick: () => location.reload(),
      }, 'Try again'));
    }
  });

  /** Poll the pipeline and mirror the backend's own status message. */
  function pollStatus() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const status = await api.uploadStatus(videoId);
        statusLine.textContent = status.message;
        statusDetail.textContent = '';
        progressBar.style.width = `${status.progress}%`;

        if (status.status === 'ready') {
          clearInterval(pollTimer);
          progressBar.style.background = 'var(--success)';
          publishButton.disabled = false;
          publishButton.textContent = 'Publish';
          if (status.copyrightStatus === 'pending') {
            statusDetail.textContent =
              'Copyright check is still pending — that does not block publishing.';
          }
        } else if (status.status === 'failed') {
          clearInterval(pollTimer);
          progressBar.style.background = 'var(--danger)';
          statusDetail.textContent = status.error || '';
        }
      } catch {
        // Transient failure; the next tick retries.
      }
    }, 1200);
  }

  publishButton.addEventListener('click', async () => {
    publishButton.disabled = true;
    publishButton.textContent = 'Publishing…';
    try {
      await api.updateVideo(videoId, {
        title: titleInput.value.trim() || 'Untitled',
        description: descInput.value.trim(),
        category: categorySelect.value,
        visibility: visibilitySelect.value,
      });
      clearInterval(pollTimer);
      toast('Published', 'success');
      location.hash = '#/studio';
    } catch (error) {
      toast(error.message, 'error');
      publishButton.disabled = false;
      publishButton.textContent = 'Publish';
    }
  });

  render(container,
    el('div', { class: 'topbar' }, el('h1', {}, 'New video')),
    el('div', { class: 'container' },
      fileInput,
      dropZone,
      progressPanel,
      detailsPanel,
    ),
  );
}

/**
 * Upload with real progress.
 *
 * XMLHttpRequest rather than fetch, because fetch still has no upload progress
 * event — and on a phone connection, an upload with no visible progress feels
 * broken. (spec §72)
 */
function uploadWithProgress(videoId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1/uploads/${videoId}/file`);
    xhr.setRequestHeader('Authorization', `Bearer ${auth.token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    });

    xhr.addEventListener('load', () => {
      let payload = null;
      try { payload = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload?.data);
      else reject(new Error(payload?.error?.message || `Upload failed (${xhr.status})`));
    });

    xhr.addEventListener('error', () =>
      reject(new Error('The connection dropped during upload. Your draft was saved.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled.')));

    xhr.send(file);
  });
}
