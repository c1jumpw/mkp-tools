/**
 * =============================================================================
 * FILE: src/lib/notesParsing.js
 * VERSION: v5 (previously v1-v4 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Parses the raw text of a notepad entry (see NotesPanel.jsx) into a
 *   display-friendly shape (a topic/heading line + bullet detail lines), and
 *   splits one big multi-topic paste into several separate notes.
 *
 * WHY PARSING HAPPENS HERE, NOT IN THE DATABASE
 *   A note's `content` column (see supabase/migrations/003_notes.sql) stores
 *   exactly what the user typed — no structured topic/bullets columns.
 *   Parsing it into topic+bullets is purely a DISPLAY concern, done fresh
 *   every render from the raw text. This means the parsing logic can be
 *   tuned later (e.g. recognizing another bullet character, or a different
 *   topic-separator convention) without a database migration or touching
 *   any already-saved note — old notes just render differently the next
 *   time this function's logic changes.
 *
 * TWO SEPARATE FUNCTIONS FOR TWO SEPARATE MOMENTS
 *   - splitIntoTopics(): runs ONCE, when a note is first captured, to turn
 *     one big multi-topic paste into several separate note ROWS (matching
 *     how the user described writing — one continuous stream covering
 *     several unrelated topics, marked off with "--)").
 *   - parseNoteDisplay(): runs on EVERY render of an already-saved note, to
 *     turn its (now single-topic) content into a heading + bullet list for
 *     display. A saved note is expected to already be single-topic by the
 *     time this runs (splitIntoTopics happened at capture time), but this
 *     function doesn't assume that — if a note somehow still contains a
 *     "--)" marker (e.g. pasted directly via an edit rather than the normal
 *     capture flow), it simply renders the whole thing as one topic's lines;
 *     it does not re-split on this function's own initiative, since editing
 *     an existing note should not silently multiply it into several notes.
 *   - applyBulletAutoContinue(): a LIVE TYPING AID (not a parsing function
 *     at all — grouped in this file since it encodes the same "-"/"*"
 *     writing convention). Intercepts the Enter key in a note textarea to
 *     auto-continue the user's own dash/star hierarchy — see its own doc
 *     comment for the exact rules.
 *
 * REVISION HISTORY
 *   v1 (initial build) — displayed/documented the em-dash "—)" as the
 *       primary separator, though the regex always accepted the literal
 *       "--)" too.
 *   v2 — corrected per user feedback: "--)" (literal two hyphens) is how
 *       they actually type it, not an em-dash. This was purely a
 *       documentation/UI-copy correction — the underlying regex already
 *       matched "--)" correctly before this change; only the displayed
 *       guidance text (here and in NotesPanel.jsx) was misleading.
 *   v3 — added applyBulletAutoContinue(), a typing-shortcut feature
 *       request: while editing a note, pressing Enter after a line
 *       already using the user's own "-"/"*" convention auto-continues it,
 *       and two Enters in a row (an intentionally blank line) starts a
 *       fresh "-" topic instead of piling up empty bullets.
 *       (Note: this file's top VERSION line was left at v2 when this
 *       change shipped — corrected retroactively in v4 below.)
 *   v4 (this version) — decideBulletAction() now also recognizes a line
 *       ENDING in ":" as a title/heading, auto-starting "- " on Enter
 *       (previously such a line fell through to 'default', a plain
 *       newline). Paired with NotesPanel.jsx's capture-box date auto-fill
 *       now producing "Sep 20, 2026:" (trailing colon added) instead of
 *       "Sep 20, 2026" — the colon both signals "this is the title" to the
 *       writer and is what triggers this new auto-dash behavior on the
 *       very next line.
 *   v5 (this version) — loosened the colon-based title rule: per feedback,
 *       requiring the line to literally END in ':' broke as soon as the
 *       writer typed anything after it (e.g. "Sep 20, 2026: Grocery Run"
 *       no longer ends in ':', so Enter fell back to a plain newline).
 *       decideBulletAction() now accepts an isFirstLine flag — the FIRST
 *       line of a note is always treated as its title regardless of what
 *       it ends with, so Enter after it always drops into the dash list.
 *       The colon-ending check is kept as a secondary rule for a heading
 *       appearing later in a note. Verified the full updated decision
 *       table standalone, including the exact scenario that motivated
 *       this change and confirming no regressions to the dash/star rules.
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

/**
 * Pure decision function: given the TRIMMED content of the line the cursor
 * is currently on (i.e. the line about to be "finished" by pressing
 * Enter), decides what auto-continuation behavior (if any) applies.
 * Separated from applyBulletAutoContinue() below so the decision table
 * itself can be tested without needing a real DOM textarea element.
 *
 * RULES (per user's typing-shortcut request, matching the exact writing
 * convention shown in their example: a "-" line as a topic/sub-task, "*"
 * lines as supporting details under it, a blank line between groups):
 *   - Line is blank, or is a BARE marker with nothing typed after it
 *     ("-" or "*" alone) -> 'reset': the user either intentionally left a
 *     blank line, or pressed Enter again on an auto-inserted bullet
 *     without typing anything into it (the "skipped twice" case) — either
 *     way, start a fresh topic with "- ".
 *   - Line starts with "*" -> 'continue' with "* " (stay in detail mode).
 *   - Line starts with "-" -> 'continue' with "* " (a topic line's own
 *     Enter starts ITS details, per the request: "next line ... should
 *     automatically write a star").
 *   - `isFirstLine` is true -> 'continue' with "- ": the very first line of
 *     a note IS its title by convention (whether that's the auto-filled
 *     "Sep 20, 2026:", a hand-typed "Project X", or a title extended with
 *     more text after the colon like "Sep 20, 2026: Grocery Run") —
 *     pressing Enter right after finishing it should ALWAYS drop into the
 *     dash list, regardless of what the title's last character happens to
 *     be. This replaced an earlier, narrower version of this rule that
 *     only fired when the line ended in ":" — that broke as soon as the
 *     writer typed anything after the colon.
 *   - Line ends with ":" (and isn't the first line) -> 'continue' with
 *     "- ": a colon-terminated heading appearing LATER in a note (e.g.
 *     manually typing "Project X:" partway through, to start a new
 *     sub-topic) gets the same shortcut as a true title line.
 *   - Anything else (plain text with no marker, not the first line, no
 *     trailing colon) -> 'default': let Enter behave normally (plain
 *     newline, no auto-prefix).
 * @param {string} trimmedLine
 * @param {boolean} [isFirstLine=false] - true when this is the very first
 *   line of the whole textarea's content (see applyBulletAutoContinue,
 *   which computes this from the cursor position).
 * @returns {{action: 'default'} | {action: 'continue'|'reset', prefix: string}}
 */
