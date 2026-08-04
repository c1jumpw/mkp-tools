/**
 * =============================================================================
 * FILE: src/components/TaskBlock.jsx
 * VERSION: v4 (previously v1-v3 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Renders a single task/reminder/event as a "plate" card — used in both
 *   the Timeline (scheduled tasks) and the UnscheduledTray (tray items).
 *
 * KEY RESPONSIBILITIES
 *   - Expose a small DEDICATED DRAG HANDLE (grip icon) as the only draggable
 *     region — see IMPORTANT MOBILE UX FIX below for why the whole card is
 *     no longer draggable.
 *   - Show a checkbox to toggle completion for a given date instance.
 *   - Open the edit modal on tap/click of the main body (onEdit).
 *   - Offer an inline delete ("✕") button.
 *
 * PROPS
 *   task       {object}   The task row from Supabase (id, title, type, category, ...).
 *   completed  {boolean}  Whether THIS date's occurrence is marked done.
 *   onToggle   {function} Called with no args; toggles completion for this date.
 *   onEdit     {function} Called with no args; opens TaskModal for this task.
 *   onDelete   {function} Optional. Called with no args; deletes the task entirely.
 *   dense      {boolean}  Optional. Slightly tighter vertical padding (tray use).
 *
 * IMPORTANT MOBILE UX FIX (v4)
 *   v1-v3 made the ENTIRE card a drag source using dnd-kit's useDraggable,
 *   which required `touch-action: none` on that element so the browser
 *   wouldn't fight the drag gesture. The problem: `touch-action: none` also
 *   PERMANENTLY blocks native scrolling on that element — not just during an
 *   active drag, but always. Mobile testing surfaced the result: touching a
 *   card to scroll the page either failed to scroll, or (if the finger
 *   lifted without much movement) registered as a tap and opened the edit
 *   modal — an "accidental edit while scrolling" bug.
 *
 *   Fix: only the small grip-icon handle (⠿) carries the drag listeners and
 *   `touch-action: none`. The rest of the card has normal touch-action, so
 *   scrolling over it works exactly like scrolling over plain text. dnd-kit
 *   supports this natively — `setNodeRef` (which tracks the draggable
 *   element's position) stays on the card root, while `{...listeners}` and
 *   `{...attributes}` (which start the drag gesture) move to just the
 *   handle button. This is dnd-kit's documented "drag handle" pattern.
 *
 * REVISION HISTORY
 *   v1 (initial build) — whole card draggable, click-to-edit body.
 *   v2 — added the onDelete prop and its button.
 *   v3 — added h-full so the plate fills duration-proportional heights.
 *   v4 (this version) — replaced whole-card dragging with a dedicated grip
 *       handle (see IMPORTANT MOBILE UX FIX above), fixing the accidental-
 *       edit-while-scrolling bug found in mobile testing. Also removed the
 *       now-redundant `cursor-grab`/`touch-none` from the root element.
 * =============================================================================
 */

import { useDraggable } from '@dnd-kit/core'
import { formatTimeLabel } from '../lib/recurrence'

// Small glyphs standing in for each task "type" — kept as a lookup table so
// adding a new type later just means adding one entry here.
const TYPE_ICON = { todo: '☐', reminder: '◆', event: '▣' }

export default function TaskBlock({ task, completed, onToggle, onEdit, onDelete, dense }) {
  // useDraggable wires up the drag SOURCE. `setNodeRef` tracks the card
  // (so dnd-kit knows what to visually translate during a drag), but
  // `listeners`/`attributes` — the actual gesture activators — are applied
  // ONLY to the small handle button below, not the card root.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })

  // Work tasks get the cool steel accent stripe; personal tasks get ember.
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
      className={
        'plate rounded-md px-2.5 h-full ' + (dense ? 'py-1.5' : 'py-2')
      }
    >
      <div className="flex items-start gap-2">
        {/* Completion checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          className={
            'mt-0.5 w-4 h-4 rounded-sm border flex-shrink-0 flex items-center justify-center text-[10px] ' +
            (completed ? 'bg-[var(--color-good)] border-[var(--color-good)] text-[var(--color-ink)]' : 'border-[var(--color-line)]')
          }
          aria-label={completed ? 'Mark not done' : 'Mark done'}
        >
          {completed ? '✓' : ''}
        </button>

        {/* Main body — tapping/clicking here opens the edit modal. Has NO
            drag listeners and normal touch-action, so it scrolls naturally. */}
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

        {/* Delete button */}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (window.confirm(`Delete "${task.title}"?`)) onDelete()
            }}
            className="flex-shrink-0 text-[var(--color-muted)] hover:text-[var(--color-ember)] text-xs px-0.5 transition"
            aria-label={`Delete ${task.title}`}
          >
            ✕
          </button>
        )}

        {/* Drag handle — the ONLY draggable region on this card. touch-none
            is scoped to just this small element, so it doesn't interfere
            with scrolling anywhere else on the card. */}
        <button
          {...listeners}
          {...attributes}
          className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none text-[var(--color-muted)] hover:text-[var(--color-paper)] px-0.5 text-sm leading-none"
          aria-label={`Drag to reschedule ${task.title}`}
          title="Drag to reschedule"
        >
          ⠿
        </button>
      </div>
    </div>
  )
}
