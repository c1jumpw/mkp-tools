/**
 * =========================================================================
 * app.js — screen rendering, navigation, form logic, capture + send flow
 * =========================================================================
 * PURPOSE
 *   The entire UI of Dispatch It. A tiny hash-based single-page router
 *   (no framework) drives these screens:
 *     Home · Entity picker · Type picker · capture Form   (manual path)
 *     Smart capture · Review/confirm                       (smart path)
 *     Activity (audit log + undo) · Settings · Lock
 *   Reads ENTITIES/FIELD_SCHEMAS from config.js, persists drafts/queue/
 *   history via storage.js, talks to ClickUp via clickup.js and to the
 *   routing brain via routing.js, and uses ui.js for toasts, sheets and
 *   friendly error messages.
 *
 * DATA FLOW
 *   Manual:  Home → Entity → Type → Form → Send → ClickUp.createTask
 *            (with a quick semantic duplicate check first, when the task
 *            index is built) → Activity record (best-effort).
 *   Smart:   Home → Smart capture (just type/talk) → Routing.suggest →
 *            high confidence & no duplicate → Routing.commit (auto) →
 *            toast with Undo; otherwise → Review screen (confirm / change
 *            list / "add as update" to the duplicate) → Routing.commit.
 *   Offline: manual sends queue (Storage.enqueue) and retry on 'online';
 *            smart capture hands the text to the manual picker instead,
 *            since routing needs the network.
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   Expects config.js, storage.js, clickup.js, ui.js and routing.js to be
 *   loaded first (index.html script order) and uses their globals.
 *   "Add to Accounts" (credentials) never touches the smart-routing code
 *   path, drafts, or the offline queue.
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
 *   v6  2026-07-25  Added a refresh icon to Home's top bar
 *                    (checkForUpdates()) — installed home-screen PWAs
 *                    have no browser chrome to pull-to-refresh from,
 *                    and browsers rarely check for a new service
 *                    worker on their own in standalone mode, so a
 *                    manual way to force the check was needed. See
 *                    sw.js's header comment for the fuller picture.
 *   v7  2026-07-26  Generalized the form/submit architecture beyond
 *                    "always creates a ClickUp task", to support two
 *                    new capture-type actions (config.js `action`
 *                    field, defaults to 'task' for every pre-existing
 *                    entry — fully backward compatible):
 *                    (1) action:'comment' — "Follow-up / Reminder".
 *                        renderForm() now requires (not optional-
 *                        toggles) the task-search UI up front; the
 *                        subtask-search component (v5) was generalized
 *                        to accept multiple listIds (search spans
 *                        every task-schema list in the entity) and an
 *                        excludeSubtasks flag (false here — unlike the
 *                        subtask feature, commenting on an existing
 *                        subtask is fine). Posts via
 *                        ClickUp.addComment(), no task created.
 *                    (2) action:'chat' — "Add to Accounts". Posts a
 *                        formatted message (formatAccountMessage())
 *                        to a specific Chat channel via
 *                        ClickUp.postToChannel(), no task created.
 *                        Carries a password field — added
 *                        sanitizeForRecent() so it's stripped before
 *                        ever reaching the local Recent-captures log
 *                        (still present in the offline queue if
 *                        offline when sent — see queueForRetry()'s
 *                        doc comment for that trade-off).
 *                    Extracted performSend() as the single place that
 *                    branches on action and talks to ClickUp, shared
 *                    by submitCapture() (live) and processQueue()
 *                    (offline retry) so the branching logic exists
 *                    exactly once. Attachments are now passed to it
 *                    explicitly rather than read from the shared
 *                    `state` object, so a background retry can never
 *                    clobber whatever a different form has in progress.
 *                    Also added a `password` field type to renderField
 *                    (masked input) and bell/key icons.
 *   v8  2026-07-28  Added a destination toggle to "Add to Accounts"
 *                    (Chat review channel vs. direct to the one known
 *                    account-directory List — config.js
 *                    directListId). Reuses the existing action:'task'
 *                    path entirely (submitCapture just overrides
 *                    `action`/`listId` for this one submission when
 *                    "Direct to List" is selected) — no new send logic
 *                    needed, since performSend already knows how to
 *                    create a task.
 *   v9  2026-08-07  Three refinements to the Direct-to-List path:
 *                    (1) Real custom fields, not just description
 *                        text. getAccountFieldMapping()/
 *                        loadAccountFieldMapping() look up the MKC
 *                        Client Accounts list's actual ClickUp custom
 *                        field IDs (Admin Username, Admin Email,
 *                        Registered Password, Tool/Software/Act via
 *                        our `title` field) by name-matching, prefetch
 *                        on toggle-click, and resolve into
 *                        entry.customFields before submit. sanitize
 *                        ForRecent() updated to scrub the password out
 *                        of customFields too, not just fields.password
 *                        — it can now live in either place depending
 *                        on which path was used.
 *                    (2) Direct-to-List now ALSO posts a note to the
 *                        accounts review channel (worded "Added
 *                        directly" rather than "New Account, pending
 *                        review") — per user request, so the channel
 *                        stays the single place to see all account
 *                        activity regardless of which path was used.
 *                    (3) "Direct to List" only enables once Account
 *                        Type = MKC Client is selected (auto-reverts
 *                        to Review Channel if changed away after being
 *                        selected) — there's no equivalent List for
 *                        MKC's or MKP's own accounts, confirmed by the
 *                        user; offering it for those would silently
 *                        fail or misfile.
 *   v10 2026-08-08  Added an Associated Client Account autocomplete
 *                    (renderAssociatedAccountBlock, native <datalist>,
 *                    sourced from CRM_COMPANIES_LIST_ID) shown whenever
 *                    Account Type = MKC Client, regardless of
 *                    Review-Channel vs. Direct-to-List. Links the new
 *                    account entry to its client's company record —
 *                    included in both formatAccountMessage() (Chat
 *                    path) and, via getAccountFieldMapping()'s new
 *                    associatedAccount candidate, the real ClickUp
 *                    custom field (Direct path). getAccountFieldMapping
 *                    now returns {id, type} per field instead of a
 *                    bare id, since a Relationship/Tasks-type custom
 *                    field needs a different value shape ({add:[id]})
 *                    than a plain text field — genuinely uncertain
 *                    which this particular field is without having
 *                    seen it, so buildTaskPayload() in clickup.js also
 *                    always writes a plain-text description line
 *                    regardless of whether the structured attempt
 *                    actually took. Also switched the account
 *                    schema's password field from masked to plain
 *                    text per user request (stored in plaintext
 *                    downstream regardless, so masking added friction
 *                    without real protection). Reordered the account
 *                    form: schema fields → Associated Account →
 *                    destination toggle (was toggle-first, before
 *                    Account Type had even been picked).
 *   v11 2026-08-11  Two fixes, one urgent:
 *                    (1) Removed the v10 structured-custom-field
 *                        attempt for associatedAccount entirely. A
 *                        real submission confirmed the guessed value
 *                        format was wrong for the actual field type,
 *                        which caused ClickUp to reject the WHOLE task
 *                        creation — worse than the field simply not
 *                        resolving. The plain-text description line
 *                        (clickup.js buildTaskPayload) is now the sole
 *                        mechanism for this field.
 *                    (2) Fixed silent-failure handling in
 *                        submitCapture()/processQueue(): a real API
 *                        rejection (err.status set, from clickup.js's
 *                        apiError()) is now surfaced as a visible
 *                        error instead of being silently queued
 *                        forever alongside genuine connectivity
 *                        failures — this is exactly what made the
 *                        associatedAccount bug above invisible until
 *                        directly investigated. processQueue() also no
 *                        longer lets one rejected entry block every
 *                        other queued entry behind it.
 *   v12 2026-08-11  The v11 error-surfacing fix immediately did its
 *                    job: a real submission surfaced ClickUp error
 *                    FIELD_011 ("Value must be an option index or
 *                    uuid") — proof "Tool/Software/Act" is a Dropdown/
 *                    Label field, not free text, and its real meaning
 *                    is a category picker (Tool/Software/Activity),
 *                    not literally "the tool's name" as assumed in
 *                    v9. Removed it from getAccountFieldMapping() and
 *                    submitCapture()'s candidates entirely — no data
 *                    lost, since the title still becomes the task's
 *                    own Name field regardless (unrelated code path).
 *   v13 2026-08-12  Re-added associatedAccount to getAccountFieldMapping
 *                    /submitCapture's candidates, now correctly
 *                    targeting the confirmed real field name "Related
 *                    Account ID" (distinct from "Assc. Account", a
 *                    separate column not targeted). This time gated
 *                    behind TEXT_LIKE_FIELD_TYPES — only attempted as
 *                    a structured write when the field's reported
 *                    type is confidently text-like, learned directly
 *                    from the v12 failure (an unrecognized type is now
 *                    treated as unsafe and skipped, falling back to
 *                    the description-line text, rather than assumed
 *                    safe and attempted anyway). Deliberately scoped
 *                    to associatedAccount only — adminUsername/
 *                    adminEmail/password stay ungated since they're
 *                    already confirmed working via a real production
 *                    submission, and gating them too would risk a
 *                    regression if the guessed allowlist type strings
 *                    don't exactly match ClickUp's real ones.
 *   v14 2026-10-10  Smart routing, rename, and a UX/error cleanup pass:
 *                    (1) Renamed to "Dispatch It" (APP_NAME in config.js).
 *                    (2) Smart capture (#/smart): one text box + voice +
 *                        attachments + optional business hint. Gemini picks
 *                        the list, title, dates and priority; confident
 *                        results file themselves (toast with Undo), the
 *                        rest go to a Review screen with the reasoning,
 *                        a "Why 78%?" breakdown, alternatives, an
 *                        any-list picker, and editable title/dates.
 *                    (3) Duplicate handling: the Review screen offers
 *                        "Add as update" when the capture matches an open
 *                        task; manual sends get a quick semantic check
 *                        too (checkManualDuplicate) once the task index
 *                        is built.
 *                    (4) Activity screen (#/activity): every send from
 *                        every device, with confidence, source (auto /
 *                        confirmed / manual) and one-tap Undo.
 *                    (5) Settings: Smart routing section — status, auto-
 *                        file switch + threshold, duplicate sensitivity,
 *                        Sync now, Build task index, live updates
 *                        (ClickUp webhook), accuracy so far. Plus
 *                        "Forget passcode on this device".
 *                    (6) Type picker shows "More lists in this space" from
 *                        the synced workspace index, so lists created in
 *                        ClickUp later are usable without editing
 *                        config.js.
 *                    (7) Cleanups: every alert() replaced by inline errors
 *                        / toasts / sheets with plain-language messages
 *                        (ui.js); drafts auto-save and restore; a send
 *                        that times out is queued as "maybe sent" and
 *                        checked before resending (no more duplicate
 *                        tasks from a slow ClickUp); Add to Accounts is
 *                        never stored in the offline queue (passwords no
 *                        longer sit in localStorage); lock screen no
 *                        longer forces a numeric keypad; the type-picker
 *                        verify flag explains itself in a sheet (it was a
 *                        <button> nested inside a <button>, which is
 *                        invalid HTML); voice notes recorded on iPhone are
 *                        saved with their real type (audio/mp4 → .m4a)
 *                        instead of being mislabeled .webm; dictation uses
 *                        the device language instead of forcing en-US.
 *                    (8) Pre-deploy review fixes: the retry queue keeps
 *                        captures on temporary errors (only 400/404/413/
 *                        422 drop them); queued entries are marked
 *                        "created" before attachments upload; the
 *                        success screen's timer can't yank you Home after
 *                        you've moved on; screen-scoped toasts clear on
 *                        navigation.
 * =========================================================================
 */

