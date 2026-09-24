/**
 * =============================================================================
 * FILE: src/components/NotesPanel.jsx
 * VERSION: v16 (previously v1-v15 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   A Google-Keep-style notepad for raw, unstructured quick capture — the
 *   step BEFORE a task exists. Sits earlier in the app's funnel than the
 *   tray: Notepad (here) -> Tray (once turned into a task) -> Timeline
 *   (once scheduled).
 *
 * KEY RESPONSIBILITIES
 *   - A capture textarea at the top: paste/type freely, including multiple
 *     unrelated topics in one go separated by "--)" (see
 *     lib/notesParsing.js's splitIntoTopics), each becoming its own note.
 *   - A COMPACT list of existing notes below — each shows its topic heading
 *     plus a short bullet PREVIEW (see MAX_PREVIEW_BULLETS), not the full
 *     content, so browsing many notes stays scannable.
 *   - Tapping a note (or its "Edit" action) opens a dedicated full-screen
 *     EDITOR overlay with autosave — see NOTE EDITOR OVERLAY below.
 *   - A "Show converted" toggle (default OFF) so the active view stays
 *     focused on the un-sorted backlog.
 *
 * PROPS
 *   notes           {array}    Full notes list (newest first).
 *   onAddBulk       {function} (contents: string[]) -> Promise; creates one
 *                              note per already-split topic string.
 *   onUpdate        {function} (id, fields) -> Promise; used by autosave
 *                              while the editor overlay is open.
 *   onDelete        {function} (id) -> Promise.
 *   onConvert       {function} (note) -> Promise<task>; creates a task from
 *                              this note and links it.
 *   onClose         {function} () -> void.
 *
 * NOTE EDITOR OVERLAY (v6)
 *   Editing no longer happens inline in the list (a small 3-row textarea
 *   squeezed into the same card, which — especially with the on-screen
 *   keyboard covering roughly half a phone screen — left almost nothing
 *   visible of a note with more than a couple of lines). Tapping a note now
 *   opens a SEPARATE full-screen overlay (its own fixed-position layer, on
 *   top of the already-full-screen NotesPanel) with the textarea filling
 *   essentially the whole remaining screen height above the keyboard.
 *   Changes autosave (useAutosave, same pattern as TaskModal) rather than
 *   requiring an explicit Save — "Done" just flushes any pending save and
 *   closes back to the compact list.
 *
 * REVISION HISTORY
 *   v1 (initial build) — capture, list, convert/edit/delete, showed the
 *       em-dash "—)" as the documented separator, and errors from any
 *       action were silently swallowed.
 *   v2 — surfaced errors from every action instead of failing silently;
 *       corrected the documented separator to the literal "--)".
 *   v3 — added created/edited timestamps to each note card.
 *   v4 — added a per-note "Photos ▾" toggle mounting ImageAttachments.jsx,
 *       lazily, only once expanded.
 *   v5 — renamed to FileAttachments.jsx/"Files ▾" for the broadened
 *       any-file-type scope; capture textarea auto-fills today's date on
 *       focus when empty; modal goes full-screen on mobile.
 *   v6 (this version), per user feedback with screenshots showing every
 *       note fully expanded in the list AND a cramped 3-line inline edit
 *       box fighting the on-screen keyboard for space:
 *     - List cards now show a capped preview (MAX_PREVIEW_BULLETS lines)
 *       with a "+N more…" indicator instead of the full content, so
 *       browsing many/long notes stays compact and scannable.
 *     - Editing moved out of the inline card entirely into the dedicated
 *       full-screen NOTE EDITOR OVERLAY described above.
 *     - Fixed the panel header (title/close button) rendering clipped
 *       under the status bar/notch on some phones — the modal's full-
 *       screen container now uses `pt-[max(1.25rem,env(safe-area-inset-
 *       top))]` instead of uniform padding, matching the same fix already
 *       applied to the Dashboard's own header.
 *   v7 (this version) — added applyBulletAutoContinue (lib/notesParsing.js)
 *       as an onKeyDown handler on both the capture textarea and the
 *       full-screen editor's textarea: pressing Enter after a "-" or "*"
 *       line auto-continues with "* ", and a blank line (or an unfilled
 *       bullet marker left empty) starts a fresh "- " topic — a direct
 *       typing-shortcut request matching the exact convention visible in
 *       the user's own note-taking screenshots.
 *   v8 (this version) — added note colors (lib/noteColors.js — a "Color"
 *       toggle per note revealing a swatch picker, applied to the same
 *       stripe-accent visual language used everywhere else in the app, not
 *       a full colored-card background) and a plain client-side search box
 *       filtering notes by raw content substring match.
 *   v9 (this version), per user feedback that the stripe-only accent was
 *       too subtle — added a transparent background wash of the chosen
 *       color across the whole card (see lib/noteColors.js's hexToRgba and
 *       its updated design-rationale header), layered over the existing
 *       beveled gradient rather than replacing it, so cards keep their
 *       depth while reading as clearly color-tagged when scanning the list.
 *   v10 — topic and bullet text in the list preview now run through
 *       lib/linkify.jsx, rendering any URL as a real clickable link.
 *   v11 — added note pinning (separate from the unrelated "pinned
 *       reminders" task feature) and an Edit icon button in the card's
 *       top-right corner, initially grouped right next to a Pin icon.
 *   v12 — separated Pin/Edit into two absolutely-positioned elements
 *       (Edit top-right corner, Pin top-center) after they felt too
 *       clustered together grouped in one spot; icons went text-lg on
 *       mobile for bigger touch targets.
 *   v13 (this version), per further feedback:
 *     - Reverted the absolute-positioning layout — icons are back inline
 *       in the same flex row as the topic text (simpler, and reads better
 *       per the user than icons floating above/around it). The pt-10
 *       flow-clearance hack from v12 is gone since it's no longer needed.
 *     - Both icons now rest dim (muted color, 40% opacity) until they
 *       reflect an ACTIVE state: Pin turns ember/full-opacity when the
 *       note is actually pinned; Edit turns ember/full-opacity only while
 *       this note is the one open in the editor overlay
 *       (editingId === note.id).
 *     - Capture box's date auto-fill now appends a colon ("Sep 20,
 *       2026:") — see lib/notesParsing.js v4 for the paired change that
 *       makes a colon-ending line auto-start "- " on the next Enter.
 *   v14 (this version), per further feedback:
 *     - Header row rebuilt as a 3-column CSS grid (1fr auto 1fr) instead
 *       of flexbox, so Pin (the middle column) sits at the row's true
 *       horizontal center regardless of topic length, while Edit
 *       (justify-self-end in its own column) still lands in the same
 *       visual top-right corner as before.
 *     - The capture box's date auto-fill no longer appends a trailing
 *       newline after the colon — the cursor now lands right after
 *       "Sep 20, 2026:" on the SAME line, so a title can be typed inline
 *       there before the writer presses Enter themselves.
 *   v15 (this version) — the outline typing shortcut was fully rewritten
 *       in lib/notesParsing.js v6 to a stateful, multi-skip model (2 skips
 *       to escalate dash->star, 1 skip to hold star, 2 skips to drop back
 *       to dash, 3 skips from anywhere for a new "--)" topic) — see that
 *       file's header for the full rule set. This file now owns two
 *       independent skip-state refs (draftSkipStateRef, editSkipStateRef —
 *       one per textarea, since a skip streak must never leak between the
 *       capture box and the note editor) and resets them at the right
 *       moments: the editor's ref resets whenever `editingId` changes (a
 *       different note opened), and the capture box's ref resets both when
 *       the date auto-fill starts a fresh session and after a successful
 *       Add clears the box. Also updated the on-screen tip text, which
 *       described the old single-skip behavior.
 *   v16 (this version) — per further correction, level-switching moved
 *       entirely off Enter and onto a NEW Space-key gesture (two
 *       consecutive spaces on a bare "-"/"*" flips it — see
 *       lib/notesParsing.js v7's applySpaceFlip). Enter's own rules
 *       simplified to match: 1 skip just holds the current bare line's
 *       level, 2 skips (not 3) trigger the "--) " topic separator. Added
 *       two more refs (draftSpaceStateRef, editSpaceStateRef) alongside
 *       the existing Enter-skip refs, reset at the same moments (note
 *       switched, capture session started/cleared). Both onKeyDown
 *       handlers now call applyBulletAutoContinue AND applySpaceFlip
 *       together — safe to call both unconditionally since each ignores
 *       keys it doesn't care about (mutually exclusive on e.key).
 * =============================================================================
 */

