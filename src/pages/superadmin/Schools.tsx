import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { K12_OFFICES, K12_OFFICE_LABELS } from '../../lib/roles'
import type { AppUser } from '../../types'

interface SchoolRow {
  id: string
  name: string
  is_active: boolean
  institution_type: string | null
  stages_offered: string[]
  tier_id: string
  group_id: string | null
  created_at: string
  group_name?: string
}

interface Group { id: string; name: string }

const SCHOOL_PRESETS = [
  { label: 'Secondary School',     stages: ['jss', 'sss'],  institution_type: null          },
  { label: 'Primary School',       stages: ['primary'],     institution_type: null          },
  { label: 'Nursery/Primary',      stages: ['nursery', 'primary'], institution_type: null   },
  { label: 'University',           stages: ['degree'],      institution_type: 'university'  },
  { label: 'Polytechnic (ND/HND)', stages: ['nd', 'hnd'],   institution_type: 'polytechnic' },
  { label: 'College of Education', stages: ['nce'],         institution_type: 'college_of_education' },
  { label: 'Monotechnic',          stages: ['nd'],          institution_type: 'monotechnic' },
]

// K-12 offices seedable as a first admin (central list); Head Teacher first
const K12_ADMIN_ROLES: Record<string, string> = Object.fromEntries(
  K12_OFFICES.map(o => [o, K12_OFFICE_LABELS[o]])
)

const TERTIARY_ADMIN_ROLES: Record<string, string> = {
  school_admin:       'School Administrator',
  registrar:          'Registrar',
  senate_secretary:   'Senate Secretary',
  finance_officer:    'Finance Officer',
  hr_officer:         'HR Officer',
  dean:               'Dean',
  hod:                'Head of Department',
  lecturer:           'Lecturer',
  exam_officer:       'Examinations Officer',
  timetable_officer:  'Timetable Officer',
  library_officer:    'Library Officer',
  admissions_officer: 'Admissions Officer',
}

function isK12School(s: { institution_type: string | null }): boolean {
  return !s.institution_type
}

interface SeedCredential {
  email: string
  is_new_user: boolean
  temp_password: string | null
}

