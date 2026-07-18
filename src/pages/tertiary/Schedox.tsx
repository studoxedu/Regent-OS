import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { AppUser } from '../../types'

interface Venue {
  id: string
  name: string
  capacity: number | null
  venue_type: string
  is_active: boolean
}

interface Lecturer { first_name: string; last_name: string }

interface TimetableEntry {
  id: string
  offering_id: string
  venue_id: string | null
  day_of_week: number
  start_time: string
  end_time: string
  venue: { name: string } | null
  offering: {
    course: { code: string; title: string }
    lecturer: { profile: Lecturer | null } | null
  } | null
}

interface ExamEntry {
  id: string
  offering_id: string
  venue_id: string | null
  exam_date: string
  start_time: string
  end_time: string
  notes: string | null
  venue: { name: string } | null
  offering: { course: { code: string; title: string } } | null
}

interface Offering {
  id: string
  course: { code: string; title: string } | null
  lecturer_membership_id: string | null
  lecturer: { profile: Lecturer | null } | null
}

interface Semester {
  id: string
  label: string
  session: { label: string }
}

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const VENUE_TYPES = ['classroom', 'lab', 'hall', 'outdoor', 'office']

// Two [start,end) intervals overlap iff each starts before the other ends.
function overlaps(s1: string, e1: string, s2: string, e2: string) {
  return s1 < e2 && s2 < e1
}

