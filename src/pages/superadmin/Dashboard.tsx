import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { AppUser } from '../../types'

interface Stats {
  totalSchools: number
  activeSchools: number
  totalGroups: number
  totalUsers: number
}

interface SchoolRow {
  id: string
  name: string
  is_active: boolean
  institution_type: string | null
  stages_offered: string[]
  tier_id: string
  group_id: string | null
  created_at: string
}

export default function SuperAdminDashboard({ appUser: _ }: { appUser: AppUser }) {
  const [stats,   setStats]   = useState<Stats | null>(null)
  const [schools, setSchools] = useState<SchoolRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: sch }, { data: grp }, { data: prof }] = await Promise.all([
        supabase.from('schools').select('id, name, is_active, institution_type, stages_offered, tier_id, group_id, created_at').order('created_at', { ascending: false }),
        supabase.from('school_groups').select('id'),
        supabase.from('profiles').select('id'),
      ])
      const schList = (sch ?? []) as SchoolRow[]
      setSchools(schList)
      setStats({
        totalSchools:  schList.length,
        activeSchools: schList.filter(s => s.is_active).length,
        totalGroups:   (grp ?? []).length,
        totalUsers:    (prof ?? []).length,
      })
      setLoading(false)
    }
    load()
  }, [])

  function typeLabel(s: SchoolRow): string {
    if (s.institution_type) {
      const map: Record<string, string> = {
        university:           'University',
        polytechnic:          'Polytechnic',
        college_of_education: 'College of Edu.',
        monotechnic:          'Monotechnic',
      }
      return map[s.institution_type] ?? s.institution_type
    }
    const stages = s.stages_offered ?? []
    if (stages.some((s: string) => ['jss','sss'].includes(s))) return 'Secondary'
    if (stages.includes('primary')) return 'Primary'
    if (stages.includes('nursery')) return 'Nursery'
    return 'K12'
  }

  if (loading) {
    return <div className="p-8 text-[13px] text-gray-400">Loading…</div>
  }

  const statCards = [
    { label: 'Total Schools',  value: stats?.totalSchools  ?? 0, to: '/superadmin/schools' },
    { label: 'Active Schools', value: stats?.activeSchools ?? 0, to: '/superadmin/schools' },
    { label: 'School Groups',  value: stats?.totalGroups   ?? 0, to: '/superadmin/groups'  },
    { label: 'Platform Users', value: stats?.totalUsers    ?? 0, to: null                  },
  ]

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <div className="text-[10px] text-gray-400 uppercase tracking-[0.18em] mb-1">Super Admin</div>
        <h1 className="text-[24px] font-black text-navy-900 leading-tight">
          Platform Overview
        </h1>
        <p className="text-[13px] text-gray-500 mt-1">
          Regent OS operator console — onboard institutions, manage groups, configure access.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {statCards.map(c => (
          <div key={c.label}
            className="bg-white border border-gray-200 rounded-xl px-5 py-4">
            <div className="text-[28px] font-black text-navy-900">{c.value}</div>
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mt-0.5">
              {c.label}
            </div>
            {c.to && (
              <Link to={c.to} className="text-[11px] text-amber-600 hover:underline mt-2 block font-semibold">
                Manage →
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 mb-8">
        <Link to="/superadmin/schools"
          className="px-4 py-2 bg-navy-900 text-white text-[12px] font-bold rounded hover:bg-navy-800 transition-colors">
          + Onboard School
        </Link>
        <Link to="/superadmin/groups"
          className="px-4 py-2 bg-white border border-navy-300 text-navy-900 text-[12px] font-bold rounded hover:bg-navy-50 transition-colors">
          + New Group
        </Link>
      </div>

      {/* Schools table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <div className="text-[13px] font-bold text-navy-900">All Schools</div>
          <Link to="/superadmin/schools"
            className="text-[11px] text-navy-600 hover:underline font-semibold">
            Manage all →
          </Link>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-5 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Name</th>
              <th className="text-left px-5 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Type</th>
              <th className="text-left px-5 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Tier</th>
              <th className="text-left px-5 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
              <th className="text-left px-5 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Created</th>
            </tr>
          </thead>
          <tbody>
            {schools.map(s => (
              <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                <td className="px-5 py-3 font-semibold text-navy-900">{s.name}</td>
                <td className="px-5 py-3 text-gray-500">{typeLabel(s)}</td>
                <td className="px-5 py-3 text-gray-500 capitalize">{s.tier_id}</td>
                <td className="px-5 py-3">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                    s.is_active
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-gray-50 text-gray-500 border-gray-200'
                  }`}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-5 py-3 text-gray-400 text-[12px]">
                  {new Date(s.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