export default function SuperAdminSchools({ appUser: _ }: { appUser: AppUser }) {
  const [schools,  setSchools]  = useState<SchoolRow[]>([])
  const [groups,   setGroups]   = useState<Group[]>([])
  const [loading,  setLoading]  = useState(true)
  const [toast,    setToast]    = useState<{ msg: string; ok: boolean } | null>(null)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [newName,    setNewName]    = useState('')
  const [newPreset,  setNewPreset]  = useState(0)
  const [newTier,    setNewTier]    = useState<'pilot' | 'standard'>('pilot')
  const [newGroup,   setNewGroup]   = useState('')
  const [saving,     setSaving]     = useState(false)

  // Seed First Admin modal
  const [seedingSchool, setSeedingSchool] = useState<SchoolRow | null>(null)
  const [seedForm, setSeedForm] = useState({ firstName: '', lastName: '', email: '', role: '', password: '' })
  const [seeding,  setSeeding]  = useState(false)
  const [seedError, setSeedError] = useState('')
  const [credential, setCredential] = useState<SeedCredential | null>(null)

  function flash(msg: string, ok = true) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: sch }, { data: grp }] = await Promise.all([
      supabase.from('schools').select('id, name, is_active, institution_type, stages_offered, tier_id, group_id, created_at').order('created_at', { ascending: false }),
      supabase.from('school_groups').select('id, name').order('name'),
    ])
    const grpMap: Record<string, string> = {}
    for (const g of (grp ?? []) as Group[]) grpMap[g.id] = g.name
    setSchools(((sch ?? []) as SchoolRow[]).map(s => ({
      ...s, group_name: s.group_id ? grpMap[s.group_id] : undefined,
    })))
    setGroups((grp ?? []) as Group[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleActive(school: SchoolRow) {
    const { error } = await supabase
      .from('schools').update({ is_active: !school.is_active }).eq('id', school.id)
    if (error) { flash(error.message, false); return }
    flash(`${school.name} ${school.is_active ? 'deactivated' : 'activated'}.`)
    load()
  }

  async function createSchool() {
    if (!newName.trim()) return
    setSaving(true)
    const preset = SCHOOL_PRESETS[newPreset]
    const { error } = await supabase.from('schools').insert({
      name:             newName.trim(),
      stages_offered:   preset.stages,
      institution_type: preset.institution_type,
      tier_id:          newTier,
      is_active:        true,
      modules_included: [],
      group_id:         newGroup || null,
    })
    setSaving(false)
    if (error) { flash(error.message, false); return }
    flash('School created.')
    setShowCreate(false); setNewName(''); setNewGroup(''); setNewPreset(0)
    load()
  }

  function openSeed(school: SchoolRow) {
    const roles = isK12School(school) ? K12_ADMIN_ROLES : TERTIARY_ADMIN_ROLES
    setSeedForm({ firstName: '', lastName: '', email: '', role: Object.keys(roles)[0], password: '' })
    setSeedError('')
    setSeedingSchool(school)
  }

  async function handleSeedAdmin() {
    if (!seedingSchool) return
    if (!seedForm.firstName.trim() || !seedForm.lastName.trim() || !seedForm.email.trim()) {
      setSeedError('First name, last name and email are required.'); return
    }
    if (seedForm.password.trim().length < 6) {
      setSeedError('Set a password of at least 6 characters for this staff member.'); return
    }
    setSeeding(true); setSeedError('')
    const { data, error } = await supabase.rpc('create_staff_member', {
      p_email:       seedForm.email.trim().toLowerCase(),
      p_first_name:  seedForm.firstName.trim(),
      p_last_name:   seedForm.lastName.trim(),
      p_office_name: seedForm.role,
      p_school_id:   seedingSchool.id,
      p_password:    seedForm.password.trim(),
    })
    setSeeding(false)
    if (error) { setSeedError(error.message); return }
    setCredential({ email: data.email, is_new_user: data.is_new_user, temp_password: data.temp_password })
    setSeedingSchool(null)
    flash(`Staff member added to ${seedingSchool.name}.`)
  }

  function typeLabel(s: SchoolRow): string {
    if (s.institution_type) {
      const map: Record<string, string> = {
        university: 'University', polytechnic: 'Polytechnic',
        college_of_education: 'College of Edu.', monotechnic: 'Monotechnic',
      }
      return map[s.institution_type] ?? s.institution_type
    }
    const stages = s.stages_offered ?? []
    if (stages.some(s => ['jss','sss'].includes(s))) return 'Secondary'
    if (stages.includes('primary')) return 'Primary'
    if (stages.includes('nursery')) return 'Nursery'
    return 'K12'
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="text-[10px] text-gray-400 uppercase tracking-[0.18em] mb-1">Super Admin</div>
          <h1 className="text-[20px] font-bold text-navy-900">Schools</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">Onboard and manage all institutions on the platform.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-navy-900 text-white text-[12px] font-bold rounded hover:bg-navy-800 cursor-pointer">
          + Onboard School
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

      {/* Credential banner — shown once after seeding a first admin */}
      {credential && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-5">
          <div className="flex justify-between items-start">
            <div className="space-y-2">
              <div className="text-sm font-bold text-green-800">
                {credential.is_new_user ? 'Admin account created' : 'Role assigned to existing user'}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-green-600 uppercase tracking-widest mb-1">Email</div>
                  <div className="font-mono text-green-800 text-sm">{credential.email}</div>
                </div>
                {credential.temp_password && (
                  <div>
                    <div className="text-[10px] text-green-600 uppercase tracking-widest mb-1">Temp Password</div>
                    <div className="font-mono font-bold text-green-900 text-sm tracking-widest">{credential.temp_password}</div>
                  </div>
                )}
              </div>
              {credential.temp_password && (
                <div className="text-xs text-green-600">Share these credentials with the admin. The password is shown once only.</div>
              )}
            </div>
            <button onClick={() => setCredential(null)} className="text-green-400 hover:text-green-700 text-lg ml-4 cursor-pointer">×</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-gray-400">Loading…</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">School</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Type</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Tier</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Group</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {schools.map(s => (
                <tr key={s.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-navy-900">{s.name}</div>
                    <div className="text-[11px] text-gray-400 font-mono mt-0.5">{s.id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-5 py-3 text-gray-500">{typeLabel(s)}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                      s.tier_id === 'pilot' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                    }`}>
                      {s.tier_id}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-[12px]">
                    {s.group_name ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => toggleActive(s)}
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                        s.is_active
                          ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                          : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {s.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-gray-400 text-[12px]">
                    {new Date(s.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => openSeed(s)}
                      className="text-[11px] font-semibold text-navy-600 hover:text-navy-900 hover:underline cursor-pointer whitespace-nowrap"
                    >
                      + Add Staff
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create School modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-4">Onboard School</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Institution Name
                </label>
                <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus
                  placeholder="e.g. Greenfield Polytechnic"
                  onKeyDown={e => e.key === 'Enter' && createSchool()}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy-300" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Institution Type
                </label>
                <select value={newPreset} onChange={e => setNewPreset(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy-300">
                  {SCHOOL_PRESETS.map((p, i) => (
                    <option key={i} value={i}>{p.label}</option>
                  ))}
                </select>
                <div className="text-[11px] text-gray-400 mt-1 font-mono">
                  Stages: {SCHOOL_PRESETS[newPreset].stages.join(', ')}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Tier
                </label>
                <select value={newTier} onChange={e => setNewTier(e.target.value as 'pilot' | 'standard')}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy-300">
                  <option value="pilot">Pilot</option>
                  <option value="standard">Standard</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  School Group (optional)
                </label>
                <select value={newGroup} onChange={e => setNewGroup(e.target.value)}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy-300">
                  <option value="">— standalone (no group) —</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={createSchool} disabled={saving || !newName.trim()}
                className="px-4 py-1.5 bg-navy-900 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-navy-800 disabled:opacity-50">
                {saving ? 'Creating…' : 'Create School'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Seed First Admin modal */}
      {seedingSchool && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-1">Add Staff Member</h2>
            <p className="text-[12px] text-gray-500 mb-4">{seedingSchool.name}</p>
            {seedError && (
              <div className="mb-3 px-3 py-2 rounded text-[12px] bg-red-50 border border-red-200 text-red-600">
                {seedError}
              </div>
            )}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    First Name
                  </label>
                  <input value={seedForm.firstName} onChange={e => setSeedForm(f => ({ ...f, firstName: e.target.value }))}
                    autoFocus
                    className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy-300" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Last Name
                  </label>
                  <input value={seedForm.lastName} onChange={e => setSeedForm(f => ({ ...f, lastName: e.target.value }))}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy-300" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Email Address
                </label>
                <input type="email" value={seedForm.email} onChange={e => setSeedForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="admin@school.edu.ng"
                  onKeyDown={e => e.key === 'Enter' && handleSeedAdmin()}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy-300" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Role
                </label>
                <select value={seedForm.role} onChange={e => setSeedForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy-300">
                  {Object.entries(isK12School(seedingSchool) ? K12_ADMIN_ROLES : TERTIARY_ADMIN_ROLES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Password <span className="text-red-400">*</span>
                </label>
                <input type="text" value={seedForm.password}
                  onChange={e => setSeedForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Set a password (min 6 characters)"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy-300" />
              </div>
              <div className="text-[11px] text-gray-400 bg-gray-50 rounded p-3 leading-relaxed">
                The new account is created with the password you set here — share it with the staff member. If the email already exists, this role is added to their account and the password is unchanged.
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setSeedingSchool(null)}
                className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSeedAdmin} disabled={seeding || !seedForm.firstName.trim() || !seedForm.lastName.trim() || !seedForm.email.trim() || seedForm.password.trim().length < 6}
                className="px-4 py-1.5 bg-navy-900 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-navy-800 disabled:opacity-50">
                {seeding ? 'Adding…' : 'Add Staff'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
