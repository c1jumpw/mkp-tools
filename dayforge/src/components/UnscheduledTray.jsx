import { useDroppable } from '@dnd-kit/core'
import TaskBlock from './TaskBlock'

// Tasks with no time slot yet. Drag one onto the timeline to block it in,
// or drag a scheduled task back here to unschedule it.
export default function UnscheduledTray({ tasks, dateISO, isCompletedOn, toggleCompletion, onEdit }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'tray' })

  return (
    <div
      ref={setNodeRef}
      className={
        'plate rounded-lg p-4 transition-colors ' + (isOver ? 'bg-[var(--color-surface-raised)]' : '')
      }
      style={{ '--accent': 'var(--color-muted)' }}
    >
      <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-lg mb-1">Tray</h2>
      <p className="text-xs text-[var(--color-muted)] mb-3">Unscheduled — drag into the timeline to block it in.</p>
      <div className="space-y-1.5 min-h-12">
        {tasks.length === 0 && (
          <p className="text-sm text-[var(--color-muted)] italic">Empty. Nice.</p>
        )}
        {tasks.map((t) => (
          <TaskBlock
            key={t.id}
            task={t}
            completed={isCompletedOn(t, dateISO)}
            onToggle={() => toggleCompletion(t, dateISO)}
            onEdit={() => onEdit(t)}
            dense
          />
        ))}
      </div>
    </div>
  )
}
