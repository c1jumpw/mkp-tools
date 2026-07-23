/**
 * =========================================================================
 * storage.js — on-device persistence (localStorage wrapper)
 * =========================================================================
 * PURPOSE
 *   Everything Dispatch keeps on the phone/browser itself:
 *     - settings   (Worker proxy URL override, default entity)
 *     - draft      (the single in-progress capture, for auto-save/recovery)
 *     - queue      (captures that failed to send — retried automatically)
 *     - recent     (a local log of the last 20 successful sends, purely
 *                   cosmetic — this is NOT synced from ClickUp, just a
 *                   record of what this device has sent)
 *
 *   IMPORTANT: nothing in this file ever stores a ClickUp API token.
 *   The token lives only on the Cloudflare Worker (see /worker). This
 *   file only ever touches the Worker's public URL, which is safe to
 *   keep client-side.
 *
 * DATA FLOW
 *   app.js and clickup.js both read/write through the functions
 *   exposed here rather than touching localStorage directly, so the
 *   storage format can change in one place without hunting through
 *   the rest of the codebase.
 *
 * ASSUMPTIONS / EXTERNAL DEPENDENCIES
 *   - Requires DEFAULT_PROXY_URL to be defined (from config.js, loaded
 *     before this file in index.html).
 *   - Assumes localStorage is available and not full/disabled (private
 *     browsing modes can restrict it) — failures are swallowed via
 *     try/catch in read(), falling back to the caller's default rather
 *     than throwing and breaking the UI.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-07-23  Initial implementation. getSettings() defaulted
 *                    proxyUrl to '' — required the user to paste the
 *                    Worker URL manually in Settings on first launch.
 *   v2  2026-07-23  getSettings() now falls back to DEFAULT_PROXY_URL
 *                    (from config.js) instead of an empty string, so
 *                    the app works immediately with zero manual setup.
 *                    A user-entered override in Settings still always
 *                    wins once one has been saved. Added full
 *                    file/function documentation.
 * =========================================================================
 */

const Storage = (() => {
  // Namespaced localStorage keys. Prefixed with "dispatch:" so this app
  // never collides with another site's storage on the same device/browser.
  const KEYS = {
    settings: 'dispatch:settings',
    queue: 'dispatch:queue',
    recent: 'dispatch:recent',
    draft: 'dispatch:draft'
  };

  /**
   * read
   * Safely reads and JSON-parses a localStorage key.
   * @param {string} key - one of KEYS.*
   * @param {*} fallback - value returned if the key is missing OR if
   *   parsing fails (e.g. corrupted data, storage disabled).
   * @returns {*} parsed value, or `fallback`
   * Edge cases: private-browsing modes in some browsers throw on any
   * localStorage access — caught here so the app degrades gracefully
   * (falls back to defaults) instead of crashing on load.
   */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  /**
   * write
   * Serializes and writes a value to localStorage.
   * @param {string} key - one of KEYS.*
   * @param {*} value - any JSON-serializable value
   * Note: does not catch quota-exceeded errors (e.g. huge offline-queued
   * attachments) — see the offline-attachment size caveat in README.md.
   */
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // --- Settings -----------------------------------------------------
  /**
   * getSettings
   * Returns the user's saved settings, merged over sensible defaults.
   * `proxyUrl` defaults to DEFAULT_PROXY_URL (config.js) — this is what
   * lets the app work with zero manual configuration out of the box.
   * If the user has explicitly saved a different Worker URL in Settings
   * (e.g. while testing a second Worker), that saved value wins instead.
   * @returns {{proxyUrl: string, defaultEntity: (string|null)}}
   */
  function getSettings() {
    const saved = read(KEYS.settings, {});
    return {
      proxyUrl: DEFAULT_PROXY_URL,
      defaultEntity: null,
      ...saved
    };
  }

  /**
   * saveSettings
   * Shallow-merges the given partial settings into whatever is saved.
   * @param {object} settings - partial settings object, e.g. { proxyUrl }
   */
  function saveSettings(settings) {
    write(KEYS.settings, { ...getSettings(), ...settings });
  }

  // --- Draft (the one in-progress capture, for auto-save) ------------
  // TODO: not yet wired into app.js's form screen (fields aren't
  // auto-saved as the user types). Safe to leave for now since the
  // offline queue already protects against losing a *submitted*
  // capture; this would only add protection against closing the app
  // mid-typing. Would implement via an input/change listener in
  // renderForm() calling saveDraft() on a short debounce.
  function saveDraft(draft) {
    write(KEYS.draft, draft);
  }
  function getDraft() {
    return read(KEYS.draft, null);
  }
  function clearDraft() {
    localStorage.removeItem(KEYS.draft);
  }

  // --- Offline queue (captures that failed to send) -------------------
  /** getQueue - returns the array of not-yet-sent capture entries. */
  function getQueue() {
    return read(KEYS.queue, []);
  }
  /** enqueue - appends one capture entry to the retry queue. */
  function enqueue(entry) {
    const queue = getQueue();
    queue.push(entry);
    write(KEYS.queue, queue);
  }
  /** removeFromQueue - drops an entry (by id) once it sends successfully. */
  function removeFromQueue(id) {
    write(KEYS.queue, getQueue().filter(e => e.id !== id));
  }

  // --- Recent captures (local log, last 20) ---------------------------
  /** getRecent - returns the locally-logged recent sends (device-only). */
  function getRecent() {
    return read(KEYS.recent, []);
  }
  /**
   * addRecent
   * Prepends a new entry to the recent log, capped at 20 entries
   * (oldest dropped) to keep localStorage usage small.
   */
  function addRecent(entry) {
    const recent = [entry, ...getRecent()].slice(0, 20);
    write(KEYS.recent, recent);
  }

  return {
    getSettings, saveSettings,
    saveDraft, getDraft, clearDraft,
    getQueue, enqueue, removeFromQueue,
    getRecent, addRecent
  };
})();
