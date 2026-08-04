/**
 * =============================================================================
 * FILE: src/lib/supabaseClient.js
 * VERSION: v2 (previously v1 — see REVISION HISTORY below)
 * =============================================================================
 * PURPOSE
 *   Creates and exports a single shared Supabase client instance used by every
 *   part of the app (auth, tasks, routines) to talk to the DayForge database.
 *
 * KEY RESPONSIBILITIES
 *   - Hold the connection info (project URL + anon key) for this app's
 *     Supabase project.
 *   - Expose one `supabase` client object that every hook/component imports
 *     rather than each creating its own connection.
 *
 * EXTERNAL DEPENDENCIES
 *   - @supabase/supabase-js (npm package) — the official Supabase JS SDK.
 *   - A Supabase project with the schema in supabase/schema.sql already
 *     applied (tables + Row Level Security policies). Without RLS policies,
 *     the anon key below would let anyone read/write any row — the policies
 *     are what actually restrict access to "rows owned by the logged-in user".
 *
 * SECURITY NOTE (why it's safe to hardcode these two values):
 *   - `supabaseUrl` and `supabaseAnonKey` are NOT secrets. Supabase's anon key
 *     is explicitly designed to be shipped inside public, client-side code
 *     (it's visible to anyone who opens browser dev tools on the live site
 *     regardless of how it's supplied). Real protection comes from the
 *     Row Level Security (RLS) policies defined in supabase/schema.sql, which
 *     restrict every row to `auth.uid() = user_id`.
 *   - The DANGEROUS key is the separate "service_role" key (bypasses RLS
 *     entirely). That key is never used in this project and must never be
 *     placed in any frontend file like this one.
 *
 * REVISION HISTORY
 *   v1 (initial build) — read supabaseUrl/supabaseAnonKey from environment
 *       variables (.env file), requiring the user to configure them in every
 *       deploy target (local .env, Vercel dashboard, etc).
 *   v2 (this version) — per user request, hardcoded the actual project URL
 *       and anon key directly below to remove manual configuration steps and
 *       reduce chances of typos/missing env vars across environments. Falls
 *       back to environment variables first (if someone forks this repo and
 *       sets their own .env, that still works) so this remains portable.
 * =============================================================================
 */

import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Hardcoded fallback values for THIS specific DayForge deployment.
// If you fork this project for your own use, replace these two constants
// with your own Supabase project's URL and anon key (Supabase dashboard →
// Settings → API), or set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY as
// environment variables, which take priority over these fallbacks.
// ---------------------------------------------------------------------------
const HARDCODED_SUPABASE_URL = 'https://lmrbqkhefzbsnfxlszbs.supabase.co'
const HARDCODED_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtcmJxa2hlZnpic25meGxzemJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4NDQ3MjMsImV4cCI6MjEwMTQyMDcyM30.cj9JRvlWAQc8KMK6k85wg4icJLARoQg1GA_6rpA9OAw'

// Env vars (if set) win over the hardcoded fallback above — lets contributors
// or future deploys override without editing source.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || HARDCODED_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || HARDCODED_SUPABASE_ANON_KEY

// Defensive check: fail loudly and early rather than letting every later
// Supabase call fail with a cryptic network/auth error.
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, ' +
    'or edit the HARDCODED_SUPABASE_URL/HARDCODED_SUPABASE_ANON_KEY constants in this file.'
  )
}

// Single shared client instance — import { supabase } from this file anywhere
// data or auth access is needed. Do not call createClient() elsewhere.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
