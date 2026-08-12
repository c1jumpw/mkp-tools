/**
 * =============================================================================
 * FILE: src/hooks/useEntryImages.js
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Manages the image ROWS (metadata: storage path, label, order) attached
 *   to a single task or note. Used by components/ImageAttachments.jsx,
 *   mounted per-entry (one task being edited, or one note's photos expanded)
 *   rather than held in the app-wide useDayForgeData hook.
 *
 * WHY A SEPARATE, PER-ENTRY HOOK RATHER THAN LIVING IN useDayForgeData
 *   useDayForgeData eagerly fetches ALL of the user's tasks/notes/routines
 *   on load, because the Dashboard genuinely needs all of them at once (to
 *   compute the timeline, forecast counts, etc). Images don't have that
 *   requirement — only the CURRENTLY OPEN task or note's images are ever
 *   needed at a time. Eagerly fetching every image row (and, worse,
 *   eagerly downloading every thumbnail) for every task and note the user
 *   has would not scale as the image count grows, for no benefit (nothing
 *   outside the currently-open entry's UI displays images). So this hook
 *   is mounted fresh per-entry instead — see ImageAttachments.jsx for how
 *   TaskModal and NotesPanel each mount it only when relevant (TaskModal:
 *   always, for an existing task; NotesPanel: only once a note's "Photos"
 *   section is expanded).
 *
 * KEY RESPONSIBILITIES
 *   - Fetch image rows for the given (kind, entryId) on mount / entryId change.
 *   - addImage(): compress + upload the file (lib/entryImages.js), then
 *     insert the metadata row with its label.
 *   - updateLabel(), deleteImage(): straightforward CRUD, deleteImage also
 *     removes the underlying Storage file (best-effort — a failed file
 *     removal doesn't block removing the now-orphaned row, since a stray
 *     file in Storage is a much smaller problem than a delete action that
 *     appears to silently fail).
 * =============================================================================
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { compressImage, uploadEntryImage, deleteEntryImageFile } from '../lib/entryImages'

/**
 * @param {'task'|'note'} kind
 * @param {string|null} entryId - task or note id; pass null/undefined to
 *   keep the hook idle (e.g. a not-yet-saved new task with no id yet).
 */
export function useEntryImages(kind, entryId) {
  const table = kind === 'task' ? 'task_images' : 'note_images'
  const fkColumn = kind === 'task' ? 'task_id' : 'note_id'

  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(false)

  const refetch = useCallback(async () => {
    if (!entryId) {
      setImages([])
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq(fkColumn, entryId)
      .order('sort_order', { ascending: true })
    if (!error) setImages(data)
    setLoading(false)
  }, [entryId, table, fkColumn])

  useEffect(() => {
    refetch()
  }, [refetch])

  /**
   * Compresses and uploads `file`, then inserts its metadata row.
   * @param {string} userId
   * @param {File} file
   * @param {string} label - may be empty string; stored as null if so.
   */
  async function addImage(userId, file, label) {
    const compressed = await compressImage(file)
    const path = await uploadEntryImage(userId, kind, entryId, compressed)
    const { data, error } = await supabase
      .from(table)
      .insert({ [fkColumn]: entryId, user_id: userId, storage_path: path, label: label || null, sort_order: images.length })
      .select()
      .single()
    if (error) throw error
    setImages((prev) => [...prev, data])
    return data
  }

  async function updateLabel(id, label) {
    const { data, error } = await supabase
      .from(table)
      .update({ label: label || null })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setImages((prev) => prev.map((img) => (img.id === id ? data : img)))
  }

  async function deleteImage(id, storagePath) {
    try {
      await deleteEntryImageFile(storagePath)
    } catch {
      // Best-effort — see file header: an orphaned Storage file is a
      // smaller problem than a delete action that appears to fail outright.
    }
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw error
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  return { images, loading, addImage, updateLabel, deleteImage, refetch }
}
