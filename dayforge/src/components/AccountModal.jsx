/**
 * =============================================================================
 * FILE: src/components/AccountModal.jsx
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Lets the signed-in user change their account email and/or password,
 *   reachable from a menu option in the Dashboard header (per user request:
 *   "the ability to edit the account password/email needs to be a menu option").
 *
 * KEY RESPONSIBILITIES
 *   - Read the current session's email from AuthContext for display.
 *   - Call Supabase Auth's updateUser() to change email and/or password.
 *   - Surface Supabase's own success/error messaging, since email changes
 *     typically require confirming the new address before it takes effect
 *     (Supabase sends that confirmation email itself — this component does
 *     not need to implement that flow, just report what Supabase says).
 *
 * PROPS
 *   onClose {function} Called with no args to dismiss the modal.
 *
 * EDGE CASES / CONSTRAINTS
 *   - Both fields are optional and independent: leaving the password field
 *     blank updates only the email, and vice versa. If BOTH are blank, the
 *     Save button is disabled rather than making a no-op API call.
 *   - Supabase enforces a minimum password length (6 chars) — mirrored here
 *     client-side via `minLength` so the error surfaces before a network
 *     round-trip, not instead of the server-side check.
 *   - This does not ask for the CURRENT password before allowing a change.
 *     That's consistent with Supabase's default updateUser() behavior for an
 *     already-authenticated session (the session itself is the proof of
 *     identity). If stronger re-authentication is wanted later (e.g.
 *     "confirm your current password to change it"), that would need a
 *     signInWithPassword() call using the OLD password immediately before
 *     updateUser() — left as a TODO since it's a meaningful UX/security
 *     trade-off, not a bug fix:
 *     TODO: consider requiring current-password re-entry before allowing an
 *     email/password change, if this app's threat model calls for it.
 * =============================================================================
 */

import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

export default function AccountModal({ onClose }) {
  const { user } = useAuth()
  const [email, setEmail] = useState('')       // blank = "don't change email"
  const [password, setPassword] = useState('') // blank = "don't change password"
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    // Build the update payload with only the fields the user actually filled
    // in — Supabase's updateUser() accepts a partial object.
    const updates = {}
    if (email.trim()) updates.email = email.trim()
    if (password) updates.password = password
    if (Object.keys(updates).length === 0) return // nothing to do (Save is disabled anyway, this is a safety net)

    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser(updates)
      if (error) throw error

      // Supabase's own confirmation-email flow (if enabled on the project)
      // means an email change may not be immediate — tell the user plainly
      // rather than implying it already happened.
      if (updates.email) {
        setSuccess('Check your new email address for a confirmation link to finish the change.')
      } else {
        setSuccess('Password updated.')
      }
      setEmail('')
      setPassword('')
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const canSave = (email.trim() || password) && !busy

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="plate rounded-lg w-full max-w-sm p-5 rise-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="[font-family:var(--font-display)] uppercase tracking-wide text-xl">Account</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-paper)]">✕</button>
        </div>

        <p className="text-xs text-[var(--color-muted)] mb-4">
          Signed in as <span className="text-[var(--color-paper)]">{user?.email}</span>
        </p>

        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="blueprint-tick uppercase block mb-1">New email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={user?.email}
              className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm focus:border-[var(--color-ember)] outline-none"
            />
          </div>
          <div>
            <label className="blueprint-tick uppercase block mb-1">New password (optional)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              placeholder="Leave blank to keep current password"
              className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm focus:border-[var(--color-ember)] outline-none"
            />
          </div>

          {error && <p className="text-sm text-[var(--color-ember)]">{error}</p>}
          {success && <p className="text-sm text-[var(--color-good)]">{success}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="text-sm text-[var(--color-muted)] hover:text-[var(--color-paper)] px-3 py-1.5">
              Close
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="bg-[var(--color-ember)] disabled:opacity-40 text-[var(--color-ink)] text-sm font-semibold rounded px-4 py-1.5 hover:brightness-110 transition"
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
