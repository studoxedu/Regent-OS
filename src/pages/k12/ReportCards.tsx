import { useEffect, useRef, useState, useCallback } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import type { AppUser, K12Class, LearnerEnrollment, TermResult } from '../../types'

interface Props { appUser: AppUser }

interface ReportData {
  enrollment: LearnerEnrollment
  result: TermResult | null
}

interface AttendanceSummary { present: number; absent: number; late: number; total: number }

const TERM_NAMES: Record<string, string> = { '1': 'First', '2': 'Second', '3': 'Third' }

function getGrade(total: number): string {
  if (total >= 75) return 'A'
  if (total >= 65) return 'B'
  if (total >= 55) return 'C'
  if (total >= 45) return 'D'
  if (total >= 40) return 'E'
  return 'F'
}
function getRemark(total: number): string {
  if (total >= 75) return 'Excellent'
  if (total >= 65) return 'Very Good'
  if (total >= 55) return 'Good'
  if (total >= 45) return 'Credit'
  if (total >= 40) return 'Pass'
  return 'Fail'
}
function resultAverage(r: TermResult | null): number | null {
  if (!r?.scores || Object.keys(r.scores).length === 0) return null
  const vals = Object.values(r.scores).map(s => s.total ?? (s.ca + s.exam))
  return vals.reduce((a, b) => a + b, 0) / vals.length
}
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

