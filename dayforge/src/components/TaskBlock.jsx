import { useDraggable } from '@dnd-kit/core'
import { formatTimeLabel } from '../lib/recurrence'

const TYPE_ICON = { todo: '☐', reminder: '◆', event: '▣' }

export default function TaskBlock({ task, completed, onToggle, onEdit, dense }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })

  const accent = task.category === 'work' ? 'var(--color-steel)' : 'var(--color-ember)'

  const style = {
    '--accent': accent,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={
        'plate rounded-md px-3 cursor-grab active:cursor-grabbing touch-none ' +
        (dense ? 'py-1.5' : 'py-2')
      }
    >
      <div className="flex items-start gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          onPointerDown={(e) => e.stopPropagation()}
          className={
            'mt-0.5 w-4 h-4 rounded-sm border flex-shrink-0 flex items-center justify-center text-[10px] ' +
            (completed ? 'bg-[var(--color-good)] border-[var(--color-good)] text-[var(--color-ink)]' : 'border-[var(--color-line)]')
          }
          aria-label={completed ? 'Mark not done' : 'Mark done'}
        >
          {completed ? '✓' : ''}
        </button>
        <div className="flex-1 min-w-0" onClick={onEdit}>
          <div className="flex items-center gap-1.5">
            <span className="text-xs opacity-70">{TYPE_ICON[task.type]}</span>
            <span className={'text-sm truncate ' + (completed ? 'line-through text-[var(--color-muted)]' : '')}>
              {task.title}
            </span>
            {task.recurrence !== 'none' && (
              <span className="text-[10px] text-[var(--color-muted)] [font-family:var(--font-mono)]" title={`Repeats ${task.recurrence}`}>
                ↻
              </span>
            )}
          </div>
          {task.start_time && (
            <span className="text-[10px] [font-family:var(--font-mono)] text-[var(--color-muted)]">
              {formatTimeLabel(task.start_time)} · {task.duration_minutes}m
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
