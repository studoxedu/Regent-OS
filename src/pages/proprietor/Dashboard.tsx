import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Topbar } from '../../components/layout/Topbar'
import { StatCard, Card, CardHeader, Alert } from '../../components/ui/Card'
import { StageBadge } from '../../components/ui/Badge'
import { supabase } from '../../lib/supabase'
import { formatDateTime, formatNaira } from '../../lib/utils'
import type { AppUser, School, AuditLogEntry } from '../../types'

interface Props { appUser: AppUser }

interface SchoolSummary extends School {
  enrolledCount: number
  feeTotal: number
}

export default function ProprietorDashboard({ appUser }: Props) {
  const groupId = appUser.activeGroup?.id ?? ''
  const [schools, setSchools] = useState<SchoolSummary[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditLogEntry[]>([])
  const [totals, setTotals] = useState({ learners: 0, feesCollected: 0, auditWeek: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!groupId) return
    async function load() {
      const { data: schoolsData } = await supabase
        .from('schools')
        .select('*')
        .eq('group_id', groupId)
        .eq('is_active', true)

      const summaries: SchoolSummary[] = await Promise.all(
        (schoolsData ?? []).map(async (school: School) => {
          // Tertiary students live in `students` (by institution_id); K-12 pupils
          // live in `learner_enrollments` (by school_id).
          const isTertiary = school.stages_offered.some(s => ['nd', 'hnd', 'nce', 'degree'].includes(s))
          const { count: enrolled } = isTertiary
            ? await supabase
                .from('students')
                .select('id', { count: 'exact', head: true })
                .eq('institution_id', school.id)
                .eq('status', 'active')
            : await supabase
                .from('learner_enrollments')
                .select('id', { count: 'exact', head: true })
                .eq('school_id', school.id)
                .eq('status', 'active')

          // Fees live in fee_invoices for both K-12 and tertiary (the legacy
          // fee_records table is unused/empty). Sum server-side via the RPC so
          // we're not capped by PostgREST's 1000-row default on large schools.
          const { data: feeData } = await supabase.rpc('k12_fee_totals', { p_school_id: school.id })
          const feeTotal = Number((feeData?.[0] as { total_paid?: number | string } | undefined)?.total_paid ?? 0)

          return { ...school, enrolledCount: enrolled ?? 0, feeTotal }
        })
      )

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const schoolIds = summaries.map(s => s.id)

      const { data: events } = await supabase
        .from('audit_log')
        .select('*')
        .in('school_id', schoolIds.length ? schoolIds : ['no-school'])
        .order('created_at', { ascending: false })
        .limit(8)

      const { count: weekCount } = await supabase
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .in('school_id', schoolIds.length ? schoolIds : ['no-school'])
        .gte('created_at', weekAgo)

      setSchools(summaries)
      setAuditEvents((events ?? []) as AuditLogEntry[])
      setTotals({
        learners: summaries.reduce((s, sc) => s + sc.enrolledCount, 0),
        feesCollected: summaries.reduce((s, sc) => s + sc.feeTotal, 0),
        auditWeek: weekCount ?? 0,
      })
      setLoading(false)
    }
    load()
  }, [groupId])

  return (
    <>
      <Topbar
        title={`Group Dashboard — ${appUser.activeGroup?.name ?? ''}`}
        meta="View only"
      />

      <div className="p-8 space-y-6">
        <Alert type="info">
          <strong>View-only mode.</strong> This office cannot write, approve, or trigger any action across any institution in this group. All data is real-time from the live database.
        </Alert>

        {/* Group totals */}
        <div>
          <div className="label mb-4">Group Totals</div>
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Total Learners"     value={totals.learners}                    sub="Across all schools"     accent="amber" />
            <StatCard label="Fees Collected"      value={formatNaira(totals.feesCollected)}  sub="All schools combined"   accent="green" />
            <StatCard label="Audit Events (Week)" value={totals.auditWeek}                   sub="All write actions"      accent="blue" />
            <StatCard label="Schools"             value={schools.length}                     sub="Active institutions"    accent="yellow" />
          </div>
        </div>

        {/* Per-school cards */}
        <div>
          <div className="label mb-4">Per-Institution Snapshot</div>
          <div className={`grid gap-4 ${schools.length === 3 ? 'grid-cols-3' : schools.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {loading ? (
              <div className="col-span-3 text-sm text-gray-400">Loading…</div>
            ) : schools.map(school => (
              <div key={school.id} className="bg-white border border-gray-200 rounded-sm overflow-hidden">
                <div className="bg-navy-800 px-4 py-3.5 flex items-center justify-between">
                  <span className="text-[13px] font-bold text-white">{school.name}</span>
                  <div className="flex gap-1">
                    {school.stages_offered.map(s => <StageBadge key={s} stage={s} />)}
                  </div>
                </div>
                <div className="divide-y divide-gray-50">
                  {[
                    { label: 'Enrolled learners', value: school.enrolledCount.toLocaleString() },
                    { label: 'Fees collected',     value: formatNaira(school.feeTotal) },
                    { label: 'Governance mode',    value: school.stages_offered.some(s => ['nd','hnd','nce','degree'].includes(s)) ? 'Tertiary' : 'K12' },
                    { label: 'Tier',               value: school.tier_id.charAt(0).toUpperCase() + school.tier_id.slice(1) },
                  ].map(row => (
                    <div key={row.label} className="px-4 py-2.5 flex justify-between text-sm">
                      <span className="text-gray-500">{row.label}</span>
                      <span className="font-semibold text-navy-900">{row.value}</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 border-t border-gray-200 text-right">
                  <Link
                    to={`/proprietor/school/${school.id}`}
                    className="text-xs font-semibold text-navy-700 hover:underline"
                  >
                    Drill into school →
                  </Link>
                </div>
              </div>
            ))}
            {!loading && schools.length === 0 && (
              <div className="col-span-3 text-sm text-gray-400 text-center py-10">
                No schools in this group yet.
              </div>
            )}
          </div>
        </div>

        {/* Group audit stream */}
        <Card>
          <CardHeader title="Recent Audit Activity — Group-wide" meta="Read-only view" />
          <div className="divide-y divide-gray-50">
            {auditEvents.map(ev => (
              <div key={ev.id} className="px-5 py-3 flex gap-3 items-start">
                <span className="w-2 h-2 rounded-full bg-navy-600 flex-shrink-0 mt-1.5" />
                <div>
                  <div className="text-sm font-semibold text-navy-900">{ev.action_type}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {ev.actor_office.replace(/_/g, ' ')} · {formatDateTime(ev.created_at)}
                  </div>
                </div>
              </div>
            ))}
            {!loading && auditEvents.length === 0 && (
              <div className="px-5 py-8 text-sm text-gray-400 text-center">No activity yet.</div>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}
