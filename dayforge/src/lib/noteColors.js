/**
 * =============================================================================
 * FILE: src/lib/noteColors.js
 * VERSION: v2 (previously v1 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Defines the fixed color palette notes can be tagged with (Keep-style
 *   color-coding), and a helper to resolve a stored color KEY back to its
 *   actual hex value for rendering.
 *
 * WHY A SMALL FIXED PALETTE OF NAMED KEYS, NOT A FREE-FORM COLOR PICKER
 *   Storing 'purple' rather than '#9678C9' means the actual hex values
 *   here can be retuned later (e.g. to better match a future theme) without
 *   touching the database or any already-colored note — every note just
 *   picks up the new hex value the next time it renders. A free-form
 *   picker would also risk colors that clash with the app's "forge" theme
 *   or read poorly against its dark background.
 *
 * WHY A STRIPE ACCENT *AND* A TRANSPARENT BACKGROUND WASH
 *   v1 of this feature used ONLY the same colored left-edge stripe accent
 *   (`--accent`) used everywhere else in the app for category color (ember
 *   for personal tasks, steel for work). Per user feedback, that read as
 *   too subtle for note color-coding specifically — the point of coloring
 *   a NOTE is to make it stand out while scanning a list of many notes,
 *   which a 3px stripe alone doesn't achieve as well as an actual colored
 *   card does in something like Google Keep. This version adds a
 *   TRANSPARENT wash of the chosen color across the whole card background
 *   (via hexToRgba below, layered over the existing beveled gradient — see
 *   NotesPanel.jsx), while keeping the stripe too: low alpha (not a flat
 *   opaque fill) keeps text contrast intact and avoids a jarring color
 *   block, while still being immediately noticeable when scanning the list
 *   — "noticeable but not overbearing," per the request.
 *
 * REVISION HISTORY
 *   v1 (initial build) — palette + getNoteColorHex(), stripe accent only.
 *   v2 (this version) — added hexToRgba() for the transparent background
 *       wash described above; updated this file's own design rationale
 *       since it previously argued explicitly AGAINST a colored
 *       background, which the new user request specifically asked for.
 * =============================================================================
 */

// Each color's hex is chosen to read clearly as a thin accent stripe on
// both the light and dark theme's card backgrounds (see index.css's
// :root vs :root[data-theme='light'] token blocks) — a saturated color at
// this small size doesn't need per-theme variants the way a full
// background tint would.
export const NOTE_COLORS = [
  { key: 'default', label: 'Default', hex: null },
  { key: 'red', label: 'Red', hex: '#D9534F' },
  { key: 'orange', label: 'Orange', hex: '#E8622C' },
  { key: 'yellow', label: 'Yellow', hex: '#D9A83B' },
  { key: 'green', label: 'Green', hex: '#6B9E78' },
  { key: 'teal', label: 'Teal', hex: '#4FA9A2' },
  { key: 'blue', label: 'Blue', hex: '#5B8AA6' },
  { key: 'purple', label: 'Purple', hex: '#9678C9' },
  { key: 'pink', label: 'Pink', hex: '#D97AA6' },
]

/**
 * Converts a '#RRGGBB' hex string to an rgba() string at the given alpha —
 * used to tint a note card's background with a transparent wash of its
 * chosen color (see NotesPanel.jsx), rather than a fully opaque fill.
 * @param {string} hex
 * @param {number} alpha - 0 to 1.
 * @returns {string} e.g. 'rgba(217, 83, 79, 0.16)'
 */
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Resolves a note's stored `color` key to its hex value.
 * @param {string|null|undefined} colorKey
 * @returns {string|null} hex value, or null if the key is unset/unrecognized
 *   (caller should fall back to the app's normal default accent in that case).
 */
export function getNoteColorHex(colorKey) {
  if (!colorKey) return null
  const match = NOTE_COLORS.find((c) => c.key === colorKey)
  return match ? match.hex : null
}
