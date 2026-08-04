/**
 * =============================================================================
 * FILE: src/components/PinnedReminders.jsx
 * VERSION: v2 (previously v1 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Always-visible pinned reminders (no time slot). Quick-add form at the
 *   bottom, list of pinned items above with a toggle-complete checkbox and a
 *   remove button on each.
 *
 * PROPS
 *   tasks       {array}    Full task list; this component filters to pinned ones.
 *   onAdd       {function} (title) -> Promise; creates a new pinned reminder.
 *   onToggle    {function} (task) -> Promise; flips completed on/off.
 *   onDelete    {function} (id) -> Promise; deletes one pinned item.
 *   onClearAll  {function} () -> Promise; deletes ALL pinned items at once.
 *
 * REVISION HISTORY
 *   v1 (initial build) — the per-item remove button used
 *       `opacity-0 group-hover:opacity-100`, which relies on a CSS :hover
 *       state. Touch devices have no reliable hover state, so on mobile the
 *       remove button was effectively invisible/unreachable — a real bug,
 *       not just a cosmetic choice.
 *   v2 (this version) — per user testing on mobile:
 *     - Removed the hover-only visibility; the remove button is now always
 *       shown (still de-emphasized via muted color so it doesn't compete
 *       visually with the title, but it's tappable on any device).
 *     - Added a "Clear all" action (with a window.confirm guard, since it's
 *       destructive and irreversible) to quickly empty the pinned list.
 * =============================================================================
 */

import { useState } from 'react'

export default function PinnedReminders({ tasks, onAdd, onToggle, onDelete, onClearAll }) {
  const [text, setText] = useState('')
  const pinned = tasks.filter((t) => t.pinned)

  async function handleAdd(e) {
    e.preventDefault()
    if (!text.trim()) return
    await onAdd(text.trim())
    setText('')
  }

  function handleClearAll() {
    if (pinned.length === 0) return
    if (window.confirm(`Remove all ${pinned.length} pinned reminder${pinned.length > 1 ? 's' : ''}? This can't be undone.`)) {
      onClearAll()
    }
  }

  return (
    <div className="plate rounded-lg p-4" style={{ '--accent': 'var(--color-good)' }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-lg">Pinned</h2>
        {pinned.length > 0 && (
          <button
            onClick={handleClearAll}
            className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] hover:text-[var(--color-ember)] transition"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="space-y-2 mb-3">
        {pinned.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">Nothing pinned yet. Add things worth keeping in view.</p>
        )}
        {pinned.map((t) => (
          <div key={t.id} className="flex items-start gap-2">
            <button
              onClick={() => onToggle(t)}
              aria-label={t.completed ? 'Mark not done' : 'Mark done'}
              className={
                'mt-0.5 w-4 h-4 rounded-sm border flex-shrink-0 ' +
                (t.completed ? 'bg-[var(--color-good)] border-[var(--color-good)]' : 'border-[var(--color-line)]')
              }
            />
            <span className={'text-sm flex-1 ' + (t.completed ? 'line-through text-[var(--color-muted)]' : '')}>
              {t.title}
            </span>
            {/* Always visible (not hover-gated) so it works on touch devices. */}
            <button
              onClick={() => onDelete(t.id)}
              className="text-[var(--color-muted)] hover:text-[var(--color-ember)] text-xs px-1 transition"
              aria-label={`Remove ${t.title}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Pin a reminder…"
          className="flex-1 bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2.5 py-1.5 text-sm focus:border-[var(--color-good)] outline-none"
        />
        <button className="text-xs bg-[var(--color-good)] text-[var(--color-ink)] font-semibold rounded px-3 hover:brightness-110 transition">
          Pin
        </button>
      </form>
    </div>
  )
}
