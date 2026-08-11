/**
 * =============================================================================
 * FILE: src/components/Dashboard.jsx
 * VERSION: v7 (previously v1-v6 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   The main authenticated screen: header (branding, actions, account menu),
 *   the two-column layout (quick-add/pinned sidebar + forecast/timeline/tray),
 *   and all the modals (task edit, routines, account). This is the "hub"
 *   component that owns which day is selected and wires the drag-and-drop
 *   context that lets tasks move between the tray and the timeline.
 *
 * KEY RESPONSIBILITIES
 *   - Own `selectedDate` (which day's timeline/tray is showing) and the
 *     various "is a modal open" pieces of state.
 *   - Derive `dayTasks` / `scheduled` / `trayTasks` from the raw task list
 *     returned by useDayForgeData, expanding recurrence via occursOnDate().
 *   - Configure dnd-kit's DndContext + sensors, and handle the drop logic
 *     (schedule into an hour, or unschedule back to the tray) — including
 *     an "Undo" safety net (see UNDO TOAST below).
 *
 * DATA FLOW
 *   useDayForgeData() (Supabase-backed) --> Dashboard (derives day-specific
 *   views) --> child components (QuickAdd, PinnedReminders, ForecastStrip,
 *   Timeline, UnscheduledTray, TaskModal, RoutinesPanel, AccountModal).
 *   Child components call back up into `data.*` functions passed down as
 *   props; Dashboard itself never talks to Supabase directly.
 *
 * UNDO TOAST (new in v4)
 *   Every drag-and-drop reschedule/unschedule snapshots the task's PREVIOUS
 *   date/start_time/recurrence before applying the change, then shows a
 *   small bottom toast with an "Undo" button for a few seconds. This is a
 *   lighter-weight alternative to a blocking "Are you sure?" dialog on every
 *   single drop (which would make routine drag-and-drop tedious) while still
 *   giving a real safety net against accidental drags — the underlying
 *   scenario reported was drags being misfired during mobile scrolling,
 *   which the TaskBlock.jsx v4 drag-handle fix addresses at the source; this
 *   toast is the backstop for anything that still slips through.
 *   TODO: if a blocking confirm-before-drop is preferred over this toast
 *   after living with it a while, swap the immediate data.updateTask() call
 *   in handleDragEnd for a pending-confirmation state instead — flagging
 *   this as a deliberate UX trade-off, not an oversight.
 *
 * REVISION HISTORY
 *   v1 (initial build) — core layout, DndContext with default sensor config,
 *       Routines/Sign out buttons in header.
 *   v2 — (see supabaseClient.js v2) no changes to this file.
 *   v3 — 8px pointer activation distance (tap-vs-drag fix), onDelete
 *       passthrough, theme toggle, account menu.
 *   v4 (this version), per user's mobile testing feedback batch:
 *     - Added the Undo toast described above for drag-triggered changes.
 *     - Added handleClearPinned / handleClearTray (bulk delete, with a
 *       window.confirm guard each lives in the child component that
 *       triggers it — PinnedReminders.jsx / UnscheduledTray.jsx).
 *     - TouchSensor's `delay`/`tolerance` activationConstraint is no longer
 *       load-bearing for "don't block scrolling" (that's now handled by
 *       TaskBlock.jsx v4's dedicated drag handle + scoped touch-action), but
 *       is kept as a reasonable default for the handle's own long-press feel.
 *   v5 (this version) — added an "Export" header dropdown with "Export this
 *       day" / "Export this week" actions, each generating a standard .ics
 *       calendar file (via lib/icsExport.js) and triggering a browser
 *       download, so the schedule can be imported into Google Calendar,
 *       Outlook, Apple Calendar, etc. See collectEventsForExport() for how
 *       recurring tasks are expanded into concrete per-date events for
 *       export (not re-encoded as iCalendar RRULEs — see icsExport.js for
 *       why).
 *   v6 (this version), per user feedback after using Export:
 *     - Replaced the plain "Export day / Export week" dropdown with a full
 *       ExportModal offering INDEPENDENT category (personal/work) and type
 *       (to-do/reminder/event) checkboxes that combine with AND logic —
 *       see ExportModal.jsx header comment for the UX reasoning (an "event"
 *       filter needs to combine with, not replace, personal/work, since a
 *       task can be a work event just as easily as a personal one).
 *     - Header: added safe-area-aware top padding and flex-wrap on the
 *       action-button row, after mobile testing found the top of the
 *       Routines/Export/+New task buttons hard to tap accurately on some
 *       smaller phones (buttons sat flush against the screen edge/notch
 *       area with no breathing room).
 *   v7 (this version) — passed setEditingTask through to PinnedReminders as
 *       its new onEdit prop, so pinned items can be tapped open to the full
 *       edit modal — previously the only place in the app without this
 *       (Timeline and UnscheduledTray items already supported it).
 * =============================================================================
 */

