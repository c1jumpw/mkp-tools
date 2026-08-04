import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './components/Login'
import Dashboard from './components/Dashboard'

function Gate() {
  const { session } = useAuth()
  if (session === undefined) {
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
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
