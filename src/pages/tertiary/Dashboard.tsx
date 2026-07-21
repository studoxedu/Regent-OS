import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Topbar } from '../../components/layout/Topbar'
import { Card } from '../../components/ui/Card'
import { ResultStatusBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { supabase, flowExecute } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import type { AppUser, CourseOffering, ResultStatus, OfficeType, AcademicSession } from '../../types'

interface Props { appUser: AppUser }

const PIPELINE: ResultStatus[] = ['draft', 'submitted', 'dept_verified', 'dept_approved', 'faculty_verified', 'published']

const STAGE_BAR: Record<ResultStatus, string> = {
  draft:            'bg-gray-300',
  submitted:        'bg-blue-400',
  dept_verified:    'bg-cyan-400',
  dept_approved:    'bg-amber-400',
  faculty_verified: 'bg-violet-400',
  published:        'bg-green-500',
}

// Which statuses each office can act on (hierarchical chain, phase38)
const ACTIONABLE: Partial<Record<OfficeType, ResultStatus[]>> = {
  school_admin:         ['draft', 'submitted', 'dept_verified', 'dept_approved', 'faculty_verified'],
  lecturer:             ['draft'],
  dept_exam_officer:    ['submitted'],
  exam_officer:         ['submitted'],
  hod:                  ['dept_verified'],
  faculty_exam_officer: ['dept_approved'],
  dean:                 ['faculty_verified'],
}

// Label for the next action button
function nextActionLabel(status: ResultStatus, _office: OfficeType): string {
  switch (status) {
    case 'draft':            return 'Submit'
    case 'submitted':        return 'Dept Verify'
    case 'dept_verified':    return 'HOD Approve'
    case 'dept_approved':    return 'Faculty Verify'
    case 'faculty_verified': return 'Publish'
    default:                 return 'Advance'
  }
}

// The flow_execute action string for the next step
const NEXT_ACTION: Record<ResultStatus, string | null> = {
  draft:            'results.submit',
  submitted:        'results.dept_verify',
  dept_verified:    'results.dept_approve',
  dept_approved:    'results.faculty_verify',
  faculty_verified: 'results.publish',
  published:        null,
}

interface Snapshot {
  students: number
  faculties: number
  departments: number
  session: AcademicSession | null
}

interface ToolLink { label: string; to: string; note: string }

const TOOLS: ToolLink[] = [
  { label: 'Students',         to: '/tertiary/students',      note: 'Registry' },
  { label: 'Staff',            to: '/tertiary/staff',         note: 'Assignments' },
  { label: 'Structure',        to: '/tertiary/structure',     note: 'Faculties & Depts' },
  { label: 'Sessions',         to: '/tertiary/sessions',      note: 'Academic calendar' },
  { label: 'Results Pipeline', to: '/tertiary/results',       note: 'Full pipeline view' },
  { label: 'Transcripts',      to: '/tertiary/transcripts',   note: 'Issue & verify' },
  { label: 'Grade Scales',     to: '/tertiary/grade-scales',  note: 'Scoring rubric' },
  { label: 'Fees',             to: '/tertiary/fees',          note: 'Fee management' },
  { label: 'Announcements',    to: '/tertiary/announcements', note: 'Communications' },
]

export default function TertiaryDashboard({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''
  const officeName = (appUser.activeMembership?.office?.name ?? 'school_admin') as OfficeType
  const navigate = useNavigate()

  const [pipeline, setPipeline] = useState<Record<ResultStatus, number>>(
    { draft: 0, submitted: 0, dept_verified: 0, dept_approved: 0, faculty_verified: 0, published: 0 }
  )
  const [queue, setQueue] = useState<CourseOffering[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot>({ students: 0, faculties: 0, departments: 0, session: null })
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(null), 4000)
  }

  async function loadData() {
    const [
      { count: students },
      { data: faculties },
      { data: depts },
      { data: sessions },
    ] = await Promise.all([
      supabase.from('learner_enrollments').select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId).eq('status', 'active'),
      supabase.from('faculties').select('id').eq('school_id', schoolId),
      supabase.from('departments').select('id, faculty:faculties!inner(school_id)')
        .eq('faculty.school_id', schoolId),
      supabase.from('academic_sessions').select('*')
        .eq('school_id', schoolId).eq('is_active', true).limit(1),
    ])

    const activeSession = (sessions ?? [])[0] as AcademicSession | undefined ?? null

    // Fetch offerings via active session's semesters
    let offerings: CourseOffering[] = []
    if (activeSession) {
      const { data: sems } = await supabase
        .from('semesters').select('id').eq('session_id', activeSession.id)

      if (sems && sems.length > 0) {
        const semIds = sems.map(s => s.id)
        const { data: offs } = await supabase
          .from('course_offerings')
          .select('*, course:courses(code, title)')
          .in('semester_id', semIds)
          .order('results_status')
        offerings = (offs ?? []) as CourseOffering[]
      }
    }

    // Pipeline counts
    const counts = { draft: 0, submitted: 0, dept_verified: 0, dept_approved: 0, faculty_verified: 0, published: 0 } as Record<ResultStatus, number>
    offerings.forEach(o => { counts[o.results_status] = (counts[o.results_status] ?? 0) + 1 })

    // Action queue: offerings this office can act on
    const actionableStatuses = ACTIONABLE[officeName] ?? []
    const actionQueue = offerings.filter(o => actionableStatuses.includes(o.results_status))

    setPipeline(counts)
    setQueue(actionQueue.slice(0, 8))
    setSnapshot({
      students: students ?? 0,
      faculties: (faculties ?? []).length,
      departments: (depts ?? []).length,
      session: activeSession,
    })
    setLoading(false)
  }

  useEffect(() => { if (schoolId) loadData() }, [schoolId])

  async function advance(offering: CourseOffering) {
    const action = NEXT_ACTION[offering.results_status]
    if (!action) return
    setActing(offering.id)
    try {
      await flowExecute(action, schoolId, { offering_id: offering.id })
      await loadData()
      showToast(`${action} — done.`)
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Unknown'}`)
    } finally {
      setActing(null)
    }
  }

  const total = Object.values(pipeline).reduce((a, b) => a + b, 0)

  return (
    <>
      <Topbar
        title={appUser.activeSchool?.name ?? 'Institution'}
        meta={officeName.replace(/_/g, ' ')}
      />

      <div className="p-8 space-y-8">

        {/* Session banner */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-6">
          <div>
            <div className="text-[22px] font-bold text-navy-900 leading-tight">
              {appUser.activeSchool?.name}
            </div>
            <div className="text-sm text-gray-400 mt-0.5">
              {appUser.activeSchool?.stages_offered?.map(s => s.toUpperCase()).join(' · ')} · Tertiary Governance
            </div>
          </div>
          <div className="text-right">
            {snapshot.session ? (
              <>
                <div className="text-sm font-bold text-navy-800">{snapshot.session.label}</div>
                <div className="flex items-center gap-1.5 justify-end mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <span className="text-xs text-green-600 font-semibold">Active Session</span>
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-400">No active session</div>
            )}
          </div>
        </div>

        {/* Pipeline hero */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="label">Results Pipeline</div>
            <div className="text-xs text-gray-400">{total} offerings total</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-sm">
            {/* Stage track */}
            <div className="flex border-b border-gray-100">
              {PIPELINE.map((step, i) => {
                const count = pipeline[step]
                return (
                  <div
                    key={step}
                    className={cn(
                      'flex-1 px-5 py-5 relative',
                      i < PIPELINE.length - 1 && 'border-r border-gray-100'
                    )}
                  >
                    <div className="label mb-3 text-[9px] tracking-[0.12em]">{step}</div>
                    <div className="text-[36px] font-bold text-navy-900 leading-none">{count}</div>
                    <div className="text-xs text-gray-400 mt-1">offerings</div>
                    <div className={cn('absolute bottom-0 left-0 right-0 h-[3px]', STAGE_BAR[step])}
                      style={{ opacity: count > 0 ? 1 : 0.2 }} />
                    {i < PIPELINE.length - 1 && (
                      <div className="absolute right-[-10px] top-1/2 -translate-y-1/2 z-10 text-gray-300 text-lg font-light">
                        ›
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Progress bar */}
            {total > 0 && (
              <div className="flex h-1.5">
                {PIPELINE.map(step => (
                  pipeline[step] > 0 && (
                    <div
                      key={step}
                      className={STAGE_BAR[step]}
                      style={{ width: `${(pipeline[step] / total) * 100}%` }}
                    />
                  )
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Action queue + Snapshot */}
        <div className="grid grid-cols-3 gap-6">

          {/* Action queue */}
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div className="label">Action Queue</div>
              <Link to="/tertiary/results" className="text-xs font-semibold text-navy-700 hover:underline">
                Full pipeline →
              </Link>
            </div>
            <Card>
              {loading ? (
                <div className="px-5 py-10 text-sm text-gray-400 text-center">Loading…</div>
              ) : queue.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <div className="text-sm text-gray-500 font-semibold mb-1">No pending actions</div>
                  <div className="text-xs text-gray-400">
                    {total === 0
                      ? 'No offerings exist for this session yet.'
                      : `Nothing in your queue as ${officeName.replace(/_/g, ' ')}.`}
                  </div>
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['Course', 'Status', ''].map(h => (
                        <th key={h} className={cn(
                          'px-5 py-2.5 bg-gray-50 border-b border-gray-200',
                          'text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500',
                          h === '' ? 'text-right' : 'text-left'
                        )}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map(o => (
                      <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-5 py-3">
                          <div className="text-sm font-semibold text-navy-900">{o.course?.code}</div>
                          <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[260px]">{o.course?.title}</div>
                        </td>
                        <td className="px-5 py-3">
                          <ResultStatusBadge status={o.results_status} />
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Button
                            variant={o.results_status === 'faculty_verified' ? 'amber' : 'secondary'}
                            size="sm"
                            onClick={() => advance(o)}
                            disabled={acting === o.id}
                          >
                            {acting === o.id ? '…' : nextActionLabel(o.results_status, officeName)}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          {/* Institution snapshot */}
          <div className="flex flex-col gap-4">
            <div className="label mb-0">Institution</div>
            <Card className="divide-y divide-gray-50">
              {[
                { label: 'Active Students', value: loading ? '—' : snapshot.students },
                { label: 'Faculties',       value: loading ? '—' : snapshot.faculties },
                { label: 'Departments',     value: loading ? '—' : snapshot.departments },
              ].map(row => (
                <div key={row.label} className="px-5 py-3.5 flex items-center justify-between">
                  <span className="text-sm text-gray-600">{row.label}</span>
                  <span className="text-base font-bold text-navy-900">{row.value}</span>
                </div>
              ))}
            </Card>

            {/* Tool links */}
            <div className="label mt-2 mb-0">Tools</div>
            <Card className="divide-y divide-gray-50">
              {TOOLS.map(t => (
                <button
                  key={t.to}
                  onClick={() => navigate(t.to)}
                  className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer text-left"
                >
                  <span className="text-sm text-navy-800 font-medium">{t.label}</span>
                  <span className="text-[10px] text-gray-400">{t.note}</span>
                </button>
              ))}
            </Card>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-navy-900 text-white px-5 py-3 rounded-sm shadow-modal text-sm z-50">
          {toast}
        </div>
      )}
    </>
  )
}
