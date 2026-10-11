/**
 * =========================================================================
 * clickup.js — thin wrapper around the ClickUp API (via the Worker proxy)
 * =========================================================================
 * PURPOSE
 *   Every network call Dispatch It makes to "ClickUp" actually goes to the
 *   Cloudflare Worker proxy (see /worker/clickup-proxy.js), never to
 *   api.clickup.com directly — see that file's header comment for why
 *   (CORS + credential custody). This file just shapes requests/
 *   responses for the rest of the app.
 *
 * DATA FLOW
 *   app.js calls createTask()/uploadAttachment()/testConnection() →
 *   this file builds the request (adding the device passcode header) →
 *   Worker validates the passcode, attaches the real ClickUp OAuth
 *   token server-side, forwards to ClickUp, relays the response back.
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   - Requires Storage (storage.js) to be loaded first, for the proxy
 *     URL and device passcode.
 *   - Every function here can throw. Since v10 all calls go through
 *     request(), which normalizes failures into three kinds callers can
 *     branch on without parsing text:
 *       err.status set, no err.outcome → a real rejection (403 wrong
 *         passcode, 401 not connected, 400 bad field, ...). Retrying
 *         the same payload won't help.
 *       err.outcome === 'unknown'       → timed out AFTER sending a
 *         write; ClickUp may or may not have created it. Queue it, but
 *         check before re-sending (see app.js processQueue).
 *       err.network === true, no status → never reached the Worker
 *         (offline / DNS / Worker down). Safe to queue and retry.
 *     Rejections also carry err.code (ClickUp ECODE or the Worker's
 *     code) and err.serverMessage for friendly display (ui.js).
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-07-23  Initial implementation: createTask, uploadAttachment,
 *                    testConnection, all unauthenticated from the
 *                    browser's side (Worker held the ClickUp token).
 *   v2  2026-07-24  Added a device passcode header (X-Dispatch-Key) to
 *                    every request, now that the Worker enforces one
 *                    (see clickup-proxy.js v3) — without it, anyone who
 *                    found the app's URL could create tasks in the
 *                    owner's ClickUp with no login at all. Added
 *                    start_date mapping in buildTaskPayload() for the
 *                    new "Start date" field. Thrown errors now carry a
 *                    `.status` so app.js's passcode lock screen can
 *                    tell "wrong passcode" (403) apart from "ClickUp
 *                    not connected yet" (401) and react differently.
 *   v3  2026-07-25  Three additions:
 *                    (1) getListMembers() — powers the assignee
 *                        dropdown on Task-type forms.
 *                    (2) logCapture() — posts a short activity message
 *                        to a ClickUp Chat channel after a capture
 *                        sends (best-effort; caller in app.js swallows
 *                        failures the same way attachment upload
 *                        failures are swallowed).
 *                    (3) buildTaskPayload() now also assigns
 *                        entry.fields.assigneeId when present.
 *   v4  2026-07-25  Added getListTasks() and getTaskById() for the
 *                    "make this a subtask of an existing task" search
 *                    (see app.js loadParentTaskOptions()), and a
 *                    parent mapping in buildTaskPayload(). ClickUp
 *                    requires (a) the parent to live in the exact same
 *                    List as the new task, and (b) the parent to not
 *                    itself already be a subtask — both are enforced
 *                    by how getListTasks() scopes and filters its
 *                    results, not by any check in buildTaskPayload().
 *   v5  2026-07-25  logCapture()'s Chat message now includes a
 *                    "↳ Subtask of: <parent name>" line when the
 *                    capture was nested under an existing task —
 *                    previously a subtask logged identically to a
 *                    top-level task, losing that context in the feed.
 *   v6  2026-07-26  Three additions:
 *                    (1) capitalizeWords() + applied to the task title
 *                        in buildTaskPayload() — cosmetic-only, only
 *                        ever uppercases (never lowercases), so
 *                        acronyms typed correctly (F5, CEO, AWS) are
 *                        never mangled.
 *                    (2) addComment() — posts a comment on an existing
 *                        task, the mechanism behind "Follow-up /
 *                        Reminder" (no task created).
 *                    (3) postToChannel() — posts to a specific Chat
 *                        channel (vs logCapture()'s fixed default),
 *                        the mechanism behind "Add to Accounts". Note:
 *                        account-type captures include a password
 *                        field passed straight through to this
 *                        function — it is sent as plain text in the
 *                        Chat message body, same as ClickUp Chat
 *                        always works; see app.js for what's done (and
 *                        NOT done, i.e. never persisted locally) with
 *                        that field client-side.
 *   v7  2026-07-28  buildTaskPayload() now also folds account-specific
 *                    fields (accountType, adminUsername, adminEmail,
 *                    password, notes) into the task description — used
 *                    when "Add to Accounts" is routed directly to a
 *                    List instead of Chat (new destination toggle, see
 *                    app.js). Same plaintext-password trade-off as the
 *                    Chat-message path, just in a task description.
 *   v8  2026-08-07  Added getListFields() — looks up a List's real
 *                    ClickUp custom field IDs. buildTaskPayload() now
 *                    passes through entry.customFields (pre-resolved
 *                    by app.js via name-matching) as payload.
 *                    custom_fields, and skips re-dumping
 *                    adminUsername/adminEmail/password into the plain
 *                    description for whichever ones successfully
 *                    resolved to a real field — avoids the password
 *                    ending up duplicated in two places on one task.
 *   v9  2026-08-08  buildTaskPayload() now always writes a readable
 *                    "Associated Client Account: <name> (<id>)" line
 *                    into the description when entry.associatedAccountName
 *                    is set (new autocomplete field, see app.js) — on
 *                    top of whatever gets attempted via the real
 *                    custom field. Deliberately NOT skipped even when
 *                    the structured field resolves, unlike the other
 *                    account fields: ClickUp's API has a known rough
 *                    edge setting Relationship/Tasks-type custom field
 *                    values via Create Task (community-reported
 *                    silent no-ops), and this field's real type isn't
 *                    reliably knowable in advance — the description
 *                    line is a guaranteed-visible fallback regardless
 *                    of whether the structured write actually took.
 *   v10 2026-10-10  Hardening + smart routing support:
 *                    (1) request() — one fetch wrapper for every call:
 *                        timeouts (none of the calls had one; a stalled
 *                        connection could leave Send spinning forever),
 *                        and the three-way error classification above.
 *                    (2) Date fix: date fields were sent as
 *                        new Date('YYYY-MM-DD') = midnight UTC, which is
 *                        the PREVIOUS evening in US time zones, so dates
 *                        could show a day early in ClickUp. Now sent as
 *                        local noon (localDateToMs), which lands on the
 *                        intended calendar day in any time zone.
 *                    (3) buildTaskPayload exported (smart captures build
 *                        their payload here too, then send it via the
 *                        Worker's /route/commit).
 *                    (4) addComment returns ClickUp's comment id (needed
 *                        so a follow-up can be undone from Activity).
 *                    (5) getTeamTasksPage() for the task-index backfill;
 *                        findRecentTaskByName() so a capture that timed
 *                        out mid-send isn't created twice on retry.
 *                    (6) logCapture() notes how a capture was routed
 *                        ("Auto-filed · 92%") and labels "update" sends.
 *                    (7) Review fixes: a write that drops mid-flight while
 *                        online is flagged outcome 'unknown' (not just
 *                        timeouts), and findRecentTaskByName uses the
 *                        workspace filter (subtasks included, not capped
 *                        at the list's first 100 tasks).
 *                    (8) Removed duplicated/misplaced doc comments
 *                        (logCapture's was in twice; buildTaskPayload's
 *                        sat above capitalizeWords).
 * =========================================================================
 */


