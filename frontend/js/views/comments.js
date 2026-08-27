/**
 * COMMENTS SHEET.
 *
 * Opens over the feed so the video keeps playing behind it — leaving the video
 * is a much bigger interruption than it looks.
 */

import { api, auth } from '../api.js';
import { el, render, count, avatar, timeAgo, sheet, toast, emptyState, loading } from '../ui.js';

export function openComments(video) {
  const body = el('div', {}, loading('Loading comments…'));
  let replyingTo = null;

  const input = el('input', {
    class: 'input',
    placeholder: 'Add a comment…',
    'aria-label': 'Add a comment',
    maxlength: '2000',
  });

  const replyBanner = el('div', {
    class: 'badge badge--info',
    style: { display: 'none', marginBottom: '8px' },
  });

  const submit = el('button', { class: 'btn btn--primary' }, 'Post');

  const post = async () => {
    const text = input.value.trim();
    if (!text) return;

    if (!auth.signedIn) {
      location.hash = '#/signin';
      return toast('Sign in to comment');
    }

    submit.disabled = true;
    submit.textContent = '…';
    try {
      await api.comment(video.id, { body: text, parentId: replyingTo?.id });
      input.value = '';
      replyingTo = null;
      replyBanner.style.display = 'none';
      await load();
      toast('Comment posted', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Post';
    }
  };

  submit.addEventListener('click', post);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); post(); }
  });

  const startReply = (comment) => {
    replyingTo = comment;
    replyBanner.textContent = `Replying to @${comment.author.username} ✕`;
    replyBanner.style.display = 'inline-flex';
    replyBanner.onclick = () => {
      replyingTo = null;
      replyBanner.style.display = 'none';
    };
    input.focus();
  };

  async function load() {
    try {
      const data = await api.comments(video.id);
      if (!data.comments.length) {
        return render(body, emptyState(data.empty, { icon: '💬' }));
      }
      render(body, data.comments.map((c) => commentNode(c, { onReply: startReply, onChange: load })));
    } catch (error) {
      render(body, el('p', { style: { color: 'var(--danger)' } }, error.message));
    }
  }

  load();

  sheet({
    title: `${count(video.stats.comments)} comments`,
    body: el('div', {}, body),
    footer: el('div', { style: { width: '100%' } },
      replyBanner,
      el('div', { style: { display: 'flex', gap: '8px' } }, input, submit),
    ),
  });
}

function commentNode(comment, { onReply, onChange }) {
  const likeButton = el('button', {
      style: { color: comment.viewerState?.liked ? 'var(--accent)' : 'inherit' },
      'aria-label': 'Like comment',
      onclick: async (event) => {
        if (!auth.signedIn) { location.hash = '#/signin'; return toast('Sign in to like'); }
        try {
          const result = await api.likeComment(comment.id);
          event.currentTarget.style.color = result.liked ? 'var(--accent)' : 'inherit';
          event.currentTarget.textContent = `♥ ${count(result.likes)}`;
        } catch (error) { toast(error.message, 'error'); }
      },
    }, `♥ ${count(comment.likes)}`);

  const actions = [
    likeButton,
    el('button', { onclick: () => onReply(comment) }, 'Reply'),
  ];

  if (comment.viewerState?.isAuthor) {
    actions.push(el('button', {
      style: { color: 'var(--text-faint)' },
      onclick: async () => {
        if (!confirm('Delete this comment?')) return;
        try {
          await api.deleteComment(comment.id);
          toast('Comment deleted');
          onChange();
        } catch (error) { toast(error.message, 'error'); }
      },
    }, 'Delete'));
  }

  return el('div', {},
    el('div', { class: 'comment' },
      avatar(comment.author.avatarUrl, comment.author.displayName, 'avatar avatar--sm'),
      el('div', { class: 'comment-body' },
        el('div', { class: 'comment-author' },
          `@${comment.author.username}`,
          comment.author.verified ? ' ✔' : '',
          ` · ${timeAgo(comment.createdAt)}`,
          comment.editedAt ? ' · edited' : ''),
        el('div', { class: 'comment-text' }, comment.body),
        el('div', { class: 'comment-meta' }, actions),
      ),
    ),
    comment.replies?.length
      ? el('div', { class: 'comment-replies' },
          comment.replies.map((r) => commentNode(r, { onReply, onChange })),
          comment.hasMoreReplies
            ? el('button', {
                class: 'comment-meta',
                style: { marginTop: '4px' },
                onclick: async (event) => {
                  const replies = await api.get(`/comments/${comment.id}/replies`);
                  const container = event.currentTarget.parentElement;
                  event.currentTarget.remove();
                  container.append(...replies.replies
                    .slice(comment.replies.length)
                    .map((r) => commentNode(r, { onReply, onChange })));
                },
              }, `View ${comment.replyCount - comment.replies.length} more replies`)
            : null)
      : null,
  );
}
