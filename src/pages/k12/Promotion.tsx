import { useCallback, useEffect, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, CardHeader, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Form'
import { ConfirmModal } from '../../components/ui/Modal'
import { supabase, flowExecute } from '../../lib/supabase'
import type { AppUser, K12Class, LearnerEnrollment } from '../../types'

interface Props { appUser: AppUser }

export default function K12Promotion({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''

  const [classes, setClasses]         = useState<K12Class[]>([])
  const [selectedId, setSelectedId]   = useState('')
  const [pupils, setPupils]           = useState<LearnerEnrollment[]>([])
  const [excluded, setExcluded]       = useState<Set<string>>(new Set())
  const [loading, setLoading]         = useState(false)
  const [running, setRunning]         = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toast, setToast]             = useState<string | null>(null)

  const selected    = classes.find(c => c.id === selectedId) ?? null
  const destination = selected?.next_class_id ? classes.find(c => c.id === selected.next_class_id) ?? null : null
  const graduating  = selected?.is_graduating_class === true
  const configured  = graduating || !!destination

  const included = pupils.filter(p => !excluded.has(p.id))

  const loadClasses = useCallback(async () => {
    const { data } = await supabase
      .from('k12_classes').select('*').eq('school_id', schoolId).order('stage').order('name')
    setClasses((data ?? []) as K12Class[])
  }, [schoolId])

  const loadPupils = useCallback(async () => {
    if (!selectedId) { setPupils([]); return }
    setLoading(true)
    const { data } = await supabase
      .from('learner_enrollments')
      .select('*, learner:learners(first_name, last_name, learner_id)')
      .eq('school_id', schoolId).eq('class_id', selectedId).eq('status', 'active')
      .order('created_at')
    setPupils((data ?? []) as LearnerEnrollment[])
    setExcluded(new Set())
    setLoading(false)
  }, [schoolId, selectedId])

  useEffect(() => { if (schoolId) loadClasses() }, [schoolId, loadClasses])
  useEffect(() => { loadPupils() }, [loadPupils])

  function toggle(id: string) {
    setExcluded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function run() {
    setRunning(true); setConfirmOpen(false)
    try {
      const res = await flowExecute('learner.promote', schoolId, {
        enrollment_ids: included.map(p => p.id),
      })
      const r = (res?.result ?? {}) as Record<string, number>
      const bits = [
        r.promoted  ? `${r.promoted} promoted to ${destination?.name}` : '',
        r.graduated ? `${r.graduated} graduated` : '',
        r.skipped   ? `${r.skipped} skipped (no ladder set)` : '',
      ].filter(Boolean)
      showToast(bits.length ? `${bits.join(' · ')}. Audit entry created.` : 'Nothing to do.')
      loadPupils()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setRunning(false)
    }
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 6000) }

  const outcomeLabel = graduating
    ? `${included.length} will graduate`
    : destination
    ? `${included.length} will move to ${destination.name}`
    : 'This class has no promotion ladder set'

  return (
    <>
      <Topbar title="Promotion" meta="End-of-year promotion, repeats and graduation" />

      <div className="p-8 max-w-4xl space-y-6">
        <Alert type="warning">
          <strong>Promotion is logged and cannot be undone.</strong> Finalise term results first.
          Untick any pupil who should repeat the year — they stay where they are.
        </Alert>

        <Card>
          <CardHeader title="Choose a class to promote" meta={`${classes.length} classes`} />
          <div className="p-5 space-y-4">
            <div className="w-80">
              <label className="label mb-1.5 block">Class</label>
              <Select
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
                placeholder="Select a class…"
                options={classes.map(c => ({ value: c.id, label: c.name }))}
              />
            </div>

            {selected && (
              <div className="flex items-center gap-3 text-sm">
                <span className="font-semibold text-navy-900">{selected.name}</span>
                <span className="text-gray-400">→</span>
                {graduating ? (
                  <span className="font-semibold text-green-700">Graduates (final year)</span>
                ) : destination ? (
                  <span className="font-semibold text-blue-700">{destination.name}</span>
                ) : (
                  <span className="font-semibold text-red-600">No ladder set</span>
                )}
              </div>
            )}

            {selected && !configured && (
              <Alert type="danger">
                <strong>{selected.name} has no promotion ladder.</strong> Set what it promotes into
                (or mark it as the final year) under <em>Setup → Classes &amp; Subjects</em>.
                Promotion will skip these pupils rather than guess.
              </Alert>
            )}
          </div>
        </Card>

        {selected && (
          <Card>
            <CardHeader
              title="Pupils"
              meta={loading ? 'Loading…' : `${included.length} of ${pupils.length} selected · ${pupils.length - included.length} repeating`}
            />
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['', 'Learner', 'Learner ID', 'Outcome'].map(h => (
                    <th key={h} className="px-5 py-2.5 text-left bg-gray-50 border-b border-gray-200 text-[10px] font-bold tracking-[0.08em] uppercase text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pupils.map(p => {
                  const learner = (p as any).learner
                  const isOut = excluded.has(p.id)
                  return (
                    <tr key={p.id} className={`border-b border-gray-50 ${isOut ? 'bg-gray-50/60' : 'hover:bg-gray-50/40'}`}>
                      <td className="px-5 py-3">
                        <input type="checkbox" checked={!isOut} onChange={() => toggle(p.id)} className="accent-blue-600" />
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-navy-900">
                        {learner?.first_name} {learner?.last_name}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-400">{learner?.learner_id}</td>
                      <td className="px-5 py-3 text-xs">
                        {isOut
                          ? <span className="text-gray-500 font-semibold">Repeats {selected.name}</span>
                          : graduating
                          ? <span className="text-green-700 font-semibold">Graduates</span>
                          : destination
                          ? <span className="text-blue-700 font-semibold">→ {destination.name}</span>
                          : <span className="text-red-600 font-semibold">Skipped — no ladder</span>}
                      </td>
                    </tr>
                  )
                })}
                {!loading && pupils.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-10 text-sm text-gray-400 text-center">No active pupils in this class.</td></tr>
                )}
              </tbody>
            </table>

            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-500">{outcomeLabel}</span>
              <Button
                variant="amber"
                onClick={() => setConfirmOpen(true)}
                disabled={running || !configured || included.length === 0}
              >
                {graduating ? 'Graduate Pupils →' : 'Run Promotion →'}
              </Button>
            </div>
          </Card>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={graduating ? 'Confirm Graduation' : 'Confirm Promotion'}
        message={
          graduating
            ? <>This will graduate <strong>{included.length}</strong> pupil(s) from <strong>{selected?.name}</strong> and mark them as leavers.</>
            : <>This will move <strong>{included.length}</strong> pupil(s) from <strong>{selected?.name}</strong> into <strong>{destination?.name}</strong>.
               {pupils.length - included.length > 0 && <> <strong>{pupils.length - included.length}</strong> will repeat {selected?.name}.</>}</>
        }
        warning="This action is logged and cannot be reversed."
        confirmLabel={graduating ? 'Graduate' : 'Run Promotion'}
        confirmVariant="amber"
        onConfirm={run}
        onClose={() => setConfirmOpen(false)}
        loading={running}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 bg-navy-900 text-white px-5 py-3 rounded-sm shadow-modal text-sm z-50">{toast}</div>
      )}
    </>
  )
}
