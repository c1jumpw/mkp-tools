/**
 * =============================================================================
 * FILE: src/components/Dashboard.jsx
 * VERSION: v3 (previously v1, v2 — see REVISION HISTORY below)
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
 *     (schedule into an hour, or unschedule back to the tray).
 *
 * DATA FLOW
 *   useDayForgeData() (Supabase-backed) --> Dashboard (derives day-specific
 *   views) --> child components (QuickAdd, PinnedReminders, ForecastStrip,
 *   Timeline, UnscheduledTray, TaskModal, RoutinesPanel, AccountModal).
 *   Child components call back up into `data.*` functions passed down as
 *   props; Dashboard itself never talks to Supabase directly.
 *
 * REVISION HISTORY
 *   v1 (initial build) — core layout, DndContext with default sensor config,
 *       Routines/Sign out buttons in header.
 *   v2 — (see supabaseClient.js v2) no changes to this file.
 *   v3 (this version), per user feedback batch:
 *     - Added explicit PointerSensor/TouchSensor configuration with an
 *       8px activation distance, so a plain tap/click reliably opens the
 *       edit modal instead of being swallowed by drag-start (previously
 *       relied on dnd-kit's zero-distance default, which is drag-happy).
 *     - Wired onDelete through to Timeline and UnscheduledTray so items can
 *       be removed inline (see TaskBlock.jsx v2).
 *     - Added a theme toggle button (uses ThemeContext, new in this batch).
 *     - Added an Account menu button opening the new AccountModal, and
 *       consolidated it with Sign out into a small header menu so the header
 *       doesn't get too crowded as features accumulate.
 * =============================================================================
 */

import { useMemo, useState } from 'react'
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useDayForgeData } from '../hooks/useDayForgeData'
import { occursOnDate, toISODate, addDays } from '../lib/recurrence'
import QuickAdd from './QuickAdd'
import PinnedReminders from './PinnedReminders'
import ForecastStrip from './ForecastStrip'
import Timeline from './Timeline'
import UnscheduledTray from './UnscheduledTray'
import TaskModal from './TaskModal'
import RoutinesPanel from './RoutinesPanel'
import AccountModal from './AccountModal'

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

  const dateISO = toISODate(selectedDate)

  // dnd-kit sensors: without `activationConstraint`, ANY pointer movement
  // (even a few px of natural hand tremor during a tap) starts a drag,
  // which makes plain taps unreliable — especially on touchscreens. Requiring
  // 8px of movement before a drag "activates" means a quick tap always
  // reaches the TaskBlock's onClick (opening the edit modal), while a real
  // drag gesture still works normally.
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

  /**
   * Handles the end of a drag gesture from dnd-kit. Two possible outcomes:
   *   1. Dropped on the tray (`over.id === 'tray'`) -> clear date/start_time.
   *   2. Dropped on an hour row (`over.id === 'hour-N'`) -> set date to the
   *      selected day and start_time to N:00 (hour-level snap; see Timeline
   *      header comment for why minute precision isn't handled by drag).
   * If `over` is null (dropped outside any droppable), this is a no-op —
   * dnd-kit already snaps the item back to its origin visually.
   */
  function handleDragEnd(event) {
    const { active, over } = event
    if (!over) return
    const task = active.data.current?.task
    if (!task) return

    if (over.id === 'tray') {
      if (task.date || task.start_time) {
        data.updateTask(task.id, { date: null, start_time: null })
      }
      return
    }
    if (typeof over.id === 'string' && over.id.startsWith('hour-')) {
      const hour = over.data.current.hour
      const newStart = `${String(hour).padStart(2, '0')}:00`
      data.updateTask(task.id, { date: dateISO, start_time: newStart, recurrence: task.date ? task.recurrence : 'none' })
    }
  }

  return (
    <div className="min-h-screen pb-16">
      <header className="border-b border-[var(--color-line)] px-4 sm:px-8 py-4 flex items-center justify-between sticky top-0 bg-[var(--color-ink)]/95 backdrop-blur z-10">
        <div className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="6" fill="var(--color-surface)" />
            <path d="M8 22 L16 8 L20 8 L14 18 L24 18 L14 26 Z" fill="var(--color-ember)" />
          </svg>
          <span className="[font-family:var(--font-display)] text-xl tracking-wide uppercase">DayForge</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Theme toggle — sun/moon glyph swaps based on current theme. */}
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="text-sm border border-[var(--color-line)] rounded w-8 h-8 flex items-center justify-center hover:border-[var(--color-steel)] transition"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>

          <button
            onClick={() => setRoutinesOpen(true)}
            className="text-sm border border-[var(--color-line)] rounded px-3 py-1.5 hover:border-[var(--color-steel)] transition"
          >
            Routines
          </button>
          <button
            onClick={() => setCreatingNew(true)}
            className="text-sm bg-[var(--color-ember)] text-[var(--color-ink)] font-semibold rounded px-3 py-1.5 hover:brightness-110 transition"
          >
            + New task
          </button>

          {/* Small account dropdown, keeps Account/Sign out out of the main
              button row so the header stays uncluttered as features grow. */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Account menu"
              className="text-sm border border-[var(--color-line)] rounded w-8 h-8 flex items-center justify-center hover:border-[var(--color-steel)] transition"
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
    </div>
  )
}
