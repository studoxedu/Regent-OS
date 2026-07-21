import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader } from '../../components/ui/Card'
import { ResultStatusBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { flowExecute, supabase } from '../../lib/supabase'
import { notify } from '../../lib/notifications'
import { RESULT_STATUS_LABELS } from '../../lib/utils'
import type { AppUser, CourseOffering, ResultStatus } from '../../types'

interface Props { appUser: AppUser }

// Hierarchical chain: draft → submitted → dept_verified → dept_approved → faculty_verified → published
const PIPELINE: { status: ResultStatus; next: ResultStatus; action: string; label: string }[] = [
  { status: 'draft',            next: 'submitted',        action: 'results.submit',        label: 'Submit' },
  { status: 'submitted',        next: 'dept_verified',    action: 'results.dept_verify',   label: 'Dept Verify' },
  { status: 'dept_verified',    next: 'dept_approved',    action: 'results.dept_approve',  label: 'HOD Approve' },
  { status: 'dept_approved',    next: 'faculty_verified', action: 'results.faculty_verify',label: 'Faculty Verify' },
  { status: 'faculty_verified', next: 'published',        action: 'results.publish',       label: 'Publish' },
]

// Which capabilities each office holds (mirrors phase38 grants).
const CAP: Record<string, string[]> = {
  lecturer:             ['results.submit'],
  dept_exam_officer:    ['results.dept_verify', 'results.reject'],
  exam_officer:         ['results.dept_verify', 'results.reject'],
  hod:                  ['results.dept_approve', 'results.reject'],
  faculty_exam_officer: ['results.faculty_verify', 'results.reject'],
  dean:                 ['results.publish', 'results.reject'],
  school_admin:         ['results.submit', 'results.dept_verify', 'results.dept_approve', 'results.faculty_verify', 'results.publish', 'results.reject'],
}

// When results are rejected, who is the previous owner to notify + fix?
const REJECT_TARGET: Record<string, { office: string; scope: 'lecturer' | 'dept' | 'faculty' }> = {
  submitted:        { office: 'lecturer',             scope: 'lecturer' },
  dept_verified:    { office: 'dept_exam_officer',    scope: 'dept' },
  dept_approved:    { office: 'hod',                  scope: 'dept' },
  faculty_verified: { office: 'faculty_exam_officer', scope: 'faculty' },
}

export default function TertiaryResultsPipeline({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''
  const officeName = appUser.activeMembership?.office?.name ?? ''
  const [offerings, setOfferings] = useState<CourseOffering[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => { load() /* eslint-disable-next-line */ }, [schoolId])

  function load() {
    if (!schoolId) return
    supabase
      .from('course_offerings')
      .select('*, course:courses(code, title, credit_units, department:departments(id, faculty_id)), semester:semesters(label, session:academic_sessions(label))')
      .order('created_at', { ascending: false })
      .limit(80)
      .then(({ data }) => setOfferings((data ?? []) as CourseOffering[]))
  }

  const caps = CAP[officeName] ?? []

  function stepFor(status: string) { return PIPELINE.find(p => p.status === status) }
  function canAdvance(o: CourseOffering) {
    const step = stepFor(o.results_status)
    return !!step && caps.includes(step.action)
  }
  function canReject(o: CourseOffering) {
    const step = stepFor(o.results_status)
    // Only the approver responsible for THIS state may reject it (the same office
    // that advances it). Mirrors flow_execute's per-state reject rules, so the
    // button never appears where the backend would refuse it.
    return !!step && step.action !== 'results.submit'
      && caps.includes(step.action) && caps.includes('results.reject')
  }

  async function advance(o: CourseOffering) {
    const step = stepFor(o.results_status)
    if (!step) return
    setLoading(o.id)
    try {
      await flowExecute(step.action, schoolId, { offering_id: o.id })
      setOfferings(prev => prev.map(x => x.id === o.id ? { ...x, results_status: step.next } : x))
      showToast(`${(o as any).course?.code} → ${RESULT_STATUS_LABELS[step.next]}`)
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally { setLoading(null) }
  }

  async function reject(o: CourseOffering) {
    const target = REJECT_TARGET[o.results_status]
    const note = window.prompt('Reason for sending these results back (the previous reviewer will be notified):', '')
    if (note === null) return
    setLoading(o.id)
    try {
      const res: any = await flowExecute('results.reject', schoolId, { offering_id: o.id, rejection_note: note })
      const rejectedTo: ResultStatus = res?.rejected_to ?? 'draft'
      setOfferings(prev => prev.map(x => x.id === o.id ? { ...x, results_status: rejectedTo } : x))
      await notifyPrevious(o, target, note)
      showToast(`Sent back to ${RESULT_STATUS_LABELS[rejectedTo]}`)
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally { setLoading(null) }
  }

  // Notify the previous owner (per the user's "returns to the previous user") to make changes.
  async function notifyPrevious(o: CourseOffering, target: { office: string; scope: string } | undefined, note: string) {
    if (!target) return
    let profileId: string | null = null
    if (target.scope === 'lecturer') {
      if (!(o as any).lecturer_membership_id) return
      const { data } = await supabase.from('memberships').select('profile_id').eq('id', (o as any).lecturer_membership_id).maybeSingle()
      profileId = (data as any)?.profile_id ?? null
    } else {
      const dept = (o as any).course?.department
      let q = supabase.from('memberships').select('profile_id, office:offices!inner(name)')
        .eq('school_id', schoolId).eq('is_active', true).eq('office.name', target.office)
      q = target.scope === 'dept' ? q.eq('department_id', dept?.id) : q.eq('faculty_id', dept?.faculty_id)
      const { data } = await q.limit(1)
      profileId = (data?.[0] as any)?.profile_id ?? null
    }
    if (!profileId) return
    notify(profileId, schoolId, 'Results returned for changes', {
      body: `${(o as any).course?.code} results were sent back${note ? `: ${note}` : ''}`,
      type: 'warning',
      link: '/tertiary/results',
    })
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000) }

  const stages: ResultStatus[] = ['draft', 'submitted', 'dept_verified', 'dept_approved', 'faculty_verified']
  const published = offerings.filter(o => o.results_status === 'published')

  return (
    <>
      <Topbar title="Results Pipeline" meta="Departmental → faculty → senate governance chain" />

      <div className="p-8 space-y-4">
        {stages.map(status => {
          const group = offerings.filter(o => o.results_status === status)
          return (
            <Card key={status}>
              <CardHeader
                title={RESULT_STATUS_LABELS[status]}
                meta={`${group.length} offering${group.length !== 1 ? 's' : ''}`}
              />
              {group.length === 0 ? (
                <div className="px-5 py-4 text-sm text-gray-400">No offerings at this stage.</div>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['Course', 'Semester', 'Status', 'Action'].map(h => (
                        <th key={h} className="px-5 py-2.5 text-left bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.map(o => (
                      <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="px-5 py-3">
                          <div className="text-sm font-semibold text-navy-900">{(o as any).course?.code} — {(o as any).course?.title}</div>
                          <div className="text-xs text-gray-400">{(o as any).course?.credit_units} credit units</div>
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-600">
                          {(o as any).semester?.label} · {(o as any).semester?.session?.label}
                        </td>
                        <td className="px-5 py-3"><ResultStatusBadge status={o.results_status} /></td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {canAdvance(o) ? (
                              <Button variant="amber" size="sm" onClick={() => advance(o)} disabled={loading === o.id}>
                                {loading === o.id ? '…' : `→ ${stepFor(o.results_status)?.label}`}
                              </Button>
                            ) : !canReject(o) && (
                              <span className="text-xs text-gray-400">Awaiting your role</span>
                            )}
                            {canReject(o) && (
                              <button
                                onClick={() => reject(o)}
                                disabled={loading === o.id}
                                className="text-xs font-semibold text-red-500 hover:text-red-700 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )
        })}

        {published.length > 0 && (
          <Card>
            <CardHeader title="Published" meta={`${published.length} offering${published.length !== 1 ? 's' : ''}`} />
            <div className="divide-y divide-gray-50">
              {published.map(o => (
                <div key={o.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-navy-900">{(o as any).course?.code}</span>
                    <span className="text-sm text-gray-500 ml-2">{(o as any).course?.title}</span>
                  </div>
                  <ResultStatusBadge status="published" />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-navy-900 text-white px-5 py-3 rounded-sm shadow-modal text-sm z-50">{toast}</div>
      )}
    </>
  )
}
