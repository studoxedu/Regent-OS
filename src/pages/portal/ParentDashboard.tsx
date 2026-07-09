import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card, CardHeader } from '../../components/ui/Card'
import { cn } from '../../lib/utils'
import type { Guardian, GuardianLink, LearnerEnrollment, TermResult, FeeInvoice, AttendanceRecord, GuardianNotification } from '../../types'

interface Props { guardianEmail: string; onSignOut: () => void }

interface LearnerView {
  link: GuardianLink
  enrollment: LearnerEnrollment | null
  results: TermResult[]
  invoices: FeeInvoice[]
  attendance: AttendanceRecord[]
}

type Tab = 'results' | 'fees' | 'attendance' | 'alerts'

export default function ParentDashboard({ guardianEmail, onSignOut }: Props) {
  const [guardian, setGuardian]     = useState<Guardian | null>(null)
  const [learners, setLearners]     = useState<LearnerView[]>([])
  const [activeLearner, setActiveLearner] = useState<number>(0)
  const [tab, setTab]               = useState<Tab>('results')
  const [loading, setLoading]       = useState(true)
  const [alerts, setAlerts]         = useState<GuardianNotification[]>([])

  useEffect(() => {
    async function load() {
      // Find guardian by email
      const { data: g } = await supabase
        .from('guardians').select('*').eq('email', guardianEmail).maybeSingle()
      if (!g) { setLoading(false); return }
      setGuardian(g as Guardian)

      // Get linked learners
      const { data: links } = await supabase
        .from('guardian_links')
        .select('*, learner:learners(*)')
        .eq('guardian_id', g.id)

      const views: LearnerView[] = await Promise.all(
        ((links ?? []) as GuardianLink[]).map(async link => {
          const learnerId = link.learner_id

          // Active enrollment
          const { data: en } = await supabase
            .from('learner_enrollments')
            .select('*, learner:learners(*)')
            .eq('learner_id', learnerId)
            .eq('status', 'active')
            .maybeSingle()

          const enrollment = en as LearnerEnrollment | null
          const schoolId   = enrollment?.school_id

          const [{ data: results }, { data: invoices }, { data: attendance }] = await Promise.all([
            schoolId
              ? supabase.from('term_results').select('*').eq('enrollment_id', enrollment!.id).order('created_at', { ascending: false }).limit(6)
              : Promise.resolve({ data: [] }),
            schoolId
              ? supabase.from('fee_invoices').select('*').eq('enrollment_id', enrollment!.id).order('created_at', { ascending: false }).limit(20)
              : Promise.resolve({ data: [] }),
            schoolId
              ? supabase.from('attendance_records').select('*').eq('enrollment_id', enrollment!.id).order('date', { ascending: false }).limit(30)
              : Promise.resolve({ data: [] }),
          ])

          return {
            link,
            enrollment,
            results: (results ?? []) as TermResult[],
            invoices: (invoices ?? []) as FeeInvoice[],
            attendance: (attendance ?? []) as AttendanceRecord[],
          }
        })
      )

      setLearners(views)

      // School alerts (attendance etc.) addressed to this guardian
      const { data: notifs } = await supabase
        .from('guardian_notifications')
        .select('*')
        .eq('guardian_id', g.id)
        .order('created_at', { ascending: false })
        .limit(50)
      setAlerts((notifs ?? []) as GuardianNotification[])

      setLoading(false)
    }
    load()
  }, [guardianEmail])

  const unreadAlerts = alerts.filter(a => !a.is_read).length

  async function openAlerts() {
    setTab('alerts')
    if (unreadAlerts === 0 || !guardian) return
    await supabase
      .from('guardian_notifications')
      .update({ is_read: true })
      .eq('guardian_id', guardian.id)
      .eq('is_read', false)
    setAlerts(prev => prev.map(a => ({ ...a, is_read: true })))
  }

  const current = learners[activeLearner]

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400">Loading…</div>
      </div>
    )
  }

  if (!guardian) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-[440px] text-center bg-white border border-gray-200 rounded-sm p-8">
          <div className="text-base font-bold text-navy-900 mb-2">Not registered</div>
          <div className="text-sm text-gray-500 mb-4">
            Your email <strong>{guardianEmail}</strong> is not linked to any learner.<br />
            Please contact the school to be registered.
          </div>
          <button onClick={onSignOut} className="text-sm text-navy-600 hover:underline">Sign out</button>
        </div>
      </div>
    )
  }

  const STATUS_COLOR: Record<string, string> = {
    present: 'text-green-600', absent: 'text-red-500', late: 'text-yellow-600', excused: 'text-blue-500'
  }

  const FEE_COLOR: Record<string, string> = {
    unpaid: 'text-red-600', partial: 'text-yellow-600', paid: 'text-green-600', waived: 'text-gray-400'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-navy-900 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-white font-bold text-sm">Regent OS Parent Portal</div>
          <div className="text-navy-400 text-xs mt-0.5">{guardianEmail}</div>
        </div>
        <button onClick={onSignOut} className="text-navy-400 hover:text-white text-xs">Sign out</button>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Learner switcher */}
        {learners.length > 1 && (
          <div className="flex gap-2">
            {learners.map((v, i) => (
              <button
                key={v.link.id}
                onClick={() => setActiveLearner(i)}
                className={cn(
                  'px-4 py-2 rounded-sm border text-sm font-semibold transition-colors',
                  i === activeLearner ? 'bg-navy-900 text-white border-navy-900' : 'bg-white border-gray-200 text-navy-700 hover:border-navy-400'
                )}
              >
                {(v.link as any).learner?.first_name} {(v.link as any).learner?.last_name}
              </button>
            ))}
          </div>
        )}

        {!current ? (
          <Card className="py-16 text-center text-sm text-gray-400">No learners linked to this account.</Card>
        ) : (
          <>
            {/* Learner info */}
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 font-bold text-lg">
                  {(current.link as any).learner?.first_name?.[0]}{(current.link as any).learner?.last_name?.[0]}
                </div>
                <div>
                  <div className="text-lg font-bold text-navy-900">
                    {(current.link as any).learner?.first_name} {(current.link as any).learner?.last_name}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {current.enrollment?.stage?.toUpperCase()} · {current.enrollment ? 'Active' : 'No active enrollment'}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-xs text-gray-400">Learner ID</div>
                  <div className="text-sm font-mono font-semibold text-navy-800">{(current.link as any).learner?.learner_id}</div>
                </div>
              </div>
            </Card>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200">
              {(['results','fees','attendance','alerts'] as Tab[]).map(t => (
                <button key={t} onClick={() => t === 'alerts' ? openAlerts() : setTab(t)}
                  className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 -mb-px transition-colors ${
                    tab === t ? 'border-navy-800 text-navy-900' : 'border-transparent text-gray-400 hover:text-navy-700'}`}>
                  {t === 'results' ? 'Results' : t === 'fees' ? 'Fees' : t === 'attendance' ? 'Attendance' : 'Alerts'}
                  {t === 'alerts' && unreadAlerts > 0 && (
                    <span className="ml-1.5 text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5">{unreadAlerts}</span>
                  )}
                </button>
              ))}
            </div>

            {tab === 'results' && (
              <div className="space-y-4">
                {current.results.length === 0 ? (
                  <Card className="py-12 text-center text-sm text-gray-400">No results available yet.</Card>
                ) : current.results.map(r => (
                  <Card key={r.id}>
                    <CardHeader
                      title={`${r.academic_session} — Term ${r.term}`}
                      meta={r.status === 'published' ? 'Published' : 'Draft'}
                    />
                    {r.scores && Object.keys(r.scores).length > 0 ? (
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            {['Subject', 'CA', 'Exam', 'Total', 'Grade'].map(h => (
                              <th key={h} className="px-5 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-widest uppercase text-gray-500 text-left">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(r.scores).map(([subject, scores]) => {
                            const total = scores.total ?? (scores.ca + scores.exam)
                            const grade = total >= 75 ? 'A' : total >= 65 ? 'B' : total >= 55 ? 'C' : total >= 45 ? 'D' : total >= 40 ? 'E' : 'F'
                            return (
                              <tr key={subject} className="border-b border-gray-50">
                                <td className="px-5 py-2.5 text-sm text-navy-900">{subject}</td>
                                <td className="px-5 py-2.5 text-sm text-gray-600">{scores.ca}</td>
                                <td className="px-5 py-2.5 text-sm text-gray-600">{scores.exam}</td>
                                <td className="px-5 py-2.5 text-sm font-bold text-navy-900">{total}</td>
                                <td className="px-5 py-2.5 text-sm font-bold text-amber-600">{grade}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div className="px-5 py-6 text-sm text-gray-400">No score data entered yet.</div>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {tab === 'fees' && (
              <Card>
                <CardHeader title="Fee Status" />
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['Description', 'Amount Due', 'Paid', 'Balance', 'Status'].map(h => (
                        <th key={h} className="px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-widest uppercase text-gray-500 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current.invoices.map(inv => (
                      <tr key={inv.id} className="border-b border-gray-50">
                        <td className="px-5 py-3 text-sm text-navy-900">{inv.description}</td>
                        <td className="px-5 py-3 text-sm font-semibold text-navy-900">₦{inv.amount_due.toLocaleString()}</td>
                        <td className="px-5 py-3 text-sm text-green-600">₦{inv.amount_paid.toLocaleString()}</td>
                        <td className="px-5 py-3 text-sm font-semibold text-red-500">₦{(inv.amount_due - inv.amount_paid).toLocaleString()}</td>
                        <td className="px-5 py-3">
                          <span className={`text-xs font-bold uppercase ${FEE_COLOR[inv.status]}`}>{inv.status}</span>
                        </td>
                      </tr>
                    ))}
                    {current.invoices.length === 0 && (
                      <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">No fee invoices yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </Card>
            )}

            {tab === 'alerts' && (
              <Card>
                <CardHeader title="School Alerts" meta="Attendance and other notices" />
                <div className="divide-y divide-gray-50">
                  {alerts.map(a => (
                    <div key={a.id} className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'w-1.5 h-1.5 rounded-full flex-shrink-0',
                          a.type === 'alert' ? 'bg-red-500' : a.type === 'warning' ? 'bg-yellow-500' : 'bg-blue-400'
                        )} />
                        <span className="text-sm font-semibold text-navy-900">{a.title}</span>
                        <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">
                          {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                      {a.body && <div className="text-xs text-gray-500 mt-1 ml-3.5">{a.body}</div>}
                    </div>
                  ))}
                  {alerts.length === 0 && (
                    <div className="px-5 py-8 text-center text-sm text-gray-400">No alerts yet.</div>
                  )}
                </div>
              </Card>
            )}

            {tab === 'attendance' && (
              <Card>
                <CardHeader title="Attendance Record" meta="Last 30 days" />
                <div className="divide-y divide-gray-50">
                  {current.attendance.map(att => (
                    <div key={att.id} className="px-5 py-3 flex items-center justify-between">
                      <span className="text-sm text-navy-800">{att.date}</span>
                      <span className={`text-xs font-bold uppercase ${STATUS_COLOR[att.status]}`}>{att.status}</span>
                    </div>
                  ))}
                  {current.attendance.length === 0 && (
                    <div className="px-5 py-8 text-center text-sm text-gray-400">No attendance records yet.</div>
                  )}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
