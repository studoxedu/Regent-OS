import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import type { AppUser, K12Class, K12Subject, Stage } from '../../types'

interface Props { appUser: AppUser }

/** Sentinel for the "final year" option in the Promotes-to picker. */
const GRAD = '__graduates__'

const STAGES: Stage[] = ['nursery','primary','jss','sss']

export default function K12Classes({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id!
  const [classes, setClasses]   = useState<K12Class[]>([])
  const [subjects, setSubjects] = useState<K12Subject[]>([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<'classes' | 'subjects'>('classes')
  const [toast, setToast]       = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Class form
  const [className, setClassName] = useState('')
  const [classStage, setClassStage] = useState<string>('primary')
  const [savingClass, setSavingClass] = useState(false)

  // Subject form
  const [subjectName, setSubjectName] = useState('')
  const [subjectStage, setSubjectStage] = useState<string>('')
  const [savingSubject, setSavingSubject] = useState(false)

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  async function load() {
    const [{ data: cls }, { data: sub }] = await Promise.all([
      supabase.from('k12_classes').select('*').eq('school_id', schoolId).order('stage').order('name'),
      supabase.from('k12_subjects').select('*').eq('school_id', schoolId).order('name'),
    ])
    setClasses((cls ?? []) as K12Class[])
    setSubjects((sub ?? []) as K12Subject[])
    setLoading(false)
  }

  useEffect(() => { load() }, [schoolId])

  async function addClass() {
    if (!className.trim()) return
    setSavingClass(true)
    const { error } = await supabase.from('k12_classes').insert({
      school_id: schoolId, name: className.trim(), stage: classStage,
    })
    setSavingClass(false)
    if (error) { flash(error.message, 'error'); return }
    setClassName(''); flash('Class added.'); load()
  }

  async function addSubject() {
    if (!subjectName.trim()) return
    setSavingSubject(true)
    const { error } = await supabase.from('k12_subjects').insert({
      school_id: schoolId, name: subjectName.trim(), stage: subjectStage || null,
    })
    setSavingSubject(false)
    if (error) { flash(error.message, 'error'); return }
    setSubjectName(''); setSubjectStage(''); flash('Subject added.'); load()
  }

  // Progression ladder: a class either promotes into another class, or is the
  // final year (graduates) — never both (enforced by a DB check too).
  async function setProgression(classId: string, value: string) {
    const patch = value === GRAD
      ? { next_class_id: null, is_graduating_class: true }
      : { next_class_id: value || null, is_graduating_class: false }
    const { error } = await supabase.from('k12_classes').update(patch).eq('id', classId)
    if (error) { flash(error.message, 'error'); return }
    flash('Promotion ladder updated.')
    load()
  }

  async function deleteClass(id: string) {
    await supabase.from('k12_classes').delete().eq('id', id)
    flash('Class removed.'); load()
  }

  async function deleteSubject(id: string) {
    await supabase.from('k12_subjects').delete().eq('id', id)
    flash('Subject removed.'); load()
  }

  const classesByStage = STAGES.reduce((acc, stage) => {
    acc[stage] = classes.filter(c => c.stage === stage)
    return acc
  }, {} as Record<string, K12Class[]>)

  return (
    <>
      <Topbar title="Classes & Subjects" meta={appUser.activeSchool?.name} />
      <div className="p-8 space-y-6">
        {toast && <Alert type={toast.type === 'error' ? 'danger' : 'success'}>{toast.msg}</Alert>}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {(['classes','subjects'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-navy-800 text-navy-900'
                  : 'border-transparent text-gray-400 hover:text-navy-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 text-center py-12">Loading…</div>
        ) : tab === 'classes' ? (
          <div className="space-y-6">
            {/* Add class form */}
            <Card className="p-5">
              <div className="text-sm font-bold text-navy-900 mb-4">Add Class</div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label mb-1.5 block">Class Name</label>
                  <Input placeholder="e.g. JSS 1A, Primary 3B" value={className} onChange={e => setClassName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addClass()} />
                </div>
                <div className="w-40">
                  <label className="label mb-1.5 block">Stage</label>
                  <Select value={classStage} onChange={e => setClassStage(e.target.value)}
                    options={STAGES.map(s => ({ value: s, label: s.toUpperCase() }))} />
                </div>
                <div className="flex items-end">
                  <Button variant="primary" size="sm" onClick={addClass} disabled={savingClass}>
                    {savingClass ? '…' : 'Add'}
                  </Button>
                </div>
              </div>
            </Card>

            <Alert type="info">
              <strong>Promotion ladder.</strong> Set what each class promotes into — this is what
              end-of-year Promotion follows (e.g. JSS 1A → JSS 2A). Mark your final year as
              “Graduates”. A class left unset is skipped at promotion rather than graduated.
            </Alert>

            {/* Classes by stage */}
            {STAGES.map(stage => (
              classesByStage[stage].length > 0 && (
                <div key={stage}>
                  <div className="label mb-3">{stage.toUpperCase()}</div>
                  <div className="grid grid-cols-3 gap-3">
                    {classesByStage[stage].map(cls => (
                      <Card key={cls.id} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-navy-900">{cls.name}</span>
                          <button onClick={() => deleteClass(cls.id)} className="text-gray-300 hover:text-red-500 text-xs cursor-pointer">×</button>
                        </div>
                        <label className="label mb-1 block">Promotes to</label>
                        <Select
                          value={cls.is_graduating_class ? GRAD : (cls.next_class_id ?? '')}
                          onChange={e => setProgression(cls.id, e.target.value)}
                          options={[
                            { value: '',   label: '— not set —' },
                            { value: GRAD, label: 'Graduates (final year)' },
                            ...classes.filter(c => c.id !== cls.id).map(c => ({ value: c.id, label: c.name })),
                          ]}
                        />
                      </Card>
                    ))}
                  </div>
                </div>
              )
            ))}

            {classes.length === 0 && (
              <div className="text-center py-12 text-sm text-gray-400">No classes yet. Add your first class above.</div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Add subject form */}
            <Card className="p-5">
              <div className="text-sm font-bold text-navy-900 mb-4">Add Subject</div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label mb-1.5 block">Subject Name</label>
                  <Input placeholder="e.g. Mathematics, English Language" value={subjectName}
                    onChange={e => setSubjectName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addSubject()} />
                </div>
                <div className="w-40">
                  <label className="label mb-1.5 block">Stage (optional)</label>
                  <Select value={subjectStage} onChange={e => setSubjectStage(e.target.value)}
                    options={[{ value: '', label: 'All stages' }, ...STAGES.map(s => ({ value: s, label: s.toUpperCase() }))]} />
                </div>
                <div className="flex items-end">
                  <Button variant="primary" size="sm" onClick={addSubject} disabled={savingSubject}>
                    {savingSubject ? '…' : 'Add'}
                  </Button>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Subjects" meta={`${subjects.length} total`} />
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {['Subject Name', 'Stage', ''].map(h => (
                      <th key={h} className="px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subjects.map(sub => (
                    <tr key={sub.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3 text-sm font-semibold text-navy-900">{sub.name}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">{sub.stage ? sub.stage.toUpperCase() : 'All stages'}</td>
                      <td className="px-5 py-3 text-right">
                        <button onClick={() => deleteSubject(sub.id)} className="text-gray-300 hover:text-red-500 text-xs cursor-pointer">Remove</button>
                      </td>
                    </tr>
                  ))}
                  {subjects.length === 0 && (
                    <tr><td colSpan={3} className="px-5 py-8 text-center text-sm text-gray-400">No subjects yet.</td></tr>
                  )}
                </tbody>
              </table>
            </Card>
          </div>
        )}
      </div>
    </>
  )
}
