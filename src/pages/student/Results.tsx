import { useEffect, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { useStudentContext } from '../../hooks/useStudentContext'
import type { AppUser, GradeScale } from '../../types'

interface Props { appUser: AppUser }

interface SemGroup {
  semesterLabel: string
  sessionLabel: string
  courses: {
    code: string; title: string; cu: number
    ca: number | null; exam: number | null; grade: string | null; gradePoint: number
  }[]
  gpa: number | null
  totalCU: number
}

export default function StudentResults({ appUser }: Props) {
  const ctx      = useStudentContext(appUser)
  const schoolId = appUser.activeSchool?.id ?? ''

  const [semGroups,   setSemGroups]   = useState<SemGroup[]>([])
  const [gradeScales, setGradeScales] = useState<GradeScale[]>([])
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    if (!schoolId) return
    supabase.from('grade_scales').select('*').eq('school_id', schoolId)
      .then(({ data }) => setGradeScales(data ?? []))
  }, [schoolId])

  useEffect(() => {
    if (!ctx.studentId || !schoolId) return
    supabase.from('course_registrations')
      .select('id, ca_score, exam_score, grade, offering:course_offerings(results_status, course:courses(code,title,credit_units), semester:semesters(id,label,session:academic_sessions(label)))')
      .eq('student_id', ctx.studentId!)
      .then(({ data }) => {
        const rows = (data ?? []) as any[]
        const map: Record<string, SemGroup> = {}
        for (const r of rows) {
          // Show only after senate/board ratification publishes the offering
          if (r.offering?.results_status !== 'published') continue
          const semKey  = r.offering?.semester?.label ?? 'Unknown'
          const sessKey = r.offering?.semester?.session?.label ?? ''
          const key = `${sessKey}||${semKey}`
          if (!map[key]) map[key] = { semesterLabel: semKey, sessionLabel: sessKey, courses: [], gpa: null, totalCU: 0 }
          const cu = r.offering?.course?.credit_units ?? 0
          // Use stored grade if available; otherwise compute from scores + grade scales
          const total = (r.ca_score ?? 0) + (r.exam_score ?? 0)
          const scale = r.grade
            ? gradeScales.find(s => s.grade === r.grade)
            : (r.ca_score !== null && r.exam_score !== null)
              ? gradeScales.find(s => total >= s.min_score && total <= s.max_score)
              : undefined
          map[key].courses.push({
            code: r.offering?.course?.code ?? '—',
            title: r.offering?.course?.title ?? '—',
            cu, ca: r.ca_score, exam: r.exam_score,
            grade: r.grade ?? scale?.grade ?? null,
            gradePoint: scale?.grade_point ?? 0,
          })
        }
        for (const g of Object.values(map)) {
          let pts = 0, cu = 0
          for (const c of g.courses) { pts += c.gradePoint * c.cu; cu += c.cu }
          g.gpa = cu > 0 ? pts / cu : null
          g.totalCU = cu
        }
        setSemGroups(Object.values(map))
        setLoading(false)
      })
  }, [ctx.studentId, gradeScales, schoolId])

  let allPts = 0, allCU = 0
  for (const g of semGroups) {
    for (const c of g.courses) { allPts += c.gradePoint * c.cu; allCU += c.cu }
  }
  const cgpa = allCU > 0 ? allPts / allCU : null

  function honoursClass(cgpa: number) {
    if (cgpa >= 4.5) return 'First Class Honours'
    if (cgpa >= 3.5) return 'Second Class Upper'
    if (cgpa >= 2.4) return 'Second Class Lower'
    if (cgpa >= 1.5) return 'Third Class'
    return 'Pass'
  }

  function printTranscript() {
    const rows = semGroups.flatMap(g =>
      g.courses.map(c =>
        `<tr><td>${c.code}</td><td>${c.title}</td><td>${c.cu}</td><td>${c.ca ?? '—'}</td><td>${c.exam ?? '—'}</td><td>${((c.ca ?? 0) + (c.exam ?? 0))}</td><td>${c.grade ?? '—'}</td><td>${c.gradePoint.toFixed(1)}</td></tr>`
      ).concat([`<tr style="background:#f9fafb"><td colspan="7" style="text-align:right;font-weight:bold">GPA</td><td>${g.gpa?.toFixed(2) ?? '—'}</td></tr>`])
    ).join('')
    const w = window.open('', '_blank')!
    w.document.write(`<!DOCTYPE html><html><head><title>Transcript — ${ctx.firstName} ${ctx.lastName}</title>
    <style>body{font-family:sans-serif;padding:32px;color:#1a1a2e}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px 12px;border:1px solid #e5e7eb;font-size:13px}th{background:#f9fafb;font-weight:600}h1{font-size:18px}h2{font-size:14px;color:#6b7280}</style></head>
    <body><h1>${appUser.activeSchool?.name ?? 'Regent OS'}</h1><h2>Academic Transcript</h2>
    <p><b>Name:</b> ${ctx.firstName} ${ctx.lastName} &nbsp;|&nbsp; <b>Reg No:</b> ${ctx.regNumber ?? '—'} &nbsp;|&nbsp; <b>Level:</b> ${ctx.level?.toUpperCase() ?? '—'}</p>
    <table><thead><tr><th>Code</th><th>Course</th><th>CU</th><th>CA</th><th>Exam</th><th>Total</th><th>Grade</th><th>GP</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p style="margin-top:24px"><b>CGPA:</b> ${cgpa?.toFixed(2) ?? '—'} — ${cgpa ? honoursClass(cgpa) : ''}</p>
    </body></html>`)
    w.document.close(); w.print()
  }

  if (loading || ctx.loading) {
    return <div className="p-8 text-sm text-gray-400">Loading results…</div>
  }

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xl font-bold text-navy-900">Results</div>
          <div className="text-sm text-gray-400 mt-0.5">Published semester results</div>
        </div>
        {semGroups.length > 0 && (
          <Button variant="secondary" size="sm" onClick={printTranscript}>Print Transcript</Button>
        )}
      </div>

      {cgpa !== null && (
        <Card className="p-5 bg-navy-900 text-white">
          <div className="text-xs text-navy-400 uppercase tracking-widest mb-1">Cumulative GPA</div>
          <div className="text-4xl font-bold">{cgpa.toFixed(2)}</div>
          <div className="text-sm text-navy-300 mt-1">{honoursClass(cgpa)}</div>
        </Card>
      )}

      {semGroups.length === 0 ? (
        <Card className="py-12 text-center">
          <div className="text-sm text-gray-400">No published results yet.</div>
          <div className="text-xs text-gray-300 mt-1">Results appear here once published by the exam office.</div>
        </Card>
      ) : (
        semGroups.map(g => (
          <Card key={`${g.sessionLabel}||${g.semesterLabel}`}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-navy-900">{g.semesterLabel}</div>
                <div className="text-xs text-gray-400">{g.sessionLabel}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">GPA</div>
                <div className="text-lg font-bold text-navy-900">{g.gpa?.toFixed(2) ?? '—'}</div>
              </div>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Code', 'Course', 'CU', 'Total', 'Grade'].map(h => (
                    <th key={h} className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-[10px] font-bold tracking-widest uppercase text-gray-500 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.courses.map(c => (
                  <tr key={c.code} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 text-xs font-mono font-bold text-navy-700">{c.code}</td>
                    <td className="px-4 py-3 text-sm text-navy-900">{c.title}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{c.cu}</td>
                    <td className="px-4 py-3 text-sm font-mono">{((c.ca ?? 0) + (c.exam ?? 0))}</td>
                    <td className="px-4 py-3">
                      {c.grade && (
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-sm text-sm font-bold ${c.grade === 'A' ? 'bg-green-100 text-green-700' : c.grade === 'F' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                          {c.grade}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))
      )}
    </div>
  )
}
