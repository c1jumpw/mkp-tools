/**
 * =============================================================================
 * FILE: src/lib/notesParsing.js
 * VERSION: v6 (previously v1-v5 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Parses the raw text of a notepad entry (see NotesPanel.jsx) into a
 *   display-friendly shape (a topic/heading line + bullet detail lines),
 *   splits one big multi-topic paste into several separate notes, and
 *   implements the live "outline typing" shortcut (dash/star/topic-
 *   separator auto-continuation as the user presses Enter).
 *
 * WHY PARSING HAPPENS HERE, NOT IN THE DATABASE
 *   A note's `content` column (see supabase/migrations/003_notes.sql) stores
 *   exactly what the user typed — no structured topic/bullets columns.
 *   Parsing it into topic+bullets is purely a DISPLAY concern, done fresh
 *   every render from the raw text. This means the parsing logic can be
 *   tuned later without a database migration or touching any already-saved
 *   note — old notes just render differently the next time this logic changes.
 *
 * FUNCTIONS IN THIS FILE
 *   - splitIntoTopics(): runs ONCE, when a note is first captured, to turn
 *     one big multi-topic paste into several separate note ROWS, marked
 *     off with "--)".
 *   - parseNoteDisplay(): runs on EVERY render of an already-saved note, to
 *     turn its content into a heading + bullet list for display.
 *   - computeBulletContinuation() / applyBulletAutoContinue(): the LIVE
 *     TYPING SHORTCUT — see the OUTLINE TYPING SHORTCUT section below for
 *     the full rules. Unlike the v1-v5 version of this shortcut, this one
 *     requires PERSISTENT STATE across multiple keystrokes (a single
 *     line's text alone can't tell you "this is the 2nd consecutive blank
 *     Enter in a row") — see WHY THIS NEEDS A STATE REF below.
 *
 * OUTLINE TYPING SHORTCUT (v6 — full rewrite, see REVISION HISTORY)
 *   The convention: "-" lines are topics, "*" lines are supporting details
 *   under a topic, and "--)" separates one note's content from a new one.
 *   "Skipping" means pressing Enter without typing anything on the current
 *   (already-blank-or-bare-marker) line — i.e. a deliberate blank Enter,
 *   as opposed to finishing a line that has real typed content on it.
 *
 *   1. Typing real content and pressing Enter ALWAYS continues at the
 *      level of the line just finished: a line starting with "*" continues
 *      with another "*"; anything else (a "-" line, or a plain line with
 *      no marker at all, e.g. a title) continues with "-". This is what
 *      keeps normal fast typing of many consecutive "*" detail lines
 *      fluid — see WHY NORMAL TYPING STAYS FAST below.
 *   2. Skipping TWICE in a row on a bare "-" line converts the next line
 *      to "*".
 *   3. Skipping ONCE on a bare "*" line keeps it "*" (another star).
 *   4. Skipping TWICE in a row on a bare "*" line converts the next line
 *      back to "-".
 *   5. Skipping THREE times in a row, from anywhere, overrides whatever
 *      rules 2-4 would have produced at that point and instead leaves one
 *      blank line followed by "--) " — starting a brand new topic/note.
 *
 * WHY NORMAL TYPING STAYS FAST (rule 1) DESPITE RULES 2-5 REQUIRING 2-3
 * BLANK PRESSES
 *   Rules 2-5 only ever fire when the CURRENT line is already blank or a
 *   bare marker — i.e. only during a deliberate sequence of blank Enters.
 *   The moment real content is typed on any line, rule 1 takes over again
 *   and the skip counter resets to zero. So writing many "*" lines back to
 *   back (typing content on each, pressing Enter normally each time) never
 *   touches rules 2-5 at all — the 2-3-skip cost is only paid at the
 *   deliberate moments of switching levels or starting a new topic, e.g.:
 *     "- Hive work from call" [Enter]           -> rule 1: another "-"
 *     [Enter] (blank, skip 1)                    -> rule: stays "-" (holding)
 *     [Enter] (blank, skip 2)                     -> rule 2: becomes "*"
 *     "summarize call" [Enter]                    -> rule 1: another "*"
 *     "get plan for reviews" [Enter]               -> rule 1: another "*"
 *     "Google ads fix" [Enter]                      -> rule 1: another "*"
 *     [Enter][Enter][Enter] (blank, skip 1,2,3)      -> rule 5: "--) " (new topic)
 *
 * WHY THIS NEEDS A STATE REF (unlike v1-v5's stateless decideBulletAction)
 *   "This is the 2nd consecutive blank Enter" cannot be determined from the
 *   current line's text alone — after the first blank Enter, the line just
 *   looks like a bare "-" or "*" either way, identical to before any skips
 *   happened. applyBulletAutoContinue() therefore takes a `skipStateRef` —
 *   a plain mutable ref (NOT React state, to avoid a re-render on every
 *   keystroke) holding { streak, fromLevel } — that the CALLER (NotesPanel)
 *   owns and must reset whenever the "typing session" changes (e.g.
 *   switching which note is being edited, or clearing the capture box
 *   after a successful Add) — seeing NotesPanel.jsx's usage for exactly
 *   where those resets happen.
 *
 * REVISION HISTORY
 *   v1 (initial build) — displayed/documented the em-dash "—)" as the
 *       primary separator, though the regex always accepted the literal
 *       "--)" too.
 *   v2 — corrected the displayed separator to the literal "--)".
 *   v3 — added the original (stateless) applyBulletAutoContinue(): typing
 *       real content on a "-" or "*" line and pressing Enter ONCE
 *       immediately continued with "*"/"*" respectively; a single blank
 *       Enter reset to a new "-".
 *   v4 — decideBulletAction() recognized a line ending in ":" as a title.
 *   v5 — loosened that to an isFirstLine flag, since a title extended past
 *       the colon no longer ended in ':'.
 *   v6 (this version) — full rewrite per user's detailed 5-rule spec,
 *       explicitly confirmed to REPLACE the old single-Enter dash->star
 *       behavior with a 2-skip threshold (see OUTLINE TYPING SHORTCUT
 *       above), plus new star-hold/star-to-dash/3-skip-topic-separator
 *       rules. Requires the new stateful skipStateRef mechanism (see WHY
 *       THIS NEEDS A STATE REF above) since multi-press counting can't be
 *       derived from a single line's text. decideBulletAction() (stateless,
 *       first-line/colon based) is REMOVED — computeBulletContinuation()
 *       replaces it entirely, including subsuming the old isFirstLine
 *       title-line behavior (a title with no marker at all still defaults
 *       to "-" under the new rule 1, with no special-casing needed).
 *       Verified the full state machine standalone across 8 sequences,
 *       including a full reproduction of the user's own reference note's
 *       structure end-to-end (title -> dash topic -> 2 skips -> star ->
 *       three fluidly-typed star details -> 3 skips -> new topic).
 * =============================================================================
 */

