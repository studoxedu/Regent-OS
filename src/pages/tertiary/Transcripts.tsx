import { useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import type { AppUser, LearnerEnrollment, GradeScale } from '../../types'

interface Props { appUser: AppUser }

interface TranscriptRow {
  id: string
  ca_score: number | null
  exam_score: number | null
  grade: string | null
  course: { code: string; title: string; credit_units: number }
  semester: { label: string; ordinal: number; session: { label: string } }
}

interface SemesterBlock {
  sessionLabel: string
  semesterLabel: string
  semesterOrdinal: number
  rows: TranscriptRow[]
  gpa: number | null
  totalCU: number
}

function gradePoint(grade: string | null, scales: GradeScale[]): number {
  if (!grade) return 0
  const match = scales.find(s => s.grade === grade)
  return match?.grade_point ?? 0
}

export default function TertiaryTranscripts({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<LearnerEnrollment[]>([])
  const [searched, setSearched]     = useState(false)
  const [selected, setSelected]     = useState<LearnerEnrollment | null>(null)
  const [transcript, setTranscript] = useState<SemesterBlock[]>([])
  const [gradeScales, setGradeScales] = useState<GradeScale[]>([])
  const [loadingTranscript, setLoadingTranscript] = useState(false)

  async function search() {
    if (!query.trim()) return
    setSearched(true)
    setSelected(null)
    setTranscript([])
    const { data } = await supabase
      .from('learner_enrollments')
      .select('*, learner:learners(*)')
      .eq('school_id', schoolId)
      .or(`learner_id.eq.${query.trim()},learner_id.ilike.%${query.trim()}%`)
      .limit(10)
    setResults((data ?? []) as LearnerEnrollment[])
  }

  async function viewTranscript(enrollment: LearnerEnrollment) {
    setSelected(enrollment)
    setLoadingTranscript(true)
    setTranscript([])

    const [{ data: scales }, { data: regs }] = await Promise.all([
      supabase.from('grade_scales').select('*').eq('school_id', schoolId).order('min_score', { ascending: false }),
      supabase.from('course_registrations')
        .select(`
          id, ca_score, exam_score, grade,
          course_offering:course_offerings(
            results_status,
            course:courses(code, title, credit_units),
            semester:semesters(label, ordinal, session:academic_sessions(label))
          )
        `)
        .eq('enrollment_id', enrollment.id)
        .order('created_at'),
    ])

    const gs = (scales ?? []) as GradeScale[]
    setGradeScales(gs)

    const published = ((regs ?? []) as any[]).filter(
      r => r.course_offering?.results_status === 'published'
    )

    // Group by semester (session label + semester ordinal)
    const blocks: Record<string, SemesterBlock> = {}
    for (const r of published) {
      const sem = r.course_offering?.semester
      const session = sem?.session
      if (!sem || !session) continue
      const key = `${session.label}__${sem.ordinal}`
      if (!blocks[key]) {
        blocks[key] = {
          sessionLabel:   session.label,
          semesterLabel:  sem.label,
          semesterOrdinal: sem.ordinal,
          rows: [],
          gpa: null,
          totalCU: 0,
        }
      }
      blocks[key].rows.push({
        id:         r.id,
        ca_score:   r.ca_score,
        exam_score: r.exam_score,
        grade:      r.grade,
        course:     r.course_offering.course,
        semester:   sem,
      })
    }

    // Compute GPA per semester
    const sorted = Object.values(blocks).sort((a, b) =>
      a.sessionLabel.localeCompare(b.sessionLabel) || a.semesterOrdinal - b.semesterOrdinal
    )
    for (const block of sorted) {
      let sumQP = 0, sumCU = 0
      for (const row of block.rows) {
        const cu = row.course.credit_units
        const gp = gradePoint(row.grade, gs)
        sumQP += gp * cu
        sumCU += cu
      }
      block.totalCU = sumCU
      block.gpa = sumCU > 0 ? parseFloat((sumQP / sumCU).toFixed(2)) : null
    }

    setTranscript(sorted)
    setLoadingTranscript(false)
  }

  function computeCGPA(): number | null {
    if (transcript.length === 0) return null
    let sumQP = 0, sumCU = 0
    for (const block of transcript) {
      for (const row of block.rows) {
        const cu = row.course.credit_units
        const gp = gradePoint(row.grade, gradeScales)
        sumQP += gp * cu
        sumCU += cu
      }
    }
    return sumCU > 0 ? parseFloat((sumQP / sumCU).toFixed(2)) : null
  }

  function printTranscript() {
    if (!selected) return
    const learner = selected.learner
    const cgpa = computeCGPA()

    const semHtml = transcript.map(block => {
      const rows = block.rows.map(r => {
        const total = (r.ca_score ?? 0) + (r.exam_score ?? 0)
        const gp = gradePoint(r.grade, gradeScales)
        return `<tr>
          <td>${r.course.code}</td>
          <td>${r.course.title}</td>
          <td style="text-align:center">${r.ca_score ?? '—'}</td>
          <td style="text-align:center">${r.exam_score ?? '—'}</td>
          <td style="text-align:center;font-weight:bold">${total}</td>
          <td style="text-align:center;font-weight:bold">${r.grade ?? '—'}</td>
          <td style="text-align:center">${r.course.credit_units}</td>
          <td style="text-align:center">${(gp * r.course.credit_units).toFixed(1)}</td>
        </tr>`
      }).join('')
      return `
        <h3 style="margin:16px 0 8px;font-size:13px">${block.sessionLabel} — ${block.semesterLabel}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px">
          <thead style="background:#1a2744;color:#fff">
            <tr><th>Code</th><th>Title</th><th>CA</th><th>Exam</th><th>Total</th><th>Grade</th><th>CU</th><th>QP</th></tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot style="background:#f5f5f5;font-weight:bold">
            <tr><td colspan="6" style="text-align:right;padding:4px 6px">Semester GPA:</td>
            <td style="text-align:center">${block.totalCU}</td>
            <td style="text-align:center">${block.gpa?.toFixed(2) ?? '—'}</td></tr>
          </tfoot>
        </table>`
    }).join('')

    const win = window.open('', '_blank', 'width=800,height=700')
    if (!win) return
    win.document.write(`
      <html><head><title>Transcript — ${learner?.first_name} ${learner?.last_name}</title>
      <style>
        body{font-family:serif;padding:32px;font-size:12px}
        table th,table td{padding:5px 8px;border:1px solid #ddd;text-align:left}
        table thead th{background:#1a2744;color:#fff;border-color:#1a2744}
        table tfoot td{background:#f5f5f5}
      </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:24px">
        <div>
          <div style="font-size:20px;font-weight:bold">${appUser.activeSchool?.name}</div>
          <div style="font-size:12px;color:#666;margin-top:4px">Official Academic Transcript</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:16px;font-size:12px">
        <div><b>Name:</b> ${learner?.first_name} ${learner?.last_name}</div>
        <div><b>Learner ID:</b> ${learner?.learner_id}</div>
        <div><b>Stage:</b> ${selected.stage?.toUpperCase()}</div>
        <div><b>Printed:</b> ${new Date().toLocaleDateString('en-NG', { day:'2-digit', month:'long', year:'numeric' })}</div>
      </div>
      <hr style="margin:16px 0">
      ${semHtml}
      <hr style="margin:16px 0">
      <div style="font-size:14px;font-weight:bold">CGPA: ${cgpa?.toFixed(2) ?? '—'} / ${Math.max(...gradeScales.map(s => s.grade_point), 5).toFixed(1)}</div>
      <script>window.onload=()=>{window.print();window.close()}</script>
      </body></html>
    `)
    win.document.close()
  }

  const cgpa = computeCGPA()

  return (
    <>
      <Topbar title="Transcripts" meta="Academic record generation" />

      <div className="p-8 space-y-6">
        {/* Search */}
        <Card>
          <CardHeader title="Search Student" meta="Enter name or Learner ID" />
          <div className="px-5 pb-5">
            <div className="flex gap-2 mt-2">
              <input
                className="flex-1 border border-gray-200 rounded-sm px-3 py-2 text-sm outline-none focus:border-navy-900"
                placeholder="Name or RGT-YYYY-NNNNN"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
              />
              <Button variant="primary" size="sm" onClick={search}>Search</Button>
            </div>
          </div>

          {searched && (
            <div className="border-t border-gray-100">
              {results.length === 0 ? (
                <div className="px-5 py-6 text-sm text-gray-400">No students found.</div>
              ) : results.map(en => (
                <div key={en.id} className={cn(
                  'px-5 py-3 flex items-center justify-between border-b border-gray-50 last:border-0 transition-colors',
                  selected?.id === en.id ? 'bg-navy-50' : 'hover:bg-gray-50'
                )}>
                  <div>
                    <div className="text-sm font-semibold text-navy-900">
                      {en.learner?.first_name} {en.learner?.last_name}
                    </div>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">{en.learner?.learner_id}</div>
                  </div>
                  <Button variant={selected?.id === en.id ? 'primary' : 'secondary'} size="sm"
                    onClick={() => viewTranscript(en)}>
                    {selected?.id === en.id ? 'Viewing' : 'View Transcript'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Transcript */}
        {selected && (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[18px] font-bold text-navy-900">
                  {selected.learner?.first_name} {selected.learner?.last_name}
                </div>
                <div className="text-xs text-gray-400 font-mono mt-0.5">{selected.learner?.learner_id} · {selected.stage?.toUpperCase()}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={printTranscript}>Print / PDF</Button>
            </div>

            {loadingTranscript ? (
              <Card className="py-10 text-center">
                <div className="text-sm text-gray-400">Loading transcript…</div>
              </Card>
            ) : transcript.length === 0 ? (
              <Card className="py-10 text-center">
                <div className="text-sm text-gray-400 mb-1">No published results found.</div>
                <div className="text-xs text-gray-300">Results must be published via the Results Pipeline before appearing here.</div>
              </Card>
            ) : (
              <>
                {transcript.map((block, idx) => (
                  <Card key={idx}>
                    <CardHeader
                      title={`${block.sessionLabel} — ${block.semesterLabel}`}
                      meta={`GPA: ${block.gpa?.toFixed(2) ?? '—'} · ${block.totalCU} credit units`}
                    />
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          {['Code', 'Course Title', 'CA', 'Exam', 'Total', 'Grade', 'CU', 'QP'].map(h => (
                            <th key={h} className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500 text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map(r => {
                          const total = (r.ca_score ?? 0) + (r.exam_score ?? 0)
                          const gp = gradePoint(r.grade, gradeScales)
                          return (
                            <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                              <td className="px-4 py-3 text-xs font-mono font-bold text-navy-700">{r.course.code}</td>
                              <td className="px-4 py-3 text-sm text-navy-900">{r.course.title}</td>
                              <td className="px-4 py-3 text-sm text-center">{r.ca_score ?? '—'}</td>
                              <td className="px-4 py-3 text-sm text-center">{r.exam_score ?? '—'}</td>
                              <td className="px-4 py-3 text-sm font-bold text-center font-mono">{total}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={cn(
                                  'inline-flex items-center justify-center w-7 h-7 rounded-sm text-sm font-bold',
                                  r.grade === 'A' ? 'bg-green-100 text-green-700' :
                                  r.grade === 'F' ? 'bg-red-100 text-red-700' :
                                  'bg-blue-100 text-blue-700'
                                )}>{r.grade ?? '?'}</span>
                              </td>
                              <td className="px-4 py-3 text-sm text-center">{r.course.credit_units}</td>
                              <td className="px-4 py-3 text-sm font-mono text-center">{(gp * r.course.credit_units).toFixed(1)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </Card>
                ))}

                {/* CGPA summary */}
                <Card className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Cumulative GPA</div>
                      <div className="text-[36px] font-bold text-navy-900 leading-none">{cgpa?.toFixed(2) ?? '—'}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        of {Math.max(...gradeScales.map(s => s.grade_point), 5).toFixed(1)} · {transcript.reduce((s, b) => s + b.totalCU, 0)} total credit units
                      </div>
                    </div>
                    <div className={cn(
                      'text-[48px] font-bold',
                      cgpa !== null && cgpa >= 4.5 ? 'text-green-600' :
                      cgpa !== null && cgpa >= 3.5 ? 'text-blue-600' :
                      cgpa !== null && cgpa >= 2.4 ? 'text-amber-600' :
                      'text-red-500'
                    )}>
                      {cgpa !== null
                        ? cgpa >= 4.5 ? '1st' : cgpa >= 3.5 ? '2nd-U' : cgpa >= 2.4 ? '2nd-L' : cgpa >= 1.5 ? '3rd' : 'Pass'
                        : '—'}
                    </div>
                  </div>
                </Card>
              </>
            )}
          </div>
        )}

        <div className="bg-navy-50 border border-navy-200 rounded-sm px-5 py-4 text-sm text-navy-700">
          <strong>Note:</strong> Transcripts include published results only. Courses in draft, submitted, or pending states are excluded.
        </div>
      </div>
    </>
  )
}
