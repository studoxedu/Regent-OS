import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Input, Select, Field, Grid2 } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { K12_OFFICES, K12_OFFICE_LABELS, canAssignRoles, canManageSalary } from '../../lib/roles'
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

const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'contract',  label: 'Contract' },
]

export default function StaffManagement({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''
  const office   = appUser.activeMembership?.office?.name ?? ''
  const mayAssign = canAssignRoles(office)   // head teacher / ICT admin
  const maySalary = canManageSalary(office)  // head teacher / bursar

  // Assign-role / add-staff modal
  const [assignOpen, setAssignOpen]   = useState(false)
  const [aForm, setAForm]             = useState({ firstName: '', lastName: '', email: '', role: K12_OFFICES[0] as string, password: '' })
  const [assigning, setAssigning]     = useState(false)
  const [aErr, setAErr]               = useState('')
  const [cred, setCred]               = useState<{ email: string; is_new: boolean; temp: string | null } | null>(null)

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
      // Only finance roles may set a salary grade; others preserve the
      // existing value so a staff-records editor can't assign pay scales.
      salary_grade_id: maySalary ? (draft.salary_grade_id || null) : (existing?.salary_grade_id ?? null),
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

  async function handleAssign() {
    if (!aForm.firstName.trim() || !aForm.lastName.trim() || !aForm.email.trim()) {
      setAErr('First name, last name and email are required.'); return
    }
    if (aForm.password.trim().length < 6) { setAErr('Set a password of at least 6 characters.'); return }
    setAssigning(true); setAErr('')
    const { data, error } = await supabase.rpc('create_staff_member', {
      p_email:       aForm.email.trim().toLowerCase(),
      p_first_name:  aForm.firstName.trim(),
      p_last_name:   aForm.lastName.trim(),
      p_office_name: aForm.role,
      p_school_id:   schoolId,
      p_password:    aForm.password.trim(),
    })
    setAssigning(false)
    if (error) { setAErr(error.message); return }
    setCred({ email: data.email, is_new: data.is_new_user, temp: data.temp_password })
    setAssignOpen(false)
    setAForm({ firstName: '', lastName: '', email: '', role: K12_OFFICES[0], password: '' })
    flash('Role assigned.')
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

  return (
    <>
      <Topbar title="Staff & Roles" meta={appUser.activeSchool?.name}
        actions={
          <div className="flex items-center gap-2">
            {maySalary && (
              <Button variant="ghost" size="sm" onClick={() => setShowGradeForm(v => !v)}>
                {showGradeForm ? 'Close' : '+ Salary Grade'}
              </Button>
            )}
            {mayAssign && (
              <Button variant="primary" size="sm" onClick={() => { setAErr(''); setAssignOpen(true) }}>
                + Assign Role
              </Button>
            )}
          </div>
        }
      />

      <div className="p-8 space-y-6">
        {toast && <Alert type={toast.type === 'error' ? 'danger' : 'success'}>{toast.msg}</Alert>}

        {/* Credential banner — shown once after assigning a role/creating an account */}
        {cred && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-5">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <div className="text-sm font-bold text-green-800">
                  {cred.is_new ? 'Account created & role assigned' : 'Role added to existing user'}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="label text-green-600 mb-1">Email</div>
                    <div className="font-mono text-green-800 text-sm">{cred.email}</div>
                  </div>
                  {cred.temp && (
                    <div>
                      <div className="label text-green-600 mb-1">Password</div>
                      <div className="font-mono font-bold text-green-900 text-sm">{cred.temp}</div>
                    </div>
                  )}
                </div>
                {cred.temp && <div className="text-xs text-green-600">Share these credentials with the staff member.</div>}
              </div>
              <button onClick={() => setCred(null)} className="text-green-400 hover:text-green-700 text-lg ml-4">×</button>
            </div>
          </div>
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
                  {['Name', 'Role', 'Designation', 'Qualification', 'Type', ...(maySalary ? ['Salary Grade'] : []), ''].map(h => (
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
                      {maySalary && (
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
                      )}
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

        <p className="text-xs text-gray-400">
          {mayAssign
            ? 'Use “Assign Role” to create a staff account and give it a role (e.g. Exam Officer, Bursar). This page also manages HR details for existing staff.'
            : 'This page manages HR details (designation, employment type) for existing staff.'}
        </p>
      </div>

      {/* Assign Role / Add Staff modal */}
      <Modal
        open={assignOpen}
        title="Assign Role"
        onClose={() => setAssignOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleAssign}
              disabled={assigning || !aForm.firstName.trim() || !aForm.lastName.trim() || !aForm.email.trim() || aForm.password.trim().length < 6}>
              {assigning ? 'Assigning…' : 'Assign Role'}
            </Button>
          </>
        }
      >
        {aErr && <Alert type="danger" className="mb-4">{aErr}</Alert>}
        <Grid2>
          <Field label="First Name" required>
            <Input value={aForm.firstName} onChange={e => setAForm(f => ({ ...f, firstName: e.target.value }))} autoFocus />
          </Field>
          <Field label="Last Name" required>
            <Input value={aForm.lastName} onChange={e => setAForm(f => ({ ...f, lastName: e.target.value }))} />
          </Field>
        </Grid2>
        <Field label="Email Address" required>
          <Input type="email" placeholder="staff@school.edu.ng" value={aForm.email}
            onChange={e => setAForm(f => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="Role" required>
          <Select value={aForm.role} onChange={e => setAForm(f => ({ ...f, role: e.target.value }))}
            options={K12_OFFICES.map(o => ({ value: o, label: K12_OFFICE_LABELS[o] }))} />
        </Field>
        <Field label="Password" required hint="Min 6 characters — share it with the staff member.">
          <Input type="text" value={aForm.password}
            onChange={e => setAForm(f => ({ ...f, password: e.target.value }))} placeholder="Set a password" />
        </Field>
        <p className="text-[11px] text-gray-400 bg-gray-50 rounded-md p-3 leading-relaxed">
          If the email already exists, the selected role is added to that account (password unchanged).
        </p>
      </Modal>
    </>
  )
}
