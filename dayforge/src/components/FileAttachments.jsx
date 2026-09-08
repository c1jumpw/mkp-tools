/**
 * =============================================================================
 * FILE: src/components/FileAttachments.jsx
 * VERSION: v1 (renamed and broadened from components/ImageAttachments.jsx —
 *          see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Shared file-attachment UI (any file type — images, PDFs, documents,
 *   etc), used identically by TaskModal and NotesPanel. The only
 *   difference between the two call sites is the `kind`/`entryId` props,
 *   which route to the right database table via useEntryAttachments.js.
 *
 * KEY RESPONSIBILITIES
 *   - "+ Add file" picker (accepts any file type) -> a REVIEW step showing
 *     a preview (image thumbnail, or a generic file badge for anything
 *     else) with a label input, before it's actually uploaded — this is
 *     where "labeling files as they're uploaded" happens.
 *   - Grid of already-attached files: IMAGE attachments get an eagerly-
 *     loaded thumbnail with click-to-enlarge; NON-IMAGE attachments show a
 *     file-type badge + original filename instead, and are fetched only
 *     on demand when the user taps to download (no point downloading a
 *     multi-MB PDF just to list it).
 *
 * PROPS
 *   kind     {'task'|'note'}
 *   entryId  {string} the task or note id.
 *
 * REVISION HISTORY
 *   (as components/ImageAttachments.jsx) v1 — images only: <input
 *       accept="image/*">, every attachment eagerly thumbnail-loaded and
 *       opened in an image lightbox on click.
 *   v1 (this file, FileAttachments.jsx) — broadened to any file type per
 *       user request:
 *     - File input no longer restricts to images.
 *     - Attachments are now split by whether mime_type starts with
 *       'image/': images keep the original eager-thumbnail + lightbox
 *       behavior; everything else renders a compact file-type badge and
 *       downloads on tap instead of trying to preview inline (a browser
 *       has no generic way to thumbnail an arbitrary PDF/document without
 *       a much heavier library, and downloading is the more useful action
 *       for those types anyway).
 * =============================================================================
 */

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useEntryAttachments } from '../hooks/useEntryAttachments'
import { fetchEntryAttachmentObjectUrl } from '../lib/entryAttachments'

// Short badge label derived from a MIME type / filename, e.g. "PDF", "DOCX".
// Falls back to "FILE" for anything unrecognized rather than guessing wrong.
function fileTypeBadge(mimeType, filename) {
  const ext = (filename || '').split('.').pop()?.toUpperCase()
  if (ext && ext.length <= 5) return ext
  if (mimeType?.includes('pdf')) return 'PDF'
  return 'FILE'
}

function isImage(mimeType) {
  return (mimeType || '').startsWith('image/')
}

