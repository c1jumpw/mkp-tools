/**
 * =============================================================================
 * FILE: src/lib/notesParsing.js
 * VERSION: v7 (previously v1-v6 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Parses the raw text of a notepad entry (see NotesPanel.jsx) into a
 *   display-friendly shape (a topic/heading line + bullet detail lines),
 *   splits one big multi-topic paste into several separate notes, and
 *   implements the live "outline typing" shortcuts (Enter-key continuation
 *   and Space-key level-flipping, both described below).
 *
 * WHY PARSING HAPPENS HERE, NOT IN THE DATABASE
 *   A note's `content` column (see supabase/migrations/003_notes.sql) stores
 *   exactly what the user typed — no structured topic/bullets columns.
 *   Parsing it into topic+bullets is purely a DISPLAY concern, done fresh
 *   every render from the raw text, so this logic can be tuned later
 *   without a database migration or touching any already-saved note.
 *
 * FUNCTIONS IN THIS FILE
 *   - splitIntoTopics(): runs ONCE, when a note is first captured, to turn
 *     one big multi-topic paste into several separate note ROWS, marked
 *     off with "--)".
 *   - parseNoteDisplay(): runs on EVERY render of an already-saved note, to
 *     turn its content into a heading + bullet list for display.
 *   - computeBulletContinuation() / applyBulletAutoContinue(): the ENTER
 *     KEY shortcut — see OUTLINE TYPING SHORTCUTS below.
 *   - computeSpaceFlip() / applySpaceFlip(): the SPACE KEY shortcut — see
 *     OUTLINE TYPING SHORTCUTS below.
 *
 * OUTLINE TYPING SHORTCUTS (v7 — full rewrite, see REVISION HISTORY)
 *   The convention: "-" lines are topics, "*" lines are supporting details
 *   under a topic, and "--)" separates one note's content from a new one.
 *   Two INDEPENDENT keys drive two INDEPENDENT mechanisms:
 *
 *   ENTER ("skipping" = pressing Enter on an already-blank/bare-marker
 *   line, i.e. without typing anything first):
 *     1. Typing real content and pressing Enter continues at the level of
 *        the line just finished: a line starting with "*" continues with
 *        another "*"; anything else (a "-" line, or plain text with no
 *        marker at all, e.g. a title) continues with "-". This is what
 *        keeps fast typing of many consecutive "*" lines fluid — see WHY
 *        NORMAL TYPING STAYS FAST below.
 *     2. Skipping ONCE holds at whatever level the just-left bare line
 *        already was: from a bare "-" (or a truly empty line), the next
 *        line is "-"; from a bare "*", the next line is "*".
 *     3. Skipping a SECOND time in a row (still nothing typed) overrides
 *        rule 2's result and instead leaves one blank line followed by
 *        "--) " — starting a brand new topic/note, regardless of which
 *        level the skips started from ("from anywhere").
 *
 *   SPACE (pressed while the CURRENT line is nothing but a bare "-" or "*"
 *   marker — this shortcut does NOT fire on lines with any other content,
 *   so it never hijacks an ordinary double space typed mid-sentence):
 *     - Two consecutive space presses on a bare "-" line flip it to "*".
 *     - Two consecutive space presses on a bare "*" line flip it to "-".
 *     A single space press is absorbed normally (inserted as a plain
 *     space) — only the SECOND consecutive press triggers the flip,
 *     replacing the line's content with the flipped marker and discarding
 *     any accumulated extra whitespace.
 *
 * WHY NORMAL TYPING STAYS FAST (rule 1) DESPITE ENTER'S SKIP RULES
 *   Rules 2-3 only ever fire when the CURRENT line is already blank or a
 *   bare marker — i.e. only during a deliberate sequence of blank Enters.
 *   The moment real content is typed on any line, rule 1 takes over again
 *   and the skip counter resets to zero. Level-switching (dash<->star) now
 *   happens via the SEPARATE Space-key mechanism, not via Enter at all —
 *   so writing many "*" lines back to back (typing content, Enter, typing
 *   content, Enter...) never touches the Enter skip-counting at all.
 *   Example full sequence:
 *     "- Hive work from call" [Enter]  -> rule 1: another "-"
 *     [space][space] (on that bare "-")  -> flips to "*"
 *     "summarize call" [Enter]            -> rule 1: another "*"
 *     "get plan for reviews" [Enter]        -> rule 1: another "*"
 *     "Google ads fix" [Enter]               -> rule 1: another "*"
 *     [Enter][Enter] (blank, skip 1, skip 2)   -> rule 3: "--) " (new topic)
 *
 * WHY BOTH MECHANISMS NEED STATE REFS (unlike a fully stateless design)
 *   "This is the 2nd consecutive blank Enter" (or space press) cannot be
 *   determined from the current line's text alone — after the first blank
 *   Enter, or the first extra space, the line's TRIMMED content looks
 *   identical to before that keypress happened. Both
 *   applyBulletAutoContinue() and applySpaceFlip() therefore take a
 *   caller-owned mutable ref (NOT React state, to avoid a re-render on
 *   every keystroke) — see NotesPanel.jsx for where these refs live and
 *   get reset (switching notes, clearing the capture box, etc).
 *   applySpaceFlip() additionally self-resets its own ref whenever a
 *   NON-space key is pressed (including Enter) — see its own comment —
 *   so "two spaces IN A ROW" genuinely means consecutive, not "two spaces
 *   at some point with other typing in between".
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
 *   v5 — loosened that to an isFirstLine flag.
 *   v6 — full rewrite to a stateful Enter-only model: 2 skips from a bare
 *       "-" converted to "*", 1 skip from a bare "*" held "*", 2 skips
 *       from a bare "*" converted back to "-", 3 skips from anywhere gave
 *       the topic separator.
 *   v7 (this version) — per further correction, the level-switching
 *       (dash<->star) mechanism moved ENTIRELY off of Enter and onto a NEW
 *       Space-key gesture (computeSpaceFlip/applySpaceFlip): two
 *       consecutive spaces on a bare marker flips it in place. Enter's own
 *       rules simplified correspondingly: skipping once now just HOLDS
 *       whatever level the bare line already is (reading it fresh from the
 *       line's own character each time, no persisted "fromLevel" needed
 *       across presses), and skipping a 2nd time in a row (not a 3rd)
 *       triggers the topic separator. Verified both mechanisms' full
 *       decision tables standalone against every described rule.
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

// A line counts as "blank" for Enter skip-counting purposes if it's
// genuinely empty, or is a bare marker with nothing typed after it (the
// state a line is left in right after this module auto-inserts "- " or "* ").
function isBlankOrBareMarker(trimmed) {
  return trimmed === '' || trimmed === '-' || trimmed === '*'
}

/**
 * The pure decision core of the ENTER-key shortcut — see this file's
 * header OUTLINE TYPING SHORTCUTS section for the full rule set. Kept
 * separate from applyBulletAutoContinue() (which touches the DOM) so the
 * decision table itself can be tested without a real textarea element.
 *
 * @param {string} currentLineTrimmed - trimmed text of the line about to
 *   be "finished" by the Enter press.
 * @param {{streak: number}} skipState - the caller's current Enter
 *   skip-tracking state.
 * @returns {{
 *   mode: 'append'|'replace',
 *   insertText: string,
 *   nextSkipState: {streak: number}
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
      nextSkipState: { streak: 0 },
    }
  }

  // This Enter is a "skip" (blank or bare-marker line).
  const newStreak = skipState.streak + 1

  // Rule 3: a 2nd consecutive skip overrides rule 2's result with the
  // new-topic separator, regardless of which level the skips started from.
  if (newStreak >= 2) {
    return { mode: 'replace', insertText: '--) ', nextSkipState: { streak: 0 } }
  }

  // Rule 2 (1st skip): hold at whatever level the CURRENT bare line
  // already shows — read fresh from its own character each time, no
  // memory of "which level we started from" needed across presses.
  const level = currentLineTrimmed === '*' ? 'star' : 'dash'
  return {
    mode: 'replace',
    insertText: level === 'star' ? '* ' : '- ',
    nextSkipState: { streak: newStreak },
  }
}

/**
 * Textarea onKeyDown handler implementing the ENTER-key shortcut — call as
 * `onKeyDown={(e) => applyBulletAutoContinue(e, setMyText, mySkipStateRef)}`.
 * Used by both NotesPanel's capture box and its full-screen note editor
 * overlay, each with their OWN skipStateRef.
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
 * @param {React.MutableRefObject<{streak: number}>} skipStateRef
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

/**
 * The pure decision core of the SPACE-key shortcut — see this file's
 * header OUTLINE TYPING SHORTCUTS section. Only applies when the line is
 * NOTHING BUT a bare "-" or "*" marker (deliberately narrow — this must
 * never hijack an ordinary double space typed in the middle of a sentence
 * on a "-"/"*" line that already has real content).
 * @param {string} currentLineTrimmed
 * @returns {string|null} the flipped marker text (e.g. '* ') to replace
 *   the line with, or null if this line isn't a bare single marker at all
 *   (the shortcut doesn't apply — caller should let the space insert
 *   normally and reset its streak).
 */
