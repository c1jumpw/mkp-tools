/**
 * =============================================================================
 * FILE: src/components/NoteLabelControls.jsx
 * VERSION: v1 (initial)
 * =============================================================================
 * PURPOSE
 *   The two pieces of UI for note LABELS (categories) that NotesPanel.jsx
 *   mounts — kept in their own file so NotesPanel stays readable:
 *     - NoteLabelPicker: tick/untick labels on ONE note, or type a new
 *       label (which is created AND applied to that note in one go).
 *       Used both on a list card ("Labels" action) and in the full-screen
 *       note editor.
 *     - NoteLabelManager: the "Manage labels" panel — create, rename and
 *       delete labels for all notes at once.
 *
 * DESIGN NOTES
 *   - Labels are shown as tappable pills (a real <button> with
 *     aria-pressed), not checkboxes, so they read the same as the filter
 *     chips at the top of the Notes panel and are easy to hit on a phone.
 *   - Both components report failures through an `onError(action, err)`
 *     prop rather than showing their own message, so every Notes error
 *     appears in the same place (NotesPanel's error line) with the same
 *     "has the database update been run?" hint when relevant.
 *   - Neither component talks to Supabase; they only call the callbacks
 *     they're given (which come from hooks/useDayForgeData.js via
 *     Dashboard -> NotesPanel).
 *
 * EDGE CASES
 *   - Typing a name that already exists (any capitalization) reuses the
 *     existing label — useDayForgeData's createNoteLabel returns it
 *     instead of creating a duplicate — and the picker simply ticks it.
 *   - Renaming to an empty name reverts the field instead of saving.
 * =============================================================================
 */

import { useState } from 'react'
import { MAX_LABEL_LENGTH, normalizeLabelName } from '../lib/noteLabels'

// Shared pill look for a label button; `selected` switches to the ember
// accent used for active states everywhere else in the app. Exported so
// NotesPanel's filter chips use exactly the same look.
export function pillClass(selected) {
  return (
    'text-xs rounded-full px-3 py-1.5 border transition ' +
    (selected
      ? 'bg-[var(--color-ember)] border-[var(--color-ember)] text-[var(--color-ink)] font-semibold'
      : 'border-[var(--color-line)] text-[var(--color-muted)] hover:text-[var(--color-paper)]')
  )
}

/**
 * Small "type a new label + Add" form shared by both components.
 * @param {object} props
 * @param {(name: string) => Promise<void>} props.onSubmit - called with the
 *   cleaned name; the field clears only if this resolves.
 * @param {string} props.placeholder
 * @param {(action: string, err: Error) => void} props.onError
 */
