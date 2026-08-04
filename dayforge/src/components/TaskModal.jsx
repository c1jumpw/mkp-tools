import { useState } from 'react'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function TaskModal({ task, defaultDate, onSave, onDelete, onClose }) {
  const isNew = !task
  const [title, setTitle] = useState(task?.title || '')
  const [notes, setNotes] = useState(task?.notes || '')
  const [type, setType] = useState(task?.type || 'todo')
  const [category, setCategory] = useState(task?.category || 'personal')
  const [pinned, setPinned] = useState(task?.pinned || false)
  const [scheduled, setScheduled] = useState(isNew ? !!defaultDate : !!task?.date)
  const [date, setDate] = useState(task?.date || defaultDate || '')
  const [startTime, setStartTime] = useState(task?.start_time?.slice(0, 5) || '09:00')
  const [duration, setDuration] = useState(task?.duration_minutes || 30)
  const [recurrence, setRecurrence] = useState(task?.recurrence || 'none')
  const [recurDays, setRecurDays] = useState(task?.recurrence_days || [])
  const [busy, setBusy] = useState(false)

  function toggleDay(i) {
    setRecurDays((prev) => (prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i].sort()))
  }

  async function handleSave() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await onSave({
        title: title.trim(),
        notes: notes.trim() || null,
        type,
        category,
        pinned,
        date: scheduled ? date : null,
        start_time: scheduled ? startTime : null,
        duration_minutes: scheduled ? Number(duration) : 30,
        recurrence: scheduled ? recurrence : 'none',
        recurrence_days: recurrence === 'weekly' ? recurDays : [],
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="plate rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto p-5 rise-in"
        onClick={(e) => e.stopPropagation()}
        style={{ '--accent': category === 'work' ? 'var(--color-steel)' : 'var(--color-ember)' }}
      >
        <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-xl mb-4">
          {isNew ? 'New task' : 'Edit task'}
        </h2>

        <label className="blueprint-tick uppercase block mb-1">Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm mb-3 focus:border-[var(--color-ember)] outline-none"
        />

        <label className="blueprint-tick uppercase block mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm mb-3 resize-none focus:border-[var(--color-ember)] outline-none"
        />

        <div className="flex gap-4 mb-3">
          <div className="flex-1">
            <label className="blueprint-tick uppercase block mb-1">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm">
              <option value="todo">To-do</option>
              <option value="reminder">Reminder</option>
              <option value="event">Event</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="blueprint-tick uppercase block mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm">
              <option value="personal">Personal</option>
              <option value="work">Work</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 mb-3 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin as a general reminder (always visible, no time slot)
        </label>

        <label className="flex items-center gap-2 mb-3 text-sm">
          <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />
          Give this a date and time block
        </label>

        {scheduled && (
          <div className="space-y-3 border-t border-[var(--color-line)] pt-3 mb-3">
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="blueprint-tick uppercase block mb-1">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm" />
              </div>
              <div className="flex-1">
                <label className="blueprint-tick uppercase block mb-1">Start time</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm" />
              </div>
            </div>
            <div>
              <label className="blueprint-tick uppercase block mb-1">Duration (minutes)</label>
              <input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="blueprint-tick uppercase block mb-1">Repeats</label>
              <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm mb-2">
                <option value="none">Doesn't repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly on selected days</option>
              </select>
              {recurrence === 'weekly' && (
                <div className="flex gap-1">
                  {DAY_LABELS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={
                        'w-9 h-9 text-xs rounded border ' +
                        (recurDays.includes(i)
                          ? 'bg-[var(--color-steel)] border-[var(--color-steel)] text-[var(--color-ink)] font-semibold'
                          : 'border-[var(--color-line)] text-[var(--color-muted)]')
                      }
                    >
                      {d[0]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mt-5">
          {!isNew && (
            <button
              onClick={() => onDelete(task.id).then(onClose)}
              className="text-sm text-[var(--color-ember)] hover:brightness-110 mr-auto"
            >
              Delete
            </button>
          )}
          <button onClick={onClose} className="text-sm text-[var(--color-muted)] hover:text-[var(--color-paper)] px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy || !title.trim()}
            className="bg-[var(--color-ember)] disabled:opacity-40 text-[var(--color-ink)] text-sm font-semibold rounded px-4 py-1.5 hover:brightness-110 transition"
          >
            {isNew ? 'Add task' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
