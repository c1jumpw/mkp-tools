import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setInfo('Account created. If email confirmation is enabled on your Supabase project, check your inbox, then sign in.')
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rise-in">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <svg width="28" height="28" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="6" fill="var(--color-surface)" />
            <path d="M8 22 L16 8 L20 8 L14 18 L24 18 L14 26 Z" fill="var(--color-ember)" />
          </svg>
          <span className="[font-family:var(--font-display)] text-2xl tracking-wide uppercase">DayForge</span>
        </div>

        <form onSubmit={handleSubmit} className="plate rounded-lg p-6 space-y-4">
          <div>
            <label className="blueprint-tick uppercase block mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm focus:border-[var(--color-ember)] outline-none"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="blueprint-tick uppercase block mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[var(--color-ink)] border border-[var(--color-line)] rounded px-3 py-2 text-sm focus:border-[var(--color-ember)] outline-none"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-[var(--color-ember)]">{error}</p>}
          {info && <p className="text-sm text-[var(--color-good)]">{info}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-[var(--color-ember)] hover:brightness-110 transition rounded py-2 text-sm font-semibold text-[var(--color-ink)] disabled:opacity-60"
          >
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setInfo('') }}
          className="w-full text-center text-sm text-[var(--color-muted)] mt-4 hover:text-[var(--color-paper)] transition"
        >
          {mode === 'signin' ? "First time here? Create your account" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
