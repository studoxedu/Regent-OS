import { useEffect, useState, useCallback } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal, ConfirmModal } from '../../components/ui/Modal'
import { Field, Select, Textarea } from '../../components/ui/Form'
import { flowExecute, supabase } from '../../lib/supabase'
import { computeGrade } from '../../lib/utils'
import type { AppUser, K12Class, K12Subject, LearnerEnrollment } from '../../types'

interface Props { appUser: AppUser }

type SubjectScores = Record<string, { ca: number; exam: number; total: number }>

interface ScoreRow {
  enrollmentId: string
  learnerId: string
  name: string
  ca: string
  exam: string
  existing: SubjectScores   // the learner's full term scores (other subjects preserved)
  caError?: string
  examError?: string
}

// ── Historical results import (migration) ────────────────────
interface ImportGroup {
  key: string
  learner_id: string
  session: string
  term: string
  subjects: { subject: string; ca: number; exam: number }[]
  status: 'pending' | 'ok' | 'error'
  message?: string
}

const RESULTS_TEMPLATE = 'learner_id,session,term,subject,ca,exam\n' +
  'STX-2024-00001,2023/2024,1,Mathematics,32,55\n' +
  'STX-2024-00001,2023/2024,1,English,28,50\n' +
  'STX-2024-00001,2023/2024,2,Mathematics,30,52'

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

