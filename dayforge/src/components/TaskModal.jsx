/**
 * =============================================================================
 * FILE: src/components/TaskModal.jsx
 * VERSION: v3 (previously v1-v2 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Full create/edit form for a single task: title, notes, voice note, type,
 *   category, pinned flag, and (if scheduled) date/start time/duration/end
 *   time/recurrence. This is the ONE place all task fields can be changed —
 *   both the Timeline and the UnscheduledTray open this same modal.
 *
 * KEY RESPONSIBILITIES
 *   - Hold local form state, seeded from `task` when editing or from
 *     `defaultDate` when creating new.
 *   - Keep duration (hours+minutes) and end time in sync with EACH OTHER
 *     bidirectionally — changing duration recalculates end time and
 *     vice versa; start time changes preserve duration and shift end time.
 *   - Record, upload, play back, and delete a voice note attached to the
 *     task (see VOICE NOTES section below).
 *   - On save, translate the form's UI-friendly fields (hours+minutes,
 *     end time) back into the single `duration_minutes` value the database
 *     actually stores.
 *
 * PROPS
 *   task         {object|null} Existing task to edit, or null/undefined to
 *                               create a new one.
 *   defaultDate  {string}      'YYYY-MM-DD' to preselect when creating new.
 *   onSave       {function}    (fields) -> Promise; called with the full
 *                               field set to insert/update.
 *   onDelete     {function}    (id) -> Promise; only used when editing.
 *   onClose      {function}    () -> void; dismiss without side effects
 *                               beyond whatever onSave/onDelete already did.
 *
 * VOICE NOTES (v3)
 *   One optional voice note per task, alongside the existing text `notes`
 *   field — recording/transcription UI lives in VoiceNoteRecorder.jsx;
 *   this file owns persistence (Supabase Storage upload/delete via
 *   lib/voiceNotes.js, and saving the resulting pointer/transcript/duration
 *   onto the task row).
 *
 *   REQUIRES AN EXISTING TASK: the audio file's storage path is built from
 *   the task's id (see lib/voiceNotes.js: "<user_id>/<task_id>-<ts>.ext"),
 *   so a brand-new, not-yet-saved task has no id to attach it to. The
 *   recorder is hidden for `isNew` tasks with a hint to save the task
 *   first, then reopen it to add a voice note. This mirrors the existing
 *   "Send to tray" action's isNew restriction for the same underlying
 *   reason (needs a real task id).
 *
 *   IMMEDIATE SAVE ON RECORD/DELETE, NOT ON THE MAIN "SAVE CHANGES" BUTTON:
 *   Unlike every other field in this form (title, notes, schedule, etc.,
 *   which stay as local state until "Save changes" is clicked), a
 *   successful recording or deletion is persisted to the task row
 *   IMMEDIATELY. Rationale: the audio upload/delete is itself already a
 *   real, committed side effect in Supabase Storage — if the modal were
 *   closed without hitting the main Save button afterward, the uploaded
 *   file would become an orphan (or a deletion would appear to have "not
 *   happened" when it actually did). Editing the TRANSCRIPT TEXT of an
 *   existing voice note, by contrast, is just local state like any other
 *   text field and follows the normal Save-button flow — only the
 *   record/delete actions (which touch external storage) auto-persist.
 *
 * EDGE CASES
 *   - Duration/end-time: see handleStartTimeChange/handleDurationPartsChange/
 *     handleEndTimeChange — end-before-start is treated as spanning past
 *     midnight; duration is floored at 5 minutes.
 *   - Voice note: replacing an existing recording uploads the NEW file
 *     first, and only deletes the old one after the new upload succeeds —
 *     so a failed re-record never loses the previous recording.
 * =============================================================================
 */

