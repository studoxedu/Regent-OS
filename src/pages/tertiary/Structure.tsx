import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Field } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { getInstitutionLabels } from '../../lib/institution'
import { hasCap } from '../../lib/roles'
import type { AppUser, Faculty, Department, Course } from '../../types'

interface Props { appUser: AppUser }

export default function TertiaryStructure({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''
  const labels   = getInstitutionLabels(appUser.activeSchool?.institution_type)

  const [faculties, setFaculties]     = useState<Faculty[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [courses, setCourses]         = useState<Course[]>([])
  const [expandedFac, setExpandedFac] = useState<Set<string>>(new Set())
  const [expandedDept, setExpandedDept] = useState<Set<string>>(new Set())
  const [toast, setToast]             = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Faculty form
  const [showFacForm, setShowFacForm] = useState(false)
  const [facName, setFacName]         = useState('')
  const [savingFac, setSavingFac]     = useState(false)

  // Department form (keyed by faculty id)
  const [addDeptFor, setAddDeptFor]   = useState<string | null>(null)
  const [deptName, setDeptName]       = useState('')
  const [savingDept, setSavingDept]   = useState(false)

  // Course form (keyed by department id)
  const [addCourseFor, setAddCourseFor] = useState<string | null>(null)
  const [courseForm, setCourseForm]     = useState({ code: '', title: '', credit_units: '3' })
  const [savingCourse, setSavingCourse] = useState(false)

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  async function loadAll() {
    const [{ data: fac }, { data: dep }, { data: crs }] = await Promise.all([
      supabase.from('faculties').select('*').eq('school_id', schoolId).order('name'),
      supabase.from('departments').select('*').order('name'),
      supabase.from('courses').select('*').order('code'),
    ])
    setFaculties((fac ?? []) as Faculty[])
    setDepartments((dep ?? []) as Department[])
    setCourses((crs ?? []) as Course[])
  }

  useEffect(() => { if (schoolId) loadAll() }, [schoolId])

  function toggleFac(id: string) {
    setExpandedFac(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleDept(id: string) {
    setExpandedDept(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function addFaculty() {
    if (!facName.trim()) return
    setSavingFac(true)
    const { error } = await supabase.from('faculties').insert({ school_id: schoolId, name: facName.trim() })
    setSavingFac(false)
    if (error) { flash(error.message, 'error'); return }
    setFacName(''); setShowFacForm(false)
    flash(`${labels.unit} added.`)
    loadAll()
  }

  async function addDepartment(facultyId: string) {
    if (!deptName.trim()) return
    setSavingDept(true)
    const { error } = await supabase.from('departments').insert({ faculty_id: facultyId, name: deptName.trim() })
    setSavingDept(false)
    if (error) { flash(error.message, 'error'); return }
    setDeptName(''); setAddDeptFor(null)
    flash('Department added.')
    loadAll()
  }

  async function addCourse(deptId: string) {
    if (!courseForm.code.trim() || !courseForm.title.trim()) return
    setSavingCourse(true)
    const { error } = await supabase.from('courses').insert({
      department_id: deptId,
      code:         courseForm.code.trim().toUpperCase(),
      title:        courseForm.title.trim(),
      credit_units: parseInt(courseForm.credit_units) || 3,
    })
    setSavingCourse(false)
    if (error) { flash(error.message, 'error'); return }
    setCourseForm({ code: '', title: '', credit_units: '3' }); setAddCourseFor(null)
    flash('Course added.')
    loadAll()
  }

  async function deleteCourse(id: string) {
    await supabase.from('courses').delete().eq('id', id)
    flash('Course removed.')
    loadAll()
  }

  return (
    <>
      <Topbar
        title="Institution Structure"
        meta={`${labels.units}, departments & courses`}
        actions={hasCap(appUser, 'structure.manage') ? <Button variant="primary" size="sm" onClick={() => setShowFacForm(v => !v)}>+ Add {labels.unit}</Button> : undefined}
      />

      <div className="p-8 space-y-4 max-w-3xl">
        {toast && <Alert type={toast.type === 'error' ? 'danger' : 'success'}>{toast.msg}</Alert>}

        {/* Add faculty form */}
        {showFacForm && (
          <Card className="p-5">
            <div className="text-sm font-bold text-navy-900 mb-3">New {labels.unit}</div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Field label={`${labels.unit} Name`}>
                  <Input autoFocus placeholder={`e.g. ${labels.unit} of Engineering`} value={facName}
                    onChange={e => setFacName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addFaculty()} />
                </Field>
              </div>
              <div className="flex gap-2 pb-0.5">
                <Button variant="primary" size="sm" onClick={addFaculty} disabled={savingFac || !facName}>
                  {savingFac ? 'Saving…' : 'Add'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowFacForm(false)}>Cancel</Button>
              </div>
            </div>
          </Card>
        )}

        {faculties.length === 0 && !showFacForm && (
          <Card className="p-8 text-center">
            <div className="text-sm text-gray-400">No {labels.units.toLowerCase()} defined yet.</div>
            <div className="text-xs text-gray-300 mt-1">Create {labels.units.toLowerCase()} and departments to organise your institution.</div>
            <div className="mt-4">
              <Button variant="primary" size="sm" onClick={() => setShowFacForm(true)}>Create First {labels.unit}</Button>
            </div>
          </Card>
        )}

        {faculties.map(fac => {
          const depts = departments.filter(d => d.faculty_id === fac.id)
          const isOpen = expandedFac.has(fac.id)

          return (
            <Card key={fac.id}>
              {/* Faculty header */}
              <button
                className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50/50 transition-colors"
                onClick={() => toggleFac(fac.id)}
              >
                <div>
                  <div className="text-sm font-bold text-navy-900">{fac.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {depts.length} department{depts.length !== 1 ? 's' : ''} ·{' '}
                    {depts.reduce((s, d) => s + courses.filter(c => c.department_id === d.id).length, 0)} courses
                  </div>
                </div>
                <span className="text-gray-400 text-sm">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="border-t border-gray-100">
                  {/* Departments */}
                  {depts.length === 0 && addDeptFor !== fac.id && (
                    <div className="px-5 py-3 text-sm text-gray-400">No departments. Add one below.</div>
                  )}

                  {depts.map(dept => {
                    const deptCourses = courses.filter(c => c.department_id === dept.id)
                    const isDeptOpen = expandedDept.has(dept.id)

                    return (
                      <div key={dept.id} className="border-b border-gray-50 last:border-0">
                        {/* Department row */}
                        <button
                          className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50/40 transition-colors"
                          onClick={() => toggleDept(dept.id)}
                        >
                          <div className="text-left">
                            <div className="text-sm font-semibold text-navy-900">{dept.name}</div>
                            <div className="text-xs text-gray-400">{deptCourses.length} course{deptCourses.length !== 1 ? 's' : ''}</div>
                          </div>
                          <span className="text-gray-400 text-xs">{isDeptOpen ? '▲' : '▼'}</span>
                        </button>

                        {/* Courses */}
                        {isDeptOpen && (
                          <div className="bg-gray-50/60 border-t border-gray-100 px-5 py-3">
                            {deptCourses.length === 0 && addCourseFor !== dept.id && (
                              <div className="text-xs text-gray-400 mb-2">No courses yet.</div>
                            )}

                            {deptCourses.map(c => (
                              <div key={c.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-bold font-mono text-navy-700 w-20">{c.code}</span>
                                  <span className="text-xs text-navy-900">{c.title}</span>
                                  <span className="text-[10px] text-gray-400">{c.credit_units} CU</span>
                                </div>
                                <button onClick={() => deleteCourse(c.id)}
                                  className="text-gray-300 hover:text-red-400 text-xs ml-3">×</button>
                              </div>
                            ))}

                            {/* Add course form */}
                            {addCourseFor === dept.id ? (
                              <div className="flex items-end gap-2 mt-3 flex-wrap">
                                <div className="w-24">
                                  <Field label="Code">
                                    <Input autoFocus placeholder="MTH301" value={courseForm.code}
                                      onChange={e => setCourseForm(f => ({ ...f, code: e.target.value }))} />
                                  </Field>
                                </div>
                                <div className="flex-1 min-w-[160px]">
                                  <Field label="Title">
                                    <Input placeholder="Course title" value={courseForm.title}
                                      onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))} />
                                  </Field>
                                </div>
                                <div className="w-16">
                                  <Field label="CU">
                                    <Input type="number" min="1" max="6" value={courseForm.credit_units}
                                      onChange={e => setCourseForm(f => ({ ...f, credit_units: e.target.value }))} />
                                  </Field>
                                </div>
                                <div className="flex gap-1 pb-0.5">
                                  <Button variant="primary" size="sm"
                                    onClick={() => addCourse(dept.id)}
                                    disabled={savingCourse || !courseForm.code || !courseForm.title}>
                                    {savingCourse ? '…' : 'Add'}
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => setAddCourseFor(null)}>×</Button>
                                </div>
                              </div>
                            ) : hasCap(appUser, 'structure.manage') ? (
                              <button
                                onClick={() => { setAddCourseFor(dept.id); setCourseForm({ code: '', title: '', credit_units: '3' }) }}
                                className="text-xs font-semibold text-navy-700 hover:underline mt-2 block"
                              >
                                + Add Course
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Add department */}
                  {hasCap(appUser, 'structure.manage') && (
                  <div className="px-5 py-3 border-t border-gray-100">
                    {addDeptFor === fac.id ? (
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <Field label="Department Name">
                            <Input autoFocus placeholder="e.g. Computer Engineering" value={deptName}
                              onChange={e => setDeptName(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && addDepartment(fac.id)} />
                          </Field>
                        </div>
                        <div className="flex gap-1 pb-0.5">
                          <Button variant="primary" size="sm"
                            onClick={() => addDepartment(fac.id)}
                            disabled={savingDept || !deptName}>
                            {savingDept ? '…' : 'Add'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setAddDeptFor(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm"
                        onClick={() => { setAddDeptFor(fac.id); setDeptName('') }}>
                        + Add Department
                      </Button>
                    )}
                  </div>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}
