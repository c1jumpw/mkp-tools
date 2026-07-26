/**
 * =========================================================================
 * app.js — screen rendering, navigation, form logic, capture + send flow
 * =========================================================================
 * PURPOSE
 *   The entire UI of Dispatch. A tiny hash-based single-page router
 *   (no framework) drives five screens: Home, Entity picker, Type
 *   picker, capture Form, and Settings. Reads ENTITIES/FIELD_SCHEMAS
 *   from config.js to build screens, reads/writes drafts and the
 *   offline queue via storage.js, and sends captures via clickup.js.
 *
 * DATA FLOW
 *   User taps through Home → Entity → Type → Form → Send. On submit,
 *   collectFields() reads the DOM into a plain object, ClickUp.
 *   createTask() posts it through the Worker proxy; on success it's
 *   logged locally via Storage.addRecent(), on failure (including
 *   being offline) it's queued via Storage.enqueue() and retried
 *   automatically on the next 'online' event or app load.
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   Expects config.js, storage.js, and clickup.js to already be loaded
 *   (see index.html script order) — this file uses their globals
 *   (ENTITIES, FIELD_SCHEMAS, Storage, ClickUp, buildClickUpAuthorizeUrl)
 *   directly rather than importing them.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-07-23  Initial implementation: 5-screen router, dynamic
 *                    forms, dictation + voice-note recording, offline
 *                    queue with base64-encoded attachments.
 *   v2  2026-07-23  Settings screen reworked for OAuth: added a
 *                    "Connect to ClickUp" button (navigates to
 *                    buildClickUpAuthorizeUrl()) and handling for the
 *                    Worker's post-approval redirect, which returns as
 *                    #/settings?connected=1 or ?connect_error=...
 *                    Added getQueryParams() since this is a hash-routed
 *                    SPA and query params live after the #. Replaces
 *                    the old flow, which only accepted a manually
 *                    pasted personal API token.
 *   v3  2026-07-24  Three changes:
 *                    (1) Added a passcode lock screen (renderLock/
 *                        attemptUnlock) gating app entry, matching the
 *                        Worker's new APP_PASSCODE enforcement — closes
 *                        the gap where anyone with the app's public URL
 *                        could create ClickUp tasks with no login.
 *                    (2) Settings now runs a live connection check
 *                        (refreshConnectionStatus) every time it opens,
 *                        not only right after the OAuth redirect — the
 *                        old version showed no status at all on a
 *                        normal reload even though the connection was
 *                        genuinely fine.
 *                    (3) The "verify this list ID" flag on capture-type
 *                        chips is now tap-to-explain (shows what's
 *                        uncertain and how to fix it) instead of a bare
 *                        "!" with only a hover tooltip, which doesn't
 *                        work on touch devices anyway.
 *   v4  2026-07-25  Four additions:
 *                    (1) Assignee dropdown on Task-type forms, backed
 *                        by ClickUp.getListMembers() and a per-list
 *                        in-memory cache (loadAssigneeOptions()).
 *                    (2) Client-side attachment size guard
 *                        (MAX_ATTACHMENT_BYTES) — warns before Send
 *                        rather than failing after, since the Worker's
 *                        Cloudflare free-tier plan hard-caps request
 *                        bodies at 100MB regardless of ClickUp's own
 *                        (much higher) 1GB limit.
 *                    (3) "View in ClickUp" link on each Recent item,
 *                        using the URL ClickUp's create-task response
 *                        includes (entry.clickupUrl, set in both
 *                        submitCapture() and processQueue()'s retry
 *                        path). Older entries logged before this
 *                        change simply omit the link.
 *                    (4) Fires ClickUp.logCapture() (best-effort, not
 *                        awaited-to-block) after a successful send, to
 *                        post a short activity message to a configured
 *                        Chat channel — see clickup.js/clickup-proxy.js
 *                        for the rest of that flow.
 *   v5  2026-07-25  Added "make this a subtask of an existing task"
 *                    (Task-type forms only, alongside Assignee):
 *                    renderSubtaskBlock() drives a 3-state UI (idle /
 *                    searching / selected) rendered into its own
 *                    #subtask-block container so opening/closing it
 *                    doesn't disturb the rest of the form. Search is
 *                    client-side substring filtering over a cached
 *                    per-list task fetch (loadParentTaskOptions) rather
 *                    than a live query per keystroke, since ClickUp's
 *                    API has no name-search endpoint — see
 *                    clickup.js's getListTasks() doc comment. Falls
 *                    back to a direct by-ID lookup (getTaskById) when
 *                    nothing local matches and the query looks like a
 *                    task ID, covering lists larger than the cached
 *                    page. Selected parent flows into submitCapture()
 *                    via entry.parentTaskId/parentTaskName.
 * =========================================================================
 */

