import { useCallback, useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select, Field, Grid2, Textarea } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { isK12Office } from '../../lib/roles'
import type { AppUser, CbtTest, CbtQuestion, CbtAttempt, K12Class } from '../../types'

interface Props { appUser: AppUser }

interface AttemptRow extends CbtAttempt {
  profile?: { first_name: string | null; last_name: string | null; email: string } | null
  student?: { reg_number: string } | null
}

const STATUS_STYLE: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  published: 'bg-green-100 text-green-700',
  closed:    'bg-red-100 text-red-600',
}

const BLANK_QUESTION = { prompt: '', options: ['', '', '', ''], correctIndex: 0, marks: '1' }

export default function CBT({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''
  const myId     = appUser.profile.id
  const isK12    = isK12Office(appUser.activeMembership?.office?.name ?? '')

  const [tests, setTests]       = useState<CbtTest[]>([])
  const [classes, setClasses]   = useState<K12Class[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<CbtTest | null>(null)
  const [toast, setToast]       = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Create-test form
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle]       = useState('')
  const [instructions, setInstructions] = useState('')
  const [duration, setDuration] = useState('30')
  const [offeringId, setOfferingId] = useState('')
  const [classId, setClassId]   = useState('')
  const [saving, setSaving]     = useState(false)

  // Question editor + attempts (for selected test)
  const [questions, setQuestions] = useState<CbtQuestion[]>([])
  const [attempts, setAttempts]   = useState<AttemptRow[]>([])
  const [qForm, setQForm]         = useState(BLANK_QUESTION)

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  const loadTests = useCallback(async () => {
    const { data } = await supabase
      .from('cbt_tests')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
    setTests((data ?? []) as CbtTest[])
    setLoading(false)
  }, [schoolId])

  useEffect(() => { if (schoolId) loadTests() }, [schoolId, loadTests])

  useEffect(() => {
    if (!isK12 || !schoolId) return
    supabase.from('k12_classes').select('*').eq('school_id', schoolId).order('name')
      .then(({ data }) => setClasses((data ?? []) as K12Class[]))
  }, [isK12, schoolId])

  const loadDetail = useCallback(async (test: CbtTest) => {
    const [{ data: qs }, { data: ats }] = await Promise.all([
      supabase.from('cbt_questions').select('*').eq('test_id', test.id).order('ordinal'),
      supabase.from('cbt_attempts')
        .select('*, profile:profiles(first_name, last_name, email), student:students(reg_number)')
        .eq('test_id', test.id)
        .order('started_at', { ascending: false }),
    ])
    setQuestions((qs ?? []) as CbtQuestion[])
    setAttempts((ats ?? []) as unknown as AttemptRow[])
  }, [])

  useEffect(() => { if (selected) loadDetail(selected) }, [selected, loadDetail])

  async function createTest() {
    if (!title.trim()) return
    setSaving(true)
    const { data, error } = await supabase.from('cbt_tests').insert({
      school_id:        schoolId,
      title:            title.trim(),
      instructions:     instructions.trim() || null,
      duration_minutes: Math.max(1, parseInt(duration) || 30),
      offering_id:      offeringId || null,
      class_id:         classId || null,
      created_by:       myId,
    }).select().single()
    setSaving(false)
    if (error) { flash(error.message, 'error'); return }
    setTitle(''); setInstructions(''); setDuration('30'); setOfferingId(''); setClassId(''); setShowForm(false)
    flash('Test created. Add questions, then publish.')
    await loadTests()
    setSelected(data as CbtTest)
  }

  async function addQuestion() {
    if (!selected) return
    const opts = qForm.options.map(o => o.trim()).filter(Boolean)
    if (!qForm.prompt.trim() || opts.length < 2) {
      flash('A question needs a prompt and at least 2 options.', 'error'); return
    }
    if (qForm.correctIndex >= opts.length) {
      flash('The correct answer must be one of the filled options.', 'error'); return
    }
    const { error } = await supabase.from('cbt_questions').insert({
      test_id:       selected.id,
      ordinal:       (questions[questions.length - 1]?.ordinal ?? 0) + 1,
      prompt:        qForm.prompt.trim(),
      options:       opts,
      correct_index: qForm.correctIndex,
      marks:         Math.max(0.5, parseFloat(qForm.marks) || 1),
    })
    if (error) { flash(error.message, 'error'); return }
    setQForm({ ...BLANK_QUESTION, options: ['', '', '', ''] })
    loadDetail(selected)
  }

  async function deleteQuestion(id: string) {
    if (!selected) return
    await supabase.from('cbt_questions').delete().eq('id', id)
    loadDetail(selected)
  }

  async function setStatus(test: CbtTest, status: CbtTest['status']) {
    if (status === 'published' && questions.length === 0) {
      flash('Add at least one question before publishing.', 'error'); return
    }
    const { error } = await supabase.from('cbt_tests').update({ status }).eq('id', test.id)
    if (error) { flash(error.message, 'error'); return }
    flash(status === 'published' ? 'Test published — students can now take it.' : `Test ${status}.`)
    await loadTests()
    setSelected({ ...test, status })
  }

  async function deleteTest(test: CbtTest) {
    const { error } = await supabase.from('cbt_tests').delete().eq('id', test.id)
    if (error) { flash(error.message, 'error'); return }
    setSelected(null)
    loadTests()
  }

  const isAuthor = selected ? selected.created_by === myId : false
  const submitted = attempts.filter(a => a.submitted_at)

  return (
    <>
      <Topbar
        title="CBT — Computer-Based Tests"
        meta={appUser.activeSchool?.name}
        actions={!selected ? (
          <Button variant="primary" size="sm" onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ New Test'}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>← All Tests</Button>
        )}
      />

      <div className="p-8 space-y-5 max-w-4xl">
        {toast && <Alert type={toast.type === 'error' ? 'danger' : 'success'}>{toast.msg}</Alert>}

        {/* ── Test list ── */}
        {!selected && (
          <>
            {showForm && (
              <Card className="p-5">
                <div className="text-sm font-bold text-navy-900 mb-4">New Test</div>
                <Field label="Title" required>
                  <Input autoFocus placeholder="e.g. CSC 201 — Mid-Semester Test" value={title}
                    onChange={e => setTitle(e.target.value)} />
                </Field>
                <Field label="Instructions">
                  <Textarea rows={3} placeholder="Shown to students before they begin…" value={instructions}
                    onChange={e => setInstructions(e.target.value)} />
                </Field>
                <Grid2>
                  <Field label="Duration (minutes)" required>
                    <Input type="number" min={1} value={duration} onChange={e => setDuration(e.target.value)} />
                  </Field>
                  {isK12 ? (
                    <Field label="Class" hint="Optional — leave blank for all classes">
                      <Select value={classId} onChange={e => setClassId(e.target.value)} placeholder="All classes"
                        options={classes.map(c => ({ value: c.id, label: c.name }))} />
                    </Field>
                  ) : (
                    <Field label="Course Offering" hint="Optional — leave blank for a general test">
                      <Select value={offeringId} onChange={e => setOfferingId(e.target.value)} placeholder="General"
                        options={(appUser.lecturerOfferings ?? []).map(o => ({
                          value: o.id, label: `${o.course?.code ?? '?'} — ${o.course?.title ?? ''}`,
                        }))} />
                    </Field>
                  )}
                </Grid2>
                <Button variant="primary" size="sm" onClick={createTest} disabled={saving || !title.trim()}>
                  {saving ? 'Creating…' : 'Create Test'}
                </Button>
              </Card>
            )}

            {loading ? (
              <Card className="py-16 text-center text-sm text-gray-400">Loading…</Card>
            ) : tests.length === 0 ? (
              <Card className="py-16 text-center">
                <div className="text-sm font-semibold text-gray-500 mb-1">No tests yet</div>
                <div className="text-xs text-gray-300">Create a test, add questions, then publish it for students.</div>
              </Card>
            ) : (
              <Card>
                <CardHeader title="Tests" meta={`${tests.length} total`} />
                {tests.map(t => (
                  <button key={t.id} onClick={() => setSelected(t)}
                    className="w-full text-left px-5 py-4 border-b border-gray-50 last:border-0 hover:bg-gray-50/60 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-navy-900 truncate">{t.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {t.duration_minutes} min · created {new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        {t.created_by === myId ? ' · yours' : ''}
                      </div>
                    </div>
                    <span className={cn('text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-sm flex-shrink-0', STATUS_STYLE[t.status])}>
                      {t.status}
                    </span>
                  </button>
                ))}
              </Card>
            )}
          </>
        )}

        {/* ── Test detail ── */}
        {selected && (
          <>
            <Card className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-navy-900">{selected.title}</span>
                    <span className={cn('text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-sm', STATUS_STYLE[selected.status])}>
                      {selected.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {selected.duration_minutes} minutes · {questions.length} question{questions.length === 1 ? '' : 's'}
                    · {submitted.length} submission{submitted.length === 1 ? '' : 's'}
                  </div>
                  {selected.instructions && (
                    <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{selected.instructions}</p>
                  )}
                </div>
                {isAuthor && (
                  <div className="flex gap-2 flex-shrink-0">
                    {selected.status === 'draft' && (
                      <Button variant="primary" size="sm" onClick={() => setStatus(selected, 'published')}>Publish</Button>
                    )}
                    {selected.status === 'published' && (
                      <Button variant="secondary" size="sm" onClick={() => setStatus(selected, 'closed')}>Close Test</Button>
                    )}
                    {selected.status !== 'published' && (
                      <Button variant="danger" size="sm" onClick={() => deleteTest(selected)}>Delete</Button>
                    )}
                  </div>
                )}
              </div>
            </Card>

            {/* Questions — visible to the author only (RLS hides them otherwise) */}
            {isAuthor && (
              <Card>
                <CardHeader title="Questions" meta={`${questions.length} added`} />
                {questions.map((q, i) => (
                  <div key={q.id} className="px-5 py-4 border-b border-gray-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm font-semibold text-navy-900">{i + 1}. {q.prompt}</div>
                      {selected.status === 'draft' && (
                        <button onClick={() => deleteQuestion(q.id)}
                          className="text-xs text-red-400 hover:text-red-600 font-semibold flex-shrink-0">Delete</button>
                      )}
                    </div>
                    <div className="mt-2 space-y-1">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className={cn('text-xs px-2 py-1 rounded-sm inline-block mr-2',
                          oi === q.correct_index ? 'bg-green-50 text-green-700 font-semibold' : 'text-gray-500')}>
                          {String.fromCharCode(65 + oi)}. {opt}
                        </div>
                      ))}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">{q.marks} mark{q.marks === 1 ? '' : 's'}</div>
                  </div>
                ))}

                {selected.status === 'draft' && (
                  <div className="px-5 py-4 bg-gray-50/50">
                    <div className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Add Question</div>
                    <Field label="Prompt" required>
                      <Textarea rows={2} placeholder="Type the question…" value={qForm.prompt}
                        onChange={e => setQForm(f => ({ ...f, prompt: e.target.value }))} />
                    </Field>
                    <Grid2>
                      {qForm.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2 mb-2">
                          <input type="radio" name="correct" checked={qForm.correctIndex === oi}
                            onChange={() => setQForm(f => ({ ...f, correctIndex: oi }))}
                            className="accent-green-600 flex-shrink-0" title="Mark as correct answer" />
                          <Input placeholder={`Option ${String.fromCharCode(65 + oi)}`} value={opt}
                            onChange={e => setQForm(f => ({
                              ...f, options: f.options.map((o, j) => j === oi ? e.target.value : o),
                            }))} />
                        </div>
                      ))}
                    </Grid2>
                    <div className="flex items-end gap-3">
                      <div className="w-28">
                        <Field label="Marks">
                          <Input type="number" min={0.5} step={0.5} value={qForm.marks}
                            onChange={e => setQForm(f => ({ ...f, marks: e.target.value }))} />
                        </Field>
                      </div>
                      <Button variant="secondary" size="sm" onClick={addQuestion} className="mb-4">+ Add Question</Button>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Attempts */}
            {isAuthor && submitted.length > 0 && (
              <Card>
                <CardHeader title="Submissions" meta={`${submitted.length} students`} />
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['Student', 'Submitted', 'Score'].map(h => (
                        <th key={h} className="px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {submitted.map(a => (
                      <tr key={a.id} className="border-b border-gray-50">
                        <td className="px-5 py-3 text-sm font-semibold text-navy-900">
                          {[a.profile?.first_name, a.profile?.last_name].filter(Boolean).join(' ') || a.profile?.email}
                          {a.student?.reg_number && <span className="text-xs font-mono text-gray-400 ml-2">{a.student.reg_number}</span>}
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500">
                          {a.submitted_at ? new Date(a.submitted_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td className="px-5 py-3 text-sm font-bold text-navy-900">
                          {a.score ?? 0} / {a.total ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </div>
    </>
  )
}
