/**
 * =============================================================================
 * FILE: src/components/NotesPanel.jsx
 * VERSION: v3 (previously v1-v2 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   A Google-Keep-style notepad for raw, unstructured quick capture — the
 *   step BEFORE a task exists. Sits earlier in the app's funnel than the
 *   tray: Notepad (here) -> Tray (once turned into a task) -> Timeline
 *   (once scheduled).
 *
 * KEY RESPONSIBILITIES
 *   - A capture textarea at the top: paste/type freely, including multiple
 *     unrelated topics in one go separated by "—)" (or "--)"/"–)" — see
 *     lib/notesParsing.js's splitIntoTopics), each becoming its own note.
 *   - A list of existing notes below, each parsed into a topic heading +
 *     bullet lines for display (lib/notesParsing.js's parseNoteDisplay),
 *     with actions: Convert to task, Edit, Delete.
 *   - A "Show converted" toggle (default OFF) so the active view stays
 *     focused on the un-sorted backlog — converting a note doesn't delete
 *     it, just moves it out of the default view, matching how the user
 *     described wanting to "jot and sort later" without losing the record.
 *
 * PROPS
 *   notes           {array}    Full notes list (newest first).
 *   onAddBulk       {function} (contents: string[]) -> Promise; creates one
 *                              note per already-split topic string.
 *   onUpdate        {function} (id, fields) -> Promise; used for inline edits.
 *   onDelete        {function} (id) -> Promise.
 *   onConvert       {function} (note) -> Promise<task>; creates a task from
 *                              this note and links it (see useDayForgeData's
 *                              convertNoteToTask).
 *   onClose         {function} () -> void.
 *
 * WHY THE CAPTURE BOX LIVES HERE, NOT ON THE MAIN DASHBOARD
 *   Per user preference: the user's actual capture habit is long, multi-
 *   topic dumps better suited to a real textarea than a small always-
 *   visible input, and the main day view was deliberately kept uncluttered
 *   earlier in this app's development — a notepad that can accumulate a
 *   real backlog (Keep-style) fits better as its own dedicated panel,
 *   opened from the header, same pattern as Routines/Export.
 *
 * REVISION HISTORY
 *   v1 (initial build) — capture, list, convert/edit/delete, showed the
 *       em-dash "—)" as the documented separator, and errors from any
 *       action (add/convert/edit/delete) were silently swallowed — a
 *       failure (e.g. the notes table migration not yet run) looked
 *       identical to the button simply not working, with no explanation.
 *   v2 (this version), per user feedback:
 *     - All actions now catch and display errors instead of failing
 *       silently, so a real failure is distinguishable from "nothing to do".
 *     - Corrected the documented/displayed separator to the literal "--)"
 *       (two hyphens), matching how the user actually types it — the
 *       parsing logic itself (lib/notesParsing.js) already accepted this
 *       literal form; only the guidance text shown here was misleading.
 *   v3 (this version) — added created/edited timestamps to each note card
 *       (formatTimestamp helper). The database has tracked created_at/
 *       updated_at since the notes table was first created (updateNote in
 *       useDayForgeData.js already refreshes updated_at on every edit) —
 *       this was purely a missing display, not a missing data point.
 *       "Edited" only shows once it's more than a second after creation,
 *       so a never-edited note doesn't show a redundant near-identical
 *       second timestamp.
 * =============================================================================
 */

import { useState } from 'react'
import { splitIntoTopics, parseNoteDisplay } from '../lib/notesParsing'

