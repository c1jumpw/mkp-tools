/**
 * =============================================================================
 * FILE: src/lib/notesParsing.js
 * VERSION: v2 (previously v1 — see REVISION HISTORY below)
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
 *
 * REVISION HISTORY
 *   v1 (initial build) — displayed/documented the em-dash "—)" as the
 *       primary separator, though the regex always accepted the literal
 *       "--)" too.
 *   v2 (this version) — corrected per user feedback: "--)" (literal two
 *       hyphens) is how they actually type it, not an em-dash. This was
 *       purely a documentation/UI-copy correction — the underlying regex
 *       already matched "--)" correctly before this change; only the
 *       displayed guidance text (here and in NotesPanel.jsx) was misleading.
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