export function decideBulletAction(trimmedLine, isFirstLine = false) {
  if (trimmedLine === '' || trimmedLine === '-' || trimmedLine === '*') {
    return { action: 'reset', prefix: '- ' }
  }
  if (trimmedLine.startsWith('*')) return { action: 'continue', prefix: '* ' }
  if (trimmedLine.startsWith('-')) return { action: 'continue', prefix: '* ' }
  if (isFirstLine) return { action: 'continue', prefix: '- ' }
  if (trimmedLine.endsWith(':')) return { action: 'continue', prefix: '- ' }
  return { action: 'default' }
}

/**
 * Textarea onKeyDown handler implementing the typing shortcut: call this
 * directly as `onKeyDown={(e) => applyBulletAutoContinue(e, setMyText)}` on
 * any note-content textarea (used by both NotesPanel's capture box and its
 * full-screen note editor overlay).
 *
 * WHY THIS NEEDS TO PREVENT DEFAULT AND MANUALLY REBUILD THE VALUE
 *   A textarea's default Enter behavior just inserts a bare "\n". To insert
 *   "\n* " or "\n- " instead — or, for the 'reset' case, to erase a
 *   dangling bare marker on the current line before adding the new one —
 *   the default insertion must be prevented and the new value constructed
 *   by hand from the textarea's current value and cursor position.
 * WHY THE CURSOR POSITION IS RESTORED VIA requestAnimationFrame
 *   This is a controlled React textarea — calling the setValue callback
 *   doesn't immediately update `el.value`; React re-renders first. Setting
 *   selectionStart/selectionEnd synchronously here would still act on the
 *   OLD value's length. Deferring to the next animation frame guarantees
 *   the DOM has the new value by the time the cursor is repositioned. Same
 *   pattern already used for the capture box's date auto-fill.
 *
 * @param {React.KeyboardEvent} e - must be from a <textarea>.
 * @param {(newValue: string) => void} setValue - the controlling state setter.
 */
export function applyBulletAutoContinue(e, setValue) {
  if (e.key !== 'Enter') return

  const el = e.target
  const cursor = el.selectionStart
  const value = el.value
  const beforeCursor = value.slice(0, cursor)
  const afterCursor = value.slice(cursor)
  const lineStart = beforeCursor.lastIndexOf('\n') + 1
  const currentLine = beforeCursor.slice(lineStart)
  // lineStart === 0 means this is the FIRST line of the whole textarea's
  // content — i.e. the note's own title line, which always gets the "- "
  // continuation regardless of what it ends with (see decideBulletAction's
  // isFirstLine rule).
  const decision = decideBulletAction(currentLine.trim(), lineStart === 0)

  if (decision.action === 'default') return // let the browser insert a plain "\n"

  e.preventDefault()

  let newValue, newCursor
  if (decision.action === 'reset') {
    // Erase whatever's on the current line (blank already, or a dangling
    // bare "-"/"*" the user didn't fill in) and start the new topic fresh.
    newValue = value.slice(0, lineStart) + '\n' + decision.prefix + afterCursor
    newCursor = lineStart + 1 + decision.prefix.length
  } else {
    newValue = beforeCursor + '\n' + decision.prefix + afterCursor
    newCursor = beforeCursor.length + 1 + decision.prefix.length
  }

  setValue(newValue)
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = newCursor
  })
}
