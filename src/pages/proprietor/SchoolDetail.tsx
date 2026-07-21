import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, StatCard } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/utils'
import type { AppUser, School, AuditLogEntry } from '../../types'

interface Props { appUser: AppUser }

export default function ProprietorSchoolDetail({ appUser: _ }: Props) {
  const { id } = useParams<{ id: string }>()
  const [school, setSchool] = useState<School | null>(null)
  const [events, setEvents] = useState<AuditLogEntry[]>([])
  const [counts, setCounts] = useState({ enrolled: 0, staff: 0 })

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('schools').select('*').eq('id', id).single(),
      supabase.from('audit_log').select('*').eq('school_id', id).order('created_at', { ascending: false }).limit(20),
      // Head-count spans both models: K-12 pupils in learner_enrollments,
      // tertiary students in students (institution_id).
      supabase.from('learner_enrollments').select('id', { count: 'exact', head: true }).eq('school_id', id).eq('status', 'active'),
      supabase.from('students').select('id', { count: 'exact', head: true }).eq('institution_id', id).eq('status', 'active'),
      supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('school_id', id).eq('is_active', true),
    ]).then(([{ data: s }, { data: ev }, { count: enrolledK12 }, { count: enrolledTert }, { count: staff }]) => {
      setSchool(s as School)
      setEvents((ev ?? []) as AuditLogEntry[])
      setCounts({ enrolled: (enrolledK12 ?? 0) + (enrolledTert ?? 0), staff: staff ?? 0 })
    })
  }, [id])

  if (!school) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  return (
    <>
      <Topbar title={school.name} meta="School detail — view only" />

      <div className="p-8 space-y-6">
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Active Learners" value={counts.enrolled} sub="Currently enrolled" accent="amber" />
          <StatCard label="Staff Members" value={counts.staff} sub="Active memberships" accent="blue" />
          <StatCard label="Stages Offered" value={school.stages_offered?.length ?? 0} sub="Education stages" accent="green" />
          <StatCard label="Tier" value={school.tier_id.toUpperCase()} sub="Subscription tier" accent="yellow" />
        </div>

        <Card>
          <CardHeader title="School Info" />
          <div className="px-5 py-4 grid grid-cols-2 gap-6">
            <div>
              <div className="label mb-1">Stages Offered</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {school.stages_offered?.map(s => (
                  <Badge key={s} label={s.toUpperCase()} bg="bg-navy-100" text="text-navy-800" />
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-1">Status</div>
              <Badge
                label={school.is_active ? 'Active' : 'Inactive'}
                bg={school.is_active ? 'bg-green-100' : 'bg-red-100'}
                text={school.is_active ? 'text-green-700' : 'text-red-700'}
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent Audit Events" meta="Read-only" />
          <div className="divide-y divide-gray-50">
            {events.length === 0 ? (
              <div className="px-5 py-6 text-sm text-gray-400">No events recorded yet.</div>
            ) : events.map(ev => (
              <div key={ev.id} className="px-5 py-3 flex items-start gap-3">
                <span className="w-2 h-2 rounded-full bg-navy-600 flex-shrink-0 mt-1.5" />
                <div>
                  <div className="text-sm font-semibold text-navy-900">{ev.action_type}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {ev.audit_ref} · {ev.actor_office.replace(/_/g, ' ')} · {formatDateTime(ev.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}