const App = (() => {
  const root = document.getElementById('app');
  let state = {
    entityId: null,
    typeId: null,
    fields: {},
    attachments: [],   // File objects staged for this capture
    transcript: '',
    recording: null    // { blob, url } if a voice note was recorded
  };

  let mediaRecorder = null;
  let mediaChunks = [];
  let recognizer = null;

  // ---------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------
  function go(hash) {
    window.location.hash = hash;
  }

  /**
   * currentRoute
   * Parses window.location.hash into path segments, e.g.
   * "#/form/mkp/task" -> ['form', 'mkp', 'task'].
   * Query params (e.g. "#/settings?connected=1", used by the OAuth
   * callback redirect in worker/clickup-proxy.js) are stripped from
   * the path here — use getQueryParams() separately to read them.
   * @returns {string[]} non-empty path segments
   */
  function currentRoute() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    const [path] = hash.split('?');
    return path.split('/').filter(Boolean);
  }

  /**
   * getQueryParams
   * Reads the query string portion of the current hash route (if any)
   * as a URLSearchParams object. Needed because this is a hash-routed
   * SPA — the "real" URL query string (before the #) is never used,
   * so params like ?connected=1 live after the hash instead.
   * @returns {URLSearchParams}
   */
  function getQueryParams() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    const [, query] = hash.split('?');
    return new URLSearchParams(query || '');
  }

  function render() {
    const [screen, a, b] = currentRoute();
    stopRecognizer();

    if (!screen || screen === 'home') return renderHome();
    if (screen === 'entity') return renderEntityPicker();
    if (screen === 'type') return renderTypePicker(a);
    if (screen === 'form') return renderForm(a, b);
    if (screen === 'settings') return renderSettings();
    renderHome();
  }

  window.addEventListener('hashchange', render);

  // ---------------------------------------------------------------
  // Screen: Home
  // ---------------------------------------------------------------
  function renderHome() {
    const recent = Storage.getRecent();
    const queue = Storage.getQueue();

    root.innerHTML = `
      <header class="topbar">
        <span class="brand">Dispatch</span>
        <button class="icon-btn" data-nav="settings" aria-label="Settings">${icon('gear')}</button>
      </header>

      <main class="home">
        ${queue.length ? `
          <div class="banner banner--pending">
            <span>${queue.length} capture${queue.length > 1 ? 's' : ''} waiting to send</span>
            <button class="link-btn" id="retry-queue">Retry now</button>
          </div>` : ''}

        <button class="fab-primary" data-nav="entity">
          <span class="fab-plus">+</span>
          <span>New Capture</span>
        </button>

        <section class="recent">
          <h2>Recent</h2>
          ${recent.length ? `<ul class="recent-list">
            ${recent.map(r => `
              <li class="recent-item">
                <span class="tag" style="--tag-color:${r.color}">${r.entityName}</span>
                <span class="recent-title">${escapeHtml(r.title)}</span>
                <span class="recent-type">${r.typeLabel}</span>
                ${r.clickupUrl ? `<a class="recent-link" href="${r.clickupUrl}" target="_blank" rel="noopener">${icon('link')}</a>` : ''}
              </li>`).join('')}
          </ul>` : `<p class="empty">Nothing sent yet. Your first capture will show up here.</p>`}
        </section>
      </main>
    `;

    root.querySelector('[data-nav="settings"]').onclick = () => go('/settings');
    root.querySelector('[data-nav="entity"]').onclick = () => go('/entity');
    const retryBtn = root.querySelector('#retry-queue');
    if (retryBtn) retryBtn.onclick = () => processQueue(true);

    processQueue(false);
  }

  // ---------------------------------------------------------------
  // Screen: Entity picker
  // ---------------------------------------------------------------
  function renderEntityPicker() {
    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">Where's this going?</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <main class="picker">
        <div class="tile-grid">
          ${ENTITIES.map(e => `
            <button class="tile" style="--tile-color:${e.color}" data-entity="${e.id}">
              <span class="tile-name">${e.name}</span>
              <span class="tile-sub">${e.subtitle}</span>
            </button>
          `).join('')}
        </div>
      </main>
    `;
    bindBack();
    root.querySelectorAll('[data-entity]').forEach(btn => {
      btn.onclick = () => go(`/type/${btn.dataset.entity}`);
    });
  }

  // ---------------------------------------------------------------
  // Screen: Capture type picker
  // ---------------------------------------------------------------
  function renderTypePicker(entityId) {
    const entity = ENTITIES.find(e => e.id === entityId);
    if (!entity) return go('/entity');

    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">${entity.name}</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <main class="picker">
        <div class="chip-list">
          ${entity.captureTypes.map(t => `
            <button class="chip" style="--tile-color:${entity.color}" data-type="${t.id}">
              <span class="chip-icon">${icon(t.icon)}</span>
              <span>${t.label}</span>
              ${t.verify ? `<button type="button" class="chip-flag" data-verify-label="${escapeHtml(t.label)}" data-verify-list="${t.listId}" aria-label="This destination needs verifying">!</button>` : ''}
            </button>
          `).join('')}
        </div>
      </main>
    `;
    bindBack();
    root.querySelectorAll('[data-type]').forEach(btn => {
      btn.onclick = () => go(`/form/${entityId}/${btn.dataset.type}`);
    });
    // Tapping the "!" flag explains itself instead of opening the
    // capture form — stopPropagation keeps the tap from also
    // triggering the parent chip's own onclick (click events bubble
    // from this child button up through the chip button it sits in).
    root.querySelectorAll('[data-verify-label]').forEach(flag => {
      flag.onclick = (e) => {
        e.stopPropagation();
        alert(
          `"${flag.dataset.verifyLabel}" points at ClickUp List ${flag.dataset.verifyList}, which came out identical to another list's ID in the original export \u2014 most likely a copy-paste artifact, not confirmed wrong.\n\n` +
          `Sending to it will still work, but worth double-checking: open the real list in ClickUp and look at the URL \u2014 app.clickup.com/<workspace>/v/li/<LIST_ID>. If that ID doesn't match ${flag.dataset.verifyList}, update it in js/config.js.`
        );
      };
    });
  }

  // ---------------------------------------------------------------
  // Screen: Dynamic capture form
  // ---------------------------------------------------------------
  // Module-level cache of list members, keyed by listId, so switching
  // between forms for the same List (or re-opening one) doesn't
  // re-fetch every time. Cleared only on a full page reload — good
  // enough since Workspace membership rarely changes mid-session.
  const listMembersCache = {};

  // Same caching idea as listMembersCache, for the "make this a
  // subtask" search — see loadParentTaskOptions() below. Keyed by
  // listId; holds a Promise so concurrent triggers (e.g. opening the
  // panel twice quickly) share one in-flight fetch rather than firing
  // duplicates.
  const listTasksCache = {};

  // Cloudflare's free-tier Worker plan hard-caps any request body at
  // 100MB (ClickUp itself allows up to 1GB per attachment, but that
  // never matters here — the proxy rejects first). Warn well under
  // that ceiling rather than let someone attach a big file and only
  // discover the failure after tapping Send.
  const MAX_ATTACHMENT_BYTES = 90 * 1024 * 1024; // 90MB, leaving headroom for the rest of the multipart payload

  function renderForm(entityId, typeId) {
    const entity = ENTITIES.find(e => e.id === entityId);
    const type = entity && entity.captureTypes.find(t => t.id === typeId);
    if (!entity || !type) return go('/entity');

    state = { entityId, typeId, fields: {}, attachments: [], transcript: '', recording: null, parentTaskId: null, parentTaskName: null };
    const schema = FIELD_SCHEMAS[type.schema];
    const speechSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    const recordSupported = !!(navigator.mediaDevices && window.MediaRecorder);
    // Assignee only makes sense for Task-type captures — pulling list
    // members is a real network call, so it's scoped narrowly rather
    // than shown (and fetched) on every capture type.
    const showAssignee = type.schema === 'task';

    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">${type.label}</span>
        <span class="tag" style="--tag-color:${entity.color}">${entity.name}</span>
      </header>
      <main class="form">
        <form id="capture-form">
          ${schema.map(f => renderField(f)).join('')}
          ${showAssignee ? `<div id="subtask-block"></div>` : ''}
          ${showAssignee ? `
          <label class="field" for="field-assigneeId">Assignee
            <select id="field-assigneeId" disabled>
              <option value="">Loading team…</option>
            </select>
          </label>` : ''}

          <div class="voice-row">
            ${speechSupported ? `<button type="button" class="pill-btn" id="dictate-btn">${icon('mic')} Dictate</button>` : ''}
            ${recordSupported ? `<button type="button" class="pill-btn" id="record-btn">${icon('record')} Voice note</button>` : ''}
            <label class="pill-btn" for="file-input">${icon('paperclip')} Attach
              <input type="file" id="file-input" multiple hidden>
            </label>
          </div>
          <div id="attachment-list" class="attachment-list"></div>
          <div id="recording-indicator" class="recording-indicator hidden">Recording… <span id="rec-time">0:00</span></div>
        </form>
      </main>
      <div class="form-footer">
        <button class="send-btn" id="send-btn">Send to ClickUp</button>
      </div>
    `;

    bindBack();

    if (showAssignee) {
      loadAssigneeOptions(type.listId);
      renderSubtaskBlock(type.listId);
    }

    const fileInput = root.querySelector('#file-input');
    fileInput.onchange = () => {
      const incoming = Array.from(fileInput.files);
      const tooBig = incoming.filter(f => f.size > MAX_ATTACHMENT_BYTES);
      const ok = incoming.filter(f => f.size <= MAX_ATTACHMENT_BYTES);
      if (tooBig.length) {
        alert(
          `${tooBig.map(f => f.name).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} over the 90MB limit for attachments sent through Dispatch and won\u2019t be included. ` +
          `For larger files, add them directly in ClickUp once the task is created.`
        );
      }
      state.attachments.push(...ok);
      renderAttachmentList();
      fileInput.value = '';
    };

    const dictateBtn = root.querySelector('#dictate-btn');
    if (dictateBtn) dictateBtn.onclick = () => toggleDictate(schema);

    const recordBtn = root.querySelector('#record-btn');
    if (recordBtn) recordBtn.onclick = () => toggleRecording();

    root.querySelector('#send-btn').onclick = (e) => {
      e.preventDefault();
      submitCapture(entity, type, schema);
    };
  }

  function renderField(f) {
    const id = `field-${f.key}`;
    if (f.type === 'textarea') {
      return `<label class="field" for="${id}">${f.label}${f.required ? ' *' : ''}
        <textarea id="${id}" name="${f.key}" rows="4" placeholder="${f.placeholder || ''}"></textarea>
      </label>`;
    }
    if (f.type === 'select') {
      return `<label class="field" for="${id}">${f.label}
        <select id="${id}" name="${f.key}">
          <option value="">—</option>
          ${f.options.map(o => `<option value="${o}">${o}</option>`).join('')}
        </select>
      </label>`;
    }
    if (f.type === 'priority') {
      return `<label class="field" for="${id}">${f.label}
        <select id="${id}" name="${f.key}">
          <option value="">—</option>
          <option value="Urgent">Urgent</option>
          <option value="High">High</option>
          <option value="Normal">Normal</option>
          <option value="Low">Low</option>
        </select>
      </label>`;
    }
    if (f.type === 'date') {
      return `<label class="field" for="${id}">${f.label}
        <input type="date" id="${id}" name="${f.key}">
      </label>`;
    }
    return `<label class="field" for="${id}">${f.label}${f.required ? ' *' : ''}
      <input type="text" id="${id}" name="${f.key}" placeholder="${f.placeholder || ''}" autocomplete="off">
    </label>`;
  }

  /**
   * loadAssigneeOptions
   * Fills the Assignee <select> on Task-type forms with the members
   * who actually have access to the destination list, fetched via
   * ClickUp.getListMembers(). Uses listMembersCache so switching
   * capture types for the same list doesn't refetch. Fails quietly
   * (dropdown just shows "Unavailable") rather than blocking the rest
   * of the form — assignee is optional, a fetch failure here shouldn't
   * stop someone from capturing and sending the task itself.
   * @param {string} listId
   */
  async function loadAssigneeOptions(listId) {
    const select = root.querySelector('#field-assigneeId');
    if (!select) return;
    try {
      if (!listMembersCache[listId]) {
        listMembersCache[listId] = ClickUp.getListMembers(listId);
      }
      const members = await listMembersCache[listId];
      // Guard against the user having already navigated away from
      // this form (e.g. tapped back) before the fetch resolved.
      if (!root.contains(select)) return;
      select.innerHTML = `<option value="">Unassigned</option>` +
        members.map(m => `<option value="${m.id}">${escapeHtml(m.username || m.email || 'Member')}</option>`).join('');
      select.disabled = false;
    } catch (err) {
      delete listMembersCache[listId]; // don't cache a failure — allow retry next time the form opens
      if (root.contains(select)) {
        select.innerHTML = `<option value="">Unavailable — you can still send without an assignee</option>`;
      }
    }
  }

  // -----------------------------------------------------------------
  // "Make this a subtask of an existing task"
  // -----------------------------------------------------------------
  // Three-state UI, re-rendered into the #subtask-block container
  // (not the whole form) whenever state changes, to avoid disturbing
  // whatever else the user has already typed elsewhere on the form:
  //   'idle'      — just a "Make this a subtask" toggle button
  //   'searching' — a search box + live-filtered results list
  //   'selected'  — a summary chip naming the chosen parent, + remove
  // The mode itself isn't stored in `state` (it's pure UI, discarded
  // on re-render) — only the actual selection (state.parentTaskId /
  // state.parentTaskName) persists, since that's what submitCapture()
  // needs.

  /**
   * renderSubtaskBlock
   * (Re)renders the #subtask-block container based on current
   * selection state and the given UI mode.
   * @param {string} listId - destination list, scopes the search
   * @param {'idle'|'searching'|'selected'} [mode] - defaults to
   *   'selected' if a parent is already chosen, else 'idle'
   */
  function renderSubtaskBlock(listId, mode) {
    const container = root.querySelector('#subtask-block');
    if (!container) return;
    const effectiveMode = mode || (state.parentTaskId ? 'selected' : 'idle');

    if (effectiveMode === 'idle') {
      container.innerHTML = `<button type="button" class="pill-btn" id="subtask-toggle">${icon('nest')} Make this a subtask</button>`;
      container.querySelector('#subtask-toggle').onclick = () => renderSubtaskBlock(listId, 'searching');
      return;
    }

    if (effectiveMode === 'selected') {
      container.innerHTML = `
        <div class="subtask-chip">
          <span>${icon('nest')} Subtask of: <strong>${escapeHtml(state.parentTaskName)}</strong></span>
          <button type="button" id="subtask-remove">Remove</button>
        </div>`;
      container.querySelector('#subtask-remove').onclick = () => {
        state.parentTaskId = null;
        state.parentTaskName = null;
        renderSubtaskBlock(listId, 'idle');
      };
      return;
    }

    // 'searching'
    container.innerHTML = `
      <div class="subtask-panel">
        <input type="text" id="subtask-search" class="subtask-search" placeholder="Search tasks in this list by name or ID…" autocomplete="off">
        <div id="subtask-results" class="subtask-results">
          <p class="hint">Type at least 2 characters to search.</p>
        </div>
        <button type="button" class="link-btn" id="subtask-cancel">Cancel</button>
      </div>`;

    const searchInput = container.querySelector('#subtask-search');
    const resultsEl = container.querySelector('#subtask-results');
    searchInput.focus();

    container.querySelector('#subtask-cancel').onclick = () => renderSubtaskBlock(listId, 'idle');

    searchInput.oninput = () => filterAndRenderSubtaskResults(listId, searchInput.value.trim(), resultsEl);

    // Kick off the (cached) fetch immediately on opening the panel,
    // so results appear the instant 2+ characters are typed rather
    // than waiting on a fetch that starts only once the user types.
    loadParentTaskOptions(listId).catch(() => {
      resultsEl.innerHTML = `<p class="hint hint--bad">Couldn\u2019t load tasks for this list. You can still send without a parent.</p>`;
    });
  }

  /**
   * loadParentTaskOptions
   * Ensures listTasksCache[listId] is populated (fetching once via
   * ClickUp.getListTasks if not already cached/in-flight).
   * @param {string} listId
   * @returns {Promise<object[]>}
   */
  function loadParentTaskOptions(listId) {
    if (!listTasksCache[listId]) {
      listTasksCache[listId] = ClickUp.getListTasks(listId).catch(err => {
        delete listTasksCache[listId]; // don't cache a failure — allow retry next open
        throw err;
      });
    }
    return listTasksCache[listId];
  }

  /**
   * filterAndRenderSubtaskResults
   * Filters the cached task list by substring match (case-insensitive)
   * against name/id/custom_id, renders up to 8 matches as clickable
   * results. Falls back to a direct-by-ID lookup button when nothing
   * local matches and the query looks like it could be a task ID —
   * covers lists with more tasks than the single cached page holds
   * (see getListTasks()'s doc comment).
   * @param {string} listId
   * @param {string} query
   * @param {HTMLElement} resultsEl
   */
  async function filterAndRenderSubtaskResults(listId, query, resultsEl) {
    if (query.length < 2) {
      resultsEl.innerHTML = `<p class="hint">Type at least 2 characters to search.</p>`;
      return;
    }
    let tasks;
    try {
      tasks = await loadParentTaskOptions(listId);
    } catch (err) {
      resultsEl.innerHTML = `<p class="hint hint--bad">Couldn\u2019t load tasks for this list.</p>`;
      return;
    }

    const q = query.toLowerCase();
    const matches = tasks.filter(t =>
      (t.name && t.name.toLowerCase().includes(q)) ||
      (t.id && t.id.toLowerCase().includes(q)) ||
      (t.custom_id && t.custom_id.toLowerCase().includes(q))
    ).slice(0, 8);

    let html = matches.map(t => `
      <button type="button" class="subtask-result" data-task-id="${t.id}" data-task-name="${escapeHtml(t.name)}">
        <span class="subtask-result-name">${escapeHtml(t.name)}</span>
        <span class="subtask-result-meta">${escapeHtml(t.status && t.status.status || '')}</span>
      </button>
    `).join('');

    // Looks plausibly like a ClickUp task ID (short alphanumeric, no
    // spaces) and nothing local matched — offer to look it up directly
    // rather than silently coming up empty.
    const looksLikeId = /^[a-z0-9]{6,10}$/i.test(query);
    if (!matches.length && looksLikeId) {
      html += `<button type="button" class="subtask-result subtask-result--lookup" id="subtask-direct-lookup">Look up task "${escapeHtml(query)}" directly</button>`;
    }

    resultsEl.innerHTML = html || `<p class="hint">No matching tasks found in this list.</p>`;

    resultsEl.querySelectorAll('.subtask-result[data-task-id]').forEach(btn => {
      btn.onclick = () => selectParentTask(listId, btn.dataset.taskId, btn.dataset.taskName);
    });

    const lookupBtn = resultsEl.querySelector('#subtask-direct-lookup');
    if (lookupBtn) {
      lookupBtn.onclick = async () => {
        lookupBtn.disabled = true;
        lookupBtn.textContent = 'Looking up…';
        try {
          const task = await ClickUp.getTaskById(query);
          if (task && !task.parent) {
            selectParentTask(listId, task.id, task.name);
          } else if (task && task.parent) {
            resultsEl.innerHTML = `<p class="hint hint--bad">That task is itself a subtask, so it can\u2019t be used as a parent.</p>`;
          } else {
            resultsEl.innerHTML = `<p class="hint hint--bad">No task found with that ID.</p>`;
          }
        } catch (err) {
          resultsEl.innerHTML = `<p class="hint hint--bad">Lookup failed \u2014 double-check the ID.</p>`;
        }
      };
    }
  }

  /**
   * selectParentTask
   * Records the chosen parent on `state` and switches the subtask
   * block into its 'selected' summary view.
   */
  function selectParentTask(listId, taskId, taskName) {
    state.parentTaskId = taskId;
    state.parentTaskName = taskName;
    renderSubtaskBlock(listId, 'selected');
  }

  function renderAttachmentList() {
    const list = root.querySelector('#attachment-list');
    if (!list) return;
    list.innerHTML = state.attachments.map((f, i) => `
      <span class="attachment-pill">${escapeHtml(f.name)} <button type="button" data-remove="${i}">×</button></span>
    `).join('');
    list.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = () => {
        state.attachments.splice(Number(btn.dataset.remove), 1);
        renderAttachmentList();
      };
    });
  }

  // ---------------------------------------------------------------
  // Voice: dictation (speech-to-text into the primary text field)
  // ---------------------------------------------------------------
  function toggleDictate(schema) {
    const btn = root.querySelector('#dictate-btn');
    if (recognizer) { stopRecognizer(); btn.classList.remove('active'); return; }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = 'en-US';

    const targetField = schema.find(f => f.primary) || schema.find(f => f.type === 'textarea') || schema[0];
    const el = root.querySelector(`#field-${targetField.key}`);
    const baseText = el.value ? el.value + ' ' : '';

    recognizer.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      el.value = baseText + transcript;
    };
    recognizer.onend = () => { btn.classList.remove('active'); recognizer = null; };
    recognizer.start();
    btn.classList.add('active');
  }

  function stopRecognizer() {
    if (recognizer) { try { recognizer.stop(); } catch (e) {} recognizer = null; }
  }

  // ---------------------------------------------------------------
  // Voice: audio recording (attached as a file on submit)
  // ---------------------------------------------------------------
  async function toggleRecording() {
    const btn = root.querySelector('#record-btn');
    const indicator = root.querySelector('#recording-indicator');

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      btn.classList.remove('active');
      indicator.classList.add('hidden');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => mediaChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(mediaChunks, { type: 'audio/webm' });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
        state.attachments.push(file);
        renderAttachmentList();
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      btn.classList.add('active');
      indicator.classList.remove('hidden');
      const start = Date.now();
      const timer = setInterval(() => {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') return clearInterval(timer);
        const secs = Math.floor((Date.now() - start) / 1000);
        const label = root.querySelector('#rec-time');
        if (label) label.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      }, 500);
    } catch (err) {
      alert('Couldn\u2019t access the microphone. Check your browser permissions.');
    }
  }

  // ---------------------------------------------------------------
  // Screen: Settings
  // ---------------------------------------------------------------
  /**
   * renderSettings
   * Shows connection status to ClickUp and a "Connect to ClickUp"
   * button that starts the OAuth handshake (see config.js
   * buildClickUpAuthorizeUrl() and worker/clickup-proxy.js
   * handleOAuthCallback()).
   *
   * Status is checked live, every time this screen opens (not only
   * right after the OAuth redirect) — earlier versions only showed a
   * "Connected ✓" banner driven by the ?connected=1 query param from
   * the redirect, so a normal reload or a second device showed no
   * status at all even though the connection was genuinely working
   * server-side. refreshConnectionStatus() now always re-checks.
   *
   * The transient ?connected=1 / ?connect_error=... banners (from the
   * Worker's redirect) are still shown when present, layered above
   * the live-checked line, since they carry information the live
   * check can't (e.g. *why* a connect attempt just failed).
   *
   * The "Proxy Worker URL" field is left editable for advanced use
   * (e.g. pointing at a second/test Worker) even though it's
   * pre-filled from DEFAULT_PROXY_URL — but changing it here does NOT
   * change where ClickUp's OAuth redirect goes (that's fixed to
   * OAUTH_REDIRECT_URI, matching what's registered in ClickUp's app
   * settings), so an edited value only affects normal capture
   * requests, not the connect flow itself.
   */
  function renderSettings() {
    const settings = Storage.getSettings();
    const params = getQueryParams();
    const justConnected = params.get('connected') === '1';
    const connectError = params.get('connect_error');

    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">Settings</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <main class="form">
        <div class="connect-status" id="connect-status">
          ${justConnected ? '<p class="hint hint--good">Just connected to ClickUp ✓</p>' : ''}
          ${connectError ? `<p class="hint hint--bad">Couldn\u2019t connect: ${escapeHtml(connectError)}</p>` : ''}
          <p class="hint" id="live-status">Checking connection…</p>
        </div>

        <button class="pill-btn pill-btn--wide" id="connect-btn">${icon('link')} Connect to ClickUp</button>
        <p class="hint">Opens ClickUp\u2019s own approval screen. Dispatch only ever talks to ClickUp through the Worker proxy \u2014 your access token is stored there, never on this device.</p>

        <button class="pill-btn" id="test-connection">Re-check connection</button>

        <label class="field" for="proxy-url">Proxy Worker URL <span class="field-optional">(advanced)</span>
          <input type="url" id="proxy-url" placeholder="https://your-worker.your-subdomain.workers.dev" value="${settings.proxyUrl || ''}">
        </label>
      </main>
      <div class="form-footer">
        <button class="send-btn" id="save-settings">Save</button>
      </div>
    `;
    bindBack();

    root.querySelector('#connect-btn').onclick = () => {
      // Full-page navigation (not fetch) — ClickUp needs to show its
      // own UI and set its own cookies, so this can't happen inside
      // an iframe/XHR. The browser leaves the app here and comes back
      // via the Worker's redirect once the user approves or declines.
      window.location.href = buildClickUpAuthorizeUrl();
    };

    root.querySelector('#save-settings').onclick = () => {
      Storage.saveSettings({ proxyUrl: root.querySelector('#proxy-url').value.trim() });
      go('/home');
    };

    root.querySelector('#test-connection').onclick = () => {
      Storage.saveSettings({ proxyUrl: root.querySelector('#proxy-url').value.trim() });
      refreshConnectionStatus();
    };

    // Always re-check on open — see the function doc comment above
    // for why this replaced the old "only after redirect" behavior.
    refreshConnectionStatus();
  }

  /**
   * refreshConnectionStatus
   * Pings the Worker's /user endpoint and updates the #live-status
   * line in Settings with a plain-language, current read of where
   * things stand. Distinguishes failure kinds via the thrown error's
   * `.status` (see clickup.js testConnection()) so the message is
   * actually actionable rather than a generic "could not connect".
   */
  async function refreshConnectionStatus() {
    const el = root.querySelector('#live-status');
    if (!el) return;
    el.textContent = 'Checking connection…';
    el.className = 'hint';
    try {
      const user = await ClickUp.testConnection();
      el.textContent = `Connected as ${user.user ? user.user.username : 'ClickUp user'} ✓`;
      el.className = 'hint hint--good';
    } catch (err) {
      if (err.status === 401) {
        el.textContent = 'Not connected to ClickUp yet \u2014 tap \u201cConnect to ClickUp\u201d above.';
      } else if (err.status === 403) {
        el.textContent = 'This device\u2019s passcode was rejected. Reload the app to re-enter it.';
      } else {
        el.textContent = 'Couldn\u2019t reach the proxy \u2014 check your internet connection.';
      }
      el.className = 'hint hint--bad';
    }
  }

  // ---------------------------------------------------------------
  // Submit flow
  // ---------------------------------------------------------------
  /**
   * collectFields
   * Reads the current form's input values into a plain object, keyed
   * by field key. Also picks up #field-assigneeId if present — that
   * field is rendered outside the schema array (see renderForm), since
   * its options are fetched dynamically rather than fixed per type.
   * @param {object[]} schema - the FIELD_SCHEMAS entry for this capture type
   * @returns {object} fields keyed by f.key (only non-empty values included)
   */
  function collectFields(schema) {
    const fields = {};
    schema.forEach(f => {
      const el = root.querySelector(`#field-${f.key}`);
      if (el && el.value) fields[f.key] = el.value;
    });
    const assigneeEl = root.querySelector('#field-assigneeId');
    if (assigneeEl && assigneeEl.value) fields.assigneeId = assigneeEl.value;
    return fields;
  }

  async function submitCapture(entity, type, schema) {
    stopRecognizer();
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();

    const fields = collectFields(schema);
    const requiredMissing = schema.find(f => f.required && !fields[f.key]);
    if (requiredMissing) {
      alert(`${requiredMissing.label} is required.`);
      return;
    }

    const sendBtn = root.querySelector('#send-btn');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entityId: entity.id,
      entityName: entity.name,
      color: entity.color,
      typeId: type.id,
      typeLabel: type.label,
      listId: type.listId,
      fields,
      title: fields.title || fields.name || '(untitled)',
      createdAt: Date.now(),
      // Set via the "Make this a subtask" flow (renderSubtaskBlock /
      // selectParentTask) — null for a normal top-level task.
      parentTaskId: state.parentTaskId || null,
      parentTaskName: state.parentTaskName || null
    };

    try {
      if (!navigator.onLine) throw new Error('OFFLINE');
      const result = await ClickUp.createTask(type.listId, entry);
      // ClickUp's create-task response includes a direct URL to the
      // task — stashed on the entry so Home's Recent list can offer
      // "View in ClickUp" without reconstructing or guessing the URL.
      entry.clickupUrl = result.url || (result.id ? `https://app.clickup.com/t/${result.id}` : null);
      if (state.attachments.length && result.id) {
        for (const file of state.attachments) {
          await ClickUp.uploadAttachment(result.id, file).catch(() => {});
        }
      }
      // Best-effort activity log to Chat — never lets a logging hiccup
      // undo or block a capture that already succeeded (same pattern
      // as attachment uploads above). See clickup.js logCapture().
      if (entry.clickupUrl) {
        ClickUp.logCapture(entry, entry.clickupUrl).catch(() => {});
      }
      Storage.addRecent(entry);
      showSuccess();
    } catch (err) {
      await queueForRetry(entry);
      showSuccess(true);
    }
  }

  async function queueForRetry(entry) {
    const attachments = await Promise.all(state.attachments.map(fileToDataUrl));
    entry.pendingAttachments = attachments;
    Storage.enqueue(entry);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
      reader.readAsDataURL(file);
    });
  }

  function dataUrlToFile({ name, type, dataUrl }) {
    const [, base64] = dataUrl.split(',');
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new File([arr], name, { type });
  }

  async function processQueue(manual) {
    const settings = Storage.getSettings();
    if (!settings.proxyUrl || !navigator.onLine) return;
    const queue = Storage.getQueue();
    if (!queue.length) return;

    for (const entry of queue) {
      try {
        const result = await ClickUp.createTask(entry.listId, entry);
        entry.clickupUrl = result.url || (result.id ? `https://app.clickup.com/t/${result.id}` : null);
        if (entry.pendingAttachments && result.id) {
          for (const a of entry.pendingAttachments) {
            await ClickUp.uploadAttachment(result.id, dataUrlToFile(a)).catch(() => {});
          }
        }
        if (entry.clickupUrl) {
          ClickUp.logCapture(entry, entry.clickupUrl).catch(() => {});
        }
        Storage.removeFromQueue(entry.id);
        Storage.addRecent(entry);
      } catch (e) {
        if (manual) alert('Still can\u2019t reach ClickUp. Will keep retrying automatically.');
        break;
      }
    }
    if (window.location.hash.includes('home') || !window.location.hash) renderHome();
  }

  function showSuccess(queued) {
    root.innerHTML = `
      <main class="success">
        <div class="success-mark">${icon(queued ? 'clock' : 'check-big')}</div>
        <p class="success-text">${queued ? 'Saved. It\u2019ll send once you\u2019re back online.' : 'Sent to ClickUp.'}</p>
      </main>
    `;
    setTimeout(() => go('/home'), 1100);
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  function bindBack() {
    const btn = root.querySelector('[data-nav="back"]');
    if (btn) btn.onclick = () => history.length > 1 ? history.back() : go('/home');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const ICONS = {
    gear: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
    back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    'check-big': '<circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0012 2z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    dollar: '<path d="M12 2v20M17 6.5C17 4.6 14.8 3 12 3S7 4.6 7 6.5 9.2 9.5 12 9.5s5 1.4 5 4-2.2 4.5-5 4.5-5-1.4-5-4"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
    building: '<rect x="4" y="3" width="16" height="18"/><path d="M9 21v-4h6v4M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/>',
    note: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0014 0"/><path d="M12 19v3"/>',
    record: '<circle cx="12" cy="12" r="8"/>',
    paperclip: '<path d="M21.4 11.6l-9 9a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8.5-8.5"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    link: '<path d="M10 13a5 5 0 007.07 0l1.5-1.5a5 5 0 00-7.07-7.07L10 6"/><path d="M14 11a5 5 0 00-7.07 0l-1.5 1.5a5 5 0 007.07 7.07L14 18"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    nest: '<path d="M7 3v10a4 4 0 004 4h6"/><path d="M13 13l4 4-4 4"/>'
  };
  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  }

  /**
   * init — app entry point (called on DOMContentLoaded).
   * Gates entry behind the device passcode: if this device hasn't
   * stored (and had verified) a passcode yet, shows the lock screen
   * instead of the normal router. See renderLock()/attemptUnlock().
   * This is a convenience gate, not the real security boundary — the
   * Worker re-checks the passcode on every single request regardless
   * (clickup-proxy.js checkPasscode()), so even a bypass of this
   * client-side check can't actually reach ClickUp.
   */
  function init() {
    if (!Storage.getDeviceKey()) {
      renderLock();
    } else {
      render();
    }
    window.addEventListener('online', () => processQueue(false));
  }

  /**
   * renderLock
   * Shows a simple passcode entry screen, blocking access to the rest
   * of the app until attemptUnlock() confirms it against the Worker.
   * @param {string} [errorMsg] - shown above the input, e.g. after a
   *   wrong attempt ("Wrong passcode — try again.")
   */
  function renderLock(errorMsg) {
    root.innerHTML = `
      <main class="lock">
        <div class="lock-mark">${icon('lock')}</div>
        <h1 class="lock-title">Dispatch</h1>
        <p class="lock-sub">Enter the passcode to continue.</p>
        <input type="password" inputmode="numeric" autocomplete="off" id="lock-input" class="lock-input" placeholder="Passcode">
        ${errorMsg ? `<p class="lock-error">${escapeHtml(errorMsg)}</p>` : ''}
        <button class="send-btn" id="lock-submit">Unlock</button>
      </main>
    `;
    const input = root.querySelector('#lock-input');
    input.focus();
    const submit = () => attemptUnlock(input.value);
    root.querySelector('#lock-submit').onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  /**
   * attemptUnlock
   * Verifies a candidate passcode against the Worker before letting
   * the device in permanently. Saves it to Storage optimistically
   * (so the very next request carries it), then rolls back on a
   * confirmed-wrong (403) response.
   * @param {string} candidate - passcode text from the lock screen input
   * Edge cases:
   *   - 403 (Worker confirms it's wrong) → clear it, show error, retry.
   *   - 401 ("passcode fine, ClickUp not connected yet") → let them
   *     in; that's a separate, later step (Settings → Connect).
   *   - any other failure (Worker unreachable, offline) → let them in
   *     rather than block on a check we can't complete; this isn't a
   *     real security gap since the Worker re-validates every future
   *     request independently regardless of what this screen decided.
   */
  async function attemptUnlock(candidate) {
    if (!candidate) return;
    const submitBtn = root.querySelector('#lock-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Checking…';
    Storage.saveDeviceKey(candidate);
    try {
      await ClickUp.testConnection();
      render();
    } catch (err) {
      if (err.status === 403) {
        Storage.clearDeviceKey();
        renderLock('Wrong passcode — try again.');
      } else {
        render();
      }
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
