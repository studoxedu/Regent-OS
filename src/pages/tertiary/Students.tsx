import { useEffect, useState, useCallback } from 'react'
import { Card, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Field, Select } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { hasCap } from '../../lib/roles'
import type { AppUser, TertStudent, TertCreateResult, Department, AcademicSession } from '../../types'

interface Props { appUser: AppUser }

type Tab = 'registry' | 'bulk'

const PROGRAMMES = [
  { value: 'nd',      label: 'ND — National Diploma' },
  { value: 'hnd',     label: 'HND — Higher National Diploma' },
  { value: 'nce',     label: 'NCE — Nigeria Certificate in Education' },
  { value: 'degree',  label: 'B.Sc / B.Eng / B.A (Degree)' },
  { value: 'pgd',     label: 'PGD — Postgraduate Diploma' },
  { value: 'masters', label: 'Masters' },
  { value: 'phd',     label: 'PhD' },
]

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-green-50 text-green-700',
  suspended: 'bg-yellow-50 text-yellow-700',
  graduated: 'bg-blue-50 text-blue-700',
  withdrawn: 'bg-red-50 text-red-700',
  deferred:  'bg-gray-100 text-gray-600',
}

interface BulkRow {
  idx:         number
  first_name:  string
  last_name:   string
  middle_name: string
  dob:         string
  gender:      string
  phone:       string
  email:       string
  department:  string  // raw from CSV — matched by name or code
  programme:   string
  session:     string  // raw from CSV — matched by label
  status:      'pending' | 'ok' | 'error'
  reg_number?: string
  temp_password?: string
  message?:    string
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

export default function TertiaryStudents({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''

  const [tab,          setTab]          = useState<Tab>('registry')
  const [students,     setStudents]     = useState<TertStudent[]>([])
  const [departments,  setDepartments]  = useState<Department[]>([])
  const [sessions,     setSessions]     = useState<AcademicSession[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showModal,    setShowModal]    = useState(false)
  const [credentials,  setCredentials]  = useState<TertCreateResult | null>(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDept,   setFilterDept]   = useState('all')
  const [search,       setSearch]       = useState('')

  const [form, setForm] = useState({
    firstName: '', lastName: '', middleName: '',
    dob: '', gender: '', phone: '', email: '',
    departmentId: '', programme: 'nd', sessionId: '',
  })
  const [creating,    setCreating]    = useState(false)
  const [createError, setCreateError] = useState('')

  // Bulk import
  const [csvText,    setCsvText]    = useState('')
  const [bulkRows,   setBulkRows]   = useState<BulkRow[]>([])
  const [importing,  setImporting]  = useState(false)
  const [importDone, setImportDone] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const { data: faculties } = await supabase.from('faculties').select('id').eq('school_id', schoolId)
    const facultyIds = (faculties ?? []).map((f: any) => f.id)

    const [stuRes, deptRes, sesRes] = await Promise.all([
      supabase.from('students')
        .select('*, department:departments(id, name, code, faculty:faculties(name))')
        .eq('institution_id', schoolId)
        .order('created_at', { ascending: false }),
      facultyIds.length
        ? supabase.from('departments').select('id, name, code, faculty_id').in('faculty_id', facultyIds)
        : Promise.resolve({ data: [] }),
      supabase.from('academic_sessions')
        .select('id, label').eq('school_id', schoolId)
        .order('created_at', { ascending: false }),
    ])
    setStudents((stuRes.data ?? []) as TertStudent[])
    setDepartments((deptRes.data ?? []) as Department[])
    setSessions((sesRes.data ?? []) as AcademicSession[])
    setLoading(false)
  }, [schoolId])

  useEffect(() => { if (schoolId) loadAll() }, [loadAll])

