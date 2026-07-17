import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Select, Field } from '../../components/ui/Form'
import { ResultStatusBadge } from '../../components/ui/Badge'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import type { AppUser, AcademicSession, Semester, CourseOffering, GradeScale } from '../../types'

interface Props { appUser: AppUser }

interface Course {
  id: string
  code: string
  title: string
  credit_units: number
  department?: { name: string }
}

interface Lecturer {
  id: string
  name: string
}

/** Tertiary students live in `students` (admitted via create_student), NOT in
 *  learner_enrollments — that's the K-12 model and is always empty for a
 *  university. course_registrations.student_id is the tertiary link, and it's
 *  what the lecturer's score-entry page already reads. */
interface TertStudentLite {
  id: string
  reg_number: string
  first_name: string
  last_name: string
}

interface Registration {
  id: string
  offering_id: string
  student_id: string
  ca_score: number | null
  exam_score: number | null
  grade: string | null
  student?: TertStudentLite
}

function computeGrade(total: number, scales: GradeScale[]): string {
  const match = scales.find(s => total >= s.min_score && total <= s.max_score)
  return match?.grade ?? 'F'
}

export default function CourseRegistration({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''

  const [sessions, setSessions]         = useState<AcademicSession[]>([])
  const [semesters, setSemesters]       = useState<Semester[]>([])
  const [offerings, setOfferings]       = useState<CourseOffering[]>([])
  const [gradeScales, setGradeScales]   = useState<GradeScale[]>([])
  const [allStudents, setAllStudents]   = useState<TertStudentLite[]>([])
  const [allCourses, setAllCourses]     = useState<Course[]>([])
  const [lecturers, setLecturers]       = useState<Lecturer[]>([])

  // Create offering modal
  const [showCreateOffering, setShowCreateOffering] = useState(false)
  const [newCourseId, setNewCourseId]               = useState('')
  const [newLecturerId, setNewLecturerId]            = useState('')
  const [creatingOffering, setCreatingOffering]      = useState(false)

  const [selectedSession,  setSelectedSession]  = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')
  const [expandedOffering, setExpandedOffering] = useState<string | null>(null)
  const [registrations, setRegistrations]       = useState<Record<string, Registration[]>>({})
  const [scores, setScores]                     = useState<Record<string, { ca: string; exam: string }>>({})
  const [savingScore, setSavingScore]           = useState<string | null>(null)
  const [addingReg, setAddingReg]               = useState<string | null>(null)
  const [newStudentId, setNewStudentId]         = useState('')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    if (!schoolId) return
    Promise.all([
      supabase.from('academic_sessions').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
      supabase.from('grade_scales').select('*').eq('school_id', schoolId).order('min_score', { ascending: false }),
      supabase.from('students').select('id, reg_number, first_name, last_name')
        .eq('institution_id', schoolId).eq('status', 'active').order('reg_number'),
      supabase.from('faculties').select('id').eq('school_id', schoolId),
    ]).then(async ([{ data: sess }, { data: gs }, { data: studs }, { data: facs }]) => {
      setSessions((sess ?? []) as AcademicSession[])
      setGradeScales((gs ?? []) as GradeScale[])
      setAllStudents((studs ?? []) as TertStudentLite[])
      if (sess && sess.length > 0) setSelectedSession(sess[0].id)

      // Load courses scoped to this school via faculties → departments
      const facultyIds = (facs ?? []).map((f: any) => f.id)
      if (facultyIds.length > 0) {
        const { data: depts } = await supabase.from('departments').select('id').in('faculty_id', facultyIds)
        const deptIds = (depts ?? []).map((d: any) => d.id)
        if (deptIds.length > 0) {
          const { data: crs } = await supabase.from('courses')
            .select('*, department:departments(name)').in('department_id', deptIds).order('code')
          setAllCourses((crs ?? []) as Course[])
        }
      }

      // Load lecturers
      const { data: lecOffice } = await supabase.from('offices').select('id').eq('name', 'lecturer').single()
      if (lecOffice) {
        const { data: mems } = await supabase.from('memberships')
          .select('id, profile:profiles(first_name, last_name)')
          .eq('school_id', schoolId).eq('is_active', true).eq('office_id', lecOffice.id)
        setLecturers(((mems ?? []) as any[]).map(m => ({
          id:   m.id,
          name: `${m.profile?.first_name ?? ''} ${m.profile?.last_name ?? ''}`.trim() || 'Unnamed',
        })))
      }
    })
  }, [schoolId])

  useEffect(() => {
    if (!selectedSession) return
    supabase.from('semesters').select('*').eq('session_id', selectedSession).order('ordinal')
      .then(({ data }) => {
        setSemesters((data ?? []) as Semester[])
        setSelectedSemester('')
        setOfferings([])
      })
  }, [selectedSession])

  useEffect(() => {
    if (!selectedSemester) return
    supabase.from('course_offerings')
      .select('*, course:courses(code, title, credit_units)')
      .eq('semester_id', selectedSemester)
      .order('created_at')
      .then(({ data }) => setOfferings((data ?? []) as CourseOffering[]))
  }, [selectedSemester])

  async function loadRegistrations(offeringId: string) {
    const { data } = await supabase.from('course_registrations')
      .select('*, student:students(id, reg_number, first_name, last_name)')
      .eq('offering_id', offeringId)
    const regs = (data ?? []) as Registration[]
    setRegistrations(prev => ({ ...prev, [offeringId]: regs }))
    const initScores: Record<string, { ca: string; exam: string }> = {}
    regs.forEach(r => {
      initScores[r.id] = { ca: r.ca_score?.toString() ?? '', exam: r.exam_score?.toString() ?? '' }
    })
    setScores(prev => ({ ...prev, ...initScores }))
  }

  function toggleOffering(id: string) {
    if (expandedOffering === id) {
      setExpandedOffering(null)
    } else {
      setExpandedOffering(id)
      if (!registrations[id]) loadRegistrations(id)
    }
  }

  async function saveScore(reg: Registration, offeringId: string) {
    setSavingScore(reg.id)
    const ca   = parseFloat(scores[reg.id]?.ca ?? '') || 0
    const exam = parseFloat(scores[reg.id]?.exam ?? '') || 0
    const total = ca + exam
    const grade = computeGrade(total, gradeScales)
    await supabase.from('course_registrations').update({ ca_score: ca, exam_score: exam, grade }).eq('id', reg.id)
    setSavingScore(null)
    flash(`Score saved — ${grade}`)
    loadRegistrations(offeringId)
  }

  async function addRegistration(offeringId: string) {
    if (!newStudentId) return
    const { error } = await supabase.from('course_registrations').insert({
      offering_id: offeringId,
      student_id:  newStudentId,
    })
    if (error) { flash(error.message, 'error'); return }
    setNewStudentId('')
    setAddingReg(null)
    flash('Student registered.')
    loadRegistrations(offeringId)
    setOfferings(prev => prev.map(o => o.id === offeringId ? { ...o } : o))
  }

  async function removeRegistration(regId: string, offeringId: string) {
    await supabase.from('course_registrations').delete().eq('id', regId)
    flash('Registration removed.')
    loadRegistrations(offeringId)
  }

  async function createOffering() {
    if (!newCourseId || !selectedSemester) return
    setCreatingOffering(true)
    const { error } = await supabase.from('course_offerings').insert({
      course_id:              newCourseId,
      semester_id:            selectedSemester,
      lecturer_membership_id: newLecturerId || null,
      results_status:         'draft',
    })
    setCreatingOffering(false)
    if (error) { flash(error.message, 'error'); return }
    setShowCreateOffering(false)
    setNewCourseId('')
    setNewLecturerId('')
    flash('Course offering created.')
    // Reload offerings
    const { data } = await supabase.from('course_offerings')
      .select('*, course:courses(code, title, credit_units)')
      .eq('semester_id', selectedSemester).order('created_at')
    setOfferings((data ?? []) as CourseOffering[])
  }

  const canEnterScores = ['school_admin', 'exam_officer', 'lecturer'].includes(appUser.activeMembership?.office?.name ?? '')

  return (
    <>
      <Topbar title="Course Registration" meta="Enrolment & score entry" />

      <div className="p-8 space-y-6">
        {toast && <Alert type={toast.type === 'error' ? 'danger' : 'success'}>{toast.msg}</Alert>}

        {/* Semester selector */}
        <Card className="p-5">
          <div className="flex items-center gap-4 flex-wrap justify-between">
            <div className="flex items-end gap-4 flex-wrap">
              <div className="w-48">
                <Field label="Session">
                  <Select
                    value={selectedSession}
                    onChange={e => setSelectedSession(e.target.value)}
                    placeholder="Select session…"
                    options={sessions.map(s => ({ value: s.id, label: s.label }))}
                  />
                </Field>
              </div>
              <div className="w-48">
                <Field label="Semester">
                  <Select
                    value={selectedSemester}
                    onChange={e => setSelectedSemester(e.target.value)}
                    placeholder={selectedSession ? 'Select semester…' : '—'}
                    options={semesters.map(s => ({ value: s.id, label: s.label }))}
                  />
                </Field>
              </div>
            </div>
            {selectedSemester && (
              <Button variant="primary" size="sm" onClick={() => setShowCreateOffering(v => !v)}>
                + Create Offering
              </Button>
            )}
          </div>

          {/* Create offering form */}
          {showCreateOffering && selectedSemester && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">New Course Offering</div>
              <div className="flex items-end gap-3 flex-wrap">
                <div className="w-64">
                  <Field label="Course">
                    <Select
                      value={newCourseId}
                      onChange={e => setNewCourseId(e.target.value)}
                      placeholder="Select course…"
                      options={allCourses.map(c => ({
                        value: c.id,
                        label: `${c.code} — ${c.title} (${c.credit_units} CU)`,
                      }))}
                    />
                  </Field>
                </div>
                {lecturers.length > 0 && (
                  <div className="w-48">
                    <Field label="Lecturer">
                      <Select
                        value={newLecturerId}
                        onChange={e => setNewLecturerId(e.target.value)}
                        placeholder="— unassigned —"
                        options={lecturers.map(l => ({ value: l.id, label: l.name }))}
                      />
                    </Field>
                  </div>
                )}
                <div className="flex gap-2 pb-0.5">
                  <Button variant="primary" size="sm" onClick={createOffering}
                    disabled={creatingOffering || !newCourseId}>
                    {creatingOffering ? 'Creating…' : 'Create'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowCreateOffering(false)}>Cancel</Button>
                </div>
              </div>
              {allCourses.length === 0 && (
                <p className="text-xs text-amber-600 mt-2">No courses found. Add courses via Structure → Department → Courses.</p>
              )}
            </div>
          )}
        </Card>

        {/* Offerings list */}
        {selectedSemester && offerings.length === 0 && (
          <Card className="py-12 text-center">
            <div className="text-sm text-gray-400">No course offerings for this semester.</div>
            <div className="text-xs text-gray-300 mt-1">Create offerings via the Results Pipeline page.</div>
          </Card>
        )}

        {offerings.map(o => {
          const course = (o as any).course
          const isExpanded = expandedOffering === o.id
          const regs = registrations[o.id] ?? []
          const isDraft = o.results_status === 'draft'

          return (
            <Card key={o.id}>
              <button
                className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50/50 transition-colors"
                onClick={() => toggleOffering(o.id)}
              >
                <div className="flex items-center gap-4">
                  <div>
                    <div className="text-sm font-bold text-navy-900">
                      {course?.code} — {course?.title}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {course?.credit_units} credit unit{course?.credit_units !== 1 ? 's' : ''}
                      {regs.length > 0 && ` · ${regs.length} student${regs.length !== 1 ? 's' : ''} registered`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ResultStatusBadge status={o.results_status} />
                  <span className="text-gray-400 text-sm">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100">
                  {regs.length === 0 ? (
                    <div className="px-5 py-6 text-sm text-gray-400">No students registered for this offering.</div>
                  ) : (
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          {['Student', 'Reg No.', 'CA (/30)', 'Exam (/70)', 'Total', 'Grade', ''].map(h => (
                            <th key={h} className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500 text-left">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {regs.map(r => {
                          const st = r.student
                          const s = scores[r.id] ?? { ca: '', exam: '' }
                          const ca   = parseFloat(s.ca) || 0
                          const exam = parseFloat(s.exam) || 0
                          const total = s.ca || s.exam ? ca + exam : null
                          const grade = total !== null ? computeGrade(total, gradeScales) : r.grade

                          return (
                            <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                              <td className="px-4 py-3 text-sm font-semibold text-navy-900">
                                {st?.first_name} {st?.last_name}
                              </td>
                              <td className="px-4 py-3 text-xs font-mono text-gray-500">{st?.reg_number}</td>
                              <td className="px-4 py-2">
                                {canEnterScores && isDraft ? (
                                  <input
                                    type="number" min="0" max="30"
                                    value={s.ca}
                                    onChange={e => setScores(prev => ({ ...prev, [r.id]: { ...prev[r.id], ca: e.target.value } }))}
                                    className="w-16 border border-gray-200 rounded-sm px-2 py-1 text-sm text-center outline-none focus:border-navy-500"
                                  />
                                ) : (
                                  <span className="text-sm text-navy-900">{r.ca_score ?? '—'}</span>
                                )}
                              </td>
                              <td className="px-4 py-2">
                                {canEnterScores && isDraft ? (
                                  <input
                                    type="number" min="0" max="70"
                                    value={s.exam}
                                    onChange={e => setScores(prev => ({ ...prev, [r.id]: { ...prev[r.id], exam: e.target.value } }))}
                                    className="w-16 border border-gray-200 rounded-sm px-2 py-1 text-sm text-center outline-none focus:border-navy-500"
                                  />
                                ) : (
                                  <span className="text-sm text-navy-900">{r.exam_score ?? '—'}</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm font-mono font-semibold text-navy-900">
                                {total !== null ? total.toFixed(0) : (r.ca_score !== null && r.exam_score !== null ? ((r.ca_score ?? 0) + (r.exam_score ?? 0)).toFixed(0) : '—')}
                              </td>
                              <td className="px-4 py-3">
                                {grade && (
                                  <span className={cn(
                                    'inline-flex items-center justify-center w-7 h-7 rounded-sm text-sm font-bold',
                                    grade === 'A' ? 'bg-green-100 text-green-700' :
                                    grade === 'F' ? 'bg-red-100 text-red-700' :
                                    'bg-blue-100 text-blue-700'
                                  )}>{grade}</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  {canEnterScores && isDraft && (
                                    <Button variant="secondary" size="sm" onClick={() => saveScore(r, o.id)}
                                      disabled={savingScore === r.id}>
                                      {savingScore === r.id ? '…' : 'Save'}
                                    </Button>
                                  )}
                                  {isDraft && (
                                    <button onClick={() => removeRegistration(r.id, o.id)}
                                      className="text-gray-300 hover:text-red-400 text-xs">×</button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}

                  {isDraft && (
                    <div className="px-5 py-3 border-t border-gray-100">
                      {addingReg === o.id ? (
                        <div className="flex items-center gap-2">
                          <div className="w-72">
                            <Select
                              value={newStudentId}
                              onChange={e => setNewStudentId(e.target.value)}
                              placeholder="Select student…"
                              options={allStudents
                                .filter(st => !regs.some(r => r.student_id === st.id))
                                .map(st => ({
                                  value: st.id,
                                  label: `${st.first_name} ${st.last_name} (${st.reg_number})`,
                                }))}
                            />
                          </div>
                          <Button variant="primary" size="sm" onClick={() => addRegistration(o.id)}
                            disabled={!newStudentId}>Register</Button>
                          <Button variant="ghost" size="sm" onClick={() => { setAddingReg(null); setNewStudentId('') }}>Cancel</Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => { setAddingReg(o.id); setNewStudentId('') }}>
                          + Register Student
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}