import { useEffect, useRef, useState } from 'react'
import { splitIntoTopics, parseNoteDisplay, applyBulletAutoContinue, applySpaceFlip } from '../lib/notesParsing'
import { NOTE_COLORS, getNoteColorHex, hexToRgba } from '../lib/noteColors'
import { linkifyText } from '../lib/linkify'
import { useAutosave } from '../hooks/useAutosave'
import FileAttachments from './FileAttachments'

const MAX_PREVIEW_BULLETS = 3 // how many bullet lines a collapsed list card shows before "+N more"
const NOTE_COLOR_WASH_ALPHA = 0.16 // transparent background tint strength — "noticeable but not overbearing"

// Today's date as a compact label for the auto-filled capture line, e.g.
// "Aug 11, 2026" — matches the format used elsewhere for note timestamps.
function todayDateLabel() {
  return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

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
  const draftRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [showConverted, setShowConverted] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [error, setError] = useState('')
  const [expandedFilesId, setExpandedFilesId] = useState(null) // note id whose Files section is expanded, if any
  const [colorPickerId, setColorPickerId] = useState(null) // note id whose color swatch picker is open
  const [search, setSearch] = useState('')

  // Skip-tracking state for the ENTER-key outline shortcut (see
  // lib/notesParsing.js's applyBulletAutoContinue/computeBulletContinuation)
  // — TWO independent refs, one per textarea, since the capture box and
  // the note editor are separate typing sessions that must not share a
  // skip streak. Plain refs (not React state) since updating on every
  // keystroke as state would trigger a re-render each time for no visual
  // benefit — these counters have no direct UI representation of their own.
  const draftSkipStateRef = useRef({ streak: 0 })
  const editSkipStateRef = useRef({ streak: 0 })

  // Separate tracking for the SPACE-key level-flip shortcut (see
  // applySpaceFlip) — a plain number (consecutive space-press count), also
  // one per textarea for the same reason as the Enter refs above.
  const draftSpaceStateRef = useRef(0)
  const editSpaceStateRef = useRef(0)

  // Reset the editor's Enter/Space streaks whenever a DIFFERENT note starts
  // being edited (or the editor closes) — a streak from the previously-open
  // note must not carry over and affect a freshly-opened one.
  useEffect(() => {
    editSkipStateRef.current = { streak: 0 }
    editSpaceStateRef.current = 0
  }, [editingId])

  // Search applies first (against the raw content — matches whatever the
  // user actually typed, not just the parsed topic), then the
  // showConverted toggle narrows further. convertedCount below is
  // deliberately computed from the FULL notes list (unaffected by an
  // active search), so the "Show N converted" toggle's count stays stable
  // while someone is searching rather than jumping around as they type.
  const searchLower = search.trim().toLowerCase()
  const searchMatched = searchLower
    ? notes.filter((n) => n.content.toLowerCase().includes(searchLower))
    : notes
  const visibleNotes = showConverted ? searchMatched : searchMatched.filter((n) => !n.converted)
  // Pinned notes float to the top of the list. Array.prototype.sort is
  // stable (guaranteed since ES2019, true in every current browser), so
  // this only reorders by pinned-status and otherwise preserves each
  // group's existing relative order (already newest-first from the fetch
  // in useDayForgeData) — i.e. "pinned notes, newest first" then
  // "everything else, newest first", not a full re-sort that would
  // scramble recency within each group.
  const sortedVisibleNotes = [...visibleNotes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))

  async function handleTogglePin(note) {
    try {
      await onUpdate(note.id, { pinned: !note.pinned })
    } catch (err) {
      setError('Could not ' + (note.pinned ? 'unpin' : 'pin') + ': ' + (err.message || 'unknown error'))
    }
  }
  const convertedCount = notes.filter((n) => n.converted).length

  async function handleSetColor(note, colorKey) {
    setColorPickerId(null)
    try {
      await onUpdate(note.id, { color: colorKey === 'default' ? null : colorKey })
    } catch (err) {
      setError('Could not set color: ' + (err.message || 'unknown error'))
    }
  }

  /**
   * Auto-fills today's date as the first line, but ONLY when the box is
   * still empty. The trailing colon ("Sep 20, 2026:") is a visual cue that
   * this line is the title — functionally, any first line (colon or not)
   * gets the "- " continuation on Enter per computeBulletContinuation()'s
   * rule 1 (see lib/notesParsing.js). Cursor is placed right after the
   * colon, ON THE SAME LINE (not a newline after it) — this lets the
   * writer optionally extend the title inline (e.g. "Sep 20, 2026: Grocery
   * Run") before pressing Enter themselves. Also resets the capture box's
   * skip-tracking state, since auto-filling counts as starting a fresh
   * typing session.
   */
  function handleCaptureFocus() {
    if (draft) return
    const label = todayDateLabel() + ':'
    setDraft(label)
    draftSkipStateRef.current = { streak: 0 }
    draftSpaceStateRef.current = 0
    requestAnimationFrame(() => {
      if (draftRef.current) {
        draftRef.current.selectionStart = draftRef.current.selectionEnd = label.length
      }
    })
  }

  async function handleCapture() {
    if (!draft.trim()) return
    setError('')
    setBusy(true)
    try {
      const topics = splitIntoTopics(draft)
      if (topics.length) await onAddBulk(topics)
      setDraft('')
      // A successful Add ends this typing session — the next thing typed
      // into the (now-empty) box starts a fresh streak for both shortcuts.
      draftSkipStateRef.current = { streak: 0 }
      draftSpaceStateRef.current = 0
    } catch (err) {
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

  // Autosave for the editor overlay — enabled only while it's actually
  // open (editingId set). Payload is just {content}, the only field the
  // overlay edits. See hooks/useAutosave.js for the debounce/flush mechanics.
  const { status: editAutosaveStatus, flush: flushEditAutosave } = useAutosave(
    { content: editText },
    (payload) => onUpdate(editingId, payload),
    { enabled: !!editingId }
  )

  async function handleDoneEditing() {
    await flushEditAutosave()
    setEditingId(null)
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="plate rounded-none sm:rounded-lg w-full h-full sm:h-auto sm:max-w-lg sm:max-h-[85vh] overflow-y-auto px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-xl">Notes</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-paper)]">✕</button>
        </div>

        {error && <p className="text-xs text-[var(--color-ember)] mb-3">{error}</p>}

        <textarea
          ref={draftRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={handleCaptureFocus}
          onKeyDown={(e) => {
            applyBulletAutoContinue(e, setDraft, draftSkipStateRef)
            applySpaceFlip(e, setDraft, draftSpaceStateRef)
          }}
          rows={4}
          placeholder={'Jot anything… start a new topic mid-thought with --)\n\nGroceries\n- milk\n- eggs --) Doctor appt\n- follow up with insurance'}
          className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm mb-2 resize-none focus:border-[var(--color-ember)] outline-none"
        />
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] text-[var(--color-muted)]">
            Tip: separate unrelated topics with <span className="[font-family:var(--font-mono)]">--)</span> — each becomes its own note.
            Space-space on a bare <span className="[font-family:var(--font-mono)]">-</span> or <span className="[font-family:var(--font-mono)]">*</span> flips it; skip a line twice for a new topic (<span className="[font-family:var(--font-mono)]">--)</span>).
          </p>
          <button
            onClick={handleCapture}
            disabled={busy || !draft.trim()}
            className="text-sm bg-[var(--color-ember)] disabled:opacity-40 text-[var(--color-ink)] font-semibold rounded px-4 py-1.5 hover:brightness-110 transition flex-shrink-0 ml-3"
          >
            Add
          </button>
        </div>

        {/* Search — plain client-side substring match against each note's
            raw content (not just the parsed topic), since the notes list
            is always already fully loaded for this user (no separate
            server-side search needed at this scale). */}
        {notes.length > 0 && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-1.5 text-sm mb-3 focus:border-[var(--color-ember)] outline-none"
          />
        )}

        {convertedCount > 0 && (
          <label className="flex items-center gap-2 mb-3 text-xs text-[var(--color-muted)]">
            <input type="checkbox" checked={showConverted} onChange={(e) => setShowConverted(e.target.checked)} />
            Show {convertedCount} converted note{convertedCount > 1 ? 's' : ''}
          </label>
        )}

        <div className="space-y-2">
          {sortedVisibleNotes.length === 0 && (
            <p className="text-sm text-[var(--color-muted)]">
              {searchLower
                ? `No notes match "${search.trim()}".`
                : notes.length === 0
                ? 'Nothing jotted yet.'
                : 'Nothing left to sort — everything visible has been converted.'}
            </p>
          )}
          {sortedVisibleNotes.map((note) => {
            const { topic, bullets } = parseNoteDisplay(note.content)
            // Compact preview: cap the visible bullets, note how many are hidden.
            const previewBullets = bullets.slice(0, MAX_PREVIEW_BULLETS)
            const hiddenCount = bullets.length - previewBullets.length
            // A user-chosen color always wins over the converted/default
            // accent — converted status is still communicated via the
            // "✓ Converted to task" text below, not solely via stripe color.
            const chosenColorHex = getNoteColorHex(note.color)
            const accent = chosenColorHex || (note.converted ? 'var(--color-good)' : 'var(--color-steel)')
            // Layers a transparent wash of the chosen color OVER the
            // existing beveled gradient (see index.css's .plate class)
            // rather than replacing it outright — keeps the card's normal
            // depth/bevel while still reading as noticeably tinted. Only
            // set when a color is actually chosen; unset otherwise so the
            // plain .plate CSS class's own background applies untouched.
            const cardStyle = { '--accent': accent }
            if (chosenColorHex) {
              const wash = hexToRgba(chosenColorHex, NOTE_COLOR_WASH_ALPHA)
              cardStyle.background = `linear-gradient(${wash}, ${wash}), linear-gradient(180deg, var(--color-surface-raised) 0%, var(--color-surface) 100%)`
            }
            return (
              <div
                key={note.id}
                className={'plate rounded-md p-3 ' + (note.converted ? 'opacity-60' : '')}
                style={cardStyle}
              >
                {/* Header row: topic (tap to open the editor), Pin, and
                    Edit as inline icon buttons in the SAME row. Uses a
                    3-column CSS grid (1fr auto 1fr) rather than flexbox so
                    Pin (the auto-sized middle column) sits at the row's
                    true horizontal center regardless of the topic's
                    length — flexbox's justify-between would only push Pin
                    away from Edit proportionally to leftover space, not
                    guarantee an actual center point. Edit's column is
                    forced to the same width as the topic's column (both
                    1fr), but justify-self-end anchors the icon itself to
                    that column's right edge, which is also the row's
                    right edge — so Edit still lands in the same visual
                    corner as before despite sharing a wide track.
                    Both icons rest dim/colorless (muted + reduced opacity)
                    until they reflect an ACTIVE state: Pin turns ember and
                    fully opaque when the note is actually pinned (tapping
                    it is what toggles that state); Edit turns ember and
                    fully opaque only while THIS note is the one currently
                    open in the editor overlay (editingId === note.id). */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-1">
                  <p
                    className="text-sm font-medium cursor-pointer min-w-0 truncate"
                    onClick={() => startEdit(note)}
                  >
                    {linkifyText(topic)}
                  </p>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleTogglePin(note) }}
                    aria-label={note.pinned ? 'Unpin note' : 'Pin note to top'}
                    title={note.pinned ? 'Unpin' : 'Pin to top'}
                    className={
                      'text-lg sm:text-base leading-none transition p-1 ' +
                      (note.pinned
                        ? 'text-[var(--color-ember)] opacity-100'
                        : 'text-[var(--color-muted)] opacity-40 hover:opacity-70')
                    }
                  >
                    📌
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(note) }}
                    aria-label="Edit note"
                    title="Edit"
                    className={
                      'justify-self-end text-lg sm:text-base leading-none transition p-1 ' +
                      (editingId === note.id
                        ? 'text-[var(--color-ember)] opacity-100'
                        : 'text-[var(--color-muted)] opacity-40 hover:opacity-70')
                    }
                  >
                    ✎
                  </button>
                </div>

                {/* Tapping the bullet preview also opens the editor — same
                    "tap to expand" affordance as tasks elsewhere in the app. */}
                <div className="cursor-pointer" onClick={() => startEdit(note)}>
                  {previewBullets.length > 0 && (
                    <ul className="list-disc list-inside text-sm text-[var(--color-muted)] space-y-0.5 mb-1">
                      {previewBullets.map((b, i) => <li key={i} className="truncate">{linkifyText(b)}</li>)}
                    </ul>
                  )}
                  {hiddenCount > 0 && (
                    <p className="text-xs text-[var(--color-muted)] italic mb-1">+{hiddenCount} more…</p>
                  )}
                </div>

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
                  <button onClick={() => handleDelete(note)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ember)]">
                    Delete
                  </button>
                  <button
                    onClick={() => setExpandedFilesId(expandedFilesId === note.id ? null : note.id)}
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-paper)]"
                  >
                    {expandedFilesId === note.id ? 'Hide files ▴' : 'Files ▾'}
                  </button>
                  <button
                    onClick={() => setColorPickerId(colorPickerId === note.id ? null : note.id)}
                    className="flex items-center gap-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-paper)]"
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-[var(--color-line)] inline-block"
                      style={{ backgroundColor: chosenColorHex || 'transparent' }}
                    />
                    Color
                  </button>
                </div>

                {colorPickerId === note.id && (
                  <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-[var(--color-line)]">
                    {NOTE_COLORS.map((c) => {
                      const isSelected = (note.color || 'default') === c.key
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => handleSetColor(note, c.key)}
                          title={c.label}
                          aria-label={c.label}
                          className="w-6 h-6 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: c.hex || 'var(--color-surface-raised)',
                            border: isSelected ? '2px solid var(--color-paper)' : '2px solid var(--color-line)',
                          }}
                        />
                      )
                    })}
                  </div>
                )}
                {expandedFilesId === note.id && (
                  <div className="mt-2">
                    <FileAttachments kind="note" entryId={note.id} />
                  </div>
                )}
                <p className="text-[10px] text-[var(--color-muted)] mt-1.5">
                  {formatTimestamp(note.created_at)}
                  {new Date(note.updated_at).getTime() - new Date(note.created_at).getTime() > 1000 &&
                    ` · Edited ${formatTimestamp(note.updated_at)}`}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* NOTE EDITOR OVERLAY — see file header for why this replaced the
          old inline 3-row textarea. Sits on TOP of the panel above
          (higher z-index), covering the full screen so the textarea gets
          essentially all available vertical space. */}
      {editingId && (
        <div
          className="fixed inset-0 bg-[var(--color-ink)] z-[70] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center justify-between px-4 pb-3 border-b border-[var(--color-line)] flex-shrink-0"
            style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
          >
            <h3 className="text-sm font-semibold text-[var(--color-muted)] uppercase tracking-wide">Editing note</h3>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide">
                {editAutosaveStatus === 'saving' && 'Saving…'}
                {editAutosaveStatus === 'saved' && 'Saved'}
                {editAutosaveStatus === 'error' && <span className="text-[var(--color-ember)]">Save failed</span>}
              </span>
              <button onClick={handleDoneEditing} className="text-sm text-[var(--color-ember)] font-semibold">
                Done
              </button>
            </div>
          </div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              applyBulletAutoContinue(e, setEditText, editSkipStateRef)
              applySpaceFlip(e, setEditText, editSpaceStateRef)
            }}
            autoFocus
            className="flex-1 w-full bg-[var(--color-ink)] text-[var(--color-paper)] p-4 text-base resize-none outline-none"
          />
        </div>
      )}
    </div>
  )
}
