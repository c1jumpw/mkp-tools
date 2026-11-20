/**
 * =============================================================================
 * FILE: src/hooks/useOnboarding.js
 * VERSION: v1 (2026-11-20)
 * =============================================================================
 * PURPOSE
 *   Decides, once per visit, what greets a person after they sign in:
 *     - First time on this ACCOUNT: the getting-started tour.
 *     - After an update: the What's new card, showing every release they
 *       haven't seen yet, filtered to their role (admins see admin-only
 *       items; regular users don't).
 *     - Otherwise: nothing.
 *   It also loads the change log once, for the admin Change log page.
 *
 * WHERE "SEEN" IS REMEMBERED
 *   On the ACCOUNT, in Supabase Auth user_metadata[SEEN_META_KEY] =
 *   { id, date, at } of the newest release seen. So someone who reads
 *   What's new on their phone doesn't see it again on their laptop.
 *   A copy of the id goes in localStorage (DEVICE_KEY) as a fallback for
 *   when the account can't be updated (offline).
 *
 * INPUTS
 *   role: null while useRole is still checking, then 'admin' | 'user'.
 *   Nothing is decided until the role is known, so a regular user never
 *   briefly sees admin-only items.
 *
 * EDGE CASES
 *   - DEVICE_KEY === 'capture' (set by the screenshot script) or storage
 *     blocked: never auto-open anything.
 *   - Change log missing (local dev before guides are built) or offline:
 *     nothing auto-opens; the menu items still work.
 *   - Updates whose items are all admin-only: a regular user is marked as
 *     having seen them silently, with no card.
 *   - Someone who closes the app without dismissing the card sees it again
 *     next time (nothing is marked until they dismiss it).
 * =============================================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { fetchChangelog, newestMarker, releasesForRole, unseenReleases } from '../lib/changelog'

export const SEEN_META_KEY = 'dayforge_seen_release' // user_metadata key
export const DEVICE_KEY = 'dayforge-tour-seen' // localStorage: release id seen on this device, or 'capture'

function readDevice() {
  try { return localStorage.getItem(DEVICE_KEY) } catch { return 'unavailable' }
}
function writeDevice(v) {
  try { localStorage.setItem(DEVICE_KEY, v) } catch { /* convenience only */ }
}

/**
 * @param {'admin'|'user'|null} role
 * @returns {{
 *   changelog: object|null, tourOpen: boolean, openTour: Function, closeTour: Function,
 *   whatsNew: object[]|null, closeWhatsNew: Function
 * }}
 */
export function useOnboarding(role) {
  const { user } = useAuth()
  const [changelog, setChangelog] = useState(null) // { releases, commits, ... } or { unavailable: true, ... }
  const [tourOpen, setTourOpen] = useState(false)
  const [whatsNew, setWhatsNew] = useState(null) // role-filtered unseen releases, newest first
  const decidedRef = useRef(false)
  const autoTourRef = useRef(false) // tour opened by us on first use -> mark everything seen when it closes

  useEffect(() => {
    let cancelled = false
    fetchChangelog()
      .then((c) => { if (!cancelled) setChangelog(c) })
      .catch(() => { if (!cancelled) setChangelog({ releases: [], commits: [], commitsComplete: false, unavailable: true }) })
    return () => { cancelled = true }
  }, [])

  /** Remembers the newest release as seen, on the account and this device. */
  const markSeen = useCallback(async () => {
    const marker = changelog && newestMarker(changelog.releases)
    if (!marker) return
    writeDevice(marker.id)
    const { error } = await supabase.auth.updateUser({ data: { [SEEN_META_KEY]: { ...marker, at: new Date().toISOString() } } })
    if (error) console.warn('DayForge: could not save What\'s new as seen on the account', error.message)
  }, [changelog])

  useEffect(() => {
    if (decidedRef.current || !role || !changelog || !user) return
    decidedRef.current = true
    const device = readDevice()
    if (device === 'capture' || device === 'unavailable') return
    if (changelog.unavailable || changelog.releases.length === 0) return

    const meta = user.user_metadata?.[SEEN_META_KEY]
    const seen = meta?.id ? meta : (device ? { id: device } : null)
    if (!seen) {
      // First time on this account: the tour, then nothing older pops up.
      autoTourRef.current = true
      setTourOpen(true)
      return
    }
    const visible = releasesForRole(unseenReleases(changelog.releases, seen), role)
    if (visible.length) setWhatsNew(visible)
    else if (!meta?.id || meta.id !== changelog.releases[0].id) markSeen() // nothing for this role, or move a device-only marker onto the account
  }, [role, changelog, user, markSeen])

  const openTour = useCallback(() => setTourOpen(true), [])
  const closeTour = useCallback(() => {
    setTourOpen(false)
    if (autoTourRef.current) {
      autoTourRef.current = false
      markSeen()
    }
  }, [markSeen])
  const closeWhatsNew = useCallback(() => {
    setWhatsNew(null)
    markSeen()
  }, [markSeen])

  return { changelog, tourOpen, openTour, closeTour, whatsNew, closeWhatsNew }
}
