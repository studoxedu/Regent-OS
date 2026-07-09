import { useCallback, useEffect, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { useStudentContext } from '../../hooks/useStudentContext'
import { cn } from '../../lib/utils'
import type { AppUser, CbtTest, CbtAttempt } from '../../types'

interface Props { appUser: AppUser }

interface FetchedQuestion {
  id: string
  ordinal: number
  prompt: string
  options: string[]
  marks: number
}

interface FetchedTest {
  id: string
  title: string
  instructions: string | null
  duration_minutes: number
  show_results: boolean
  questions: FetchedQuestion[]
}

type Phase = 'list' | 'taking' | 'done'

export default function StudentTests({ appUser }: Props) {
  const ctx  = useStudentContext(appUser)
  const myId = appUser.profile.id

  const [tests, setTests]       = useState<CbtTest[]>([])
  const [attempts, setAttempts] = useState<CbtAttempt[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const [phase, setPhase]           = useState<Phase>('list')
  const [active, setActive]         = useState<FetchedTest | null>(null)
  const [attemptId, setAttemptId]   = useState<string | null>(null)
  const [answers, setAnswers]       = useState<Record<string, number>>({})
  const [deadline, setDeadline]     = useState<number | null>(null)
  const [remaining, setRemaining]   = useState<number>(0)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]         = useState<{ score: number; total: number; show_results: boolean } | null>(null)

  const load = useCallback(async () => {
    if (!ctx.schoolId) return
    const [{ data: ts }, { data: ats }] = await Promise.all([
      supabase.from('cbt_tests').select('*')
        .eq('school_id', ctx.schoolId)
        .eq('status', 'published')
        .order('created_at', { ascending: false }),
      supabase.from('cbt_attempts').select('*').eq('profile_id', myId),
    ])
    setTests((ts ?? []) as CbtTest[])
    setAttempts((ats ?? []) as CbtAttempt[])
    setLoading(false)
  }, [ctx.schoolId, myId])

  useEffect(() => { load() }, [load])

  const submit = useCallback(async (auto = false) => {
    if (!attemptId || submitting) return
    setSubmitting(true)
    const { data, error: rpcErr } = await supabase.rpc('cbt_submit_attempt', {
      p_attempt_id: attemptId,
      p_answers: answers,
    })
    setSubmitting(false)
    if (rpcErr) { setError(rpcErr.message); return }
    setResult(data as { score: number; total: number; show_results: boolean })
    setPhase('done')
    setDeadline(null)
    if (auto) setError('Time was up — your answers were submitted automatically.')
    load()
  }, [attemptId, answers, submitting, load])

  // Countdown timer; auto-submits at zero
  useEffect(() => {
    if (deadline === null || phase !== 'taking') return
    const t = setInterval(() => {
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0) { clearInterval(t); submit(true) }
    }, 1000)
    return () => clearInterval(t)
  }, [deadline, phase, submit])

  async function beginTest(test: CbtTest) {
    setError(null)
    const { data: startData, error: startErr } = await supabase.rpc('cbt_start_attempt', { p_test_id: test.id })
    if (startErr) { setError(startErr.message); return }
    const start = startData as { attempt_id: string; started_at: string }

    const { data: fetched, error: fetchErr } = await supabase.rpc('cbt_fetch_test', { p_test_id: test.id })
    if (fetchErr) { setError(fetchErr.message); return }
    const t = fetched as FetchedTest

    setActive(t)
    setAttemptId(start.attempt_id)
    setAnswers({})
    setDeadline(new Date(start.started_at).getTime() + t.duration_minutes * 60000)
    // The countdown effect corrects this on its first tick (matters for resumed attempts)
    setRemaining(t.duration_minutes * 60)
    setPhase('taking')
  }

  function attemptFor(testId: string) {
    return attempts.find(a => a.test_id === testId)
  }

  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60

  if (ctx.loading || loading) return <div className="p-8 text-sm text-gray-400">Loading tests…</div>

  // ── Taking a test ──
  if (phase === 'taking' && active) {
    const answered = Object.keys(answers).length
    return (
      <div className="p-8 max-w-3xl space-y-5">
        <div className="flex items-center justify-between sticky top-0 bg-gray-50 py-3 z-10 border-b border-gray-200">
          <div>
            <div className="text-lg font-bold text-navy-900">{active.title}</div>
            <div className="text-xs text-gray-400">{answered} of {active.questions.length} answered</div>
          </div>
          <div className={cn(
            'text-xl font-bold font-mono px-4 py-2 rounded-sm',
            remaining < 120 ? 'bg-red-50 text-red-600' : 'bg-navy-100 text-navy-900'
          )}>
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          </div>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-sm px-4 py-3">{error}</div>}

        {active.instructions && (
          <Card className="p-4 text-sm text-gray-600 whitespace-pre-wrap">{active.instructions}</Card>
        )}

        {active.questions.map((q, i) => (
          <Card key={q.id} className="p-5">
            <div className="text-sm font-semibold text-navy-900 mb-3">
              {i + 1}. {q.prompt}
              <span className="text-[10px] text-gray-400 font-normal ml-2">({q.marks} mark{q.marks === 1 ? '' : 's'})</span>
            </div>
            <div className="space-y-2">
              {q.options.map((opt, oi) => (
                <button key={oi}
                  onClick={() => setAnswers(a => ({ ...a, [q.id]: oi }))}
                  className={cn(
                    'w-full text-left px-4 py-2.5 rounded-sm border text-sm transition-colors',
                    answers[q.id] === oi
                      ? 'border-navy-900 bg-navy-100/70 font-semibold text-navy-900'
                      : 'border-gray-200 text-gray-600 hover:border-navy-400'
                  )}>
                  <span className="font-bold mr-2">{String.fromCharCode(65 + oi)}.</span>{opt}
                </button>
              ))}
            </div>
          </Card>
        ))}

        <div className="flex justify-end pb-8">
          <Button variant="primary" size="lg" onClick={() => submit(false)} disabled={submitting}>
            {submitting ? 'Submitting…' : `Submit (${answered}/${active.questions.length} answered)`}
          </Button>
        </div>
      </div>
    )
  }

  // ── Result screen ──
  if (phase === 'done' && result) {
    const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0
    return (
      <div className="p-8 max-w-md mx-auto">
        <Card className="p-8 text-center space-y-4">
          <div className="text-sm font-bold uppercase tracking-widest text-gray-400">Test Submitted</div>
          {result.show_results ? (
            <>
              <div className={cn('text-5xl font-bold', pct >= 50 ? 'text-green-600' : 'text-red-500')}>
                {result.score}<span className="text-2xl text-gray-400"> / {result.total}</span>
              </div>
              <div className="text-sm text-gray-500">{pct}%</div>
            </>
          ) : (
            <div className="text-sm text-gray-500">Your answers were recorded. Results will be released by your lecturer.</div>
          )}
          {error && <div className="text-xs text-amber-600">{error}</div>}
          <Button variant="secondary" size="sm" onClick={() => { setPhase('list'); setResult(null); setError(null) }}>
            Back to Tests
          </Button>
        </Card>
      </div>
    )
  }

  // ── Test list ──
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div className="text-xl font-bold text-navy-900">Tests & Quizzes</div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-sm px-4 py-3">{error}</div>}

      {tests.length === 0 ? (
        <Card className="py-16 text-center">
          <div className="text-sm font-semibold text-gray-500 mb-1">No tests available</div>
          <div className="text-xs text-gray-300">Published tests from your lecturers will appear here.</div>
        </Card>
      ) : (
        <Card>
          {tests.map(t => {
            const attempt = attemptFor(t.id)
            const done = !!attempt?.submitted_at
            return (
              <div key={t.id} className="px-5 py-4 border-b border-gray-50 last:border-0 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-navy-900 truncate">{t.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{t.duration_minutes} minutes</div>
                </div>
                {done ? (
                  <div className="text-right flex-shrink-0">
                    <span className="text-[11px] font-bold px-2 py-1 rounded bg-green-100 text-green-700">Completed</span>
                    {t.show_results && attempt?.score != null && (
                      <div className="text-xs font-bold text-navy-900 mt-1">{attempt.score} / {attempt.total}</div>
                    )}
                  </div>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => beginTest(t)}>
                    {attempt ? 'Resume' : 'Start Test'}
                  </Button>
                )}
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