// Matches the topic-separator convention: literal "--)" (two hyphens, the
// primary way this is typed) or an em/en-dash variant "—)" / "–)" —
// included because some keyboards/autocorrect convert a typed "--"
// into an em-dash automatically, so the SAME intended marker can arrive as
// different literal characters depending on the device.
const TOPIC_SEPARATOR_REGEX = /(?:--|—|–)\)/g

// Recognizes a leading bullet marker ("-", "•", or "*", each optionally
// followed by whitespace) at the start of a line, so it can be stripped
// before re-rendering the line as a proper <li> bullet (avoiding a
// double-bullet look like "• - milk").
const LEADING_BULLET_REGEX = /^[-•*]\s*/

/**
 * Splits one raw capture into an array of separate note content strings,
 * one per "--)"-delimited topic. If no separator is present, returns a
 * single-element array containing the trimmed original text unchanged.
 * Empty segments (e.g. from a trailing separator) are dropped.
 * @param {string} rawText
 * @returns {string[]}
 */
export function splitIntoTopics(rawText) {
  return rawText
    .split(TOPIC_SEPARATOR_REGEX)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

/**
 * Parses a single note's content into a topic (heading) line and an array
 * of bullet detail lines, for display as a card.
 * @param {string} content
 * @returns {{topic: string, bullets: string[]}}
 *   topic: the first non-empty line, with any leading bullet marker
 *          stripped (a note doesn't need to start with a heading — if the
 *          user just wrote bullets straight away, the first bullet becomes
 *          the topic).
 *   bullets: every subsequent non-empty line, each with its leading bullet
 *            marker stripped (re-added visually when rendered).
 */
export function parseNoteDisplay(content) {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) return { topic: '', bullets: [] }

  const stripLeadingBullet = (line) => line.replace(LEADING_BULLET_REGEX, '')
  return {
    topic: stripLeadingBullet(lines[0]),
    bullets: lines.slice(1).map(stripLeadingBullet),
  }
}

// A line counts as "blank" for skip-counting purposes if it's genuinely
// empty, or is a bare marker with nothing typed after it (the state a line
// is left in right after this module auto-inserts "- " or "* ").
function isBlankOrBareMarker(trimmed) {
  return trimmed === '' || trimmed === '-' || trimmed === '*'
}

/**
 * The pure decision core of the outline typing shortcut — see this file's
 * header OUTLINE TYPING SHORTCUT section for the full rule set. Kept
 * separate from applyBulletAutoContinue() (which touches the DOM) so the
 * decision table itself can be tested without a real textarea element.
 *
 * @param {string} currentLineTrimmed - trimmed text of the line about to
 *   be "finished" by the Enter press.
 * @param {{streak: number, fromLevel: 'dash'|'star'|null}} skipState - the
 *   caller's current skip-tracking state (see WHY THIS NEEDS A STATE REF).
 * @returns {{
 *   mode: 'append'|'replace',
 *   insertText: string,
 *   nextSkipState: {streak: number, fromLevel: 'dash'|'star'|null}
 * }}
 *   mode 'append': keep the current line's content as-is and add a new
 *     line after it (used when the current line has real content).
 *   mode 'replace': the current line is blank/bare — its content is
 *     cleared back to the start of the line before inserting the new
 *     blank-line-plus-marker sequence, so repeated skips don't pile up
 *     multiple stray blank lines.
 */
