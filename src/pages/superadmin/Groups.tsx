import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { AppUser } from '../../types'

interface Group {
  id: string
  name: string
  created_at: string
}

interface SchoolSummary {
  id: string
  name: string
  is_active: boolean
  institution_type: string | null
}

interface ProprietorInfo {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  membership_id: string
}

interface GroupDetail {
  group: Group
  schools: SchoolSummary[]
  proprietors: ProprietorInfo[]
}

const PROPRIETOR_OFFICE_ID = 'daec46e4-4362-43e9-9357-576f70315a8b'

export default function SuperAdminGroups({ appUser: _ }: { appUser: AppUser }) {
  const [details,  setDetails]  = useState<GroupDetail[]>([])
  const [loading,  setLoading]  = useState(true)
  const [toast,    setToast]    = useState<{ msg: string; ok: boolean } | null>(null)

  // New group modal
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [savingGroup,  setSavingGroup]  = useState(false)

  // Assign proprietor modal
  const [assignTarget,  setAssignTarget]  = useState<Group | null>(null)
  const [propEmail,     setPropEmail]     = useState('')
  const [propResults,   setPropResults]   = useState<{ id: string; email: string; first_name: string | null; last_name: string | null }[]>([])
  const [savingProp,    setSavingProp]    = useState(false)

  function flash(msg: string, ok = true) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data: grpData } = await supabase
      .from('school_groups').select('id, name, created_at').order('name')
    const groups = (grpData ?? []) as Group[]

    const [{ data: schData }, { data: memData }] = await Promise.all([
      supabase.from('schools').select('id, name, is_active, institution_type, group_id'),
      supabase.from('memberships')
        .select('id, group_id, profile_id, profile:profiles!profile_id(id, first_name, last_name, email)')
        .eq('office_id', PROPRIETOR_OFFICE_ID)
        .eq('is_active', true),
    ])

    const schoolsByGroup: Record<string, SchoolSummary[]> = {}
    for (const s of (schData ?? []) as any[]) {
      if (!s.group_id) continue
      if (!schoolsByGroup[s.group_id]) schoolsByGroup[s.group_id] = []
      schoolsByGroup[s.group_id].push(s)
    }

    const propsByGroup: Record<string, ProprietorInfo[]> = {}
    for (const m of (memData ?? []) as any[]) {
      if (!m.group_id) continue
      if (!propsByGroup[m.group_id]) propsByGroup[m.group_id] = []
      const p = m.profile
      if (p) propsByGroup[m.group_id].push({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email,
        membership_id: m.id,
      })
    }

    setDetails(groups.map(g => ({
      group:       g,
      schools:     schoolsByGroup[g.id] ?? [],
      proprietors: propsByGroup[g.id]   ?? [],
    })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function createGroup() {
    if (!newGroupName.trim()) return
    setSavingGroup(true)
    const { error } = await supabase.from('school_groups').insert({ name: newGroupName.trim() })
    setSavingGroup(false)
    if (error) { flash(error.message, false); return }
    flash('Group created.')
    setShowNewGroup(false); setNewGroupName('')
    load()
  }

  async function searchProfiles(q: string) {
    setPropEmail(q)
    if (q.length < 2) { setPropResults([]); return }
    const { data } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .ilike('email', `%${q}%`)
      .limit(5)
    setPropResults(data ?? [])
  }

  async function assignProprietor(profileId: string) {
    if (!assignTarget) return
    setSavingProp(true)
    const { error } = await supabase.from('memberships').insert({
      profile_id: profileId,
      group_id:   assignTarget.id,
      school_id:  null,
      office_id:  PROPRIETOR_OFFICE_ID,
      is_active:  true,
    })
    setSavingProp(false)
    if (error) {
      flash(error.code === '23505' ? 'Already assigned as proprietor.' : error.message, false)
      return
    }
    flash('Proprietor assigned.')
    setAssignTarget(null); setPropEmail(''); setPropResults([])
    load()
  }

  async function removeProprietor(membershipId: string) {
    await supabase.from('memberships').update({ is_active: false }).eq('id', membershipId)
    flash('Proprietor removed.')
    load()
  }

  function pname(p: { first_name: string | null; last_name: string | null; email?: string }) {
    const n = [p.first_name, p.last_name].filter(Boolean).join(' ')
    return n || p.email || '—'
  }

  function typeLabel(s: SchoolSummary) {
    const map: Record<string, string> = {
      university: 'Uni', polytechnic: 'Poly',
      college_of_education: 'COE', monotechnic: 'Mono',
    }
    return s.institution_type ? (map[s.institution_type] ?? s.institution_type) : 'K12'
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-[0.18em] mb-1">Super Admin</div>
          <h1 className="text-[20px] font-bold text-navy-900">School Groups</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Manage proprietor-owned chains of institutions.
          </p>
        </div>
        <button onClick={() => setShowNewGroup(true)}
          className="px-4 py-2 bg-navy-900 text-white text-[12px] font-bold rounded hover:bg-navy-800 cursor-pointer">
          + New Group
        </button>
      </div>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded text-[13px] border ${
          toast.ok
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-600'
        }`}>
          {toast.msg}
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-gray-400">Loading…</p>
      ) : details.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl">
          <div className="text-[13px] text-gray-400">No groups yet.</div>
          <div className="text-[11px] text-gray-300 mt-1">Create a group to link schools under one proprietor.</div>
        </div>
      ) : (
        <div className="space-y-4">
          {details.map(({ group, schools, proprietors }) => (
            <div key={group.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* Group header */}
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="text-[15px] font-bold text-navy-900">{group.name}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5 font-mono">{group.id.slice(0, 8)}…</div>
                </div>
                <button
                  onClick={() => { setAssignTarget(group); setPropEmail(''); setPropResults([]) }}
                  className="text-[11px] font-semibold text-navy-700 border border-navy-200 px-2.5 py-1 rounded cursor-pointer hover:bg-navy-50">
                  + Assign Proprietor
                </button>
              </div>

              <div className="grid grid-cols-2 divide-x divide-gray-100">
                {/* Schools */}
                <div className="px-5 py-4">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Schools ({schools.length})
                  </div>
                  {schools.length === 0 ? (
                    <div className="text-[12px] text-gray-300">No schools in this group.</div>
                  ) : schools.map(s => (
                    <div key={s.id} className="flex items-center gap-2 py-1">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        s.is_active ? 'bg-green-500' : 'bg-gray-300'
                      }`} />
                      <span className="text-[13px] text-navy-800 font-semibold truncate flex-1">{s.name}</span>
                      <span className="text-[10px] text-gray-400">{typeLabel(s)}</span>
                    </div>
                  ))}
                </div>

                {/* Proprietors */}
                <div className="px-5 py-4">
                  <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Proprietors ({proprietors.length})
                  </div>
                  {proprietors.length === 0 ? (
                    <div className="text-[12px] text-gray-300">No proprietors assigned.</div>
                  ) : proprietors.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-1">
                      <div>
                        <div className="text-[13px] font-semibold text-navy-900">{pname(p)}</div>
                        <div className="text-[11px] text-gray-400">{p.email}</div>
                      </div>
                      <button
                        onClick={() => removeProprietor(p.membership_id)}
                        className="text-gray-300 hover:text-red-400 text-xs cursor-pointer ml-2">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Group modal */}
      {showNewGroup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-4">New School Group</h2>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Group Name</label>
              <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} autoFocus
                placeholder="e.g. Greenfield Schools Nigeria"
                onKeyDown={e => e.key === 'Enter' && createGroup()}
                className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy-300" />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowNewGroup(false)}
                className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={createGroup} disabled={savingGroup || !newGroupName.trim()}
                className="px-4 py-1.5 bg-navy-900 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-navy-800 disabled:opacity-50">
                {savingGroup ? 'Creating…' : 'Create Group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Proprietor modal */}
      {assignTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-1">Assign Proprietor</h2>
            <p className="text-[13px] text-gray-500 mb-4">
              {assignTarget.name} — the person must already have a Regent OS account.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Search by email
                </label>
                <input value={propEmail} onChange={e => searchProfiles(e.target.value)} autoFocus
                  placeholder="Type email to search…"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy-300" />
              </div>
              {propResults.length > 0 && (
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  {propResults.map(p => (
                    <button key={p.id} onClick={() => assignProprietor(p.id)} disabled={savingProp}
                      className="w-full text-left px-4 py-2.5 hover:bg-navy-50 border-b border-gray-50 last:border-0 transition-colors cursor-pointer">
                      <div className="text-[13px] font-semibold text-navy-900">{pname(p)}</div>
                      <div className="text-[11px] text-gray-400">{p.email}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => { setAssignTarget(null); setPropEmail(''); setPropResults([]) }}
                className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
