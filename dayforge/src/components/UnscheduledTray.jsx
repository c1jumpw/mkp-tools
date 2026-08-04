/**
 * =============================================================================
 * FILE: src/components/UnscheduledTray.jsx
 * VERSION: v3 (previously v1, v2 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Renders the "tray" — tasks that exist but have no date/time yet. Drag
 *   source AND drop target (see Dashboard's handleDragEnd for the 'tray' id).
 *
 * PROPS
 *   tasks             {array}    Tasks with no date/time (see Dashboard's
 *                                trayTasks calc for exact composition).
 *   dateISO           {string}   The currently-selected day, 'YYYY-MM-DD'.
 *   isCompletedOn     {function} (task, dateISO) -> boolean.
 *   toggleCompletion  {function} (task, dateISO) -> Promise.
 *   onEdit            {function} (task) -> void; opens the edit modal.
 *   onDelete          {function} (task) -> void; permanently deletes one task.
 *   onClearAll        {function} () -> Promise; deletes every tray task at once.
 *
 * REVISION HISTORY
 *   v1 (initial build) — droppable tray rendering TaskBlocks, no delete.
 *   v2 — wired per-item onDelete through to TaskBlock.
 *   v3 (this version) — added a "Clear tray" action (with a window.confirm
 *       guard, since it's destructive) to empty the tray in one tap, per
 *       user request after mobile testing.
 * =============================================================================
 */

import { useDroppable } from '@dnd-kit/core'
import TaskBlock from './TaskBlock'

export default function UnscheduledTray({ tasks, dateISO, isCompletedOn, toggleCompletion, onEdit, onDelete, onClearAll }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'tray' })

  function handleClearAll() {
    if (tasks.length === 0) return
    if (window.confirm(`Remove all ${tasks.length} item${tasks.length > 1 ? 's' : ''} from the tray? This can't be undone.`)) {
      onClearAll()
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={
        'plate rounded-lg p-4 transition-colors ' + (isOver ? 'bg-[var(--color-surface-raised)]' : '')
      }
      style={{ '--accent': 'var(--color-muted)' }}
    >
      <div className="flex items-center justify-between mb-1">
        <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-lg">Tray</h2>
        {tasks.length > 0 && (
          <button
            onClick={handleClearAll}
            className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] hover:text-[var(--color-ember)] transition"
          >
            Clear tray
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--color-muted)] mb-3">
        Unscheduled — drag the handle into the timeline, or tap an item to set a date and time.
      </p>
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
            onDelete={() => onDelete(t)}
            dense
          />
        ))}
      </div>
    </div>
  )
}
