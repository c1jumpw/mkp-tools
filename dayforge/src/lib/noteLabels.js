/**
 * =============================================================================
 * FILE: src/lib/noteLabels.js
 * VERSION: v1 (initial)
 * =============================================================================
 * PURPOSE
 *   Pure helper functions for note LABELS (categories): name cleanup,
 *   ordering, toggling a label on a note, filtering the notes list by the
 *   active filter chip, and per-chip counts. Kept free of React and
 *   Supabase so the rules can be unit-tested on their own and shared by
 *   useDayForgeData.js (data writes) and NotesPanel.jsx (display/filters).
 *
 * DATA SHAPES (see supabase/migrations/008_note_labels.sql)
 *   label: { id, name, sort_order, created_at, user_id }
 *   note:  { ..., label_ids: uuid[] }  — empty array = unlabeled.
 *
 * FILTER VALUES (the `activeFilter` argument used below)
 *   ALL_FILTER ('all')             every note, labeled or not.
 *   UNLABELED_FILTER ('unlabeled') only notes with no (live) labels.
 *   any other string               a label id: notes carrying that label.
 *
 * ASSUMPTIONS / EDGE CASES
 *   - A note may still hold the id of a label that no longer exists (e.g.
 *     deleted on another device before this one refreshed). Every helper
 *     here only counts ids present in the CURRENT labels list ("live"
 *     ids), so stale ids never show as a blank chip, never inflate counts,
 *     and a note holding only stale ids counts as unlabeled.
 *   - `note.label_ids` can be undefined if migration 008 hasn't been run
 *     yet (the column doesn't exist, so select('*') simply omits it) —
 *     treated as an empty array everywhere via getNoteLabelIds().
 * =============================================================================
 */

export const ALL_FILTER = 'all' // chip value: show every note
export const UNLABELED_FILTER = 'unlabeled' // chip value: show only notes with no labels
export const MAX_LABEL_LENGTH = 40 // matches the DB check constraint in migration 008

/**
 * Cleans a label name typed by the user: trims the ends, collapses inner
 * runs of whitespace to one space, and caps the length.
 * @param {string} raw - text as typed.
 * @returns {string} the cleaned name; '' if nothing usable was typed.
 */
export function normalizeLabelName(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_LENGTH)
}

/**
 * Finds an existing label whose name matches, ignoring case — mirrors the
 * database's unique index on lower(name), so the app can reuse an existing
 * label instead of hitting a duplicate-name error.
 * @param {object[]} labels - current labels.
 * @param {string} name - candidate name (normalized or not).
 * @returns {object|undefined} the matching label, if any.
 */
export function findLabelByName(labels, name) {
  const target = normalizeLabelName(name).toLowerCase()
  if (!target) return undefined
  return labels.find((l) => l.name.toLowerCase() === target)
}

/**
 * Returns a NEW array of labels in display order: sort_order first (all 0
 * today — see migration 008's TODO), then name alphabetically ignoring case.
 * @param {object[]} labels
 * @returns {object[]}
 */
export function sortLabels(labels) {
  return [...labels].sort(
    (a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

/**
 * A note's label ids, always as an array (see the migration-not-run edge
 * case in this file's header).
 * @param {object} note
 * @returns {string[]}
 */
export function getNoteLabelIds(note) {
  return Array.isArray(note?.label_ids) ? note.label_ids : []
}

/**
 * A note's labels that still exist, as label objects in display order.
 * @param {object} note
 * @param {object[]} sortedLabels - labels already in display order (sortLabels()).
 * @returns {object[]}
 */
export function getLiveNoteLabels(note, sortedLabels) {
  const ids = new Set(getNoteLabelIds(note))
  return sortedLabels.filter((l) => ids.has(l.id))
}

/**
 * Adds the label if the note doesn't have it, removes it if it does.
 * Also drops any stale ids (labels no longer in `liveIdSet`) while it's
 * rewriting the array anyway, so notes self-clean over time.
 * @param {string[]} currentIds - the note's current label_ids.
 * @param {string} labelId - label being toggled.
 * @param {Set<string>} liveIdSet - ids of labels that currently exist.
 * @returns {string[]} the new label_ids array (a new array, never mutated).
 */
export function toggleLabelId(currentIds, labelId, liveIdSet) {
  const live = currentIds.filter((id) => liveIdSet.has(id))
  return live.includes(labelId) ? live.filter((id) => id !== labelId) : [...live, labelId]
}

/**
 * Whether a note passes the active filter chip.
 * @param {object} note
 * @param {string} activeFilter - ALL_FILTER, UNLABELED_FILTER, or a label id.
 * @param {Set<string>} liveIdSet - ids of labels that currently exist.
 * @returns {boolean}
 */
export function noteMatchesFilter(note, activeFilter, liveIdSet) {
  if (activeFilter === ALL_FILTER) return true
  const liveIds = getNoteLabelIds(note).filter((id) => liveIdSet.has(id))
  if (activeFilter === UNLABELED_FILTER) return liveIds.length === 0
  return liveIds.includes(activeFilter)
}

/**
 * Counts for every filter chip in one pass over the notes.
 * @param {object[]} notes - the notes the chips should count (the caller
 *   decides, e.g. excluding converted notes while they're hidden).
 * @param {Set<string>} liveIdSet - ids of labels that currently exist.
 * @returns {{all: number, unlabeled: number, byLabel: Map<string, number>}}
 */
export function countNotesByFilter(notes, liveIdSet) {
  const byLabel = new Map()
  let unlabeled = 0
  for (const note of notes) {
    const liveIds = getNoteLabelIds(note).filter((id) => liveIdSet.has(id))
    if (liveIds.length === 0) unlabeled += 1
    for (const id of liveIds) byLabel.set(id, (byLabel.get(id) || 0) + 1)
  }
  return { all: notes.length, unlabeled, byLabel }
}

/**
 * True when a Supabase/PostgREST error means migration 008 hasn't been run
 * yet (missing table, column or function), so the UI can say exactly that
 * instead of a cryptic database message.
 *   42P01 / PGRST205  table doesn't exist / not in the API's schema cache
 *   42703 / PGRST204  column doesn't exist / not in the schema cache
 *   42883 / PGRST202  function doesn't exist / not in the schema cache
 * @param {object} err - the error thrown by a Supabase call.
 * @returns {boolean}
 */
export function isMissingLabelSchemaError(err) {
  const code = err?.code || ''
  const msg = (err?.message || '').toLowerCase()
  return (
    ['42P01', 'PGRST205', '42703', 'PGRST204', '42883', 'PGRST202'].includes(code) ||
    msg.includes('note_labels') ||
    msg.includes('label_ids') ||
    msg.includes('delete_note_label')
  )
}
