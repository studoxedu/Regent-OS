import { useEffect, useState, useCallback } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, StatCard, Alert } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Field, Input, Select } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { hasCap } from '../../lib/roles'
import type { AppUser, Membership } from '../../types'

interface Props { appUser: AppUser }

interface Office { id: string; name: string; label?: string }

interface StaffCredential {
  email: string
  is_new_user: boolean
  temp_password: string | null
}

interface BulkRow {
  idx: number
  first_name: string
  last_name: string
  email: string
  role: string
  status: 'pending' | 'ok' | 'error'
  message?: string
  temp_password?: string
}

const ROLE_LABELS: Record<string, string> = {
  lecturer:           'Lecturer',
  dean:               'Dean',
  hod:                'Head of Department',
  exam_officer:           'Examinations Officer',
  dept_exam_officer:      'Dept. Examinations Officer',
  faculty_exam_officer:   'Faculty Examinations Officer',
  registrar:          'Registrar',
  senate_secretary:   'Senate Secretary',
  finance_officer:    'Finance Officer',
  hr_officer:         'HR Officer',
  timetable_officer:  'Timetable Officer',
  library_officer:    'Library Officer',
  admissions_officer: 'Admissions Officer',
  school_admin:       'School Administrator',
}

const OFFICE_COLORS: Record<string, { bg: string; text: string }> = {
  school_admin:       { bg: 'bg-navy-100',   text: 'text-navy-800' },
  dean:               { bg: 'bg-purple-100', text: 'text-purple-800' },
  hod:                { bg: 'bg-blue-100',   text: 'text-blue-800' },
  exam_officer:           { bg: 'bg-amber-100',   text: 'text-amber-800' },
  dept_exam_officer:      { bg: 'bg-amber-100',   text: 'text-amber-800' },
  faculty_exam_officer:   { bg: 'bg-orange-100',  text: 'text-orange-800' },
  lecturer:           { bg: 'bg-teal-100',   text: 'text-teal-800' },
  registrar:          { bg: 'bg-indigo-100', text: 'text-indigo-800' },
  senate_secretary:   { bg: 'bg-rose-100',   text: 'text-rose-800' },
  finance_officer:    { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  hr_officer:         { bg: 'bg-orange-100', text: 'text-orange-800' },
  timetable_officer:  { bg: 'bg-cyan-100',   text: 'text-cyan-800' },
  library_officer:    { bg: 'bg-emerald-100',text: 'text-emerald-800' },
  admissions_officer: { bg: 'bg-pink-100',   text: 'text-pink-800' },
}

function parseCSV(text: string): string[][] {
  return text.trim().split('\n').map(line => {
    const fields: string[] = []
    let cur = '', inQ = false
    for (const ch of line.replace(/\r/g, '')) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    fields.push(cur.trim())
    return fields
  })
}

type Tab = 'list' | 'bulk'

export default function TertiaryStaff({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''

  const [tab,         setTab]         = useState<Tab>('list')
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [offices,     setOffices]     = useState<Office[]>([])
  const [loading,     setLoading]     = useState(true)

  // Add Staff modal
  const [showAdd,      setShowAdd]      = useState(false)
  const [form,         setForm]         = useState({ firstName: '', lastName: '', email: '', role: 'lecturer' })
  const [adding,       setAdding]       = useState(false)
  const [addError,     setAddError]     = useState('')
  const [credential,   setCredential]   = useState<StaffCredential | null>(null)

  // Bulk import
  const [csvText,      setCsvText]      = useState('')
  const [bulkRows,     setBulkRows]     = useState<BulkRow[]>([])
  const [importing,    setImporting]    = useState(false)
  const [importDone,   setImportDone]   = useState(false)

  const loadStaff = useCallback(async () => {
    if (!schoolId) return
    setLoading(true)
    const [memRes, offRes] = await Promise.all([
      supabase.from('memberships')
        .select('*, office:offices(*), profile:profiles(*)')
        .eq('school_id', schoolId)
        .eq('is_active', true)
        .order('created_at'),
      supabase.from('offices')
        .select('id, name')
        .eq('governance_mode', 'tertiary')
        .neq('name', 'student')
        .order('name'),
    ])
    setMemberships((memRes.data ?? []) as Membership[])
    setOffices((offRes.data ?? []) as Office[])
    setLoading(false)
  }, [schoolId])

  useEffect(() => { loadStaff() }, [loadStaff])

  async function handleAddStaff() {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setAddError('First name, last name and email are required.'); return
    }
    setAdding(true); setAddError('')
    const { data, error } = await supabase.rpc('create_staff_member', {
      p_email:       form.email.trim().toLowerCase(),
      p_first_name:  form.firstName.trim(),
      p_last_name:   form.lastName.trim(),
      p_office_name: form.role,
      p_school_id:   schoolId,
    })
    setAdding(false)
    if (error) { setAddError(error.message); return }
    setCredential({ email: data.email, is_new_user: data.is_new_user, temp_password: data.temp_password })
    setShowAdd(false)
    setForm({ firstName: '', lastName: '', email: '', role: 'lecturer' })
    loadStaff()
  }

  // ── Bulk import ──────────────────────────────────────────────────
  function parseBulk() {
    if (!csvText.trim()) return
    const rows = parseCSV(csvText)
    // skip header if first cell looks like a label
    const dataRows = rows[0]?.[0]?.toLowerCase().includes('first') ? rows.slice(1) : rows
    setBulkRows(dataRows.filter(r => r.length >= 3 && r[0]).map((r, i) => ({
      idx:        i,
      first_name: r[0] ?? '',
      last_name:  r[1] ?? '',
      email:      r[2] ?? '',
      role:       r[3]?.toLowerCase().trim() || 'lecturer',
      status:     'pending',
    })))
    setImportDone(false)
  }

  async function runBulkImport() {
    if (!bulkRows.length) return
    setImporting(true)
    const updated = [...bulkRows]
    for (let i = 0; i < updated.length; i++) {
      const row = updated[i]
      if (!row.email || !row.first_name || !row.last_name) {
        updated[i] = { ...row, status: 'error', message: 'Missing required fields' }
        continue
      }
      const { data, error } = await supabase.rpc('create_staff_member', {
        p_email:       row.email.toLowerCase(),
        p_first_name:  row.first_name,
        p_last_name:   row.last_name,
        p_office_name: row.role || 'lecturer',
        p_school_id:   schoolId,
      })
      if (error) {
        updated[i] = { ...row, status: 'error', message: error.message }
      } else {
        updated[i] = { ...row, status: 'ok', temp_password: data.temp_password ?? undefined }
      }
      setBulkRows([...updated])
    }
    setImporting(false)
    setImportDone(true)
    loadStaff()
  }

  const staff    = memberships.filter(m => m.office?.name !== 'student')
  const students = memberships.filter(m => m.office?.name === 'student')

  const TEMPLATE = `first_name,last_name,email,role\nAmina,Bello,amina.bello@fusox.edu.ng,lecturer\nChukwuemeka,Obi,c.obi@fusox.edu.ng,hod`

  return (
    <>
      <Topbar
        title="Staff"
        meta="Active members with school access"
        actions={hasCap(appUser, 'staff.manage') ? <Button variant="primary" size="sm" onClick={() => { setShowAdd(true); setAddError('') }}>+ Add Staff</Button> : undefined}
      />

      <div className="p-8 space-y-6">

        {/* Credential banner */}
        {credential && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-5">
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
              <button onClick={() => setCredential(null)} className="text-green-400 hover:text-green-700 text-lg ml-4">×</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Staff Members" value={staff.length}    sub="Active staff"  accent="amber" />
          <StatCard label="Students"      value={students.length} sub="Portal access" accent="blue"  />
          <StatCard label="Total Members" value={memberships.length} sub="All active" accent="green" />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {(['list', 'bulk'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
                tab === t ? 'border-navy-900 text-navy-900' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              {t === 'list' ? 'Staff List' : 'Bulk Import'}
            </button>
          ))}
        </div>

        {/* ── LIST TAB ── */}
        {tab === 'list' && (
          <Card>
            <CardHeader title="Staff Members" />
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Name', 'Email', 'Office / Role', 'Since'].map(h => (
                    <th key={h} className="px-5 py-2.5 text-left bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</td></tr>
                ) : staff.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-8 text-sm text-gray-400 text-center">No staff members yet.</td></tr>
                ) : staff.map(m => {
                  const office  = m.office?.name ?? ''
                  const colors  = OFFICE_COLORS[office] ?? { bg: 'bg-gray-100', text: 'text-gray-700' }
                  const profile = (m as any).profile
                  const name    = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || '—'
                  return (
                    <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                      <td className="px-5 py-3 text-sm font-semibold text-navy-900">{name}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">{profile?.email}</td>
                      <td className="px-5 py-3">
                        <Badge
                          label={ROLE_LABELS[office] ?? office.replace(/_/g, ' ')}
                          bg={colors.bg} text={colors.text}
                        />
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500">{formatDate(m.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}

        {/* ── BULK IMPORT TAB ── */}
        {tab === 'bulk' && (
          <div className="space-y-4">
            <Card>
              <div className="px-5 py-4 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[13px] font-bold text-navy-900 mb-1">CSV Staff Import</div>
                    <div className="text-xs text-gray-500">
                      Columns: <code className="bg-gray-100 px-1 rounded">first_name, last_name, email, role</code>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Roles: {Object.keys(ROLE_LABELS).join(', ')}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const blob = new Blob([TEMPLATE], { type: 'text/csv' })
                      const url  = URL.createObjectURL(blob)
                      const a    = document.createElement('a'); a.href = url; a.download = 'staff_import_template.csv'; a.click()
                      URL.revokeObjectURL(url)
                    }}
                    className="text-[12px] font-semibold text-navy-700 border border-navy-200 px-3 py-1.5 rounded cursor-pointer hover:bg-navy-50"
                  >
                    Download Template
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                    Paste CSV or upload file
                  </label>
                  <div className="flex gap-3 mb-2">
                    <input
                      type="file" accept=".csv,.txt"
                      onChange={async e => {
                        const file = e.target.files?.[0]; if (!file) return
                        const text = await file.text(); setCsvText(text); setBulkRows([])
                      }}
                      className="text-xs text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-gray-200 file:text-xs file:font-semibold file:bg-white file:cursor-pointer cursor-pointer"
                    />
                  </div>
                  <textarea
                    value={csvText}
                    onChange={e => { setCsvText(e.target.value); setBulkRows([]) }}
                    rows={6}
                    placeholder={TEMPLATE}
                    className="w-full font-mono text-xs border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-navy-300 resize-y"
                  />
                </div>

                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={parseBulk} disabled={!csvText.trim()}>
                    Preview
                  </Button>
                  {bulkRows.length > 0 && !importDone && (
                    <Button variant="primary" size="sm" onClick={runBulkImport} disabled={importing}>
                      {importing ? 'Importing…' : `Import ${bulkRows.length} staff`}
                    </Button>
                  )}
                  {importDone && (
                    <Button variant="ghost" size="sm" onClick={() => { setBulkRows([]); setCsvText(''); setImportDone(false) }}>
                      Clear & Reset
                    </Button>
                  )}
                </div>
              </div>
            </Card>

            {/* Preview / results table */}
            {bulkRows.length > 0 && (
              <Card>
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-[13px] font-bold text-navy-900">{importDone ? 'Import Results' : 'Preview'}</span>
                  <div className="flex gap-3 text-[11px] text-gray-500">
                    {importDone && (
                      <>
                        <span className="text-green-700 font-semibold">{bulkRows.filter(r => r.status === 'ok').length} succeeded</span>
                        <span className="text-red-600 font-semibold">{bulkRows.filter(r => r.status === 'error').length} failed</span>
                      </>
                    )}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['#', 'Name', 'Email', 'Role', 'Status'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map(row => (
                      <tr key={row.idx} className={`border-b border-gray-50 ${
                        row.status === 'error' ? 'bg-red-50/40' :
                        row.status === 'ok'    ? 'bg-green-50/30' : ''
                      }`}>
                        <td className="px-4 py-2.5 text-xs text-gray-400">{row.idx + 1}</td>
                        <td className="px-4 py-2.5 text-xs font-semibold text-navy-900">{row.last_name}, {row.first_name}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-600">{row.email}</td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            OFFICE_COLORS[row.role]
                              ? `${OFFICE_COLORS[row.role].bg} ${OFFICE_COLORS[row.role].text}`
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {ROLE_LABELS[row.role] ?? row.role}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {row.status === 'pending' && <span className="text-gray-400">—</span>}
                          {row.status === 'ok' && (
                            <div>
                              <span className="text-green-700 font-semibold">Done</span>
                              {row.temp_password && (
                                <div className="font-mono text-[10px] text-green-600 mt-0.5">pw: {row.temp_password}</div>
                              )}
                            </div>
                          )}
                          {row.status === 'error' && (
                            <span className="text-red-600 font-semibold" title={row.message}>{row.message?.slice(0, 50)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* ── Add Staff Modal ── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="font-bold text-navy-900">Add Staff Member</div>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {addError && <Alert type="danger">{addError}</Alert>}

              <div className="grid grid-cols-2 gap-3">
                <Field label="First Name *">
                  <Input
                    value={form.firstName}
                    onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                    autoFocus
                  />
                </Field>
                <Field label="Last Name *">
                  <Input
                    value={form.lastName}
                    onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                  />
                </Field>
              </div>

              <Field label="Email Address *">
                <Input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="staff@fusox.edu.ng"
                />
              </Field>

              <Field label="Role *">
                <Select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {offices.map(o => (
                    <option key={o.id} value={o.name}>
                      {ROLE_LABELS[o.name] ?? o.name.replace(/_/g, ' ')}
                    </option>
                  ))}
                </Select>
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
