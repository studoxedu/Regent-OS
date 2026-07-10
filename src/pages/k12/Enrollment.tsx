import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Field, Input, Select, Checkbox, Grid2 } from '../../components/ui/Form'
import { EnrollmentStatusBadge } from '../../components/ui/Badge'
import { flowExecute, supabase } from '../../lib/supabase'
import { notify } from '../../lib/notifications'
import { formatDate, STAGE_LABELS } from '../../lib/utils'
import type { AppUser, LearnerEnrollment, K12Class, Stage } from '../../types'

interface Props { appUser: AppUser }

const K12_STAGES: Stage[] = ['nursery', 'primary', 'jss', 'sss']

export default function K12Enrollment({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''
  const [enrollments, setEnrollments] = useState<LearnerEnrollment[]>([])
  const [classes, setClasses]         = useState<K12Class[]>([])
  const [loading, setLoading]         = useState(true)
  const [enrollOpen, setEnrollOpen]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [toast, setToast]             = useState<string | null>(null)

  // Inline class assignment
  const [assigningId, setAssigningId] = useState<string | null>(null)

  // Inline NIN editing (backfill for existing learners)
  const [ninEditId, setNinEditId] = useState<string | null>(null)
  const [ninDraft, setNinDraft]   = useState('')
  const [ninSaving, setNinSaving] = useState(false)

  const [form, setForm] = useState({
    first_name: '', last_name: '', date_of_birth: '',
    stage: '' as Stage | '',
    class_id: '',
    nin: '', guardian_nin: '',
    guardian_consent_captured: false,
  })

  // Enrollment needs the learner's NIN, or a guardian's NIN as fallback
  const ninProvided = form.nin.length === 11 || form.guardian_nin.length === 11

  function loadData() {
    Promise.all([
      supabase
        .from('learner_enrollments')
        .select('*, learner:learners(*), class:k12_classes(name)')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false }),
      supabase
        .from('k12_classes')
        .select('*')
        .eq('school_id', schoolId)
        .order('stage').order('name'),
    ]).then(([{ data: en }, { data: cls }]) => {
      setEnrollments((en ?? []) as LearnerEnrollment[])
      setClasses((cls ?? []) as K12Class[])
      setLoading(false)
    })
  }

  useEffect(() => { if (schoolId) loadData() }, [schoolId])

  async function handleEnroll() {
    if (!form.first_name || !form.last_name || !form.stage) return
    if (!ninProvided) {
      showToast('Provide the learner’s NIN, or a guardian’s NIN if the learner has none.')
      return
    }
    setSaving(true)
    try {
      const result = await flowExecute('learner.enroll', schoolId, {
        first_name: form.first_name,
        last_name: form.last_name,
        date_of_birth: form.date_of_birth || null,
        stage: form.stage,
        guardian_consent_captured: form.guardian_consent_captured,
      })

      // Assign class if selected — direct update (class assignment is metadata, not a governed action)
      if (form.class_id && result?.result?.enrollment_id) {
        await supabase
          .from('learner_enrollments')
          .update({ class_id: form.class_id })
          .eq('id', result.result.enrollment_id as string)
      }

      // Store the NIN via the governed RPC (learner.enroll returns the STX
      // code, so resolve the learner's DB id from it)
      if (result?.result?.learner_id) {
        const { data: lrn } = await supabase
          .from('learners').select('id').eq('learner_id', result.result.learner_id as string).single()
        if (lrn?.id) {
          const { error: ninErr } = await supabase.rpc('set_learner_nin', {
            p_learner_id: lrn.id, p_school_id: schoolId,
            p_nin: form.nin.trim() || null, p_guardian_nin: form.guardian_nin.trim() || null,
          })
          if (ninErr) showToast(`Enrolled, but NIN not saved: ${ninErr.message}`)
        }
      }

      setEnrollOpen(false)
      setForm({ first_name: '', last_name: '', date_of_birth: '', stage: '', class_id: '', nin: '', guardian_nin: '', guardian_consent_captured: false })
      loadData()
      showToast('Learner enrolled successfully.')
      notify(appUser.profile.id, schoolId, 'Learner enrolled', {
        body: `${form.first_name} ${form.last_name} enrolled in ${form.stage.toUpperCase()}`,
        type: 'success',
        link: '/k12/enrollment',
      })
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Unknown'}`)
    } finally {
      setSaving(false)
    }
  }

  async function saveNin(learnerId: string) {
    setNinSaving(true)
    const { error } = await supabase.rpc('set_learner_nin', {
      p_learner_id: learnerId, p_school_id: schoolId, p_nin: ninDraft.trim(),
    })
    setNinSaving(false)
    if (error) { showToast(`Error: ${error.message}`); return }
    setNinEditId(null); setNinDraft('')
    loadData()
    showToast('NIN updated.')
  }

  async function assignClass(enrollmentId: string, classId: string) {
    setAssigningId(enrollmentId)
    await supabase
      .from('learner_enrollments')
      .update({ class_id: classId || null })
      .eq('id', enrollmentId)
    setAssigningId(null)
    loadData()
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(null), 4000)
  }

  const availableStages = (appUser.activeSchool?.stages_offered ?? [])
    .filter(s => K12_STAGES.includes(s as Stage)) as Stage[]

  const classesForStage = (stage: Stage) => classes.filter(c => c.stage === stage)

  return (
    <>
      <Topbar
        title="Enrollment"
        meta={`${enrollments.length} learners`}
        actions={
          <Button variant="primary" size="sm" onClick={() => setEnrollOpen(true)}>
            + Enroll Learner
          </Button>
        }
      />

      <div className="p-8">
        <Card>
          <CardHeader title="All Learners" meta={`${enrollments.length} total`} />
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Learner', 'Learner ID', 'NIN', 'Stage', 'Class', 'Entry Date', 'Status', 'Consent'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</td></tr>
              ) : enrollments.map(en => (
                <tr key={en.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                  <td className="px-5 py-3 text-sm font-semibold text-navy-900">
                    {en.learner?.first_name} {en.learner?.last_name}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-400">{en.learner?.learner_id}</td>
                  <td className="px-5 py-3 text-xs">
                    {ninEditId === en.learner?.id ? (
                      <span className="flex items-center gap-1">
                        <input value={ninDraft} inputMode="numeric" maxLength={11} autoFocus
                          onChange={e => setNinDraft(e.target.value.replace(/\D/g, ''))}
                          onKeyDown={e => { if (e.key === 'Enter' && en.learner?.id) saveNin(en.learner.id) }}
                          className="w-28 border border-gray-200 rounded-sm px-2 py-1 font-mono text-xs focus:outline-none focus:border-navy-400" />
                        <button disabled={ninSaving} onClick={() => en.learner?.id && saveNin(en.learner.id)}
                          className="text-navy-700 hover:text-navy-900 font-semibold">✓</button>
                        <button onClick={() => { setNinEditId(null); setNinDraft('') }}
                          className="text-gray-400 hover:text-gray-600">✕</button>
                      </span>
                    ) : en.learner?.nin ? (
                      <button onClick={() => { setNinEditId(en.learner!.id); setNinDraft(en.learner!.nin ?? '') }}
                        className="font-mono text-gray-600 hover:text-navy-900" title="Edit learner NIN">
                        {en.learner.nin}
                      </button>
                    ) : en.learner?.guardian_nin ? (
                      <button onClick={() => { setNinEditId(en.learner!.id); setNinDraft('') }}
                        className="font-mono text-gray-500 hover:text-navy-900" title="Guardian NIN — click to add learner's own">
                        <span className="text-[9px] font-sans text-gray-400 mr-1">G</span>{en.learner.guardian_nin}
                      </button>
                    ) : (
                      <button onClick={() => { setNinEditId(en.learner!.id); setNinDraft('') }}
                        className="text-amber-600 hover:text-amber-700 font-semibold">+ Add NIN</button>
                    )}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">{STAGE_LABELS[en.stage] ?? en.stage}</td>
                  <td className="px-5 py-3">
                    {assigningId === en.id ? (
                      <span className="text-xs text-gray-400">Saving…</span>
                    ) : (
                      <select
                        value={(en as any).class_id ?? ''}
                        onChange={e => assignClass(en.id, e.target.value)}
                        className="text-xs border border-gray-200 rounded-sm px-2 py-1 text-navy-800 bg-white focus:outline-none focus:border-navy-400 max-w-[140px]"
                      >
                        <option value="">— unassigned —</option>
                        {classesForStage(en.stage).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-500">{formatDate(en.entry_date)}</td>
                  <td className="px-5 py-3"><EnrollmentStatusBadge status={en.status} /></td>
                  <td className="px-5 py-3 text-sm">
                    {en.guardian_consent_captured
                      ? <span className="text-green-600 font-semibold">Captured</span>
                      : <span className="text-red-500">Missing</span>}
                  </td>
                </tr>
              ))}
              {!loading && enrollments.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-sm text-gray-400 text-center">No learners enrolled yet.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Enroll modal */}
      <Modal
        open={enrollOpen}
        title="Enroll Learner"
        onClose={() => setEnrollOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEnrollOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleEnroll}
              disabled={saving || !form.first_name || !form.last_name || !form.stage || !ninProvided}
            >
              {saving ? 'Enrolling…' : '+ Enroll Learner'}
            </Button>
          </>
        }
      >
        <Grid2>
          <Field label="First Name" required>
            <Input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} placeholder="e.g. Adaeze" />
          </Field>
          <Field label="Last Name" required>
            <Input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} placeholder="e.g. Okafor" />
          </Field>
        </Grid2>
        <Field label="Date of Birth">
          <Input type="date" value={form.date_of_birth} onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))} />
        </Field>
        <Grid2>
          <Field label="Learner NIN" hint="11 digits — leave blank if the learner has none">
            <Input value={form.nin} inputMode="numeric" maxLength={11}
              onChange={e => setForm(f => ({ ...f, nin: e.target.value.replace(/\D/g, '') }))}
              placeholder="11 digits" />
          </Field>
          <Field label="Guardian NIN" hint="Required if the learner has no NIN">
            <Input value={form.guardian_nin} inputMode="numeric" maxLength={11}
              onChange={e => setForm(f => ({ ...f, guardian_nin: e.target.value.replace(/\D/g, '') }))}
              placeholder="11 digits" />
          </Field>
        </Grid2>
        {!ninProvided && (
          <p className="text-[11px] text-amber-600 -mt-2 mb-2">
            Enter the learner's NIN, or a guardian's NIN if the learner has none.
          </p>
        )}
        <Field label="Stage" required>
          <Select
            value={form.stage}
            onChange={e => setForm(f => ({ ...f, stage: e.target.value as Stage, class_id: '' }))}
            options={availableStages.map(s => ({ value: s, label: STAGE_LABELS[s] }))}
            placeholder="Select stage…"
          />
        </Field>
        {form.stage && classesForStage(form.stage as Stage).length > 0 && (
          <Field label="Assign to Class">
            <Select
              value={form.class_id}
              onChange={e => setForm(f => ({ ...f, class_id: e.target.value }))}
              options={classesForStage(form.stage as Stage).map(c => ({ value: c.id, label: c.name }))}
              placeholder="Select class (optional)…"
            />
          </Field>
        )}
        <Checkbox
          label={<><strong>Guardian consent captured and timestamped</strong> — required under NDPA 2023 for minors</>}
          checked={form.guardian_consent_captured}
          onChange={v => setForm(f => ({ ...f, guardian_consent_captured: v }))}
        />
      </Modal>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-navy-900 text-white px-5 py-3 rounded-sm shadow-modal text-sm z-50">
          {toast}
        </div>
      )}
    </>
  )
}