const ClickUp = (() => {
  /**
   * proxyUrl — reads the configured Worker URL from Storage, throws
   * clearly if somehow unset (shouldn't happen given DEFAULT_PROXY_URL,
   * but guards against a corrupted/cleared localStorage).
   */
  function proxyUrl() {
    const url = Storage.getSettings().proxyUrl;
    if (!url) throw new Error('NO_PROXY_URL');
    return url.replace(/\/$/, '');
  }

  /**
   * authHeaders — every proxied request needs the device passcode so
   * the Worker can verify this is an authorized device. See
   * clickup-proxy.js checkPasscode() for the server-side half.
   */
  function authHeaders() {
    return { 'X-Dispatch-Key': Storage.getDeviceKey() || '' };
  }

  // ClickUp's priority field is a 1-4 integer, not the friendly labels
  // shown in the UI. 1 is most urgent (ClickUp's convention).
  const PRIORITY_MAP = { Urgent: 1, High: 2, Normal: 3, Low: 4 };

  /**
   * apiError — builds an Error with a `.status` property attached, so
   * callers can branch on HTTP status without string-matching.
   * @param {string} message
   * @param {number} status
   * @returns {Error}
   */
  function apiError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
  }

  /**
   * request
   * The single fetch wrapper behind every call in this file (and
   * routing.js). Adds the passcode header, a timeout, JSON handling and
   * the error classification described in the file header.
   * @param {string} path - Worker path beginning with "/"
   * @param {object} [opts]
   * @param {string} [opts.method='GET']
   * @param {*} [opts.json] - body to send as JSON
   * @param {FormData} [opts.form] - multipart body (attachments)
   * @param {number} [opts.timeoutMs=20000] - 0 disables the timeout
   *   (attachment uploads: a 90MB file on a slow link is legitimately slow)
   * @returns {Promise<object|null>} parsed JSON, or null for empty bodies
   * @throws Error — see the file header for the three kinds
   */
  async function request(path, { method = 'GET', json, form, timeoutMs = 20000 } = {}) {
    const headers = { ...authHeaders() };
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    const controller = timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    // Captured BEFORE sending: a write that fails while the device was
    // online may have reached the server before the connection dropped.
    const wasOnline = typeof navigator === 'undefined' || navigator.onLine !== false;

    let res;
    try {
      res = await fetch(`${proxyUrl()}${path}`, { method, headers, body, signal: controller ? controller.signal : undefined });
    } catch (e) {
      // Never got an HTTP response at all.
      const timedOut = e && e.name === 'AbortError';
      const err = new Error(timedOut ? 'TIMEOUT' : 'NETWORK');
      err.network = true;
      if (timedOut) err.timeout = true;
      // A write that timed out — or dropped mid-flight while online (a
      // phone switching from Wi-Fi to cellular) — may still have happened
      // server-side. Flag it so callers check before re-sending.
      if (method !== 'GET' && (timedOut || wasOnline)) err.outcome = 'unknown';
      if (typeof navigator !== 'undefined' && navigator.onLine === false) err.offline = true;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }

    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) {
      const err = apiError(`HTTP_${res.status}: ${text.slice(0, 500)}`, res.status);
      err.code = (data && (data.code || data.ECODE)) || null;
      err.serverMessage = (data && (data.error || data.err)) || null;
      err.body = text.slice(0, 2000);
      // Worker-side timeout talking to ClickUp: outcome unknown, NOT a
      // rejection — callers queue it with a "check first" flag.
      if (res.status === 504 && data && data.outcome === 'unknown') {
        err.outcome = 'unknown';
        err.timeout = true;
      }
      throw err;
    }
    return data;
  }

  /**
   * capitalizeWords
   * Cosmetic-only title formatting: uppercases the first letter of each
   * word, never lowercases — "F5 CEO" stays, "aws project" → "Aws Project".
   * @param {string} str
   * @returns {string}
   */
  function capitalizeWords(str) {
    return str.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
  }

  /**
   * localDateToMs
   * Converts a date-input value ("YYYY-MM-DD") to a timestamp at NOON
   * local time. Noon (not midnight) keeps the calendar day stable when
   * ClickUp renders it in any time zone within ±11h — the v10 fix for
   * dates showing a day early. Returns null for anything malformed.
   * @param {string} ymd
   * @returns {number|null}
   */
  function localDateToMs(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }

  /**
   * buildTaskPayload
   * Converts a capture `entry` into the JSON body ClickUp's "Create Task"
   * endpoint expects. Used by the manual path (createTask) and the smart
   * path (app.js → Routing.commit).
   * @param {object} entry - { fields, transcript?, customFields?, ... }
   * @returns {object} ClickUp task payload
   * Edge cases: absent fields are omitted rather than sent as null/empty,
   * since ClickUp treats an omitted key differently from an explicit
   * empty value for some fields (e.g. due_date).
   */
  function buildTaskPayload(entry) {
    const payload = { name: capitalizeWords(entry.fields.title || entry.fields.name || '(untitled)') };

    const descriptionParts = [];
    if (entry.fields.description) descriptionParts.push(entry.fields.description);
    if (entry.fields.company) descriptionParts.push(`Company: ${entry.fields.company}`);
    if (entry.fields.contactMethod) descriptionParts.push(`Best contact method: ${entry.fields.contactMethod}`);
    if (entry.fields.opportunity) descriptionParts.push(`Opportunity: ${entry.fields.opportunity}`);
    // "Add to Accounts" fields (Direct-to-List path). Admin Username/
    // Email/Password go into real custom fields when a match was found
    // (entry.customFields, resolved in app.js) — only fall back to the
    // description for whichever ones DIDN'T resolve, so the password
    // never ends up duplicated in two places on one task.
    const resolvedKeys = new Set((entry.customFieldKeys || []));
    if (entry.fields.accountType) descriptionParts.push(`Account Type: ${entry.fields.accountType}`);
    if (entry.fields.adminUsername && !resolvedKeys.has('adminUsername')) descriptionParts.push(`Admin Username: ${entry.fields.adminUsername}`);
    if (entry.fields.adminEmail && !resolvedKeys.has('adminEmail')) descriptionParts.push(`Admin Email: ${entry.fields.adminEmail}`);
    if (entry.fields.password && !resolvedKeys.has('password')) descriptionParts.push(`Password: ${entry.fields.password}`);
    if (entry.fields.notes) descriptionParts.push(`Notes: ${entry.fields.notes}`);
    // Associated Account: ALWAYS written here too — the structured
    // custom-field write can silently no-op for some field types, so this
    // line guarantees the link is visible either way (see v9).
    if (entry.associatedAccountName) {
      descriptionParts.push(`Associated Client Account: ${entry.associatedAccountName}${entry.associatedAccountId ? ` (${entry.associatedAccountId})` : ''}`);
    }
    if (entry.transcript) descriptionParts.push(`\n— Voice transcript —\n${entry.transcript}`);
    // Smart captures sign their work so it's obvious in ClickUp how a
    // task got there (and with what confidence).
    if (entry.routingFooter) descriptionParts.push(entry.routingFooter);
    if (descriptionParts.length) payload.description = descriptionParts.join('\n\n');

    if (entry.fields.priority && PRIORITY_MAP[entry.fields.priority]) {
      payload.priority = PRIORITY_MAP[entry.fields.priority];
    }
    // Start/Due: plain dates (no time of day) — see localDateToMs for
    // why they're sent as local noon.
    const start = localDateToMs(entry.fields.startDate);
    if (start) {
      payload.start_date = start;
      payload.start_date_time = false;
    }
    const due = localDateToMs(entry.fields.dueDate);
    if (due) {
      payload.due_date = due;
      payload.due_date_time = false;
    }
    if (entry.fields.tags) {
      payload.tags = entry.fields.tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    // Assignee comes from a list-specific dropdown (not a schema field).
    if (entry.fields.assigneeId) {
      payload.assignees = [Number(entry.fields.assigneeId)];
    }
    // Subtask nesting: parent must live in the same List and not itself
    // be a subtask — enforced by how app.js scopes the search.
    if (entry.parentTaskId) {
      payload.parent = entry.parentTaskId;
    }
    // Custom fields resolved ahead of time by app.js (Add to Accounts).
    if (entry.customFields && entry.customFields.length) {
      payload.custom_fields = entry.customFields;
    }
    return payload;
  }

  /**
   * createTask
   * Creates a task in the given List via the Worker proxy.
   * @param {string} listId
   * @param {object} entry - capture entry (see buildTaskPayload)
   * @returns {Promise<object>} the created ClickUp task
   * @throws see request(); a 40s client timeout sits above the Worker's
   *   own 25s upstream timeout so the Worker's clearer 504 usually wins.
   */
  function createTask(listId, entry) {
    return request(`/list/${listId}/task`, { method: 'POST', json: buildTaskPayload(entry), timeoutMs: 40000 });
  }

  /**
   * uploadAttachment
   * Attaches a file to an existing task (no timeout — large files).
   * @param {string} taskId
   * @param {File} file
   * @returns {Promise<object>}
   * Note: callers swallow failures per attachment — a failed attachment
   * shouldn't undo an otherwise successful capture.
   */
  function uploadAttachment(taskId, file) {
    const form = new FormData();
    form.append('attachment', file, file.name);
    return request(`/task/${taskId}/attachment`, { method: 'POST', form, timeoutMs: 0 });
  }

  /**
   * testConnection
   * Used by the lock screen (verify a passcode) and Settings (live
   * connection status).
   * @returns {Promise<object>} ClickUp's /user response
   * @throws 403 bad passcode, 401 not connected, network errors
   */
  function testConnection() {
    return request('/user', { timeoutMs: 15000 });
  }

  /**
   * getListMembers — people who can be assigned in a List.
   * @param {string} listId
   * @returns {Promise<Array<{id:number, username:string}>>}
   */
  async function getListMembers(listId) {
    const data = await request(`/list/${listId}/member`);
    return (data && data.members) || [];
  }

  /**
   * logCapture
   * Posts a short Markdown activity message to the default Chat channel
   * after a successful send. Best-effort: callers .catch() and ignore.
   * @param {object} entry - the capture entry
   * @param {string} taskUrl - the relevant ClickUp URL
   * @returns {Promise<object>}
   * Wording branches on entry.action so the log is honest about what
   * happened: new task, follow-up comment, or "update" added to an
   * existing task by duplicate detection.
   */
  function logCapture(entry, taskUrl) {
    let lines;
    if (entry.action === 'comment' || entry.action === 'update') {
      lines = [
        entry.action === 'update' ? `🔁 **Update added** — ${entry.entityName}` : `💬 **Follow-up** — ${entry.entityName}`,
        entry.fields && (entry.fields.note || entry.fields.description) ? (entry.fields.note || entry.fields.description) : entry.title,
        `On: ${entry.parentTaskName || 'existing task'}`
      ];
    } else {
      lines = [`📥 **New ${entry.typeLabel}** — ${entry.entityName}`, entry.title];
      if (entry.parentTaskId && entry.parentTaskName) {
        lines.push(`↳ Subtask of: ${entry.parentTaskName}`);
      }
    }
    if (entry.routing && typeof entry.routing.confidence === 'number') {
      const pct = Math.round(entry.routing.confidence * 100);
      lines.push(`🧭 ${entry.routing.source === 'auto' ? 'Auto-filed' : 'Routed'} by ${APP_NAME} · ${pct}%${entry.routing.moved ? ' · destination changed by you' : ''}`);
    }
    lines.push(taskUrl);
    return request('/log/chat', { method: 'POST', json: { content: lines.join('\n') }, timeoutMs: 15000 });
  }

  /**
   * getListTasks
   * First page (≤100) of a List's tasks, open + closed — powers the
   * subtask/follow-up search and the Associated Account autocomplete.
   * ClickUp has no name-search endpoint, so the app filters client-side.
   * @param {string} listId
   * @returns {Promise<Array<object>>}
   * Edge case: lists with 100+ tasks only return the first page;
   * getTaskById() is the paste-an-ID fallback.
   */
  async function getListTasks(listId) {
    const data = await request(`/list/${listId}/task?include_closed=true`);
    return (data && data.tasks) || [];
  }

  /**
   * getTaskById
   * @param {string} taskId
   * @returns {Promise<object|null>} the task, or null on 404 (a mistyped
   *   ID is a normal outcome, not an error)
   */
  async function getTaskById(taskId) {
    try {
      return await request(`/task/${taskId}`);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * addComment
   * Adds a comment to an existing task — Follow-up / Reminder, and
   * manual "add as update" from duplicate detection.
   * @param {string} taskId
   * @param {string} commentText - plain text
   * @returns {Promise<{id: (number|string)}>} includes ClickUp's comment
   *   id, which Activity needs to undo it
   */
  function addComment(taskId, commentText) {
    return request(`/task/${taskId}/comment`, { method: 'POST', json: { comment_text: commentText }, timeoutMs: 30000 });
  }

  /**
   * postToChannel
   * Posts to a specific Chat channel (Add to Accounts). Same Worker route
   * as logCapture, with an explicit channel_id.
   * @param {string} channelId
   * @param {string} content - Markdown
   * @returns {Promise<object>}
   */
  function postToChannel(channelId, content) {
    return request('/log/chat', { method: 'POST', json: { content, channel_id: channelId }, timeoutMs: 20000 });
  }

  /**
   * getListFields — a List's custom field definitions.
   * @param {string} listId
   * @returns {Promise<Array<{id:string, name:string, type:string}>>}
   */
  async function getListFields(listId) {
    const data = await request(`/list/${listId}/field`);
    return (data && data.fields) || [];
  }

  /**
   * getTeamTasksPage
   * One page (≤100) of OPEN tasks across the whole workspace, subtasks
   * included — used by Settings → Build task index. The Worker streams
   * these pages through without parsing them (see Worker v8 notes).
   * @param {number} page - 0-based
   * @returns {Promise<{tasks: object[], last_page?: boolean}>}
   */
  async function getTeamTasksPage(page) {
    const data = await request(`/team/${WORKSPACE_ID}/task?page=${page}&subtasks=true&include_closed=false`, { timeoutMs: 30000 });
    return data || { tasks: [] };
  }

  /**
   * findRecentTaskByName
   * "Did that timed-out create actually go through?" — looks for a task
   * in the list with the same (capitalized) name created at/after
   * `sinceMs`. Used before re-sending a queued capture flagged
   * maybeSent, so a slow ClickUp never produces a duplicate.
   * @param {string} listId
   * @param {string} title - the capture title as typed
   * @param {number} sinceMs
   * @returns {Promise<object|null>} the matching task, if any
   */
  async function findRecentTaskByName(listId, title, sinceMs) {
    const want = capitalizeWords(String(title || '')).trim().toLowerCase();
    // Workspace task filter, narrowed to this list and to tasks created
    // since the capture — subtasks included (a timed-out SUBTASK must be
    // found too), and not limited to the list's first 100 tasks.
    const q = `list_ids%5B%5D=${encodeURIComponent(listId)}&date_created_gt=${Math.max(0, Math.floor(sinceMs))}&subtasks=true&include_closed=true`;
    const data = await request(`/team/${WORKSPACE_ID}/task?${q}`, { timeoutMs: 20000 });
    return ((data && data.tasks) || []).find(t => String(t.name || '').trim().toLowerCase() === want) || null;
  }

  return {
    request, buildTaskPayload, localDateToMs,
    createTask, uploadAttachment, testConnection, getListMembers, logCapture,
    getListTasks, getTaskById, addComment, postToChannel, getListFields,
    getTeamTasksPage, findRecentTaskByName
  };
})();