import { useMemo, useRef, useState } from 'react'
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useDayForgeData } from '../hooks/useDayForgeData'
import { occursOnDate, toISODate, addDays } from '../lib/recurrence'
import { buildICS, downloadICS } from '../lib/icsExport'
import QuickAdd from './QuickAdd'
import PinnedReminders from './PinnedReminders'
import ForecastStrip from './ForecastStrip'
import Timeline from './Timeline'
import UnscheduledTray from './UnscheduledTray'
import TaskModal from './TaskModal'
import RoutinesPanel from './RoutinesPanel'
import AccountModal from './AccountModal'
import ExportModal from './ExportModal'

const UNDO_TOAST_MS = 6000 // how long the "Undo" toast stays on screen

export default function Dashboard() {
  const { signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const data = useDayForgeData()

  const [selectedDate, setSelectedDate] = useState(new Date())
  const [editingTask, setEditingTask] = useState(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [routinesOpen, setRoutinesOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false) // small header dropdown: Account / Sign out
  const [exportOpen, setExportOpen] = useState(false) // Export options modal

  // Undo toast: { message, taskId, previousFields } | null.
  // previousFields holds exactly what to pass back to updateTask() to revert.
  const [undoToast, setUndoToast] = useState(null)
  const undoTimerRef = useRef(null)

  const dateISO = toISODate(selectedDate)

  // dnd-kit sensors. PointerSensor's 8px distance keeps plain taps from
  // misfiring as drags on desktop/trackpad. TouchSensor's delay+tolerance
  // gives the drag HANDLE (see TaskBlock.jsx v4) a deliberate long-press
  // feel on touch devices — it's no longer responsible for protecting
  // scrolling, since only the small handle carries touch-action:none now.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } })
  )

  // Scheduled + pinned-excluded tasks that occur on the selected day,
  // expanding recurrence rules via occursOnDate() (see lib/recurrence.js).
  const dayTasks = useMemo(
    () => data.tasks.filter((t) => !t.pinned && t.date && occursOnDate(t, selectedDate)),
    [data.tasks, selectedDate]
  )
  const scheduled = dayTasks.filter((t) => t.start_time)

  // Tray = tasks with no date at all, PLUS today's dated tasks that don't yet
  // have a start_time (e.g. added via a routine item with no time set).
  const unscheduledToday = useMemo(
    () => data.tasks.filter((t) => !t.pinned && !t.date && t.recurrence === 'none'),
    [data.tasks]
  )
  const trayTasks = [...unscheduledToday, ...dayTasks.filter((t) => !t.start_time)]

  // Per-day task counts for the 7-day forecast strip's little "N tasks" labels.
  const taskCountByDate = useMemo(() => {
    const counts = {}
    for (let i = 0; i < 7; i++) {
      const d = addDays(new Date(), i)
      const iso = toISODate(d)
      counts[iso] = data.tasks.filter((t) => !t.pinned && t.date && occursOnDate(t, d)).length
    }
    return counts
  }, [data.tasks])

  async function handleAddQuickLines(rows) {
    await data.addTasksBulk(rows)
  }

  async function handlePinAdd(title) {
    await data.addTask({ title, type: 'reminder', category: 'personal', pinned: true })
  }

  // "Clear all pins" — bulk-deletes every currently pinned task. The
  // confirmation prompt lives in PinnedReminders.jsx (closer to the button
  // the user actually taps), so by the time this runs, confirmation already
  // happened.
  async function handleClearPinned() {
    const ids = data.tasks.filter((t) => t.pinned).map((t) => t.id)
    await data.deleteTasksBulk(ids)
  }

  // "Clear tray" — bulk-deletes everything currently shown in the tray for
  // the selected day. Confirmation lives in UnscheduledTray.jsx.
  async function handleClearTray() {
    await data.deleteTasksBulk(trayTasks.map((t) => t.id))
  }

  /**
   * Collects every scheduled occurrence (expanding recurrence via
   * occursOnDate) across `numDays` days starting at `startDate`, filtered to
   * the chosen categories AND types (both must match — see ExportModal.jsx
   * header comment for why these are independent, combinable filters rather
   * than one flat set of choices), in the plain-object shape
   * icsExport.buildICS expects.
   * @param {Date} startDate
   * @param {number} numDays
   * @param {string[]} categories - subset of ['personal', 'work']
   * @param {string[]} types - subset of ['todo', 'reminder', 'event']
   */
  function collectEventsForExport(startDate, numDays, categories, types) {
    const events = []
    for (let i = 0; i < numDays; i++) {
      const d = addDays(startDate, i)
      const iso = toISODate(d)
      const occurring = data.tasks.filter(
        (t) =>
          !t.pinned &&
          t.date &&
          t.start_time &&
          occursOnDate(t, d) &&
          categories.includes(t.category) &&
          types.includes(t.type)
      )
      for (const t of occurring) {
        events.push({
          uid: `${t.id}-${iso}@dayforge.app`,
          title: t.title,
          description: t.notes || undefined,
          category: t.category,
          date: iso,
          startTime: t.start_time.slice(0, 5),
          durationMinutes: t.duration_minutes,
        })
      }
    }
    return events
  }

  /**
   * Called by ExportModal's "Download .ics" button with the user's chosen
   * range/category/type filters. Builds the file and triggers the browser
   * download, then closes the modal.
   */
  function handleExport(range, categories, types) {
    const numDays = range === 'week' ? 7 : 1
    const events = collectEventsForExport(selectedDate, numDays, categories, types)
    const endISO = toISODate(addDays(selectedDate, numDays - 1))
    const label = range === 'week' ? `${dateISO} to ${endISO}` : dateISO
    const filename = range === 'week' ? `dayforge-${dateISO}-to-${endISO}.ics` : `dayforge-${dateISO}.ics`
    const ics = buildICS(events, `DayForge — ${label}`)
    downloadICS(filename, ics)
    setExportOpen(false)
  }

  /**
   * Shows the Undo toast for a just-applied drag change, replacing any
   * currently-showing toast and resetting its auto-dismiss timer. Kept as
   * its own function since handleDragEnd has two call sites (schedule vs.
   * unschedule) that both need this same "show + auto-dismiss" behavior.
   */
  function showUndoToast(message, taskId, previousFields) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setUndoToast({ message, taskId, previousFields })
    undoTimerRef.current = setTimeout(() => setUndoToast(null), UNDO_TOAST_MS)
  }

  async function handleUndo() {
    if (!undoToast) return
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    await data.updateTask(undoToast.taskId, undoToast.previousFields)
    setUndoToast(null)
  }

  /**
   * Handles the end of a drag gesture from dnd-kit. Two possible outcomes:
   *   1. Dropped on the tray (`over.id === 'tray'`) -> clear date/start_time.
   *   2. Dropped on an hour row (`over.id === 'hour-N'`) -> set date to the
   *      selected day and start_time to N:00 (hour-level snap; see Timeline
   *      header comment for why minute precision isn't handled by drag).
   * If `over` is null (dropped outside any droppable), this is a no-op —
   * dnd-kit already snaps the item back to its origin visually.
   * Both branches snapshot the task's pre-drag date/start_time/recurrence
   * and surface an Undo toast afterward (see showUndoToast above).
   */
  function handleDragEnd(event) {
    const { active, over } = event
    if (!over) return
    const task = active.data.current?.task
    if (!task) return

    const previousFields = { date: task.date, start_time: task.start_time, recurrence: task.recurrence }

    if (over.id === 'tray') {
      if (task.date || task.start_time) {
        data.updateTask(task.id, { date: null, start_time: null })
        showUndoToast(`Sent "${task.title}" back to the tray`, task.id, previousFields)
      }
      return
    }
    if (typeof over.id === 'string' && over.id.startsWith('hour-')) {
      const hour = over.data.current.hour
      const newStart = `${String(hour).padStart(2, '0')}:00`
      data.updateTask(task.id, { date: dateISO, start_time: newStart, recurrence: task.date ? task.recurrence : 'none' })
      showUndoToast(`Moved "${task.title}" to ${formatHourLabel(hour)}`, task.id, previousFields)
    }
  }

  return (
    <div className="min-h-screen pb-16">
      {/* Header spacing notes (mobile fix):
          - pt-[max(...)] adds real top padding on top of whatever the
            device's notch/status-bar safe area already reserves (env(...)
            resolves to 0 on devices without a notch, so this is a no-op
            there and just uses the 0.75rem/1rem floor). Without this,
            testing found the action row sitting flush against the very top
            edge on some smaller phones, making the top of "Routines" /
            "Export" / "+ New task" hard to tap accurately.
          - flex-wrap + gap-y on the actions row lets buttons wrap onto a
            second line on narrow viewports instead of being squeezed
            edge-to-edge, which was shrinking effective tap targets. */}
      <header
        className="border-b border-[var(--color-line)] px-4 sm:px-8 pb-4 flex flex-wrap items-center justify-between gap-y-3 sticky top-0 bg-[var(--color-ink)]/95 backdrop-blur z-10"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="6" fill="var(--color-surface)" />
            <path d="M8 22 L16 8 L20 8 L14 18 L24 18 L14 26 Z" fill="var(--color-ember)" />
          </svg>
          <span className="[font-family:var(--font-display)] text-xl tracking-wide uppercase">DayForge</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Theme toggle — sun/moon glyph swaps based on current theme. */}
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="text-sm border border-[var(--color-line)] rounded w-9 h-9 flex items-center justify-center hover:border-[var(--color-steel)] transition"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>

          <button
            onClick={() => setRoutinesOpen(true)}
            className="text-sm border border-[var(--color-line)] rounded px-3 py-2 hover:border-[var(--color-steel)] transition"
          >
            Routines
          </button>

          {/* Opens ExportModal, where range + category + type filters are
              chosen before the .ics download happens — see ExportModal.jsx
              and handleExport() above for the filtering logic. */}
          <button
            onClick={() => setExportOpen(true)}
            className="text-sm border border-[var(--color-line)] rounded px-3 py-2 hover:border-[var(--color-steel)] transition"
          >
            Export
          </button>

          <button
            onClick={() => setCreatingNew(true)}
            className="text-sm bg-[var(--color-ember)] text-[var(--color-ink)] font-semibold rounded px-3 py-2 hover:brightness-110 transition"
          >
            + New task
          </button>

          {/* Small account dropdown, keeps Account/Sign out out of the main
              button row so the header stays uncluttered as features grow. */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Account menu"
              className="text-sm border border-[var(--color-line)] rounded w-9 h-9 flex items-center justify-center hover:border-[var(--color-steel)] transition"
            >
              ⋮
            </button>
            {menuOpen && (
              <>
                {/* Invisible backdrop closes the menu on outside click. */}
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-40 plate rounded-md py-1 z-30">
                  <button
                    onClick={() => { setAccountOpen(true); setMenuOpen(false) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-surface-raised)] transition"
                  >
                    Account settings
                  </button>
                  <button
                    onClick={signOut}
                    className="w-full text-left px-3 py-2 text-sm text-[var(--color-ember)] hover:bg-[var(--color-surface-raised)] transition"
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="px-4 sm:px-8 py-6 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        <div className="space-y-5 order-2 lg:order-1">
          <QuickAdd onAddLines={handleAddQuickLines} />
          <PinnedReminders
            tasks={data.tasks}
            onAdd={handlePinAdd}
            onToggle={(t) => data.updateTask(t.id, { completed: !t.completed })}
            onDelete={data.deleteTask}
            onClearAll={handleClearPinned}
            onEdit={setEditingTask}
          />
        </div>

        <div className="space-y-5 order-1 lg:order-2">
          <ForecastStrip selectedDate={selectedDate} onSelect={setSelectedDate} taskCountByDate={taskCountByDate} />
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-4 items-start">
              <Timeline
                dayTasks={scheduled}
                dateISO={dateISO}
                isCompletedOn={data.isCompletedOn}
                toggleCompletion={data.toggleCompletion}
                onEdit={setEditingTask}
                onDelete={(t) => data.deleteTask(t.id)}
              />
              <UnscheduledTray
                tasks={trayTasks}
                dateISO={dateISO}
                isCompletedOn={data.isCompletedOn}
                toggleCompletion={data.toggleCompletion}
                onEdit={setEditingTask}
                onDelete={(t) => data.deleteTask(t.id)}
                onClearAll={handleClearTray}
              />
            </div>
          </DndContext>
        </div>
      </main>

      {(editingTask || creatingNew) && (
        <TaskModal
          task={editingTask}
          defaultDate={dateISO}
          onSave={async (fields) => {
            if (editingTask) await data.updateTask(editingTask.id, fields)
            else await data.addTask(fields)
          }}
          onDelete={data.deleteTask}
          onClose={() => { setEditingTask(null); setCreatingNew(false) }}
        />
      )}

      {routinesOpen && (
        <RoutinesPanel
          routines={data.routines}
          routineItems={data.routineItems}
          onCreateRoutine={data.createRoutine}
          onDeleteRoutine={data.deleteRoutine}
          onAddItem={data.addRoutineItem}
          onDeleteItem={data.deleteRoutineItem}
          onApply={data.applyRoutineToDate}
          dateISO={dateISO}
          onClose={() => setRoutinesOpen(false)}
        />
      )}

      {accountOpen && <AccountModal onClose={() => setAccountOpen(false)} />}

      {exportOpen && <ExportModal onExport={handleExport} onClose={() => setExportOpen(false)} />}

      {/* Undo toast for drag-triggered reschedule/unschedule — see UNDO
          TOAST in this file's header comment for rationale. */}
      {undoToast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 plate rounded-md px-4 py-2.5 flex items-center gap-3 rise-in">
          <span className="text-sm">{undoToast.message}</span>
          <button
            onClick={handleUndo}
            className="text-sm font-semibold text-[var(--color-ember)] hover:brightness-110"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

// Formats an hour-of-day integer (0-23) as a 12-hour clock label for the
// undo toast's message, e.g. 14 -> "2 PM". Small and local to this file
// rather than importing Timeline's identical helper, to keep Timeline.jsx
// focused purely on rendering concerns.
function formatHourLabel(h) {
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${period}`
}
