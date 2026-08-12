/**
 * =============================================================================
 * FILE: src/lib/entryImages.js
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Storage + compression helpers for image attachments on tasks and notes.
 *   Shared by both (see hooks/useEntryImages.js and components/
 *   ImageAttachments.jsx), parameterized by `kind` ('task' | 'note') so the
 *   same functions serve both without duplicating this logic twice.
 *
 * KEY RESPONSIBILITIES
 *   - compressImage(): downscales + re-encodes a selected photo BEFORE
 *     upload, via an off-screen <canvas> — see WHY COMPRESS below.
 *   - uploadEntryImage(): pushes the (compressed) image to the private
 *     'entry-images' Storage bucket under a path prefixed by the owning
 *     user's id (required for the bucket's RLS policies — see
 *     supabase/migrations/004_entry_images.sql).
 *   - fetchEntryImageObjectUrl() / deleteEntryImageFile(): download-as-blob-
 *     URL and delete, same pattern as lib/voiceNotes.js.
 *
 * WHY COMPRESS BEFORE UPLOAD
 *   A phone camera photo is commonly 3-8MB. With MULTIPLE images per entry
 *   (the explicit requirement here) across potentially many tasks/notes,
 *   uncompressed originals would burn through Supabase's free storage tier
 *   quickly and make every upload/thumbnail-load slow on a mobile
 *   connection. Downscaling to a reasonable max dimension (1600px — plenty
 *   for viewing on any screen this app renders on) and re-encoding as JPEG
 *   at a moderate quality typically cuts file size by 80-95% with no
 *   visible quality loss for this app's use case (reference photos
 *   attached to a task/note, not professional photography). If the browser
 *   can't process the image for any reason (unusual format, decode
 *   failure), compression is skipped and the original file is uploaded
 *   as-is — correctness over optimization.
 *
 * EDGE CASES
 *   - Non-image files passed to compressImage() are returned unchanged
 *     (this module doesn't validate file type — the caller's <input
 *     accept="image/*"> is the primary guard, this is just defensive).
 *   - createImageBitmap() throwing (corrupt file, unsupported format) is
 *     caught and falls back to the original File object.
 * =============================================================================
 */

import { supabase } from './supabaseClient'

const BUCKET = 'entry-images'
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

function extensionForMimeType(mimeType) {
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  return 'jpg'
}

/**
 * Downscales (if needed) and re-encodes an image file as JPEG, via canvas.
 * @param {File|Blob} file
 * @returns {Promise<Blob>} the compressed image, or the original file
 *   unchanged if it isn't an image or compression fails for any reason.
 */
export async function compressImage(file) {
  if (!file.type || !file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    let { width, height } = bitmap
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    return blob || file // toBlob can resolve null in rare failure cases — fall back to original
  } catch {
    return file
  }
}

/**
 * Uploads an image (already compressed by the caller, typically) to the
 * entry-images bucket.
 * @param {string} userId
 * @param {'task'|'note'} kind
 * @param {string} entryId - the task or note id this image belongs to.
 * @param {Blob} blob
 * @returns {Promise<string>} the storage path to save on the image row.
 */
export async function uploadEntryImage(userId, kind, entryId, blob) {
  const ext = extensionForMimeType(blob.type || 'image/jpeg')
  const path = `${userId}/${kind}s/${entryId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  })
  if (error) throw error
  return path
}

/**
 * Downloads a stored image and returns a browser object URL for display.
 * CALLER MUST URL.revokeObjectURL() the result when done — same
 * responsibility pattern as lib/voiceNotes.js's fetchVoiceNoteObjectUrl.
 */
export async function fetchEntryImageObjectUrl(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) throw error
  return URL.createObjectURL(data)
}

/** Deletes an image file from Storage. Safe to call on an already-missing path. */
export async function deleteEntryImageFile(path) {
  if (!path) return
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}
