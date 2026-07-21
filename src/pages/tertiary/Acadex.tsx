import { useEffect, useState, useCallback } from 'react'
import { Card, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Form'
import { flowExecute, supabase } from '../../lib/supabase'
import type { AppUser } from '../../types'

interface Props { appUser: AppUser }

// ── Types ────────────────────────────────────────────────────────
interface Offering {
  id: string
  results_status: 'draft' | 'submitted' | 'dept_verified' | 'dept_approved' | 'faculty_verified' | 'published'
  course: { id: string; code: string; title: string; credit_units: number }
  semester: { id: string; label: string; session: { label: string } }
  lecturer_assignment?: {
    id: string
    profile: { first_name: string | null; last_name: string | null }
  } | null
  registrations?: Array<{
    id: string
    student_id: string | null
    student?: { first_name: string; last_name: string; reg_number: string }
  }>
  _registrations?: Registration[]
}

interface Registration {
  id: string
  student_id: string | null
  ca_score: number | null
  exam_score: number | null
  grade: string | null
  grade_point: number | null
  student?: { first_name: string; last_name: string; reg_number: string }
}

interface StudentResult {
  id: string
  first_name: string
  last_name: string
  reg_number: string
}

interface TranscriptEntry {
  id: string
  ca_score: number | null
  exam_score: number | null
  grade: string | null
  grade_point: number | null
  offering: {
    results_status: string
    course: { code: string; title: string; credit_units: number }
    semester: { label: string; ordinal: number; session: { label: string } }
  }
}

interface Session  { id: string; label: string }
interface Semester { id: string; label: string; session_id: string; ordinal: number }

type Tab = 'offerings' | 'transcripts' | 'audit'

const STATUS_STYLE: Record<string, string> = {
  draft:            'bg-gray-100 text-gray-600',
  submitted:        'bg-yellow-50 text-yellow-700',
  dept_verified:    'bg-blue-50 text-blue-700',
  dept_approved:    'bg-purple-50 text-purple-700',
  faculty_verified: 'bg-violet-50 text-violet-700',
  published:        'bg-green-50 text-green-700',
}


function lecturerName(o: Offering): string {
  const p = o.lecturer_assignment?.profile
  if (!p) return '—'
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || '—'
}

export default function Acadex({ appUser }: Props) {
  const schoolId     = appUser.activeSchool?.id ?? ''
  const userId       = appUser.profile.id
  const officeName   = appUser.activeMembership?.office?.name ?? ''
  const membershipId = appUser.activeMembership?.id ?? ''
  const isAdmin      = officeName === 'school_admin'
  const isLecturer   = officeName === 'lecturer'
  const isExamOfficer = ['exam_officer', 'dept_exam_officer', 'faculty_exam_officer'].includes(officeName)
  const isHOD        = officeName === 'hod'
  const isDean       = officeName === 'dean'

  const canSeeOfferings = isLecturer || isExamOfficer || isHOD || isDean

  const availableTabs: Tab[] = canSeeOfferings
    ? ['offerings', 'transcripts', 'audit']
    : ['transcripts', 'audit']

  const [tab, setTab] = useState<Tab>(canSeeOfferings ? 'offerings' : 'transcripts')

  // ── Shared session/semester state (used by offerings + audit) ──
  const [sessions,   setSessions]   = useState<Session[]>([])
  const [semesters,  setSemesters]  = useState<Semester[]>([])
  const [sessionId,  setSessionId]  = useState('')
  const [semesterId, setSemesterId] = useState('')

  // ── Offerings tab ──────────────────────────────────────────────
  const [offerings,  setOfferings]  = useState<Offering[]>([])
  const [loading,    setLoading]    = useState(false)
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null)
  const [expandedOffering, setExpandedOffering] = useState<string | null>(null)
  const [activeOffering,   setActiveOffering]   = useState<Offering | null>(null)
  const [scores,           setScores]           = useState<Record<string, { ca: string; exam: string }>>({})
  const [submitting,       setSubmitting]        = useState(false)
  const [hodDeptId,        setHodDeptId]         = useState<string | null | undefined>(isHOD ? undefined : null)
  const [deanFacultyId,    setDeanFacultyId]     = useState<string | null | undefined>(isDean ? undefined : null)
  const [ratifiedIds,      setRatifiedIds]       = useState<Set<string>>(new Set())

  // ── Transcripts tab ────────────────────────────────────────────
  const [studentSearch,   setStudentSearch]   = useState('')
  const [studentResults,  setStudentResults]  = useState<StudentResult[]>([])
  const [searchingStud,   setSearchingStud]   = useState(false)
  const [selectedStudent, setSelectedStudent] = useState<StudentResult | null>(null)
  const [transcript,      setTranscript]      = useState<TranscriptEntry[]>([])
  const [loadingTx,       setLoadingTx]       = useState(false)

  // ── Audit tab ──────────────────────────────────────────────────
  const [auditOfferings,  setAuditOfferings]  = useState<Offering[]>([])
  const [auditLoading,    setAuditLoading]    = useState(false)
  const [auditSessionId,  setAuditSessionId]  = useState('')
  const [auditSemId,      setAuditSemId]      = useState('')
  const [auditSemesters,  setAuditSemesters]  = useState<Semester[]>([])

  function flash(msg: string, ok = true) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 4000)
  }

  // Load sessions
  useEffect(() => {
    if (!schoolId) return
    supabase.from('academic_sessions').select('id, label').eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setSessions((data ?? []) as Session[]))
  }, [schoolId])

  // Load semesters for offerings tab
  useEffect(() => {
    if (!sessionId) { setSemesters([]); setSemesterId(''); return }
    supabase.from('semesters').select('id, label, session_id, ordinal')
      .eq('session_id', sessionId).order('ordinal')
      .then(({ data }) => {
        setSemesters((data ?? []) as Semester[])
        setSemesterId(data?.[0]?.id ?? '')
      })
  }, [sessionId])

  // Load semesters for audit tab
  useEffect(() => {
    if (!auditSessionId) { setAuditSemesters([]); setAuditSemId(''); return }
    supabase.from('semesters').select('id, label, session_id, ordinal')
      .eq('session_id', auditSessionId).order('ordinal')
      .then(({ data }) => {
        setAuditSemesters((data ?? []) as Semester[])
        setAuditSemId(data?.[0]?.id ?? '')
      })
  }, [auditSessionId])

  // Load offering IDs that have been ratified by a board (unlocks Dean's publish)
  useEffect(() => {
    if (!isDean) return
    supabase.from('board_submissions')
      .select('offering_id')
      .eq('status', 'ratified')
      .not('offering_id', 'is', null)
      .then(({ data }) => {
        setRatifiedIds(new Set((data ?? []).map((s: any) => s.offering_id as string)))
      })
  }, [isDean])

  // Load HOD's assigned department
  useEffect(() => {
    if (!isHOD || !userId) return
    async function loadHodScope() {
      const { data: assigns } = await supabase
        .from('office_assignments')
        .select('office_instance_id')
        .eq('profile_id', userId)
        .limit(1)
      const instanceId = assigns?.[0]?.office_instance_id
      if (!instanceId) { setHodDeptId(null); return }
      const { data: inst } = await supabase
        .from('office_instances')
        .select('department_id')
        .eq('id', instanceId)
        .single()
      setHodDeptId(inst?.department_id ?? null)
    }
    loadHodScope()
  }, [isHOD, userId])

  // Load Dean's assigned faculty
  useEffect(() => {
    if (!isDean || !userId) return
    async function loadDeanScope() {
      const { data: assigns } = await supabase
        .from('office_assignments')
        .select('office_instance_id')
        .eq('profile_id', userId)
        .limit(1)
      const instanceId = assigns?.[0]?.office_instance_id
      if (!instanceId) { setDeanFacultyId(null); return }
      const { data: inst } = await supabase
        .from('office_instances')
        .select('faculty_id')
        .eq('id', instanceId)
        .single()
      setDeanFacultyId(inst?.faculty_id ?? null)
    }
    loadDeanScope()
  }, [isDean, userId])

  // Load offerings for pipeline tab
  const loadOfferings = useCallback(async () => {
    if (!semesterId) { setOfferings([]); return }
    if (isHOD && hodDeptId === undefined) return // still loading scope
    if (isDean && deanFacultyId === undefined) return // still loading scope
    setLoading(true)

    let query = supabase
      .from('course_offerings')
      .select(`
        id, results_status,
        course:courses!course_id(id, code, title, credit_units, department_id, department:departments!department_id(faculty_id)),
        semester:semesters!semester_id(id, label, session:academic_sessions!session_id(label)),
        lecturer_assignment:office_assignments!lecturer_assignment_id(
          id, profile:profiles!profile_id(first_name, last_name)
        ),
        registrations:course_registrations(id, student_id, student:students!student_id(first_name, last_name, reg_number))
      `)
      .eq('semester_id', semesterId)
      .order('created_at')

    if (isLecturer) {
      query = query.eq('lecturer_membership_id', membershipId)
    } else if (isExamOfficer) {
      query = query.eq('results_status', 'submitted')
    } else if (isHOD) {
      query = query.eq('results_status', 'dept_verified')
    } else if (isDean) {
      query = query.eq('results_status', 'faculty_verified')
    }

    const { data } = await query
    let filtered = (data ?? []) as unknown as Offering[]

    if (isHOD && hodDeptId) {
      filtered = filtered.filter(o => (o.course as any)?.department_id === hodDeptId)
    } else if (isHOD && hodDeptId === null) {
      filtered = []
    }

    // Dean: filter to own faculty, then only ratified offerings
    if (isDean) {
      if (deanFacultyId) {
        filtered = filtered.filter(o => (o.course as any)?.department?.faculty_id === deanFacultyId)
      } else if (deanFacultyId === null) {
        filtered = []
      }
      filtered = filtered.filter(o => ratifiedIds.has(o.id))
    }

    setOfferings(filtered)
    setLoading(false)
  }, [semesterId, isLecturer, isExamOfficer, isHOD, isDean, membershipId, hodDeptId, deanFacultyId, ratifiedIds])

  useEffect(() => { loadOfferings() }, [loadOfferings])

  // Load offerings for audit tab
  const loadAuditOfferings = useCallback(async () => {
    if (!auditSemId) { setAuditOfferings([]); return }
    setAuditLoading(true)
    const { data } = await supabase
      .from('course_offerings')
      .select(`
        id, results_status,
        course:courses!course_id(id, code, title, credit_units),
        semester:semesters!semester_id(id, label, session:academic_sessions!session_id(label)),
        lecturer_assignment:office_assignments!lecturer_assignment_id(
          id, profile:profiles!profile_id(first_name, last_name)
        ),
        registrations:course_registrations(id, student_id)
      `)
      .eq('semester_id', auditSemId)
      .order('created_at')
    setAuditOfferings((data ?? []) as unknown as Offering[])
    setAuditLoading(false)
  }, [auditSemId])

  useEffect(() => { loadAuditOfferings() }, [loadAuditOfferings])

  // Load registrations for score entry
  useEffect(() => {
    if (!activeOffering) return
    supabase.from('course_registrations')
      .select(`id, student_id, ca_score, exam_score, grade, grade_point,
               student:students!student_id(first_name, last_name, reg_number)`)
      .eq('offering_id', activeOffering.id)
      .not('student_id', 'is', null)
      .then(({ data }) => {
        const regs = (data ?? []) as unknown as Registration[]
        setActiveOffering(prev => prev ? { ...prev, _registrations: regs } : null)
        const init: Record<string, { ca: string; exam: string }> = {}
        regs.forEach(r => {
          init[r.student_id!] = {
            ca:   r.ca_score   != null ? String(r.ca_score)   : '',
            exam: r.exam_score != null ? String(r.exam_score) : '',
          }
        })
        setScores(init)
      })
  }, [activeOffering?.id])

  // Search students
  useEffect(() => {
    const q = studentSearch.trim()
    if (q.length < 2) { setStudentResults([]); return }
    const t = setTimeout(async () => {
      setSearchingStud(true)
      const { data } = await supabase
        .from('students')
        .select('id, first_name, last_name, reg_number')
        .eq('school_id', schoolId)
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,reg_number.ilike.%${q}%`)
        .limit(10)
      setStudentResults((data ?? []) as StudentResult[])
      setSearchingStud(false)
    }, 300)
    return () => clearTimeout(t)
  }, [studentSearch, schoolId])

  async function loadTranscript(student: StudentResult) {
    setSelectedStudent(student)
    setStudentResults([])
    setStudentSearch('')
    setTranscript([])
    setLoadingTx(true)
    const { data } = await supabase
      .from('course_registrations')
      .select(`
        id, ca_score, exam_score, grade, grade_point,
        offering:course_offerings!offering_id(
          results_status,
          course:courses!course_id(code, title, credit_units),
          semester:semesters!semester_id(label, ordinal, session:academic_sessions!session_id(label))
        )
      `)
      .eq('student_id', student.id)
      .order('created_at')
    setTranscript((data ?? []) as unknown as TranscriptEntry[])
    setLoadingTx(false)
  }

  // Governed via the K-12 flow_execute(action, school_id, payload) overload —
  // the tertiary office-model overload throws for GSU (no office_instances).
  async function handlePipelineAction(offering: Offering, action: string) {
    try {
      await flowExecute(action, schoolId, { offering_id: offering.id })
      flash(`${action.split('.').slice(1).join(' ')} complete.`)
      loadOfferings()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Action failed', false)
    }
  }

  async function handleSubmitScores() {
    if (!activeOffering) return
    const regs = (activeOffering._registrations ?? []).filter(r => r.student_id)
    setSubmitting(true)
    try {
      // Persist scores while still draft (score-lock allows edits only then),
      // then submit for departmental verification.
      for (const r of regs) {
        const sc = scores[r.student_id!]
        await supabase.from('course_registrations')
          .update({ ca_score: sc?.ca ?? null, exam_score: sc?.exam ?? null })
          .eq('offering_id', activeOffering.id).eq('student_id', r.student_id!)
      }
      await flowExecute('results.submit', schoolId, { offering_id: activeOffering.id })
      flash('Scores submitted.')
      setActiveOffering(null)
      loadOfferings()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Submit failed', false)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Transcript helpers ─────────────────────────────────────────
  function groupBySession(entries: TranscriptEntry[]) {
    const semMap = new Map<string, { sessionLabel: string; semLabel: string; ordinal: number; entries: TranscriptEntry[] }>()
    for (const e of entries) {
      const o = e.offering as any
      const sessionLabel = o.semester?.session?.label ?? '—'
      const semLabel     = o.semester?.label ?? '—'
      const key          = `${sessionLabel}||${semLabel}`
      if (!semMap.has(key)) semMap.set(key, { sessionLabel, semLabel, ordinal: o.semester?.ordinal ?? 0, entries: [] })
      semMap.get(key)!.entries.push(e)
    }
    // Group by session
    const sessionGroups = new Map<string, typeof semMap extends Map<any, infer V> ? V[] : never>()
    for (const v of semMap.values()) {
      if (!sessionGroups.has(v.sessionLabel)) sessionGroups.set(v.sessionLabel, [])
      sessionGroups.get(v.sessionLabel)!.push(v as any)
    }
    return Array.from(sessionGroups.entries()).map(([session, sems]) => ({
      session,
      sems: (sems as any[]).sort((a, b) => a.ordinal - b.ordinal),
    }))
  }

  function gpa(entries: TranscriptEntry[]): string {
    const graded = entries.filter(e => e.grade_point != null && (e.offering as any).course?.credit_units)
    if (!graded.length) return '—'
    const totalPoints  = graded.reduce((s, e) => s + (e.grade_point! * (e.offering as any).course.credit_units), 0)
    const totalCredits = graded.reduce((s, e) => s + (e.offering as any).course.credit_units, 0)
    return totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : '—'
  }

  function semGpa(entries: TranscriptEntry[]): string { return gpa(entries) }

  const filteredSems     = semesters.filter(s => s.session_id === sessionId)
  const filteredAuditSems = auditSemesters.filter(s => s.session_id === auditSessionId)
  const TAB_LABEL: Record<Tab, string> = {
    offerings:   'Offerings & Results',
    transcripts: 'Transcripts',
    audit:       'Pipeline Audit',
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-bold text-navy-900">Acadex</div>
          <div className="text-sm text-gray-400 mt-0.5">
            {isAdmin ? 'Student transcripts and result pipeline audit' : 'Course offerings, score submission, result pipeline'}
          </div>
        </div>
      </div>

      {toast && <Alert type={toast.ok ? 'success' : 'danger'}>{toast.msg}</Alert>}

      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {availableTabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
              tab === t
                ? 'border-navy-900 text-navy-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {/* ── OFFERINGS TAB ──────────────────────────────────────────── */}
      {tab === 'offerings' && (
        <div className="space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div className="w-60">
              <Select value={sessionId} onChange={e => setSessionId(e.target.value)}>
                <option value="">— Select session —</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </div>
            {filteredSems.length > 0 && (
              <div className="w-60">
                <Select value={semesterId} onChange={e => setSemesterId(e.target.value)}>
                  {filteredSems.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              </div>
            )}
          </div>

          {semesterId && (
            <Card>
              {loading ? (
                <div className="px-6 py-12 text-sm text-gray-400 text-center">Loading offerings…</div>
              ) : offerings.length === 0 ? (
                <div className="px-6 py-12 text-sm text-gray-400 text-center">No offerings for this semester.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Course', 'Lecturer', 'Students', 'Status', 'Pipeline Action'].map(h => (
                        <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {offerings.map(off => {
                      const students = off.registrations?.filter(r => r.student_id) ?? []
                      const isExpanded = expandedOffering === off.id
                      return (
                        <tr key={off.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                          <td className="px-5 py-3">
                            <div className="font-semibold text-navy-900">{(off.course as any)?.code} — {(off.course as any)?.title}</div>
                            <div className="text-xs text-gray-400">{(off.course as any)?.credit_units} units</div>
                          </td>
                          <td className="px-5 py-3 text-xs text-gray-600">{lecturerName(off)}</td>
                          <td className="px-5 py-3">
                            <button
                              onClick={() => setExpandedOffering(isExpanded ? null : off.id)}
                              className="text-xs text-navy-600 hover:text-navy-900 font-semibold cursor-pointer"
                            >
                              {students.length} {isExpanded ? '▼' : '▶'}
                            </button>
                            {isExpanded && students.length > 0 && (
                              <div className="mt-2 bg-gray-50 p-2 rounded text-xs space-y-1">
                                {students.map(s => (
                                  <div key={s.id}>
                                    <div className="font-semibold text-gray-700">{(s.student as any)?.last_name}, {(s.student as any)?.first_name}</div>
                                    <div className="text-[10px] font-mono text-gray-400">{(s.student as any)?.reg_number}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_STYLE[off.results_status]}`}>
                              {off.results_status}
                            </span>
                          </td>
                          <td className="px-5 py-3 flex items-center gap-2">
                            {isLecturer && off.results_status === 'draft' && (
                              <Button variant="ghost" size="sm"
                                onClick={() => { setActiveOffering(off); setScores({}) }}>
                                Enter Scores
                              </Button>
                            )}
                            {isExamOfficer && off.results_status === 'submitted' && (
                              <>
                                <Button variant="ghost" size="sm"
                                  onClick={() => { setActiveOffering(off); setScores({}) }}>
                                  View
                                </Button>
                                <Button variant="ghost" size="sm"
                                  onClick={() => handlePipelineAction(off, 'results.dept_verify')}>
                                  Dept Verify
                                </Button>
                              </>
                            )}
                            {isHOD && off.results_status === 'dept_verified' && (
                              <>
                                <Button variant="ghost" size="sm"
                                  onClick={() => { setActiveOffering(off); setScores({}) }}>
                                  View
                                </Button>
                                <Button variant="ghost" size="sm"
                                  onClick={() => handlePipelineAction(off, 'results.dept_approve')}>
                                  Approve
                                </Button>
                              </>
                            )}
                            {isDean && off.results_status === 'faculty_verified' && (
                              <>
                                <Button variant="ghost" size="sm"
                                  onClick={() => { setActiveOffering(off); setScores({}) }}>
                                  View
                                </Button>
                                <Button variant="ghost" size="sm"
                                  onClick={() => handlePipelineAction(off, 'results.publish')}>
                                  Publish
                                </Button>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ── TRANSCRIPTS TAB ────────────────────────────────────────── */}
      {tab === 'transcripts' && (
        <div className="space-y-4">
          {/* Student search */}
          <Card>
            <div className="px-5 py-4">
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Search Student</div>
              <div className="relative">
                <input
                  value={studentSearch}
                  onChange={e => { setStudentSearch(e.target.value); setSelectedStudent(null) }}
                  placeholder="Name or registration number…"
                  className="w-full max-w-sm border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-navy-300"
                />
                {searchingStud && (
                  <span className="absolute right-3 top-2.5 text-xs text-gray-400">Searching…</span>
                )}
                {studentResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-w-sm bg-white border border-gray-200 rounded shadow-lg">
                    {studentResults.map(s => (
                      <button
                        key={s.id}
                        onClick={() => loadTranscript(s)}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 cursor-pointer"
                      >
                        <div className="text-sm font-semibold text-navy-900">{s.last_name}, {s.first_name}</div>
                        <div className="text-[11px] font-mono text-gray-400">{s.reg_number}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Transcript body */}
          {selectedStudent && (
            <div className="space-y-4">
              {/* Student header */}
              <div className="bg-navy-900 text-white rounded-xl px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold">{selectedStudent.last_name}, {selectedStudent.first_name}</div>
                  <div className="text-[13px] font-mono text-navy-200 mt-0.5">{selectedStudent.reg_number}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-navy-300 uppercase tracking-wider">Cumulative GPA</div>
                  <div className="text-2xl font-bold mt-0.5">
                    {loadingTx ? '…' : gpa(transcript.filter(e => (e.offering as any)?.results_status === 'published'))}
                  </div>
                </div>
              </div>

              {loadingTx ? (
                <div className="py-12 text-sm text-gray-400 text-center">Loading transcript…</div>
              ) : transcript.length === 0 ? (
                <Card>
                  <div className="px-6 py-12 text-sm text-gray-400 text-center">No course registrations found for this student.</div>
                </Card>
              ) : (
                groupBySession(transcript).map(({ session, sems }) => (
                  <div key={session}>
                    <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{session}</div>
                    {sems.map((sem: any) => {
                      const published = sem.entries.filter((e: TranscriptEntry) => (e.offering as any)?.results_status === 'published')
                      return (
                        <Card key={sem.semLabel} className="mb-3">
                          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                            <div className="text-[13px] font-bold text-navy-900">{sem.semLabel}</div>
                            <div className="text-[12px] text-gray-500">
                              GPA: <span className="font-bold text-navy-900">{semGpa(published)}</span>
                              <span className="ml-3 text-gray-400">
                                {published.reduce((s: number, e: TranscriptEntry) => s + ((e.offering as any)?.course?.credit_units ?? 0), 0)} units
                              </span>
                            </div>
                          </div>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-gray-50">
                                <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Course</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Units</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">CA</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Exam</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Total</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Grade</th>
                                <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sem.entries.map((e: TranscriptEntry) => {
                                const course = (e.offering as any)?.course
                                const total  = (e.ca_score ?? 0) + (e.exam_score ?? 0)
                                const status = (e.offering as any)?.results_status
                                return (
                                  <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                                    <td className="px-5 py-2.5">
                                      <div className="font-semibold text-navy-900 text-xs font-mono">{course?.code}</div>
                                      <div className="text-[11px] text-gray-500 truncate max-w-[220px]">{course?.title}</div>
                                    </td>
                                    <td className="px-3 py-2.5 text-center text-xs text-gray-600">{course?.credit_units ?? '—'}</td>
                                    <td className="px-3 py-2.5 text-center text-xs text-gray-600">{e.ca_score ?? '—'}</td>
                                    <td className="px-3 py-2.5 text-center text-xs text-gray-600">{e.exam_score ?? '—'}</td>
                                    <td className="px-3 py-2.5 text-center text-xs font-semibold text-navy-800">
                                      {e.ca_score != null || e.exam_score != null ? total.toFixed(1) : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                      {e.grade ? (
                                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                                          e.grade === 'F' ? 'bg-red-50 text-red-700' :
                                          e.grade === 'A' ? 'bg-green-50 text-green-700' :
                                          'bg-blue-50 text-blue-700'
                                        }`}>{e.grade}</span>
                                      ) : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-500'}`}>
                                        {status}
                                      </span>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </Card>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* ── AUDIT TAB ──────────────────────────────────────────────── */}
      {tab === 'audit' && (
        <div className="space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div className="w-60">
              <Select value={auditSessionId} onChange={e => setAuditSessionId(e.target.value)}>
                <option value="">— Select session —</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </div>
            {filteredAuditSems.length > 0 && (
              <div className="w-60">
                <Select value={auditSemId} onChange={e => setAuditSemId(e.target.value)}>
                  {filteredAuditSems.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              </div>
            )}
          </div>

          {auditSemId && (
            <Card>
              {auditLoading ? (
                <div className="px-6 py-12 text-sm text-gray-400 text-center">Loading…</div>
              ) : auditOfferings.length === 0 ? (
                <div className="px-6 py-12 text-sm text-gray-400 text-center">No offerings for this semester.</div>
              ) : (
                <>
                  {/* Summary chips */}
                  {(() => {
                    const counts: Record<string, number> = {}
                    auditOfferings.forEach(o => { counts[o.results_status] = (counts[o.results_status] ?? 0) + 1 })
                    const order: Offering['results_status'][] = ['draft','submitted','dept_verified','dept_approved','faculty_verified','published']
                    return (
                      <div className="flex gap-2 px-5 py-3 border-b border-gray-100 flex-wrap">
                        {order.map(s => counts[s] != null ? (
                          <span key={s} className={`text-[11px] font-semibold px-2.5 py-0.5 rounded ${STATUS_STYLE[s]}`}>
                            {counts[s]} {s}
                          </span>
                        ) : null)}
                      </div>
                    )
                  })()}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Course', 'Lecturer', 'Students', 'Pipeline Status'].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {auditOfferings.map(off => {
                        const enrolled = (off.registrations ?? []).filter((r: any) => r.student_id).length
                        return (
                          <tr key={off.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                            <td className="px-5 py-3">
                              <div className="font-semibold text-navy-900">{(off.course as any)?.code} — {(off.course as any)?.title}</div>
                              <div className="text-xs text-gray-400">{(off.course as any)?.credit_units} units</div>
                            </td>
                            <td className="px-5 py-3 text-xs text-gray-600">{lecturerName(off)}</td>
                            <td className="px-5 py-3 text-xs text-gray-600">{enrolled}</td>
                            <td className="px-5 py-3">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_STYLE[off.results_status]}`}>
                                {off.results_status}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ── Score entry / results modal ────────────────────────────── */}
      {activeOffering && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div>
                <div className="font-bold text-navy-900">
                  {(activeOffering.course as any)?.code} — {(activeOffering.course as any)?.title}
                </div>
                <div className="text-xs text-gray-400 mt-0.5 capitalize">
                  {isLecturer && activeOffering.results_status === 'draft' ? 'Score entry' : 'Score view'}
                </div>
              </div>
              <button onClick={() => setActiveOffering(null)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>

            {/* Analytics panel — shown to reviewer roles when scores are loaded */}
            {!isLecturer && activeOffering._registrations && activeOffering._registrations.length > 0 && (() => {
              const regs = activeOffering._registrations!
              const withScores = regs.filter(r => r.ca_score != null || r.exam_score != null)
              const n = regs.length
              const avgCA   = withScores.length ? (withScores.reduce((s, r) => s + (r.ca_score ?? 0), 0) / withScores.length).toFixed(1) : '—'
              const avgExam = withScores.length ? (withScores.reduce((s, r) => s + (r.exam_score ?? 0), 0) / withScores.length).toFixed(1) : '—'
              const avgTotal = withScores.length ? (withScores.reduce((s, r) => s + (r.ca_score ?? 0) + (r.exam_score ?? 0), 0) / withScores.length).toFixed(1) : '—'
              const graded  = regs.filter(r => r.grade)
              const passCount = graded.filter(r => r.grade !== 'F').length
              const passRate  = graded.length ? ((passCount / graded.length) * 100).toFixed(0) : '—'
              const gradeDist: Record<string, number> = {}
              graded.forEach(r => { gradeDist[r.grade!] = (gradeDist[r.grade!] ?? 0) + 1 })
              const gradeOrder = ['A', 'B', 'C', 'D', 'E', 'F']
              return (
                <div className="px-6 pt-5 pb-4 border-b border-gray-100 space-y-4">
                  {/* Summary stats */}
                  <div className="grid grid-cols-5 gap-3">
                    {[
                      { label: 'Students', value: n },
                      { label: 'Avg CA',   value: avgCA },
                      { label: 'Avg Exam', value: avgExam },
                      { label: 'Avg Total', value: avgTotal },
                      { label: 'Pass Rate', value: passRate === '—' ? '—' : `${passRate}%` },
                    ].map(stat => (
                      <div key={stat.label} className="bg-gray-50 rounded-lg px-3 py-3 text-center">
                        <div className="text-lg font-bold text-navy-900">{stat.value}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wide">{stat.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Grade distribution */}
                  {graded.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Grade Distribution</div>
                      <div className="flex gap-2">
                        {gradeOrder.map(g => {
                          const count = gradeDist[g] ?? 0
                          const pct   = graded.length ? Math.round((count / graded.length) * 100) : 0
                          return (
                            <div key={g} className="flex-1 text-center">
                              <div className="h-16 flex items-end justify-center mb-1">
                                <div
                                  className={`w-full rounded-t transition-all ${g === 'F' ? 'bg-red-300' : g === 'A' ? 'bg-green-400' : 'bg-blue-300'}`}
                                  style={{ height: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}
                                />
                              </div>
                              <div className="text-[11px] font-bold text-navy-900">{g}</div>
                              <div className="text-[10px] text-gray-400">{count}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="px-6 py-4">
              {!activeOffering._registrations ? (
                <div className="py-8 text-sm text-gray-400 text-center">Loading…</div>
              ) : activeOffering._registrations.length === 0 ? (
                <div className="py-8 text-sm text-gray-400 text-center">No students registered for this offering yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Student</th>
                      <th className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-24">CA (/40)</th>
                      <th className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-24">Exam (/60)</th>
                      <th className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-16">Total</th>
                      {activeOffering.results_status === 'published' && (
                        <th className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-16">Grade</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {activeOffering._registrations.map(reg => {
                      const ca   = scores[reg.student_id!]?.ca   ?? ''
                      const exam = scores[reg.student_id!]?.exam ?? ''
                      const total = (parseFloat(ca) || 0) + (parseFloat(exam) || 0)
                      const isPublished = activeOffering.results_status === 'published'
                      return (
                        <tr key={reg.id} className="border-b border-gray-50">
                          <td className="py-2">
                            <div className="font-semibold text-navy-900 text-xs">
                              {(reg.student as any)?.last_name}, {(reg.student as any)?.first_name}
                            </div>
                            <div className="text-[10px] font-mono text-gray-400">{(reg.student as any)?.reg_number}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <input type="number" min="0" max="40" step="0.5" value={ca}
                              onChange={e => setScores(s => ({ ...s, [reg.student_id!]: { ...s[reg.student_id!], ca: e.target.value } }))}
                              disabled={isPublished || !isLecturer}
                              className="w-20 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-navy-300 disabled:bg-gray-50 disabled:text-gray-500"
                            />
                          </td>
                          <td className="py-2 pr-3">
                            <input type="number" min="0" max="60" step="0.5" value={exam}
                              onChange={e => setScores(s => ({ ...s, [reg.student_id!]: { ...s[reg.student_id!], exam: e.target.value } }))}
                              disabled={isPublished || !isLecturer}
                              className="w-20 border border-gray-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-navy-300 disabled:bg-gray-50 disabled:text-gray-500"
                            />
                          </td>
                          <td className="py-2 text-xs font-semibold text-navy-800 text-right pr-4">
                            {ca || exam ? total.toFixed(1) : '—'}
                          </td>
                          {isPublished && (
                            <td className="py-2">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                reg.grade === 'F' ? 'bg-red-50 text-red-700' :
                                reg.grade === 'A' ? 'bg-green-50 text-green-700' :
                                'bg-blue-50 text-blue-700'
                              }`}>{reg.grade ?? '—'}</span>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {isLecturer && activeOffering.results_status === 'draft' && activeOffering._registrations && activeOffering._registrations.length > 0 && (
              <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
                <Button variant="ghost" size="sm" onClick={() => setActiveOffering(null)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleSubmitScores} disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit Scores'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