export default function K12Results({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''

  const [classes, setClasses]   = useState<K12Class[]>([])
  const [subjects, setSubjects] = useState<K12Subject[]>([])
  const [enrollments, setEnrollments] = useState<LearnerEnrollment[]>([])
  const [rows, setRows]         = useState<ScoreRow[]>([])

  const [selectedClass, setSelectedClass]   = useState('')
  const [session, setSession]               = useState('2024/2025')
  const [term, setTerm]                     = useState('1')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [loaded, setLoaded]                 = useState(false)

  const [loading, setLoading]         = useState(false)
  const [saveOpen, setSaveOpen]       = useState(false)
  const [reopenOpen, setReopenOpen]   = useState(false)
  const [reopenNote, setReopenNote]   = useState('')
  const [toast, setToast]             = useState<string | null>(null)

  // Historical results import
  const [importOpen, setImportOpen]   = useState(false)
  const [csvText, setCsvText]         = useState('')
  const [groups, setGroups]           = useState<ImportGroup[]>([])
  const [importing, setImporting]     = useState(false)
  const [importDone, setImportDone]   = useState(false)

  useEffect(() => {
    if (!schoolId) return
    supabase.from('k12_classes').select('*').eq('school_id', schoolId).order('name')
      .then(({ data }) => setClasses((data ?? []) as K12Class[]))
    supabase.from('k12_subjects').select('*').eq('school_id', schoolId).order('name')
      .then(({ data }) => setSubjects((data ?? []) as K12Subject[]))
  }, [schoolId])

  const load = useCallback(async () => {
    if (!selectedClass || !selectedSubject) { setToast('Pick a class and subject first.'); setTimeout(() => setToast(null), 3000); return }
    setLoading(true)
    const { data: ens } = await supabase
      .from('learner_enrollments')
      .select('*, learner:learners(*)')
      .eq('school_id', schoolId).eq('class_id', selectedClass).eq('status', 'active')
      .order('created_at')
    const enList = (ens ?? []) as LearnerEnrollment[]
    setEnrollments(enList)

    const existing = await Promise.all(enList.map(e =>
      supabase.from('term_results').select('scores')
        .eq('enrollment_id', e.id).eq('school_id', schoolId)
        .eq('academic_session', session).eq('term', parseInt(term))
        .maybeSingle().then(r => (r.data?.scores ?? {}) as SubjectScores)
    ))

    setRows(enList.map((e, i) => {
      const scores = existing[i]
      const subj = scores[selectedSubject]
      return {
        enrollmentId: e.id,
        learnerId: e.learner?.learner_id ?? '',
        name: `${e.learner?.first_name ?? ''} ${e.learner?.last_name ?? ''}`.trim(),
        ca:   subj ? String(subj.ca) : '',
        exam: subj ? String(subj.exam) : '',
        existing: scores,
      }
    }))
    setLoaded(true)
    setLoading(false)
  }, [selectedClass, selectedSubject, session, term, schoolId])

  function validateRow(row: ScoreRow): ScoreRow {
    const caNum = parseFloat(row.ca), examNum = parseFloat(row.exam)
    return {
      ...row,
      caError:   row.ca   && (isNaN(caNum)   || caNum < 0   || caNum > 40) ? 'CA 0–40'   : undefined,
      examError: row.exam && (isNaN(examNum) || examNum < 0 || examNum > 60) ? 'Exam 0–60' : undefined,
    }
  }

  function updateRow(index: number, field: 'ca' | 'exam', value: string) {
    setRows(prev => { const next = [...prev]; next[index] = validateRow({ ...next[index], [field]: value }); return next })
  }

  const hasErrors = rows.some(r => r.caError || r.examError)
  const enteredCount = rows.filter(r => r.ca !== '' && r.exam !== '').length
  const subjectName = subjects.find(s => s.id === selectedSubject)?.name ?? selectedSubject

  async function saveSubject() {
    setLoading(true); setSaveOpen(false)
    try {
      for (const row of rows) {
        if (!row.ca || !row.exam || row.caError || row.examError) continue
        const ca = parseFloat(row.ca), exam = parseFloat(row.exam)
        // Merge this subject into the learner's existing term scores
        const merged: SubjectScores = { ...row.existing, [subjectName]: { ca, exam, total: ca + exam } }
        await flowExecute('results.finalize', schoolId, {
          enrollment_id: row.enrollmentId,
          academic_session: session,
          term: parseInt(term),
          scores: merged,
        })
      }
      showToast(`${subjectName} results saved for ${enteredCount} learner(s).`)
      load()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  async function reopen() {
    setLoading(true); setReopenOpen(false)
    try {
      if (enrollments[0]) {
        await flowExecute('results.reopen', schoolId, {
          enrollment_id: enrollments[0].id, academic_session: session, term: parseInt(term), correction_note: reopenNote,
        })
      }
      showToast('Results reopened for correction. Audit entry created.')
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLoading(false)
    }
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000) }

  // ── Historical import ──────────────────────────────────────
  function parseImport() {
    if (!csvText.trim()) return
    const rowsIn = parseCSV(csvText)
    const dataRows = rowsIn[0]?.[0]?.toLowerCase().includes('learner') ? rowsIn.slice(1) : rowsIn
    const map = new Map<string, ImportGroup>()
    for (const r of dataRows) {
      if (r.length < 6 || !r[0]) continue
      const [learner_id, sess, termRaw, subject, caRaw, examRaw] = r
      const t = termRaw.trim()
      const key = `${learner_id}|${sess}|${t}`
      if (!map.has(key)) map.set(key, { key, learner_id: learner_id.trim(), session: sess.trim(), term: t, subjects: [], status: 'pending' })
      map.get(key)!.subjects.push({ subject: subject.trim(), ca: parseFloat(caRaw) || 0, exam: parseFloat(examRaw) || 0 })
    }
    setGroups([...map.values()])
    setImportDone(false)
  }

  async function runImport() {
    if (!groups.length) return
    setImporting(true)
    const { data: allEns } = await supabase
      .from('learner_enrollments').select('id, learner:learners(learner_id)').eq('school_id', schoolId)
    const byCode = new Map<string, string>()
    for (const e of (allEns ?? []) as unknown as { id: string; learner: { learner_id: string } | null }[]) {
      if (e.learner?.learner_id) byCode.set(e.learner.learner_id, e.id)
    }
    const updated = [...groups]
    for (let i = 0; i < updated.length; i++) {
      const g = updated[i]
      const enrollmentId = byCode.get(g.learner_id)
      if (!enrollmentId) { updated[i] = { ...g, status: 'error', message: 'Learner not found — import learners first' }; setGroups([...updated]); continue }
      if (!['1', '2', '3'].includes(g.term)) { updated[i] = { ...g, status: 'error', message: 'Term must be 1, 2 or 3' }; setGroups([...updated]); continue }
      const scores: SubjectScores = {}
      for (const s of g.subjects) scores[s.subject] = { ca: s.ca, exam: s.exam, total: s.ca + s.exam }
      try {
        await flowExecute('results.finalize', schoolId, { enrollment_id: enrollmentId, academic_session: g.session, term: parseInt(g.term), scores })
        updated[i] = { ...g, status: 'ok' }
      } catch (err) {
        updated[i] = { ...g, status: 'error', message: err instanceof Error ? err.message : 'Failed' }
      }
      setGroups([...updated])
    }
    setImporting(false); setImportDone(true)
  }

  function downloadResultsTemplate() {
    const blob = new Blob([RESULTS_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'results_import_template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const TERM_OPTS = [{ value: '1', label: 'First Term' }, { value: '2', label: 'Second Term' }, { value: '3', label: 'Third Term' }]

  return (
    <>
      <Topbar
        title="Results Entry"
        meta={loaded ? `${subjectName} · ${session} · Term ${term}` : appUser.activeSchool?.name}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setImportOpen(true); setGroups([]); setCsvText(''); setImportDone(false) }}>
              Import History
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setReopenOpen(true)} disabled={!loaded}>
              Reopen for Correction
            </Button>
            <Button variant="amber" size="sm" onClick={() => setSaveOpen(true)} disabled={!loaded || hasErrors || enteredCount === 0 || loading}>
              Save &amp; Publish
            </Button>
          </div>
        }
      />

      <div className="p-8 space-y-6">
        {/* Selectors */}
        <div className="bg-white border border-gray-200 rounded-sm p-4 grid grid-cols-5 gap-4 items-end">
          <div>
            <label className="label mb-1.5 block">Class</label>
            <Select value={selectedClass} onChange={e => { setSelectedClass(e.target.value); setLoaded(false) }}
              options={[{ value: '', label: 'Select class…' }, ...classes.map(c => ({ value: c.id, label: c.name }))]} />
          </div>
          <div>
            <label className="label mb-1.5 block">Subject</label>
            <Select value={selectedSubject} onChange={e => { setSelectedSubject(e.target.value); setLoaded(false) }}
              options={[{ value: '', label: 'Select subject…' }, ...subjects.map(s => ({ value: s.id, label: s.name }))]} />
          </div>
          <div>
            <label className="label mb-1.5 block">Session</label>
            <input value={session} onChange={e => { setSession(e.target.value); setLoaded(false) }} placeholder="2024/2025"
              className="w-full border border-gray-200 rounded-sm px-3 py-2 text-sm text-navy-900 focus:outline-none focus:border-navy-500" />
          </div>
          <div>
            <label className="label mb-1.5 block">Term</label>
            <Select value={term} onChange={e => { setTerm(e.target.value); setLoaded(false) }} options={TERM_OPTS} />
          </div>
          <Button variant="primary" size="sm" onClick={load} disabled={!selectedClass || !selectedSubject || loading}>
            {loading ? 'Loading…' : 'Load Learners'}
          </Button>
        </div>

        {!loaded ? (
          <Card className="py-20 text-center text-sm text-gray-400">
            Choose a class, subject, session and term, then load learners to enter scores.
          </Card>
        ) : (
          <Card>
            <CardHeader title={`Score Entry — ${subjectName}`} meta="CA max: 40 · Exam max: 60 · Total: 100" />
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['#', 'Learner', 'Learner ID', 'CA (40)', 'Exam (60)', 'Total', 'Grade'].map(h => (
                    <th key={h} className={`px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500 ${['CA (40)', 'Exam (60)', 'Total', 'Grade'].includes(h) ? 'text-center' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const caNum = parseFloat(row.ca), examNum = parseFloat(row.exam)
                  const total = (!isNaN(caNum) && !isNaN(examNum) && !row.caError && !row.examError) ? caNum + examNum : null
                  const { grade } = total !== null ? computeGrade(total) : { grade: '' }
                  return (
                    <tr key={row.enrollmentId} className="border-b border-gray-50 hover:bg-gray-50/40">
                      <td className="px-4 py-2.5 text-xs text-gray-400 w-8">{i + 1}</td>
                      <td className="px-4 py-2.5 text-sm font-semibold text-navy-900">{row.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{row.learnerId}</td>
                      <td className="px-4 py-2.5 text-center">
                        <input type="number" value={row.ca} onChange={e => updateRow(i, 'ca', e.target.value)}
                          className={`w-16 px-2 py-1.5 border rounded-sm text-sm text-center outline-none font-mono ${row.caError ? 'border-red-500 bg-red-50' : 'border-gray-300 focus:border-navy-900'}`}
                          min={0} max={40} placeholder="—" />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <input type="number" value={row.exam} onChange={e => updateRow(i, 'exam', e.target.value)}
                          className={`w-16 px-2 py-1.5 border rounded-sm text-sm text-center outline-none font-mono ${row.examError ? 'border-red-500 bg-red-50' : 'border-gray-300 focus:border-navy-900'}`}
                          min={0} max={60} placeholder="—" />
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono font-bold text-sm">
                        {total !== null ? total : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {grade ? (
                          <Badge label={grade}
                            bg={grade === 'A' ? 'bg-green-100' : grade === 'F' ? 'bg-red-100' : 'bg-blue-100'}
                            text={grade === 'A' ? 'text-green-700' : grade === 'F' ? 'text-red-700' : 'text-blue-700'} />
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">No learners in this class.</td></tr>
                )}
              </tbody>
            </table>
            <div className="px-5 py-3.5 border-t border-gray-200 flex justify-between items-center">
              <span className="text-xs text-gray-400">
                {hasErrors ? 'Validation errors — fix before saving' : `${enteredCount} of ${rows.length} entered · other subjects are preserved`}
              </span>
              <Button variant="primary" size="sm" onClick={() => setSaveOpen(true)} disabled={hasErrors || enteredCount === 0}>
                Save &amp; Publish {subjectName} →
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* Save confirm */}
      <ConfirmModal
        open={saveOpen}
        title={`Save & Publish — ${subjectName}`}
        message={<>Publish <strong>{subjectName}</strong> scores for <strong>{enteredCount}</strong> learner(s) — Term {term}, {session}. Other subjects already recorded for these learners are kept.</>}
        warning="Results become immediately visible on report cards. Use Reopen for Correction to amend afterward."
        confirmLabel="Save & Publish"
        confirmVariant="amber"
        onConfirm={saveSubject}
        onClose={() => setSaveOpen(false)}
        loading={loading}
      />

      {/* Reopen modal */}
      <Modal open={reopenOpen} title="Reopen for Correction" onClose={() => setReopenOpen(false)}
        footer={<>
          <Button variant="ghost" onClick={() => setReopenOpen(false)}>Cancel</Button>
          <Button variant="danger" onClick={reopen} disabled={!reopenNote.trim() || loading}>← Reopen</Button>
        </>}>
        <div className="mb-4 text-sm text-gray-600">This is a logged action. The correction note is written to the audit log and cannot be edited.</div>
        <Field label="Correction Note" required>
          <Textarea value={reopenNote} onChange={e => setReopenNote(e.target.value)} placeholder="Describe the reason for reopening…" />
        </Field>
      </Modal>

      {/* Historical results import */}
      <Modal open={importOpen} title="Import Historical Results" onClose={() => setImportOpen(false)}
        footer={<>
          <Button variant="ghost" onClick={() => setImportOpen(false)}>Close</Button>
          {groups.length > 0 && !importDone && (
            <Button variant="primary" onClick={runImport} disabled={importing}>
              {importing ? 'Importing…' : `Import ${groups.length} term result(s)`}
            </Button>
          )}
        </>}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Bring in past-term results so learners' full history shows on their report cards. One row per subject:{' '}
            <code className="bg-gray-100 px-1 rounded">learner_id, session, term, subject, ca, exam</code>.
            Rows are grouped into a term result per learner. Learners must already exist (import them in Enrollment first).
          </p>
          <div className="flex gap-2">
            <button onClick={downloadResultsTemplate} className="text-[12px] font-semibold text-navy-700 border border-navy-200 px-3 py-1.5 rounded cursor-pointer hover:bg-navy-50">
              Download Template
            </button>
            <input type="file" accept=".csv,.txt"
              onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setCsvText(await f.text()); setGroups([]) }}
              className="text-xs text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-gray-200 file:text-xs file:font-semibold file:bg-white file:cursor-pointer cursor-pointer" />
          </div>
          <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setGroups([]) }} rows={5} placeholder={RESULTS_TEMPLATE}
            className="w-full font-mono text-xs border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-navy-300 resize-y" />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={parseImport} disabled={!csvText.trim()}>Preview</Button>
            {importDone && (
              <span className="text-xs self-center">
                <span className="text-green-700 font-semibold">{groups.filter(g => g.status === 'ok').length} imported</span>{' · '}
                <span className="text-red-600 font-semibold">{groups.filter(g => g.status === 'error').length} failed</span>
              </span>
            )}
          </div>
          {groups.length > 0 && (
            <div className="border border-gray-100 rounded max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50">
                  <tr>{['Learner', 'Session', 'Term', 'Subjects', 'Status'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {groups.map(g => (
                    <tr key={g.key} className={`border-t border-gray-50 ${g.status === 'error' ? 'bg-red-50/40' : g.status === 'ok' ? 'bg-green-50/30' : ''}`}>
                      <td className="px-3 py-1.5 font-mono text-gray-600">{g.learner_id}</td>
                      <td className="px-3 py-1.5 text-gray-600">{g.session}</td>
                      <td className="px-3 py-1.5 text-gray-600">{g.term}</td>
                      <td className="px-3 py-1.5 text-gray-600">{g.subjects.length}</td>
                      <td className="px-3 py-1.5">
                        {g.status === 'pending' && <span className="text-gray-400">—</span>}
                        {g.status === 'ok' && <span className="text-green-700 font-semibold">Done</span>}
                        {g.status === 'error' && <span className="text-red-600" title={g.message}>{g.message?.slice(0, 40)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-navy-900 text-white px-5 py-3 rounded-sm shadow-modal text-sm z-50">
          {toast}
        </div>
      )}
    </>
  )
}
