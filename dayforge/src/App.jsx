/**
 * =============================================================================
 * FILE: src/App.jsx
 * VERSION: v2 (previously v1 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   App root: mounts the two global providers (auth session, theme) and
 *   gates rendering between the Login screen and the Dashboard based on
 *   whether a Supabase session exists.
 *
 * REVISION HISTORY
 *   v1 (initial build) — AuthProvider + session-based Login/Dashboard gate.
 *   v2 (this version) — wrapped everything in ThemeProvider so useTheme() is
 *       available anywhere in the tree, including on the Login screen (not
 *       just post-login), per the light/dark toggle feature request.
 * =============================================================================
 */

import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import Login from './components/Login'
import Dashboard from './components/Dashboard'

// Reads the auth session and renders Login or Dashboard accordingly.
// Split out from App() so it can call useAuth() (which needs to be INSIDE
// AuthProvider, not in the same component that renders the provider).
function Gate() {
  const { session } = useAuth()
  if (session === undefined) {
    // Initial state before Supabase has resolved getSession() — avoids a
    // flash of the Login screen for users who are actually already signed in.
    return (
      <div className="min-h-screen flex items-center justify-center text-[var(--color-muted)] text-sm">
        Loading…
      </div>
    )
  }
  return session ? <Dashboard /> : <Login />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  )
}
