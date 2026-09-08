/**
 * =============================================================================
 * FILE: src/hooks/useAutosave.js
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Generic debounced autosave: watches a payload object for changes and
 *   calls a save function automatically after a pause in editing, similar
 *   to Google Docs' background "Saving…" / "Saved" behavior — no explicit
 *   Save button required for changes to persist.
 *
 * KEY RESPONSIBILITIES
 *   - Detect real changes by comparing a JSON snapshot of the payload
 *     against the last successfully-saved snapshot (so re-renders with an
 *     unchanged payload don't trigger redundant saves).
 *   - Debounce: wait `delay` ms after the LAST change before saving, so
 *     rapid typing doesn't fire a save per keystroke.
 *   - Track status ('idle' | 'pending' | 'saving' | 'saved' | 'error') for
 *     a UI indicator.
 *   - Expose flush() to force an immediate save (bypassing the debounce),
 *     used when a modal is about to close — see TaskModal.jsx's
 *     handleRequestClose — so a very recent edit within the debounce
 *     window isn't lost if the user closes before it would have fired.
 *
 * NOT USED FOR CREATING NEW ENTRIES
 *   Autosave only makes sense for something that already EXISTS in the
 *   database — there's no "in-progress draft" concept for a brand-new task
 *   here (see TaskModal's `enabled: !isNew`). Creating a new task remains
 *   an explicit action (the "Add task" button), matching how Google Docs
 *   also requires an explicit "New document" action before autosave
 *   applies to it.
 *
 * EDGE CASES
 *   - If `enabled` is false, the hook does nothing (no watching, no
 *     saving) — used to gate autosave off for new/not-yet-created entries.
 *   - A save that throws sets status to 'error' but does NOT retry
 *     automatically; the next actual edit (which changes the payload
 *     again) will trigger a fresh debounce/save attempt. Silently retrying
 *     a failed save on a timer risks masking a real, recurring problem
 *     (e.g. an expired session) behind an endless retry loop.
 * =============================================================================
 */

import { useEffect, useRef, useState } from 'react'

/**
 * @param {object} payload - the current field values to save. Pass a NEW
 *   object each render (e.g. from a function that reads current state) —
 *   this hook compares it by JSON content, not by reference.
 * @param {function} saveFn - (payload) -> Promise; performs the actual save.
 * @param {object} options
 * @param {number} [options.delay=1200] - debounce delay in ms.
 * @param {boolean} [options.enabled=true] - set false to disable entirely.
 * @returns {{status: string, flush: function}}
 */
export function useAutosave(payload, saveFn, { delay = 1200, enabled = true } = {}) {
  const [status, setStatus] = useState('idle')
  const timeoutRef = useRef(null)
  const payloadRef = useRef(payload)
  const savedSnapshotRef = useRef(JSON.stringify(payload)) // treat the initial payload as already "saved" (it came from the database)

  payloadRef.current = payload

  useEffect(() => {
    if (!enabled) return
    const currentSnapshot = JSON.stringify(payload)
    if (currentSnapshot === savedSnapshotRef.current) return // nothing actually changed

    setStatus('pending')
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(async () => {
      setStatus('saving')
      try {
        await saveFn(payloadRef.current)
        savedSnapshotRef.current = JSON.stringify(payloadRef.current)
        setStatus('saved')
      } catch {
        setStatus('error')
      }
    }, delay)

    return () => clearTimeout(timeoutRef.current)
    // Only re-run when the payload's CONTENT changes, not on every render —
    // JSON.stringify(payload) as a dependency achieves value-based (not
    // reference-based) comparison, appropriate since callers construct a
    // fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(payload), enabled])

  /**
   * Forces an immediate save if there are unsaved changes, bypassing the
   * debounce timer. Returns once the save (or no-op) completes.
   */
  async function flush() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const currentSnapshot = JSON.stringify(payloadRef.current)
    if (currentSnapshot === savedSnapshotRef.current) return
    setStatus('saving')
    try {
      await saveFn(payloadRef.current)
      savedSnapshotRef.current = currentSnapshot
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  return { status, flush }
}
