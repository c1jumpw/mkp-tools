/**
 * =============================================================================
 * FILE: src/components/AdminPanel.jsx
 * VERSION: v1 (2026-11-20)
 * =============================================================================
 * PURPOSE
 *   ⋮ › Admin — the admin-only area. Three tabs:
 *     Change log    every release from launch to today, as a timeline grouped
 *                   by month. Newest or oldest first, filter by audience
 *                   (everyone / admins only) and kind (New, Fixed, …),
 *                   search, and download the whole history as CSV or JSON so
 *                   it can be kept or reused outside DayForge.
 *     Every change  every code change, recorded automatically from the
 *                   project's history (git), so nothing is missed even when
 *                   no release note was written. Downloadable as CSV.
 *     Admins        who the admins are; add one by email, remove one.
 *
 * WHO CAN OPEN IT
 *   Dashboard only shows the menu item to admins (hooks/useRole.js). The
 *   Admins tab's actions are re-checked on the server by the Supabase
 *   functions in migration 009, so the hidden button isn't the only lock.
 *   The change-log text itself is not secret (it's in the public repo).
 *
 * PROPS
 *   changelog      from useOnboarding: { releases, commits, commitsComplete,
 *                  generated } or { unavailable: true }, or null while loading
 *   currentUserId  to mark "You" in the Admins list
 *   initialTab     'log' | 'commits' | 'admins' (default 'log')
 *   onClose
 *
 * EDGE CASES
 *   - Change log not built yet (local dev) or offline: a plain message.
 *   - Admins tab before migration 009: the server error is shown as is.
 *   - Search matches a release's title or any of its lines.
 *   - Removing yourself as admin reloads the app, which hides this panel.
 * =============================================================================
 */

import { useEffect, useMemo, useState } from 'react'
import ChangeItem from './ChangeItem'
import {
  KIND_META, formatDate, formatMonth, releasesToCSV, commitsToCSV, downloadText,
} from '../lib/changelog'
import { listAdmins, addAdmin, removeAdmin } from '../hooks/useRole'

const TABS = [
  { id: 'log', label: 'Change log' },
  { id: 'commits', label: 'Every change' },
  { id: 'admins', label: 'Admins' },
]
const AUDIENCE_FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'everyone', label: 'For everyone' },
  { id: 'admins', label: 'Admins only' },
]

