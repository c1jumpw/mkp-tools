/**
 * =============================================================================
 * FILE: src/components/TaskBlock.jsx
 * VERSION: v2 (previously v1 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Renders a single task/reminder/event as a draggable "plate" — used both in
 *   the Timeline (scheduled tasks) and the UnscheduledTray (tray items).
 *
 * KEY RESPONSIBILITIES
 *   - Make itself draggable via @dnd-kit's useDraggable, so Dashboard's
 *     DndContext can detect drops onto timeline hour-rows or back into the tray.
 *   - Show a checkbox to toggle completion for a given date instance.
 *   - Open the edit modal on tap/click (via onEdit) so the user can change
 *     type/category/notes, or set/clear a date+time — this is the *alternate*
 *     path to scheduling a task for touch devices where drag-and-drop is
 *     less reliable than on desktop.
 *   - Offer an inline delete ("✕") button so tray/timeline items can be
 *     removed without opening the full edit modal first.
 *
 * PROPS
 *   task       {object}   The task row from Supabase (id, title, type, category, ...).
 *   completed  {boolean}  Whether THIS date's occurrence is marked done.
 *   onToggle   {function} Called with no args; toggles completion for this date.
 *   onEdit     {function} Called with no args; opens TaskModal for this task.
 *   onDelete   {function} Optional. Called with no args; deletes the task entirely.
 *                         Omit this prop to hide the delete button (not currently
 *                         used anywhere, but kept optional for flexibility).
 *   dense      {boolean}  Optional. Slightly tighter vertical padding, used in
 *                         the tray where more items need to fit in less space.
 *
 * IMPORTANT INTERACTION DETAIL
 *   This component renders three separately-clickable regions (checkbox, main
 *   body, delete button) INSIDE one drag-handle. Every non-drag control calls
 *   e.stopPropagation() on both onPointerDown and onClick so a tap on them
 *   doesn't get eaten by dnd-kit's drag-start listener, and doesn't trigger
 *   the drag itself. The actual click-vs-drag disambiguation (so a plain tap
 *   opens the modal instead of "dragging" a few pixels) is handled by the
 *   PointerSensor's `activationConstraint: { distance: 8 }` configured in
 *   Dashboard.jsx — a drag only begins once the pointer has moved 8px.
 *
 * REVISION HISTORY
 *   v1 (initial build) — draggable block with checkbox + click-to-edit body.
 *   v2 (this version) — added the onDelete prop and its button, per user
 *       request to allow removing tray items without opening the edit modal.
 * =============================================================================
 */

import { useDraggable } from '@dnd-kit/core'
import { formatTimeLabel } from '../lib/recurrence'

// Small glyphs standing in for each task "type" — kept as a lookup table so
// adding a new type later just means adding one entry here.
const TYPE_ICON = { todo: '☐', reminder: '◆', event: '▣' }

export default function TaskBlock({ task, completed, onToggle, onEdit, onDelete, dense }) {
  // useDraggable wires this whole element up as a drag source. `data: { task }`
  // is how Dashboard's handleDragEnd knows WHICH task was dropped, since
  // dnd-kit only gives us IDs by default.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })

  // Work tasks get the cool steel accent stripe; personal tasks get ember.
  // This is purely visual (see .plate::before in index.css).
  const accent = task.category === 'work' ? 'var(--color-steel)' : 'var(--color-ember)'

  const style = {
    '--accent': accent,
    // While dragging, dnd-kit reports a live pixel offset via `transform` —
    // we apply it directly rather than letting the item actually move in
    // the DOM, which keeps the drop-target hour-row calculations stable.
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
        {/* Completion checkbox — stopPropagation on both events so this never
            starts a drag or bubbles into onEdit. */}
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

        {/* Main body — tapping/clicking here opens the edit modal. On mobile,
            this is the primary way to give a tray item a date/time, since
            precise drag-and-drop is harder on a touchscreen. */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
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

        {/* Delete button — only rendered when the caller passes onDelete.
            Confirms before deleting since this is a destructive, non-undoable
            action (no "trash/restore" concept in this schema). */}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (window.confirm(`Delete "${task.title}"?`)) onDelete()
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex-shrink-0 text-[var(--color-muted)] hover:text-[var(--color-ember)] text-xs px-1 transition"
            aria-label={`Delete ${task.title}`}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
