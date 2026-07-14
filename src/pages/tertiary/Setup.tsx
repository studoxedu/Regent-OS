import { useEffect, useState } from 'react'
import { Card, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Field } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { getInstitutionLabels } from '../../lib/institution'
import type { AppUser } from '../../types'

interface Props { appUser: AppUser }

const TOKEN_DOCS = [
  { token: '{CODE}',  desc: 'Institution code, e.g. RGT' },
  { token: '{YEAR}',  desc: 'Admission year, e.g. 2026' },
  { token: '{DEPT}',  desc: 'Department code, e.g. CSC' },
  { token: '{SEQ}',   desc: 'Zero-padded sequence, e.g. 001' },
]

interface DeptRow { id: string; name: string; code: string | null; faculty_name: string }

export default function TertiarySetup({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''

  const [instCode,       setInstCode]       = useState('')
  const [pattern,        setPattern]        = useState('{CODE}/{YEAR}/{DEPT}/{SEQ}')
  const [institutionType, setInstitutionType] = useState('')
  const [departments,    setDepartments]    = useState<DeptRow[]>([])
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [toast,          setToast]          = useState<{ msg: string; ok: boolean } | null>(null)
  const [deptCodes,      setDeptCodes]      = useState<Record<string, string>>({})
  const [savingDepts,    setSavingDepts]    = useState(false)

  const labels = getInstitutionLabels(institutionType || appUser.activeSchool?.institution_type)

  function flash(msg: string, ok = true) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => { if (schoolId) load() }, [schoolId])

  async function load() {
    setLoading(true)

    const [schRes, facRes] = await Promise.all([
      supabase.from('schools').select('code, reg_number_pattern, institution_type').eq('id', schoolId).single(),
      supabase.from('faculties').select('id, name').eq('school_id', schoolId),
    ])

    const facultyIds = (facRes.data ?? []).map((f: any) => f.id)
    const facMap: Record<string, string> = {}
    ;(facRes.data ?? []).forEach((f: any) => { facMap[f.id] = f.name })

    const { data: depts } = facultyIds.length
      ? await supabase.from('departments').select('id, name, code, faculty_id').in('faculty_id', facultyIds)
      : { data: [] }

    if (schRes.data) {
      setInstCode(schRes.data.code ?? '')
      setPattern(schRes.data.reg_number_pattern ?? '{CODE}/{YEAR}/{DEPT}/{SEQ}')
      setInstitutionType(schRes.data.institution_type ?? '')
    }

    const rows: DeptRow[] = (depts ?? []).map((d: any) => ({
      id: d.id, name: d.name, code: d.code, faculty_name: facMap[d.faculty_id] ?? '',
    }))
    setDepartments(rows)

    const codes: Record<string, string> = {}
    rows.forEach(d => { codes[d.id] = d.code ?? '' })
    setDeptCodes(codes)

    setLoading(false)
  }

  async function saveInstitution() {
    setSaving(true)
    const { error } = await supabase.rpc('flow_execute', {
      p_capability: 'institution.configure',
      p_payload: {
        code: instCode.trim().toUpperCase(),
        reg_number_pattern: pattern.trim(),
        ...(institutionType ? { institution_type: institutionType } : {}),
      },
    })
    setSaving(false)
    if (error) { flash(error.message, false); return }
    flash('Institution settings saved.')
  }

  async function saveDeptCodes() {
    setSavingDepts(true)
    const dept_codes = departments.map(d => ({
      id:   d.id,
      code: (deptCodes[d.id] ?? '').toUpperCase().trim(),
    }))
    const { error } = await supabase.rpc('flow_execute', {
      p_capability: 'institution.configure',
      p_payload: { department_codes: dept_codes },
    })
    setSavingDepts(false)
    if (error) { flash(error.message, false); return }
    flash('Department codes saved.')
    load()
  }

  const preview = pattern
    .replace('{CODE}', instCode || 'RGT')
    .replace('{YEAR}', '2026')
    .replace('{DEPT}', 'CSC')
    .replace('{SEQ}',  '001')

  if (loading) return (
    <div className="p-8 text-sm text-gray-400">Loading institution settings…</div>
  )

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div>
        <div className="text-xl font-bold text-navy-900">Institution Setup</div>
        <div className="text-sm text-gray-400 mt-0.5">Configure identity and registration number format</div>
      </div>

      {toast && <Alert type={toast.ok ? 'success' : 'danger'}>{toast.msg}</Alert>}

      {/* Institution config */}
      <Card className="p-6 space-y-4">
        <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Institution Identity</div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Institution Code">
            <Input
              value={instCode}
              onChange={e => setInstCode(e.target.value.toUpperCase())}
              placeholder="e.g. RGT"
              maxLength={6}
            />
            <div className="text-[11px] text-gray-400 mt-1">Short uppercase code. Used in reg numbers.</div>
          </Field>

          <Field label="Reg Number Pattern">
            <Input
              value={pattern}
              onChange={e => setPattern(e.target.value)}
              placeholder="{CODE}/{YEAR}/{DEPT}/{SEQ}"
            />
            <div className="text-[11px] text-gray-400 mt-1">Use tokens below to build the format.</div>
          </Field>

          <Field label="Institution Type">
            <select
              value={institutionType}
              onChange={e => setInstitutionType(e.target.value)}
              className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] text-navy-900 bg-white focus:outline-none focus:ring-1 focus:ring-navy-300"
            >
              <option value="">— select type —</option>
              <option value="university">University</option>
              <option value="polytechnic">Polytechnic</option>
              <option value="college_of_education">College of Education</option>
              <option value="monotechnic">Monotechnic</option>
            </select>
            <div className="text-[11px] text-gray-400 mt-1">
              Determines terminology: {getInstitutionLabels(institutionType).senate} · {getInstitutionLabels(institutionType).unit} · {getInstitutionLabels(institutionType).unitHead}
            </div>
          </Field>
        </div>

        {/* Token reference */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Pattern tokens</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {TOKEN_DOCS.map(t => (
              <div key={t.token} className="flex gap-2 text-sm">
                <span className="font-mono text-navy-700 text-xs w-20 flex-shrink-0">{t.token}</span>
                <span className="text-gray-500 text-xs">{t.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Live preview */}
        <div className="flex items-center gap-3 bg-navy-50 rounded-lg px-4 py-3">
          <span className="text-xs text-navy-500 uppercase tracking-widest flex-shrink-0">Preview</span>
          <span className="font-mono font-bold text-navy-800">{preview}</span>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={saveInstitution} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </Button>
        </div>
      </Card>

      {/* Department codes */}
      <Card>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-navy-900">Department Codes</div>
            <div className="text-xs text-gray-400 mt-0.5">These fill the {'{DEPT}'} token in reg numbers</div>
          </div>
          <Button variant="ghost" size="sm" onClick={saveDeptCodes} disabled={savingDepts}>
            {savingDepts ? 'Saving…' : 'Save Codes'}
          </Button>
        </div>

        {departments.length === 0 ? (
          <div className="px-6 py-8 text-sm text-gray-400 text-center">
            No departments found. Add them in Structure first.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Department</th>
                <th className="text-left px-6 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{labels.unit}</th>
                <th className="text-left px-6 py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-36">Code</th>
              </tr>
            </thead>
            <tbody>
              {departments.map(d => (
                <tr key={d.id} className="border-b border-gray-50">
                  <td className="px-6 py-2 text-navy-800">{d.name}</td>
                  <td className="px-6 py-2 text-gray-400 text-xs">{d.faculty_name}</td>
                  <td className="px-6 py-2">
                    <input
                      type="text"
                      value={deptCodes[d.id] ?? ''}
                      onChange={e => setDeptCodes(c => ({ ...c, [d.id]: e.target.value.toUpperCase() }))}
                      maxLength={6}
                      placeholder="e.g. CSC"
                      className="border border-gray-200 rounded px-2 py-1 text-xs font-mono w-24 focus:outline-none focus:ring-1 focus:ring-navy-300 uppercase"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
