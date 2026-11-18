/**
 * =============================================================================
 * FILE: src/hooks/useDayForgeData.js
 * VERSION: v4 (previously v1-v3 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   The single source of truth for all Supabase-backed app data: tasks,
 *   per-date completions, routines, routine items, and notes. Every
 *   component that reads or mutates this data goes through the functions
 *   this hook returns — no component talks to `supabase` directly except
 *   this file.
 *
 * KEY RESPONSIBILITIES
 *   - Fetch all four tables on mount / whenever `user` changes (refetch()).
 *   - Provide CRUD functions for tasks, completions, routines, and routine
 *     items that both call Supabase AND update local React state optimistically
 *     (i.e. update `tasks`/`routines`/etc. from the function's own return
 *     value rather than re-fetching everything after every write).
 *
 * DATA FLOW
 *   Dashboard.jsx calls useDayForgeData() once and passes the individual
 *   functions down as props to QuickAdd, PinnedReminders, Timeline,
 *   UnscheduledTray, TaskModal, RoutinesPanel.
 *
 * ASSUMPTIONS
 *   - Every table has Row Level Security policies (see supabase/schema.sql)
 *     restricting rows to `auth.uid() = user_id` — this hook always includes
 *     `user_id: user.id` on inserts, but does NOT re-check ownership on
 *     reads/updates/deletes client-side, since Postgres RLS is the actual
 *     enforcement layer (client-side filtering would be redundant, not a
 *     real security boundary).
 *
 * REVISION HISTORY
 *   v1 (initial build) — fetch + per-row CRUD for tasks/completions/
 *       routines/routine_items.
 *   v2 (this version) — added deleteTasksBulk(ids), used by the "Clear
 *       tray" and "Clear all pins" actions so removing many tasks at once
 *       is a single DELETE ... WHERE id IN (...) request instead of one
 *       network round-trip per task.
 *   v3 (this version) — added the `notes` table (a raw-capture "notepad"
 *       feature, separate from tasks — see NotesPanel.jsx) and its CRUD:
 *       addNotesBulk (one insert per "—)"-split topic from a single
 *       capture, see lib/notesParsing.js), updateNote, deleteNote, and
 *       convertNoteToTask (creates a task from a note's parsed
 *       topic+bullets, then links the note to it via converted_task_id
 *       rather than deleting the note — the note stays as a visible,
 *       filterable record that it was acted on).
 *   v4 (this version) — added note LABELS (categories; see
 *       supabase/migrations/008_note_labels.sql and lib/noteLabels.js):
 *       a `noteLabels` state array fetched alongside everything else, plus
 *       createNoteLabel, renameNoteLabel, deleteNoteLabel (one RPC call that
 *       also strips the label from every note) and setNoteLabels. Also:
 *       - addNotesBulk takes an optional `extraFields` object merged into
 *         every new row, so a capture made while a label filter is active
 *         can land in that label.
 *       - updateNote takes an optional `{ touch }` option; label changes
 *         pass touch:false so tagging a note doesn't stamp it "Edited".
 *       - The labels fetch failing (migration 008 not run yet) is recorded
 *         in `noteLabelsError` instead of breaking the rest of the app.
 * =============================================================================
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { parseNoteDisplay } from '../lib/notesParsing'
import { normalizeLabelName, findLabelByName } from '../lib/noteLabels'

export function useDayForgeData() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [completions, setCompletions] = useState([]) // [{task_id, date}]
  const [routines, setRoutines] = useState([])
  const [routineItems, setRoutineItems] = useState([])
  const [notes, setNotes] = useState([])
  const [noteLabels, setNoteLabels] = useState([]) // label/category rows for notes (migration 008)
  // The labels fetch's error, if any — normally null. Non-null mostly means
  // migration 008 hasn't been run yet; NotesPanel shows a one-line hint
  // rather than the whole app failing to load.
  const [noteLabelsError, setNoteLabelsError] = useState(null)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [t, c, r, ri, n, nl] = await Promise.all([
      supabase.from('tasks').select('*').order('start_time', { ascending: true, nullsFirst: false }),
      supabase.from('task_completions').select('task_id, date'),
      supabase.from('routines').select('*').order('created_at', { ascending: true }),
      supabase.from('routine_items').select('*').order('sort_order', { ascending: true }),
      supabase.from('notes').select('*').order('created_at', { ascending: false }),
      supabase.from('note_labels').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true }),
    ])
    if (!t.error) setTasks(t.data)
    if (!c.error) setCompletions(c.data)
    if (!r.error) setRoutines(r.data)
    if (!ri.error) setRoutineItems(ri.data)
    if (!n.error) setNotes(n.data)
    if (!nl.error) setNoteLabels(nl.data)
    setNoteLabelsError(nl.error || null)
    setLoading(false)
  }, [user])

  useEffect(() => { refetch() }, [refetch])

  // ---- Tasks ----
  async function addTask(fields) {
    const { data, error } = await supabase
      .from('tasks')
      .insert({ ...fields, user_id: user.id })
      .select()
      .single()
    if (error) throw error
    setTasks((prev) => [...prev, data])
    return data
  }

  async function addTasksBulk(rows) {
    const payload = rows.map((r) => ({ ...r, user_id: user.id }))
    const { data, error } = await supabase.from('tasks').insert(payload).select()
    if (error) throw error
    setTasks((prev) => [...prev, ...data])
    return data
  }

  async function updateTask(id, fields) {
    const { data, error } = await supabase.from('tasks').update(fields).eq('id', id).select().single()
    if (error) throw error
    setTasks((prev) => prev.map((t) => (t.id === id ? data : t)))
    return data
  }

  async function deleteTask(id) {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) throw error
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }

  /**
   * Deletes multiple tasks in a single request (used by "Clear tray" and
   * "Clear all pins" — deleting one-by-one in a loop would be N separate
   * network round-trips instead of one).
   * @param {string[]} ids - task ids to delete. No-ops safely on an empty array.
   */
  async function deleteTasksBulk(ids) {
    if (!ids.length) return
    const { error } = await supabase.from('tasks').delete().in('id', ids)
    if (error) throw error
    const idSet = new Set(ids)
    setTasks((prev) => prev.filter((t) => !idSet.has(t.id)))
  }

  // ---- Completions (per-date, for recurring tasks) ----
  async function toggleCompletion(task, dateISO) {
    if (task.recurrence === 'none') {
      return updateTask(task.id, { completed: !task.completed })
    }
    const existing = completions.find((c) => c.task_id === task.id && c.date === dateISO)
    if (existing) {
      const { error } = await supabase
        .from('task_completions')
        .delete()
        .eq('task_id', task.id)
        .eq('date', dateISO)
      if (error) throw error
      setCompletions((prev) => prev.filter((c) => !(c.task_id === task.id && c.date === dateISO)))
    } else {
      const { data, error } = await supabase
        .from('task_completions')
        .insert({ task_id: task.id, date: dateISO, user_id: user.id })
        .select()
        .single()
      if (error) throw error
      setCompletions((prev) => [...prev, data])
    }
  }

  function isCompletedOn(task, dateISO) {
    if (task.recurrence === 'none') return task.completed
    return completions.some((c) => c.task_id === task.id && c.date === dateISO)
  }

  // ---- Routines ----
  async function createRoutine(name) {
    const { data, error } = await supabase.from('routines').insert({ name, user_id: user.id }).select().single()
    if (error) throw error
    setRoutines((prev) => [...prev, data])
    return data
  }

  async function deleteRoutine(id) {
    const { error } = await supabase.from('routines').delete().eq('id', id)
    if (error) throw error
    setRoutines((prev) => prev.filter((r) => r.id !== id))
    setRoutineItems((prev) => prev.filter((i) => i.routine_id !== id))
  }

  async function addRoutineItem(routineId, fields) {
    const sort_order = routineItems.filter((i) => i.routine_id === routineId).length
    const { data, error } = await supabase
      .from('routine_items')
      .insert({ ...fields, routine_id: routineId, user_id: user.id, sort_order })
      .select()
      .single()
    if (error) throw error
    setRoutineItems((prev) => [...prev, data])
    return data
  }

  async function deleteRoutineItem(id) {
    const { error } = await supabase.from('routine_items').delete().eq('id', id)
    if (error) throw error
    setRoutineItems((prev) => prev.filter((i) => i.id !== id))
  }

  async function applyRoutineToDate(routineId, dateISO) {
    const items = routineItems.filter((i) => i.routine_id === routineId)
    const rows = items.map((i) => ({
      title: i.title,
      category: i.category,
      type: i.type,
      start_time: i.start_time,
      duration_minutes: i.duration_minutes,
      date: dateISO,
      recurrence: 'none',
    }))
    if (rows.length) await addTasksBulk(rows)
  }

  // ---- Notes (notepad) ----

  /**
   * Inserts one note row per string in `contents` in a single request —
   * used when a capture is split into multiple topics via
   * lib/notesParsing.js's splitIntoTopics() before this is called.
   * @param {string[]} contents - raw text for each note to create.
   * @param {object} [extraFields={}] - extra columns applied to EVERY new
   *   row, e.g. { label_ids: [id] } when capturing while a label filter is
   *   active. Callers should only pass label_ids once labels exist (i.e.
   *   migration 008 has run), otherwise the insert fails on the missing column.
   */
  async function addNotesBulk(contents, extraFields = {}) {
    if (!contents.length) return []
    const payload = contents.map((content) => ({ ...extraFields, content, user_id: user.id }))
    const { data, error } = await supabase.from('notes').insert(payload).select()
    if (error) throw error
    setNotes((prev) => [...data, ...prev]) // newest-first, matching the fetch order
    return data
  }

  /**
   * Updates a note's columns.
   * @param {string} id - note id.
   * @param {object} fields - columns to change.
   * @param {object} [options]
   * @param {boolean} [options.touch=true] - also bump updated_at (which the
   *   card shows as "Edited <time>"). Label changes pass false, since
   *   tagging a note isn't editing what it says.
   *   TODO: pin/color changes still bump updated_at (pre-v4 behavior, left
   *   unchanged here); switch them to touch:false too if that feels wrong.
   */
  async function updateNote(id, fields, { touch = true } = {}) {
    const payload = touch ? { ...fields, updated_at: new Date().toISOString() } : fields
    const { data, error } = await supabase
      .from('notes')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setNotes((prev) => prev.map((n) => (n.id === id ? data : n)))
    return data
  }

  async function deleteNote(id) {
    const { error } = await supabase.from('notes').delete().eq('id', id)
    if (error) throw error
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  /**
   * Creates a task from a note's parsed topic+bullets (topic becomes the
   * task title, bullets become the task's `notes` field as a "- " list),
   * then marks the source note as converted and links it to the new task
   * via converted_task_id — the note is NOT deleted, so it stays visible
   * as a record of what was already acted on (see migration 003's comment
   * on why converted_task_id uses ON DELETE SET NULL rather than CASCADE).
   * New tasks land in the tray (no date/start_time) — same as anything
   * else added without explicit scheduling — so the normal drag/tap flow
   * still applies to give it a time block.
   * @param {object} note - a row from the `notes` state array.
   * @returns {Promise<object>} the newly created task.
   */
  async function convertNoteToTask(note) {
    const { topic, bullets } = parseNoteDisplay(note.content)
    const newTask = await addTask({
      title: topic || note.content.slice(0, 80),
      notes: bullets.length ? bullets.map((b) => `- ${b}`).join('\n') : null,
      type: 'todo',
      category: 'personal',
      pinned: false,
    })
    await updateNote(note.id, { converted: true, converted_task_id: newTask.id })
    return newTask
  }

  // ---- Note labels (categories) — see migration 008 / lib/noteLabels.js ----

  /**
   * Creates a label, or returns the existing one if a label with the same
   * name (ignoring case) already exists — so typing "work" when "Work"
   * exists just reuses "Work" rather than failing on the unique index.
   * @param {string} rawName - name as typed.
   * @returns {Promise<object>} the new or existing label row.
   * @throws if the name is empty after cleanup, or on a database error.
   */
  async function createNoteLabel(rawName) {
    const name = normalizeLabelName(rawName)
    if (!name) throw new Error('Label name is empty')
    const existing = findLabelByName(noteLabels, name)
    if (existing) return existing
    const { data, error } = await supabase
      .from('note_labels')
      .insert({ name, user_id: user.id })
      .select()
      .single()
    if (error) throw error
    setNoteLabels((prev) => [...prev, data])
    setNoteLabelsError(null) // a successful write proves the table exists now
    return data
  }

  /**
   * Renames a label; every note carrying it shows the new name at once,
   * since notes store the label's id, not its name.
   * @param {string} id - label id.
   * @param {string} rawName - new name as typed.
   * @returns {Promise<object>} the updated label row.
   * @throws if the name is empty, clashes with ANOTHER label (ignoring
   *   case), or on a database error.
   */
  async function renameNoteLabel(id, rawName) {
    const name = normalizeLabelName(rawName)
    if (!name) throw new Error('Label name is empty')
    const clash = findLabelByName(noteLabels, name)
    if (clash && clash.id !== id) throw new Error(`A label named "${clash.name}" already exists`)
    const { data, error } = await supabase.from('note_labels').update({ name }).eq('id', id).select().single()
    if (error) throw error
    setNoteLabels((prev) => prev.map((l) => (l.id === id ? data : l)))
    return data
  }

  /**
   * Deletes a label and removes it from every note, via the
   * delete_note_label database function (one transaction — see migration
   * 008). Notes themselves are kept; they just lose that label. Local state
   * is updated the same way so the UI doesn't need a refetch.
   * @param {string} id - label id.
   */
  async function deleteNoteLabel(id) {
    const { error } = await supabase.rpc('delete_note_label', { p_label_id: id })
    if (error) throw error
    setNoteLabels((prev) => prev.filter((l) => l.id !== id))
    setNotes((prev) =>
      prev.map((n) =>
        Array.isArray(n.label_ids) && n.label_ids.includes(id)
          ? { ...n, label_ids: n.label_ids.filter((x) => x !== id) }
          : n
      )
    )
  }

  /**
   * Replaces a note's full set of labels. Does not bump updated_at (see
   * updateNote's `touch` option).
   * @param {string} noteId
   * @param {string[]} labelIds - the complete new set (use lib/noteLabels.js's
   *   toggleLabelId to compute it).
   * @returns {Promise<object>} the updated note row.
   */
  async function setNoteLabelsFor(noteId, labelIds) {
    return updateNote(noteId, { label_ids: labelIds }, { touch: false })
  }

  return {
    loading,
    tasks,
    completions,
    routines,
    routineItems,
    notes,
    noteLabels,
    noteLabelsError,
    refetch,
    addTask,
    addTasksBulk,
    updateTask,
    deleteTask,
    deleteTasksBulk,
    toggleCompletion,
    isCompletedOn,
    createRoutine,
    deleteRoutine,
    addRoutineItem,
    deleteRoutineItem,
    applyRoutineToDate,
    addNotesBulk,
    updateNote,
    deleteNote,
    convertNoteToTask,
    createNoteLabel,
    renameNoteLabel,
    deleteNoteLabel,
    setNoteLabelsFor,
  }
}
