import { useDroppable } from '@dnd-kit/core'
import TaskBlock from './TaskBlock'
import { timeToMinutes } from '../lib/recurrence'

const START_HOUR = 5
const END_HOUR = 23

function HourRow({ hour, tasks, dateISO, isCompletedOn, toggleCompletion, onEdit }) {
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
          />
        ))}
      </div>
    </div>
  )
}

function formatHour(h) {
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${period}`
}

export default function Timeline({ dayTasks, dateISO, isCompletedOn, toggleCompletion, onEdit }) {
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i)

  return (
    <div className="plate rounded-lg overflow-hidden">
      <div className="px-4 pt-3 pb-1">
        <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-lg">Timeline</h2>
      </div>
      <div className="max-h-[65vh] overflow-y-auto">
        {hours.map((h) => {
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
            />
          )
        })}
      </div>
    </div>
  )
}
