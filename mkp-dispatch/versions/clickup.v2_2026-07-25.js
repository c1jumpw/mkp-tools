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
  function buildTaskPayload(entry) {
    const payload = { name: entry.fields.title || entry.fields.name || '(untitled)' };

    const descriptionParts = [];
    if (entry.fields.description) descriptionParts.push(entry.fields.description);
    if (entry.fields.company) descriptionParts.push(`Company: ${entry.fields.company}`);
    if (entry.fields.contactMethod) descriptionParts.push(`Best contact method: ${entry.fields.contactMethod}`);
    if (entry.fields.opportunity) descriptionParts.push(`Opportunity: ${entry.fields.opportunity}`);
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

  return { createTask, uploadAttachment, testConnection };
})();
