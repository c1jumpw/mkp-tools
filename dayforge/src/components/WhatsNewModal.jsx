/**
 * =============================================================================
 * FILE: src/components/WhatsNewModal.jsx
 * VERSION: v1 (2026-11-20)
 * =============================================================================
 * PURPOSE
 *   The card that greets someone after an update: every release they
 *   haven't seen yet, newest first, already filtered to what their role
 *   may see (hooks/useOnboarding.js decides when it opens and what's in it).
 *
 * PROPS
 *   releases         role-filtered unseen releases, newest first (non-empty)
 *   role             'admin' | 'user' — admins also get "Full change log"
 *                    and the "Admins" tag on admin-only items
 *   onClose          "Got it" / ✕ / backdrop / Escape — marks them seen
 *   onOpenChangelog  admins: close this and open ⋮ › Admin › Change log
 *
 * EDGE CASES
 *   - Long absences: at most MAX_RELEASES are shown; the rest are counted
 *     ("+ 4 earlier updates") so the card never becomes a wall of text.
 * =============================================================================
 */

import { useEffect, useRef } from 'react'
import ChangeItem from './ChangeItem'
import { formatDate } from '../lib/changelog'

const MAX_RELEASES = 4

/** Four-point spark, the card's emblem. */
function Spark({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6L12 22.5l-2.6-7.9L1.5 12l7.9-2.6z" fill="currentColor" />
    </svg>
  )
}

export default function WhatsNewModal({ releases, role, onClose, onOpenChangelog }) {
  const okRef = useRef(null)
  const shown = releases.slice(0, MAX_RELEASES)
  const hidden = releases.length - shown.length
  const isAdmin = role === 'admin'

  useEffect(() => {
    okRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="plate rounded-lg w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden rise-in"
        style={{ '--accent': 'var(--color-ember)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header band: ember glow behind the spark emblem. */}
        <div className="relative px-5 pt-5 pb-4 border-b border-[var(--color-line)] overflow-hidden">
          <div
            className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full opacity-25 blur-2xl"
            style={{ background: 'radial-gradient(circle, var(--color-ember) 0%, transparent 70%)' }}
          />
          <div className="relative flex items-start gap-3">
            <div className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center bg-[var(--color-ember)] text-[var(--color-ink)] shadow-[0_0_0_4px_var(--color-ember-soft)]">
              <Spark className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="blueprint-tick uppercase">
                {releases.length === 1 ? 'Updated ' + formatDate(releases[0].date) : `${releases.length} updates since your last visit`}
              </p>
              <h2 id="whats-new-title" className="[font-family:var(--font-display)] uppercase tracking-wide text-2xl leading-tight">
                What&apos;s new
              </h2>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-[var(--color-muted)] hover:text-[var(--color-paper)] -mt-1">✕</button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          {shown.map((r) => (
            <section key={r.id}>
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <h3 className="font-semibold text-[15px] leading-tight">{r.title}</h3>
                <span className="blueprint-tick shrink-0">{formatDate(r.date)}</span>
              </div>
              <ul>
                {r.items.map((it, i) => <ChangeItem key={i} item={it} showAudience={isAdmin} />)}
              </ul>
            </section>
          ))}
          {hidden > 0 && (
            <p className="text-xs text-[var(--color-muted)]">
              + {hidden} earlier update{hidden === 1 ? '' : 's'}{isAdmin ? ' — see the full change log.' : '.'}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--color-line)]">
          {isAdmin && (
            <button
              onClick={onOpenChangelog}
              className="text-sm text-[var(--color-muted)] hover:text-[var(--color-paper)] px-3 py-2"
            >
              Full change log
            </button>
          )}
          <button
            ref={okRef}
            onClick={onClose}
            className="text-sm bg-[var(--color-ember)] text-[var(--color-ink)] font-semibold rounded px-4 py-2 hover:brightness-110 transition"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