export default function ReportCards({ appUser }: Props) {
  const school   = appUser.activeSchool
  const schoolId = school?.id ?? ''

  const [classes, setClasses]       = useState<K12Class[]>([])
  const [selectedClass, setSelectedClass] = useState('')
  const [session, setSession]       = useState('')
  const [term, setTerm]             = useState<string>('1')
  const [reports, setReports]       = useState<ReportData[]>([])
  const [selected, setSelected]     = useState<ReportData | null>(null)
  const [history, setHistory]       = useState<TermResult[]>([])
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null)
  const [loading, setLoading]       = useState(false)
  const [toast, setToast]           = useState<string | null>(null)
  const printRef                    = useRef<HTMLDivElement>(null)

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000) }

  useEffect(() => {
    supabase.from('k12_classes').select('*').eq('school_id', schoolId).order('name')
      .then(({ data }) => setClasses((data ?? []) as K12Class[]))
  }, [schoolId])

  async function loadReports() {
    if (!selectedClass) return
    setLoading(true); setSelected(null)
    const { data: enrollments } = await supabase
      .from('learner_enrollments')
      .select('*, learner:learners(*)')
      .eq('school_id', schoolId)
      .eq('class_id', selectedClass)
      .eq('status', 'active')

    const enList = (enrollments ?? []) as LearnerEnrollment[]
    const results = await Promise.all(
      enList.map(en =>
        supabase.from('term_results')
          .select('*')
          .eq('enrollment_id', en.id)
          .eq('school_id', schoolId)
          .eq('academic_session', session || '2024/2025')
          .eq('term', parseInt(term))
          .maybeSingle()
          .then(({ data }) => ({ enrollment: en, result: data as TermResult | null }))
      )
    )
    setReports(results)
    setLoading(false)
    if (results.length === 0) flash('No learners found in this class.')
  }

  // When a learner is selected, pull their full history + attendance
  const loadDetail = useCallback(async (r: ReportData) => {
    const [{ data: hist }, { data: att }] = await Promise.all([
      supabase.from('term_results').select('*')
        .eq('enrollment_id', r.enrollment.id).eq('school_id', schoolId)
        .order('academic_session').order('term'),
      supabase.from('attendance_records').select('status')
        .eq('enrollment_id', r.enrollment.id).eq('school_id', schoolId),
    ])
    setHistory((hist ?? []) as TermResult[])
    const rows = (att ?? []) as { status: string }[]
    setAttendance({
      present: rows.filter(a => a.status === 'present').length,
      absent:  rows.filter(a => a.status === 'absent').length,
      late:    rows.filter(a => a.status === 'late').length,
      total:   rows.length,
    })
  }, [schoolId])

  useEffect(() => { if (selected) loadDetail(selected) }, [selected, loadDetail])

  function printCard() {
    if (!printRef.current) return
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<html><head><title>Report Card</title>
      <style>
        body{font-family:Arial,sans-serif;margin:24px;color:#111;font-size:12px}
        table{width:100%;border-collapse:collapse;margin-top:12px}
        th{background:#1e293b;color:#fff;padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase}
        td{padding:6px 10px;border-bottom:1px solid #eee}
        @media print{body{margin:0}}
      </style></head><body>${printRef.current.innerHTML}</body></html>`)
    win.document.close(); win.focus(); win.print()
  }

  // Derived values for the selected learner
  const ranked = reports
    .filter(r => resultAverage(r.result) !== null)
    .sort((a, b) => (resultAverage(b.result)! - resultAverage(a.result)!))
  const position = selected ? ranked.findIndex(r => r.enrollment.id === selected.enrollment.id) + 1 : 0
  const classSize = ranked.length

  const scores  = selected?.result?.scores ?? null
  const subjRows = scores ? Object.entries(scores) : []
  const totalMarks = subjRows.reduce((sum, [, s]) => sum + (s.total ?? (s.ca + s.exam)), 0)
  const average = subjRows.length ? totalMarks / subjRows.length : 0
  const className = classes.find(c => c.id === selectedClass)?.name ?? ''
  const learner = selected?.enrollment.learner
  const ninDisplay = learner?.nin ? `${learner.nin} (learner)` : learner?.guardian_nin ? `${learner.guardian_nin} (guardian)` : '—'

  const th: React.CSSProperties = { background: '#1e293b', color: '#fff', padding: '6px 10px', textAlign: 'left', fontSize: '10px', textTransform: 'uppercase' }
  const td: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #eee' }

  return (
    <>
      <Topbar title="Report Cards" meta={school?.name} />
      <div className="p-8 space-y-6">
        {toast && <Alert type="info">{toast}</Alert>}

        <div className="flex gap-4 items-end">
          <div className="w-48">
            <label className="label mb-1.5 block">Class</label>
            <Select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}
              options={[{value:'',label:'Select class…'}, ...classes.map(c => ({value:c.id,label:c.name}))]} />
          </div>
          <div className="w-36">
            <label className="label mb-1.5 block">Session</label>
            <input value={session} onChange={e => setSession(e.target.value)} placeholder="2024/2025"
              className="w-full border border-gray-200 rounded-sm px-3 py-2 text-sm text-navy-900 focus:outline-none focus:border-navy-500" />
          </div>
          <div className="w-40">
            <label className="label mb-1.5 block">Term</label>
            <Select value={term} onChange={e => setTerm(e.target.value)}
              options={[{value:'1',label:'First Term'},{value:'2',label:'Second Term'},{value:'3',label:'Third Term'}]} />
          </div>
          <Button variant="primary" size="sm" onClick={loadReports} disabled={!selectedClass || loading}>
            {loading ? 'Loading…' : 'Load Reports'}
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Learner list */}
          <div>
            <div className="label mb-3">Learners ({reports.length})</div>
            <Card>
              <div className="divide-y divide-gray-50 max-h-[70vh] overflow-y-auto">
                {reports.map(r => (
                  <button key={r.enrollment.id} onClick={() => setSelected(r)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${selected?.enrollment.id === r.enrollment.id ? 'bg-navy-50' : ''}`}>
                    <div className="text-sm font-semibold text-navy-900">
                      {r.enrollment.learner?.first_name} {r.enrollment.learner?.last_name}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-mono text-gray-400">{r.enrollment.learner?.learner_id}</span>
                      {r.result
                        ? <span className="text-[10px] font-bold text-green-600 uppercase">Has Result</span>
                        : <span className="text-[10px] text-gray-300 uppercase">No Result</span>}
                    </div>
                  </button>
                ))}
                {reports.length === 0 && (
                  <div className="px-4 py-8 text-sm text-gray-400 text-center">Load reports to see learners.</div>
                )}
              </div>
            </Card>
          </div>

          {/* Report card preview */}
          <div className="col-span-2">
            {selected ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="label">Report Card Preview</div>
                  <Button variant="secondary" size="sm" onClick={printCard}>Print / PDF</Button>
                </div>
                <Card className="p-6">
                  <div ref={printRef} style={{ color: '#111', fontSize: '12px' }}>

                    {/* School header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '2px solid #1e293b', paddingBottom: '12px' }}>
                      {school?.logo_url && (
                        <img src={school.logo_url} alt="logo" style={{ width: '64px', height: '64px', objectFit: 'contain' }} />
                      )}
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{school?.name}</div>
                        {school?.motto && <div style={{ fontSize: '11px', fontStyle: 'italic', color: '#555' }}>{school.motto}</div>}
                        <div style={{ fontSize: '10px', color: '#666', marginTop: '3px' }}>
                          {[school?.address, school?.city, school?.state].filter(Boolean).join(', ')}
                          {school?.phone ? ` · ${school.phone}` : ''}{school?.email ? ` · ${school.email}` : ''}
                        </div>
                        {school?.registration_no && <div style={{ fontSize: '9px', color: '#999' }}>Reg No: {school.registration_no}</div>}
                      </div>
                    </div>

                    <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 'bold', margin: '10px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Student Report Card — {TERM_NAMES[term]} Term, {session || '2024/2025'}
                    </div>

                    {/* Learner bio */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: '#f5f5f5', fontSize: '11px' }}>
                      <div>
                        <strong>Name:</strong> {learner?.first_name} {learner?.last_name}<br />
                        <strong>Learner ID:</strong> {learner?.learner_id}<br />
                        <strong>NIN:</strong> {ninDisplay}
                      </div>
                      <div>
                        <strong>Class:</strong> {className}<br />
                        <strong>Stage:</strong> {selected.enrollment.stage?.toUpperCase()}<br />
                        <strong>Date of Birth:</strong> {learner?.date_of_birth ?? '—'}
                      </div>
                    </div>

                    {subjRows.length > 0 ? (
                      <>
                        {/* Scores */}
                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px' }}>
                          <thead><tr>
                            {['Subject', 'CA (40)', 'Exam (60)', 'Total (100)', 'Grade', 'Remark'].map(h => <th key={h} style={th}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {subjRows.map(([subject, s]) => {
                              const total = s.total ?? (s.ca + s.exam)
                              return (
                                <tr key={subject}>
                                  <td style={td}>{subject}</td>
                                  <td style={td}>{s.ca}</td>
                                  <td style={td}>{s.exam}</td>
                                  <td style={{ ...td, fontWeight: 'bold' }}>{total}</td>
                                  <td style={{ ...td, fontWeight: 'bold', textAlign: 'center' }}>{getGrade(total)}</td>
                                  <td style={td}>{getRemark(total)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>

                        {/* Summary */}
                        <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                          {[
                            ['Subjects', String(subjRows.length)],
                            ['Total', String(totalMarks)],
                            ['Average', `${average.toFixed(1)}%`],
                            ['Overall Grade', getGrade(average)],
                            ['Position', classSize ? `${ordinal(position)} of ${classSize}` : '—'],
                          ].map(([label, val]) => (
                            <div key={label} style={{ flex: 1, border: '1px solid #e5e5e5', borderRadius: '4px', padding: '6px 8px', textAlign: 'center' }}>
                              <div style={{ fontSize: '9px', textTransform: 'uppercase', color: '#999' }}>{label}</div>
                              <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{val}</div>
                            </div>
                          ))}
                        </div>

                        {/* Attendance */}
                        {attendance && attendance.total > 0 && (
                          <div style={{ marginTop: '12px', fontSize: '11px', padding: '8px 10px', background: '#f5f5f5' }}>
                            <strong>Attendance (recorded):</strong> Present {attendance.present} · Absent {attendance.absent} · Late {attendance.late}
                            {' '}({Math.round((attendance.present / attendance.total) * 100)}% present of {attendance.total} days)
                          </div>
                        )}

                        {/* Academic history */}
                        {history.length > 0 && (
                          <div style={{ marginTop: '14px' }}>
                            <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Academic History</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead><tr>
                                {['Session', 'Term', 'Subjects', 'Average', 'Grade', 'Status'].map(h => <th key={h} style={th}>{h}</th>)}
                              </tr></thead>
                              <tbody>
                                {history.map(h => {
                                  const avg = resultAverage(h)
                                  const n = h.scores ? Object.keys(h.scores).length : 0
                                  return (
                                    <tr key={h.id}>
                                      <td style={td}>{h.academic_session}</td>
                                      <td style={td}>{TERM_NAMES[String(h.term)]} </td>
                                      <td style={td}>{n}</td>
                                      <td style={{ ...td, fontWeight: 'bold' }}>{avg != null ? `${avg.toFixed(1)}%` : '—'}</td>
                                      <td style={{ ...td, textAlign: 'center' }}>{avg != null ? getGrade(avg) : '—'}</td>
                                      <td style={td}>{h.status === 'published' ? 'Published' : 'Draft'}</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Signatures */}
                        <div style={{ marginTop: '28px', display: 'flex', justifyContent: 'space-between' }}>
                          <div style={{ borderTop: '1px solid #000', width: '150px', paddingTop: '4px', fontSize: '10px', color: '#555' }}>Class Teacher</div>
                          <div style={{ borderTop: '1px solid #000', width: '150px', paddingTop: '4px', fontSize: '10px', color: '#555' }}>
                            {school?.head_name || 'Head Teacher'}
                          </div>
                          <div style={{ borderTop: '1px solid #000', width: '150px', paddingTop: '4px', fontSize: '10px', color: '#555' }}>Date</div>
                        </div>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '32px', color: '#999', fontSize: '13px' }}>
                        No result data available for this learner this term.
                      </div>
                    )}
                  </div>
                </Card>
              </>
            ) : (
              <Card className="py-24 text-center">
                <div className="text-sm text-gray-400">Select a learner to preview their report card.</div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
