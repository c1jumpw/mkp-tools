// Whether a task (possibly recurring) has an occurrence on the given date (a Date object).
export function occursOnDate(task, date) {
  if (!task.date) return false
  const start = new Date(task.date + 'T00:00:00')
  const target = new Date(
    date.getFullYear(), date.getMonth(), date.getDate()
  )
  const startMid = new Date(start.getFullYear(), start.getMonth(), start.getDate())

  if (target < startMid) return false

  if (task.recurrence === 'none') {
    return target.getTime() === startMid.getTime()
  }
  if (task.recurrence === 'daily') {
    return true
  }
  if (task.recurrence === 'weekly') {
    const days = task.recurrence_days && task.recurrence_days.length
      ? task.recurrence_days
      : [startMid.getDay()]
    return days.includes(target.getDay())
  }
  return false
}

export function toISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function formatDayLabel(date) {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export function formatShortDay(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short' })
}

export function timeToMinutes(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0')
  const m = Math.floor(mins % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

export function formatTimeLabel(t) {
  if (!t) return ''
  const mins = timeToMinutes(t)
  const h24 = Math.floor(mins / 60)
  const m = mins % 60
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}
