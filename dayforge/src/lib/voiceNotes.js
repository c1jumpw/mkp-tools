/**
 * =============================================================================
 * FILE: src/lib/voiceNotes.js
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Supabase Storage helpers for voice note audio files. Tasks store only a
 *   POINTER (voice_note_path) in the database — the actual audio bytes live
 *   in the private 'voice-notes' Storage bucket (see
 *   supabase/migrations/002_voice_notes.sql for the bucket + RLS setup).
 *
 * KEY RESPONSIBILITIES
 *   - uploadVoiceNote(): pushes a recorded audio Blob to Storage under a
 *     path prefixed with the owning user's id (required for the bucket's
 *     RLS policies to allow it — see migration file).
 *   - fetchVoiceNoteObjectUrl(): downloads a stored audio file and returns a
 *     browser object URL suitable for an <audio> element's src.
 *   - deleteVoiceNoteFile(): removes the audio file from Storage (used when
 *     a voice note is deleted or replaced by a new recording).
 *
 * WHY DOWNLOAD-AND-BLOB RATHER THAN A SIGNED URL
 *   Supabase Storage offers createSignedUrl() as an alternative to a full
 *   download — a temporary public-ish URL that expires after N seconds.
 *   That works fine for short-lived playback, but introduces an expiry
 *   window to manage (what happens if the user pauses playback past the
 *   signed URL's expiry?). Since voice notes here are short (personal task
 *   annotations, not long recordings) and downloaded on-demand only when
 *   the user taps Play (not eagerly for every task in a list), a plain
 *   authenticated download() + local object URL avoids the expiry question
 *   entirely at negligible cost.
 *
 * CALLER RESPONSIBILITY: revoking object URLs
 *   fetchVoiceNoteObjectUrl() calls URL.createObjectURL() internally, which
 *   allocates a browser-managed reference that MUST be released with
 *   URL.revokeObjectURL() when no longer needed, or it leaks memory for the
 *   life of the page. This module does not track/auto-revoke URLs it hands
 *   out, since it doesn't know when the caller is done with them — see
 *   VoiceNoteRecorder.jsx for the revoke-on-unmount/re-record pattern.
 * =============================================================================
 */

import { supabase } from './supabaseClient'

const BUCKET = 'voice-notes'

// Maps a recorded Blob's MIME type to a reasonable file extension for the
// storage path. Falls back to 'webm' (the most common MediaRecorder output)
// if the browser reports something unexpected/unlisted.
function extensionForMimeType(mimeType) {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

/**
 * Uploads a recorded voice note Blob to Storage.
 * @param {string} userId - the owning user's id (from AuthContext); the
 *   resulting path is prefixed with this, which the RLS policies require.
 * @param {string} taskId - the task this voice note belongs to (used only
 *   to make the filename identifiable when browsing the bucket directly;
 *   not otherwise load-bearing).
 * @param {Blob} blob - the recorded audio.
 * @returns {Promise<string>} the storage path to save on the task row as
 *   voice_note_path.
 * @throws if the upload fails (e.g. RLS denial from a malformed path,
 *   network error) — caller is expected to catch and surface to the user.
 */
export async function uploadVoiceNote(userId, taskId, blob) {
  const ext = extensionForMimeType(blob.type || '')
  const path = `${userId}/${taskId}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || 'application/octet-stream',
    upsert: false, // each recording gets a unique timestamped name, so collisions shouldn't happen
  })
  if (error) throw error
  return path
}

/**
 * Downloads a stored voice note and returns a browser object URL for
 * playback. See CALLER RESPONSIBILITY note above — the caller must
 * URL.revokeObjectURL() the result when done with it.
 * @param {string} path - voice_note_path from the task row.
 * @returns {Promise<string>} an object URL (blob:...).
 */
export async function fetchVoiceNoteObjectUrl(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) throw error
  return URL.createObjectURL(data)
}

/**
 * Deletes a voice note's audio file from Storage. Safe to call with a path
 * that no longer exists (Supabase Storage's remove() does not error on a
 * missing object, matching typical delete-is-idempotent expectations).
 * @param {string} path - voice_note_path from the task row.
 */
export async function deleteVoiceNoteFile(path) {
  if (!path) return
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
}
