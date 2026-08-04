/**
 * =============================================================================
 * FILE: src/components/Timeline.jsx
 * VERSION: v2 (previously v1 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Renders the selected day as a vertical hour-by-hour grid (5am-11pm), with
 *   scheduled tasks appearing inside the row for the hour they start in.
 *
 * KEY RESPONSIBILITIES
 *   - Build one droppable HourRow per hour so dnd-kit can detect "task X was
 *     dropped on hour Y" (id format: `hour-${hour}`, read by Dashboard).
 *   - Bucket + sort the day's scheduled tasks into their starting hour.
 *
 * PROPS
 *   dayTasks          {array}    Scheduled tasks (has start_time) for the
 *                                currently selected day, already recurrence-
 *                                expanded by Dashboard.
 *   dateISO           {string}   The currently-selected day, 'YYYY-MM-DD'.
 *   isCompletedOn     {function} (task, dateISO) -> boolean.
 *   toggleCompletion  {function} (task, dateISO) -> Promise.
 *   onEdit            {function} (task) -> void; opens the edit modal, where
 *                                the exact minute/duration can be fine-tuned
 *                                beyond the hour-level precision of drag/drop.
 *   onDelete          {function} (task) -> void; permanently deletes a task.
 *
 * ASSUMPTIONS / CONSTRAINTS
 *   - Drag-and-drop here only snaps to the HOUR (task lands at :00). Minute-
 *     level placement is intentionally left to the edit modal (TaskModal),
 *     since building pixel-accurate minute drag zones adds a lot of
 *     complexity for a marginal UX gain over "drag to the hour, then
 *     fine-tune in the modal if needed".
 *
 * REVISION HISTORY
 *   v1 (initial build) — hour rows with droppable zones, no delete action.
 *   v2 (this version) — wired the onDelete prop through to each TaskBlock so
 *       scheduled items can be removed directly from the timeline, matching
 *       the tray's delete behavior.
 * =============================================================================
 */

import { useDroppable } from '@dnd-kit/core'
import TaskBlock from './TaskBlock'
import { timeToMinutes } from '../lib/recurrence'

// Visible hour range for the timeline. Tasks outside this window (rare, e.g.
// a 4am wake-up) still SAVE fine — they just won't show a row here.
// TODO: if users report needing hours outside 5am-11pm, make this
// configurable per-user rather than a hardcoded constant. Safe to defer:
// no reports of this being a real need yet, and widening it just adds
// scroll length for the common case.
const START_HOUR = 5
const END_HOUR = 23

/**
 * Renders a single hour's droppable row, plus any tasks starting in that hour.
 * Not exported — an internal implementation detail of Timeline.
 */
function HourRow({ hour, tasks, dateISO, isCompletedOn, toggleCompletion, onEdit, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: `hour-${hour}`, data: { hour } })
  const label = formatHour(hour)

  return (
    <div className="flex border-b border-[var(--color-line)] last:border-b-0">
      <div className="w-14 flex-shrink-0 pt-2 pr-2 text-right blueprint-tick">{label}</div>
      <div
        ref={setNodeRef}
        className={
          'flex-1 min-h-16 py-1.5 px-2 space-y-1.5 transition-colors ' +
          (isOver ? 'bg-[var(--color-surface-raised)]' : '')
        }
      >
        {tasks.map((t) => (
          <TaskBlock
            key={t.id}
            task={t}
            completed={isCompletedOn(t, dateISO)}
            onToggle={() => toggleCompletion(t, dateISO)}
            onEdit={() => onEdit(t)}
            onDelete={() => onDelete(t)}
          />
        ))}
      </div>
    </div>
  )
}

// Formats an hour-of-day integer (0-23) as a 12-hour clock label, e.g. 14 -> "2 PM".
function formatHour(h) {
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${period}`
}

export default function Timeline({ dayTasks, dateISO, isCompletedOn, toggleCompletion, onEdit, onDelete }) {
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

  return (
    <div className="plate rounded-lg overflow-hidden">
      <div className="px-4 pt-3 pb-1">
        <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-lg">Timeline</h2>
      </div>
      <div className="max-h-[65vh] overflow-y-auto">
        {hours.map((h) => {
          // Bucket this hour's tasks: must have a start_time AND that time's
          // hour component must match. Sorted so multiple tasks in the same
          // hour appear in chronological (not insertion) order.
          const tasks = dayTasks
            .filter((t) => t.start_time && Math.floor(timeToMinutes(t.start_time) / 60) === h)
            .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
          return (
            <HourRow
              key={h}
              hour={h}
              tasks={tasks}
              dateISO={dateISO}
              isCompletedOn={isCompletedOn}
              toggleCompletion={toggleCompletion}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          )
        })}
      </div>
    </div>
  )
}
