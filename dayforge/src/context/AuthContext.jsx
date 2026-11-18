/**
 * =============================================================================
 * FILE: src/context/AuthContext.jsx
 * VERSION: v2
 * =============================================================================
 * PURPOSE
 *   Holds the Supabase session for the whole app and exposes useAuth():
 *   { session, user, signOut }.
 *
 * ASSUMPTIONS
 *   - session is undefined while loading, null when signed out.
 *   - Sign out affects this device only (see signOut below), matching the
 *     guide ("Sign out on this device only").
 *
 * REVISION HISTORY
 *   v1  initial  Session provider.
 *   v2  2026-11-18  signOut uses scope 'local' so other devices stay signed in.
 * =============================================================================
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    // scope 'local' ends only this device's session. Supabase's default
    // ('global') would also sign out every other phone/computer.
    signOut: () => supabase.auth.signOut({ scope: 'local' }),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
