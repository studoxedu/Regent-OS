import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Form'
import { Alert } from '../../components/ui/Card'
import { supabase } from '../../lib/supabase'

interface Props { onSignIn: (guardianId: string, email: string) => void }

export default function ParentLogin({ onSignIn: _onSignIn }: Props) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [sent, setSent]         = useState(false)

  // Primary: email + password (reliable — no dependency on email delivery).
  async function handlePassword() {
    if (!email.trim() || !password) { setError('Enter your email and password.'); return }
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    })
    setLoading(false)
    // On success the auth listener in ParentPortal picks up the session.
    if (err) setError(err.message)
  }

  // Secondary: magic link (OTP email) — for parents who prefer no password.
  async function handleMagicLink() {
    if (!email.trim()) { setError('Enter your email first.'); return }
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase() })
    setLoading(false)
    if (err) { setError(err.message); return }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-[400px] bg-white border border-gray-200 rounded-sm p-8 text-center">
          <div className="text-base font-bold text-navy-900 mb-2">Check your email</div>
          <div className="text-sm text-gray-500 mb-4">
            We sent a sign-in link to <strong>{email}</strong>.<br />
            Click the link to access your child's school records.
          </div>
          <Button variant="ghost" size="sm" onClick={() => setSent(false)}>Back to sign in</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-[400px]">
        <div className="text-center mb-8">
          <div className="text-[22px] font-bold text-navy-900">Regent OS Parent Portal</div>
          <div className="text-sm text-gray-400 mt-1">Access your child's school records</div>
        </div>

        <div className="bg-white border border-gray-200 rounded-sm p-8">
          {error && <Alert type="danger" className="mb-4">{error}</Alert>}

          <div className="mb-4">
            <label className="label mb-1.5 block">Email Address</label>
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePassword()}
            />
          </div>

          <div className="mb-5">
            <label className="label mb-1.5 block">Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePassword()}
            />
          </div>

          <Button variant="primary" className="w-full justify-center" onClick={handlePassword} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>

          <div className="mt-5 text-center">
            <button
              onClick={handleMagicLink}
              disabled={loading}
              className="text-xs text-navy-600 hover:underline disabled:opacity-50"
            >
              Prefer no password? Email me a sign-in link instead
            </button>
          </div>

          <div className="mt-4 text-center text-xs text-gray-400">
            Contact the school if you need to be registered.
          </div>
        </div>

        <div className="text-center mt-6">
          <a href="/" className="text-xs text-navy-600 hover:underline">← Staff Login</a>
        </div>
      </div>
    </div>
  )
}
