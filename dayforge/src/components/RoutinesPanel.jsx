import { useState } from 'react'

export default function RoutinesPanel({
  routines,
  routineItems,
  onCreateRoutine,
  onDeleteRoutine,
  onAddItem,
  onDeleteItem,
  onApply,
  dateISO,
  onClose,
}) {
  const [newRoutineName, setNewRoutineName] = useState('')
  const [openRoutineId, setOpenRoutineId] = useState(null)
  const [itemDraft, setItemDraft] = useState({ title: '', category: 'personal', type: 'todo', start_time: '08:00', duration_minutes: 30 })

  async function handleCreate(e) {
    e.preventDefault()
    if (!newRoutineName.trim()) return
    const r = await onCreateRoutine(newRoutineName.trim())
    setNewRoutineName('')
    setOpenRoutineId(r.id)
  }

  async function handleAddItem(routineId) {
    if (!itemDraft.title.trim()) return
    await onAddItem(routineId, itemDraft)
    setItemDraft({ ...itemDraft, title: '' })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="plate rounded-lg w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 rise-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-xl">Routine templates</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-paper)]">✕</button>
        </div>

        <form onSubmit={handleCreate} className="flex gap-2 mb-4">
          <input
            value={newRoutineName}
            onChange={(e) => setNewRoutineName(e.target.value)}
            placeholder="New routine name (e.g. Morning Routine)"
            className="flex-1 bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm focus:border-[var(--color-ember)] outline-none"
          />
          <button className="bg-[var(--color-ember)] text-[var(--color-ink)] text-sm font-semibold rounded px-3 hover:brightness-110">
            Create
          </button>
        </form>

        <div className="space-y-3">
          {routines.length === 0 && (
            <p className="text-sm text-[var(--color-muted)]">No routines yet. Create one above, e.g. "Gym Day" or "Morning Routine".</p>
          )}
          {routines.map((r) => {
            const items = routineItems.filter((i) => i.routine_id === r.id)
            const isOpen = openRoutineId === r.id
            return (
              <div key={r.id} className="border border-[var(--color-line)] rounded-md">
                <div className="flex items-center justify-between px-3 py-2">
                  <button onClick={() => setOpenRoutineId(isOpen ? null : r.id)} className="text-sm font-medium text-left flex-1">
                    {r.name} <span className="text-[var(--color-muted)] font-normal">({items.length} item{items.length !== 1 ? 's' : ''})</span>
                  </button>
                  <button
                    onClick={() => onApply(r.id, dateISO)}
                    disabled={items.length === 0}
                    className="text-xs bg-[var(--color-steel)] disabled:opacity-30 text-[var(--color-ink)] font-semibold rounded px-2.5 py-1 mr-2 hover:brightness-110"
                  >
                    Apply to day
                  </button>
                  <button onClick={() => onDeleteRoutine(r.id)} className="text-[var(--color-muted)] hover:text-[var(--color-ember)] text-xs">
                    Delete
                  </button>
                </div>
                {isOpen && (
                  <div className="border-t border-[var(--color-line)] p-3 space-y-2">
                    {items.map((i) => (
                      <div key={i.id} className="flex items-center gap-2 text-sm">
                        <span className="[font-family:var(--font-mono)] text-xs text-[var(--color-muted)] w-14">{i.start_time?.slice(0, 5)}</span>
                        <span className="flex-1">{i.title}</span>
                        <span className="text-xs text-[var(--color-muted)]">{i.duration_minutes}m</span>
                        <button onClick={() => onDeleteItem(i.id)} className="text-[var(--color-muted)] hover:text-[var(--color-ember)] text-xs">✕</button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-1.5 items-center pt-2">
                      <input
                        value={itemDraft.title}
                        onChange={(e) => setItemDraft({ ...itemDraft, title: e.target.value })}
                        placeholder="Item title"
                        className="flex-1 min-w-[120px] bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1 text-xs"
                      />
                      <input
                        type="time"
                        value={itemDraft.start_time}
                        onChange={(e) => setItemDraft({ ...itemDraft, start_time: e.target.value })}
                        className="bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1 text-xs"
                      />
                      <input
                        type="number"
                        min={5}
                        step={5}
                        value={itemDraft.duration_minutes}
                        onChange={(e) => setItemDraft({ ...itemDraft, duration_minutes: Number(e.target.value) })}
                        className="w-16 bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1 text-xs"
                      />
                      <select
                        value={itemDraft.category}
                        onChange={(e) => setItemDraft({ ...itemDraft, category: e.target.value })}
                        className="bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-1 py-1 text-xs"
                      >
                        <option value="personal">Personal</option>
                        <option value="work">Work</option>
                      </select>
                      <button
                        onClick={() => handleAddItem(r.id)}
                        className="text-xs bg-[var(--color-ember)] text-[var(--color-ink)] font-semibold rounded px-2 py-1 hover:brightness-110"
                      >
                        Add item
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
