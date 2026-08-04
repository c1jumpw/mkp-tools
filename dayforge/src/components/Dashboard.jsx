import { useMemo, useState } from 'react'
import { DndContext } from '@dnd-kit/core'
import { useAuth } from '../context/AuthContext'
import { useDayForgeData } from '../hooks/useDayForgeData'
import { occursOnDate, toISODate, addDays } from '../lib/recurrence'
import QuickAdd from './QuickAdd'
import PinnedReminders from './PinnedReminders'
import ForecastStrip from './ForecastStrip'
import Timeline from './Timeline'
import UnscheduledTray from './UnscheduledTray'
import TaskModal from './TaskModal'
import RoutinesPanel from './RoutinesPanel'

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const data = useDayForgeData()
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [editingTask, setEditingTask] = useState(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [routinesOpen, setRoutinesOpen] = useState(false)

  const dateISO = toISODate(selectedDate)

  const dayTasks = useMemo(
    () => data.tasks.filter((t) => !t.pinned && t.date && occursOnDate(t, selectedDate)),
    [data.tasks, selectedDate]
  )
  const scheduled = dayTasks.filter((t) => t.start_time)
  const unscheduledToday = useMemo(
    () => data.tasks.filter((t) => !t.pinned && !t.date && t.recurrence === 'none'),
    [data.tasks]
  )
  // Tray also includes today's recurring/dated tasks that don't yet have a time.
  const trayTasks = [...unscheduledToday, ...dayTasks.filter((t) => !t.start_time)]

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
        <div className="flex items-center gap-3">
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
          <button onClick={signOut} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-paper)] transition">
            Sign out
          </button>
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
          <DndContext onDragEnd={handleDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-4 items-start">
              <Timeline
                dayTasks={scheduled}
                dateISO={dateISO}
                isCompletedOn={data.isCompletedOn}
                toggleCompletion={data.toggleCompletion}
                onEdit={setEditingTask}
              />
              <UnscheduledTray
                tasks={trayTasks}
                dateISO={dateISO}
                isCompletedOn={data.isCompletedOn}
                toggleCompletion={data.toggleCompletion}
                onEdit={setEditingTask}
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
    </div>
  )
}
