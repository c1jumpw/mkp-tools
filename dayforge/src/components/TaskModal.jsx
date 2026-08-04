/**
 * =============================================================================
 * FILE: src/components/TaskModal.jsx
 * VERSION: v2 (previously v1 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Full create/edit form for a single task: title, notes, type, category,
 *   pinned flag, and (if scheduled) date/start time/duration/end time/
 *   recurrence. This is the ONE place all task fields can be changed —
 *   both the Timeline and the UnscheduledTray open this same modal.
 *
 * KEY RESPONSIBILITIES
 *   - Hold local form state, seeded from `task` when editing or from
 *     `defaultDate` when creating new.
 *   - Keep duration (hours+minutes) and end time in sync with EACH OTHER
 *     bidirectionally, per user request: changing duration recalculates
 *     the end time, and changing the end time recalculates the duration.
 *     Start time changes preserve the duration and shift the end time.
 *   - On save, translate the form's UI-friendly fields (hours+minutes,
 *     end time) back into the single `duration_minutes` value the database
 *     actually stores (there is no end_time column — see supabase/schema.sql
 *     — end time is purely a derived UI convenience, recomputed on load).
 *
 * PROPS
 *   task         {object|null} Existing task to edit, or null/undefined to
 *                               create a new one.
 *   defaultDate  {string}      'YYYY-MM-DD' to preselect when creating new
 *                               (typically the currently-viewed day).
 *   onSave       {function}    (fields) -> Promise; called with the full
 *                               field set to insert/update.
 *   onDelete     {function}    (id) -> Promise; only used when editing.
 *   onClose      {function}    () -> void; dismiss without side effects
 *                               beyond whatever onSave/onDelete already did.
 *
 * REVISION HISTORY (v2, this version, continued)
 *   Added a "Send back to tray" quick action (only shown when editing an
 *   already-scheduled task), per user request after mobile testing — a
 *   one-tap way to unschedule instead of unchecking "Give this a date and
 *   time block" and then hitting Save separately.
 *
 * EDGE CASES
 *   - If the end time is set EARLIER than the start time, we treat it as
 *     spanning past midnight (adding 24h before computing the difference)
 *     rather than silently producing a negative/zero duration. This covers
 *     the reasonable case of "10pm to 1am", though the task itself is still
 *     stored against a single `date` (no explicit multi-day support here).
 *   - Duration is floored at 5 minutes regardless of which field drove the
 *     change, to avoid a zero/negative-duration task on the timeline.
 * =============================================================================
 */

import { useState } from 'react'
import { timeToMinutes, minutesToTime } from '../lib/recurrence'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MIN_DURATION_MINUTES = 5

