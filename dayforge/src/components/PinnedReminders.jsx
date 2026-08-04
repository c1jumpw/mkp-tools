import { useState } from 'react'

// Always-visible pinned reminders, not tied to any time block.
export default function PinnedReminders({ tasks, onAdd, onToggle, onDelete }) {
  const [text, setText] = useState('')
  const pinned = tasks.filter((t) => t.pinned)

  async function handleAdd(e) {
    e.preventDefault()
    if (!text.trim()) return
    await onAdd(text.trim())
    setText('')
  }

  return (
    <div className="plate rounded-lg p-4" style={{ '--accent': 'var(--color-good)' }}>
      <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-lg mb-3">Pinned</h2>
      <div className="space-y-2 mb-3">
        {pinned.length === 0 && (
          <p className="text-sm text-[var(--color-muted)]">Nothing pinned yet. Add things worth keeping in view.</p>
        )}
        {pinned.map((t) => (
          <div key={t.id} className="flex items-start gap-2 group">
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
            <button
              onClick={() => onDelete(t.id)}
              className="opacity-0 group-hover:opacity-100 text-[var(--color-muted)] hover:text-[var(--color-ember)] text-xs transition"
              aria-label="Remove"
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