export function computeSpaceFlip(currentLineTrimmed) {
  if (currentLineTrimmed === '-') return '* '
  if (currentLineTrimmed === '*') return '- '
  return null
}

/**
 * Textarea onKeyDown handler implementing the SPACE-key shortcut — call as
 * `onKeyDown={(e) => applySpaceFlip(e, setMyText, mySpaceStateRef)}`
 * ALONGSIDE applyBulletAutoContinue (both attached to the same textarea's
 * onKeyDown; each internally ignores keys it doesn't care about, so
 * calling both unconditionally on every keydown is safe — they only ever
 * mutate state for their own respective key, Enter vs Space).
 *
 * SELF-RESETTING ON ANY NON-SPACE KEY
 *   Unlike applyBulletAutoContinue (whose skip-state naturally resets via
 *   computeBulletContinuation's own branching once real content exists),
 *   this function's "two consecutive spaces" streak has no such natural
 *   text-based reset — pressing Enter, then a letter, then backspace, etc.
 *   would otherwise leave a stale streak=1 lying around to be
 *   (incorrectly) completed by some LATER unrelated space press. So this
 *   function explicitly resets its own ref to 0 on the very first line
 *   whenever the pressed key isn't a space at all.
 *
 * @param {React.KeyboardEvent} e - must be from a <textarea>.
 * @param {(newValue: string) => void} setValue - the controlling state setter.
 * @param {React.MutableRefObject<number>} spaceStateRef - consecutive
 *   space-press count (a plain number, not an object — simpler than the
 *   Enter mechanism's state since there's no "which level" to remember).
 */
