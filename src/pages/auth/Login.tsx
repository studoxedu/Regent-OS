import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'

interface LoginProps {
  onSignIn: (email: string, password: string) => Promise<void>
}

type Mode = 'staff' | 'student'

export default function Login({ onSignIn }: LoginProps) {
  const [mode, setMode]           = useState<Mode>('staff')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [regNumber, setRegNumber] = useState('')
  const [stuPass, setStuPass]     = useState('')
  const [error, setError]         = useState<string | null>(null)
  const [loading, setLoading]     = useState(false)

  async function handleStaff(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) { setError('Email and password are required.'); return }
    setError(null); setLoading(true)
    try { await onSignIn(email, password) }
    catch (err) { setError(err instanceof Error ? err.message : 'Sign in failed.') }
    finally { setLoading(false) }
  }

  async function handleStudent(e: FormEvent) {
    e.preventDefault()
    if (!regNumber || !stuPass) { setError('Registration number and password are required.'); return }
    setError(null); setLoading(true)
    try {
      const { data: lookupEmail } = await supabase
        .rpc('student_email_for_reg', { p_reg_number: regNumber.trim() })
      if (!lookupEmail) { setError('Registration number not found.'); return }
      await onSignIn(lookupEmail as string, stuPass)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setLoading(false)
    }
  }

  function switchMode(m: Mode) { setMode(m); setError(null) }

  return (
    <div className="min-h-screen flex">

      {/* ── Left: Brand panel ── */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#0d1117] flex-col justify-between px-14 py-12">
        {/* Logo */}
        <div>
          <div className="text-[22px] font-black text-white tracking-tight leading-none">Regent OS</div>
          <div className="text-[10px] text-[#4a5568] uppercase tracking-[0.18em] mt-1">
            Institutional Infrastructure
          </div>
        </div>

        {/* Headline */}
        <div>
          <div className="text-[64px] font-black leading-[1.0] text-white mb-6">
            Authority.<br />
            Audit.<br />
            <span>Integrity</span><span className="text-amber-500">.</span>
          </div>
          <p className="text-[15px] text-[#6b7280] leading-relaxed max-w-sm">
            The governance infrastructure universities depend on to
            function — not just software they use.
          </p>
        </div>

        {/* Feature tags */}
        <div className="flex gap-10">
          {['Office-Based\nAuthority', 'Immutable Audit\nTrail', 'State Machine\nWorkflows'].map(t => (
            <div key={t} className="text-[10px] text-[#374151] uppercase tracking-[0.15em] font-semibold leading-relaxed whitespace-pre-line">
              {t}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: Form panel ── */}
      <div className="w-full lg:w-1/2 bg-[#f7f7f7] flex items-center justify-center px-8 py-12">
        <div className="w-full max-w-[400px]">

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-[32px] font-bold text-[#0d1117] leading-tight mb-1">Sign in</h1>
            <p className="text-[14px] text-gray-500">
              Enter your{' '}
              <span className="text-blue-600">
                {mode === 'staff' ? 'institutional' : 'student'}
              </span>{' '}
              credentials
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 mb-6 p-1 bg-gray-200 rounded-lg w-fit">
            {(['staff', 'student'] as Mode[]).map(m => (
              <button key={m} onClick={() => switchMode(m)}
                className={`px-4 py-1.5 text-[12px] font-semibold rounded-md capitalize transition-all cursor-pointer ${
                  mode === m
                    ? 'bg-white text-[#0d1117] shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}>
                {m}
              </button>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded text-[13px] text-red-600">
              {error}
            </div>
          )}

          {/* Staff form */}
          {mode === 'staff' ? (
            <form onSubmit={handleStaff} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#374151] uppercase tracking-[0.1em] mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@institution.edu.ng"
                  autoComplete="email"
                  className="w-full bg-white border border-gray-300 rounded px-3.5 py-2.5 text-[14px] text-[#0d1117] placeholder-gray-400 focus:outline-none focus:border-[#0d1117] transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#374151] uppercase tracking-[0.1em] mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full bg-white border border-gray-300 rounded px-3.5 py-2.5 text-[14px] text-[#0d1117] placeholder-gray-400 focus:outline-none focus:border-[#0d1117] transition-colors"
                />
              </div>
              <button type="submit" disabled={loading}
                className="w-full mt-2 py-3 bg-[#0d1117] text-white text-[12px] font-bold uppercase tracking-[0.12em] rounded hover:bg-[#1a2332] transition-colors disabled:opacity-50 cursor-pointer">
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleStudent} className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[#374151] uppercase tracking-[0.1em] mb-1.5">
                  Registration Number
                </label>
                <input
                  type="text"
                  value={regNumber}
                  onChange={e => setRegNumber(e.target.value)}
                  placeholder="e.g. RGT/2025/001"
                  autoComplete="username"
                  className="w-full bg-white border border-gray-300 rounded px-3.5 py-2.5 text-[14px] text-[#0d1117] placeholder-gray-400 focus:outline-none focus:border-[#0d1117] transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#374151] uppercase tracking-[0.1em] mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={stuPass}
                  onChange={e => setStuPass(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full bg-white border border-gray-300 rounded px-3.5 py-2.5 text-[14px] text-[#0d1117] placeholder-gray-400 focus:outline-none focus:border-[#0d1117] transition-colors"
                />
              </div>
              <button type="submit" disabled={loading}
                className="w-full mt-2 py-3 bg-[#0d1117] text-white text-[12px] font-bold uppercase tracking-[0.12em] rounded hover:bg-[#1a2332] transition-colors disabled:opacity-50 cursor-pointer">
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
              <p className="text-[12px] text-gray-400 text-center">
                Use the registration number and temporary password from your admission letter.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