export default function FileAttachments({ kind, entryId }) {
  const { user } = useAuth()
  const { attachments, addAttachment, updateLabel, deleteAttachment } = useEntryAttachments(kind, entryId)

  const [pendingFile, setPendingFile] = useState(null)
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null)
  const [pendingLabel, setPendingLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [thumbUrls, setThumbUrls] = useState({}) // attachment id -> object URL (images only)
  const [lightboxId, setLightboxId] = useState(null)
  const [editingLabelId, setEditingLabelId] = useState(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [downloadingId, setDownloadingId] = useState(null)

  const objectUrlsRef = useRef(new Set())
  const fileInputRef = useRef(null)

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  // Eagerly fetch thumbnails only for IMAGE attachments — non-image files
  // are fetched on demand instead (see file header).
  useEffect(() => {
    attachments
      .filter((a) => isImage(a.mime_type) && !thumbUrls[a.id])
      .forEach((a) => {
        fetchEntryAttachmentObjectUrl(a.storage_path)
          .then((url) => {
            objectUrlsRef.current.add(url)
            setThumbUrls((prev) => ({ ...prev, [a.id]: url }))
          })
          .catch(() => setError('Could not load an image.'))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments])

  function handleFileSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
    const url = isImage(file.type) ? URL.createObjectURL(file) : null
    if (url) objectUrlsRef.current.add(url)
    setPendingFile(file)
    setPendingPreviewUrl(url)
    setPendingLabel('')
    setError('')
    e.target.value = ''
  }

  function discardPending() {
    setPendingFile(null)
    setPendingPreviewUrl(null)
    setPendingLabel('')
  }

  async function confirmUpload() {
    setUploading(true)
    setError('')
    try {
      await addAttachment(user.id, pendingFile, pendingLabel.trim())
      discardPending()
    } catch (err) {
      setError('Could not upload: ' + (err.message || 'unknown error'))
    } finally {
      setUploading(false)
    }
  }

  function startEditLabel(a) {
    setEditingLabelId(a.id)
    setLabelDraft(a.label || '')
  }

  async function saveLabel(id) {
    try {
      await updateLabel(id, labelDraft.trim())
      setEditingLabelId(null)
    } catch (err) {
      setError('Could not save label: ' + (err.message || 'unknown error'))
    }
  }

  async function handleDelete(a) {
    if (!window.confirm('Delete this file?')) return
    try {
      await deleteAttachment(a.id, a.storage_path)
      if (lightboxId === a.id) setLightboxId(null)
    } catch (err) {
      setError('Could not delete: ' + (err.message || 'unknown error'))
    }
  }

  // Non-image files: fetch on demand and trigger a real file-save using the
  // ORIGINAL filename, rather than eagerly downloading every non-image
  // attachment just to render a list.
  async function handleDownload(a) {
    setDownloadingId(a.id)
    setError('')
    try {
      const url = await fetchEntryAttachmentObjectUrl(a.storage_path)
      objectUrlsRef.current.add(url)
      const link = document.createElement('a')
      link.href = url
      link.download = a.original_filename || 'attachment'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      setError('Could not download: ' + (err.message || 'unknown error'))
    } finally {
      setDownloadingId(null)
    }
  }

  const lightboxImage = attachments.find((a) => a.id === lightboxId)

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-[var(--color-ember)]">{error}</p>}

      {attachments.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {attachments.map((a) => (
            <div key={a.id} className="space-y-1">
              {isImage(a.mime_type) ? (
                <button
                  type="button"
                  onClick={() => setLightboxId(a.id)}
                  className="block w-full aspect-square rounded overflow-hidden border border-[var(--color-line)] bg-[var(--color-ink)]"
                >
                  {thumbUrls[a.id] ? (
                    <img src={thumbUrls[a.id]} alt={a.label || 'attached image'} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--color-muted)] text-xs">…</div>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleDownload(a)}
                  disabled={downloadingId === a.id}
                  className="w-full aspect-square rounded border border-[var(--color-line)] bg-[var(--color-ink)] flex flex-col items-center justify-center gap-1 hover:border-[var(--color-steel)] disabled:opacity-50 transition"
                  title={a.original_filename}
                >
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--color-surface-raised)] text-[var(--color-muted)]">
                    {downloadingId === a.id ? '…' : fileTypeBadge(a.mime_type, a.original_filename)}
                  </span>
                  <span className="text-[9px] text-[var(--color-muted)] truncate max-w-full px-1">
                    {a.original_filename}
                  </span>
                </button>
              )}
              {editingLabelId === a.id ? (
                <input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={() => saveLabel(a.id)}
                  onKeyDown={(e) => e.key === 'Enter' && saveLabel(a.id)}
                  className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-1.5 py-0.5 text-[10px]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEditLabel(a)}
                  className="w-full text-left text-[10px] text-[var(--color-muted)] truncate hover:text-[var(--color-paper)]"
                >
                  {a.label || 'Add label…'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingFile ? (
        <div className="border border-[var(--color-line)] rounded-md p-3 space-y-2">
          {pendingPreviewUrl ? (
            <img src={pendingPreviewUrl} alt="preview" className="w-full max-h-40 object-contain rounded bg-[var(--color-ink)]" />
          ) : (
            <div className="flex items-center gap-2 px-2 py-3 rounded bg-[var(--color-ink)] border border-[var(--color-line)]">
              <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-[var(--color-surface-raised)] text-[var(--color-muted)]">
                {fileTypeBadge(pendingFile.type, pendingFile.name)}
              </span>
              <span className="text-sm truncate">{pendingFile.name}</span>
            </div>
          )}
          <input
            value={pendingLabel}
            onChange={(e) => setPendingLabel(e.target.value)}
            placeholder="Label this file (optional)"
            autoFocus
            className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm focus:border-[var(--color-ember)] outline-none"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={discardPending} className="text-sm text-[var(--color-muted)] hover:text-[var(--color-paper)] px-2">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmUpload}
              disabled={uploading}
              className="text-sm bg-[var(--color-ember)] disabled:opacity-40 text-[var(--color-ink)] font-semibold rounded px-3 py-1 hover:brightness-110 transition"
            >
              {uploading ? 'Uploading…' : 'Add file'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-sm border border-[var(--color-line)] rounded px-3 py-1.5 hover:border-[var(--color-ember)] transition"
          >
            + Add file
          </button>
        </>
      )}

      {lightboxImage && (
        <div
          className="fixed inset-0 bg-black/85 flex items-center justify-center z-[60] p-4"
          onClick={() => setLightboxId(null)}
        >
          <div className="max-w-full max-h-full flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {thumbUrls[lightboxImage.id] && (
              <img src={thumbUrls[lightboxImage.id]} alt={lightboxImage.label || ''} className="max-w-full max-h-[75vh] object-contain rounded" />
            )}
            {lightboxImage.label && <p className="text-sm text-[var(--color-paper)]">{lightboxImage.label}</p>}
            <button
              type="button"
              onClick={() => setLightboxId(null)}
              className="text-sm text-[var(--color-muted)] hover:text-[var(--color-paper)] mt-1"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