export function applySpaceFlip(e, setValue, spaceStateRef) {
  if (e.key !== ' ') {
    spaceStateRef.current = 0
    return
  }

  const el = e.target
  const cursor = el.selectionStart
  const value = el.value
  const beforeCursor = value.slice(0, cursor)
  const afterCursor = value.slice(cursor)
  const lineStart = beforeCursor.lastIndexOf('\n') + 1
  const currentLine = beforeCursor.slice(lineStart)
  const flipTo = computeSpaceFlip(currentLine.trim())

  if (flipTo === null) {
    // Not a bare single marker — this isn't a shortcut candidate at all;
    // let the space insert normally and reset (an ordinary space typed
    // mid-sentence must never accidentally count toward a future flip).
    spaceStateRef.current = 0
    return
  }

  const newStreak = spaceStateRef.current + 1
  if (newStreak < 2) {
    // First space on this bare line: hold, let it insert normally (trim()
    // in computeSpaceFlip already ignores trailing whitespace, so the
    // line still reads as a bare marker on the next press regardless of
    // how many literal space characters have accumulated).
    spaceStateRef.current = newStreak
    return
  }

  // Second consecutive space: flip the marker, discarding any
  // accumulated extra whitespace by replacing the whole line's content.
  e.preventDefault()
  const newValue = value.slice(0, lineStart) + flipTo + afterCursor
  const newCursor = lineStart + flipTo.length
  spaceStateRef.current = 0
  setValue(newValue)
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = newCursor
  })
}
