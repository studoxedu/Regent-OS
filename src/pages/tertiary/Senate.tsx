import { useCallback, useEffect, useState } from 'react'
import { flowExecute, supabase } from '../../lib/supabase'
import { getInstitutionLabels } from '../../lib/institution'
import type { AppUser } from '../../types'

interface Semester {
  id: string
  label: string
  session: { id: string; label: string }
}

interface OfferingSummary {
  total: number
  published: number
}

interface Ratification {
  id: string
  resolution_number: string | null
  meeting_date: string | null
  ratified_at: string
  notes: string | null
  ratified_by_user_id: string | null
}

interface AuditEntry {
  id: string
  capability: string
  actor_user_id: string
  actor_office: string | null
  created_at: string
  payload: Record<string, unknown>
}

const CAP_LABEL: Record<string, string> = {
  'results.submit':  'Scores Submitted',
  'results.verify':  'Results Verified',
  'results.approve': 'Results Approved',
  'results.publish': 'Results Published',
  'results.reject':  'Results Rejected',
}

const OFFICE_LABEL: Record<string, string> = {
  lecturer:     'Lecturer',
  exam_officer: 'Exam Officer',
  hod:          'HOD',
  dean:         'Dean',
  school_admin: 'Administration',
}

export default function Senate({ appUser }: { appUser: AppUser }) {
  const schoolId = appUser.activeSchool?.id
  const labels   = getInstitutionLabels(appUser.activeSchool?.institution_type)

  const [semesters, setSemesters]         = useState<Semester[]>([])
  const [summaries, setSummaries]         = useState<Record<string, OfferingSummary>>({})
  const [ratifications, setRatifications] = useState<Record<string, Ratification>>({})
  const [profiles, setProfiles]           = useState<Record<string, string>>({})
  const [loading, setLoading]             = useState(true)

  // Audit trail
  const [auditSemId, setAuditSemId] = useState<string | null>(null)
  const [auditLog, setAuditLog]     = useState<AuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  // Ratification modal
  const [ratifyModal, setRatifyModal] = useState<Semester | null>(null)
  const [resNum, setResNum]           = useState('')
  const [meetDate, setMeetDate]       = useState('')
  const [notes, setNotes]             = useState('')
  const [ratifying, setRatifying]     = useState(false)
  const [ratifyErr, setRatifyErr]     = useState('')
  const [ratifyOk, setRatifyOk]       = useState('')

  const load = useCallback(async () => {
    if (!schoolId) return
    setLoading(true)

    const { data: semData } = await supabase
      .from('semesters')
      .select('id, label, session:academic_sessions!session_id(id, label)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })

    const sems = (semData ?? []) as unknown as Semester[]
    setSemesters(sems)

    // Offering summaries per semester
    const { data: offData } = await supabase
      .from('course_offerings')
      .select('semester_id, results_status')
      .in('semester_id', sems.map(s => s.id))

    const sum: Record<string, OfferingSummary> = {}
    for (const o of (offData ?? [])) {
      if (!sum[o.semester_id]) sum[o.semester_id] = { total: 0, published: 0 }
      sum[o.semester_id].total++
      if (o.results_status === 'published') sum[o.semester_id].published++
    }
    setSummaries(sum)

    // Ratifications
    const { data: ratData } = await supabase
      .from('senate_ratifications')
      .select('id, semester_id, resolution_number, meeting_date, ratified_at, notes, ratified_by_user_id')
      .eq('school_id', schoolId)

    const ratMap: Record<string, Ratification> = {}
    const userIds: string[] = []
    for (const r of (ratData ?? []) as any[]) {
      ratMap[r.semester_id] = r
      if (r.ratified_by_user_id) userIds.push(r.ratified_by_user_id)
    }
    setRatifications(ratMap)

    // Load ratifier names
    if (userIds.length) {
      const { data: pData } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', userIds)
      const pm: Record<string, string> = {}
      for (const p of (pData ?? []) as any[]) {
        pm[p.id] = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
      }
      setProfiles(pm)
    }

    setLoading(false)
  }, [schoolId])

  useEffect(() => { load() }, [load])

  async function openAudit(semId: string) {
    if (auditSemId === semId) { setAuditSemId(null); return }
    setAuditSemId(semId)
    setAuditLoading(true)
    const { data } = await supabase.rpc('get_semester_audit_log', { p_semester_id: semId })
    setAuditLog((data ?? []) as AuditEntry[])
    setAuditLoading(false)
  }

  async function ratify() {
    if (!ratifyModal || !schoolId) return
    setRatifying(true); setRatifyErr('')
    try {
      await flowExecute('senate.ratify', schoolId, {
        semester_id:       ratifyModal.id,
        resolution_number: resNum || null,
        meeting_date:      meetDate || null,
        notes:             notes || null,
      })
    } catch (err) {
      setRatifying(false)
      setRatifyErr(err instanceof Error ? err.message : 'Ratification failed')
      return
    }
    setRatifying(false)
    setRatifyOk(`${ratifyModal.session.label} — ${ratifyModal.label} ratified successfully.`)
    setRatifyModal(null)
    setResNum(''); setMeetDate(''); setNotes('')
    load()
  }

  // Group semesters by session
  const grouped: Record<string, { session: { id: string; label: string }; sems: Semester[] }> = {}
  for (const s of semesters) {
    const key = s.session.id
    if (!grouped[key]) grouped[key] = { session: s.session, sems: [] }
    grouped[key].sems.push(s)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[20px] font-bold text-navy-900">{labels.senate}</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">Formal ratification of semester results. Students cannot view results until ratified.</p>
      </div>

      {ratifyOk && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded text-[13px] text-green-700">
          {ratifyOk}
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-gray-400">Loading…</p>
      ) : semesters.length === 0 ? (
        <p className="text-[13px] text-gray-400">No semesters found.</p>
      ) : (
        <div className="space-y-6">
          {Object.values(grouped).map(({ session, sems }) => (
            <div key={session.id}>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                {session.label}
              </div>
              <div className="space-y-2">
                {sems.map(sem => {
                  const sum = summaries[sem.id] ?? { total: 0, published: 0 }
                  const rat = ratifications[sem.id]
                  const allPublished = sum.total > 0 && sum.published === sum.total
                  const canRatify   = allPublished && !rat
                  const isAuditOpen = auditSemId === sem.id

                  return (
                    <div key={sem.id} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                      <div className="flex items-center gap-4 px-5 py-4">
                        {/* Semester label */}
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-semibold text-navy-900">{sem.label}</div>
                          {rat ? (
                            <div className="text-[12px] text-green-700 mt-0.5 flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                              Ratified {rat.meeting_date ? `— ${new Date(rat.meeting_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}` : ''}
                              {rat.resolution_number && <span className="text-gray-400">· {rat.resolution_number}</span>}
                              {rat.ratified_by_user_id && profiles[rat.ratified_by_user_id] && (
                                <span className="text-gray-400">· by {profiles[rat.ratified_by_user_id]}</span>
                              )}
                            </div>
                          ) : sum.total === 0 ? (
                            <div className="text-[12px] text-gray-400 mt-0.5">No offerings</div>
                          ) : (
                            <div className="text-[12px] text-gray-500 mt-0.5">
                              {sum.published}/{sum.total} offerings published
                              {!allPublished && <span className="text-amber-600 ml-1">— publication pending</span>}
                            </div>
                          )}
                        </div>

                        {/* Status badge */}
                        <div className="flex-shrink-0">
                          {rat ? (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200">
                              Ratified
                            </span>
                          ) : allPublished ? (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200">
                              Awaiting Ratification
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold text-gray-500 bg-gray-50 border border-gray-200">
                              {sum.total === 0 ? 'No Offerings' : 'Publishing Incomplete'}
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {sum.total > 0 && (
                            <button onClick={() => openAudit(sem.id)}
                              className="px-2 py-1 text-[11px] text-navy-600 border border-navy-200 rounded cursor-pointer hover:bg-navy-50">
                              {isAuditOpen ? 'Hide Audit' : 'Audit Trail'}
                            </button>
                          )}
                          {canRatify && (
                            <button
                              onClick={() => { setRatifyModal(sem); setRatifyErr(''); setResNum(''); setMeetDate(''); setNotes('') }}
                              className="px-3 py-1 text-[12px] font-semibold text-white bg-navy-900 rounded cursor-pointer hover:bg-navy-800">
                              Ratify Results
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Audit trail */}
                      {isAuditOpen && (
                        <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                            Result Audit Trail
                          </div>
                          {auditLoading ? (
                            <p className="text-[13px] text-gray-400">Loading…</p>
                          ) : auditLog.length === 0 ? (
                            <p className="text-[13px] text-gray-400">No result actions recorded for this semester.</p>
                          ) : (
                            <div className="space-y-1">
                              {auditLog.map(entry => (
                                <div key={entry.id} className="flex items-start gap-3 text-[12px]">
                                  <span className="text-gray-400 flex-shrink-0 w-32">
                                    {new Date(entry.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                                    {' '}{new Date(entry.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
                                  </span>
                                  <span className={`font-semibold flex-shrink-0 w-36 ${
                                    entry.capability === 'results.publish'  ? 'text-green-700'  :
                                    entry.capability === 'results.approve'  ? 'text-purple-700' :
                                    entry.capability === 'results.verify'   ? 'text-blue-700'   :
                                    entry.capability === 'results.reject'   ? 'text-red-700'    :
                                    'text-gray-700'
                                  }`}>
                                    {CAP_LABEL[entry.capability] ?? entry.capability}
                                  </span>
                                  {entry.actor_office && (
                                    <span className="text-gray-600 flex-shrink-0 w-28">
                                      {OFFICE_LABEL[entry.actor_office] ?? entry.actor_office}
                                    </span>
                                  )}
                                  <span className="text-gray-500 font-mono text-[11px]">
                                    offering: {String(entry.payload?.offering_id ?? '').slice(0,8)}…
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ratification modal */}
      {ratifyModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-1">Ratify Results</h2>
            <p className="text-[13px] text-gray-500 mb-4">
              {ratifyModal.session.label} — {ratifyModal.label}
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-[12px] text-amber-800 mb-4">
              This action is permanent. Once ratified, students will be able to view their results.
            </div>

            {ratifyErr && (
              <div className="mb-3 text-[13px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {ratifyErr}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Resolution Number
                </label>
                <input value={resNum} onChange={e => setResNum(e.target.value)}
                  placeholder="e.g. SEN/2025/001"
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-[13px]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Meeting Date
                </label>
                <input type="date" value={meetDate} onChange={e => setMeetDate(e.target.value)}
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-[13px]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Notes
                </label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={3} placeholder={`Optional ${labels.senate.toLowerCase()} minute reference or remarks`}
                  className="w-full border border-gray-200 rounded px-3 py-1.5 text-[13px] resize-none" />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setRatifyModal(null)}
                className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={ratify} disabled={ratifying}
                className="px-4 py-1.5 bg-navy-900 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-navy-800 disabled:opacity-50">
                {ratifying ? 'Ratifying…' : 'Confirm Ratification'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
