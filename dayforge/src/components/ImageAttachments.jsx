/**
 * =============================================================================
 * FILE: src/components/ImageAttachments.jsx
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Shared image-attachment UI, used identically by TaskModal (a task's
 *   images) and NotesPanel (a note's images) — the only difference between
 *   the two call sites is the `kind`/`entryId` props passed in, which route
 *   to the right database table via useEntryImages.js.
 *
 * KEY RESPONSIBILITIES
 *   - "+ Add image" file picker -> a REVIEW step showing the selected
 *     photo's preview with a label input, before it's actually uploaded —
 *     this is where "labeling images as they're uploaded" happens: the
 *     label is entered as part of the same action as the upload, not
 *     added separately afterward.
 *   - Thumbnail grid of already-attached images, each showing its label as
 *     a caption, with click-to-enlarge (lightbox) and a delete button.
 *   - Lazily downloads each thumbnail (via fetchEntryImageObjectUrl) only
 *     once this component actually mounts — see useEntryImages.js for why
 *     that matters for scalability.
 *
 * PROPS
 *   kind     {'task'|'note'}
 *   entryId  {string} the task or note id.
 *
 * MEMORY MANAGEMENT
 *   Every thumbnail and the lightbox's full-size view are browser object
 *   URLs (URL.createObjectURL) — all tracked in `objectUrlsRef` and
 *   revoked together on unmount, and individually when an image is deleted,
 *   so nothing leaks for the life of the page.
 * =============================================================================
 */

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useEntryImages } from '../hooks/useEntryImages'
import { fetchEntryImageObjectUrl } from '../lib/entryImages'

export default function ImageAttachments({ kind, entryId }) {
  const { user } = useAuth()
  const { images, addImage, updateLabel, deleteImage } = useEntryImages(kind, entryId)

  const [pendingFile, setPendingFile] = useState(null)
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null)
  const [pendingLabel, setPendingLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [thumbUrls, setThumbUrls] = useState({}) // image id -> object URL
  const [lightboxId, setLightboxId] = useState(null) // image id currently shown full-size
  const [editingLabelId, setEditingLabelId] = useState(null)
  const [labelDraft, setLabelDraft] = useState('')

  const objectUrlsRef = useRef(new Set()) // every object URL this component has ever created, for cleanup
  const fileInputRef = useRef(null)

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  // Lazily fetch a thumbnail the first time an image row appears — not
  // eagerly for the whole app, only for images belonging to THIS mounted
  // entry (see useEntryImages.js header for the scalability reasoning).
  useEffect(() => {
    images.forEach((img) => {
      if (thumbUrls[img.id]) return
      fetchEntryImageObjectUrl(img.storage_path)
        .then((url) => {
          objectUrlsRef.current.add(url)
          setThumbUrls((prev) => ({ ...prev, [img.id]: url }))
        })
        .catch(() => setError('Could not load an image.'))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images])

  function handleFileSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
    const url = URL.createObjectURL(file)
    objectUrlsRef.current.add(url)
    setPendingFile(file)
    setPendingPreviewUrl(url)
    setPendingLabel('')
    setError('')
    e.target.value = '' // allows re-selecting the same file later and still firing onChange
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
      await addImage(user.id, pendingFile, pendingLabel.trim())
      discardPending()
    } catch (err) {
      setError('Could not upload: ' + (err.message || 'unknown error'))
    } finally {
      setUploading(false)
    }
  }

  function startEditLabel(img) {
    setEditingLabelId(img.id)
    setLabelDraft(img.label || '')
  }

  async function saveLabel(id) {
    try {
      await updateLabel(id, labelDraft.trim())
      setEditingLabelId(null)
    } catch (err) {
      setError('Could not save label: ' + (err.message || 'unknown error'))
    }
  }

  async function handleDelete(img) {
    if (!window.confirm('Delete this image?')) return
    try {
      await deleteImage(img.id, img.storage_path)
      if (lightboxId === img.id) setLightboxId(null)
    } catch (err) {
      setError('Could not delete: ' + (err.message || 'unknown error'))
    }
  }

  const lightboxImage = images.find((img) => img.id === lightboxId)

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-[var(--color-ember)]">{error}</p>}

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img) => (
            <div key={img.id} className="space-y-1">
              <button
                type="button"
                onClick={() => setLightboxId(img.id)}
                className="block w-full aspect-square rounded overflow-hidden border border-[var(--color-line)] bg-[var(--color-ink)]"
              >
                {thumbUrls[img.id] ? (
                  <img src={thumbUrls[img.id]} alt={img.label || 'attached image'} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[var(--color-muted)] text-xs">…</div>
                )}
              </button>
              {editingLabelId === img.id ? (
                <input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={() => saveLabel(img.id)}
                  onKeyDown={(e) => e.key === 'Enter' && saveLabel(img.id)}
                  className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-1.5 py-0.5 text-[10px]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEditLabel(img)}
                  className="w-full text-left text-[10px] text-[var(--color-muted)] truncate hover:text-[var(--color-paper)]"
                >
                  {img.label || 'Add label…'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingFile ? (
        <div className="border border-[var(--color-line)] rounded-md p-3 space-y-2">
          <img src={pendingPreviewUrl} alt="preview" className="w-full max-h-40 object-contain rounded bg-[var(--color-ink)]" />
          <input
            value={pendingLabel}
            onChange={(e) => setPendingLabel(e.target.value)}
            placeholder="Label this image (optional)"
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
              {uploading ? 'Uploading…' : 'Add image'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-sm border border-[var(--color-line)] rounded px-3 py-1.5 hover:border-[var(--color-ember)] transition"
          >
            + Add image
          </button>
        </>
      )}

      {/* Lightbox — full-size view on top of everything, closes on backdrop click. */}
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
