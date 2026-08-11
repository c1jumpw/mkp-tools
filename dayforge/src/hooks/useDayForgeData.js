/**
 * =============================================================================
 * FILE: src/hooks/useDayForgeData.js
 * VERSION: v3 (previously v1-v2 — see REVISION HISTORY below)
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
 * =============================================================================
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { parseNoteDisplay } from '../lib/notesParsing'

export function useDayForgeData() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [completions, setCompletions] = useState([]) // [{task_id, date}]
  const [routines, setRoutines] = useState([])
  const [routineItems, setRoutineItems] = useState([])
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [t, c, r, ri, n] = await Promise.all([
      supabase.from('tasks').select('*').order('start_time', { ascending: true, nullsFirst: false }),
      supabase.from('task_completions').select('task_id, date'),
      supabase.from('routines').select('*').order('created_at', { ascending: true }),
      supabase.from('routine_items').select('*').order('sort_order', { ascending: true }),
      supabase.from('notes').select('*').order('created_at', { ascending: false }),
    ])
    if (!t.error) setTasks(t.data)
    if (!c.error) setCompletions(c.data)
    if (!r.error) setRoutines(r.data)
    if (!ri.error) setRoutineItems(ri.data)
    if (!n.error) setNotes(n.data)
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
   */
  async function addNotesBulk(contents) {
    if (!contents.length) return []
    const payload = contents.map((content) => ({ content, user_id: user.id }))
    const { data, error } = await supabase.from('notes').insert(payload).select()
    if (error) throw error
    setNotes((prev) => [...data, ...prev]) // newest-first, matching the fetch order
    return data
  }

  async function updateNote(id, fields) {
    const { data, error } = await supabase
      .from('notes')
      .update({ ...fields, updated_at: new Date().toISOString() })
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

  return {
    loading,
    tasks,
    completions,
    routines,
    routineItems,
    notes,
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
  }
}
