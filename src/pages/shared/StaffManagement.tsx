import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select, Field } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { isK12Office, K12_OFFICES, K12_OFFICE_LABELS } from '../../lib/roles'
import type { AppUser, Membership } from '../../types'

interface Props { appUser: AppUser }

interface SalaryGrade { id: string; name: string; basic_pay: number }
interface StaffProfile {
  id?: string
  membership_id: string
  designation: string | null
  qualification: string | null
  employment_type: string
  salary_grade_id: string | null
  start_date: string | null
}

interface StaffCredential {
  email: string
  is_new_user: boolean
  temp_password: string | null
}

const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'contract',  label: 'Contract' },
]

// Roles a K-12 school can assign to new staff (from the central list)
const K12_ROLES = K12_OFFICES as readonly string[]

export default function StaffManagement({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''
  const isK12    = isK12Office(appUser.activeMembership?.office?.name ?? '')

  const [staff, setStaff]         = useState<Membership[]>([])
  const [profiles, setProfiles]   = useState<Record<string, StaffProfile>>({})
  const [grades, setGrades]       = useState<SalaryGrade[]>([])
  const [loading, setLoading]     = useState(true)
  const [editId, setEditId]       = useState<string | null>(null)
  const [draft, setDraft]         = useState<Partial<StaffProfile>>({})
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Grade form
  const [showGradeForm, setShowGradeForm]   = useState(false)
  const [gradeName, setGradeName]           = useState('')
  const [gradeBasic, setGradeBasic]         = useState('')
  const [savingGrade, setSavingGrade]       = useState(false)

  // Add Staff (K12 onboarding)
  const [showAdd,    setShowAdd]    = useState(false)
  const [addForm,    setAddForm]    = useState({ firstName: '', lastName: '', email: '', role: K12_ROLES[0] })
  const [adding,     setAdding]     = useState(false)
  const [addError,   setAddError]   = useState('')
  const [credential, setCredential] = useState<StaffCredential | null>(null)

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  async function loadAll() {
    const studentOfficeName = 'student'
    const [{ data: mems }, { data: profs }, { data: gs }] = await Promise.all([
      supabase.from('memberships').select('*, office:offices(*), profile:profiles(*)')
        .eq('school_id', schoolId).eq('is_active', true).order('created_at'),
      supabase.from('staff_profiles').select('*').eq('school_id', schoolId),
      supabase.from('salary_grades').select('*').eq('school_id', schoolId).order('basic_pay'),
    ])

    const staffMems = ((mems ?? []) as Membership[]).filter(m => m.office?.name !== studentOfficeName)
    setStaff(staffMems)

    const profMap: Record<string, StaffProfile> = {}
    for (const p of (profs ?? []) as StaffProfile[]) profMap[p.membership_id] = p
    setProfiles(profMap)

    setGrades((gs ?? []) as SalaryGrade[])
    setLoading(false)
  }

  useEffect(() => { if (schoolId) loadAll() }, [schoolId])

  function startEdit(m: Membership) {
    const existing = profiles[m.id]
    setDraft({
      membership_id:    m.id,
      designation:      existing?.designation ?? '',
      qualification:    existing?.qualification ?? '',
      employment_type:  existing?.employment_type ?? 'full_time',
      salary_grade_id:  existing?.salary_grade_id ?? '',
      start_date:       existing?.start_date ?? '',
    })
    setEditId(m.id)
  }

  async function saveProfile() {
    if (!editId) return
    setSaving(true)
    const existing = profiles[editId]
    const payload = {
      membership_id:   editId,
      school_id:       schoolId,
      designation:     (draft.designation as string)?.trim() || null,
      qualification:   (draft.qualification as string)?.trim() || null,
      employment_type: draft.employment_type ?? 'full_time',
      salary_grade_id: draft.salary_grade_id || null,
      start_date:      draft.start_date || null,
    }
    if (existing?.id) {
      await supabase.from('staff_profiles').update(payload).eq('id', existing.id)
    } else {
      await supabase.from('staff_profiles').insert(payload)
    }
    setSaving(false)
    setEditId(null)
    flash('Profile saved.')
    loadAll()
  }

  async function addGrade() {
    if (!gradeName.trim() || !gradeBasic) return
    setSavingGrade(true)
    const { error } = await supabase.from('salary_grades').insert({
      school_id: schoolId,
      name:      gradeName.trim(),
      basic_pay: parseFloat(gradeBasic),
    })
    setSavingGrade(false)
    if (error) { flash(error.message, 'error'); return }
    setGradeName(''); setGradeBasic(''); setShowGradeForm(false)
    flash('Salary grade added.')
    loadAll()
  }

  function gradeLabel(gradeId: string | null) {
    if (!gradeId) return '—'
    const g = grades.find(g => g.id === gradeId)
    return g ? `${g.name} (₦${Number(g.basic_pay).toLocaleString('en-NG')})` : '—'
  }

  async function handleAddStaff() {
    if (!addForm.firstName.trim() || !addForm.lastName.trim() || !addForm.email.trim()) {
      setAddError('First name, last name and email are required.'); return
    }
    setAdding(true); setAddError('')
    const { data, error } = await supabase.rpc('create_staff_member', {
      p_email:       addForm.email.trim().toLowerCase(),
      p_first_name:  addForm.firstName.trim(),
      p_last_name:   addForm.lastName.trim(),
      p_office_name: addForm.role,
      p_school_id:   schoolId,
    })
    setAdding(false)
    if (error) { setAddError(error.message); return }
    setCredential({ email: data.email, is_new_user: data.is_new_user, temp_password: data.temp_password })
    setShowAdd(false)
    setAddForm({ firstName: '', lastName: '', email: '', role: K12_ROLES[0] })
    loadAll()
  }

  return (
    <>
      <Topbar title="Staff Management" meta={appUser.activeSchool?.name}
        actions={
          <div className="flex gap-2">
            {isK12 && (
              <Button variant="primary" size="sm" onClick={() => { setShowAdd(true); setAddError('') }}>
                + Add Staff
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShowGradeForm(v => !v)}>
              {showGradeForm ? 'Close' : '+ Salary Grade'}
            </Button>
          </div>
        }
      />

      <div className="p-8 space-y-6">
        {toast && <Alert type={toast.type === 'error' ? 'danger' : 'success'}>{toast.msg}</Alert>}

        {/* Credential banner — shown once after onboarding a new staff account */}
        {credential && (
          <Card className="p-5 bg-green-50 border-green-200">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <div className="text-sm font-bold text-green-800">
                  {credential.is_new_user ? 'Staff account created' : 'Role assigned to existing user'}
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
                  <div className="text-xs text-green-600">Share these credentials with the staff member. The password is shown once only.</div>
                )}
              </div>
              <button onClick={() => setCredential(null)} className="text-green-400 hover:text-green-700 text-lg ml-4 cursor-pointer">×</button>
            </div>
          </Card>
        )}

        {/* Salary grade quick-add */}
        {showGradeForm && (
          <Card className="p-5">
            <div className="text-sm font-bold text-navy-900 mb-4">New Salary Grade</div>
            <div className="flex items-end gap-3 flex-wrap">
              <div className="w-56">
                <Field label="Grade Name">
                  <Input placeholder="e.g. Grade Level 07" value={gradeName}
                    onChange={e => setGradeName(e.target.value)} />
                </Field>
              </div>
              <div className="w-40">
                <Field label="Basic Pay (₦)">
                  <Input type="number" placeholder="45000" value={gradeBasic}
                    onChange={e => setGradeBasic(e.target.value)} />
                </Field>
              </div>
              <div className="flex gap-2 pb-0.5">
                <Button variant="primary" size="sm" onClick={addGrade}
                  disabled={savingGrade || !gradeName || !gradeBasic}>
                  {savingGrade ? 'Saving…' : 'Add'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowGradeForm(false)}>Cancel</Button>
              </div>
            </div>
            {grades.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {grades.map(g => (
                  <span key={g.id} className="text-xs bg-navy-50 border border-navy-200 text-navy-700 rounded-sm px-3 py-1">
                    {g.name} — ₦{Number(g.basic_pay).toLocaleString('en-NG')}
                  </span>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Staff table */}
        <Card>
          <CardHeader title="Staff Members" meta={`${staff.length} total`} />
          {loading ? (
            <div className="px-5 py-10 text-sm text-gray-400 text-center">Loading…</div>
          ) : staff.length === 0 ? (
            <div className="px-5 py-10 text-sm text-gray-400 text-center">No staff members yet.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Name', 'Role', 'Designation', 'Qualification', 'Type', 'Salary Grade', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map(m => {
                  const prof = profiles[m.id]
                  const p = (m as any).profile
                  const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.email || '—'
                  const isEditing = editId === m.id

                  return (
                    <tr key={m.id} className={cn('border-b border-gray-50', isEditing ? 'bg-navy-50/40' : 'hover:bg-gray-50/40')}>
                      <td className="px-4 py-3">
                        <div className="text-sm font-semibold text-navy-900">{name}</div>
                        <div className="text-xs text-gray-400">{p?.email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 capitalize">{m.office?.name?.replace('_', ' ')}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Input className="w-36" placeholder="Designation" value={draft.designation as string ?? ''}
                            onChange={e => setDraft(d => ({ ...d, designation: e.target.value }))} />
                        ) : (
                          <span className="text-sm text-navy-800">{prof?.designation || <span className="text-gray-300">—</span>}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Input className="w-40" placeholder="Qualification" value={draft.qualification as string ?? ''}
                            onChange={e => setDraft(d => ({ ...d, qualification: e.target.value }))} />
                        ) : (
                          <span className="text-sm text-navy-800">{prof?.qualification || <span className="text-gray-300">—</span>}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Select
                            value={draft.employment_type ?? 'full_time'}
                            onChange={e => setDraft(d => ({ ...d, employment_type: e.target.value }))}
                            options={EMPLOYMENT_TYPES}
                          />
                        ) : (
                          <span className="text-xs capitalize text-gray-600">{(prof?.employment_type ?? 'full_time').replace('_', ' ')}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Select
                            value={draft.salary_grade_id ?? ''}
                            onChange={e => setDraft(d => ({ ...d, salary_grade_id: e.target.value }))}
                            placeholder="— none —"
                            options={grades.map(g => ({ value: g.id, label: `${g.name} (₦${Number(g.basic_pay).toLocaleString('en-NG')})` }))}
                          />
                        ) : (
                          <span className="text-xs text-navy-700">{gradeLabel(prof?.salary_grade_id ?? null)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex gap-1 justify-end">
                            <Button variant="primary" size="sm" onClick={saveProfile} disabled={saving}>
                              {saving ? '…' : 'Save'}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setEditId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => startEdit(m)}>Edit</Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Add Staff modal (K12 onboarding) */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="font-bold text-navy-900">Add Staff Member</div>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-700 text-xl cursor-pointer">×</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {addError && <Alert type="danger">{addError}</Alert>}

              <div className="grid grid-cols-2 gap-3">
                <Field label="First Name *">
                  <Input
                    value={addForm.firstName}
                    onChange={e => setAddForm(f => ({ ...f, firstName: e.target.value }))}
                    autoFocus
                  />
                </Field>
                <Field label="Last Name *">
                  <Input
                    value={addForm.lastName}
                    onChange={e => setAddForm(f => ({ ...f, lastName: e.target.value }))}
                  />
                </Field>
              </div>

              <Field label="Email Address *">
                <Input
                  type="email"
                  value={addForm.email}
                  onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="staff@school.edu.ng"
                />
              </Field>

              <Field label="Role *">
                <Select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}
                  options={K12_ROLES.map(r => ({ value: r, label: K12_OFFICE_LABELS[r] }))} />
              </Field>

              <div className="text-[11px] text-gray-400 bg-gray-50 rounded p-3 leading-relaxed">
                If this is a new user, a temporary password will be generated. If the email already exists in the system, the role will be assigned to the existing account.
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleAddStaff} disabled={adding}>
                {adding ? 'Adding…' : 'Add Staff'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
