/**
 * =============================================================================
 * FILE: src/components/Timeline.jsx
 * VERSION: v3 (previously v1, v2 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Renders the selected day as a vertical hour grid (5am-11pm) with tasks
 *   drawn as blocks whose HEIGHT is proportional to their actual duration —
 *   a 90-minute task visibly taller than a 30-minute one — rather than every
 *   task rendering as an identical fixed-size row item.
 *
 * KEY RESPONSIBILITIES
 *   - Render one droppable "hour band" per hour (still used for drag-and-drop
 *     target detection — dropping a task snaps it to that hour's :00).
 *   - Absolutely position each task block within a shared day-length
 *     content column, using timelineLayout.js to compute pixel top/height
 *     from start_time + duration_minutes, and to place overlapping tasks in
 *     side-by-side lanes rather than stacked illegibly.
 *
 * PROPS — unchanged from v2, see previous revision's doc comment:
 *   dayTasks, dateISO, isCompletedOn, toggleCompletion, onEdit, onDelete
 *
 * LAYOUT STRUCTURE
 *   A two-column flex row: a fixed-width label gutter (hour labels, e.g.
 *   "9 AM") on the left, and a single relative-positioned "content column"
 *   on the right that is exactly `hours.length * HOUR_PX` tall. Both the
 *   hour drop-target bands AND the task blocks are absolutely positioned
 *   WITHIN that same content column, so their vertical math (top/height in
 *   pixels) lines up directly without any compensating offsets.
 *
 * LAYOUT MATH
 *   HOUR_PX = pixel height of one hour's band. MINUTE_PX = HOUR_PX / 60.
 *   A task starting at minute M (relative to START_HOUR) with duration D
 *   renders at `top: M * MINUTE_PX` with `height: D * MINUTE_PX`, clamped to
 *   a MIN_BLOCK_PX floor so very short tasks (e.g. 5 minutes) stay legible
 *   and tappable instead of shrinking to a sliver.
 *
 * WHY THE HOUR BANDS CAN SIT BEHIND THE TASK BLOCKS
 *   dnd-kit's collision detection compares the DRAGGED item's screen
 *   position against the registered bounding rectangles of all droppable
 *   elements — it does not care what's rendered visually on top of them.
 *   So the hour bands can sit behind the absolutely-positioned task blocks
 *   (earlier in the DOM, same stacking context) and dropping still
 *   correctly detects "this task was dropped on hour 14" even when a
 *   differently-sized task block visually overlaps that band.
 *
 * REVISION HISTORY
 *   v1 (initial build) — each hour a droppable row; tasks bucketed into
 *       their starting hour, rendered as ordinary same-height list items.
 *   v2 — added onDelete prop passthrough (see file's v2 history for detail).
 *   v3 (this version) — full rework to absolute positioning + proportional
 *       block heights via timelineLayout.js, per user request that items
 *       "should be stretched based on the duration" instead of all showing
 *       as identical hour-sized blocks.
 * =============================================================================
 */

import { useDroppable } from '@dnd-kit/core'
import TaskBlock from './TaskBlock'
import { layoutTasks } from '../lib/timelineLayout'

const START_HOUR = 5
const END_HOUR = 23
const HOUR_PX = 64            // pixel height of one hour band
const MINUTE_PX = HOUR_PX / 60
const MIN_BLOCK_PX = 30       // floor so very short tasks stay tappable/legible

/**
 * One hour's droppable background band, absolutely positioned within the
 * content column. Purely a drop target + gridline — no label (labels live
 * in the separate gutter column, see Timeline below) and no task content.
 */
function HourBand({ hour }) {
  const { setNodeRef, isOver } = useDroppable({ id: `hour-${hour}`, data: { hour } })
  return (
    <div
      ref={setNodeRef}
      className={'absolute left-0 right-0 border-b border-[var(--color-line)] transition-colors ' + (isOver ? 'bg-[var(--color-surface-raised)]' : '')}
      style={{ top: (hour - START_HOUR) * HOUR_PX, height: HOUR_PX }}
    />
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
  const containerHeight = hours.length * HOUR_PX
  const dayStartMin = START_HOUR * 60

  // Compute {task, startMin, endMin, lane, lanesInCluster} for every
  // scheduled task — see timelineLayout.js for the overlap/lane algorithm.
  const positioned = layoutTasks(dayTasks)

  return (
    <div className="plate rounded-lg overflow-hidden">
      <div className="px-4 pt-3 pb-1">
        <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-lg">Timeline</h2>
      </div>
      <div className="max-h-[65vh] overflow-y-auto">
        <div className="flex">
          {/* Label gutter — fixed width, one absolutely-positioned label per
              hour so its vertical rhythm matches the content column exactly. */}
          <div className="relative w-14 flex-shrink-0" style={{ height: containerHeight }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 blueprint-tick"
                style={{ top: (h - START_HOUR) * HOUR_PX + 4 }}
              >
                {formatHour(h)}
              </div>
            ))}
          </div>

          {/* Content column — hour drop-target bands behind, duration-sized
              task blocks on top, both positioned in the SAME coordinate
              space so no cross-column offset math is needed. */}
          <div className="relative flex-1" style={{ height: containerHeight }}>
            {hours.map((h) => <HourBand key={h} hour={h} />)}

            {positioned.map(({ task, startMin, endMin, lane, lanesInCluster }) => {
              const top = (startMin - dayStartMin) * MINUTE_PX
              const height = Math.max(MIN_BLOCK_PX, (endMin - startMin) * MINUTE_PX)
              const widthPct = 100 / lanesInCluster
              return (
                <div
                  key={task.id}
                  className="absolute px-1"
                  style={{ top, height, left: `${lane * widthPct}%`, width: `${widthPct}%` }}
                >
                  <div className="h-full overflow-hidden">
                    <TaskBlock
                      task={task}
                      completed={isCompletedOn(task, dateISO)}
                      onToggle={() => toggleCompletion(task, dateISO)}
                      onEdit={() => onEdit(task)}
                      onDelete={() => onDelete(task)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
