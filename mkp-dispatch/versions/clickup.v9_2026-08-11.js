/**
 * =========================================================================
 * clickup.js — thin wrapper around the ClickUp API (via the Worker proxy)
 * =========================================================================
 * PURPOSE
 *   Every network call Dispatch makes to "ClickUp" actually goes to the
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
 *   - Every function here can throw. Callers should expect network
 *     failures (offline, Worker down) as well as explicit rejections
 *     (wrong passcode → 403, ClickUp not connected yet → 401).
 *     Thrown Errors carry a `.status` property with the HTTP status
 *     code where available, so callers can distinguish failure kinds
 *     without parsing message text.
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
   * the Worker can verify this is an authorized device before it'll
   * touch ClickUp on the owner's behalf. See clickup-proxy.js's
   * checkPasscode() for the server-side half of this.
   */
  function authHeaders() {
    return { 'X-Dispatch-Key': Storage.getDeviceKey() || '' };
  }

  // ClickUp's priority field is a 1-4 integer, not the friendly labels
  // shown in the UI — this maps one to the other. Order matters: 1 is
  // most urgent, matching ClickUp's own convention (not "1 = low").
  const PRIORITY_MAP = { Urgent: 1, High: 2, Normal: 3, Low: 4 };

  /**
   * buildTaskPayload
   * Converts a capture `entry` (as assembled by app.js's
   * submitCapture()) into the JSON body ClickUp's "Create Task"
   * endpoint expects.
   * @param {object} entry - { fields, transcript, ... } — see app.js
   * @returns {object} ClickUp task payload
   * Edge cases: any field not present in `entry.fields` is simply
   * omitted rather than sent as null/empty, since ClickUp treats an
   * omitted key differently from an explicit empty value for some
   * fields (e.g. due_date).
   */
  /**
   * capitalizeWords
   * Cosmetic-only title formatting: uppercases the first letter of
   * each word. Deliberately only ever uppercases, never lowercases —
   * "F5 CEO" stays "F5 CEO", "aws project" becomes "Aws Project" —
   * so acronyms and intentional casing typed by the user survive
   * untouched, and only the common "typed it all lowercase in a rush"
   * case gets fixed.
   * @param {string} str
   * @returns {string}
   */
  function capitalizeWords(str) {
    return str.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
  }

  function buildTaskPayload(entry) {
    const payload = { name: capitalizeWords(entry.fields.title || entry.fields.name || '(untitled)') };

    const descriptionParts = [];
    if (entry.fields.description) descriptionParts.push(entry.fields.description);
    if (entry.fields.company) descriptionParts.push(`Company: ${entry.fields.company}`);
    if (entry.fields.contactMethod) descriptionParts.push(`Best contact method: ${entry.fields.contactMethod}`);
    if (entry.fields.opportunity) descriptionParts.push(`Opportunity: ${entry.fields.opportunity}`);
    // "Add to Accounts" fields, when routed directly to a List instead
    // of Chat (see app.js's destination toggle) — same plaintext
    // trade-off as the Chat-message version (see formatAccountMessage
    // in app.js), just landing in a task description instead.
    // "Add to Accounts" fields, when routed directly to a List instead
    // of Chat (see app.js's destination toggle). Admin
    // Username/Email/Password/Tool now go into real ClickUp custom
    // fields when a match was found (entry.customFields, resolved in
    // app.js) — only fall back to writing them into the description
    // for whichever ones DIDN'T resolve to a real field, so the
    // password (in particular) never ends up duplicated in two places
    // on the same task. "Notes" has no matching custom field in this
    // list at all, so it always goes into the description.
    const resolvedKeys = new Set((entry.customFieldKeys || []));
    if (entry.fields.accountType) descriptionParts.push(`Account Type: ${entry.fields.accountType}`);
    if (entry.fields.adminUsername && !resolvedKeys.has('adminUsername')) descriptionParts.push(`Admin Username: ${entry.fields.adminUsername}`);
    if (entry.fields.adminEmail && !resolvedKeys.has('adminEmail')) descriptionParts.push(`Admin Email: ${entry.fields.adminEmail}`);
    if (entry.fields.password && !resolvedKeys.has('password')) descriptionParts.push(`Password: ${entry.fields.password}`);
    if (entry.fields.notes) descriptionParts.push(`Notes: ${entry.fields.notes}`);
    // Associated Account: ALWAYS written here too (not only when the
    // real custom field didn't resolve, unlike the fields above) —
    // whether that ClickUp field is a plain-text field or a
    // Relationship/Tasks field type isn't reliably knowable from the
    // API's field-list response alone, and setting a Relationship
    // field's value via Create Task is a known rough edge in
    // ClickUp's API (community reports of it silently not applying).
    // This plain-text line guarantees the association is visible on
    // the task even if the structured field write silently no-ops.
    if (entry.associatedAccountName) {
      descriptionParts.push(`Associated Client Account: ${entry.associatedAccountName}${entry.associatedAccountId ? ` (${entry.associatedAccountId})` : ''}`);
    }
    if (entry.transcript) descriptionParts.push(`\n— Voice transcript —\n${entry.transcript}`);
    if (descriptionParts.length) payload.description = descriptionParts.join('\n\n');

    if (entry.fields.priority && PRIORITY_MAP[entry.fields.priority]) {
      payload.priority = PRIORITY_MAP[entry.fields.priority];
    }
    // Start date: when this capture should become active/visible on a
    // timeline — distinct from Due date (deadline). Both are plain
    // dates (no time-of-day) by design; see config.js v5 note.
    if (entry.fields.startDate) {
      payload.start_date = new Date(entry.fields.startDate).getTime();
      payload.start_date_time = false;
    }
    if (entry.fields.dueDate) {
      payload.due_date = new Date(entry.fields.dueDate).getTime();
      payload.due_date_time = false;
    }
    if (entry.fields.tags) {
      payload.tags = entry.fields.tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    // Assignee: populated from a list-specific dropdown (see app.js
    // renderForm's assignee section, backed by getListMembers() below)
    // rather than a schema field, since valid options depend on which
    // ClickUp List this capture is headed to and have to be fetched.
    if (entry.fields.assigneeId) {
      payload.assignees = [Number(entry.fields.assigneeId)];
    }
    // Subtask nesting: entry.parentTaskId is set by app.js's "subtask
    // of an existing task" flow (see loadParentTaskOptions/selectParentTask),
    // not a schema field — same reasoning as assigneeId above. ClickUp
    // requires the parent to already live in this same List (see
    // clickup.js version history) and to not itself be a subtask; both
    // are enforced by how the search is scoped, not here.
    if (entry.parentTaskId) {
      payload.parent = entry.parentTaskId;
    }
    // Custom fields: resolved ahead of time by app.js (real ClickUp
    // custom-field IDs looked up via getListFields(), matched by
    // name to the relevant form fields — see app.js
    // getAccountFieldMapping()). Passed straight through here since
    // this file has no List-specific field knowledge of its own.
    if (entry.customFields && entry.customFields.length) {
      payload.custom_fields = entry.customFields;
    }
    return payload;
  }

  /**
   * apiError — builds an Error with a `.status` property attached, so
   * callers can branch on HTTP status (e.g. 403 = wrong passcode)
   * without string-matching the message.
   */
  function apiError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
  }

  /**
   * createTask
   * Creates a task in the given ClickUp List via the Worker proxy.
   * @param {string} listId - destination ClickUp List ID
   * @param {object} entry - capture entry (see buildTaskPayload)
   * @returns {Promise<object>} the created ClickUp task object
   * @throws on non-2xx response — status 403 means the device passcode
   *   was missing/wrong; 401 means the passcode was fine but no
   *   ClickUp OAuth connection is stored yet (needs Settings → Connect).
   */
  async function createTask(listId, entry) {
    const res = await fetch(`${proxyUrl()}/list/${listId}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(buildTaskPayload(entry))
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw apiError(`CLICKUP_${res.status}: ${text}`, res.status);
    }
    return res.json();
  }

  /**
   * uploadAttachment
   * Attaches a file to an already-created ClickUp task.
   * @param {string} taskId - ClickUp task ID returned by createTask()
   * @param {File} file - browser File/Blob to attach
   * @returns {Promise<object>} ClickUp's attachment response
   * Note: callers (app.js) intentionally swallow failures here per
   * attachment (a failed attachment shouldn't undo an otherwise
   * successful task creation) — see submitCapture()'s .catch(() => {}).
   */
  async function uploadAttachment(taskId, file) {
    const form = new FormData();
    form.append('attachment', file, file.name);
    const res = await fetch(`${proxyUrl()}/task/${taskId}/attachment`, {
      method: 'POST',
      headers: authHeaders(),
      body: form
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw apiError(`CLICKUP_ATTACH_${res.status}: ${text}`, res.status);
    }
    return res.json();
  }

  /**
   * testConnection
   * Lightweight check used two ways: (1) the passcode lock screen
   * calls this right after someone enters a passcode, to confirm it's
   * correct before letting them into the app; (2) Settings calls this
   * on every load to show real, current connection status rather than
   * only right after the OAuth redirect.
   * @returns {Promise<object>} ClickUp's /user response on success
   * @throws apiError with status 403 (bad passcode) or 401 (passcode
   *   fine, ClickUp not connected) or other network/HTTP errors.
   */
  async function testConnection() {
    const res = await fetch(`${proxyUrl()}/user`, { method: 'GET', headers: authHeaders() });
    if (!res.ok) throw apiError(`CLICKUP_${res.status}`, res.status);
    return res.json();
  }

  /**
   * getListMembers
   * Fetches the Workspace members who have access to (and can be
   * assigned tasks in) a given ClickUp List — powers the Assignee
   * dropdown on Task-type capture forms. See app.js renderForm() for
   * the caching layer (avoids re-fetching per keystroke/re-render).
   * @param {string} listId
   * @returns {Promise<Array<{id:number, username:string}>>}
   * @throws apiError on non-2xx (403 wrong passcode, 401 not connected,
   *   or a genuine ClickUp error e.g. the list ID doesn't exist)
   */
  async function getListMembers(listId) {
    const res = await fetch(`${proxyUrl()}/list/${listId}/member`, {
      method: 'GET',
      headers: authHeaders()
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw apiError(`CLICKUP_MEMBERS_${res.status}: ${text}`, res.status);
    }
    const data = await res.json();
    return data.members || [];
  }

  /**
   * logCapture
   * Posts a short Markdown activity message to the configured ClickUp
   * Chat channel, summarizing what was just captured and linking to
   * it. Called by app.js right after a successful createTask(), as a
   * lightweight "new activity" feed distinct from the task itself.
   * Deliberately best-effort: callers should wrap this in a .catch()
   * that swallows failures (same pattern as uploadAttachment callers)
   * so a Chat-logging hiccup never undoes or blocks a capture that
   * already succeeded. See clickup-proxy.js handleChatLog() for the
   * server side, including the "experimental API" caveat.
   * @param {object} entry - the capture entry (see submitCapture in app.js)
   * @param {string} taskUrl - the created task's ClickUp URL
   * @returns {Promise<object>} ClickUp's message-creation response
   */
  /**
   * logCapture
   * Posts a short Markdown activity message to the configured ClickUp
   * Chat channel, summarizing what was just captured and linking to
   * it. Called by app.js after a successful send, as a lightweight
   * "new activity" feed distinct from the task itself. Deliberately
   * best-effort: callers should wrap this in a .catch() that swallows
   * failures (same pattern as uploadAttachment callers) so a
   * Chat-logging hiccup never undoes or blocks a capture that already
   * succeeded. See clickup-proxy.js handleChatLog() for the server
   * side, including the "experimental API" caveat.
   * @param {object} entry - the capture entry (see submitCapture in app.js)
   * @param {string} taskUrl - the relevant ClickUp URL (a task URL for
   *   action:'task'/'comment'; not called at all for action:'chat' —
   *   see performSend() in app.js)
   * @returns {Promise<object>} ClickUp's message-creation response
   * Note: entry.parentTaskId/parentTaskName carry two different
   * meanings depending on entry.action — "subtask nested under X" for
   * a normal task capture, vs "comment added to X" for a Follow-up.
   * Branching on entry.action here keeps the log message honest about
   * which actually happened, rather than always saying "Subtask of".
   */
  async function logCapture(entry, taskUrl) {
    let lines;
    if (entry.action === 'comment') {
      lines = [
        `\ud83d\udcac **Follow-up** \u2014 ${entry.entityName}`,
        entry.fields && entry.fields.note ? entry.fields.note : entry.title,
        `On: ${entry.parentTaskName || 'existing task'}`
      ];
    } else {
      lines = [`📥 **New ${entry.typeLabel}** — ${entry.entityName}`, entry.title];
      // Surface subtask nesting in the log — otherwise a subtask shows
      // up identically to a top-level task, losing useful context
      // about where it actually landed in the hierarchy.
      if (entry.parentTaskId && entry.parentTaskName) {
        lines.push(`\u21b3 Subtask of: ${entry.parentTaskName}`);
      }
    }
    lines.push(taskUrl);
    const content = lines.join('\n');
    const res = await fetch(`${proxyUrl()}/log/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw apiError(`CLICKUP_CHATLOG_${res.status}: ${text}`, res.status);
    }
    return res.json();
  }

  /**
   * getListTasks
   * Fetches the (open + closed) tasks that live in a given ClickUp
   * List — used by both "make this a subtask of an existing task" and
   * "Follow-up / Reminder" (see app.js loadParentTaskOptions()).
   * ClickUp's API has no name search endpoint (confirmed via their own
   * public feedback board as of this writing), so the app fetches
   * once and filters client-side as the user types, rather than
   * hitting the API per keystroke.
   * @param {string} listId
   * @returns {Promise<Array<object>>} all tasks as ClickUp returns
   *   them — including ones that are themselves subtasks (each has a
   *   `.parent` field). Whether subtasks-of-subtasks should be
   *   filtered out is caller-specific (the subtask-parent feature
   *   must exclude them per ClickUp's API rules; Follow-up/Reminder
   *   does not, since commenting on an existing subtask is fine) — see
   *   app.js filterAndRenderSubtaskResults()'s excludeSubtasks param.
   * @throws apiError on non-2xx
   * Edge case: ClickUp caps this endpoint at 100 tasks/page and this
   * function only fetches page 0 — for a list with 100+ tasks, very
   * old entries might not appear in the search. getTaskById() is the
   * fallback for finding something outside that window by pasting its
   * exact task ID.
   */
  async function getListTasks(listId) {
    const res = await fetch(`${proxyUrl()}/list/${listId}/task?include_closed=true`, {
      method: 'GET',
      headers: authHeaders()
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw apiError(`CLICKUP_LISTTASKS_${res.status}: ${text}`, res.status);
    }
    const data = await res.json();
    return data.tasks || [];
  }

  /**
   * getTaskById
   * Direct lookup of a single task by its exact ClickUp ID — the
   * fallback path in the subtask-parent search when a pasted ID isn't
   * found in the (max 100) tasks getListTasks() already fetched.
   * @param {string} taskId
   * @returns {Promise<object|null>} the task, or null if not found
   *   (404) — callers treat "not found" as a normal outcome, not an
   *   error, since the user may have simply mistyped the ID.
   * @throws apiError on any non-404 non-2xx response
   */
  async function getTaskById(taskId) {
    const res = await fetch(`${proxyUrl()}/task/${taskId}`, {
      method: 'GET',
      headers: authHeaders()
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw apiError(`CLICKUP_TASKLOOKUP_${res.status}: ${text}`, res.status);
    }
    return res.json();
  }

  /**
   * addComment
   * Adds a comment to an existing task — the mechanism behind
   * "Follow-up / Reminder" (see app.js). Used instead of creating a
   * new task, and instead of ClickUp's native Reminders (which have
   * no public API at all — confirmed via ClickUp's own feedback
   * board, a 5+ year open request).
   * @param {string} taskId
   * @param {string} commentText - plain text; ClickUp renders it as a
   *   normal comment, not markdown (unlike Chat messages)
   * @returns {Promise<object>} ClickUp's comment-creation response
   * @throws apiError on non-2xx
   */
  async function addComment(taskId, commentText) {
    const res = await fetch(`${proxyUrl()}/task/${taskId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ comment_text: commentText })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw apiError(`CLICKUP_COMMENT_${res.status}: ${text}`, res.status);
    }
    return res.json();
  }

  /**
   * postToChannel
   * Posts a message to a specific ClickUp Chat channel — the
   * mechanism behind "Add to Accounts" (see app.js), which needs a
   * different destination than the general activity log logCapture()
   * posts to. Both go through the same Worker route
   * (handleChatLog) — passing channel_id here is what tells the
   * Worker to use this destination instead of its CHAT_CHANNEL_ID
   * default.
   * @param {string} channelId
   * @param {string} content - Markdown-formatted message text
   * @returns {Promise<object>} ClickUp's message-creation response
   * @throws apiError on non-2xx
   */
  async function postToChannel(channelId, content) {
    const res = await fetch(`${proxyUrl()}/log/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content, channel_id: channelId })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw apiError(`CLICKUP_CHATPOST_${res.status}: ${text}`, res.status);
    }
    return res.json();
  }

  /**
   * getListFields
   * Fetches the custom field definitions ClickUp has configured for a
   * List — used to look up the real field IDs "Add to Accounts"'s
   * Direct-to-List mode needs (Admin Username, Admin Email,
   * Registered Password, Tool/Software/Act) so it can actually
   * populate them, rather than only dumping everything into the task
   * description. See app.js getAccountFieldMapping() for the
   * name-matching that turns this into a usable mapping.
   * @param {string} listId
   * @returns {Promise<Array<{id:string, name:string, type:string}>>}
   * @throws apiError on non-2xx
   */
  async function getListFields(listId) {
    const res = await fetch(`${proxyUrl()}/list/${listId}/field`, {
      method: 'GET',
      headers: authHeaders()
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw apiError(`CLICKUP_FIELDS_${res.status}: ${text}`, res.status);
    }
    const data = await res.json();
    return data.fields || [];
  }

  return {
    createTask, uploadAttachment, testConnection, getListMembers, logCapture,
    getListTasks, getTaskById, addComment, postToChannel, getListFields
  };
})();
