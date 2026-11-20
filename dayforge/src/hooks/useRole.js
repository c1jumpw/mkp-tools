/**
 * =============================================================================
 * FILE: src/hooks/useRole.js
 * VERSION: v1 (2026-11-20)
 * =============================================================================
 * PURPOSE
 *   Tells the app whether the signed-in account is an ADMIN or a regular
 *   USER, and wraps the admin-management calls used by the Admins tab.
 *
 * HOW
 *   Calls the Supabase function is_admin() (migration 009_admin_roles.sql),
 *   which checks the app_admins table on the server. The answer only
 *   decides what the app SHOWS; the admin functions (list/add/remove)
 *   re-check admin on the server, so hiding a button is never the only lock.
 *
 * RETURNS  { role, setupNeeded, uncertain }
 *   role:        null while checking, then 'admin' or 'user'.
 *   setupNeeded: true when migration 009 hasn't been run yet (the function
 *                doesn't exist). Everyone is treated as a user until then.
 *   uncertain:   true when the check failed for another reason (offline).
 *                role is 'user' for this visit, but What's new waits for a
 *                visit where the role is known, so an admin never has their
 *                admin notes marked as seen without being shown them.
 *
 * EDGE CASES
 *   - Offline / network error: 'user' + uncertain for this visit (admin
 *     pages hidden), checked again next time the app loads.
 *   - Re-checks when the signed-in account changes.
 * =============================================================================
 */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

// PostgREST / Postgres codes for "function doesn't exist" (migration not run).
const MISSING_FUNCTION_CODES = new Set(['PGRST202', '42883'])

/** Whether the signed-in account is an admin. See file header. */
export function useRole() {
  const { user } = useAuth()
  const [state, setState] = useState({ role: null, setupNeeded: false, uncertain: false })

  useEffect(() => {
    let cancelled = false
    setState({ role: null, setupNeeded: false, uncertain: false })
    if (!user) return undefined
    supabase.rpc('is_admin').then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        const missing = MISSING_FUNCTION_CODES.has(error.code)
        setState({ role: 'user', setupNeeded: missing, uncertain: !missing })
        return
      }
      setState({ role: data === true ? 'admin' : 'user', setupNeeded: false, uncertain: false })
    })
    return () => { cancelled = true }
    // Keyed on the account id only: the user object is replaced on every
    // token refresh / metadata update, which must not re-check the role.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  return state
}

/** Throws a readable Error from a Supabase RPC error. */
function rpcError(error) {
  return new Error(error.message || 'Something went wrong. Try again.')
}

/** Admins, oldest first: [{ user_id, email, created_at }]. Admins only (server-checked). */
export async function listAdmins() {
  const { data, error } = await supabase.rpc('list_admins')
  if (error) throw rpcError(error)
  return data || []
}

/** Makes the account with this email an admin. It must already have signed up. */
export async function addAdmin(email) {
  const { error } = await supabase.rpc('add_admin', { p_email: email })
  if (error) throw rpcError(error)
}

/** Removes an admin. The server refuses to remove the last one. */
export async function removeAdmin(userId) {
  const { error } = await supabase.rpc('remove_admin', { p_user_id: userId })
  if (error) throw rpcError(error)
}
