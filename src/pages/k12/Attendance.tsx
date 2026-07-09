import { useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import type { AppUser, K12Class, LearnerEnrollment, AttendanceStatus } from '../../types'

interface Props { appUser: AppUser }

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused']

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  present: 'bg-green-100 text-green-700 border-green-300',
  absent:  'bg-red-100 text-red-700 border-red-300',
  late:    'bg-yellow-100 text-yellow-700 border-yellow-300',
  excused: 'bg-blue-100 text-blue-700 border-blue-300',
}

type AttendanceMap = Record<string, AttendanceStatus>

export default function Attendance({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id!

  const [classes, setClasses]         = useState<K12Class[]>([])
  const [selectedClass, setSelectedClass] = useState<string>('')
  const [date, setDate]               = useState(new Date().toISOString().split('T')[0])
  const [enrollments, setEnrollments] = useState<LearnerEnrollment[]>([])
  const [attendance, setAttendance]   = useState<AttendanceMap>({})
  const [saved, setSaved]             = useState<AttendanceMap>({})
  const [loading, setLoading]         = useState(false)
  const [saving, setSaving]           = useState(false)
  const [toast, setToast]             = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [tab, setTab]                 = useState<'register' | 'summary'>('register')

  // Summary state
  const [summaryClass, setSummaryClass]   = useState<string>('')
  const [summaryData, setSummaryData]     = useState<{ date: string; present: number; absent: number; late: number }[]>([])

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    supabase.from('k12_classes').select('*').eq('school_id', schoolId).order('stage').order('name')
      .then(({ data }) => setClasses((data ?? []) as K12Class[]))
  }, [schoolId])

  useEffect(() => {
    if (!selectedClass) return
    setLoading(true)
    Promise.all([
      supabase.from('learner_enrollments')
        .select('*, learner:learners(*)')
        .eq('school_id', schoolId)
        .eq('class_id', selectedClass)
        .eq('status', 'active')
        .order('created_at'),
      supabase.from('attendance_records')
        .select('enrollment_id, status')
        .eq('school_id', schoolId)
        .eq('class_id', selectedClass)
        .eq('date', date),
    ]).then(([{ data: en }, { data: att }]) => {
      setEnrollments((en ?? []) as LearnerEnrollment[])
      const map: AttendanceMap = {}
      ;(en ?? []).forEach(e => { map[e.id] = 'present' })
      ;(att ?? []).forEach(a => { map[a.enrollment_id] = a.status as AttendanceStatus })
      setAttendance({ ...map })
      setSaved({ ...map })
      setLoading(false)
    })
  }, [selectedClass, date, schoolId])

  function toggle(enrollmentId: string) {
    setAttendance(prev => {
      const cur = prev[enrollmentId] ?? 'present'
      const next = STATUSES[(STATUSES.indexOf(cur) + 1) % STATUSES.length]
      return { ...prev, [enrollmentId]: next }
    })
  }

  async function saveAttendance() {
    if (!selectedClass || enrollments.length === 0) return
    setSaving(true)

    const upserts = enrollments.map(en => ({
      school_id: schoolId,
      enrollment_id: en.id,
      class_id: selectedClass,
      date,
      status: attendance[en.id] ?? 'present',
    }))

    const { error } = await supabase.from('attendance_records').upsert(upserts, { onConflict: 'enrollment_id,date' })
    setSaving(false)
    if (error) { flash(error.message, 'error'); return }
    notifyGuardians()
    setSaved({ ...attendance })
    flash('Attendance saved.')
  }

  // Alert linked guardians when a learner is newly marked absent/late (best-effort)
  async function notifyGuardians() {
    const flagged = enrollments.filter(en => {
      const status = attendance[en.id] ?? 'present'
      return (status === 'absent' || status === 'late') && saved[en.id] !== status
    })
    if (flagged.length === 0) return

    const { data: links } = await supabase
      .from('guardian_links')
      .select('guardian_id, learner_id')
      .in('learner_id', flagged.map(en => en.learner_id))
    if (!links || links.length === 0) return

    const dateLabel = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    const rows = links.flatMap(link => {
      const en = flagged.find(e => e.learner_id === link.learner_id)
      if (!en) return []
      const status = attendance[en.id]
      const name   = `${en.learner?.first_name ?? ''} ${en.learner?.last_name ?? ''}`.trim()
      return [{
        guardian_id: link.guardian_id,
        school_id:   schoolId,
        learner_id:  link.learner_id,
        title:       status === 'absent' ? `${name} was absent today` : `${name} arrived late today`,
        body:        `${name} was marked ${status} on ${dateLabel}. Contact the school if this is unexpected.`,
        type:        status === 'absent' ? 'alert' : 'warning',
      }]
    })
    if (rows.length > 0) await supabase.from('guardian_notifications').insert(rows)
  }

  async function loadSummary() {
    if (!summaryClass) return
    const { data } = await supabase.from('attendance_records')
      .select('date, status')
      .eq('school_id', schoolId)
      .eq('class_id', summaryClass)
      .order('date', { ascending: false })
      .limit(60)

    if (!data) return
    const byDate: Record<string, { present: number; absent: number; late: number }> = {}
    data.forEach(r => {
      if (!byDate[r.date]) byDate[r.date] = { present: 0, absent: 0, late: 0 }
      if (r.status === 'present') byDate[r.date].present++
      else if (r.status === 'absent') byDate[r.date].absent++
      else if (r.status === 'late') byDate[r.date].late++
    })
    setSummaryData(Object.entries(byDate).map(([date, counts]) => ({ date, ...counts })))
  }

  useEffect(() => { if (tab === 'summary' && summaryClass) loadSummary() }, [tab, summaryClass])

  const hasChanges = JSON.stringify(attendance) !== JSON.stringify(saved)

  const stats = enrollments.reduce((acc, en) => {
    const s = attendance[en.id] ?? 'present'
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <>
      <Topbar title="Attendance" meta={appUser.activeSchool?.name} />
      <div className="p-8 space-y-6">
        {toast && <Alert type={toast.type === 'error' ? 'danger' : 'success'}>{toast.msg}</Alert>}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {(['register', 'summary'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 -mb-px transition-colors ${
                tab === t ? 'border-navy-800 text-navy-900' : 'border-transparent text-gray-400 hover:text-navy-700'}`}>
              {t === 'register' ? 'Daily Register' : 'Summary'}
            </button>
          ))}
        </div>

        {tab === 'register' ? (
          <>
            {/* Controls */}
            <div className="flex gap-4 items-end">
              <div className="w-52">
                <label className="label mb-1.5 block">Class</label>
                <Select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}
                  options={[{ value: '', label: 'Select class…' }, ...classes.map(c => ({ value: c.id, label: c.name }))]} />
              </div>
              <div>
                <label className="label mb-1.5 block">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="border border-gray-200 rounded-sm px-3 py-2 text-sm text-navy-900 focus:outline-none focus:border-navy-500" />
              </div>
              {hasChanges && (
                <Button variant="primary" size="sm" onClick={saveAttendance} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Attendance'}
                </Button>
              )}
            </div>

            {!selectedClass ? (
              <Card className="py-16 text-center text-sm text-gray-400">Select a class to take attendance.</Card>
            ) : loading ? (
              <Card className="py-16 text-center text-sm text-gray-400">Loading…</Card>
            ) : enrollments.length === 0 ? (
              <Card className="py-16 text-center text-sm text-gray-400">
                No learners in this class. Assign learners to classes in Enrollment.
              </Card>
            ) : (
              <>
                {/* Stats bar */}
                <div className="flex gap-4">
                  {STATUSES.map(s => (
                    <div key={s} className={cn('px-3 py-1.5 rounded-sm border text-xs font-semibold', STATUS_STYLE[s])}>
                      {s}: {stats[s] ?? 0}
                    </div>
                  ))}
                  <div className="text-xs text-gray-400 self-center ml-auto">
                    Click a learner's row to cycle status
                  </div>
                </div>

                <Card>
                  <CardHeader title={classes.find(c => c.id === selectedClass)?.name ?? 'Class'} meta={date} />
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        {['#', 'Learner', 'Learner ID', 'Status'].map(h => (
                          <th key={h} className="px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500 text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {enrollments.map((en, i) => {
                        const status = attendance[en.id] ?? 'present'
                        return (
                          <tr key={en.id}
                            onClick={() => toggle(en.id)}
                            className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer">
                            <td className="px-5 py-3 text-xs text-gray-400">{i + 1}</td>
                            <td className="px-5 py-3 text-sm font-semibold text-navy-900">
                              {en.learner?.first_name} {en.learner?.last_name}
                            </td>
                            <td className="px-5 py-3 text-xs font-mono text-gray-400">{en.learner?.learner_id}</td>
                            <td className="px-5 py-3">
                              <span className={cn('px-2.5 py-1 rounded-sm border text-[11px] font-bold uppercase tracking-wide', STATUS_STYLE[status])}>
                                {status}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </Card>
              </>
            )}
          </>
        ) : (
          <>
            <div className="flex gap-4 items-end">
              <div className="w-52">
                <label className="label mb-1.5 block">Class</label>
                <Select value={summaryClass} onChange={e => { setSummaryClass(e.target.value); setSummaryData([]) }}
                  options={[{ value: '', label: 'Select class…' }, ...classes.map(c => ({ value: c.id, label: c.name }))]} />
              </div>
              <Button variant="secondary" size="sm" onClick={loadSummary} disabled={!summaryClass}>Load</Button>
            </div>

            {summaryData.length > 0 && (
              <Card>
                <CardHeader title="Attendance Summary" meta="Last 60 records" />
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['Date', 'Present', 'Absent', 'Late', 'Rate'].map(h => (
                        <th key={h} className="px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summaryData.map(row => {
                      const total = row.present + row.absent + row.late
                      const rate  = total > 0 ? Math.round((row.present / total) * 100) : 0
                      return (
                        <tr key={row.date} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-5 py-3 text-sm font-semibold text-navy-900">{row.date}</td>
                          <td className="px-5 py-3 text-sm text-green-600 font-semibold">{row.present}</td>
                          <td className="px-5 py-3 text-sm text-red-500 font-semibold">{row.absent}</td>
                          <td className="px-5 py-3 text-sm text-yellow-600 font-semibold">{row.late}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full" style={{ width: `${rate}%` }} />
                              </div>
                              <span className="text-xs font-semibold text-gray-600">{rate}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </div>
    </>
  )
}