export default function Schedox({ appUser }: { appUser: AppUser }) {
  const schoolId = appUser.activeSchool?.id
  const [tab, setTab] = useState<'timetable' | 'exams' | 'venues'>('timetable')
  const [semesters, setSemesters] = useState<Semester[]>([])
  const [semesterId, setSemesterId] = useState('')
  const [timetable, setTimetable] = useState<TimetableEntry[]>([])
  const [exams, setExams] = useState<ExamEntry[]>([])
  const [venues, setVenues] = useState<Venue[]>([])
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [loading, setLoading] = useState(false)

  // Venue modal
  const [venueModal, setVenueModal] = useState(false)
  const [vName, setVName] = useState('')
  const [vCap, setVCap] = useState('')
  const [vType, setVType] = useState('classroom')
  const [saving, setSaving] = useState(false)

  // Timetable-entry modal
  const [ttModal, setTtModal] = useState(false)
  const [ttOffering, setTtOffering] = useState('')
  const [ttDay, setTtDay] = useState('1')
  const [ttStart, setTtStart] = useState('09:00')
  const [ttEnd, setTtEnd] = useState('11:00')
  const [ttVenue, setTtVenue] = useState('')
  const [ttErr, setTtErr] = useState('')

  // Exam-entry modal
  const [exModal, setExModal] = useState(false)
  const [exOffering, setExOffering] = useState('')
  const [exDate, setExDate] = useState('')
  const [exStart, setExStart] = useState('09:00')
  const [exEnd, setExEnd] = useState('12:00')
  const [exVenue, setExVenue] = useState('')
  const [exNotes, setExNotes] = useState('')
  const [exErr, setExErr] = useState('')

  const activeVenues = venues.filter(v => v.is_active)

  useEffect(() => {
    if (!schoolId) return
    supabase
      .from('semesters')
      .select('id, label, session:academic_sessions!session_id(label)')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const s = (data ?? []) as unknown as Semester[]
        setSemesters(s)
        if (s.length) setSemesterId(s[0].id)
      })
    loadVenues()
  }, [schoolId])

  useEffect(() => {
    if (!semesterId) return
    loadOfferings()
    if (tab === 'timetable') loadTimetable()
    if (tab === 'exams') loadExams()
  }, [semesterId, tab])

  function loadVenues() {
    supabase
      .from('venues')
      .select('*')
      .eq('institution_id', schoolId)
      .order('name')
      .then(({ data }) => setVenues((data ?? []) as Venue[]))
  }

  function loadOfferings() {
    supabase
      .from('course_offerings')
      .select(`id, lecturer_membership_id,
        course:courses!course_id(code,title),
        lecturer:memberships!lecturer_membership_id(profile:profiles!profile_id(first_name,last_name))`)
      .eq('semester_id', semesterId)
      .then(({ data }) => setOfferings((data ?? []) as unknown as Offering[]))
  }

  function loadTimetable() {
    setLoading(true)
    supabase
      .from('timetable_entries')
      .select(`id, offering_id, venue_id, day_of_week, start_time, end_time,
        venue:venues!venue_id(name),
        offering:course_offerings!offering_id(
          course:courses!course_id(code,title),
          lecturer:memberships!lecturer_membership_id(profile:profiles!profile_id(first_name,last_name))
        )`)
      .eq('semester_id', semesterId)
      .order('day_of_week')
      .order('start_time')
      .then(({ data }) => { setTimetable((data ?? []) as unknown as TimetableEntry[]); setLoading(false) })
  }

  function loadExams() {
    setLoading(true)
    supabase
      .from('exam_entries')
      .select(`id, offering_id, venue_id, exam_date, start_time, end_time, notes,
        venue:venues!venue_id(name),
        offering:course_offerings!offering_id(course:courses!course_id(code,title))`)
      .eq('semester_id', semesterId)
      .order('exam_date')
      .order('start_time')
      .then(({ data }) => { setExams((data ?? []) as unknown as ExamEntry[]); setLoading(false) })
  }

  async function addVenue() {
    if (!vName.trim() || !schoolId) return
    setSaving(true)
    await supabase.from('venues').insert({
      institution_id: schoolId,
      name: vName.trim(),
      capacity: vCap ? parseInt(vCap) : null,
      venue_type: vType,
    })
    setSaving(false)
    setVenueModal(false)
    setVName(''); setVCap(''); setVType('classroom')
    loadVenues()
  }

  async function toggleVenue(v: Venue) {
    await supabase.from('venues').update({ is_active: !v.is_active }).eq('id', v.id)
    loadVenues()
  }

  function openTt() {
    setTtOffering(offerings[0]?.id ?? '')
    setTtDay('1'); setTtStart('09:00'); setTtEnd('11:00')
    setTtVenue(''); setTtErr('')
    setTtModal(true)
  }

  async function addTimetableEntry() {
    if (!ttOffering) { setTtErr('Choose a course.'); return }
    if (ttEnd <= ttStart) { setTtErr('End time must be after start time.'); return }
    const day = parseInt(ttDay)
    const off = offerings.find(o => o.id === ttOffering)
    const lecturerId = off?.lecturer_membership_id ?? null

    // Clash detection against everything already scheduled this semester/day.
    for (const e of timetable) {
      if (e.day_of_week !== day) continue
      if (!overlaps(ttStart, ttEnd, e.start_time.slice(0, 5), e.end_time.slice(0, 5))) continue
      if (ttVenue && e.venue_id === ttVenue) {
        setTtErr(`Venue clash: ${venues.find(v => v.id === ttVenue)?.name} is already booked ${DAYS[day]} ${e.start_time.slice(0,5)}–${e.end_time.slice(0,5)} for ${e.offering?.course?.code}.`)
        return
      }
      const eLect = offerings.find(o => o.id === e.offering_id)?.lecturer_membership_id
      if (lecturerId && eLect && eLect === lecturerId) {
        setTtErr(`Lecturer clash: this lecturer already teaches ${e.offering?.course?.code} ${DAYS[day]} ${e.start_time.slice(0,5)}–${e.end_time.slice(0,5)}.`)
        return
      }
    }

    setSaving(true)
    const { error } = await supabase.from('timetable_entries').insert({
      semester_id: semesterId,
      offering_id: ttOffering,
      venue_id: ttVenue || null,
      day_of_week: day,
      start_time: ttStart,
      end_time: ttEnd,
    })
    setSaving(false)
    if (error) { setTtErr(error.message); return }
    setTtModal(false)
    loadTimetable()
  }

  function openEx() {
    setExOffering(offerings[0]?.id ?? '')
    setExDate(''); setExStart('09:00'); setExEnd('12:00')
    setExVenue(''); setExNotes(''); setExErr('')
    setExModal(true)
  }

  async function addExamEntry() {
    if (!exOffering) { setExErr('Choose a course.'); return }
    if (!exDate) { setExErr('Pick an exam date.'); return }
    if (exEnd <= exStart) { setExErr('End time must be after start time.'); return }

    for (const e of exams) {
      if (e.exam_date !== exDate) continue
      if (!overlaps(exStart, exEnd, e.start_time.slice(0, 5), e.end_time.slice(0, 5))) continue
      if (exVenue && e.venue_id === exVenue) {
        setExErr(`Venue clash: ${venues.find(v => v.id === exVenue)?.name} already has ${e.offering?.course?.code} on this date ${e.start_time.slice(0,5)}–${e.end_time.slice(0,5)}.`)
        return
      }
    }

    setSaving(true)
    const { error } = await supabase.from('exam_entries').insert({
      semester_id: semesterId,
      offering_id: exOffering,
      venue_id: exVenue || null,
      exam_date: exDate,
      start_time: exStart,
      end_time: exEnd,
      notes: exNotes.trim() || null,
    })
    setSaving(false)
    if (error) { setExErr(error.message); return }
    setExModal(false)
    loadExams()
  }

  async function deleteTimetableEntry(id: string) {
    if (!confirm('Remove this timetable slot?')) return
    await supabase.from('timetable_entries').delete().eq('id', id)
    loadTimetable()
  }

  async function deleteExamEntry(id: string) {
    if (!confirm('Remove this exam?')) return
    await supabase.from('exam_entries').delete().eq('id', id)
    loadExams()
  }

  // Group timetable by day
  const byDay: Record<number, TimetableEntry[]> = {}
  timetable.forEach(e => { (byDay[e.day_of_week] ??= []).push(e) })

  const inputCls = 'w-full border border-gray-200 rounded px-3 py-1.5 text-[13px]'
  const labelCls = 'block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1'

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-[20px] font-bold text-navy-900 mb-4">Schedox</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(['timetable','exams','venues'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-[13px] font-medium capitalize border-b-2 -mb-px cursor-pointer
              ${tab === t ? 'border-amber-500 text-navy-900' : 'border-transparent text-gray-500 hover:text-navy-900'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Semester selector + add button (timetable + exams tabs) */}
      {tab !== 'venues' && (
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <label className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Semester</label>
            <select value={semesterId} onChange={e => setSemesterId(e.target.value)}
              className="border border-gray-200 rounded px-2 py-1 text-[13px] text-navy-900 bg-white">
              {semesters.map(s => (
                <option key={s.id} value={s.id}>{s.session?.label} — {s.label}</option>
              ))}
            </select>
          </div>
          <button onClick={tab === 'timetable' ? openTt : openEx}
            disabled={!semesterId || offerings.length === 0}
            className="px-3 py-1.5 bg-amber-500 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-amber-600 disabled:opacity-50">
            {tab === 'timetable' ? '+ Add Class' : '+ Add Exam'}
          </button>
        </div>
      )}

      {/* Timetable */}
      {tab === 'timetable' && (
        <div>
          {loading ? (
            <p className="text-[13px] text-gray-400">Loading…</p>
          ) : timetable.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-[13px]">
              No classes scheduled yet. Use “Add Class” to build the timetable.
            </div>
          ) : (
            <div className="space-y-4">
              {[1,2,3,4,5].map(d => !byDay[d] ? null : (
                <div key={d}>
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">{DAYS[d]}</div>
                  <div className="space-y-1">
                    {byDay[d].map(e => (
                      <div key={e.id} className="flex items-center gap-4 px-4 py-2.5 bg-white border border-gray-100 rounded-lg group">
                        <span className="text-[12px] text-gray-400 w-24 flex-shrink-0">
                          {e.start_time.slice(0,5)} – {e.end_time.slice(0,5)}
                        </span>
                        <span className="text-[13px] font-semibold text-navy-900 flex-1">
                          {e.offering?.course?.code} — {e.offering?.course?.title}
                        </span>
                        {e.venue && <span className="text-[12px] text-gray-500">{e.venue.name}</span>}
                        {e.offering?.lecturer?.profile && (
                          <span className="text-[12px] text-gray-400">
                            {e.offering.lecturer.profile.first_name} {e.offering.lecturer.profile.last_name}
                          </span>
                        )}
                        <button onClick={() => deleteTimetableEntry(e.id)}
                          className="text-[11px] text-red-500 opacity-0 group-hover:opacity-100 cursor-pointer hover:underline">
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Exams */}
      {tab === 'exams' && (
        <div>
          {loading ? (
            <p className="text-[13px] text-gray-400">Loading…</p>
          ) : exams.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-[13px]">
              No exams scheduled yet. Use “Add Exam” to build the exam timetable.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-gray-200">
                  {['Date','Time','Course','Venue','Notes',''].map(h => (
                    <th key={h} className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exams.map(e => (
                  <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50 group">
                    <td className="py-2.5 text-navy-900">{new Date(e.exam_date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}</td>
                    <td className="py-2.5 text-gray-500">{e.start_time.slice(0,5)} – {e.end_time.slice(0,5)}</td>
                    <td className="py-2.5 font-medium text-navy-900">{e.offering?.course?.code} — {e.offering?.course?.title}</td>
                    <td className="py-2.5 text-gray-500">{e.venue?.name ?? '—'}</td>
                    <td className="py-2.5 text-gray-400">{e.notes ?? '—'}</td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => deleteExamEntry(e.id)}
                        className="text-[11px] text-red-500 opacity-0 group-hover:opacity-100 cursor-pointer hover:underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Venues */}
      {tab === 'venues' && (
        <div>
          <div className="flex justify-end mb-4">
            <button onClick={() => setVenueModal(true)}
              className="px-3 py-1.5 bg-amber-500 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-amber-600">
              + Add Venue
            </button>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-gray-200">
                {['Name','Type','Capacity','Status'].map(h => (
                  <th key={h} className="text-left py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {venues.map(v => (
                <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2.5 font-medium text-navy-900">{v.name}</td>
                  <td className="py-2.5 capitalize text-gray-600">{v.venue_type}</td>
                  <td className="py-2.5 text-gray-600">{v.capacity ?? '—'}</td>
                  <td className="py-2.5">
                    <button onClick={() => toggleVenue(v)}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer border
                        ${v.is_active ? 'text-green-700 bg-green-50 border-green-200 hover:bg-green-100'
                                      : 'text-gray-500 bg-gray-50 border-gray-200 hover:bg-gray-100'}`}>
                      {v.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                </tr>
              ))}
              {venues.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-gray-400">No venues yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Class Modal */}
      {ttModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-4">Add Class to Timetable</h2>
            {ttErr && <div className="mb-3 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{ttErr}</div>}
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Course</label>
                <select value={ttOffering} onChange={e => setTtOffering(e.target.value)} className={inputCls}>
                  {offerings.map(o => <option key={o.id} value={o.id}>{o.course?.code} — {o.course?.title}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Day</label>
                  <select value={ttDay} onChange={e => setTtDay(e.target.value)} className={inputCls}>
                    {[1,2,3,4,5].map(d => <option key={d} value={d}>{DAYS[d]}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Start</label>
                  <input type="time" value={ttStart} onChange={e => setTtStart(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>End</label>
                  <input type="time" value={ttEnd} onChange={e => setTtEnd(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Venue</label>
                <select value={ttVenue} onChange={e => setTtVenue(e.target.value)} className={inputCls}>
                  <option value="">— No venue —</option>
                  {activeVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setTtModal(false)} className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">Cancel</button>
              <button onClick={addTimetableEntry} disabled={saving} className="px-4 py-1.5 bg-navy-900 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-navy-800 disabled:opacity-50">
                {saving ? 'Adding…' : 'Add to Timetable'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Exam Modal */}
      {exModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-4">Schedule an Exam</h2>
            {exErr && <div className="mb-3 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{exErr}</div>}
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Course</label>
                <select value={exOffering} onChange={e => setExOffering(e.target.value)} className={inputCls}>
                  {offerings.map(o => <option key={o.id} value={o.id}>{o.course?.code} — {o.course?.title}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Date</label>
                  <input type="date" value={exDate} onChange={e => setExDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Start</label>
                  <input type="time" value={exStart} onChange={e => setExStart(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>End</label>
                  <input type="time" value={exEnd} onChange={e => setExEnd(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Venue</label>
                <select value={exVenue} onChange={e => setExVenue(e.target.value)} className={inputCls}>
                  <option value="">— No venue —</option>
                  {activeVenues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <input value={exNotes} onChange={e => setExNotes(e.target.value)} placeholder="Optional" className={inputCls} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setExModal(false)} className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">Cancel</button>
              <button onClick={addExamEntry} disabled={saving} className="px-4 py-1.5 bg-navy-900 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-navy-800 disabled:opacity-50">
                {saving ? 'Scheduling…' : 'Schedule Exam'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Venue Modal */}
      {venueModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-4">Add Venue</h2>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Name</label>
                <input value={vName} onChange={e => setVName(e.target.value)} placeholder="e.g. Lecture Theatre 2" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select value={vType} onChange={e => setVType(e.target.value)} className={`${inputCls} capitalize`}>
                  {VENUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Capacity</label>
                <input value={vCap} onChange={e => setVCap(e.target.value)} placeholder="Optional" type="number" className={inputCls} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setVenueModal(false)} className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">Cancel</button>
              <button onClick={addVenue} disabled={saving || !vName.trim()} className="px-3 py-1.5 bg-amber-500 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-amber-600 disabled:opacity-50">
                {saving ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