// Formats an ISO timestamp for display, e.g. "Aug 11, 3:42 PM" — omits the
// year when it's the current year (the common case) to keep it compact,
// includes it otherwise so an old note's date is still unambiguous.
function formatTimestamp(iso) {
  const d = new Date(iso)
  const includeYear = d.getFullYear() !== new Date().getFullYear()
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: includeYear ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function NotesPanel({ notes, onAddBulk, onUpdate, onDelete, onConvert, onClose }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [showConverted, setShowConverted] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [error, setError] = useState('')

  const visibleNotes = showConverted ? notes : notes.filter((n) => !n.converted)
  const convertedCount = notes.filter((n) => n.converted).length

  async function handleCapture() {
    if (!draft.trim()) return
    setError('')
    setBusy(true)
    try {
      const topics = splitIntoTopics(draft)
      if (topics.length) await onAddBulk(topics)
      setDraft('')
    } catch (err) {
      // Surfaced rather than silently failing — if you've just added this
      // feature and haven't run the notes table migration yet in Supabase,
      // this is exactly the kind of error that would show up here.
      setError('Could not save: ' + (err.message || 'unknown error'))
    } finally {
      setBusy(false)
    }
  }

  function startEdit(note) {
    setEditingId(note.id)
    setEditText(note.content)
    setError('')
  }

  async function saveEdit(id) {
    if (!editText.trim()) return
    try {
      await onUpdate(id, { content: editText.trim() })
      setEditingId(null)
    } catch (err) {
      setError('Could not save edit: ' + (err.message || 'unknown error'))
    }
  }

  async function handleConvert(note) {
    setError('')
    setBusy(true)
    try {
      await onConvert(note)
    } catch (err) {
      setError('Could not convert to task: ' + (err.message || 'unknown error'))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(note) {
    if (!window.confirm('Delete this note? This can\'t be undone.')) return
    try {
      await onDelete(note.id)
    } catch (err) {
      setError('Could not delete: ' + (err.message || 'unknown error'))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="plate rounded-lg w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 rise-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-xl">Notes</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-paper)]">✕</button>
        </div>

        {error && <p className="text-xs text-[var(--color-ember)] mb-3">{error}</p>}

        {/* Capture box — see file header for why this lives here rather
            than as a persistent dashboard widget. Marker shown as the
            literal "--)" (two hyphens), matching how the user actually
            types it — earlier UI copy showed an em-dash "—)" instead, which
            is a different character and doesn't match what most keyboards
            produce for a typed "--" without autocorrect converting it. */}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder={'Jot anything… start a new topic mid-thought with --)\n\nGroceries\n- milk\n- eggs --) Doctor appt\n- follow up with insurance'}
          className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm mb-2 resize-none focus:border-[var(--color-ember)] outline-none"
        />
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] text-[var(--color-muted)]">
            Tip: separate unrelated topics with <span className="[font-family:var(--font-mono)]">--)</span> — each becomes its own note.
          </p>
          <button
            onClick={handleCapture}
            disabled={busy || !draft.trim()}
            className="text-sm bg-[var(--color-ember)] disabled:opacity-40 text-[var(--color-ink)] font-semibold rounded px-4 py-1.5 hover:brightness-110 transition flex-shrink-0 ml-3"
          >
            Add
          </button>
        </div>

        {convertedCount > 0 && (
          <label className="flex items-center gap-2 mb-3 text-xs text-[var(--color-muted)]">
            <input type="checkbox" checked={showConverted} onChange={(e) => setShowConverted(e.target.checked)} />
            Show {convertedCount} converted note{convertedCount > 1 ? 's' : ''}
          </label>
        )}

        <div className="space-y-2">
          {visibleNotes.length === 0 && (
            <p className="text-sm text-[var(--color-muted)]">
              {notes.length === 0 ? 'Nothing jotted yet.' : 'Nothing left to sort — everything visible has been converted.'}
            </p>
          )}
          {visibleNotes.map((note) => {
            const { topic, bullets } = parseNoteDisplay(note.content)
            const isEditing = editingId === note.id
            return (
              <div
                key={note.id}
                className={'plate rounded-md p-3 ' + (note.converted ? 'opacity-60' : '')}
                style={{ '--accent': note.converted ? 'var(--color-good)' : 'var(--color-steel)' }}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      autoFocus
                      className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm resize-none focus:border-[var(--color-ember)] outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingId(null)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-paper)]">
                        Cancel
                      </button>
                      <button onClick={() => saveEdit(note.id)} className="text-xs bg-[var(--color-ember)] text-[var(--color-ink)] font-semibold rounded px-2.5 py-1 hover:brightness-110">
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium mb-1">{topic}</p>
                    {bullets.length > 0 && (
                      <ul className="list-disc list-inside text-sm text-[var(--color-muted)] space-y-0.5 mb-2">
                        {bullets.map((b, i) => <li key={i}>{b}</li>)}
                      </ul>
                    )}
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      {note.converted ? (
                        <span className="text-xs text-[var(--color-good)]">✓ Converted to task</span>
                      ) : (
                        <button
                          onClick={() => handleConvert(note)}
                          disabled={busy}
                          className="text-xs text-[var(--color-steel)] hover:brightness-110 disabled:opacity-40"
                        >
                          Convert to task
                        </button>
                      )}
                      <button onClick={() => startEdit(note)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-paper)]">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(note)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ember)]">
                        Delete
                      </button>
                    </div>
                    {/* Created/edited timestamps — "edited" only shown once
                        it's meaningfully different from creation (more than
                        a second apart), since both columns default to the
                        same insert-time value and would otherwise always
                        show "Edited" immediately after creation due to
                        trivial timestamp-serialization differences. */}
                    <p className="text-[10px] text-[var(--color-muted)] mt-1.5">
                      {formatTimestamp(note.created_at)}
                      {new Date(note.updated_at).getTime() - new Date(note.created_at).getTime() > 1000 &&
                        ` · Edited ${formatTimestamp(note.updated_at)}`}
                    </p>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