/** Small toggle chip used for filters. */
function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-xs rounded-full px-2.5 py-1 border transition whitespace-nowrap ${
        active
          ? 'bg-[var(--color-paper)] text-[var(--color-ink)] border-[var(--color-paper)]'
          : 'border-[var(--color-line)] text-[var(--color-muted)] hover:border-[var(--color-steel)] hover:text-[var(--color-paper)]'
      }`}
    >
      {children}
    </button>
  )
}

/** Groups an ordered list by "Month Year" of each row's date, keeping order. */
function groupByMonth(rows) {
  const groups = []
  for (const row of rows) {
    const key = row.date.slice(0, 7)
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, label: formatMonth(row.date), rows: [] })
    groups[groups.length - 1].rows.push(row)
  }
  return groups
}

const inputCls = 'w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm focus:border-[var(--color-ember)] outline-none'
const smallBtn = 'text-xs border border-[var(--color-line)] rounded px-2.5 py-1.5 hover:border-[var(--color-steel)] transition'

// ---------------------------------------------------------------- Change log
function ChangeLogTab({ changelog }) {
  const [order, setOrder] = useState('newest')
  const [audience, setAudience] = useState('all')
  const [kind, setKind] = useState('all')
  const [query, setQuery] = useState('')

  const releases = changelog.releases
  const stats = useMemo(() => ({
    releases: releases.length,
    changes: releases.reduce((n, r) => n + r.items.length, 0),
    adminOnly: releases.reduce((n, r) => n + r.items.filter((it) => it.audience === 'admins').length, 0),
    since: releases.length ? releases[releases.length - 1].date : null,
  }), [releases])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = []
    for (const r of releases) {
      const titleHit = q && r.title.toLowerCase().includes(q)
      const items = r.items.filter((it) =>
        (audience === 'all' || it.audience === audience) &&
        (kind === 'all' || it.kind === kind) &&
        (!q || titleHit || it.text.toLowerCase().includes(q)))
      if (items.length) out.push({ ...r, items })
    }
    return order === 'oldest' ? out.reverse() : out
  }, [releases, audience, kind, query, order])

  const shownChanges = visible.reduce((n, r) => n + r.items.length, 0)
  const filtered = audience !== 'all' || kind !== 'all' || query.trim()

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          [stats.releases, 'Updates'],
          [stats.changes, `Changes · ${stats.adminOnly} admin-only`],
          [stats.since ? formatDate(stats.since) : '—', 'First release'],
        ].map(([value, label]) => (
          <div key={label} className="rounded border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2">
            <div className="[font-family:var(--font-display)] text-xl leading-tight tabular-nums">{value}</div>
            <div className="blueprint-tick uppercase">{label}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the change log"
            aria-label="Search the change log"
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => setOrder((o) => (o === 'newest' ? 'oldest' : 'newest'))}
            className="shrink-0 text-sm border border-[var(--color-line)] rounded px-3 hover:border-[var(--color-steel)] transition"
            aria-label={order === 'newest' ? 'Showing newest first. Switch to oldest first' : 'Showing oldest first. Switch to newest first'}
          >
            {order === 'newest' ? 'Newest first ↓' : 'Oldest first ↑'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Who it's for">
          {AUDIENCE_FILTERS.map((a) => <Chip key={a.id} active={audience === a.id} onClick={() => setAudience(a.id)}>{a.label}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kind of change">
          <Chip active={kind === 'all'} onClick={() => setKind('all')}>All kinds</Chip>
          {Object.entries(KIND_META).map(([k, m]) => <Chip key={k} active={kind === k} onClick={() => setKind(k)}>{m.label}</Chip>)}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="blueprint-tick uppercase mr-1">Download all</span>
          <button type="button" className={smallBtn} onClick={() => downloadText(`dayforge-change-log-${changelog.generated || 'export'}.csv`, releasesToCSV(releases), 'text/csv')}>CSV</button>
          <button type="button" className={smallBtn} onClick={() => downloadText(`dayforge-change-log-${changelog.generated || 'export'}.json`, JSON.stringify({ app: 'DayForge', generated: changelog.generated, releases, commits: changelog.commits }, null, 2), 'application/json')}>JSON</button>
          {filtered && <span className="text-xs text-[var(--color-muted)] ml-auto">{shownChanges} of {stats.changes} changes</span>}
        </div>
      </div>

      {/* Timeline */}
      {visible.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)] py-6 text-center">Nothing matches those filters.</p>
      ) : (
        groupByMonth(visible).map((g) => (
          <section key={g.key}>
            <h3 className="[font-family:var(--font-display)] uppercase tracking-wide text-sm text-[var(--color-muted)] mb-2">{g.label}</h3>
            <ol className="relative border-l border-[var(--color-line)] ml-1.5 space-y-3">
              {g.rows.map((r) => (
                <li key={r.id} className="relative pl-5">
                  <span
                    className={`absolute -left-[5px] top-3 w-[9px] h-[9px] rounded-full border-2 border-[var(--color-ink)] ${r.audience === 'admins' ? 'bg-[var(--color-steel)]' : 'bg-[var(--color-ember)]'}`}
                    aria-hidden="true"
                  />
                  <div className="rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <h4 className="font-semibold text-sm leading-tight">{r.title}</h4>
                      <span className="blueprint-tick shrink-0">{formatDate(r.date)}</span>
                    </div>
                    <ul>{r.items.map((it, i) => <ChangeItem key={i} item={it} showAudience />)}</ul>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Every change
function CommitsTab({ changelog }) {
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState('newest')
  const commits = changelog.commits
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = commits.filter((c) => !q || c.subject.toLowerCase().includes(q) || c.sha.startsWith(q))
    return order === 'oldest' ? [...out].reverse() : out
  }, [commits, query, order])

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-muted)]">
        Every code change to DayForge, recorded automatically from the project history ({commits.length} so far).
        Release notes in the Change log tab are the plain-language summary of these.
      </p>
      {!changelog.commitsComplete && (
        <p className="text-xs text-[var(--color-ember)]">This list may be incomplete: the last build only had part of the history.</p>
      )}
      <div className="flex gap-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search changes" aria-label="Search changes" className={inputCls} />
        <button type="button" onClick={() => setOrder((o) => (o === 'newest' ? 'oldest' : 'newest'))} className="shrink-0 text-sm border border-[var(--color-line)] rounded px-3 hover:border-[var(--color-steel)] transition">
          {order === 'newest' ? 'Newest first ↓' : 'Oldest first ↑'}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="blueprint-tick uppercase mr-1">Download all</span>
        <button type="button" className={smallBtn} onClick={() => downloadText(`dayforge-every-change-${changelog.generated || 'export'}.csv`, commitsToCSV(commits), 'text/csv')}>CSV</button>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)] py-6 text-center">Nothing matches.</p>
      ) : groupByMonth(visible).map((g) => (
        <section key={g.key}>
          <h3 className="[font-family:var(--font-display)] uppercase tracking-wide text-sm text-[var(--color-muted)] mb-1">{g.label}</h3>
          <ul className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            {g.rows.map((c) => (
              <li key={c.sha} className="flex items-baseline gap-3 py-2 text-sm">
                <span className="blueprint-tick shrink-0 w-[5.5rem]">{formatDate(c.date)}</span>
                <span className="min-w-0 flex-1 break-words">{c.subject}</span>
                <code className="blueprint-tick shrink-0 hidden sm:inline">{c.sha}</code>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Admins
function AdminsTab({ currentUserId }) {
  const [admins, setAdmins] = useState(null)
  const [error, setError] = useState(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(null) // user_id awaiting "Remove?" confirmation

  async function load() {
    setError(null)
    try { setAdmins(await listAdmins()) } catch (e) { setError(e.message); setAdmins([]) }
  }
  useEffect(() => { load() }, [])

  async function handleAdd(e) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true); setError(null)
    try { await addAdmin(email.trim()); setEmail(''); await load() } catch (err) { setError(err.message) }
    setBusy(false)
  }
  async function handleRemove(id) {
    setBusy(true); setError(null); setConfirming(null)
    try {
      await removeAdmin(id)
      // Removed yourself: reload so the Admin area and admin notes go away.
      if (id === currentUserId) { window.location.reload(); return }
      await load()
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--color-muted)]">
        Admins see this Admin area and the admin-only notes in What&apos;s new. Everyone else sees only the changes meant for them.
      </p>
      {admins === null ? (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
          {admins.map((a) => (
            <li key={a.user_id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{a.email}{a.user_id === currentUserId && <span className="text-[var(--color-muted)]"> (you)</span>}</div>
                <div className="blueprint-tick">Admin since {formatDate(String(a.created_at).slice(0, 10))}</div>
              </div>
              {confirming === a.user_id ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-[var(--color-muted)]">Remove?</span>
                  <button type="button" disabled={busy} onClick={() => handleRemove(a.user_id)} className="text-xs rounded px-2 py-1 bg-[var(--color-ember)] text-[var(--color-ink)] font-semibold">Remove</button>
                  <button type="button" onClick={() => setConfirming(null)} className="text-xs px-2 py-1 text-[var(--color-muted)]">Cancel</button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy || admins.length <= 1}
                  title={admins.length <= 1 ? 'There must always be at least one admin' : undefined}
                  onClick={() => setConfirming(a.user_id)}
                  className={`${smallBtn} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleAdd} className="space-y-2">
        <label htmlFor="add-admin-email" className="blueprint-tick uppercase block">Add an admin</label>
        <div className="flex gap-2">
          <input id="add-admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their DayForge sign-in email" className={inputCls} />
          <button type="submit" disabled={busy || !email.trim()} className="shrink-0 text-sm bg-[var(--color-ember)] text-[var(--color-ink)] font-semibold rounded px-3 py-2 hover:brightness-110 transition disabled:opacity-50">
            Add admin
          </button>
        </div>
        <p className="text-xs text-[var(--color-muted)]">They need a DayForge account first. The change applies the next time they open DayForge.</p>
      </form>
      {error && <p className="text-sm text-[var(--color-ember)]" role="alert">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- Panel
export default function AdminPanel({ changelog, currentUserId, initialTab = 'log', onClose }) {
  const [tab, setTab] = useState(initialTab)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let body
  if (tab === 'admins') body = <AdminsTab currentUserId={currentUserId} />
  else if (!changelog) body = <p className="text-sm text-[var(--color-muted)]">Loading the change log…</p>
  else if (changelog.unavailable) body = <p className="text-sm text-[var(--color-muted)]">The change log isn&apos;t available right now. Check your connection, or if this is a local copy, run guides/run.py to build it.</p>
  else body = tab === 'log' ? <ChangeLogTab changelog={changelog} /> : <CommitsTab changelog={changelog} />

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Admin"
        className="plate rounded-none sm:rounded-lg w-full h-full sm:h-auto sm:max-w-2xl sm:max-h-[88vh] flex flex-col rise-in"
        style={{ '--accent': 'var(--color-steel)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3 border-b border-[var(--color-line)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="blueprint-tick uppercase">Admins only</p>
              <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-xl leading-tight">Admin</h2>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-[var(--color-muted)] hover:text-[var(--color-paper)]">✕</button>
          </div>
          <div className="flex gap-1 rounded border border-[var(--color-line)] p-1 bg-[var(--color-ink)]" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 text-sm rounded px-2 py-1.5 transition ${tab === t.id ? 'bg-[var(--color-surface-raised)] text-[var(--color-paper)] font-semibold' : 'text-[var(--color-muted)] hover:text-[var(--color-paper)]'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{body}</div>
      </div>
    </div>
  )
}
