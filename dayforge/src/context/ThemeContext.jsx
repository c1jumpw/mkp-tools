/**
 * =============================================================================
 * FILE: src/context/ThemeContext.jsx
 * VERSION: v1 (new file)
 * =============================================================================
 * PURPOSE
 *   Provides a light/dark theme toggle for the whole app. The active theme is
 *   applied by setting `data-theme="light"` (or removing it for dark, the
 *   default) on the <html> element — index.css's `:root[data-theme='light']`
 *   block then overrides all the color CSS variables app-wide, so no
 *   component needs to know which theme is active.
 *
 * KEY RESPONSIBILITIES
 *   - Track the current theme ('dark' | 'light') in React state.
 *   - Persist the user's choice so it survives a page reload.
 *   - Fall back to the OS-level color-scheme preference (prefers-color-scheme)
 *     the very first time someone opens the app, before they've chosen
 *     anything explicitly.
 *
 * WHY localStorage HERE (and not Supabase, unlike task/routine data):
 *   The app's core rule is "no localStorage for DATA that needs to follow you
 *   across devices" (tasks, reminders, routines — all in Supabase). Theme
 *   preference is different: it's a per-device DISPLAY setting, similar to
 *   browser zoom level or OS dark-mode — most people are fine with their
 *   phone and laptop independently remembering their own preference, and
 *   round-tripping a UI-only preference through the database would add a
 *   network request to the theme toggle for no real benefit. If this
 *   assumption is wrong for your use case (you want ONE theme choice
 *   synced everywhere), it could be moved into a `user_preferences` table
 *   the same way tasks are stored — flagging this as a clear TODO rather
 *   than silently deciding for you:
 *   TODO: if cross-device theme sync is wanted, add a `user_preferences`
 *   table (user_id, theme) and swap the localStorage calls below for
 *   supabase reads/writes, mirroring useDayForgeData.js's pattern.
 *
 * EXTERNAL DEPENDENCIES
 *   - Read by index.css, which defines the actual color values per theme.
 *   - Must be mounted (ThemeProvider) above anything that calls useTheme().
 * =============================================================================
 */

import { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'dayforge-theme' // localStorage key; holds 'light' or 'dark'

const ThemeContext = createContext(null)

// Determines the theme to use on first-ever load, before any explicit choice
// has been saved: respects the OS/browser's prefers-color-scheme if the
// browser supports matchMedia (it does in all modern browsers), otherwise
// defaults to 'dark' (this app's primary designed-for theme).
function getInitialTheme() {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme)

  // Whenever `theme` changes, reflect it onto <html> (so index.css's
  // attribute-selector override applies) and persist the choice.
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      // Dark is the default/absence-of-attribute state — removing the
      // attribute rather than setting data-theme="dark" keeps index.css
      // simpler (only one override block needed, for light).
      document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