import { useEffect, useState } from 'react'
import { timeToMinutes, minutesToTime } from '../lib/recurrence'
import { useAuth } from '../context/AuthContext'
import { uploadVoiceNote, deleteVoiceNoteFile, fetchVoiceNoteObjectUrl } from '../lib/voiceNotes'
import VoiceNoteRecorder from './VoiceNoteRecorder'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MIN_DURATION_MINUTES = 5

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function TaskModal({ task, defaultDate, onSave, onDelete, onClose }) {
  const { user } = useAuth()
  const isNew = !task
  const [title, setTitle] = useState(task?.title || '')
  const [notes, setNotes] = useState(task?.notes || '')
  const [type, setType] = useState(task?.type || 'todo')
  const [category, setCategory] = useState(task?.category || 'personal')
  const [pinned, setPinned] = useState(task?.pinned || false)
  const [scheduled, setScheduled] = useState(isNew ? !!defaultDate : !!task?.date)
  const [date, setDate] = useState(task?.date || defaultDate || '')
  const [startTime, setStartTime] = useState(task?.start_time?.slice(0, 5) || '09:00')

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

  // --- Voice note state ---
  // Path/transcript/duration mirror the task row's voice_note_* columns.
  // transcript is editable local state (saved via the normal Save button);
  // path/duration only change via the immediate-save record/delete actions
  // described in the file header comment above.
  const [voiceNotePath, setVoiceNotePath] = useState(task?.voice_note_path || null)
  const [voiceNoteTranscript, setVoiceNoteTranscript] = useState(task?.voice_note_transcript || '')
  const [voiceNoteDuration, setVoiceNoteDuration] = useState(task?.voice_note_duration_seconds || 0)
  const [voiceNoteBusy, setVoiceNoteBusy] = useState(false)
  const [voiceNoteError, setVoiceNoteError] = useState('')
  const [playbackUrl, setPlaybackUrl] = useState(null)
  const [playbackLoading, setPlaybackLoading] = useState(false)

  // Release the playback object URL (if any was fetched) when the modal
  // unmounts, so it doesn't leak — see voiceNotes.js's CALLER RESPONSIBILITY note.
  useEffect(() => {
    return () => {
      if (playbackUrl) URL.revokeObjectURL(playbackUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleDay(i) {
    setRecurDays((prev) => (prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i].sort()))
  }

  function handleStartTimeChange(newStart) {
    setStartTime(newStart)
    setEndTime(minutesToTime((timeToMinutes(newStart) + duration) % (24 * 60)))
  }

  function handleDurationPartsChange(hours, minutesPart) {
    const total = Math.max(MIN_DURATION_MINUTES, hours * 60 + minutesPart)
    setDurHours(hours)
    setDurMinutes(minutesPart)
    setDuration(total)
    setEndTime(minutesToTime((timeToMinutes(startTime) + total) % (24 * 60)))
  }

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
   * Assembles the full field payload sent to onSave. Shared by the main
   * Save button, "Send to tray", and (with a `overrides` merge) the voice
   * note record/delete immediate-save paths, so all three stay in sync
   * with the same field set instead of duplicating this object shape.
   */
  function buildFieldsPayload(overrides = {}) {
    return {
      title: title.trim(),
      notes: notes.trim() || null,
      type,
      category,
      pinned,
      date: scheduled ? date : null,
      start_time: scheduled ? startTime : null,
      duration_minutes: scheduled ? Number(duration) : 30,
      recurrence: scheduled ? recurrence : 'none',
      recurrence_days: recurrence === 'weekly' ? recurDays : [],
      voice_note_path: voiceNotePath,
      voice_note_transcript: voiceNoteTranscript.trim() || null,
      voice_note_duration_seconds: voiceNoteDuration || null,
      ...overrides,
    }
  }

  async function handleSendToTray() {
    setBusy(true)
    try {
      await onSave(buildFieldsPayload({ date: null, start_time: null, duration_minutes: 30, recurrence: 'none', recurrence_days: [] }))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await onSave(buildFieldsPayload())
      onClose()
    } finally {
      setBusy(false)
    }
  }

  /**
   * Handles a completed recording from VoiceNoteRecorder: uploads the new
   * audio, deletes the previous one (only after the new upload succeeds —
   * see file header EDGE CASES note), then immediately persists the new
   * pointer/transcript/duration to the task row via onSave (without closing
   * the modal, so the user can keep editing other fields).
   */
  async function handleVoiceRecorded(blob, transcript, durationSeconds) {
    setVoiceNoteError('')
    setVoiceNoteBusy(true)
    const previousPath = voiceNotePath
    try {
      const newPath = await uploadVoiceNote(user.id, task.id, blob)
      if (previousPath) {
        // Best-effort cleanup of the old file — if this fails, the new
        // recording is already safely saved and usable regardless.
        try { await deleteVoiceNoteFile(previousPath) } catch { /* non-fatal */ }
      }
      if (playbackUrl) { URL.revokeObjectURL(playbackUrl); setPlaybackUrl(null) }
      setVoiceNotePath(newPath)
      setVoiceNoteTranscript(transcript)
      setVoiceNoteDuration(durationSeconds)
      await onSave(buildFieldsPayload({
        voice_note_path: newPath,
        voice_note_transcript: transcript.trim() || null,
        voice_note_duration_seconds: durationSeconds,
      }))
    } catch (err) {
      setVoiceNoteError('Could not save the voice note: ' + (err.message || 'unknown error'))
    } finally {
      setVoiceNoteBusy(false)
    }
  }

  async function handleDeleteVoiceNote() {
    if (!voiceNotePath) return
    if (!window.confirm('Delete this voice note? The recording cannot be recovered.')) return
    setVoiceNoteError('')
    setVoiceNoteBusy(true)
    try {
      await deleteVoiceNoteFile(voiceNotePath)
      if (playbackUrl) { URL.revokeObjectURL(playbackUrl); setPlaybackUrl(null) }
      setVoiceNotePath(null)
      setVoiceNoteTranscript('')
      setVoiceNoteDuration(0)
      await onSave(buildFieldsPayload({ voice_note_path: null, voice_note_transcript: null, voice_note_duration_seconds: null }))
    } catch (err) {
      setVoiceNoteError('Could not delete the voice note: ' + (err.message || 'unknown error'))
    } finally {
      setVoiceNoteBusy(false)
    }
  }

  // Lazily fetches the audio for playback on first Play tap (see
  // voiceNotes.js's WHY DOWNLOAD-AND-BLOB note for why this isn't eager).
  async function handlePlayVoiceNote() {
    if (playbackUrl || !voiceNotePath) return
    setPlaybackLoading(true)
    setVoiceNoteError('')
    try {
      const url = await fetchVoiceNoteObjectUrl(voiceNotePath)
      setPlaybackUrl(url)
    } catch (err) {
      setVoiceNoteError('Could not load the recording: ' + (err.message || 'unknown error'))
    } finally {
      setPlaybackLoading(false)
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

        {/* Voice note — see file header VOICE NOTES section for the isNew
            restriction and the immediate-save-on-record/delete rationale. */}
        <label className="blueprint-tick uppercase block mb-1">Voice note</label>
        {isNew ? (
          <p className="text-xs text-[var(--color-muted)] mb-3">Save the task first, then reopen it to add a voice note.</p>
        ) : (
          <div className="mb-3">
            {voiceNoteError && <p className="text-xs text-[var(--color-ember)] mb-2">{voiceNoteError}</p>}

            {voiceNotePath ? (
              <div className="border border-[var(--color-line)] rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Voice note — {formatDuration(voiceNoteDuration)}</span>
                  <button
                    type="button"
                    onClick={handleDeleteVoiceNote}
                    disabled={voiceNoteBusy}
                    className="ml-auto text-xs text-[var(--color-muted)] hover:text-[var(--color-ember)] disabled:opacity-40 transition"
                  >
                    Delete
                  </button>
                </div>
                {playbackUrl ? (
                  <audio controls src={playbackUrl} className="w-full h-8" />
                ) : (
                  <button
                    type="button"
                    onClick={handlePlayVoiceNote}
                    disabled={playbackLoading}
                    className="text-sm border border-[var(--color-line)] rounded px-3 py-1 hover:border-[var(--color-steel)] disabled:opacity-40 transition"
                  >
                    {playbackLoading ? 'Loading…' : '▶ Play'}
                  </button>
                )}
                <textarea
                  value={voiceNoteTranscript}
                  onChange={(e) => setVoiceNoteTranscript(e.target.value)}
                  rows={2}
                  placeholder="Transcript"
                  className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm resize-none focus:border-[var(--color-ember)] outline-none"
                />
                <p className="text-[10px] text-[var(--color-muted)]">
                  Transcript edits save with the main "Save changes" button below. Re-record to replace the audio itself.
                </p>
                <VoiceNoteRecorder onRecorded={handleVoiceRecorded} disabled={voiceNoteBusy} />
              </div>
            ) : (
              <VoiceNoteRecorder onRecorded={handleVoiceRecorded} disabled={voiceNoteBusy} />
            )}
          </div>
        )}

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
              onClick={async () => {
                if (voiceNotePath) { try { await deleteVoiceNoteFile(voiceNotePath) } catch { /* best-effort */ } }
                await onDelete(task.id)
                onClose()
              }}
              className="text-sm text-[var(--color-ember)] hover:brightness-110 mr-auto"
            >
              Delete
            </button>
          )}
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
