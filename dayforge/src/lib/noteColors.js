/**
 * =============================================================================
 * FILE: src/lib/noteColors.js
 * VERSION: v1 (new file)
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
 * WHY ONLY THE STRIPE ACCENT, NOT A FULL COLORED CARD BACKGROUND
 *   Google Keep's colored notes recolor the ENTIRE card background. This
 *   app's existing "plate" card style (see index.css) already uses a
 *   colored left-edge stripe (the `--accent` CSS variable) to indicate
 *   category everywhere else in the app (task cards: ember for personal,
 *   steel for work). Reusing that same visual language for note colors —
 *   rather than introducing a second, different "fully-tinted card"
 *   treatment just for notes — keeps the app visually consistent, and
 *   avoids the real risk of a saturated full-card background clashing with
 *   the app's dark theme or hurting text legibility.
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
