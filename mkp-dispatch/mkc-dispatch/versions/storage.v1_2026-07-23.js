/**
 * storage.js
 * -----------------------------------------------------------------------
 * Everything kept on-device. Nothing here ever holds your ClickUp
 * token — only the Worker URL, drafts, a queue of not-yet-sent
 * captures, and a short list of recent successful sends.
 * -----------------------------------------------------------------------
 */

const Storage = (() => {
  const KEYS = {
    settings: 'dispatch:settings',
    queue: 'dispatch:queue',
    recent: 'dispatch:recent',
    draft: 'dispatch:draft'
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // --- Settings -----------------------------------------------------
  function getSettings() {
    return read(KEYS.settings, { proxyUrl: '', defaultEntity: null });
  }
  function saveSettings(settings) {
    write(KEYS.settings, { ...getSettings(), ...settings });
  }

  // --- Draft (the one in-progress capture, for auto-save) ------------
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
  function getQueue() {
    return read(KEYS.queue, []);
  }
  function enqueue(entry) {
    const queue = getQueue();
    queue.push(entry);
    write(KEYS.queue, queue);
  }
  function removeFromQueue(id) {
    write(KEYS.queue, getQueue().filter(e => e.id !== id));
  }

  // --- Recent captures (local log, last 20) ---------------------------
  function getRecent() {
    return read(KEYS.recent, []);
  }
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