export default function TaskModal({ task, defaultDate, onSave, onDelete, onClose }) {
  const isNew = !task
  const [title, setTitle] = useState(task?.title || '')
  const [notes, setNotes] = useState(task?.notes || '')
  const [type, setType] = useState(task?.type || 'todo')
  const [category, setCategory] = useState(task?.category || 'personal')
  const [pinned, setPinned] = useState(task?.pinned || false)
  const [scheduled, setScheduled] = useState(isNew ? !!defaultDate : !!task?.date)
  const [date, setDate] = useState(task?.date || defaultDate || '')
  const [startTime, setStartTime] = useState(task?.start_time?.slice(0, 5) || '09:00')

  // Duration is the SOURCE OF TRUTH (this is what actually gets saved to
  // duration_minutes). Hours/minutes-part and endTime are derived display
  // fields kept in sync with it and with each other — see the three handlers
  // below for the sync logic.
  const initialDuration = task?.duration_minutes || 30
  const [duration, setDuration] = useState(initialDuration)
  const [durHours, setDurHours] = useState(Math.floor(initialDuration / 60))
  const [durMinutes, setDurMinutes] = useState(initialDuration % 60)
  const [endTime, setEndTime] = useState(
    minutesToTime((timeToMinutes(task?.start_time?.slice(0, 5) || '09:00') + initialDuration) % (24 * 60))
  )

  const [recurrence, setRecurrence] = useState(task?.recurrence || 'none')
  const [recurDays, setRecurDays] = useState(task?.recurrence_days || [])
  const [busy, setBusy] = useState(false)

  function toggleDay(i) {
    setRecurDays((prev) => (prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i].sort()))
  }

  /**
   * Start time changed: duration stays fixed, so the end time must shift
   * with it (e.g. start moves 9:00 -> 9:30, a 60-min task now ends 10:30
   * instead of 10:00).
   */
  function handleStartTimeChange(newStart) {
    setStartTime(newStart)
    setEndTime(minutesToTime((timeToMinutes(newStart) + duration) % (24 * 60)))
  }

  /**
   * Duration fields (hours and/or minutes) changed: recompute the total
   * duration_minutes, then push the end time forward from the (unchanged)
   * start time to match.
   */
  function handleDurationPartsChange(hours, minutesPart) {
    const total = Math.max(MIN_DURATION_MINUTES, hours * 60 + minutesPart)
    setDurHours(hours)
    setDurMinutes(minutesPart)
    setDuration(total)
    setEndTime(minutesToTime((timeToMinutes(startTime) + total) % (24 * 60)))
  }

  /**
   * End time changed directly: recompute duration as the gap between start
   * and end. If end <= start clock-time, assume it spans past midnight
   * (add a full day) rather than producing a zero/negative duration —
   * e.g. start 22:00, end 01:00 -> treated as 3 hours, not -21 hours.
   */
  function handleEndTimeChange(newEnd) {
    setEndTime(newEnd)
    let diff = timeToMinutes(newEnd) - timeToMinutes(startTime)
    if (diff <= 0) diff += 24 * 60
    diff = Math.max(MIN_DURATION_MINUTES, diff)
    setDuration(diff)
    setDurHours(Math.floor(diff / 60))
    setDurMinutes(diff % 60)
  }

  /**
   * Quick action: unschedule this task in one tap, without requiring the
   * user to uncheck "Give this a date and time block" and then hit Save
   * separately. Keeps every other field as-is (title, notes, type,
   * category, pinned) — only date/start_time/duration/recurrence reset to
   * their "unscheduled" defaults, matching what unchecking the checkbox +
   * saving would have produced.
   */
  async function handleSendToTray() {
    setBusy(true)
    try {
      await onSave({
        title: title.trim(),
        notes: notes.trim() || null,
        type,
        category,
        pinned,
        date: null,
        start_time: null,
        duration_minutes: 30,
        recurrence: 'none',
        recurrence_days: [],
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await onSave({
        title: title.trim(),
        notes: notes.trim() || null,
        type,
        category,
        pinned,
        date: scheduled ? date : null,
        start_time: scheduled ? startTime : null,
        // duration_minutes is the single number the database stores — hours/
        // minutes-part and endTime were only ever UI conveniences for editing it.
        duration_minutes: scheduled ? Number(duration) : 30,
        recurrence: scheduled ? recurrence : 'none',
        recurrence_days: recurrence === 'weekly' ? recurDays : [],
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="plate rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto p-5 rise-in"
        onClick={(e) => e.stopPropagation()}
        style={{ '--accent': category === 'work' ? 'var(--color-steel)' : 'var(--color-ember)' }}
      >
        <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-xl mb-4">
          {isNew ? 'New task' : 'Edit task'}
        </h2>

        <label className="blueprint-tick uppercase block mb-1">Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm mb-3 focus:border-[var(--color-ember)] outline-none"
        />

        <label className="blueprint-tick uppercase block mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm mb-3 resize-none focus:border-[var(--color-ember)] outline-none"
        />

        <div className="flex gap-4 mb-3">
          <div className="flex-1">
            <label className="blueprint-tick uppercase block mb-1">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm">
              <option value="todo">To-do</option>
              <option value="reminder">Reminder</option>
              <option value="event">Event</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="blueprint-tick uppercase block mb-1">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm">
              <option value="personal">Personal</option>
              <option value="work">Work</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 mb-3 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin as a general reminder (always visible, no time slot)
        </label>

        <label className="flex items-center gap-2 mb-3 text-sm">
          <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />
          Give this a date and time block
        </label>

        {scheduled && (
          <div className="space-y-3 border-t border-[var(--color-line)] pt-3 mb-3">
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="blueprint-tick uppercase block mb-1">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm" />
              </div>
              <div className="flex-1">
                <label className="blueprint-tick uppercase block mb-1">Start time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                  className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            {/* Duration (hours + minutes) and End time — bidirectionally
                synced via handleDurationPartsChange / handleEndTimeChange.
                Editing either one updates the other automatically. */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="blueprint-tick uppercase block mb-1">Duration</label>
                <div className="flex gap-1.5 items-center">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={durHours}
                    onChange={(e) => handleDurationPartsChange(Math.max(0, Number(e.target.value) || 0), durMinutes)}
                    className="w-16 bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm"
                    aria-label="Duration hours"
                  />
                  <span className="text-xs text-[var(--color-muted)]">h</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    step={5}
                    value={durMinutes}
                    onChange={(e) => handleDurationPartsChange(durHours, Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                    className="w-16 bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm"
                    aria-label="Duration minutes"
                  />
                  <span className="text-xs text-[var(--color-muted)]">m</span>
                </div>
              </div>
              <div className="flex-1">
                <label className="blueprint-tick uppercase block mb-1">End time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => handleEndTimeChange(e.target.value)}
                  className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="blueprint-tick uppercase block mb-1">Repeats</label>
              <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm mb-2">
                <option value="none">Doesn't repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly on selected days</option>
              </select>
              {recurrence === 'weekly' && (
                <div className="flex gap-1">
                  {DAY_LABELS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={
                        'w-9 h-9 text-xs rounded border ' +
                        (recurDays.includes(i)
                          ? 'bg-[var(--color-steel)] border-[var(--color-steel)] text-[var(--color-ink)] font-semibold'
                          : 'border-[var(--color-line)] text-[var(--color-muted)]')
                      }
                    >
                      {d[0]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mt-5 flex-wrap">
          {!isNew && (
            <button
              onClick={() => onDelete(task.id).then(onClose)}
              className="text-sm text-[var(--color-ember)] hover:brightness-110 mr-auto"
            >
              Delete
            </button>
          )}
          {/* Only meaningful for an already-scheduled existing task — a new
              or already-unscheduled task has nothing to "send back". */}
          {!isNew && task?.date && (
            <button
              onClick={handleSendToTray}
              disabled={busy}
              className="text-sm text-[var(--color-steel)] hover:brightness-110 disabled:opacity-40"
            >
              Send to tray
            </button>
          )}
          <button onClick={onClose} className="text-sm text-[var(--color-muted)] hover:text-[var(--color-paper)] px-3 py-1.5">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy || !title.trim()}
            className="bg-[var(--color-ember)] disabled:opacity-40 text-[var(--color-ink)] text-sm font-semibold rounded px-4 py-1.5 hover:brightness-110 transition"
          >
            {isNew ? 'Add task' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
