import { useState } from 'react'

// Notepad-style rapid entry: one task per line, added unscheduled (lands in the tray).
export default function QuickAdd({ onAddLines }) {
  const [text, setText] = useState('')
  const [category, setCategory] = useState('personal')
  const [type, setType] = useState('todo')
  const [busy, setBusy] = useState(false)

  async function handleAdd() {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return
    setBusy(true)
    try {
      await onAddLines(lines.map((title) => ({ title, category, type })))
      setText('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="plate rounded-lg p-4" style={{ '--accent': 'var(--color-ember)' }}>
      <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-lg mb-3">Quick add</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Dump tasks, one per line…\ne.g. Call dentist\nFinish slide deck\nBuy groceries'}
        rows={4}
        className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm resize-none focus:border-[var(--color-ember)] outline-none"
      />
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <SegButton options={['personal', 'work']} value={category} onChange={setCategory} />
        <SegButton options={['todo', 'reminder', 'event']} value={type} onChange={setType} />
        <button
          onClick={handleAdd}
          disabled={busy || !text.trim()}
          className="ml-auto bg-[var(--color-ember)] disabled:opacity-40 text-[var(--color-ink)] text-sm font-semibold rounded px-4 py-1.5 hover:brightness-110 transition"
        >
          Add to tray
        </button>
      </div>
    </div>
  )
}

function SegButton({ options, value, onChange }) {
  return (
    <div className="flex text-xs rounded overflow-hidden border border-[var(--color-line)]">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={
            'px-2.5 py-1 capitalize transition ' +
            (value === opt
              ? 'bg-[var(--color-steel)] text-[var(--color-ink)] font-medium'
              : 'bg-transparent text-[var(--color-muted)] hover:text-[var(--color-paper)]')
          }
        >
          {opt}
        </button>
      ))}
    </div>
  )
}
