/**
 * =============================================================================
 * FILE: src/lib/changelog.js
 * VERSION: v1 (2026-11-20)
 * =============================================================================
 * PURPOSE
 *   Everything DayForge needs to read and present its change log:
 *     - fetchChangelog()   loads /guide/changelog.json
 *     - releasesForRole()  what a given role is allowed to see
 *     - unseenReleases()   what's new since the person last looked
 *     - toCSV() / downloadText()  the admin page's "Download" buttons
 *     - KIND_META, formatDate()   shared display helpers
 *
 * WHERE THE DATA COMES FROM
 *   dayforge/CHANGELOG.md (hand-written release notes) is turned into
 *   public/guide/changelog.json by guides/run.py, which GitHub Actions
 *   re-runs on every update. Shape:
 *     { app, generated, commitsComplete,
 *       releases: [{ id, date, title, audience, items: [{ text, audience, kind }] }],  // newest first
 *       commits:  [{ date, sha, subject }] }                                          // newest first
 *   audience is 'everyone' or 'admins'. kind is one of KIND_META's keys.
 *
 * ROLES
 *   'admin' sees every item. Everyone else ('user') sees only items whose
 *   audience is 'everyone'; a release left with no items is hidden.
 *
 * "SEEN" MARKER
 *   { id, date } of the newest release the person has seen. Stored per
 *   account (Supabase user_metadata, see hooks/useOnboarding.js). Releases
 *   above that id in the list are unseen. If the id is no longer in the log
 *   (a release was renamed), releases with a later date count as unseen.
 * =============================================================================
 */

export const CHANGELOG_URL = '/guide/changelog.json'

/** Display label + colors for each kind of change. Tailwind classes use the theme tokens. */
export const KIND_META = {
  new: { label: 'New', cls: 'bg-[var(--color-ember)] text-[var(--color-ink)]' },
  improved: { label: 'Improved', cls: 'bg-[var(--color-steel)] text-[var(--color-ink)]' },
  fixed: { label: 'Fixed', cls: 'bg-[var(--color-good)] text-[var(--color-ink)]' },
  changed: { label: 'Changed', cls: 'border border-[var(--color-steel)] text-[var(--color-steel)]' },
  removed: { label: 'Removed', cls: 'border border-[var(--color-line)] text-[var(--color-muted)]' },
  security: { label: 'Security', cls: 'border border-[var(--color-ember)] text-[var(--color-ember)]' },
}

/**
 * Loads the change log, bypassing the HTTP cache so a fresh deploy is seen.
 * @returns {Promise<{releases: object[], commits: object[], commitsComplete: boolean, generated: string}>}
 * @throws Error when the file is missing (e.g. local dev before guides are built) or offline.
 */
export async function fetchChangelog() {
  const res = await fetch(CHANGELOG_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Change log not available (${res.status})`)
  const data = await res.json()
  return {
    releases: Array.isArray(data.releases) ? data.releases : [],
    commits: Array.isArray(data.commits) ? data.commits : [],
    commitsComplete: data.commitsComplete !== false,
    generated: data.generated || null,
  }
}

/**
 * Releases a role may see, each with only the items that role may see.
 * @param {object[]} releases - newest first
 * @param {'admin'|'user'} role
 * @returns {object[]} same order; releases with no visible items are dropped
 */
export function releasesForRole(releases, role) {
  if (role === 'admin') return releases
  return releases
    .map((r) => ({ ...r, items: r.items.filter((it) => it.audience === 'everyone') }))
    .filter((r) => r.items.length > 0)
}

/**
 * Releases newer than the seen marker (newest first), before any role filter.
 * @param {object[]} releases - newest first
 * @param {{id?: string, date?: string}|null} seen
 * @returns {object[]}
 */
export function unseenReleases(releases, seen) {
  if (!seen) return []
  const idx = releases.findIndex((r) => r.id === seen.id)
  if (idx >= 0) return releases.slice(0, idx)
  if (seen.date) return releases.filter((r) => r.date > seen.date)
  return []
}

/** The marker for "seen everything up to the newest release". */
export function newestMarker(releases) {
  const r = releases[0]
  return r ? { id: r.id, date: r.date } : null
}

/** "2026-11-20" -> "Nov 20, 2026" (date-only, no timezone shift). */
export function formatDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return String(iso)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "2026-11-20" -> "November 2026", for month group headings. */
export function formatMonth(iso) {
  const [y, m] = String(iso).split('-').map(Number)
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** CSV-quotes one value (RFC 4180). */
function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * One row per change, oldest first, for spreadsheets.
 * @param {object[]} releases - newest first (as stored)
 * @returns {string} CSV text with a header row
 */
export function releasesToCSV(releases) {
  const rows = [['date', 'release', 'release_id', 'audience', 'kind', 'change']]
  for (const r of [...releases].reverse()) {
    for (const it of r.items) rows.push([r.date, r.title, r.id, it.audience, it.kind, it.text])
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** One row per code change, oldest first. */
export function commitsToCSV(commits) {
  const rows = [['date', 'commit', 'description']]
  for (const c of [...commits].reverse()) rows.push([c.date, c.sha, c.subject])
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/**
 * Saves text as a file in the browser (a temporary object URL + <a download>).
 * @param {string} filename
 * @param {string} text
 * @param {string} mime
 */
export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
