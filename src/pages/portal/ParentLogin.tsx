import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Form'
import { Alert } from '../../components/ui/Card'
import { supabase } from '../../lib/supabase'

interface Props { onSignIn: (guardianId: string, email: string) => void }

export default function ParentLogin({ onSignIn: _onSignIn }: Props) {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [sent, setSent]       = useState(false)

  // Parents use magic link (OTP email) — no password to remember
  async function handleSend() {
    if (!email.trim()) return
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.signInWithOtp({ email: email.trim() })
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
          <Button variant="ghost" size="sm" onClick={() => setSent(false)}>Use a different email</Button>
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

          <div className="mb-5">
            <label className="label mb-1.5 block">Email Address</label>
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
            />
          </div>

          <Button variant="primary" className="w-full justify-center" onClick={handleSend} disabled={loading}>
            {loading ? 'Sending…' : 'Send Sign-In Link'}
          </Button>

          <div className="mt-6 text-center text-xs text-gray-400">
            No password required. We'll email you a secure sign-in link.
            <br />
            <span className="mt-1 block">Contact the school if you need to be registered.</span>
          </div>
        </div>

        <div className="text-center mt-6">
          <a href="/" className="text-xs text-navy-600 hover:underline">← Staff Login</a>
        </div>
      </div>
    </div>
  )
}
