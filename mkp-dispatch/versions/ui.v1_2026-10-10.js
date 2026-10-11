/**
 * =========================================================================
 * ui.js — shared UI primitives: toasts, bottom sheets, friendly errors
 * =========================================================================
 * PURPOSE
 *   Replaces the app's old window.alert() pop-ups (blocking, unstyled,
 *   and they showed raw ClickUp JSON) with:
 *     - toast()          short, non-blocking status line at the bottom of
 *                        the screen, optionally with one action ("Undo")
 *     - sheet()          a bottom sheet for choices that need an answer
 *                        ("Looks like an existing task — update it?")
 *     - describeError()  turns any error from clickup.js / routing.js into
 *                        a plain-language message + optional details
 *     - showFormError()  renders that message inline above the Send
 *                        button, with the raw details tucked behind a tap
 *
 * DATA FLOW
 *   app.js calls these; nothing here talks to the network.
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   - index.html provides <div id="toast-root" aria-live="polite">
 *     OUTSIDE #app, so screen re-renders (which replace #app's
 *     innerHTML) never wipe a toast that's mid-display.
 *   - Errors follow clickup.js request()'s shape: status / code /
 *     serverMessage / network / timeout / outcome / offline.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-10-10  Created as part of the UX/error cleanup that shipped
 *                    with smart routing.
 * =========================================================================
 */

