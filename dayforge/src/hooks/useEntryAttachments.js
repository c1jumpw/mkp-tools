/**
 * =============================================================================
 * FILE: src/hooks/useEntryAttachments.js
 * VERSION: v1 (renamed and broadened from hooks/useEntryImages.js — see
 *          REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Manages the attachment ROWS (metadata: storage path, label, mime type,
 *   original filename, order) belonging to a single task or note. Used by
 *   components/FileAttachments.jsx, mounted per-entry rather than held in
 *   the app-wide useDayForgeData hook.
 *
 * WHY A SEPARATE, PER-ENTRY HOOK RATHER THAN LIVING IN useDayForgeData
 *   useDayForgeData eagerly fetches ALL of the user's tasks/notes/routines
 *   on load, because the Dashboard genuinely needs all of them at once.
 *   Attachments don't have that requirement — only the CURRENTLY OPEN
 *   task or note's attachments are ever needed at a time. This hook is
 *   mounted fresh per-entry instead — see FileAttachments.jsx for how
 *   TaskModal and NotesPanel each mount it only when relevant.
 *
 * KEY RESPONSIBILITIES
 *   - Fetch attachment rows for the given (kind, entryId) on mount/change.
 *   - addAttachment(): upload the file (lib/entryAttachments.js handles
 *     compression internally for images), then insert the metadata row
 *     with its label, mime type, and original filename.
 *   - updateLabel(), deleteAttachment(): straightforward CRUD; delete also
 *     removes the underlying Storage file (best-effort).
 *
 * REVISION HISTORY
 *   (as hooks/useEntryImages.js) v1 — image-specific naming throughout
 *       (addImage, deleteImage), no mime_type/original_filename tracked.
 *   v1 (this file, useEntryAttachments.js) — renamed functions to match the
 *       broadened scope (addAttachment, deleteAttachment), reads/writes the
 *       new mime_type and original_filename columns (migration 005), and
 *       points at the renamed task_attachments/note_attachments tables.
 * =============================================================================
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { uploadEntryAttachment, deleteEntryAttachmentFile } from '../lib/entryAttachments'

/**
 * @param {'task'|'note'} kind
 * @param {string|null} entryId - task or note id; pass null/undefined to
 *   keep the hook idle (e.g. a not-yet-saved new task with no id yet).
 */
export function useEntryAttachments(kind, entryId) {
  const table = kind === 'task' ? 'task_attachments' : 'note_attachments'
  const fkColumn = kind === 'task' ? 'task_id' : 'note_id'

  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(false)

  const refetch = useCallback(async () => {
    if (!entryId) {
      setAttachments([])
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq(fkColumn, entryId)
      .order('sort_order', { ascending: true })
    if (!error) setAttachments(data)
    setLoading(false)
  }, [entryId, table, fkColumn])

  useEffect(() => {
    refetch()
  }, [refetch])

  /**
   * Uploads `file` (compressed automatically if it's an image — see
   * lib/entryAttachments.js) and inserts its metadata row.
   * @param {string} userId
   * @param {File} file
   * @param {string} label - may be empty string; stored as null if so.
   */
  async function addAttachment(userId, file, label) {
    const { path, mimeType, originalFilename } = await uploadEntryAttachment(userId, kind, entryId, file)
    const { data, error } = await supabase
      .from(table)
      .insert({
        [fkColumn]: entryId,
        user_id: userId,
        storage_path: path,
        label: label || null,
        mime_type: mimeType,
        original_filename: originalFilename,
        sort_order: attachments.length,
      })
      .select()
      .single()
    if (error) throw error
    setAttachments((prev) => [...prev, data])
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
    setAttachments((prev) => prev.map((a) => (a.id === id ? data : a)))
  }

  async function deleteAttachment(id, storagePath) {
    try {
      await deleteEntryAttachmentFile(storagePath)
    } catch {
      // Best-effort — an orphaned Storage file is a smaller problem than a
      // delete action that appears to fail outright.
    }
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw error
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  return { attachments, loading, addAttachment, updateLabel, deleteAttachment, refetch }
}
