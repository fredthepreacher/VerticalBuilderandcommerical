'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/ops/supabase/client'

type Mode = 'password' | 'magic'

export default function LoginForm({ next }: { next?: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setStatus('busy')
    const supabase = createSupabaseBrowserClient()

    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) {
          // Deliberately vague: never reveal whether an address has an account.
          setError('That email and password combination was not accepted.')
          setStatus('idle')
          return
        }
        router.push(next || '/ops/dashboard')
        router.refresh()
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: `${window.location.origin}/ops/dashboard` },
        })
        if (error) {
          setError('That sign-in link could not be sent. Try a password instead, or contact an administrator.')
          setStatus('idle')
          return
        }
        setStatus('sent')
      }
    } catch {
      setError('Something went wrong reaching the sign-in service. Check your connection and try again.')
      setStatus('idle')
    }
  }

  if (status === 'sent') {
    return (
      <div className="ops-banner ok" role="status">
        <div>
          <strong>Check your email</strong>
          A sign-in link is on its way to {email}. It expires shortly, so use it soon.
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="ops-field">
        <label htmlFor="ops-email">Work email</label>
        <input
          id="ops-email"
          className="ops-input"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="office@verticalbc.com"
        />
      </div>

      {mode === 'password' && (
        <div className="ops-field">
          <label htmlFor="ops-password">Password</label>
          <input
            id="ops-password"
            className="ops-input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>
      )}

      {error && <p className="ops-error" role="alert">{error}</p>}

      <button
        type="submit"
        className="ops-btn ops-btn-primary"
        style={{ width: '100%', marginTop: 6 }}
        disabled={status === 'busy'}
      >
        {status === 'busy' ? 'Signing in…' : mode === 'password' ? 'Sign in' : 'Email me a sign-in link'}
      </button>

      <button
        type="button"
        className="ops-btn ops-btn-ghost ops-btn-sm"
        style={{ width: '100%', marginTop: 8 }}
        onClick={() => { setMode(m => (m === 'password' ? 'magic' : 'password')); setError(null) }}
      >
        {mode === 'password' ? 'Use an email sign-in link instead' : 'Use a password instead'}
      </button>
    </form>
  )
}