export function computeBulletContinuation(currentLineTrimmed, skipState) {
  if (!isBlankOrBareMarker(currentLineTrimmed)) {
    // Rule 1: normal content continuation. Level is read off the CURRENT
    // line's own marker — "*" continues "*"; anything else (a "-" line, or
    // plain text with no marker at all, e.g. a title) continues "-".
    const level = currentLineTrimmed.startsWith('*') ? 'star' : 'dash'
    return {
      mode: 'append',
      insertText: level === 'star' ? '* ' : '- ',
      nextSkipState: { streak: 0, fromLevel: null },
    }
  }

  // This Enter is a "skip" (blank or bare-marker line). Determine which
  // level we're skip-navigating FROM: if this is the first skip in a new
  // streak, read it off the current bare marker itself (a lone "*" means
  // we were in star context; anything else, including a truly empty line,
  // defaults to dash context); if we're already mid-streak, keep the
  // level the streak started with.
  const newStreak = skipState.streak + 1
  const fromLevel = skipState.streak === 0
    ? (currentLineTrimmed === '*' ? 'star' : 'dash')
    : skipState.fromLevel

  // Rule 5 takes priority over rules 2-4 once triggered: a 3rd consecutive
  // skip overrides whatever the 2nd skip just produced (e.g. a star from
  // rule 2) with the new-topic separator instead.
  if (newStreak >= 3) {
    return { mode: 'replace', insertText: '--) ', nextSkipState: { streak: 0, fromLevel: null } }
  }
  if (fromLevel === 'dash') {
    // Rule 2: 1st skip holds at "-" (waiting to see if a 2nd skip comes);
    // 2nd skip converts to "*".
    return {
      mode: 'replace',
      insertText: newStreak === 1 ? '- ' : '* ',
      nextSkipState: { streak: newStreak, fromLevel: 'dash' },
    }
  }
  // fromLevel === 'star'. Rule 3: 1st skip -> another "*". Rule 4: 2nd
  // skip -> "-".
  return {
    mode: 'replace',
    insertText: newStreak === 1 ? '* ' : '- ',
    nextSkipState: { streak: newStreak, fromLevel: 'star' },
  }
}

/**
 * Textarea onKeyDown handler implementing the outline typing shortcut —
 * call this as `onKeyDown={(e) => applyBulletAutoContinue(e, setMyText,
 * mySkipStateRef)}`. Used by both NotesPanel's capture box and its
 * full-screen note editor overlay, each with their OWN skipStateRef (see
 * this file's header WHY THIS NEEDS A STATE REF).
 *
 * WHY THIS NEEDS TO PREVENT DEFAULT AND MANUALLY REBUILD THE VALUE
 *   A textarea's default Enter behavior just inserts a bare "\n". To insert
 *   "\n* " or "\n- " (or, for a 'replace', to erase a dangling bare marker
 *   first), the default insertion must be prevented and the new value
 *   constructed by hand from the textarea's current value and cursor position.
 * WHY THE CURSOR POSITION IS RESTORED VIA requestAnimationFrame
 *   This is a controlled React textarea — calling the setValue callback
 *   doesn't immediately update `el.value`; React re-renders first. Setting
 *   selectionStart/selectionEnd synchronously here would still act on the
 *   OLD value's length. Deferring to the next animation frame guarantees
 *   the DOM has the new value by the time the cursor is repositioned.
 *
 * @param {React.KeyboardEvent} e - must be from a <textarea>.
 * @param {(newValue: string) => void} setValue - the controlling state setter.
 * @param {React.MutableRefObject<{streak: number, fromLevel: string|null}>} skipStateRef
 */
export function applyBulletAutoContinue(e, setValue, skipStateRef) {
  if (e.key !== 'Enter') return

  const el = e.target
  const cursor = el.selectionStart
  const value = el.value
  const beforeCursor = value.slice(0, cursor)
  const afterCursor = value.slice(cursor)
  const lineStart = beforeCursor.lastIndexOf('\n') + 1
  const currentLine = beforeCursor.slice(lineStart)

  const result = computeBulletContinuation(currentLine.trim(), skipStateRef.current)
  skipStateRef.current = result.nextSkipState

  e.preventDefault()

  let newValue, newCursor
  if (result.mode === 'replace') {
    newValue = value.slice(0, lineStart) + '\n' + result.insertText + afterCursor
    newCursor = lineStart + 1 + result.insertText.length
  } else {
    newValue = beforeCursor + '\n' + result.insertText + afterCursor
    newCursor = beforeCursor.length + 1 + result.insertText.length
  }

  setValue(newValue)
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = newCursor
  })
}