const App = (() => {
  const root = document.getElementById('app');
  // Per-screen working state for the manual form AND the smart capture
  // screen (they never coexist). Reset on every renderForm/renderSmart.
  let state = {
    entityId: null,
    typeId: null,
    fields: {},
    attachments: [],   // File objects staged for this capture
    transcript: '',
    recording: null
  };
  // Smart-capture working state: the text, hint, and (after routing)
  // the suggestion plus whatever the owner changed on the Review screen.
  // Null when not in the smart flow.
  let smart = null;
  // Text handed from smart capture to the manual picker when routing
  // isn't possible (offline, Gemini down) or the owner chose "pick it
  // myself". Applied to the next form opened, then cleared.
  let carry = null;

  let mediaRecorder = null;
  let mediaChunks = [];
  let recognizer = null;
  let draftTimer = null;
  // The success screen's "back to Home" timer. Cancelled on any
  // navigation so it can't yank the user away from a screen they moved
  // to in the meantime (found in v14 testing).
  let successTimer = null;

  // ---------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------
  /** go — navigate to a hash route, e.g. go('/settings'). */
  function go(hash) {
    window.location.hash = hash;
  }

  /**
   * currentRoute
   * Parses window.location.hash into path segments, e.g.
   * "#/form/mkp/task" -> ['form', 'mkp', 'task']. Query params (e.g.
   * "#/settings?connected=1" from the OAuth redirect) are stripped —
   * use getQueryParams() for those.
   * @returns {string[]}
   */
  function currentRoute() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    const [path] = hash.split('?');
    return path.split('/').filter(Boolean);
  }

  /**
   * getQueryParams
   * Query string of the current hash route (hash-routed SPA, so params
   * live after the #).
   * @returns {URLSearchParams}
   */
  function getQueryParams() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    const [, query] = hash.split('?');
    return new URLSearchParams(query || '');
  }

  /** render — draws whichever screen the hash points at. */
  function render() {
    const [screen, a, b] = currentRoute();
    stopRecognizer();
    clearTimeout(draftTimer);
    clearTimeout(successTimer);
    UI.dismissScoped();
    if (screen !== 'smart') smart = null;

    if (!screen || screen === 'home') return renderHome();
    if (screen === 'entity') return renderEntityPicker();
    if (screen === 'type') return renderTypePicker(a);
    if (screen === 'form') return renderForm(a, b);
    if (screen === 'smart') return renderSmart();
    if (screen === 'activity') return renderActivity();
    if (screen === 'settings') return renderSettings();
    renderHome();
  }

  window.addEventListener('hashchange', render);

  // ---------------------------------------------------------------
  // Screen: Home
  // ---------------------------------------------------------------
  /**
   * renderHome
   * One big button, a short Recent list, nothing else. When smart
   * routing is available the big button opens Smart capture and a
   * secondary link keeps the manual picker one tap away; otherwise the
   * big button goes straight to the manual picker (pre-v14 behavior).
   */
  function renderHome() {
    const recent = Storage.getRecent();
    const queue = Storage.getQueue();
    const smartOn = Routing.isAvailable();

    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" id="refresh-btn" aria-label="Check for updates">${icon('refresh')}</button>
        <span class="brand">${escapeHtml(APP_NAME)}</span>
        <span class="topbar-actions">
          <button class="icon-btn" data-nav="activity" aria-label="Activity">${icon('history')}</button>
          <button class="icon-btn" data-nav="settings" aria-label="Settings">${icon('gear')}</button>
        </span>
      </header>

      <main class="home">
        ${queue.length ? `
          <div class="banner banner--pending">
            <span>${queue.length} capture${queue.length > 1 ? 's' : ''} waiting to send</span>
            <button class="link-btn" id="retry-queue">Retry now</button>
          </div>` : ''}

        <div class="home-actions">
          <button class="fab-primary" id="new-capture">
            <span class="fab-plus">+</span>
            <span>New Capture</span>
            ${smartOn ? `<span class="fab-sub">${icon('spark')} Auto-routed</span>` : ''}
          </button>
          ${smartOn ? `<button class="link-btn home-manual" id="manual-capture">Choose the destination yourself →</button>` : ''}
        </div>

        <section class="recent">
          <h2>Recent</h2>
          ${recent.length ? `<ul class="recent-list">
            ${recent.map(r => `
              <li class="recent-item${r.undone ? ' recent-item--undone' : ''}">
                <span class="tag" style="--tag-color:${escapeHtml(r.color || '#E8A33D')}">${escapeHtml(r.entityName || '')}</span>
                <span class="recent-title">${escapeHtml(r.title)}</span>
                ${recentBadge(r)}
                ${r.clickupUrl && !r.undone ? `<a class="recent-link" href="${escapeHtml(r.clickupUrl)}" target="_blank" rel="noopener" aria-label="Open in ClickUp">${icon('link')}</a>` : ''}
              </li>`).join('')}
          </ul>` : `<p class="empty">Nothing sent yet. Your first capture will show up here.</p>`}
        </section>
      </main>
    `;

    root.querySelector('[data-nav="settings"]').onclick = () => go('/settings');
    root.querySelector('[data-nav="activity"]').onclick = () => go('/activity');
    root.querySelector('#new-capture').onclick = () => go(smartOn ? '/smart' : '/entity');
    const manualBtn = root.querySelector('#manual-capture');
    if (manualBtn) manualBtn.onclick = () => go('/entity');
    root.querySelector('#refresh-btn').onclick = checkForUpdates;
    const retryBtn = root.querySelector('#retry-queue');
    if (retryBtn) retryBtn.onclick = () => processQueue(true);

    processQueue(false);
    // Keep the smart-routing availability current without blocking the
    // screen; re-render only if availability actually flipped (prevents
    // a render loop).
    Routing.refreshStatusIfStale(() => {
      if (currentRoute()[0] && currentRoute()[0] !== 'home') return;
      if (Routing.isAvailable() !== smartOn) renderHome();
    });
  }

  /**
   * recentBadge
   * Small label on a Recent item: how it was routed, or that it was
   * undone / added as an update.
   * @param {object} r - Recent entry
   * @returns {string} HTML
   */
  function recentBadge(r) {
    if (r.undone) return `<span class="badge badge--muted">Undone</span>`;
    if (r.action === 'update') return `<span class="badge badge--info">Update</span>`;
    if (r.routing && typeof r.routing.confidence === 'number') {
      const pct = Math.round(r.routing.confidence * 100);
      return `<span class="badge ${r.routing.source === 'auto' ? 'badge--auto' : 'badge--info'}">${r.routing.source === 'auto' ? 'Auto' : 'AI'} ${pct}%</span>`;
    }
    return `<span class="recent-type">${escapeHtml(r.typeLabel || '')}</span>`;
  }

  /**
   * checkForUpdates
   * Forces an immediate service-worker update check, then reloads. With
   * sw.js v3 (network-first) a normal reload already fetches fresh files
   * when online; this button remains the explicit "make sure" control
   * for installed home-screen apps, which have no pull-to-refresh.
   */
  async function checkForUpdates() {
    const btn = root.querySelector('#refresh-btn');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      }
    } catch (err) {
      // Swallow — the reload below is the real fallback.
    }
    setTimeout(() => window.location.reload(), 250);
  }

  // ---------------------------------------------------------------
  // Screen: Entity picker
  // ---------------------------------------------------------------
  /**
   * renderEntityPicker
   * Grid of businesses. If text was carried over from Smart capture, a
   * banner says so (it'll be pre-filled into whichever form is picked).
   */
  function renderEntityPicker() {
    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">Where's this going?</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <main class="picker">
        ${carry ? `<div class="banner banner--carry"><span>${icon('note')} Your note comes with you: “${escapeHtml(truncate(carry.text, 60))}”</span><button class="link-btn" id="drop-carry">Clear</button></div>` : ''}
        <div class="tile-grid">
          ${ENTITIES.map(e => `
            <button class="tile" style="--tile-color:${e.color}" data-entity="${e.id}">
              <span class="tile-name">${escapeHtml(e.name)}</span>
              <span class="tile-sub">${escapeHtml(e.subtitle)}</span>
            </button>
          `).join('')}
        </div>
      </main>
    `;
    bindBack();
    const drop = root.querySelector('#drop-carry');
    if (drop) drop.onclick = () => { carry = null; renderEntityPicker(); };
    root.querySelectorAll('[data-entity]').forEach(btn => {
      btn.onclick = () => go(`/type/${btn.dataset.entity}`);
    });
  }

  // ---------------------------------------------------------------
  // Screen: Capture type picker
  // ---------------------------------------------------------------
  /**
   * renderTypePicker
   * The entity's configured capture types, plus (v14) any OTHER lists in
   * the same ClickUp Space found by the workspace sync — tucked in a
   * collapsible "More lists" section so the curated types stay primary.
   * @param {string} entityId
   */
  function renderTypePicker(entityId) {
    const entity = ENTITIES.find(e => e.id === entityId);
    if (!entity) return go('/entity');
    const extra = syncedListsForEntity(entity);

    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">${escapeHtml(entity.name)}</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <main class="picker">
        <div class="chip-list">
          ${entity.captureTypes.map(t => `
            <div class="chip-wrap">
              <button class="chip" style="--tile-color:${entity.color}" data-type="${t.id}">
                <span class="chip-icon">${icon(t.icon)}</span>
                <span>${escapeHtml(t.label)}</span>
              </button>
              ${t.verify ? `<button type="button" class="chip-flag" data-verify-label="${escapeHtml(t.label)}" data-verify-list="${t.listId}" aria-label="This destination needs verifying">!</button>` : ''}
            </div>
          `).join('')}
        </div>
        ${extra.length ? `
          <details class="more-lists">
            <summary>More lists in this space <span class="count">${extra.length}</span></summary>
            <p class="hint">Synced from ClickUp — new lists show up here automatically.</p>
            <div class="chip-list">
              ${extra.map(l => `
                <button class="chip chip--synced" style="--tile-color:${entity.color}" data-type="list-${l.id}">
                  <span class="chip-icon">${icon('list')}</span>
                  <span>${escapeHtml(l.name)}</span>
                </button>`).join('')}
            </div>
          </details>` : ''}
      </main>
    `;
    bindBack();
    root.querySelectorAll('[data-type]').forEach(btn => {
      btn.onclick = () => go(`/form/${entityId}/${btn.dataset.type}`);
    });
    // The "!" flag sits beside (not inside) its chip, so tapping it
    // explains itself instead of opening the form.
    root.querySelectorAll('[data-verify-label]').forEach(flag => {
      flag.onclick = () => UI.sheet({
        title: 'Double-check this destination',
        html: `<p>“${escapeHtml(flag.dataset.verifyLabel)}” points at ClickUp List ${escapeHtml(flag.dataset.verifyList)}, which matched another list’s ID in the original export — most likely a copy-paste artifact, not confirmed wrong.</p>
               <p>Sending still works. To check: open the real list in ClickUp and compare the number after <code>/li/</code> in its URL. If it differs, update it in <code>js/config.js</code>.</p>`,
        actions: [{ label: 'Got it', value: true, kind: 'primary' }]
      });
    });
  }

  /**
   * syncedListsForEntity
   * Lists from the cached workspace catalog that live in the same
   * Space(s) as this entity's configured lists but aren't configured
   * anywhere yet. The Space is inferred from where the entity's known
   * list IDs live, so config.js didn't need Space IDs added.
   * @param {object} entity
   * @returns {Array<{id, name, path, space_id}>} empty if no catalog yet
   */
  function syncedListsForEntity(entity) {
    const catalog = Storage.getCatalog();
    if (!catalog || !Array.isArray(catalog.lists) || !catalog.lists.length) return [];
    const mine = new Set(entity.captureTypes.map(t => t.listId).filter(Boolean));
    const spaceIds = new Set(catalog.lists.filter(l => mine.has(l.id)).map(l => l.space_id));
    const configured = new Set(ENTITIES.flatMap(e => e.captureTypes.map(t => t.listId)).filter(Boolean));
    return catalog.lists
      .filter(l => spaceIds.has(l.space_id) && !configured.has(l.id) && !ROUTING_EXCLUDED_LIST_IDS.includes(l.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * resolveType
   * Finds a capture type by id, including synthesized "list-<id>" types
   * for synced lists (generic Task form pointed at that list).
   * @param {object} entity
   * @param {string} typeId
   * @returns {object|null}
   */
  function resolveType(entity, typeId) {
    const configured = entity.captureTypes.find(t => t.id === typeId);
    if (configured) return configured;
    const m = /^list-(\d+)$/.exec(typeId || '');
    if (!m) return null;
    const catalog = Storage.getCatalog();
    const list = catalog && (catalog.lists || []).find(l => l.id === m[1]);
    if (!list || ROUTING_EXCLUDED_LIST_IDS.includes(list.id)) return null;
    return { id: typeId, label: list.name, icon: 'list', schema: 'task', listId: list.id, synced: true };
  }

  // ---------------------------------------------------------------
  // Screen: Dynamic capture form
  // ---------------------------------------------------------------
  // Per-list caches (cleared on full reload; membership/tasks/fields
  // rarely change mid-session). Each holds a Promise so concurrent
  // triggers share one in-flight fetch.
  const listMembersCache = {};
  const listTasksCache = {};
  const accountFieldMappingCache = {};

  // Cloudflare's free plan caps request bodies at 100MB (ClickUp itself
  // allows 1GB) — warn below that rather than fail after tapping Send.
  const MAX_ATTACHMENT_BYTES = 90 * 1024 * 1024; // 90MB, headroom for the multipart envelope

  // ClickUp custom field `type` strings confidently safe to write a plain
  // string to. Deliberately conservative (see v12/v13): an unrecognized
  // type is treated as unsafe and falls back to the description line.
  const TEXT_LIKE_FIELD_TYPES = new Set(['text', 'short_text', 'email', 'phone', 'url', 'location', 'number']);

  /**
   * renderForm
   * Builds the capture form for one entity + capture type.
   * @param {string} entityId
   * @param {string} typeId - configured type id, or "list-<id>" for a
   *   synced list (see resolveType)
   */
  function renderForm(entityId, typeId) {
    const entity = ENTITIES.find(e => e.id === entityId);
    const type = entity && resolveType(entity, typeId);
    if (!entity || !type) return go('/entity');

    // What this capture type does on submit (defaults to 'task').
    const action = type.action || 'task';

    state = { entityId, typeId, fields: {}, attachments: [], transcript: '', recording: null, parentTaskId: null, parentTaskName: null, parentTaskUrl: null, accountDestination: 'chat', associatedAccountId: null, associatedAccountName: null };
    const schema = FIELD_SCHEMAS[type.schema];
    const isAccount = type.schema === 'account';
    const speechSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    const recordSupported = !!(navigator.mediaDevices && window.MediaRecorder);
    // Assignee and optional subtask-nesting only when this creates a task.
    const showAssignee = action === 'task' && type.schema === 'task';
    // File/voice-note attachments need a task to attach to.
    const showAttachments = action === 'task';
    // Follow-up (action:'comment') requires picking a target task first,
    // searched across every task-schema list in this entity.
    const requiresTaskSearch = action === 'comment';
    const taskSearchListIds = requiresTaskSearch
      ? entity.captureTypes.filter(t => t.schema === 'task').map(t => t.listId)
      : (showAssignee ? [type.listId] : []);
    // "Add to Accounts": Chat review channel vs. straight into the one
    // known account-directory List.
    const showDestinationToggle = isAccount && type.directListId;
    const showAssociatedAccount = isAccount;

    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">${escapeHtml(type.label)}</span>
        <span class="tag" style="--tag-color:${entity.color}">${escapeHtml(entity.name)}</span>
      </header>
      <main class="form">
        <form id="capture-form" novalidate>
          ${requiresTaskSearch ? `<div id="subtask-block"></div>` : ''}
          ${schema.map(f => renderField(f)).join('')}
          ${showAssociatedAccount ? `<div id="associated-account-block"></div>` : ''}
          ${showDestinationToggle ? `
          <div class="segmented" id="account-destination">
            <button type="button" class="segmented-btn active" data-dest="chat">${icon('note')} Review Channel</button>
            <button type="button" class="segmented-btn" data-dest="direct" id="direct-to-list-btn" disabled title="Only available for MKC Client accounts">${icon('link')} Direct to List</button>
          </div>
          <p class="hint" id="direct-to-list-hint">"Direct to List" is only available once Account Type is set to MKC Client — MKC's and MKP's own accounts are reviewed and exported outside ClickUp.</p>` : ''}
          ${showAssignee ? `<div id="subtask-block"></div>` : ''}
          ${showAssignee ? `
          <label class="field" for="field-assigneeId">Assignee
            <select id="field-assigneeId" disabled>
              <option value="">Loading team…</option>
            </select>
          </label>` : ''}

          ${showAttachments ? voiceRowHtml(speechSupported, recordSupported, true) : (speechSupported ? voiceRowHtml(true, false, false) : '')}
          ${isAccount ? `<p class="hint">${icon('lock')} For safety, account details are never saved on this device — not as a draft, and not in the offline queue.</p>` : ''}
          <div id="form-error"></div>
        </form>
      </main>
      <div class="form-footer">
        <button class="send-btn" id="send-btn">Send to ClickUp</button>
      </div>
    `;

    bindBack();

    if (showDestinationToggle) {
      root.querySelectorAll('#account-destination .segmented-btn').forEach(btn => {
        btn.onclick = () => {
          if (btn.disabled) return;
          state.accountDestination = btn.dataset.dest;
          root.querySelectorAll('#account-destination .segmented-btn').forEach(b => b.classList.toggle('active', b === btn));
          // Prefetch the custom-field mapping so Send doesn't wait on it.
          if (btn.dataset.dest === 'direct') loadAccountFieldMapping(type.directListId);
        };
      });
    }

    if (showAssociatedAccount) {
      const accountTypeSelect = root.querySelector('#field-accountType');
      const directBtn = root.querySelector('#direct-to-list-btn');
      // "Direct to List" eligibility and the Associated Account
      // autocomplete both react to Account Type.
      const syncAccountTypeDependents = () => {
        const isMkcClient = accountTypeSelect.value === 'MKC Client';
        if (directBtn) {
          directBtn.disabled = !isMkcClient;
          directBtn.title = isMkcClient ? '' : 'Only available for MKC Client accounts';
          if (!isMkcClient && state.accountDestination === 'direct') {
            // Type changed away after Direct was chosen → fall back to
            // the always-valid option.
            state.accountDestination = 'chat';
            root.querySelectorAll('#account-destination .segmented-btn').forEach(b => b.classList.toggle('active', b.dataset.dest === 'chat'));
          }
        }
        if (isMkcClient) {
          renderAssociatedAccountBlock();
        } else {
          state.associatedAccountId = null;
          state.associatedAccountName = null;
          const block = root.querySelector('#associated-account-block');
          if (block) block.innerHTML = '';
        }
      };
      accountTypeSelect.addEventListener('change', syncAccountTypeDependents);
      syncAccountTypeDependents();
    }

    if (showAssignee) {
      loadAssigneeOptions(type.listId);
      renderSubtaskBlock(taskSearchListIds, undefined, false, true, 'subtask');
    }
    if (requiresTaskSearch) {
      renderSubtaskBlock(taskSearchListIds, 'searching', true, false, 'task to follow up on');
    }

    if (showAttachments) bindAttachmentControls();

    const primary = schema.find(f => f.primary) || schema.find(f => f.type === 'textarea') || schema[0];
    const dictateBtn = root.querySelector('#dictate-btn');
    if (dictateBtn) dictateBtn.onclick = () => toggleDictate(root.querySelector(`#field-${primary.key}`));

    // Pre-fill: text carried from Smart capture wins over a saved draft.
    const route = `/form/${entityId}/${typeId}`;
    if (carry && !isAccount) {
      applyCarry(schema, showAttachments);
    } else if (!isAccount) {
      restoreDraft(route, (values) => setFieldValues(schema, values), () => setFieldValues(schema, {}, true));
    }
    // Drafts: never for Add to Accounts (credentials).
    if (!isAccount) {
      watchDraft(route, root.querySelector('#capture-form'), () => collectDraftValues(schema));
    }

    root.querySelector('#send-btn').onclick = (e) => {
      e.preventDefault();
      submitCapture(entity, type, schema);
    };
  }

  /**
   * voiceRowHtml
   * The Dictate / Voice note / Attach controls (+ attachment list and
   * recording indicator when attachments are allowed). Shared by the
   * manual form and Smart capture so both behave identically.
   * @param {boolean} speech - show Dictate
   * @param {boolean} record - show Voice note
   * @param {boolean} attach - show Attach + attachment list
   * @returns {string} HTML
   */
  function voiceRowHtml(speech, record, attach) {
    return `
      <div class="voice-row">
        ${speech ? `<button type="button" class="pill-btn" id="dictate-btn">${icon('mic')} Dictate</button>` : ''}
        ${record ? `<button type="button" class="pill-btn" id="record-btn">${icon('record')} Voice note</button>` : ''}
        ${attach ? `<label class="pill-btn" for="file-input">${icon('paperclip')} Attach
          <input type="file" id="file-input" multiple hidden>
        </label>` : ''}
      </div>
      ${attach ? `<div id="attachment-list" class="attachment-list"></div>
      <div id="recording-indicator" class="recording-indicator hidden">Recording… <span id="rec-time">0:00</span></div>` : ''}`;
  }

  /**
   * bindAttachmentControls
   * Wires the file input (with the 90MB guard) and the voice-note button
   * rendered by voiceRowHtml(). Files go into state.attachments.
   */
  function bindAttachmentControls() {
    const fileInput = root.querySelector('#file-input');
    if (fileInput) {
      fileInput.onchange = () => {
        const incoming = Array.from(fileInput.files);
        const tooBig = incoming.filter(f => f.size > MAX_ATTACHMENT_BYTES);
        const ok = incoming.filter(f => f.size <= MAX_ATTACHMENT_BYTES);
        if (tooBig.length) {
          UI.toast(`${tooBig.map(f => f.name).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} over the 90MB limit and won’t be included — add ${tooBig.length > 1 ? 'them' : 'it'} in ClickUp directly.`, { kind: 'bad', duration: 7000 });
        }
        state.attachments.push(...ok);
        renderAttachmentList();
        fileInput.value = '';
      };
    }
    const recordBtn = root.querySelector('#record-btn');
    if (recordBtn) recordBtn.onclick = () => toggleRecording();
  }

  /**
   * renderField — one schema field as HTML (see FIELD_SCHEMAS types).
   * @param {object} f - schema field
   * @returns {string}
   */
  function renderField(f) {
    const id = `field-${f.key}`;
    const req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
    if (f.type === 'textarea') {
      return `<label class="field" for="${id}"><span>${escapeHtml(f.label)}${req}</span>
        <textarea id="${id}" name="${f.key}" rows="4" placeholder="${escapeHtml(f.placeholder || '')}"${f.required ? ' required' : ''}></textarea>
      </label>`;
    }
    if (f.type === 'select') {
      return `<label class="field" for="${id}"><span>${escapeHtml(f.label)}${req}</span>
        <select id="${id}" name="${f.key}"${f.required ? ' required' : ''}>
          <option value="">—</option>
          ${f.options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
        </select>
      </label>`;
    }
    if (f.type === 'priority') {
      return `<label class="field" for="${id}">${escapeHtml(f.label)}
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
      return `<label class="field" for="${id}">${escapeHtml(f.label)}
        <input type="date" id="${id}" name="${f.key}">
      </label>`;
    }
    if (f.type === 'password') {
      // Masked input (no current schema uses it since v10 — kept for
      // future fields). Masking is shoulder-surfing protection only.
      return `<label class="field" for="${id}">${escapeHtml(f.label)}
        <input type="password" id="${id}" name="${f.key}" autocomplete="new-password">
      </label>`;
    }
    return `<label class="field" for="${id}"><span>${escapeHtml(f.label)}${req}</span>
      <input type="text" id="${id}" name="${f.key}" placeholder="${escapeHtml(f.placeholder || '')}" autocomplete="off"${f.required ? ' required' : ''}>
    </label>`;
  }

  // ---------------------------------------------------------------
  // Drafts (auto-save while typing; restore on reopen)
  // ---------------------------------------------------------------
  /**
   * collectDraftValues
   * Current values of the schema's fields, minus anything sensitive.
   * @param {object[]} schema
   * @returns {object}
   */
  function collectDraftValues(schema) {
    const values = {};
    schema.forEach(f => {
      if (f.type === 'password' || f.key === 'password') return;
      const el = root.querySelector(`#field-${f.key}`);
      if (el && el.value) values[f.key] = el.value;
    });
    return values;
  }

  /**
   * setFieldValues
   * Writes values into the form's fields.
   * @param {object[]} schema
   * @param {object} values
   * @param {boolean} [clearOthers=false] - also blank fields not in values
   */
  function setFieldValues(schema, values, clearOthers = false) {
    schema.forEach(f => {
      const el = root.querySelector(`#field-${f.key}`);
      if (!el) return;
      if (values[f.key] != null) el.value = values[f.key];
      else if (clearOthers) el.value = '';
    });
  }

  /**
   * watchDraft
   * Debounced auto-save: any input inside `container` saves a draft for
   * `route` 500ms after typing pauses. Empty forms clear the draft.
   * @param {string} route
   * @param {HTMLElement} container
   * @param {() => object} getValues
   */
  function watchDraft(route, container, getValues) {
    if (!container) return;
    const save = () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        const values = getValues();
        if (Object.keys(values).length) Storage.saveDraft(route, values);
        else Storage.clearDraft();
      }, 500);
    };
    container.addEventListener('input', save);
    container.addEventListener('change', save);
  }

  /**
   * restoreDraft
   * If a draft exists for this route, applies it and offers "Discard".
   * @param {string} route
   * @param {(values: object) => void} apply
   * @param {() => void} wipe - clears the restored values on Discard
   */
  function restoreDraft(route, apply, wipe) {
    const values = Storage.getDraft(route);
    if (!values) return;
    apply(values);
    UI.toast('Draft restored.', {
      action: { label: 'Discard', onClick: () => { Storage.clearDraft(); wipe(); } },
      duration: 5000,
      // Its Discard acts on THIS screen's fields — drop it on navigation.
      scoped: true
    });
  }

  /**
   * applyCarry
   * Pre-fills a manual form with text handed over from Smart capture:
   * the first line becomes the title, the full text the details field,
   * and any staged attachments come along too.
   * @param {object[]} schema
   * @param {boolean} attachmentsAllowed
   */
  function applyCarry(schema, attachmentsAllowed) {
    const c = carry;
    carry = null;
    if (!c) return;
    const titleField = schema.find(f => f.key === 'title');
    const textField = schema.find(f => f.primary) || schema.find(f => f.type === 'textarea');
    const firstLine = c.title || truncate(c.text.split('\n')[0], 80);
    if (titleField) root.querySelector(`#field-${titleField.key}`).value = firstLine;
    if (textField && textField !== titleField) root.querySelector(`#field-${textField.key}`).value = c.text;
    if (attachmentsAllowed && c.attachments && c.attachments.length) {
      state.attachments.push(...c.attachments);
      renderAttachmentList();
    }
  }

  /**
   * loadAssigneeOptions
   * Fills the Assignee <select> with the List's members (cached per
   * list). Fails quietly — assignee is optional and must never block a
   * capture.
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
      if (!root.contains(select)) return; // navigated away meanwhile
      select.innerHTML = `<option value="">Unassigned</option>` +
        members.map(m => `<option value="${m.id}">${escapeHtml(m.username || m.email || 'Member')}</option>`).join('');
      select.disabled = false;
    } catch (err) {
      delete listMembersCache[listId]; // don't cache a failure
      if (root.contains(select)) {
        select.innerHTML = `<option value="">Unavailable — you can still send without an assignee</option>`;
      }
    }
  }

  /**
   * loadAccountFieldMapping
   * Prefetches getAccountFieldMapping() without blocking (called the
   * moment "Direct to List" is selected).
   * @param {string} listId
   */
  function loadAccountFieldMapping(listId) {
    getAccountFieldMapping(listId).catch(() => {
      // submitCapture() awaits the same promise and handles failure there.
    });
  }

  /**
   * getAccountFieldMapping
   * Matches the MKC Client Accounts list's real custom fields by name to
   * the Add to Accounts form: Admin Username, Admin Email, Registered
   * Password, Related Account ID. Substring + case-insensitive so a minor
   * rename in ClickUp doesn't break it. Returns {id, type} per key (type
   * gates the associatedAccount write — see TEXT_LIKE_FIELD_TYPES).
   * "Tool/Software/Act" is deliberately NOT mapped (it's a dropdown; see
   * v12). "MKC ID" / "Notebook Link" are never set by the app.
   * @param {string} listId
   * @returns {Promise<{adminUsername?, adminEmail?, password?, associatedAccount?}>}
   */
  function getAccountFieldMapping(listId) {
    if (!accountFieldMappingCache[listId]) {
      accountFieldMappingCache[listId] = ClickUp.getListFields(listId).then(fields => {
        const find = (...keywords) => {
          const match = fields.find(f => keywords.some(k => f.name.toLowerCase().includes(k)));
          return match ? { id: match.id, type: match.type } : undefined;
        };
        return {
          adminUsername: find('admin username', 'username'),
          adminEmail: find('admin email', 'email'),
          password: find('registered password', 'password'),
          // "Related Account ID" — stores the linked company's task ID.
          associatedAccount: find('related account id', 'related account', 'account id')
        };
      }).catch(err => {
        delete accountFieldMappingCache[listId]; // allow retry
        throw err;
      });
    }
    return accountFieldMappingCache[listId];
  }

  /**
   * renderAssociatedAccountBlock
   * Company-name autocomplete (native <datalist>) sourced from
   * CRM_COMPANIES_LIST_ID, shown while Account Type = MKC Client. An
   * exact match sets state.associatedAccountId/Name; anything else leaves
   * them null and Send still works (informative, not required).
   */
  function renderAssociatedAccountBlock() {
    const container = root.querySelector('#associated-account-block');
    if (!container) return;
    container.innerHTML = `
      <label class="field" for="associated-account-search">Associated Client Account
        <input type="text" id="associated-account-search" list="associated-account-options" placeholder="Search company name…" autocomplete="off">
        <datalist id="associated-account-options"></datalist>
      </label>
      <p class="hint" id="associated-account-status">Loading client companies…</p>
    `;
    const input = container.querySelector('#associated-account-search');
    const datalist = container.querySelector('#associated-account-options');
    const status = container.querySelector('#associated-account-status');

    loadParentTaskOptions(CRM_COMPANIES_LIST_ID).then(companies => {
      if (!root.contains(container)) return;
      datalist.innerHTML = companies.map(c => `<option value="${escapeHtml(c.name)}">`).join('');
      status.textContent = 'Optional — links this entry to the client’s company record.';
      const syncMatch = () => {
        const match = companies.find(c => c.name === input.value);
        if (match) {
          state.associatedAccountId = match.id;
          state.associatedAccountName = match.name;
          status.textContent = `✓ Matched: ${match.name}`;
          status.className = 'hint hint--good';
        } else {
          state.associatedAccountId = null;
          state.associatedAccountName = null;
          status.textContent = input.value
            ? 'No exact match — pick a company from the list to link it.'
            : 'Optional — links this entry to the client’s company record.';
          status.className = 'hint';
        }
      };
      input.addEventListener('input', syncMatch);
    }).catch(() => {
      if (root.contains(container)) status.textContent = 'Couldn’t load client companies — you can still send without linking one.';
    });
  }

  // -----------------------------------------------------------------
  // Task search/picker — shared by:
  //   "Make this a subtask" (Task forms; optional; single list — the
  //     parent must be in the same list and not itself a subtask)
  //   "Follow-up / Reminder" (required; searches every task list in the
  //     entity, since a comment isn't restricted to one list)
  // Three UI states re-rendered into #subtask-block only, so the rest of
  // the form keeps whatever was typed: 'idle' | 'searching' | 'selected'.
  // Only the selection (state.parentTask*) persists.
  // -----------------------------------------------------------------

  /**
   * renderSubtaskBlock
   * @param {string[]} listIds - lists to search across
   * @param {'idle'|'searching'|'selected'} [mode]
   * @param {boolean} [required] - Follow-up: no idle state
   * @param {boolean} [excludeSubtasks] - subtask feature: true
   * @param {string} [label] - wording ("subtask" / "task to follow up on")
   */
  function renderSubtaskBlock(listIds, mode, required, excludeSubtasks, label) {
    const container = root.querySelector('#subtask-block');
    if (!container) return;
    const noun = label || 'subtask';
    const effectiveMode = mode || (state.parentTaskId ? 'selected' : (required ? 'searching' : 'idle'));

    if (effectiveMode === 'idle') {
      container.innerHTML = `<button type="button" class="pill-btn" id="subtask-toggle">${icon('nest')} Make this a subtask</button>`;
      container.querySelector('#subtask-toggle').onclick = () => renderSubtaskBlock(listIds, 'searching', required, excludeSubtasks, label);
      return;
    }

    if (effectiveMode === 'selected') {
      container.innerHTML = `
        <div class="subtask-chip">
          <span>${icon('nest')} ${required ? 'Following up on' : 'Subtask of'}: <strong>${escapeHtml(state.parentTaskName)}</strong></span>
          <button type="button" id="subtask-remove">${required ? 'Change' : 'Remove'}</button>
        </div>`;
      container.querySelector('#subtask-remove').onclick = () => {
        state.parentTaskId = null;
        state.parentTaskName = null;
        state.parentTaskUrl = null;
        renderSubtaskBlock(listIds, required ? 'searching' : 'idle', required, excludeSubtasks, label);
      };
      return;
    }

    // 'searching'
    container.innerHTML = `
      <div class="subtask-panel">
        ${required ? `<p class="hint">Search for the ${escapeHtml(noun)} — required.</p>` : ''}
        <input type="text" id="subtask-search" class="subtask-search" placeholder="Search by name or ID…" autocomplete="off" aria-label="Search tasks">
        <div id="subtask-results" class="subtask-results">
          <p class="hint">Type at least 2 characters to search.</p>
        </div>
        ${required ? '' : '<button type="button" class="link-btn" id="subtask-cancel">Cancel</button>'}
      </div>`;

    const searchInput = container.querySelector('#subtask-search');
    const resultsEl = container.querySelector('#subtask-results');
    if (!required) searchInput.focus();

    const cancelBtn = container.querySelector('#subtask-cancel');
    if (cancelBtn) cancelBtn.onclick = () => renderSubtaskBlock(listIds, 'idle', required, excludeSubtasks, label);

    searchInput.oninput = () => filterAndRenderSubtaskResults(listIds, searchInput.value.trim(), resultsEl, required, excludeSubtasks, label);

    // Start the (cached) fetches now so results appear as soon as 2+
    // characters are typed.
    Promise.all(listIds.map(loadParentTaskOptions)).catch(() => {
      resultsEl.innerHTML = `<p class="hint hint--bad">Couldn’t load tasks. ${required ? 'You can still paste an exact task ID above.' : 'You can still send without one.'}</p>`;
    });
  }

  /**
   * loadParentTaskOptions — cached ClickUp.getListTasks per list.
   * @param {string} listId
   * @returns {Promise<object[]>}
   */
  function loadParentTaskOptions(listId) {
    if (!listTasksCache[listId]) {
      listTasksCache[listId] = ClickUp.getListTasks(listId).catch(err => {
        delete listTasksCache[listId]; // allow retry
        throw err;
      });
    }
    return listTasksCache[listId];
  }

  /**
   * filterAndRenderSubtaskResults
   * Substring match (name / id / custom_id) over the cached tasks, up to
   * 8 results; offers a direct-by-ID lookup when nothing local matches
   * and the query looks like a task ID.
   */
  async function filterAndRenderSubtaskResults(listIds, query, resultsEl, required, excludeSubtasks, label) {
    if (query.length < 2) {
      resultsEl.innerHTML = `<p class="hint">Type at least 2 characters to search.</p>`;
      return;
    }
    let taskLists;
    try {
      taskLists = await Promise.all(listIds.map(loadParentTaskOptions));
    } catch (err) {
      resultsEl.innerHTML = `<p class="hint hint--bad">Couldn’t load tasks.</p>`;
      return;
    }
    let tasks = taskLists.flat();
    if (excludeSubtasks) tasks = tasks.filter(t => !t.parent);

    const q = query.toLowerCase();
    const matches = tasks.filter(t =>
      (t.name && t.name.toLowerCase().includes(q)) ||
      (t.id && t.id.toLowerCase().includes(q)) ||
      (t.custom_id && t.custom_id.toLowerCase().includes(q))
    ).slice(0, 8);

    let html = matches.map(t => `
      <button type="button" class="subtask-result" data-task-id="${escapeHtml(t.id)}" data-task-name="${escapeHtml(t.name)}" data-task-url="${escapeHtml(t.url || '')}">
        <span class="subtask-result-name">${escapeHtml(t.name)}</span>
        <span class="subtask-result-meta">${escapeHtml((t.status && t.status.status) || '')}</span>
      </button>
    `).join('');

    const looksLikeId = /^[a-z0-9]{6,10}$/i.test(query);
    if (!matches.length && looksLikeId) {
      html += `<button type="button" class="subtask-result subtask-result--lookup" id="subtask-direct-lookup">Look up task "${escapeHtml(query)}" directly</button>`;
    }

    resultsEl.innerHTML = html || `<p class="hint">No matching tasks found.</p>`;

    resultsEl.querySelectorAll('.subtask-result[data-task-id]').forEach(btn => {
      btn.onclick = () => selectParentTask(listIds, btn.dataset.taskId, btn.dataset.taskName, btn.dataset.taskUrl, required, excludeSubtasks, label);
    });

    const lookupBtn = resultsEl.querySelector('#subtask-direct-lookup');
    if (lookupBtn) {
      lookupBtn.onclick = async () => {
        lookupBtn.disabled = true;
        lookupBtn.textContent = 'Looking up…';
        try {
          const task = await ClickUp.getTaskById(query);
          if (task && excludeSubtasks && task.parent) {
            resultsEl.innerHTML = `<p class="hint hint--bad">That task is itself a subtask, so it can’t be used as a parent.</p>`;
          } else if (task) {
            selectParentTask(listIds, task.id, task.name, task.url, required, excludeSubtasks, label);
          } else {
            resultsEl.innerHTML = `<p class="hint hint--bad">No task found with that ID.</p>`;
          }
        } catch (err) {
          resultsEl.innerHTML = `<p class="hint hint--bad">Lookup failed — double-check the ID.</p>`;
        }
      };
    }
  }

  /** selectParentTask — records the chosen task and shows the summary chip. */
  function selectParentTask(listIds, taskId, taskName, taskUrl, required, excludeSubtasks, label) {
    state.parentTaskId = taskId;
    state.parentTaskName = taskName;
    state.parentTaskUrl = taskUrl || `https://app.clickup.com/t/${taskId}`;
    renderSubtaskBlock(listIds, 'selected', required, excludeSubtasks, label);
  }

  /** renderAttachmentList — pills for state.attachments with remove (×). */
  function renderAttachmentList() {
    const list = root.querySelector('#attachment-list');
    if (!list) return;
    list.innerHTML = state.attachments.map((f, i) => `
      <span class="attachment-pill">${escapeHtml(f.name)} <button type="button" data-remove="${i}" aria-label="Remove ${escapeHtml(f.name)}">×</button></span>
    `).join('');
    list.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = () => {
        state.attachments.splice(Number(btn.dataset.remove), 1);
        renderAttachmentList();
      };
    });
  }

  // ---------------------------------------------------------------
  // Voice: dictation (speech-to-text into a text field)
  // ---------------------------------------------------------------
  /**
   * toggleDictate
   * Starts/stops Web Speech dictation into `el`, appending to whatever
   * is already typed. Fires an 'input' event so drafts auto-save.
   * @param {HTMLInputElement|HTMLTextAreaElement} el
   */
  function toggleDictate(el) {
    const btn = root.querySelector('#dictate-btn');
    if (recognizer) { stopRecognizer(); if (btn) btn.classList.remove('active'); return; }
    if (!el) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = navigator.language || 'en-US';

    const baseText = el.value ? el.value + ' ' : '';
    recognizer.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      el.value = baseText + transcript;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    recognizer.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        UI.toast('Dictation needs microphone permission — check your browser settings.', { kind: 'bad' });
      }
    };
    recognizer.onend = () => { if (btn) btn.classList.remove('active'); recognizer = null; };
    try {
      recognizer.start();
      if (btn) btn.classList.add('active');
    } catch (e) {
      recognizer = null;
      UI.toast('Couldn’t start dictation.', { kind: 'bad' });
    }
  }

  /** stopRecognizer — stops dictation if running (on screen change). */
  function stopRecognizer() {
    if (recognizer) { try { recognizer.stop(); } catch (e) { /* already stopped */ } recognizer = null; }
  }

  // ---------------------------------------------------------------
  // Voice: audio recording (attached as a file on submit)
  // ---------------------------------------------------------------
  /**
   * toggleRecording
   * Starts/stops a MediaRecorder voice note; the result is added to
   * state.attachments as a .webm file.
   */
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
        const mime = mediaRecorder.mimeType || 'audio/webm';
        const ext = mime.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(mediaChunks, { type: mime });
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mime });
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
      UI.toast('Couldn’t access the microphone. Check your browser permissions.', { kind: 'bad' });
    }
  }

  // ---------------------------------------------------------------
  // Screen: Smart capture (#/smart)
  // ---------------------------------------------------------------
  /**
   * renderSmart
   * The "just say it" screen: one text box (dictation target), optional
   * business hint chips, voice note + attachments. "Route & Send" asks
   * Gemini where it goes. Re-entering the screen while a suggestion is
   * on hand (e.g. back from Review) keeps the text.
   */
  function renderSmart() {
    if (!Routing.isAvailable()) return go('/entity');
    const keep = smart && smart.text != null ? smart : null;
    if (!keep) state = { attachments: [], transcript: '', recording: null };
    smart = keep || { text: '', hint: null, suggestion: null };
    const speechSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    const recordSupported = !!(navigator.mediaDevices && window.MediaRecorder);

    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">New Capture</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <main class="form smart">
        <label class="field" for="smart-text"><span>What’s on your mind? <span class="req" aria-hidden="true">*</span></span>
          <textarea id="smart-text" rows="6" placeholder="Type or dictate — e.g. “Call Jim Friday about the overdue invoice”">${escapeHtml(smart.text)}</textarea>
        </label>
        <div class="hint-row" role="group" aria-label="Optional: which business is this for?">
          <span class="hint-label">Hint</span>
          ${ENTITIES.map(e => `<button type="button" class="hint-chip${smart.hint === e.name ? ' active' : ''}" style="--tile-color:${e.color}" data-hint="${escapeHtml(e.name)}" aria-pressed="${smart.hint === e.name}">${escapeHtml(e.name)}</button>`).join('')}
        </div>
        ${voiceRowHtml(speechSupported, recordSupported, true)}
        <p class="hint">${icon('spark')} Gemini picks the list, title, dates and priority. Confident captures file themselves (you can undo); anything uncertain asks you first.</p>
        <div id="form-error"></div>
      </main>
      <div class="form-footer">
        <button class="send-btn" id="route-btn">${icon('spark')} Route &amp; Send</button>
        <button class="link-btn footer-alt" id="manual-btn">Choose the destination myself</button>
      </div>
    `;
    bindBack();
    bindAttachmentControls();
    renderAttachmentList();

    const textEl = root.querySelector('#smart-text');
    if (!keep) {
      restoreDraft('/smart', (v) => { textEl.value = v.text || ''; smart.text = textEl.value; }, () => { textEl.value = ''; smart.text = ''; });
    }
    textEl.addEventListener('input', () => { smart.text = textEl.value; });
    watchDraft('/smart', root.querySelector('main'), () => (textEl.value.trim() ? { text: textEl.value } : {}));
    if (!textEl.value) textEl.focus();

    root.querySelectorAll('[data-hint]').forEach(chip => {
      chip.onclick = () => {
        smart.hint = smart.hint === chip.dataset.hint ? null : chip.dataset.hint;
        root.querySelectorAll('[data-hint]').forEach(c => {
          const on = c.dataset.hint === smart.hint;
          c.classList.toggle('active', on);
          c.setAttribute('aria-pressed', String(on));
        });
      };
    });

    const dictateBtn = root.querySelector('#dictate-btn');
    if (dictateBtn) dictateBtn.onclick = () => toggleDictate(textEl);
    root.querySelector('#manual-btn').onclick = () => handOffToManual();
    root.querySelector('#route-btn').onclick = () => runSmartRoute();
  }

  /**
   * handOffToManual
   * Leaves the smart flow for the manual picker, carrying the text and
   * attachments so nothing has to be retyped.
   * @param {string} [message] - optional toast explaining why
   */
  function handOffToManual(message) {
    stopRecognizer();
    const text = (smart && smart.text || '').trim();
    carry = text || state.attachments.length
      ? { text, title: smart && smart.suggestion ? smart.suggestion.title : null, attachments: state.attachments.slice() }
      : null;
    Storage.clearDraft();
    if (message) UI.toast(message, { duration: 6000 });
    go('/entity');
  }

  /**
   * runSmartRoute
   * Validates, asks the Worker for a suggestion, then either auto-files
   * (high confidence, no duplicate) or opens the Review screen.
   * Failure handling: offline → hand off to the manual picker (it can
   * queue); any other routing failure → inline error with a one-tap
   * "choose it myself" fallback, text preserved.
   */
  async function runSmartRoute() {
    stopRecognizer();
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    const textEl = root.querySelector('#smart-text');
    const errBox = root.querySelector('#form-error');
    smart.text = textEl.value;
    const text = smart.text.trim();
    if (!text) {
      UI.markFieldError(textEl, 'Type or dictate something to send.');
      return;
    }
    if (!navigator.onLine) {
      handOffToManual('You’re offline — pick a destination and it’ll send once you’re back online.');
      return;
    }
    const btn = root.querySelector('#route-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Finding the right list…`;
    UI.clearFormError(errBox);

    try {
      const s = await Routing.suggest({ text, hint: smart.hint, attachments: state.attachments.length });
      smart.suggestion = s;
      if (s.auto) {
        btn.innerHTML = `<span class="spinner"></span> Filing to ${escapeHtml(lastSegment(s.list_path))}…`;
        await commitSmart({ mode: 'create', listId: s.list_id, listPath: s.list_path, values: defaultReviewValues(s) }, 'auto', btn);
        return;
      }
      renderReview();
    } catch (err) {
      if (!root.contains(btn)) return; // left the screen meanwhile
      btn.disabled = false;
      btn.innerHTML = `${icon('spark')} Route &amp; Send`;
      if (err.offline) {
        handOffToManual('You’re offline — pick a destination and it’ll send once you’re back online.');
        return;
      }
      UI.showFormError(errBox, err, { label: 'Choose the destination myself →', onClick: () => handOffToManual() });
    }
  }

  /**
   * defaultReviewValues — title/dates/priority as Gemini proposed them.
   * @param {object} s - suggestion
   * @returns {{title, dueDate, startDate, priority}}
   */
  function defaultReviewValues(s) {
    return {
      title: s.title,
      dueDate: s.due_date || '',
      startDate: s.start_date || '',
      priority: s.priority ? s.priority[0].toUpperCase() + s.priority.slice(1) : ''
    };
  }

  /**
   * renderReview
   * Confirm screen for uncertain (or duplicate-flagged) suggestions.
   * Shows: duplicate card (if any) with "Add as update"; the suggested
   * destination with confidence meter, reason and a "Why N%?" breakdown;
   * alternatives + "Other list…"; editable title, dates, priority.
   */
  function renderReview() {
    const s = smart.suggestion;
    if (!s) return renderSmart();
    smart.review = smart.review || { listId: s.list_id, listPath: s.list_path };
    const r = smart.review;
    const v = defaultReviewValues(s);
    const pct = Math.round((s.confidence || 0) * 100);
    const dup = s.duplicate;
    // Options: the suggestion first, then alternatives, then (if the
    // owner picked something else via the picker) that choice.
    const options = [];
    if (s.list_id) options.push({ id: s.list_id, path: s.list_path, conf: s.confidence, top: true });
    (s.alternatives || []).forEach(a => options.push({ id: a.list_id, path: a.list_path, conf: a.confidence }));
    if (r.listId && !options.some(o => o.id === r.listId)) options.push({ id: r.listId, path: r.listPath, picked: true });

    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" id="review-back" aria-label="Back to edit">${icon('back')}</button>
        <span class="brand">Confirm</span>
        <span class="icon-btn-spacer"></span>
      </header>
      <main class="form review">
        ${dup ? `
        <section class="card dup-card" aria-label="Possible duplicate">
          <span class="eyebrow eyebrow--warn">${icon('copy')} Looks like an existing task</span>
          <div class="dup-name">${escapeHtml(dup.name)}</div>
          <div class="dup-meta">${escapeHtml(dup.list_path || '')}${dup.status ? ` · ${escapeHtml(dup.status)}` : ''} · ${Math.round(dup.similarity * 100)}% similar</div>
          ${dup.reason ? `<p class="dup-reason">${escapeHtml(dup.reason)}</p>` : ''}
          <div class="dup-actions">
            <button type="button" class="send-btn send-btn--compact" id="dup-update">${icon('nest')} Add as update</button>
            <a class="pill-btn" href="${escapeHtml(dup.url)}" target="_blank" rel="noopener">View ${icon('link')}</a>
          </div>
          <p class="hint">Adds your note as a comment on that task instead of creating a copy. Or create a new task below.</p>
        </section>` : ''}

        <section class="card place-card" aria-label="Destination">
          <div class="place-head">
            <span class="eyebrow">${s.list_id ? 'Suggested destination' : 'Pick a destination'}</span>
            ${s.list_id ? confidenceMeter(s.confidence) : ''}
          </div>
          ${s.reason ? `<p class="place-reason">${escapeHtml(s.reason)}</p>` : ''}
          <div class="option-list" role="radiogroup" aria-label="Destination list">
            ${options.map(o => `
              <button type="button" role="radio" class="option${o.id === r.listId ? ' selected' : ''}" data-list="${escapeHtml(o.id)}" data-path="${escapeHtml(o.path || '')}" aria-checked="${o.id === r.listId}">
                <span class="option-path">${o.top ? `<span class="star">★</span>` : ''}${escapeHtml(o.path || o.id)}</span>
                ${typeof o.conf === 'number' ? `<span class="option-conf">${Math.round(o.conf * 100)}%</span>` : (o.picked ? `<span class="option-conf">your pick</span>` : '')}
              </button>`).join('')}
            <button type="button" class="option option--other" id="other-list">${icon('list')} Other list…</button>
          </div>
          ${s.factors && s.factors.length ? `
          <details class="why">
            <summary>Why ${pct}%?</summary>
            <ul>${s.factors.map(f => `<li><span>${escapeHtml(f.label)}</span><span class="why-num">${typeof f.value === 'number' ? Math.round(f.value * 100) + '%' : (f.delta > 0 ? '+' : '') + Math.round(f.delta * 100)}</span></li>`).join('')}
              <li class="why-total"><span>Final</span><span class="why-num">${pct}%</span></li></ul>
            <p class="hint">Auto-filing needs ${Math.round((s.threshold || 0.85) * 100)}% or more${dup ? ' and no likely duplicate' : ''}. Change this in Settings.</p>
          </details>` : ''}
          ${s.duplicate_check === 'failed' ? `<p class="hint">Duplicate check was skipped this time.</p>` : ''}
        </section>

        <label class="field" for="rv-title">Title
          <input type="text" id="rv-title" value="${escapeHtml(v.title)}" autocomplete="off">
        </label>
        <div class="field-row">
          <label class="field" for="rv-due">Due date
            <input type="date" id="rv-due" value="${escapeHtml(v.dueDate)}">
          </label>
          <label class="field" for="rv-start">Start date
            <input type="date" id="rv-start" value="${escapeHtml(v.startDate)}">
          </label>
        </div>
        ${s.date_reason && (v.dueDate || v.startDate) ? `<p class="hint">${icon('calendar')} ${escapeHtml(s.date_reason)}</p>` : ''}
        <label class="field" for="rv-priority">Priority
          <select id="rv-priority">
            ${['', 'Urgent', 'High', 'Normal', 'Low'].map(p => `<option value="${p}"${p === v.priority ? ' selected' : ''}>${p || '—'}</option>`).join('')}
          </select>
        </label>
        ${state.attachments.length ? `<p class="hint">${icon('paperclip')} ${state.attachments.length} attachment${state.attachments.length > 1 ? 's' : ''} will be added.</p>` : ''}
        <div id="form-error"></div>
      </main>
      <div class="form-footer">
        <button class="send-btn" id="rv-send"${r.listId ? '' : ' disabled'}>${sendLabel(r.listPath, Boolean(dup))}</button>
      </div>
    `;

    root.querySelector('#review-back').onclick = () => { smart.review = null; renderSmart(); };
    root.querySelectorAll('.option[data-list]').forEach(btn => {
      btn.onclick = () => {
        r.listId = btn.dataset.list;
        r.listPath = btn.dataset.path;
        root.querySelectorAll('.option[data-list]').forEach(b => {
          const on = b === btn;
          b.classList.toggle('selected', on);
          b.setAttribute('aria-checked', String(on));
        });
        const send = root.querySelector('#rv-send');
        send.disabled = false;
        send.innerHTML = sendLabel(r.listPath, Boolean(dup));
      };
    });
    root.querySelector('#other-list').onclick = async () => {
      const picked = await pickList();
      if (!picked) return;
      r.listId = picked.id;
      r.listPath = picked.path;
      captureReviewValues();
      renderReview();
      restoreReviewValues();
    };
    const dupBtn = root.querySelector('#dup-update');
    if (dupBtn) {
      dupBtn.onclick = () => commitSmart({ mode: 'update', taskId: dup.task_id, values: readReviewValues() }, 'confirmed', dupBtn);
    }
    root.querySelector('#rv-send').onclick = () => {
      if (!r.listId) return;
      commitSmart({ mode: 'create', listId: r.listId, listPath: r.listPath, values: readReviewValues() }, 'confirmed', root.querySelector('#rv-send'));
    };
  }

  // Edits survive a re-render of the Review screen (after "Other list…").
  let reviewEdits = null;
  /** captureReviewValues — stash the current edits before re-rendering. */
  function captureReviewValues() { reviewEdits = readReviewValues(); }
  /** restoreReviewValues — put stashed edits back after re-rendering. */
  function restoreReviewValues() {
    if (!reviewEdits) return;
    const set = (id, val) => { const el = root.querySelector(id); if (el) el.value = val; };
    set('#rv-title', reviewEdits.title);
    set('#rv-due', reviewEdits.dueDate);
    set('#rv-start', reviewEdits.startDate);
    set('#rv-priority', reviewEdits.priority);
    reviewEdits = null;
  }
  /** readReviewValues — the Review screen's editable fields. */
  function readReviewValues() {
    const val = (id) => { const el = root.querySelector(id); return el ? el.value.trim() : ''; };
    return { title: val('#rv-title'), dueDate: val('#rv-due'), startDate: val('#rv-start'), priority: val('#rv-priority') };
  }

  /** sendLabel — footer button text for the chosen list. */
  function sendLabel(path, hasDup) {
    if (!path) return 'Pick a destination';
    return `${hasDup ? 'Create new in' : 'Send to'} ${escapeHtml(lastSegment(path))}`;
  }

  /**
   * confidenceMeter — small bar + percentage, colored by band.
   * @param {number} c - 0..1
   * @returns {string} HTML
   */
  function confidenceMeter(c) {
    const pct = Math.round((c || 0) * 100);
    const band = pct >= 85 ? 'high' : pct >= 60 ? 'mid' : 'low';
    return `<span class="conf conf--${band}" aria-label="${pct}% confident"><span class="conf-bar"><i style="width:${pct}%"></i></span>${pct}%</span>`;
  }

  /**
   * commitSmart
   * Sends a smart capture through the Worker (/route/commit), then does
   * the client-side follow-ups: attachments, chat log, Recent, toast.
   * @param {object} d
   * @param {'create'|'update'} d.mode
   * @param {string} [d.listId] / [d.listPath] - create mode
   * @param {string} [d.taskId] - update mode (the duplicate)
   * @param {{title, dueDate, startDate, priority}} d.values
   * @param {'auto'|'confirmed'} source
   * @param {HTMLButtonElement} [btn] - button to show progress on
   * Failure: stays on (or opens) the Review screen with an inline error;
   *   an "unknown outcome" timeout says to check Activity before
   *   retrying, since the task may exist already.
   */
  async function commitSmart(d, source, btn) {
    const s = smart.suggestion;
    const title = d.values.title || s.title || truncate(smart.text, 80);
    const pct = Math.round((s.confidence || 0) * 100);
    const dest = destinationMeta(d.mode === 'update' ? (s.duplicate && s.duplicate.list_id) : d.listId, d.mode === 'update' ? (s.duplicate && s.duplicate.list_path) : d.listPath);
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: d.mode === 'update' ? 'update' : 'task',
      entityName: dest.entityName,
      color: dest.color,
      typeLabel: dest.label,
      listId: d.listId || null,
      fields: { title, description: smart.text.trim(), dueDate: d.values.dueDate, startDate: d.values.startDate, priority: d.values.priority },
      title,
      createdAt: Date.now(),
      parentTaskId: d.mode === 'update' ? d.taskId : null,
      parentTaskName: d.mode === 'update' && s.duplicate ? s.duplicate.name : null,
      parentTaskUrl: d.mode === 'update' && s.duplicate ? s.duplicate.url : null,
      routing: { source, confidence: s.confidence, moved: d.mode === 'create' && d.listId !== s.list_id },
      routingFooter: `— Filed by ${APP_NAME} smart routing · ${pct}% · ${source === 'auto' ? 'auto-filed' : (d.listId && d.listId !== s.list_id ? 'destination chosen by you' : 'confirmed by you')}`
    };
    const body = {
      decision: d.mode === 'update' ? { mode: 'update', task_id: d.taskId } : { mode: 'create', list_id: d.listId },
      source,
      suggestion: s,
      capture: { title, text: smart.text.trim() },
      attachments_count: state.attachments.length,
      list_label: d.listPath || null
    };
    if (d.mode === 'update') {
      body.comment_text = [
        `🔁 Update via ${APP_NAME}`,
        title,
        smart.text.trim() !== title ? smart.text.trim() : '',
        d.values.dueDate ? `Suggested due date: ${d.values.dueDate}` : ''
      ].filter(Boolean).join('\n\n');
    } else {
      body.payload = ClickUp.buildTaskPayload(entry);
    }

    const label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> Sending…`; }
    try {
      const res = await Routing.commit(body);
      entry.auditId = res.audit_id;
      entry.taskId = res.task && res.task.id;
      entry.clickupUrl = (res.task && res.task.url) || (entry.taskId ? `https://app.clickup.com/t/${entry.taskId}` : null);
      const attachTo = d.mode === 'update' ? d.taskId : entry.taskId;
      const files = state.attachments.slice();
      // Attachments + chat log run after we've left the screen; failures
      // there never undo the capture (same policy as the manual path).
      (async () => {
        for (const file of files) await ClickUp.uploadAttachment(attachTo, file).catch(() => {});
        if (entry.clickupUrl) ClickUp.logCapture(entry, entry.clickupUrl).catch(() => {});
      })();
      Storage.addRecent(entry);
      Storage.clearDraft();
      UI.vibrate();
      smart = null;
      state.attachments = [];
      go('/home');
      const where = d.mode === 'update' ? `Added as an update to “${truncate(entry.parentTaskName || 'task', 40)}”` : `${source === 'auto' ? 'Auto-filed' : 'Filed'} to ${dest.label} · ${pct}%`;
      UI.toast(where, { kind: 'good', action: { label: 'Undo', onClick: () => undoEntry(entry) } });
    } catch (err) {
      if (source === 'auto') {
        // Auto-file failed — show the Review screen so the owner can
        // decide, with the error explained there.
        renderReview();
      } else if (btn && root.contains(btn)) {
        btn.disabled = false;
        btn.innerHTML = label;
      }
      const box = root.querySelector('#form-error');
      if (err.outcome === 'unknown') {
        UI.showFormError(box, `${err.timeout ? 'ClickUp answered too slowly' : 'The connection dropped before the server confirmed'}, so this may or may not have been created. Check Activity before sending again.`, { label: 'Open Activity', onClick: () => go('/activity') });
      } else {
        UI.showFormError(box, err);
      }
    }
  }

  /**
   * destinationMeta
   * Display info (tag text, color, short label) for a list, using the
   * owner's configured entity when the list is one of theirs.
   * @param {string} listId
   * @param {string} listPath - "Space › Folder › List"
   * @returns {{entityName: string, color: string, label: string}}
   */
  function destinationMeta(listId, listPath) {
    const known = getRoutableDestinations().find(k => k.list_id === listId);
    if (known) {
      const entity = ENTITIES.find(e => e.id === known.entityId);
      return { entityName: known.entity, color: entity ? entity.color : '#E8A33D', label: known.label };
    }
    const parts = String(listPath || '').split(' › ');
    const space = parts[0] || '';
    const entity = ENTITIES.find(e => e.name.toLowerCase() === space.toLowerCase());
    return { entityName: space || 'ClickUp', color: entity ? entity.color : '#E8A33D', label: parts[parts.length - 1] || 'List' };
  }

  /**
   * undoEntry
   * Undo from a toast or Recent: reverses via the audit log, marks the
   * Recent entry undone, and reports what happened (incl. anything that
   * couldn't be reversed, e.g. attachments on an existing task).
   * @param {object} entry - must carry auditId
   */
  async function undoEntry(entry) {
    if (!entry.auditId) {
      UI.toast('This one can’t be undone automatically — remove it in ClickUp.', { kind: 'bad' });
      return;
    }
    try {
      const res = await Routing.undo(entry.auditId);
      Storage.patchRecent(entry.id, { undone: true });
      UI.toast((res.notes && res.notes[0]) || 'Undone.', { kind: 'good', duration: 6000 });
      if (res.notes && res.notes.length > 1) setTimeout(() => UI.toast(res.notes.slice(1).join(' '), { duration: 7000 }), 6200);
      if (!currentRoute()[0] || currentRoute()[0] === 'home') renderHome();
    } catch (err) {
      // 409 means either "already undone" or a safety refusal (task has
      // subtasks / was edited since) — the server's message says which.
      if (err.status === 409 && /already undone/i.test(err.serverMessage || '')) {
        Storage.patchRecent(entry.id, { undone: true });
        UI.toast('That was already undone.');
        return;
      }
      UI.toast(err.status === 409 && err.serverMessage ? err.serverMessage : `Couldn’t undo: ${UI.describeError(err).message}`, { kind: 'bad', duration: 9000 });
    }
  }

  /**
   * pickList
   * Searchable picker over every list (synced catalog + configured
   * destinations). Used by "Other list…" on the Review screen.
   * @returns {Promise<{id: string, path: string}|null>} null if dismissed
   */
  function pickList() {
    const catalog = Storage.getCatalog();
    const byId = new Map();
    getRoutableDestinations().forEach(k => byId.set(k.list_id, { id: k.list_id, path: `${k.entity} › ${k.label}`, known: true }));
    ((catalog && catalog.lists) || []).forEach(l => {
      if (ROUTING_EXCLUDED_LIST_IDS.includes(l.id)) return;
      const existing = byId.get(l.id);
      byId.set(l.id, { id: l.id, path: l.path, known: Boolean(existing) });
    });
    const all = [...byId.values()].sort((a, b) => (b.known - a.known) || a.path.localeCompare(b.path));

    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'sheet-backdrop';
      backdrop.innerHTML = `
        <div class="sheet sheet--tall" role="dialog" aria-modal="true" aria-label="Choose a list">
          <div class="sheet-grip"></div>
          <h2 class="sheet-title">Choose a list</h2>
          <input type="search" class="subtask-search" id="pick-search" placeholder="Search ${all.length} lists…" autocomplete="off" aria-label="Search lists">
          <div class="pick-results" id="pick-results"></div>
          ${catalog ? '' : `<p class="hint">Only your configured lists are shown — run Settings → Sync workspace to see every ClickUp list.</p>`}
          <div class="sheet-actions"><button type="button" class="sheet-btn sheet-btn--secondary" id="pick-cancel">Cancel</button></div>
        </div>`;
      const close = (value) => { backdrop.remove(); resolve(value); };
      const results = backdrop.querySelector('#pick-results');
      const draw = (q) => {
        const query = q.trim().toLowerCase();
        const shown = (query ? all.filter(l => l.path.toLowerCase().includes(query)) : all).slice(0, 60);
        results.innerHTML = shown.length
          ? shown.map(l => `<button type="button" class="subtask-result" data-id="${escapeHtml(l.id)}" data-path="${escapeHtml(l.path)}"><span class="subtask-result-name">${escapeHtml(l.path)}</span>${l.known ? `<span class="subtask-result-meta">yours</span>` : ''}</button>`).join('')
          : `<p class="hint">No lists match.</p>`;
        results.querySelectorAll('[data-id]').forEach(b => { b.onclick = () => close({ id: b.dataset.id, path: b.dataset.path }); });
      };
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
      backdrop.querySelector('#pick-cancel').onclick = () => close(null);
      const search = backdrop.querySelector('#pick-search');
      search.oninput = () => draw(search.value);
      document.body.appendChild(backdrop);
      draw('');
      search.focus();
    });
  }

  // ---------------------------------------------------------------
  // Screen: Activity (#/activity) — the audit log
  // ---------------------------------------------------------------
  /**
   * renderActivity
   * Every send from every device (server audit log), newest first, with
   * how it was decided and one-tap Undo (two taps: Undo → Confirm).
   * This device's sends from the last few minutes are merged in from
   * Recent, because KV listings can lag new records by up to a minute.
   */
  async function renderActivity() {
    root.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-nav="back" aria-label="Back">${icon('back')}</button>
        <span class="brand">Activity</span>
        <button class="icon-btn" id="activity-refresh" aria-label="Refresh">${icon('refresh')}</button>
      </header>
      <main class="picker activity">
        <div id="activity-summary"></div>
        <ul class="activity-list" id="activity-list"><li class="hint">Loading…</li></ul>
        <button class="pill-btn pill-btn--block hidden" id="activity-more">Load more</button>
      </main>`;
    bindBack();
    root.querySelector('#activity-refresh').onclick = () => renderActivity();
    const listEl = root.querySelector('#activity-list');
    const moreBtn = root.querySelector('#activity-more');

    const s = Routing.cachedStatus();
    if (s && s.accuracy && s.accuracy.suggested) {
      const a = s.accuracy;
      root.querySelector('#activity-summary').innerHTML = `
        <div class="card stat-card">
          <div><span class="stat-num">${a.pct}%</span><span class="stat-label">suggestions kept</span></div>
          <div><span class="stat-num">${a.auto}</span><span class="stat-label">auto-filed</span></div>
          <div><span class="stat-num">${a.undone}</span><span class="stat-label">undone</span></div>
        </div>`;
    }

    let cursor = null;
    const seen = new Set();
    const load = async (first) => {
      try {
        const page = await Routing.activity(cursor);
        let items = page.items || [];
        if (first) {
          // Fresh local sends not yet visible in the KV listing.
          const fresh = Storage.getRecent()
            .filter(r => r.auditId && Date.now() - r.createdAt < 3 * 60 * 1000 && !items.some(i => i.id === r.auditId))
            .map(r => ({ id: r.auditId, ts: r.createdAt, kind: r.action === 'task' ? 'create_task' : 'add_comment', source: r.routing ? r.routing.source : 'manual', confidence: r.routing ? r.routing.confidence : null, title: r.title, list_path: r.typeLabel, task_url: r.clickupUrl, reversed: Boolean(r.undone), duplicate: r.action === 'update' }));
          items = [...fresh, ...items];
          listEl.innerHTML = '';
        }
        items.filter(i => !seen.has(i.id)).forEach(i => { seen.add(i.id); listEl.insertAdjacentHTML('beforeend', activityItemHtml(i)); });
        if (!listEl.children.length) listEl.innerHTML = `<li class="empty">No activity yet. Sends from every device show up here.</li>`;
        cursor = page.cursor;
        moreBtn.classList.toggle('hidden', !cursor);
        bindActivityButtons(listEl);
      } catch (err) {
        if (first) listEl.innerHTML = '';
        listEl.insertAdjacentHTML('beforeend', `<li class="hint hint--bad">${escapeHtml(UI.describeError(err).message)}</li>`);
      }
    };
    moreBtn.onclick = () => load(false);
    load(true);
  }

  /**
   * activityItemHtml — one audit entry row.
   * @param {object} i - listing item from /audit
   * @returns {string}
   */
  function activityItemHtml(i) {
    const pct = typeof i.confidence === 'number' ? Math.round(i.confidence * 100) : null;
    const src = i.source === 'auto' ? `<span class="badge badge--auto">Auto${pct != null ? ` ${pct}%` : ''}</span>`
      : i.source === 'confirmed' ? `<span class="badge badge--info">Confirmed${pct != null ? ` ${pct}%` : ''}</span>`
      : `<span class="badge badge--muted">Manual</span>`;
    const kind = i.kind === 'add_comment' ? `<span class="badge badge--info">${i.duplicate ? 'Update' : 'Comment'}</span>` : '';
    return `
      <li class="activity-item${i.reversed ? ' activity-item--undone' : ''}" data-id="${escapeHtml(i.id)}">
        <div class="activity-main">
          <span class="activity-title">${escapeHtml(i.title || '(untitled)')}</span>
          <span class="activity-meta">${escapeHtml(i.list_path || '')}${i.moved ? ' · moved by you' : ''} · ${escapeHtml(UI.relativeTime(i.ts))}</span>
          <span class="activity-badges">${src}${kind}${i.reversed ? '<span class="badge badge--muted">Undone</span>' : ''}</span>
        </div>
        <div class="activity-actions">
          ${i.task_url && !i.reversed ? `<a class="icon-btn" href="${escapeHtml(i.task_url)}" target="_blank" rel="noopener" aria-label="Open in ClickUp">${icon('link')}</a>` : ''}
          ${i.reversed ? '' : `<button class="pill-btn pill-btn--small" data-undo="${escapeHtml(i.id)}">Undo</button>`}
        </div>
      </li>`;
  }

  /**
   * bindActivityButtons
   * Two-tap Undo: first tap arms ("Confirm?", 4s), second performs it.
   * Avoids a blocking confirm() while still preventing accidental undos.
   * @param {HTMLElement} listEl
   */
  function bindActivityButtons(listEl) {
    listEl.querySelectorAll('[data-undo]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.onclick = async () => {
        if (!btn.classList.contains('armed')) {
          btn.classList.add('armed');
          btn.textContent = 'Confirm?';
          setTimeout(() => { if (btn.isConnected && btn.classList.contains('armed')) { btn.classList.remove('armed'); btn.textContent = 'Undo'; } }, 4000);
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Undoing…';
        try {
          const res = await Routing.undo(btn.dataset.undo);
          const recent = Storage.getRecent().find(r => r.auditId === btn.dataset.undo);
          if (recent) Storage.patchRecent(recent.id, { undone: true });
          const li = btn.closest('.activity-item');
          li.classList.add('activity-item--undone');
          li.querySelector('.activity-badges').insertAdjacentHTML('beforeend', '<span class="badge badge--muted">Undone</span>');
          btn.remove();
          UI.toast((res.notes || []).join(' ') || 'Undone.', { kind: 'good', duration: 7000 });
        } catch (err) {
          btn.disabled = false;
          btn.classList.remove('armed');
          btn.textContent = 'Undo';
          UI.toast(err.status === 409 && err.serverMessage ? err.serverMessage : `Couldn’t undo: ${UI.describeError(err).message}`, { kind: 'bad', duration: 9000 });
        }
      };
    });
  }

  // ---------------------------------------------------------------
  // Screen: Settings
  // ---------------------------------------------------------------
  /**
   * renderSettings
   * Three sections:
   *   ClickUp connection — live status (re-checked on every open, not
   *     only after the OAuth redirect) + Connect button.
   *   Smart routing — status, auto-file switch/threshold, duplicate
   *     sensitivity, sync, task index, live updates (see
   *     renderRoutingSettings).
   *   This device — proxy URL override (advanced) and "Forget passcode".
   * The ?connected=1 / ?connect_error=... banners from the Worker's
   * OAuth redirect are still shown when present.
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
      <main class="form settings">
        <section class="settings-section">
          <h2 class="section-title">ClickUp</h2>
          <div class="connect-status" id="connect-status">
            ${justConnected ? '<p class="hint hint--good">Just connected to ClickUp ✓</p>' : ''}
            ${connectError ? `<p class="hint hint--bad">Couldn’t connect: ${escapeHtml(connectError)}</p>` : ''}
            <p class="hint" id="live-status">Checking connection…</p>
          </div>
          <div class="btn-row">
            <button class="pill-btn pill-btn--accent" id="connect-btn">${icon('link')} Connect to ClickUp</button>
            <button class="pill-btn" id="test-connection">Re-check</button>
          </div>
          <p class="hint">Opens ClickUp’s own approval screen. The access token is stored on the server, never on this device — connect once and every device works.</p>
        </section>

        <section class="settings-section" id="routing-section">
          <h2 class="section-title">${icon('spark')} Smart routing</h2>
          <div id="routing-body"><p class="hint">Loading…</p></div>
        </section>

        <section class="settings-section">
          <h2 class="section-title">This device</h2>
          <label class="field" for="proxy-url">Proxy Worker URL <span class="field-optional">(advanced)</span>
            <input type="url" id="proxy-url" placeholder="https://your-worker.your-subdomain.workers.dev" value="${escapeHtml(settings.proxyUrl || '')}">
          </label>
          <div class="btn-row">
            <button class="pill-btn" id="save-settings">Save URL</button>
            <button class="pill-btn pill-btn--danger" id="forget-passcode">${icon('lock')} Forget passcode on this device</button>
          </div>
        </section>
      </main>
    `;
    bindBack();

    root.querySelector('#connect-btn').onclick = () => {
      // Full-page navigation — ClickUp shows its own UI; the Worker's
      // redirect brings the browser back here afterwards.
      window.location.href = buildClickUpAuthorizeUrl();
    };
    root.querySelector('#save-settings').onclick = () => {
      Storage.saveSettings({ proxyUrl: root.querySelector('#proxy-url').value.trim() });
      UI.toast('Saved.', { kind: 'good' });
      refreshConnectionStatus();
    };
    root.querySelector('#test-connection').onclick = () => refreshConnectionStatus();
    root.querySelector('#forget-passcode').onclick = async () => {
      const ok = await UI.sheet({
        title: 'Forget the passcode on this device?',
        html: '<p>You’ll need to enter it again to use Dispatch It here. Other devices aren’t affected.</p>',
        actions: [{ label: 'Forget passcode', value: true, kind: 'danger' }, { label: 'Cancel', value: false }]
      });
      if (!ok) return;
      Storage.clearDeviceKey();
      renderLock();
    };

    refreshConnectionStatus();
    renderRoutingSettings();
  }

  /**
   * refreshConnectionStatus
   * Pings /user and shows a plain-language connection line.
   */
  async function refreshConnectionStatus() {
    const el = root.querySelector('#live-status');
    if (!el) return;
    el.textContent = 'Checking connection…';
    el.className = 'hint';
    try {
      const user = await ClickUp.testConnection();
      if (!root.contains(el)) return;
      el.textContent = `Connected as ${user && user.user ? user.user.username : 'ClickUp user'} ✓`;
      el.className = 'hint hint--good';
    } catch (err) {
      if (!root.contains(el)) return;
      el.textContent = UI.describeError(err).message;
      el.className = 'hint hint--bad';
    }
  }

  /**
   * renderRoutingSettings
   * Fills #routing-body from /routing/status: what's set up, freshness,
   * thresholds, and the sync / index / live-update controls. Every
   * control saves immediately (shared across all devices via the
   * Worker) and re-renders this section.
   */
  async function renderRoutingSettings() {
    const body = root.querySelector('#routing-body');
    if (!body) return;
    let s;
    try {
      s = await Routing.status();
    } catch (err) {
      if (root.contains(body)) body.innerHTML = `<p class="hint hint--bad">${escapeHtml(UI.describeError(err).message)}</p>`;
      return;
    }
    if (!root.contains(body)) return;
    if (s.index) Routing.lists().catch(() => {});

    const st = s.settings || {};
    const ago = (ts) => ts ? UI.relativeTime(ts) : 'never';
    const line = (ok, text) => `<li class="status-line status-line--${ok === true ? 'good' : ok === false ? 'bad' : 'warn'}">${text}</li>`;
    const webhook = s.webhook || {};
    const lines = [
      s.gemini.configured
        ? line(true, `Gemini connected · <code>${escapeHtml(s.gemini.model)}</code>`)
        : line(false, 'Gemini not set up — add the <code>GEMINI_API_KEY</code> secret on the Worker (see README → Smart routing).'),
      s.index
        ? line(true, `${s.index.lists} lists in ${s.index.spaces} spaces · synced ${ago(s.index.synced_at)}${s.sync.fields && s.sync.fields.done < s.sync.fields.total ? ` · field names ${s.sync.fields.done}/${s.sync.fields.total}` : ''}`)
        : line(null, 'Workspace not synced yet — tap “Sync workspace”. Until then, routing uses your configured lists only.'),
      !s.vectors.available
        ? line(null, 'Duplicate detection off — the Vectorize index isn’t set up on the Worker.')
        : (s.sync.tasks_indexed_through
          ? line(true, `Task index built${typeof s.vectors.count === 'number' ? ` · ${s.vectors.count.toLocaleString()} open tasks` : ''}`)
          : line(null, 'Task index not built — tap “Build task index” to turn on duplicate detection.')),
      webhook.enabled
        ? line(webhook.health === 'active' || webhook.health === 'unknown', `Live updates ${webhook.health === 'active' ? 'on' : escapeHtml(webhook.health || 'on')}${webhook.fail_count ? ` (${webhook.fail_count} failed deliveries)` : ''}`)
        : line(null, 'Live updates off — changes in ClickUp are picked up every 15 minutes instead.'),
      s.accuracy && s.accuracy.suggested
        ? line(true, `${s.accuracy.pct}% of ${s.accuracy.suggested} suggestions kept · ${s.accuracy.auto} auto-filed · ${s.accuracy.undone} undone`)
        : ''
    ];
    if (s.sync.last_error) lines.push(line(false, `Last sync error (${ago(s.sync.last_error.at)}): ${escapeHtml(s.sync.last_error.message)}`));

    const seg = (id, options, current) => `
      <div class="segmented" id="${id}">
        ${options.map(o => `<button type="button" class="segmented-btn${Math.abs(o.v - current) < 0.001 ? ' active' : ''}" data-v="${o.v}">${o.label}</button>`).join('')}
      </div>`;

    body.innerHTML = `
      <ul class="status-list">${lines.join('')}</ul>
      <div class="toggle-row">
        <span>Auto-file when confident</span>
        <button type="button" class="switch${st.auto_enabled ? ' on' : ''}" role="switch" aria-checked="${Boolean(st.auto_enabled)}" id="auto-toggle" aria-label="Auto-file when confident"><span></span></button>
      </div>
      ${seg('threshold-seg', [{ label: 'Cautious 92%', v: 0.92 }, { label: 'Balanced 85%', v: 0.85 }, { label: 'Bold 75%', v: 0.75 }], st.auto_threshold)}
      <p class="hint">Below the threshold — or whenever a likely duplicate is found — you’re always asked first. Every auto-filed capture can be undone from Activity.</p>
      <div class="field-label">Duplicate check on manual sends</div>
      ${seg('dup-seg', [{ label: 'Strict', v: 0.93 }, { label: 'Normal', v: 0.9 }, { label: 'Loose', v: 0.86 }], st.dup_threshold)}
      <p class="hint">How similar an open task must be before a manual send asks “update this instead?”. Loose catches more, but asks more often.</p>
      <div class="btn-row">
        <button class="pill-btn" id="sync-now">${icon('refresh')} Sync workspace</button>
        <button class="pill-btn" id="build-index"${s.vectors.available && s.gemini.configured ? '' : ' disabled'}>${icon('list')} ${s.sync.tasks_indexed_through ? 'Rebuild' : 'Build'} task index</button>
        <button class="pill-btn" id="webhook-btn">${webhook.enabled && webhook.health !== 'suspended' ? 'Turn off live updates' : (webhook.enabled ? 'Re-enable live updates' : 'Turn on live updates')}</button>
      </div>
      <p class="hint" id="sync-progress" aria-live="polite"></p>
    `;

    root.querySelector('#auto-toggle').onclick = () => saveRoutingSetting({ auto_enabled: !st.auto_enabled });
    root.querySelectorAll('#threshold-seg [data-v]').forEach(b => { b.onclick = () => saveRoutingSetting({ auto_threshold: Number(b.dataset.v) }); });
    root.querySelectorAll('#dup-seg [data-v]').forEach(b => { b.onclick = () => saveRoutingSetting({ dup_threshold: Number(b.dataset.v) }); });

    const progress = root.querySelector('#sync-progress');
    const lockButtons = (on) => root.querySelectorAll('#routing-body .btn-row .pill-btn').forEach(b => { if (on) { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; } else { b.disabled = b.dataset.wasDisabled === '1'; } });

    root.querySelector('#sync-now').onclick = async () => {
      lockButtons(true);
      progress.textContent = 'Syncing workspace…';
      try {
        await Routing.syncNow((r) => {
          if (!root.contains(progress)) return;
          progress.textContent = r.phase === 'hierarchy' ? `Found ${r.lists} lists in ${r.spaces} spaces…`
            : r.phase === 'fields' ? `Reading custom fields… ${r.done}/${r.total}`
            : r.phase === 'tasks' ? `Checking recently changed tasks… (${r.changed || 0})`
            : 'Up to date.';
        });
        await Routing.lists().catch(() => {});
        UI.toast('Workspace synced.', { kind: 'good' });
        renderRoutingSettings();
      } catch (err) {
        lockButtons(false);
        progress.textContent = UI.describeError(err).message;
      }
    };

    root.querySelector('#build-index').onclick = async () => {
      lockButtons(true);
      const cancel = { cancelled: false };
      progress.textContent = 'Reading open tasks from ClickUp…';
      try {
        const res = await Routing.buildTaskIndex((p) => {
          if (!root.contains(progress)) { cancel.cancelled = true; return; }
          progress.textContent = p.waiting
            ? `Gemini rate limit — pausing 20s… (${p.indexed} indexed so far)`
            : `Indexed ${p.indexed} open tasks… (page ${p.page + 1})`;
        }, cancel);
        if (!res.cancelled) UI.toast(`Task index built — ${res.indexed} open tasks.`, { kind: 'good' });
        if (root.contains(progress)) renderRoutingSettings();
      } catch (err) {
        lockButtons(false);
        if (root.contains(progress)) progress.textContent = `Stopped: ${UI.describeError(err).message} (progress so far is kept — tap again to continue).`;
      }
    };

    root.querySelector('#webhook-btn').onclick = async () => {
      const turningOff = webhook.enabled && webhook.health !== 'suspended';
      lockButtons(true);
      progress.textContent = turningOff ? 'Turning off live updates…' : 'Registering with ClickUp…';
      try {
        await Routing.setWebhook(turningOff ? 'disable' : 'enable');
        UI.toast(turningOff ? 'Live updates off.' : 'Live updates on — new lists and task changes sync within seconds.', { kind: 'good' });
        renderRoutingSettings();
      } catch (err) {
        lockButtons(false);
        progress.textContent = UI.describeError(err).message;
      }
    };
  }

  /**
   * saveRoutingSetting — saves one shared setting and refreshes the section.
   * @param {object} patch
   */
  async function saveRoutingSetting(patch) {
    try {
      await Routing.saveSettings(patch);
      renderRoutingSettings();
    } catch (err) {
      UI.toast(`Couldn’t save: ${UI.describeError(err).message}`, { kind: 'bad' });
    }
  }

  // ---------------------------------------------------------------
  // Submit flow (manual path)
  // ---------------------------------------------------------------
  /**
   * collectFields
   * Reads the form's inputs into a plain object (non-empty values only),
   * plus the dynamically-rendered Assignee select.
   * @param {object[]} schema
   * @returns {object}
   */
  function collectFields(schema) {
    const fields = {};
    schema.forEach(f => {
      const el = root.querySelector(`#field-${f.key}`);
      if (el && el.value.trim()) fields[f.key] = el.value.trim();
    });
    const assigneeEl = root.querySelector('#field-assigneeId');
    if (assigneeEl && assigneeEl.value) fields.assigneeId = assigneeEl.value;
    return fields;
  }

  /**
   * submitCapture
   * Validates, optionally checks for a semantic duplicate, sends, and
   * handles every failure kind (see clickup.js header):
   *   rejection        → inline error, nothing queued (retrying the same
   *                      payload can't succeed)
   *   unknown outcome  → queued as maybeSent (checked before re-sending)
   *   network/offline  → queued for automatic retry
   * Add to Accounts is never queued (credentials stay off the device);
   * on a connectivity failure it stays on screen to resend.
   * @param {object} entity
   * @param {object} type
   * @param {object[]} schema
   */
  async function submitCapture(entity, type, schema) {
    stopRecognizer();
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    const errBox = root.querySelector('#form-error');
    UI.clearFormError(errBox);
    const isAccount = type.schema === 'account';

    let action = type.action || 'task';
    let effectiveListId = type.listId;
    // Add to Accounts "Direct to List" flips this submission from a
    // Chat post to a normal task in the account-directory List.
    if (isAccount && type.directListId && state.accountDestination === 'direct') {
      action = 'task';
      effectiveListId = type.directListId;
    }

    const fields = collectFields(schema);
    const requiredMissing = schema.find(f => f.required && !fields[f.key]);
    if (requiredMissing) {
      UI.markFieldError(root.querySelector(`#field-${requiredMissing.key}`), `${requiredMissing.label} is required.`);
      return;
    }
    if (action === 'comment' && !state.parentTaskId) {
      UI.showFormError(errBox, 'Search for and select the task you’re following up on.');
      const search = root.querySelector('#subtask-search');
      if (search) search.focus();
      return;
    }

    // Direct-to-List Add to Accounts: resolve real custom field IDs
    // (prefetched when Direct was selected). A lookup failure doesn't
    // block sending — buildTaskPayload falls back to description text.
    let customFields = [];
    let customFieldKeys = [];
    if (action === 'task' && isAccount) {
      try {
        const mapping = await getAccountFieldMapping(effectiveListId);
        const candidates = {
          adminUsername: fields.adminUsername,
          adminEmail: fields.adminEmail,
          password: fields.password,
          associatedAccount: state.associatedAccountId
        };
        Object.keys(candidates).forEach(key => {
          const match = mapping[key];
          if (!match || !candidates[key]) return;
          // Only associatedAccount is type-gated (see TEXT_LIKE_FIELD_TYPES).
          if (key === 'associatedAccount' && !TEXT_LIKE_FIELD_TYPES.has((match.type || '').toLowerCase())) return;
          customFields.push({ id: match.id, value: candidates[key] });
          customFieldKeys.push(key);
        });
      } catch (err) {
        // Swallow — description fallback covers it.
      }
    }

    const sendBtn = root.querySelector('#send-btn');
    sendBtn.disabled = true;
    sendBtn.innerHTML = `<span class="spinner"></span> Sending…`;
    const resetBtn = () => { if (root.contains(sendBtn)) { sendBtn.disabled = false; sendBtn.textContent = 'Send to ClickUp'; } };

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      entityId: entity.id,
      entityName: entity.name,
      color: entity.color,
      typeId: type.id,
      typeLabel: type.label,
      schema: type.schema,
      listId: effectiveListId,
      channelId: type.channelId || null,
      fields,
      customFields,
      customFieldKeys,
      title: fields.title || fields.name || (action === 'comment' ? 'Follow-up' : '(untitled)'),
      createdAt: Date.now(),
      // Subtask parent (task) or followed-up task (comment).
      parentTaskId: state.parentTaskId || null,
      parentTaskName: state.parentTaskName || null,
      parentTaskUrl: state.parentTaskUrl || null,
      associatedAccountId: state.associatedAccountId || null,
      associatedAccountName: state.associatedAccountName || null
    };

    // Semantic duplicate check (task creates only, not subtasks, not
    // accounts). Fast vector lookup; any failure just skips it.
    if (action === 'task' && !isAccount && !state.parentTaskId && navigator.onLine && Routing.canCheckDuplicates()) {
      const choice = await checkManualDuplicate(fields);
      if (choice === 'cancel') { resetBtn(); return; }
      if (choice && choice.update) {
        entry.action = 'update';
        entry.parentTaskId = choice.update.task_id;
        entry.parentTaskName = choice.update.name;
        entry.parentTaskUrl = choice.update.url;
      }
    }

    try {
      if (!navigator.onLine) throw Object.assign(new Error('OFFLINE'), { network: true, offline: true });
      await performSend(entry, state.attachments);
      Storage.addRecent(sanitizeForRecent(entry));
      Storage.clearDraft();
      recordSend(entry);
      showSuccess(false, entry.action === 'update' ? 'Added as an update to the existing task.' : null);
    } catch (err) {
      // 1. Real rejection: surface it, don't queue.
      if (err.status && err.outcome !== 'unknown') {
        resetBtn();
        UI.showFormError(errBox, err, err.status === 401 || err.status === 403 ? { label: 'Open Settings', onClick: () => go('/settings') } : null);
        return;
      }
      // 2. Credentials never go into the offline queue.
      if (isAccount) {
        resetBtn();
        UI.showFormError(errBox, err.outcome === 'unknown'
          ? `${err.timeout ? 'ClickUp answered too slowly' : 'The connection dropped before ClickUp confirmed'}, so this may or may not have been saved. Account details aren’t stored on this device for safety — check ClickUp before sending again.`
          : 'Couldn’t reach ClickUp. Account details aren’t stored on this device for safety — tap Send again once you’re back online.');
        return;
      }
      // 3. Unknown outcome or connectivity: queue for retry.
      if (err.outcome === 'unknown') entry.maybeSent = true;
      const stored = await queueForRetry(entry);
      if (!stored) {
        resetBtn();
        UI.showFormError(errBox, 'Couldn’t send, and this device is out of space to save it for later (attachments are large). Try again when you have a connection, or remove an attachment.');
        return;
      }
      Storage.clearDraft();
      showSuccess(true, entry.maybeSent ? 'ClickUp didn’t confirm this one. Saved — Dispatch It will check whether it landed before sending again.' : null);
    }
  }

  /**
   * checkManualDuplicate
   * Asks the Worker for open tasks semantically close to this capture;
   * if any clear the owner's threshold, asks what to do.
   * @param {object} fields - collected form fields
   * @returns {Promise<'create'|'cancel'|{update: object}>}
   *   'create' when nothing matched, the check failed, or the owner chose
   *   "Create new anyway".
   */
  async function checkManualDuplicate(fields) {
    let res;
    try {
      res = await Routing.duplicates(fields.title || '', fields.description || '');
    } catch (err) {
      return 'create'; // never block a send on the duplicate check
    }
    const match = res && res.available && res.matches && res.matches[0];
    if (!match) return 'create';
    const others = res.matches.slice(1, 3);
    const choice = await UI.sheet({
      title: 'This might already exist',
      html: `
        <div class="dup-sheet">
          <div class="dup-name">${escapeHtml(match.name)}</div>
          <div class="dup-meta">${escapeHtml(match.list_path || '')}${match.status ? ` · ${escapeHtml(match.status)}` : ''} · ${Math.round(match.similarity * 100)}% similar</div>
          <a class="link-btn" href="${escapeHtml(match.url)}" target="_blank" rel="noopener">View task</a>
          ${others.length ? `<p class="hint">Also similar: ${others.map(o => `“${escapeHtml(truncate(o.name, 40))}”`).join(', ')}</p>` : ''}
        </div>
        <p class="hint">“Add as update” posts your note as a comment on that task instead of creating a copy.</p>`,
      actions: [
        { label: 'Add as update', value: 'update', kind: 'primary' },
        { label: 'Create new anyway', value: 'create' },
        { label: 'Cancel', value: 'cancel' }
      ]
    });
    if (choice === 'update') return { update: match };
    return choice || 'cancel';
  }

  /**
   * performSend
   * The one place a manual (or queued) capture talks to ClickUp,
   * branching on entry.action:
   *   'comment' / 'update' → comment on an existing task (Follow-up, or
   *                          a duplicate turned into an update)
   *   'chat'               → Add to Accounts review channel post
   *   'task' (default)     → create task, then attachments, then logs
   * Sets entry.clickupUrl / taskId / commentId as side effects.
   * @param {object} entry
   * @param {File[]} attachments - passed explicitly so a background retry
   *   can't clobber whatever is on screen
   * @param {{onCreated?: Function}} [hooks] - onCreated(entry) fires the
   *   moment the task/comment exists (before attachments); the queue uses
   *   it to mark the entry so a retry never creates it twice.
   *   entry.createdOk = true skips straight to the follow-up steps.
   * @throws whatever the primary ClickUp call throws (callers decide
   *   queue vs. surface); best-effort follow-ups are swallowed.
   */
  async function performSend(entry, attachments, hooks = {}) {
    if (entry.action === 'comment' || entry.action === 'update') {
      if (!entry.createdOk) {
        const text = entry.action === 'comment' ? entry.fields.note : buildUpdateComment(entry);
        const res = await ClickUp.addComment(entry.parentTaskId, text);
        entry.commentId = res && res.id != null ? String(res.id) : null;
        entry.createdOk = true;
        if (hooks.onCreated) hooks.onCreated(entry);
      }
      entry.clickupUrl = entry.parentTaskUrl || `https://app.clickup.com/t/${entry.parentTaskId}`;
      if (entry.action === 'update' && attachments && attachments.length) {
        for (const file of attachments) await ClickUp.uploadAttachment(entry.parentTaskId, file).catch(() => {});
      }
      ClickUp.logCapture(entry, entry.clickupUrl).catch(() => {});
      return;
    }

    if (entry.action === 'chat') {
      await ClickUp.postToChannel(entry.channelId, formatAccountMessage(entry));
      entry.clickupUrl = `https://app.clickup.com/${WORKSPACE_ID}/chat/r/${entry.channelId}`;
      return; // the chat post IS the log (accounts channel, not the general one)
    }

    // action === 'task'
    if (!entry.createdOk) {
      // A queued capture that timed out / dropped last time may already
      // exist — look before creating it again (v14 duplicate-on-retry fix).
      if (entry.maybeSent) {
        const existing = await ClickUp.findRecentTaskByName(entry.listId, entry.fields.title || entry.fields.name || '', entry.createdAt - 60000).catch(() => null);
        if (existing) {
          entry.taskId = existing.id;
          entry.clickupUrl = existing.url || `https://app.clickup.com/t/${existing.id}`;
          entry.recoveredDuplicate = true;
          return;
        }
      }
      const result = await ClickUp.createTask(entry.listId, entry);
      entry.taskId = result && result.id;
      entry.clickupUrl = (result && result.url) || (entry.taskId ? `https://app.clickup.com/t/${entry.taskId}` : null);
      entry.createdOk = true;
      // Persist "created" before the (possibly long) attachment uploads.
      if (hooks.onCreated) hooks.onCreated(entry);
    }
    if (attachments && attachments.length && entry.taskId) {
      for (const file of attachments) {
        await ClickUp.uploadAttachment(entry.taskId, file).catch(() => {});
      }
    }
    if (entry.clickupUrl) ClickUp.logCapture(entry, entry.clickupUrl).catch(() => {});
    // Add to Accounts, Direct-to-List: also note it in the accounts
    // channel ("already added", not "needs review").
    if (entry.channelId) {
      const note = `✅ **Added directly to list** — ${entry.fields.accountType || ''}\n${entry.title}\n${entry.clickupUrl}`;
      ClickUp.postToChannel(entry.channelId, note).catch(() => {});
    }
  }

  /**
   * buildUpdateComment — comment text when a capture becomes an update
   * on an existing (duplicate) task.
   * @param {object} entry
   * @returns {string}
   */
  function buildUpdateComment(entry) {
    const f = entry.fields || {};
    return [
      `🔁 Update via ${APP_NAME}`,
      f.title || entry.title,
      f.description || '',
      f.dueDate ? `Due date given: ${f.dueDate}` : '',
      f.priority ? `Priority given: ${f.priority}` : ''
    ].filter(Boolean).join('\n\n');
  }

  /**
   * recordSend
   * Best-effort: logs a manual/queued send to the shared Activity history
   * so it can be undone from any device. Add to Accounts review-channel
   * posts aren't recorded (nothing undoable, and nothing sensitive leaves
   * the device for this); Direct-to-List account tasks are recorded by
   * title only (`sensitive`) and never embedded.
   * @param {object} entry
   */
  function recordSend(entry) {
    if (entry.action === 'chat' || entry.recoveredDuplicate) return;
    const isAccount = entry.schema === 'account';
    let body;
    if (entry.action === 'task' && entry.taskId) {
      body = {
        kind: 'create_task', task_id: entry.taskId, task_url: entry.clickupUrl, list_id: entry.listId,
        list_path: `${entry.entityName} › ${entry.typeLabel}`, title: entry.title,
        text: isAccount ? '' : (entry.fields.description || ''), sensitive: isAccount
      };
    } else if ((entry.action === 'comment' || entry.action === 'update') && entry.commentId) {
      body = {
        kind: 'add_comment', task_id: entry.parentTaskId, task_url: entry.clickupUrl, comment_id: entry.commentId,
        list_path: entry.parentTaskName ? `On: ${entry.parentTaskName}` : '', title: entry.action === 'comment' ? `Follow-up: ${truncate(entry.fields.note || '', 80)}` : entry.title
      };
    }
    if (!body) return;
    Routing.record(body).then(r => {
      if (r && r.audit_id) Storage.patchRecent(entry.id, { auditId: r.audit_id });
    }).catch(() => { /* Activity is a convenience; never fail a send over it */ });
  }

  /**
   * formatAccountMessage
   * Markdown message for "Add to Accounts" (review channel). Password is
   * included as plain text — same as typing it into ClickUp Chat.
   * @param {object} entry - full entry (Associated Account lives outside .fields)
   * @returns {string}
   */
  function formatAccountMessage(entry) {
    const fields = entry.fields;
    const lines = [
      `🔑 **New Account** — ${fields.accountType || ''}`,
      fields.title || ''
    ];
    if (fields.adminUsername) lines.push(`Username: ${fields.adminUsername}`);
    if (fields.adminEmail) lines.push(`Email: ${fields.adminEmail}`);
    if (fields.password) lines.push(`Password: ${fields.password}`);
    if (entry.associatedAccountName) lines.push(`Associated Client Account: ${entry.associatedAccountName}`);
    if (fields.notes) lines.push(`Notes: ${fields.notes}`);
    return lines.join('\n');
  }

  /**
   * sanitizeForRecent
   * Copy of an entry safe for the local Recent log: strips the password
   * (fields.password and the matching customFields value) and account
   * notes (may hold recovery codes).
   * @param {object} entry
   * @returns {object}
   */
  function sanitizeForRecent(entry) {
    if (entry.schema !== 'account' && !(entry.fields && entry.fields.password)) return entry;
    const clone = { ...entry, fields: { ...entry.fields } };
    delete clone.fields.password;
    delete clone.fields.notes;
    const idx = (entry.customFieldKeys || []).indexOf('password');
    if (idx > -1) {
      const passwordFieldId = entry.customFields[idx].id;
      clone.customFields = (entry.customFields || []).filter(cf => cf.id !== passwordFieldId);
    }
    return clone;
  }

  /**
   * queueForRetry
   * Saves a capture locally (attachments as base64) for automatic resend.
   * Never called for Add to Accounts (v14) — credentials stay off disk.
   * @param {object} entry
   * @returns {Promise<boolean>} false if the device refused to store it
   */
  async function queueForRetry(entry) {
    entry.pendingAttachments = await Promise.all(state.attachments.map(fileToDataUrl));
    return Storage.enqueue(entry);
  }

  /** fileToDataUrl — File → {name, type, dataUrl} for the queue. */
  function fileToDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
      reader.readAsDataURL(file);
    });
  }

  /** dataUrlToFile — inverse of fileToDataUrl, for retries. */
  function dataUrlToFile({ name, type, dataUrl }) {
    const [, base64] = dataUrl.split(',');
    const bytes = atob(base64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new File([arr], name, { type });
  }

  // Guards against two overlapping queue runs (e.g. 'online' event firing
  // while Home's own processQueue call is mid-flight) sending twice.
  let queueRunning = false;

  /**
   * processQueue
   * Retries every queued entry:
   *   - permanently rejected (400/404/413/422, FIELD_ errors) → removed
   *     + toast (can't succeed); temporary HTTP errors (401/403/429/5xx)
   *     stay queued
   *   - connectivity failure → stop for now; next 'online'/open retries
   *   - entries marked createdOk skip creation (see performSend hooks)
   *   - maybeSent entries are checked before re-creating (performSend)
   * @param {boolean} manual - "Retry now" tapped (reports failures)
   */
  async function processQueue(manual) {
    if (queueRunning) return;
    const settings = Storage.getSettings();
    if (!settings.proxyUrl) return;
    if (!navigator.onLine) {
      if (manual) UI.toast('Still offline — will retry automatically when you’re back.', { kind: 'bad' });
      return;
    }
    const queue = Storage.getQueue();
    if (!queue.length) return;

    queueRunning = true;
    let sent = 0;
    try {
      for (const entry of queue) {
        try {
          const attachments = (entry.pendingAttachments || []).map(dataUrlToFile);
          await performSend(entry, attachments, {
            onCreated: (e) => Storage.patchQueue(e.id, { createdOk: true, taskId: e.taskId || null, commentId: e.commentId || null, clickupUrl: e.clickupUrl || null, maybeSent: false })
          });
          Storage.removeFromQueue(entry.id);
          const clean = sanitizeForRecent({ ...entry, pendingAttachments: undefined });
          Storage.addRecent(clean);
          recordSend(entry);
          sent++;
        } catch (e) {
          if (e.status && e.outcome !== 'unknown') {
            // Only errors that will fail the same way forever drop the
            // capture. Outages (5xx), rate limits (429) and auth problems
            // (401/403 — fixable in Settings) keep it queued: before the
            // v14 review these discarded captures on a temporary glitch.
            const permanent = [400, 404, 413, 422].includes(e.status) || /^FIELD_/.test(e.code || '');
            if (permanent) {
              Storage.removeFromQueue(entry.id);
              UI.toast(`A queued capture (“${truncate(entry.title, 40)}”) was rejected by ClickUp and removed — you’ll need to redo it. ${UI.describeError(e).message}`, { kind: 'bad', duration: 10000 });
              continue;
            }
            if (manual) UI.toast(`Couldn’t send queued captures yet: ${UI.describeError(e).message}`, { kind: 'bad', duration: 7000 });
            break;
          }
          if (e.outcome === 'unknown') {
            // Mark so the next attempt checks before re-creating.
            entry.maybeSent = true;
            Storage.removeFromQueue(entry.id);
            Storage.enqueue(entry);
          }
          if (manual) UI.toast('Still can’t reach ClickUp. Will keep retrying automatically.', { kind: 'bad' });
          break;
        }
      }
    } finally {
      queueRunning = false;
    }
    if (sent) UI.toast(`Sent ${sent} queued capture${sent > 1 ? 's' : ''}.`, { kind: 'good' });
    if (!currentRoute()[0] || currentRoute()[0] === 'home') renderHome();
  }

  /**
   * showSuccess
   * Brief confirmation screen, then back to Home.
   * @param {boolean} queued - saved for later rather than sent
   * @param {string} [message] - overrides the default line
   */
  function showSuccess(queued, message) {
    UI.vibrate(queued ? [10, 60, 10] : 12);
    root.innerHTML = `
      <main class="success" role="status">
        <div class="success-mark${queued ? ' success-mark--queued' : ''}">${icon(queued ? 'clock' : 'check-big')}</div>
        <p class="success-text">${escapeHtml(message || (queued ? 'Saved. It’ll send once you’re back online.' : 'Sent to ClickUp.'))}</p>
      </main>
    `;
    clearTimeout(successTimer);
    successTimer = setTimeout(() => {
      // Only if the success screen is still what's showing.
      if (root.querySelector('.success')) go('/home');
    }, queued ? 1800 : 1100);
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  /** bindBack — wires the topbar back button (history, else Home). */
  function bindBack() {
    const btn = root.querySelector('[data-nav="back"]');
    if (btn) btn.onclick = () => history.length > 1 ? history.back() : go('/home');
  }

  /** escapeHtml — HTML-escapes user/ClickUp text before interpolation. */
  function escapeHtml(str) {
    return UI.escape(str);
  }

  /** truncate — shortens text to n characters with an ellipsis. */
  function truncate(str, n) {
    str = String(str || '');
    return str.length > n ? `${str.slice(0, n - 1)}…` : str;
  }

  /** lastSegment — "Space › Folder › List" → "List". */
  function lastSegment(path) {
    const parts = String(path || '').split(' › ');
    return parts[parts.length - 1] || path || '';
  }

  // Inline SVG icon paths (24×24, stroke-based, currentColor).
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
    nest: '<path d="M7 3v10a4 4 0 004 4h6"/><path d="M13 13l4 4-4 4"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
    bell: '<path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.5 12.5L20 3"/><path d="M17 6l3 3"/><path d="M14 9l3 3"/>',
    // v14 additions
    spark: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>'
  };
  /** icon — inline SVG for a named icon (unknown names render empty). */
  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  /**
   * init — app entry point (DOMContentLoaded).
   * Gates entry behind the device passcode (a convenience gate — the
   * Worker re-checks it on every request regardless).
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
   * Passcode entry screen. Uses a normal text keyboard (v14): the old
   * numeric keypad made non-numeric passcodes impossible to type on
   * phones. autocomplete="current-password" lets password managers fill it.
   * @param {string} [errorMsg]
   */
  function renderLock(errorMsg) {
    root.innerHTML = `
      <main class="lock">
        <div class="lock-mark">${icon('lock')}</div>
        <h1 class="lock-title">${escapeHtml(APP_NAME)}</h1>
        <p class="lock-sub">Enter the passcode to continue.</p>
        <input type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" id="lock-input" class="lock-input" placeholder="Passcode" aria-label="Passcode">
        ${errorMsg ? `<p class="lock-error" role="alert">${escapeHtml(errorMsg)}</p>` : ''}
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
   * Verifies a passcode against the Worker before remembering it.
   *   403 → wrong: forget it, show error
   *   401 → right passcode, ClickUp not connected yet: let them in
   *   network failure → let them in (the Worker re-validates every
   *     request anyway, so this is not a security gap)
   * @param {string} candidate
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
