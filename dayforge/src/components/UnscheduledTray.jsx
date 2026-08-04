/**
 * =============================================================================
 * FILE: src/components/UnscheduledTray.jsx
 * VERSION: v2 (previously v1 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Renders the "tray" — tasks that exist but have no date/time yet. This is
 *   both a drag SOURCE (drag a tray item onto the Timeline to schedule it)
 *   and a drag TARGET (drag a scheduled item back here to unschedule it).
 *
 * KEY RESPONSIBILITIES
 *   - Register itself as a dnd-kit droppable zone with id 'tray' — Dashboard's
 *     handleDragEnd looks for exactly this id to know "unschedule this task".
 *   - Render each tray task as a TaskBlock, wired to delete/complete/edit.
 *
 * PROPS
 *   tasks             {array}    Tasks with no date/time (or today's dated-but-
 *                                untimed tasks — see Dashboard's trayTasks calc).
 *   dateISO           {string}   The currently-selected day, 'YYYY-MM-DD'.
 *   isCompletedOn     {function} (task, dateISO) -> boolean.
 *   toggleCompletion  {function} (task, dateISO) -> Promise.
 *   onEdit            {function} (task) -> void; opens the edit modal.
 *   onDelete          {function} (task) -> void; permanently deletes a task.
 *
 * REVISION HISTORY
 *   v1 (initial build) — droppable tray rendering TaskBlocks without delete.
 *   v2 (this version) — wired the onDelete prop through to each TaskBlock so
 *       tray items can be removed directly, per user request.
 * =============================================================================
 */

import { useDroppable } from '@dnd-kit/core'
import TaskBlock from './TaskBlock'

export default function UnscheduledTray({ tasks, dateISO, isCompletedOn, toggleCompletion, onEdit, onDelete }) {
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
      <p className="text-xs text-[var(--color-muted)] mb-3">
        Unscheduled — drag into the timeline, or tap an item to set a date and time.
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
