/**
 * =========================================================================
 * changelog.js — the change log: data, role filtering, rendering, export
 * =========================================================================
 * PURPOSE
 *   Everything Dispatch It needs to read and show its change log:
 *     - load()              fetches guide/changelog.json (no cache)
 *     - forRole()           what an 'admin' or 'user' device may see
 *     - unseen()            releases newer than the device's seen marker
 *     - releaseHtml()       one release card (What's new + Change log page)
 *     - toCSV()/download()  the admin page's Download buttons
 *
 * WHERE THE DATA COMES FROM
 *   mkp-dispatch/CHANGELOG.md is turned into guide/changelog.json by
 *   guides/run.py, which GitHub Actions re-runs on every update:
 *     { app, generated, commitsComplete,
 *       releases: [{ id, date, title, audience, items: [{ text, audience, kind }] }],  // newest first
 *       commits:  [{ date, sha, subject }] }                                          // newest first
 *   audience: 'everyone' | 'admins'. kind: a key of KINDS.
 *
 * ROLES
 *   'admin' sees every item; 'user' only items whose audience is
 *   'everyone' (a release left with no items is hidden). The role comes
 *   from the Worker's GET /whoami (app.js refreshRole).
 *
 * "SEEN" MARKER
 *   The id of the newest release this device has seen (localStorage, see
 *   app.js TOUR_SEEN_KEY). Releases above it in the list are unseen. If the
 *   id is no longer in the log (a release was renamed), nothing is shown
 *   rather than replaying the whole history.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-11-20  Initial version (admin Change log page + role-aware
 *                    What's new).
 * =========================================================================
 */

const Changelog = (() => {
  const URL_PATH = 'guide/changelog.json';
  const KINDS = {
    new: 'New', improved: 'Improved', fixed: 'Fixed', changed: 'Changed', removed: 'Removed', security: 'Security'
  };
  let cache = null; // last successful load, reused within a page load

  /**
   * load — the change log, or null when missing/offline.
   * @param {boolean} [fresh=false] - ignore this page load's copy
   * @returns {Promise<object|null>}
   */
  async function load(fresh = false) {
    if (cache && !fresh) return cache;
    try {
      const res = await fetch(URL_PATH, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      cache = {
        releases: Array.isArray(data.releases) ? data.releases : [],
        commits: Array.isArray(data.commits) ? data.commits : [],
        commitsComplete: data.commitsComplete !== false,
        generated: data.generated || ''
      };
      return cache;
    } catch (e) {
      return null;
    }
  }

  /**
   * forRole — releases a role may see, each with only its visible items.
   * @param {object[]} releases - newest first
   * @param {'admin'|'user'} role
   * @returns {object[]}
   */
  function forRole(releases, role) {
    if (role === 'admin') return releases;
    return releases
      .map(r => Object.assign({}, r, { items: r.items.filter(it => it.audience === 'everyone') }))
      .filter(r => r.items.length > 0);
  }

  /**
   * unseen — releases newer than the seen id (newest first).
   * @param {object[]} releases
   * @param {string|null} seenId
   * @returns {object[]}
   */
  function unseen(releases, seenId) {
    const i = releases.findIndex(r => r.id === seenId);
    return i > 0 ? releases.slice(0, i) : [];
  }

  /** "2026-11-20" -> "Nov 20, 2026" (date only, no timezone shift). */
  function formatDate(iso) {
    const p = String(iso).split('-').map(Number);
    if (!p[0] || !p[1] || !p[2]) return String(iso);
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** "2026-11-20" -> "November 2026". */
  function formatMonth(iso) {
    const p = String(iso).split('-').map(Number);
    return new Date(p[0], (p[1] || 1) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  /**
   * itemHtml — one change line: kind pill, sentence, "Admins" tag.
   * @param {object} it - { text, kind, audience }
   * @param {boolean} showAudience - admins only
   */
  function itemHtml(it, showAudience) {
    const kind = KINDS[it.kind] ? it.kind : 'improved';
    return `<li class="cl-item">
      <span class="cl-kind cl-kind--${kind}">${KINDS[kind]}</span>
      <span class="cl-text">${UI.escape(it.text)}${showAudience && it.audience === 'admins' ? ' <span class="cl-aud">Admins</span>' : ''}</span>
    </li>`;
  }

  /** releaseHtml — a release: title, date, its lines. */
  function releaseHtml(r, showAudience) {
    return `<section class="cl-release${r.audience === 'admins' ? ' cl-release--admins' : ''}">
      <div class="cl-release-head">
        <h3 class="cl-release-title">${UI.escape(r.title)}</h3>
        <span class="cl-date">${UI.escape(formatDate(r.date))}</span>
      </div>
      <ul class="cl-items">${r.items.map(it => itemHtml(it, showAudience)).join('')}</ul>
    </section>`;
  }

  /** CSV-quotes one value (RFC 4180). */
  function cell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** One row per change, oldest first. */
  function releasesCSV(releases) {
    const rows = [['date', 'release', 'release_id', 'audience', 'kind', 'change']];
    releases.slice().reverse().forEach(r => r.items.forEach(it => rows.push([r.date, r.title, r.id, it.audience, it.kind, it.text])));
    return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  /** One row per code change, oldest first. */
  function commitsCSV(commits) {
    const rows = [['date', 'commit', 'description']];
    commits.slice().reverse().forEach(c => rows.push([c.date, c.sha, c.subject]));
    return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  /** download — saves text as a file via a temporary object URL. */
  function download(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { KINDS, load, forRole, unseen, formatDate, formatMonth, itemHtml, releaseHtml, releasesCSV, commitsCSV, download };
})();
