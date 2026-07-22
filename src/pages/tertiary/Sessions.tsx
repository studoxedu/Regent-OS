import { useEffect, useState, useCallback } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal, ConfirmModal } from '../../components/ui/Modal'
import { Field, Input } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { hasCap } from '../../lib/roles'
import type { AppUser, AcademicSession, Semester } from '../../types'

interface Props { appUser: AppUser }

export default function TertiarySessions({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''

  const [sessions,  setSessions]  = useState<AcademicSession[]>([])
  const [semesters, setSemesters] = useState<Semester[]>([])

  // Create
  const [showCreate,     setShowCreate]     = useState(false)
  const [newLabel,       setNewLabel]       = useState('')
  const [includeSummer,  setIncludeSummer]  = useState(false)
  const [creating,       setCreating]       = useState(false)

  // Edit
  const [editingSession, setEditingSession] = useState<AcademicSession | null>(null)
  const [editLabel,      setEditLabel]      = useState('')
  const [editLoading,    setEditLoading]    = useState(false)

  // Delete
  const [deletingSession, setDeletingSession] = useState<AcademicSession | null>(null)
  const [deleteLoading,   setDeleteLoading]   = useState(false)

  const load = useCallback(async () => {
    if (!schoolId) return
    const [{ data: s }, { data: sem }] = await Promise.all([
      supabase.from('academic_sessions').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }),
      supabase.from('semesters').select('*').order('ordinal'),
    ])
    setSessions((s ?? []) as AcademicSession[])
    setSemesters((sem ?? []) as Semester[])
  }, [schoolId])

  useEffect(() => { load() }, [load])

  async function createSession() {
    if (!newLabel.trim()) return
    setCreating(true)
    try {
      const { data } = await supabase
        .from('academic_sessions')
        .insert({ school_id: schoolId, label: newLabel.trim() })
        .select().single()
      if (data) {
        const semRows: { session_id: string; school_id: string; label: string; ordinal: number }[] = [
          { session_id: data.id, school_id: schoolId, label: 'First Semester',  ordinal: 1 },
          { session_id: data.id, school_id: schoolId, label: 'Second Semester', ordinal: 2 },
        ]
        if (includeSummer) semRows.push({ session_id: data.id, school_id: schoolId, label: 'Summer Semester', ordinal: 3 })
        await supabase.from('semesters').insert(semRows)
        setShowCreate(false)
        setNewLabel('')
        setIncludeSummer(false)
        load()
      }
    } finally {
      setCreating(false)
    }
  }

  async function saveEdit() {
    if (!editingSession || !editLabel.trim()) return
    setEditLoading(true)
    await supabase.from('academic_sessions').update({ label: editLabel.trim() }).eq('id', editingSession.id)
    setEditLoading(false)
    setEditingSession(null)
    setSessions(prev => prev.map(s => s.id === editingSession.id ? { ...s, label: editLabel.trim() } : s))
  }

  async function deleteSession() {
    if (!deletingSession) return
    setDeleteLoading(true)
    // Delete semesters first (FK), then session
    const semIds = semesters.filter(s => s.session_id === deletingSession.id).map(s => s.id)
    if (semIds.length) await supabase.from('semesters').delete().in('id', semIds)
    await supabase.from('academic_sessions').delete().eq('id', deletingSession.id)
    setDeleteLoading(false)
    setDeletingSession(null)
    load()
  }

  async function toggleActive(session: AcademicSession) {
    await supabase.from('academic_sessions').update({ is_active: !session.is_active }).eq('id', session.id)
    setSessions(prev => prev.map(s => s.id === session.id ? { ...s, is_active: !s.is_active } : s))
  }

  async function toggleSemActive(sem: Semester) {
    await supabase.from('semesters').update({ is_active: !sem.is_active }).eq('id', sem.id)
    setSemesters(prev => prev.map(s => s.id === sem.id ? { ...s, is_active: !s.is_active } : s))
  }

  return (
    <>
      <Topbar
        title="Academic Sessions"
        meta="Session and semester management"
        actions={hasCap(appUser, 'session.create') ? <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>+ New Session</Button> : undefined}
      />

      <div className="p-8 max-w-2xl space-y-4">
        {sessions.length === 0 && (
          <Card className="p-8 text-center">
            <div className="text-sm text-gray-400">No academic sessions yet.</div>
            <div className="mt-3">
              <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>Create First Session</Button>
            </div>
          </Card>
        )}

        {sessions.map(s => {
          const sems = semesters.filter(sem => sem.session_id === s.id)
          return (
            <Card key={s.id} className="p-0">
              {/* Header */}
              <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="text-sm font-bold text-navy-900">{s.label}</div>
                  {s.is_active && <Badge label="Active" bg="bg-green-100" text="text-green-700" />}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setEditingSession(s); setEditLabel(s.label) }}
                    className="text-[12px] font-semibold text-gray-500 border border-gray-200 px-2.5 py-1 rounded cursor-pointer hover:bg-gray-50"
                  >
                    Edit
                  </button>
                  <Button
                    variant={s.is_active ? 'ghost' : 'secondary'}
                    size="sm"
                    onClick={() => toggleActive(s)}
                  >
                    {s.is_active ? 'Deactivate' : 'Set Active'}
                  </Button>
                  <button
                    onClick={() => setDeletingSession(s)}
                    className="text-[12px] font-semibold text-red-400 border border-red-100 px-2.5 py-1 rounded cursor-pointer hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Semesters */}
              <div className="px-5 py-3">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Semesters</div>
                {sems.length === 0 ? (
                  <span className="text-xs text-gray-400">No semesters</span>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {sems.map(sem => (
                      <button
                        key={sem.id}
                        onClick={() => toggleSemActive(sem)}
                        title={sem.is_active ? 'Click to deactivate' : 'Click to set active'}
                        className={`flex items-center gap-1.5 border rounded px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                          sem.is_active
                            ? 'bg-green-50 border-green-200 text-green-800'
                            : 'bg-gray-50 border-gray-200 text-navy-900 hover:bg-gray-100'
                        }`}
                      >
                        {sem.label}
                        {sem.is_active && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-5 py-2 text-[10px] text-gray-400 border-t border-gray-50">
                Created {formatDate(s.created_at)}
              </div>
            </Card>
          )
        })}
      </div>

      {/* Create modal */}
      <Modal
        open={showCreate}
        title="New Academic Session"
        onClose={() => { setShowCreate(false); setNewLabel(''); setIncludeSummer(false) }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" onClick={createSession} disabled={creating || !newLabel.trim()}>
              {creating ? 'Creating…' : 'Create Session'}
            </Button>
          </>
        }
      >
        <Field label="Session Label" required>
          <Input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="e.g. 2025/2026"
            autoFocus
          />
        </Field>
        <div className="mt-4 space-y-2">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Semesters to create</div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-default">
              <input type="checkbox" checked readOnly className="rounded text-navy-700" />
              <span className="text-sm text-gray-700">First Semester</span>
            </label>
            <label className="flex items-center gap-2 cursor-default">
              <input type="checkbox" checked readOnly className="rounded text-navy-700" />
              <span className="text-sm text-gray-700">Second Semester</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSummer}
                onChange={e => setIncludeSummer(e.target.checked)}
                className="rounded text-navy-700"
              />
              <span className="text-sm text-gray-700">Summer Semester <span className="text-gray-400">(optional)</span></span>
            </label>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editingSession}
        title="Edit Session"
        onClose={() => setEditingSession(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingSession(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit} disabled={editLoading || !editLabel.trim()}>
              {editLoading ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <Field label="Session Label" required>
          <Input
            value={editLabel}
            onChange={e => setEditLabel(e.target.value)}
            autoFocus
          />
        </Field>
      </Modal>

      {/* Delete confirm */}
      <ConfirmModal
        open={!!deletingSession}
        title="Delete Session"
        message={
          <>
            Delete <strong>{deletingSession?.label}</strong>? This will also delete all semesters in this session.
          </>
        }
        warning="Course offerings, registrations, and results tied to these semesters will lose their session link. Only delete sessions with no live data."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleteLoading}
        onConfirm={deleteSession}
        onClose={() => setDeletingSession(null)}
      />
    </>
  )
}