function NewLabelForm({ onSubmit, placeholder, onError }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const name = normalizeLabelName(value)
    if (!name || busy) return
    setBusy(true)
    try {
      await onSubmit(name)
      setValue('')
    } catch (err) {
      onError('create the label', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={MAX_LABEL_LENGTH}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 min-w-0 bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm focus:border-[var(--color-ember)] outline-none"
      />
      <button
        type="submit"
        disabled={busy || !normalizeLabelName(value)}
        className="text-xs bg-[var(--color-ember)] disabled:opacity-40 text-[var(--color-ink)] font-semibold rounded px-3 py-1.5 hover:brightness-110 flex-shrink-0"
      >
        Add
      </button>
    </form>
  )
}

/**
 * Pick which labels ONE note carries.
 * @param {object} props
 * @param {object[]} props.labels - all labels, already in display order.
 * @param {string[]} props.selectedIds - the note's current (live) label ids.
 * @param {(labelId: string) => void|Promise<void>} props.onToggle - add/remove one label.
 * @param {(name: string) => Promise<void>} props.onCreateAndApply - create a
 *   label (or reuse a same-named one) and add it to this note.
 * @param {(action: string, err: Error) => void} props.onError
 */
export function NoteLabelPicker({ labels, selectedIds, onToggle, onCreateAndApply, onError }) {
  const selected = new Set(selectedIds)
  return (
    <div className="space-y-2">
      {labels.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {labels.map((l) => {
            const isOn = selected.has(l.id)
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={isOn}
                onClick={() => onToggle(l.id)}
                className={pillClass(isOn)}
              >
                {isOn ? '✓ ' : ''}
                {l.name}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-[var(--color-muted)]">No labels yet — type one below to create it.</p>
      )}
      <NewLabelForm onSubmit={onCreateAndApply} placeholder="New label" onError={onError} />
    </div>
  )
}

/**
 * Create, rename and delete labels for all notes.
 * @param {object} props
 * @param {object[]} props.labels - all labels, already in display order.
 * @param {Map<string, number>} props.counts - label id -> number of notes
 *   carrying it (shown next to each label and in the delete confirmation).
 * @param {(name: string) => Promise<object>} props.onCreate
 * @param {(id: string, name: string) => Promise<object>} props.onRename
 * @param {(id: string) => Promise<void>} props.onDelete
 * @param {() => void} props.onClose
 * @param {(action: string, err: Error) => void} props.onError
 */
export function NoteLabelManager({ labels, counts, onCreate, onRename, onDelete, onClose, onError }) {
  // In-progress rename text per label id. A label only appears here while
  // its field has been changed and not yet saved; otherwise the field shows
  // the label's saved name.
  const [drafts, setDrafts] = useState({})

  function clearDraft(id) {
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  // Saves a rename when the field loses focus or Enter is pressed. Empty or
  // unchanged text just reverts the field (no request sent).
  async function commitRename(label) {
    const draft = drafts[label.id]
    if (draft === undefined) return
    const name = normalizeLabelName(draft)
    if (!name || name === label.name) {
      clearDraft(label.id)
      return
    }
    try {
      await onRename(label.id, name)
      clearDraft(label.id)
    } catch (err) {
      onError('rename the label', err)
      clearDraft(label.id) // revert to the saved name so the field isn't left showing an unsaved value
    }
  }

  async function handleDelete(label) {
    const n = counts.get(label.id) || 0
    const detail = n
      ? `It will be removed from ${n} note${n === 1 ? '' : 's'}; the notes themselves are kept.`
      : 'No notes use it.'
    if (!window.confirm(`Delete the label "${label.name}"? ${detail}`)) return
    try {
      await onDelete(label.id)
    } catch (err) {
      onError('delete the label', err)
    }
  }

  return (
    <div className="plate rounded-md p-3 mb-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Manage labels</h3>
        <button type="button" onClick={onClose} className="text-xs text-[var(--color-ember)] font-semibold">
          Done
        </button>
      </div>

      {labels.length === 0 && (
        <p className="text-xs text-[var(--color-muted)]">
          Labels group your notes, like Work, Ideas or Travel. A note can have several.
        </p>
      )}

      {labels.length > 0 && (
        <ul className="space-y-2">
          {labels.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <input
                type="text"
                value={drafts[l.id] ?? l.name}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                onBlur={() => commitRename(l)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur() // blur triggers commitRename
                  if (e.key === 'Escape') { clearDraft(l.id); e.currentTarget.blur() }
                }}
                maxLength={MAX_LABEL_LENGTH}
                aria-label={`Rename label ${l.name}`}
                className="flex-1 min-w-0 bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-2 py-1.5 text-sm focus:border-[var(--color-ember)] outline-none"
              />
              <span className="text-[10px] text-[var(--color-muted)] w-14 text-right flex-shrink-0">
                {counts.get(l.id) || 0} note{(counts.get(l.id) || 0) === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(l)}
                className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ember)] flex-shrink-0 px-1 py-1.5"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <NewLabelForm
        onSubmit={async (name) => { await onCreate(name) }}
        placeholder="New label"
        onError={onError}
      />
    </div>
  )
}
