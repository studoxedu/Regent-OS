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

// ── Migration: bulk learner import ────────────────────────────
interface BulkRow {
  idx: number
  first_name: string
  last_name: string
  date_of_birth: string
  stage: string
  class_name: string
  nin: string
  guardian_nin: string
  status: 'pending' | 'ok' | 'error'
  message?: string
}

const BULK_TEMPLATE = 'first_name,last_name,date_of_birth,stage,class,nin,guardian_nin\n' +
  'Adaeze,Okafor,2015-03-12,primary,Primary 3,,12345678901\n' +
  'Emeka,Balogun,2010-07-01,jss,JSS 1A,23456789012,'

function parseCSV(text: string): string[][] {
  return text.trim().split('\n').map(line => {
    const fields: string[] = []
    let cur = '', inQ = false
    for (const ch of line.replace(/\r/g, '')) {
      if (ch === '"') inQ = !inQ
      else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
      else cur += ch
    }
    fields.push(cur.trim())
    return fields
  })
}

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

  // Bulk import (migration)
  const [bulkOpen, setBulkOpen]     = useState(false)
  const [csvText, setCsvText]       = useState('')
  const [bulkRows, setBulkRows]     = useState<BulkRow[]>([])
  const [importing, setImporting]   = useState(false)
  const [importDone, setImportDone] = useState(false)
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })

  function parseBulk() {
    if (!csvText.trim()) return
    const rows = parseCSV(csvText)
    const dataRows = rows[0]?.[0]?.toLowerCase().includes('first') ? rows.slice(1) : rows
    setBulkRows(dataRows.filter(r => r.length >= 4 && r[0]).map((r, i) => ({
      idx: i,
      first_name: r[0] ?? '', last_name: r[1] ?? '',
      date_of_birth: r[2] ?? '', stage: (r[3] ?? '').toLowerCase().trim(),
      class_name: r[4] ?? '', nin: (r[5] ?? '').replace(/\D/g, ''), guardian_nin: (r[6] ?? '').replace(/\D/g, ''),
      status: 'pending',
    })))
    setImportDone(false)
  }

  // Import one row. Returns the row with its outcome; never throws so one
  // bad row can't abort the whole migration.
  async function importOne(row: BulkRow): Promise<BulkRow> {
    if (!row.first_name || !row.last_name || !K12_STAGES.includes(row.stage as Stage)) {
      return { ...row, status: 'error', message: 'Missing name or invalid stage' }
    }
    if (row.nin.length !== 11 && row.guardian_nin.length !== 11) {
      return { ...row, status: 'error', message: 'Need learner or guardian NIN (11 digits)' }
    }
    try {
      const result = await flowExecute('learner.enroll', schoolId, {
        first_name: row.first_name, last_name: row.last_name,
        date_of_birth: row.date_of_birth || null, stage: row.stage,
        guardian_consent_captured: true,
      })
      const code = result?.result?.learner_id as string | undefined
      if (code) {
        const { data: lrn } = await supabase.from('learners').select('id').eq('learner_id', code).single()
        if (lrn?.id) {
          await supabase.rpc('set_learner_nin', {
            p_learner_id: lrn.id, p_school_id: schoolId,
            p_nin: row.nin || null, p_guardian_nin: row.guardian_nin || null,
          })
          // Match class by name within the stage
          const cls = classes.find(c => c.stage === row.stage && c.name.toLowerCase() === row.class_name.toLowerCase())
          if (cls && result?.result?.enrollment_id) {
            await supabase.from('learner_enrollments').update({ class_id: cls.id }).eq('id', result.result.enrollment_id as string)
          }
        }
      }
      return { ...row, status: 'ok', message: undefined }
    } catch (err) {
      return { ...row, status: 'error', message: err instanceof Error ? err.message : 'Failed' }
    }
  }

  // Import the given row indices with a small concurrency pool — a 1,000-row
  // migration finishes in ~a minute instead of many. Rows are independent, so
  // a failure never aborts the run; failed rows can be retried on their own
  // (Retry button) without re-importing the ones that already succeeded.
  async function importRows(indices: number[]) {
    if (!indices.length) return
    setImporting(true)
    setImportProgress({ done: 0, total: indices.length })
    const rows = [...bulkRows]
    indices.forEach(i => { rows[i] = { ...rows[i], status: 'pending', message: undefined } })
    setBulkRows([...rows])

    const CONCURRENCY = 6
    let cursor = 0, done = 0
    async function worker() {
      while (cursor < indices.length) {
        const i = indices[cursor++]
        rows[i] = await importOne(rows[i])
        done++
        setImportProgress({ done, total: indices.length })
        setBulkRows([...rows])
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, indices.length) }, worker))

    setImporting(false)
    setImportDone(true)
    loadData()
  }

  function runBulkImport() { return importRows(bulkRows.map((_, i) => i)) }
  function retryFailed()   { return importRows(bulkRows.flatMap((r, i) => r.status === 'error' ? [i] : [])) }

  function downloadTemplate() {
    const blob = new Blob([BULK_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'learner_import_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

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
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setBulkOpen(true); setBulkRows([]); setCsvText(''); setImportDone(false) }}>
              Import / Migrate
            </Button>
            <Button variant="primary" size="sm" onClick={() => setEnrollOpen(true)}>
              + Enroll Learner
            </Button>
          </div>
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

      {/* Bulk import / migration modal */}
      <Modal
        open={bulkOpen}
        title="Import / Migrate Learners"
        onClose={() => setBulkOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>Close</Button>
            {importing && (
              <span className="text-xs text-gray-500 self-center mr-1">
                Importing… {importProgress.done} / {importProgress.total}
              </span>
            )}
            {bulkRows.length > 0 && !importDone && !importing && (
              <Button variant="primary" onClick={runBulkImport}>
                {`Import ${bulkRows.length} learners`}
              </Button>
            )}
            {importDone && !importing && bulkRows.some(r => r.status === 'error') && (
              <Button variant="primary" onClick={retryFailed}>
                {`Retry ${bulkRows.filter(r => r.status === 'error').length} failed`}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Migrating from another system? Export your students to CSV with columns{' '}
            <code className="bg-gray-100 px-1 rounded">first_name, last_name, date_of_birth, stage, class, nin, guardian_nin</code>.
            Each learner needs their own NIN or a guardian's NIN. Classes are matched by name within the stage.
          </p>
          <div className="flex gap-2">
            <button onClick={downloadTemplate}
              className="text-[12px] font-semibold text-navy-700 border border-navy-200 px-3 py-1.5 rounded cursor-pointer hover:bg-navy-50">
              Download Template
            </button>
            <input type="file" accept=".csv,.txt"
              onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setCsvText(await f.text()); setBulkRows([]) }}
              className="text-xs text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-gray-200 file:text-xs file:font-semibold file:bg-white file:cursor-pointer cursor-pointer" />
          </div>
          <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setBulkRows([]) }} rows={5}
            placeholder={BULK_TEMPLATE}
            className="w-full font-mono text-xs border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-navy-300 resize-y" />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={parseBulk} disabled={!csvText.trim()}>Preview</Button>
            {importDone && (
              <span className="text-xs self-center">
                <span className="text-green-700 font-semibold">{bulkRows.filter(r => r.status === 'ok').length} imported</span>
                {' · '}
                <span className="text-red-600 font-semibold">{bulkRows.filter(r => r.status === 'error').length} failed</span>
              </span>
            )}
          </div>

          {bulkRows.length > 0 && (
            <div className="border border-gray-100 rounded max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>{['#', 'Name', 'Stage', 'Class', 'NIN', 'Status'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {bulkRows.map(row => (
                    <tr key={row.idx} className={`border-t border-gray-50 ${row.status === 'error' ? 'bg-red-50/40' : row.status === 'ok' ? 'bg-green-50/30' : ''}`}>
                      <td className="px-3 py-1.5 text-gray-400">{row.idx + 1}</td>
                      <td className="px-3 py-1.5 font-semibold text-navy-900">{row.last_name}, {row.first_name}</td>
                      <td className="px-3 py-1.5 text-gray-600">{row.stage}</td>
                      <td className="px-3 py-1.5 text-gray-600">{row.class_name || '—'}</td>
                      <td className="px-3 py-1.5 font-mono text-gray-500">{row.nin || row.guardian_nin || '—'}</td>
                      <td className="px-3 py-1.5">
                        {row.status === 'pending' && <span className="text-gray-400">—</span>}
                        {row.status === 'ok' && <span className="text-green-700 font-semibold">Done</span>}
                        {row.status === 'error' && <span className="text-red-600" title={row.message}>{row.message?.slice(0, 40)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-navy-900 text-white px-5 py-3 rounded-sm shadow-modal text-sm z-50">
          {toast}
        </div>
      )}
    </>
  )
}
