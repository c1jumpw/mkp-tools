/**
 * =============================================================================
 * FILE: src/lib/entryAttachments.js
 * VERSION: v1 (renamed and broadened from lib/entryImages.js — see
 *          REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Storage + compression helpers for FILE attachments on tasks and notes —
 *   any file type (photos, PDFs, documents, etc), not just images. Shared
 *   by both (see hooks/useEntryAttachments.js and components/
 *   FileAttachments.jsx), parameterized by `kind` ('task' | 'note').
 *
 * KEY RESPONSIBILITIES
 *   - compressIfImage(): downscales + re-encodes a file BEFORE upload, but
 *     ONLY if it's actually an image — every other file type passes through
 *     unchanged (a PDF can't be "compressed" this way; attempting to would
 *     corrupt it).
 *   - uploadEntryAttachment(): pushes the file to the private
 *     'entry-images' Storage bucket (name kept for historical reasons — see
 *     migrations/005_generic_attachments.sql; it holds any file type now)
 *     under a path prefixed by the owning user's id, preserving the
 *     original filename for readability and correct download behavior.
 *   - fetchEntryAttachmentBlob() / fetchEntryAttachmentObjectUrl() /
 *     deleteEntryAttachmentFile(): same download-as-blob / delete pattern
 *     as lib/voiceNotes.js.
 *
 * WHY COMPRESS IMAGES SPECIFICALLY (unchanged from the original file)
 *   A phone camera photo is commonly 3-8MB; with multiple attachments per
 *   entry, uncompressed originals would burn through Supabase's free
 *   storage tier quickly. Downscaling to 1600px max dimension and
 *   re-encoding as JPEG typically cuts file size 80-95% with no visible
 *   quality loss for reference photos. Non-image files (documents, PDFs)
 *   are stored as-is — there's no equivalent safe "compress" operation
 *   available client-side for arbitrary file formats.
 *
 * REVISION HISTORY
 *   (as lib/entryImages.js) v1 — image-only: fixed .jpg/.png/etc extension
 *       guessed from MIME type, no original filename or MIME type stored.
 *   v1 (this file, entryAttachments.js) — broadened to any file type per
 *       user request:
 *     - Renamed compressImage -> compressIfImage (name now reflects that
 *       it's conditional, not universal).
 *     - uploadEntryAttachment (renamed from uploadEntryImage) now preserves
 *       the ORIGINAL filename (sanitized) in the storage path instead of
 *       guessing an extension from MIME type — far more reliable for
 *       arbitrary file types (a MIME-to-extension map can't cover every
 *       document format; the browser already knows the real filename).
 *     - Returns {path, mimeType, originalFilename} instead of just a path
 *       string, since callers now need to persist mime_type and
 *       original_filename on the attachment row (see migration 005).
 * =============================================================================
 */

import { supabase } from './supabaseClient'

const BUCKET = 'entry-images' // historical name; holds any file type now — see header note
const MAX_IMAGE_DIMENSION = 1600
const JPEG_QUALITY = 0.82

// Strips characters that are unsafe or awkward in a Storage object path,
// keeping the result human-readable (unlike a fully-generated random name)
// so browsing the bucket directly, if ever needed, still makes sense.
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
}

/**
 * Downscales + re-encodes an image file as JPEG, via canvas. Non-image
 * files (or images the browser fails to decode) pass through unchanged.
 * @param {File|Blob} file
 * @returns {Promise<Blob|File>}
 */
export async function compressIfImage(file) {
  if (!file.type || !file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    let { width, height } = bitmap
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      const scale = MAX_IMAGE_DIMENSION / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    return blob || file
  } catch {
    return file
  }
}

/**
 * Compresses (if an image) and uploads a file to the entry-images bucket.
 * @param {string} userId
 * @param {'task'|'note'} kind
 * @param {string} entryId - the task or note id this attachment belongs to.
 * @param {File} file - the ORIGINAL file, before any compression — this
 *   function handles compression internally so callers don't need to call
 *   compressIfImage() separately, and so the returned mimeType/filename
 *   always correctly describe what's actually in Storage (a compressed
 *   image is re-encoded as JPEG, so its mimeType is 'image/jpeg' even if
 *   the original was a PNG — the filename extension is adjusted to match).
 * @returns {Promise<{path: string, mimeType: string, originalFilename: string}>}
 */
export async function uploadEntryAttachment(userId, kind, entryId, file) {
  const processed = await compressIfImage(file)
  const wasRecompressed = processed !== file
  const mimeType = processed.type || file.type || 'application/octet-stream'

  // If the file was recompressed to JPEG, reflect that in the stored
  // filename's extension too, so a downloaded copy's extension matches its
  // actual content (avoiding a ".png" file that's actually JPEG bytes).
  const baseName = wasRecompressed
    ? file.name.replace(/\.[^.]+$/, '') + '.jpg'
    : file.name
  const safeName = sanitizeFilename(baseName || 'attachment')
  const path = `${userId}/${kind}s/${entryId}/${Date.now()}-${safeName}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, processed, {
    contentType: mimeType,
    upsert: false,
  })
  if (error) throw error
  return { path, mimeType, originalFilename: file.name }
}

/**
 * Downloads a stored attachment's raw Blob (used for downloads and for
 * building an object URL for image display).
 */
export async function fetchEntryAttachmentBlob(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) throw error
  return data
}

/**
 * Downloads a stored attachment and returns a browser object URL. CALLER
 * MUST URL.revokeObjectURL() the result when done — same responsibility
 * pattern as lib/voiceNotes.js.
 */
export async function fetchEntryAttachmentObjectUrl(path) {
  const blob = await fetchEntryAttachmentBlob(path)
  return URL.createObjectURL(blob)
}

/** Deletes an attachment's file from Storage. Safe to call on a missing path. */
export async function deleteEntryAttachmentFile(path) {
  if (!path) return
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}