  async function handleCreate() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setCreateError('First name and last name are required.'); return
    }
    if (!form.departmentId) { setCreateError('Department is required.'); return }
    if (!form.sessionId)    { setCreateError('Admission session is required.'); return }

    setCreating(true); setCreateError('')
    const { data, error } = await supabase.rpc('flow_execute', {
      p_capability: 'student.create',
      p_payload: {
        first_name:     form.firstName.trim(),
        last_name:      form.lastName.trim(),
        middle_name:    form.middleName.trim() || '',
        date_of_birth:  form.dob || '',
        gender:         form.gender || '',
        phone:          form.phone.trim() || '',
        personal_email: form.email.trim() || '',
        department_id:  form.departmentId,
        programme:      form.programme,
        session_id:     form.sessionId,
      },
    })
    setCreating(false)
    if (error) { setCreateError(error.message); return }

    const flowResult = data as { ok: boolean; result: TertCreateResult }
    setCredentials(flowResult.result)
    setShowModal(false)
    setForm({ firstName:'', lastName:'', middleName:'', dob:'', gender:'', phone:'', email:'', departmentId:'', programme:'nd', sessionId:'' })
    loadAll()
  }

  // ── Bulk helpers ────────────────────────────────────────────────
  function resolveDept(raw: string): Department | undefined {
    const q = raw.toLowerCase().trim()
    return departments.find(d =>
      d.name.toLowerCase() === q ||
      d.code?.toLowerCase() === q ||
      d.name.toLowerCase().includes(q)
    )
  }

  function resolveSession(raw: string): AcademicSession | undefined {
    const q = raw.toLowerCase().trim()
    return sessions.find(s => s.label.toLowerCase() === q || s.label.toLowerCase().includes(q))
  }

  function parseBulk() {
    if (!csvText.trim()) return
    const rows = parseCSV(csvText)
    const dataRows = rows[0]?.[0]?.toLowerCase().includes('first') ? rows.slice(1) : rows
    setBulkRows(dataRows.filter(r => r[0]).map((r, i) => ({
      idx:         i,
      first_name:  r[0]  ?? '',
      last_name:   r[1]  ?? '',
      middle_name: r[2]  ?? '',
      dob:         r[3]  ?? '',
      gender:      r[4]  ?? '',
      phone:       r[5]  ?? '',
      email:       r[6]  ?? '',
      department:  r[7]  ?? '',
      programme:   r[8]?.toLowerCase().trim() || 'degree',
      session:     r[9]  ?? '',
      status:      'pending',
    })))
    setImportDone(false)
  }

  async function runBulkImport() {
    setImporting(true)
    const updated = [...bulkRows]

    for (let i = 0; i < updated.length; i++) {
      const row = updated[i]
      const dept    = resolveDept(row.department)
      const session = resolveSession(row.session)

      if (!row.first_name || !row.last_name) {
        updated[i] = { ...row, status: 'error', message: 'Missing name' }; continue
      }
      if (!dept) {
        updated[i] = { ...row, status: 'error', message: `Department not found: "${row.department}"` }; continue
      }
      if (!session) {
        updated[i] = { ...row, status: 'error', message: `Session not found: "${row.session}"` }; continue
      }

      const { data, error } = await supabase.rpc('flow_execute', {
        p_capability: 'student.create',
        p_payload: {
          first_name:     row.first_name,
          last_name:      row.last_name,
          middle_name:    row.middle_name || '',
          date_of_birth:  row.dob || '',
          gender:         row.gender || '',
          phone:          row.phone || '',
          personal_email: row.email || '',
          department_id:  dept.id,
          programme:      row.programme || 'degree',
          session_id:     session.id,
        },
      })

      if (error) {
        updated[i] = { ...row, status: 'error', message: error.message }
      } else {
        const result = (data as any)?.result ?? data
        updated[i] = { ...row, status: 'ok', reg_number: result?.reg_number, temp_password: result?.temp_password }
      }
      setBulkRows([...updated])
    }

    setImporting(false)
    setImportDone(true)
    loadAll()
  }

  const filtered = students.filter(s => {
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (filterDept !== 'all' && s.department_id !== filterDept) return false
    if (search) {
      const q = search.toLowerCase()
      const name = `${s.first_name} ${s.last_name}`.toLowerCase()
      if (!name.includes(q) && !s.reg_number.toLowerCase().includes(q)) return false
    }
    return true
  })

  const TEMPLATE = [
    'first_name,last_name,middle_name,dob,gender,phone,email,department,programme,session',
    'Amina,Bello,,2002-05-14,female,08012345678,amina@gmail.com,Computer Science,degree,2024/2025',
    'Emeka,Obi,Chukwuemeka,2001-11-03,male,08087654321,,Civil Engineering,degree,2024/2025',
  ].join('\n')

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-bold text-navy-900">Student Registry</div>
          <div className="text-sm text-gray-400 mt-0.5">{students.length} students enrolled</div>
        </div>
        {hasCap(appUser, 'student.admit') && (
          <Button variant="primary" size="sm" onClick={() => { setShowModal(true); setCreateError('') }}>
            + Admit Student
          </Button>
        )}
      </div>

      {/* Credentials banner */}
      {credentials && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-5">
          <div className="flex justify-between items-start">
            <div className="space-y-3">
              <div className="text-sm font-bold text-green-800">Student admitted successfully</div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-[10px] text-green-600 uppercase tracking-widest mb-1">Reg Number</div>
                  <div className="font-mono font-bold text-green-900 text-sm">{credentials.reg_number}</div>
                </div>
                <div>
                  <div className="text-[10px] text-green-600 uppercase tracking-widest mb-1">Temp Password</div>
                  <div className="font-mono font-bold text-green-900 text-sm tracking-widest">{credentials.temp_password}</div>
                </div>
                <div>
                  <div className="text-[10px] text-green-600 uppercase tracking-widest mb-1">Login Email</div>
                  <div className="font-mono text-green-700 text-xs">{credentials.login_email}</div>
                </div>
              </div>
              <div className="text-xs text-green-600">Give these credentials to the student. This display will not repeat.</div>
            </div>
            <button onClick={() => setCredentials(null)} className="text-green-400 hover:text-green-700 text-lg ml-6 flex-shrink-0">×</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {((hasCap(appUser, 'student.admit') ? ['registry', 'bulk'] : ['registry']) as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
              tab === t ? 'border-navy-900 text-navy-900' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}>
            {t === 'registry' ? 'Registry' : 'Bulk Import'}
          </button>
        ))}
      </div>

      {/* ── REGISTRY TAB ── */}
      {tab === 'registry' && (
        <>
          <div className="flex gap-3 flex-wrap">
            <input type="text" placeholder="Search name or reg number…"
              value={search} onChange={e => setSearch(e.target.value)}
              className="border border-gray-200 rounded px-3 py-1.5 text-sm w-60 focus:outline-none focus:ring-1 focus:ring-navy-300"
            />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none">
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="graduated">Graduated</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="deferred">Deferred</option>
            </select>
            <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
              className="border border-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none">
              <option value="all">All departments</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          <Card>
            {loading ? (
              <div className="px-6 py-12 text-sm text-gray-400 text-center">Loading registry…</div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-12 text-sm text-gray-400 text-center">
                {students.length === 0 ? 'No students admitted yet.' : 'No students match the current filter.'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Reg Number', 'Student', 'Department', 'Programme', 'Status', 'Admitted'].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                      <td className="px-5 py-3 font-mono text-xs text-navy-700 font-semibold">{s.reg_number}</td>
                      <td className="px-5 py-3">
                        <div className="font-semibold text-navy-900">{s.last_name}, {s.first_name}</div>
                        {s.middle_name && <div className="text-xs text-gray-400">{s.middle_name}</div>}
                      </td>
                      <td className="px-5 py-3 text-gray-600">
                        <div>{(s.department as any)?.name ?? '—'}</div>
                        {(s.department as any)?.faculty && (
                          <div className="text-[11px] text-gray-400">{(s.department as any).faculty.name}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 uppercase text-xs font-bold text-navy-600">{s.programme}</td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_COLORS[s.status] ?? ''}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-400">
                        {new Date(s.created_at).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {/* ── BULK IMPORT TAB ── */}
      {tab === 'bulk' && (
        <div className="space-y-4">
          <Card>
            <div className="px-5 py-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[13px] font-bold text-navy-900 mb-1">CSV Student Bulk Admission</div>
                  <div className="text-xs text-gray-500">
                    Columns: <code className="bg-gray-100 px-1 rounded">first_name, last_name, middle_name, dob, gender, phone, email, department, programme, session</code>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Department: match by name or code. Session: match by label (e.g. 2024/2025).
                    Programmes: nd, hnd, nce, degree, pgd, masters, phd.
                  </div>
                </div>
                <button
                  onClick={() => {
                    const blob = new Blob([TEMPLATE], { type: 'text/csv' })
                    const url  = URL.createObjectURL(blob)
                    const a    = document.createElement('a'); a.href = url; a.download = 'students_import_template.csv'; a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="text-[12px] font-semibold text-navy-700 border border-navy-200 px-3 py-1.5 rounded cursor-pointer hover:bg-navy-50 flex-shrink-0"
                >
                  Download Template
                </button>
              </div>

              <div>
                <div className="flex gap-3 mb-2">
                  <input type="file" accept=".csv,.txt"
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
                    {importing ? 'Importing…' : `Admit ${bulkRows.length} students`}
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

          {bulkRows.length > 0 && (
            <Card>
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-[13px] font-bold text-navy-900">{importDone ? 'Import Results' : 'Preview'}</span>
                {importDone && (
                  <div className="flex gap-3 text-[11px]">
                    <span className="text-green-700 font-semibold">{bulkRows.filter(r => r.status === 'ok').length} admitted</span>
                    <span className="text-red-600 font-semibold">{bulkRows.filter(r => r.status === 'error').length} failed</span>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['#', 'Name', 'Department', 'Prog', 'Session', 'Status'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map(row => {
                      const dept    = resolveDept(row.department)
                      const session = resolveSession(row.session)
                      return (
                        <tr key={row.idx} className={`border-b border-gray-50 ${
                          row.status === 'error' ? 'bg-red-50/40' :
                          row.status === 'ok'    ? 'bg-green-50/30' : ''
                        }`}>
                          <td className="px-4 py-2.5 text-xs text-gray-400">{row.idx + 1}</td>
                          <td className="px-4 py-2.5 text-xs font-semibold text-navy-900">
                            {row.last_name}, {row.first_name}
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            {dept
                              ? <span className="text-navy-700">{dept.name}</span>
                              : <span className="text-red-500">"{row.department}" not found</span>}
                          </td>
                          <td className="px-4 py-2.5 text-xs uppercase font-bold text-navy-600">{row.programme}</td>
                          <td className="px-4 py-2.5 text-xs">
                            {session
                              ? <span className="text-navy-700">{session.label}</span>
                              : <span className="text-red-500">"{row.session}" not found</span>}
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            {row.status === 'pending' && <span className="text-gray-400">—</span>}
                            {row.status === 'ok' && (
                              <div>
                                <span className="text-green-700 font-semibold">{row.reg_number}</span>
                                {row.temp_password && (
                                  <div className="font-mono text-[10px] text-green-600 mt-0.5">pw: {row.temp_password}</div>
                                )}
                              </div>
                            )}
                            {row.status === 'error' && (
                              <span className="text-red-600" title={row.message}>{row.message?.slice(0, 40)}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Admit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="font-bold text-navy-900">Admit New Student</div>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {createError && <Alert type="danger">{createError}</Alert>}

              <div className="grid grid-cols-2 gap-3">
                <Field label="First Name *">
                  <Input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
                </Field>
                <Field label="Last Name *">
                  <Input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
                </Field>
              </div>
              <Field label="Middle Name">
                <Input value={form.middleName} onChange={e => setForm(f => ({ ...f, middleName: e.target.value }))} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date of Birth">
                  <Input type="date" value={form.dob} onChange={e => setForm(f => ({ ...f, dob: e.target.value }))} />
                </Field>
                <Field label="Gender">
                  <Select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                    <option value="">— Select —</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </Field>
                <Field label="Personal Email">
                  <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </Field>
              </div>
              <Field label="Department *">
                <Select value={form.departmentId} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))}>
                  <option value="">— Select department —</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Programme *">
                  <Select value={form.programme} onChange={e => setForm(f => ({ ...f, programme: e.target.value }))}>
                    {PROGRAMMES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </Select>
                </Field>
                <Field label="Admission Session *">
                  <Select value={form.sessionId} onChange={e => setForm(f => ({ ...f, sessionId: e.target.value }))}>
                    <option value="">— Select —</option>
                    {sessions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="text-[11px] text-gray-400 bg-gray-50 rounded p-3 leading-relaxed">
                A registration number is generated automatically. A temporary password will be shown once — record it for the student.
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleCreate} disabled={creating}>
                {creating ? 'Admitting…' : 'Admit Student'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
