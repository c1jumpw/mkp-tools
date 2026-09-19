/**
 * =============================================================================
 * FILE: src/lib/linkify.jsx
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Detects URLs inside plain text and renders them as real, clickable
 *   <a> links (opening in a new tab) while leaving everything else as
 *   plain text — used wherever the app shows READ-ONLY note/reminder
 *   content (not inside editable textareas, which are inherently
 *   plain-text; links become clickable once you're viewing rather than
 *   actively editing).
 *
 * WHY THIS RETURNS AN ARRAY OF REACT NODES, NOT AN HTML STRING
 *   The tempting shortcut is building an HTML string and rendering it with
 *   dangerouslySetInnerHTML — but that requires manually escaping the
 *   non-URL text to avoid an XSS/broken-markup risk from whatever the user
 *   typed (a stray "<" or "&" in their own note). Building a plain array of
 *   strings and real <a> elements sidesteps that entirely: React escapes
 *   string children automatically, and the only actual HTML tags involved
 *   are the <a> elements this function constructs itself from a matched
 *   URL, never from arbitrary user text.
 *
 * URL DETECTION
 *   Matches "http://", "https://", and bare "www." prefixes so both pasted
 *   full URLs and casually-typed ones ("check www.example.com") work.
 *   Trailing punctuation immediately after a URL (a period ending a
 *   sentence, a closing parenthesis, a comma) is trimmed OFF the link
 *   itself and rendered as plain text afterward — without this, a note
 *   like "see https://example.com." would incorrectly include the
 *   sentence-ending period as part of the link target.
 *
 * EDGE CASES
 *   - Clicking a link inside a clickable container (e.g. a note card whose
 *     whole body opens the editor on tap) must not ALSO trigger that
 *     container's own click handler — callers should rely on this
 *     function's built-in onClick stopPropagation (see the <a> below)
 *     rather than needing to handle it themselves.
 *   - Empty/null/undefined input returns it unchanged (a common defensive
 *     pattern for a display helper called on possibly-empty fields).
 * =============================================================================
 */

import React from 'react'

// Matches a run of non-whitespace characters starting with http(s):// or
// www. — deliberately permissive on WHAT follows (trimmed after the fact,
// see below) since a stricter single regex for "a valid URL, excluding
// trailing punctuation" is much harder to get right than matching greedily
// and then trimming trailing punctuation off the match.
const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi

// Punctuation commonly found immediately after a URL in normal prose that
// is almost certainly NOT part of the URL itself (sentence-ending periods,
// closing brackets/quotes carried over from surrounding text, etc).
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

/**
 * @param {string} text
 * @returns {Array<string|JSX.Element>|string} an array suitable as React
 *   children (mixing plain strings and <a> elements), or the original
 *   value unchanged if it's empty/not a string.
 */
export function linkifyText(text) {
  if (!text || typeof text !== 'string') return text

  const nodes = []
  let lastIndex = 0
  let match
  let key = 0
  // Reset lastIndex explicitly: URL_PATTERN is a module-level regex with
  // the global flag, so its internal lastIndex persists across calls —
  // without resetting, a call on a shorter string after a longer one could
  // start scanning partway through and miss an early match.
  URL_PATTERN.lastIndex = 0

  while ((match = URL_PATTERN.exec(text)) !== null) {
    const rawMatch = match[0]
    const matchStart = match.index

    let url = rawMatch
    let trailing = ''
    const trailingMatch = url.match(TRAILING_PUNCTUATION)
    if (trailingMatch) {
      trailing = trailingMatch[0]
      url = url.slice(0, url.length - trailing.length)
    }
    if (!url) continue // the whole "match" was punctuation somehow — skip rather than render an empty link

    if (matchStart > lastIndex) {
      nodes.push(text.slice(lastIndex, matchStart))
    }

    const href = url.toLowerCase().startsWith('www.') ? `https://${url}` : url
    nodes.push(
      <a
        key={`link-${key++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        // Stops a click on the link from also triggering a parent
        // container's own onClick (e.g. a note card that opens its editor
        // when tapped anywhere on its body) — the link should just open,
        // not also open the editor underneath it.
        onClick={(e) => e.stopPropagation()}
        className="text-[var(--color-steel)] underline hover:brightness-110 break-all"
      >
        {url}
      </a>
    )
    if (trailing) nodes.push(trailing)
    lastIndex = matchStart + rawMatch.length
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}