const UI = (() => {
  /** escape — HTML-escapes text for safe interpolation. */
  function escape(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // dismiss() of the toast on screen, when it's screen-scoped (see the
  // `scoped` option below); null otherwise.
  let dismissCurrentScoped = null;

  /**
   * toast
   * Shows a transient message. Only one toast at a time — a new one
   * replaces the old, which keeps rapid sequences readable.
   * @param {string} message - plain text
   * @param {object} [opts]
   * @param {'info'|'good'|'bad'} [opts.kind='info'] - color accent
   * @param {{label: string, onClick: Function}} [opts.action] - one button
   * @param {number} [opts.duration] - ms; defaults to 4s, or 8s with an
   *   action (enough time to hit "Undo" on a phone)
   * @param {boolean} [opts.scoped=false] - belongs to the current screen
   *   (e.g. "Draft restored — Discard"); dismissScoped() removes it on
   *   navigation so its action can't touch a different screen. Unscoped
   *   toasts ("Filed … — Undo") deliberately survive navigation.
   * @returns {Function} dismiss()
   */
  function toast(message, { kind = 'info', action, duration, scoped = false } = {}) {
    const rootEl = document.getElementById('toast-root');
    if (!rootEl) return () => {};
    rootEl.innerHTML = '';
    dismissCurrentScoped = null;
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-msg">${escape(message)}</span>`;
    let timer = null;
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.add('toast--out');
      setTimeout(() => el.remove(), 200);
    };
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.onclick = () => { dismiss(); action.onClick(); };
      el.appendChild(btn);
    }
    rootEl.appendChild(el);
    timer = setTimeout(dismiss, duration || (action ? 8000 : 4000));
    if (scoped) dismissCurrentScoped = dismiss;
    return dismiss;
  }

  /** dismissScoped — removes the current toast if it was screen-scoped. */
  function dismissScoped() {
    if (dismissCurrentScoped) { dismissCurrentScoped(); dismissCurrentScoped = null; }
  }

  /**
   * sheet
   * Bottom sheet with a title, body and stacked action buttons. Resolves
   * with the chosen action's `value` (or null if dismissed by tapping the
   * backdrop / pressing Escape).
   * @param {object} opts
   * @param {string} opts.title
   * @param {string} [opts.html] - trusted HTML body (callers escape data)
   * @param {Array<{label: string, value: *, kind?: 'primary'|'secondary'|'danger'}>} opts.actions
   * @returns {Promise<*>}
   */
  function sheet({ title, html = '', actions = [] }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'sheet-backdrop';
      backdrop.innerHTML = `
        <div class="sheet" role="dialog" aria-modal="true" aria-label="${escape(title)}">
          <div class="sheet-grip"></div>
          <h2 class="sheet-title">${escape(title)}</h2>
          <div class="sheet-body">${html}</div>
          <div class="sheet-actions">
            ${actions.map((a, i) => `<button type="button" class="sheet-btn sheet-btn--${a.kind || 'secondary'}" data-i="${i}">${escape(a.label)}</button>`).join('')}
          </div>
        </div>`;
      const close = (value) => {
        document.removeEventListener('keydown', onKey);
        backdrop.classList.add('sheet-backdrop--out');
        setTimeout(() => backdrop.remove(), 180);
        resolve(value);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
      backdrop.querySelectorAll('[data-i]').forEach(btn => {
        btn.onclick = () => close(actions[Number(btn.dataset.i)].value);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(backdrop);
      const first = backdrop.querySelector('.sheet-btn');
      if (first) first.focus();
    });
  }

  /**
   * describeError
   * Plain-language explanation for any error thrown by clickup.js or
   * routing.js. Never shows raw JSON as the headline.
   * @param {Error} err
   * @returns {{message: string, detail: string, kind: string}}
   *   kind: 'offline' | 'unknown_outcome' | 'auth' | 'rejected' |
   *   'rate_limited' | 'server' | 'network' — lets callers decide whether
   *   to offer Retry, Settings, or a manual fallback.
   */
  function describeError(err) {
    const e = err || {};
    const detail = [e.serverMessage, e.code, e.message].filter(Boolean).join(' · ');
    if (e.offline) return { message: 'You’re offline.', detail, kind: 'offline' };
    if (e.outcome === 'unknown') return { message: e.timeout ? 'ClickUp is responding slowly — it may or may not have saved this.' : 'The connection dropped before ClickUp confirmed — it may or may not have saved this.', detail, kind: 'unknown_outcome' };
    if (e.network) return { message: 'Couldn’t reach the Dispatch It server. Check your connection and try again.', detail, kind: 'network' };
    const s = e.status;
    if (s === 403) return { message: 'This device’s passcode was rejected. Re-enter it (Settings → Lock this device).', detail, kind: 'auth' };
    if (s === 401) {
      return /^OAUTH/.test(e.code || '')
        ? { message: 'The ClickUp connection expired. Open Settings → Connect to ClickUp.', detail, kind: 'auth' }
        : { message: 'Dispatch It isn’t connected to ClickUp. Open Settings → Connect to ClickUp.', detail, kind: 'auth' };
    }
    if (s === 413) return { message: 'That’s too large to send through Dispatch It.', detail, kind: 'rejected' };
    if (s === 429) return { message: e.serverMessage || 'Too many requests right now — wait a minute and try again.', detail, kind: 'rate_limited' };
    if (s === 404) return { message: 'ClickUp couldn’t find that list or task — it may have been moved or deleted.', detail, kind: 'rejected' };
    if (s === 503 && e.code) return { message: e.serverMessage || 'Smart routing is unavailable right now.', detail, kind: 'server' };
    if (s >= 500) return { message: `ClickUp or the server had a problem (error ${s}). Try again shortly.`, detail, kind: 'server' };
    if (/^FIELD_/.test(e.code || '')) return { message: 'A custom field in that list rejected the value it was given.', detail, kind: 'rejected' };
    if (s >= 400) return { message: e.serverMessage ? String(e.serverMessage).replace(/^ClickUp: /, 'ClickUp says: ') : `ClickUp rejected this (error ${s}).`, detail, kind: 'rejected' };
    return { message: 'Something went wrong.', detail, kind: 'unknown' };
  }

  /**
   * showFormError
   * Renders an error panel inside `container` (usually #form-error):
   * the friendly message, an optional action button, and the raw
   * details behind a "Details" disclosure for debugging.
   * @param {HTMLElement} container
   * @param {Error|string} err - an error, or a plain message
   * @param {{label: string, onClick: Function}} [action]
   */
  function showFormError(container, err, action) {
    if (!container) return;
    const d = typeof err === 'string' ? { message: err, detail: '' } : describeError(err);
    container.innerHTML = `
      <div class="form-error" role="alert">
        <p class="form-error-msg">${escape(d.message)}</p>
        ${action ? `<button type="button" class="link-btn form-error-action">${escape(action.label)}</button>` : ''}
        ${d.detail ? `<details class="form-error-details"><summary>Details</summary><code>${escape(d.detail).slice(0, 1200)}</code></details>` : ''}
      </div>`;
    if (action) container.querySelector('.form-error-action').onclick = action.onClick;
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** clearFormError — empties an error container. */
  function clearFormError(container) {
    if (container) container.innerHTML = '';
  }

  /**
   * markFieldError
   * Highlights one input and shows a message under it (replaces the old
   * "X is required." alert). Clears itself as soon as the user types.
   * @param {HTMLElement} input
   * @param {string} message
   */
  function markFieldError(input, message) {
    if (!input) return;
    const label = input.closest('.field') || input.parentElement;
    input.classList.add('input--error');
    input.setAttribute('aria-invalid', 'true');
    let msg = label.querySelector('.field-error');
    if (!msg) {
      msg = document.createElement('span');
      msg.className = 'field-error';
      label.appendChild(msg);
    }
    msg.textContent = message;
    input.focus();
    const clear = () => {
      input.classList.remove('input--error');
      input.removeAttribute('aria-invalid');
      if (msg) msg.remove();
      input.removeEventListener('input', clear);
      input.removeEventListener('change', clear);
    };
    input.addEventListener('input', clear);
    input.addEventListener('change', clear);
  }

  /**
   * relativeTime — "just now", "5m ago", "3h ago", "Oct 2".
   * @param {number} ts - ms timestamp
   * @returns {string}
   */
  function relativeTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /**
   * vibrate — tiny haptic confirmation where supported (Android); a
   * silent no-op elsewhere (iOS Safari doesn't expose it).
   * @param {number|number[]} pattern
   */
  function vibrate(pattern = 12) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }

  return { escape, toast, dismissScoped, sheet, describeError, showFormError, clearFormError, markFieldError, relativeTime, vibrate };
})();
