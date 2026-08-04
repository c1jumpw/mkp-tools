/**
 * =============================================================================
 * FILE: src/lib/icsExport.js
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Builds a standard iCalendar (.ics) file from a list of scheduled events,
 *   and triggers a browser download of it — used by the "Export day" /
 *   "Export week" actions so the user can import their DayForge schedule
 *   into Google Calendar, Outlook, Apple Calendar, or any other app that
 *   accepts the widely-supported .ics format (RFC 5545).
 *
 * KEY RESPONSIBILITIES
 *   - buildICS(): pure function, takes plain event objects and returns a
 *     complete, spec-compliant .ics file as a string.
 *   - downloadICS(): browser-only side effect — wraps the string in a Blob
 *     and simulates a click on a hidden <a download> link, which is the
 *     standard way to trigger a file save from client-side JS without a
 *     backend endpoint.
 *
 * DESIGN DECISION: EXPORT AS CONCRETE EVENTS, NOT RECURRING RRULEs
 *   DayForge tracks recurrence itself (daily/weekly + per-date completion —
 *   see lib/recurrence.js and the task_completions table) and expands
 *   occurrences on the fly for whatever range is being viewed. Rather than
 *   trying to re-encode that into iCalendar's RRULE syntax (which has its
 *   own quirks per calendar app, and would need to somehow reconcile with
 *   DayForge's separate per-date completion tracking), export instead just
 *   emits ONE CONCRETE VEVENT per occurrence actually present in the
 *   exported day/week. This is simpler, always renders correctly regardless
 *   of the destination app's RRULE support, and matches the mental model of
 *   "export what I'm currently looking at" rather than "sync my recurrence
 *   rules forever" (DayForge isn't a two-way calendar sync tool).
 *
 * EDGE CASES / CONSTRAINTS
 *   - Times are emitted as FLOATING local time (no timezone/UTC suffix on
 *     DTSTART/DTEND) — the importing calendar app interprets them in
 *     whatever timezone the destination device is set to. This matches the
 *     common case of exporting your own schedule to your own calendar app.
 *     TODO: if cross-timezone sharing becomes a real use case (e.g.
 *     exporting for someone in another timezone), add a VTIMEZONE block or
 *     switch to UTC (`Z` suffix) instead — deliberately out of scope for now.
 *   - Text fields are escaped per RFC 5545 (backslash, semicolon, comma,
 *     newline) via escapeICSText() — skipping this would produce a file
 *     that fails to parse in strict importers if a task title contains any
 *     of those characters.
 * =============================================================================
 */

// RFC 5545 requires these characters to be backslash-escaped in TEXT values.
// Order matters: backslash must be escaped FIRST, or we'd double-escape the
// backslashes we just inserted for the other characters.
function escapeICSText(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

const pad2 = (n) => String(n).padStart(2, '0')

// Formats 'YYYY-MM-DD' + 'HH:MM' as iCalendar's floating local DATE-TIME
// format: YYYYMMDDTHHMMSS (no trailing Z — see FLOATING LOCAL TIME note above).
function formatDateTime(dateISO, timeHHMM) {
  const [y, m, d] = dateISO.split('-')
  const [hh, mm] = timeHHMM.split(':')
  return `${y}${m}${d}T${hh}${mm}00`
}

// Computes the END date-time by adding durationMinutes to the start,
// correctly rolling over into the next day/month/year via the Date object
// rather than doing manual minute arithmetic (which would need its own
// day/month/year rollover logic, easy to get subtly wrong).
function addMinutes(dateISO, timeHHMM, minutes) {
  const start = new Date(`${dateISO}T${timeHHMM}:00`)
  const end = new Date(start.getTime() + minutes * 60000)
  return `${end.getFullYear()}${pad2(end.getMonth() + 1)}${pad2(end.getDate())}T${pad2(end.getHours())}${pad2(end.getMinutes())}00`
}

// DTSTAMP must be in UTC per spec (the "Z" suffix), regardless of the
// floating-local-time choice for DTSTART/DTEND above — DTSTAMP records when
// the file was GENERATED, not when the event occurs.
function utcStampNow() {
  const d = new Date()
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
}

/**
 * @param {Array<object>} events - each: { uid, title, description, category,
 *   date: 'YYYY-MM-DD', startTime: 'HH:MM', durationMinutes: number }
 * @param {string} calendarName - shown as the calendar's display name by
 *   importers that support X-WR-CALNAME (most do; harmless if ignored).
 * @returns {string} complete .ics file content, CRLF-delimited per spec.
 */
export function buildICS(events, calendarName = 'DayForge') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DayForge//DayForge Export//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeICSText(calendarName)}`,
  ]

  for (const ev of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${ev.uid}`)
    lines.push(`DTSTAMP:${utcStampNow()}`)
    lines.push(`DTSTART:${formatDateTime(ev.date, ev.startTime)}`)
    lines.push(`DTEND:${addMinutes(ev.date, ev.startTime, ev.durationMinutes)}`)
    lines.push(`SUMMARY:${escapeICSText(ev.title)}`)
    if (ev.description) lines.push(`DESCRIPTION:${escapeICSText(ev.description)}`)
    if (ev.category) lines.push(`CATEGORIES:${escapeICSText(ev.category)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  // RFC 5545 mandates CRLF line endings, not bare \n — some strict importers
  // reject a file that doesn't have them.
  return lines.join('\r\n')
}

/**
 * Triggers a browser file-save of `content` as `filename`, using the
 * standard Blob + hidden-anchor-click technique (no backend endpoint
 * needed — this is a purely client-side download).
 * @param {string} filename - e.g. 'dayforge-2026-08-04.ics'
 * @param {string} content - file contents (already-built ICS text)
 */
export function downloadICS(filename, content) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Release the object URL now that the download has been triggered, so it
  // doesn't linger in memory for the rest of the session.
  URL.revokeObjectURL(url)
}
