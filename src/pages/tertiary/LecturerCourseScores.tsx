import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import type { AppUser, GradeScale } from '../../types'

interface Props { appUser: AppUser }

interface StudentRow {
  reg_id: string
  reg_number: string
  first_name: string
  last_name: string
  ca_score: number | null
  exam_score: number | null
  dirty: boolean
  saving: boolean
}

interface OfferingInfo {
  course_code: string
  course_title: string
  semester_label: string
  session_label: string
  results_status: string
}

interface Material {
  id: string
  title: string
  file_name: string
  file_path: string
  file_size: number | null
  file_type: string | null
  created_at: string
}

interface Announcement {
  id: string
  title: string
  body: string
  created_at: string
}

interface BoardMembership {
  board_id: string
  board_name: string
}

interface BoardSubmission {
  id: string
  board_id: string
  status: 'pending' | 'reviewed' | 'ratified' | 'rejected'
  note: string | null
  submitted_at: string
}

function calcResult(ca: number | null, exam: number | null, scales: GradeScale[]) {
  if (ca === null || exam === null) return null
  const total = ca + exam
  const s = scales.find(g => total >= g.min_score && total <= g.max_score)
  return s ? { total, grade: s.grade, gp: s.grade_point } : { total, grade: '—', gp: 0 }
}

function fmtSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(type: string | null) {
  if (!type) return 'FILE'
  if (type.includes('pdf')) return 'PDF'
  if (type.includes('word') || type.includes('document')) return 'DOC'
  if (type.includes('sheet') || type.includes('excel')) return 'XLS'
  if (type.includes('presentation') || type.includes('powerpoint')) return 'PPT'
  if (type.startsWith('image/')) return 'IMG'
  if (type.startsWith('video/')) return 'VID'
  if (type.includes('zip') || type.includes('compressed')) return 'ZIP'
  return 'FILE'
}

const STATUS_STYLE: Record<string, string> = {
  draft:     'bg-navy-700 text-navy-300',
  submitted: 'bg-amber-900/40 text-amber-400',
  verified:  'bg-blue-900/40 text-blue-300',
  approved:  'bg-green-900/40 text-green-400',
  published: 'bg-green-800/60 text-green-300',
}

export default function LecturerCourseScores({ appUser }: Props) {
  const { offeringId } = useParams<{ offeringId: string }>()
  const schoolId = appUser.activeSchool?.id
  const activeMembershipId = appUser.activeMembership?.id

  const [tab, setTab] = useState<'scores' | 'roster' | 'announcements' | 'materials' | 'board'>('scores')
  const [rosterSearch, setRosterSearch] = useState('')

  // Board submissions
  const [lecturerBoards,    setLecturerBoards]   = useState<BoardMembership[]>([])
  const [boardSubmissions,  setBoardSubmissions]  = useState<BoardSubmission[]>([])
  const [selectedBoardId,   setSelectedBoardId]   = useState('')
  const [submissionNote,    setSubmissionNote]    = useState('')
  const [submittingToBoard, setSubmittingToBoard] = useState(false)
  const [boardSubError,     setBoardSubError]     = useState<string | null>(null)
  const [boardSubSuccess,   setBoardSubSuccess]   = useState<string | null>(null)

  // Scores
  const [offering, setOffering]     = useState<OfferingInfo | null>(null)
  const [rows, setRows]             = useState<StudentRow[]>([])
  const [gradeScales, setScales]    = useState<GradeScale[]>([])
  const [loading, setLoading]       = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // Materials
  const [materials, setMaterials]       = useState<Material[]>([])
  const [matLoading, setMatLoading]     = useState(false)
  const [uploading, setUploading]       = useState(false)
  const [matTitle, setMatTitle]         = useState('')
  const [pickedFile, setPickedFile]     = useState<File | null>(null)
  const [matError, setMatError]         = useState<string | null>(null)
  const [matSuccess, setMatSuccess]     = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Announcements
  const [announcements, setAnnouncements]   = useState<Announcement[]>([])
  const [annLoading, setAnnLoading]         = useState(false)
  const [annTitle, setAnnTitle]             = useState('')
  const [annBody, setAnnBody]               = useState('')
  const [posting, setPosting]               = useState(false)
  const [annError, setAnnError]             = useState<string | null>(null)
  const [annSuccess, setAnnSuccess]         = useState<string | null>(null)

  useEffect(() => {
    if (!offeringId) return
    setLoading(true)
    setError(null)
    setTab('scores')
    load()
    loadMaterials()
    loadAnnouncements()
    loadBoardSubmissions()
  }, [offeringId])

  useEffect(() => {
    loadLecturerBoards()
  }, [appUser.profile.id])

  async function load() {
    const { data: off, error: offErr } = await supabase
      .from('course_offerings')
      .select('results_status, course:courses(code, title), semester:semesters(label, session:academic_sessions(label))')
      .eq('id', offeringId!)
      .single()

    if (offErr || !off) { setError('Course offering not found.'); setLoading(false); return }

    setOffering({
      course_code:    (off.course as any)?.code    ?? '',
      course_title:   (off.course as any)?.title   ?? '',
      semester_label: (off.semester as any)?.label ?? '',
      session_label:  (off.semester as any)?.session?.label ?? '',
      results_status: off.results_status,
    })

    if (schoolId) {
      const { data: gs } = await supabase
        .from('grade_scales')
        .select('*')
        .eq('school_id', schoolId)
        .order('min_score', { ascending: false })
      setScales((gs ?? []) as GradeScale[])
    }

    const { data: regs, error: regErr } = await supabase
      .from('course_registrations')
      .select('id, ca_score, exam_score, student:students(id, reg_number, first_name, last_name)')
      .eq('offering_id', offeringId!)
      .not('student_id', 'is', null)

    if (regErr) { setError(regErr.message); setLoading(false); return }

    setRows(
      (regs ?? [])
        .map(r => ({
          reg_id:     r.id,
          reg_number: (r.student as any)?.reg_number ?? '',
          first_name: (r.student as any)?.first_name ?? '',
          last_name:  (r.student as any)?.last_name  ?? '',
          ca_score:   r.ca_score   ?? null,
          exam_score: r.exam_score ?? null,
          dirty:   false,
          saving:  false,
        }))
        .sort((a, b) => a.reg_number.localeCompare(b.reg_number))
    )
    setLoading(false)
  }

  async function loadMaterials() {
    setMatLoading(true)
    const { data } = await supabase
      .from('course_materials')
      .select('id, title, file_name, file_path, file_size, file_type, created_at')
      .eq('offering_id', offeringId!)
      .order('created_at', { ascending: false })
    setMaterials((data ?? []) as Material[])
    setMatLoading(false)
  }

  async function loadAnnouncements() {
    setAnnLoading(true)
    const { data } = await supabase
      .from('course_announcements')
      .select('id, title, body, created_at')
      .eq('offering_id', offeringId!)
      .order('created_at', { ascending: false })
    setAnnouncements((data ?? []) as Announcement[])
    setAnnLoading(false)
  }

  async function handlePost() {
    if (!annTitle.trim()) { setAnnError('Enter a title.'); return }
    if (!annBody.trim())  { setAnnError('Enter a message.'); return }
    if (!offeringId || !activeMembershipId) return
    setPosting(true)
    setAnnError(null)
    const { error } = await supabase.from('course_announcements').insert({
      offering_id:             offeringId,
      posted_by_membership_id: activeMembershipId,
      title: annTitle.trim(),
      body:  annBody.trim(),
    })
    if (error) { setAnnError(error.message); setPosting(false); return }
    setAnnTitle('')
    setAnnBody('')
    setAnnSuccess('Announcement posted — all enrolled students have been notified.')
    setTimeout(() => setAnnSuccess(null), 4000)
    setPosting(false)
    loadAnnouncements()
  }

  async function handleDeleteAnnouncement(id: string) {
    await supabase.from('course_announcements').delete().eq('id', id)
    setAnnouncements(prev => prev.filter(a => a.id !== id))
  }

  async function loadLecturerBoards() {
    const { data } = await supabase
      .from('board_members')
      .select('board_id, board:boards!board_id(id, name)')
      .eq('user_id', appUser.profile.id)
    setLecturerBoards(
      (data ?? []).map((m: any) => ({ board_id: m.board_id, board_name: m.board?.name ?? '—' }))
    )
  }

  async function loadBoardSubmissions() {
    if (!offeringId) return
    const { data } = await supabase
      .from('board_submissions')
      .select('id, board_id, status, note, submitted_at')
      .eq('offering_id', offeringId)
    setBoardSubmissions((data ?? []) as BoardSubmission[])
  }

  async function handleSubmitToBoard() {
    if (!selectedBoardId || !offeringId || !activeMembershipId) return
    setSubmittingToBoard(true)
    setBoardSubError(null)
    const { error } = await supabase.from('board_submissions').insert({
      board_id:                   selectedBoardId,
      offering_id:                offeringId,
      submitted_by_membership_id: activeMembershipId,
      note:                       submissionNote.trim() || null,
    })
    setSubmittingToBoard(false)
    if (error) {
      setBoardSubError(error.code === '23505' ? 'Already submitted to this board.' : error.message)
      return
    }
    setBoardSubSuccess('Submitted to board for ratification.')
    setTimeout(() => setBoardSubSuccess(null), 4000)
    setSubmissionNote('')
    setSelectedBoardId('')
    loadBoardSubmissions()
  }

  async function handleUpload() {
    if (!pickedFile) { setMatError('Choose a file first.'); return }
    if (!matTitle.trim()) { setMatError('Enter a title.'); return }
    if (!offeringId || !activeMembershipId) return

    const MAX = 50 * 1024 * 1024
    if (pickedFile.size > MAX) { setMatError('File exceeds 50 MB limit.'); return }

    setUploading(true)
    setMatError(null)

    const safe = pickedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${offeringId}/${Date.now()}-${safe}`

    const { error: upErr } = await supabase.storage
      .from('course-materials')
      .upload(path, pickedFile, { contentType: pickedFile.type, upsert: false })

    if (upErr) { setMatError(upErr.message); setUploading(false); return }

    const { error: dbErr } = await supabase.from('course_materials').insert({
      offering_id:               offeringId,
      uploaded_by_membership_id: activeMembershipId,
      title:     matTitle.trim(),
      file_name: pickedFile.name,
      file_path: path,
      file_size: pickedFile.size,
      file_type: pickedFile.type,
    })

    if (dbErr) {
      await supabase.storage.from('course-materials').remove([path])
      setMatError(dbErr.message)
      setUploading(false)
      return
    }

    setMatTitle('')
    setPickedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setMatSuccess('Material uploaded.')
    setTimeout(() => setMatSuccess(null), 3000)
    setUploading(false)
    loadMaterials()
  }

  async function handleDelete(mat: Material) {
    await supabase.storage.from('course-materials').remove([mat.file_path])
    await supabase.from('course_materials').delete().eq('id', mat.id)
    setMaterials(prev => prev.filter(m => m.id !== mat.id))
  }

  async function handleDownload(mat: Material) {
    const { data } = await supabase.storage
      .from('course-materials')
      .createSignedUrl(mat.file_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  // Scores helpers
  function setScore(regId: string, field: 'ca_score' | 'exam_score', val: string) {
    setRows(prev => prev.map(r => {
      if (r.reg_id !== regId) return r
      const other = field === 'ca_score' ? (r.exam_score ?? 0) : (r.ca_score ?? 0)
      const maxAllowed = Math.max(0, 100 - other)
      const num = val === '' ? null : Math.min(maxAllowed, Math.max(0, Number(val)))
      return { ...r, [field]: num !== null && isNaN(num) ? null : num, dirty: true }
    }))
  }

  async function saveRow(regId: string) {
    const row = rows.find(r => r.reg_id === regId)
    if (!row) return
    setRows(prev => prev.map(r => r.reg_id === regId ? { ...r, saving: true } : r))
    const result = calcResult(row.ca_score, row.exam_score, gradeScales)
    const grade  = result?.grade && result.grade !== '—' ? result.grade : null
    const { error: e } = await supabase
      .from('course_registrations')
      .update({ ca_score: row.ca_score, exam_score: row.exam_score, grade })
      .eq('id', regId)
    if (e) setError(e.message)
    setRows(prev => prev.map(r => r.reg_id === regId ? { ...r, dirty: false, saving: false } : r))
  }

  async function saveAll() {
    for (const r of rows.filter(r => r.dirty)) await saveRow(r.reg_id)
  }

  async function submitResults() {
    setSubmitting(true)
    // Compute and persist grades for every row before changing status
    for (const r of rows) {
      const result = calcResult(r.ca_score, r.exam_score, gradeScales)
      const grade  = result?.grade && result.grade !== '—' ? result.grade : null
      await supabase.from('course_registrations')
        .update({ ca_score: r.ca_score, exam_score: r.exam_score, grade })
        .eq('id', r.reg_id)
    }
    await supabase.from('course_offerings').update({ results_status: 'submitted' }).eq('id', offeringId!)
    setOffering(prev => prev ? { ...prev, results_status: 'submitted' } : prev)
    setRows(prev => prev.map(r => ({ ...r, dirty: false })))
    setSubmitting(false)
  }

  const dirtyCount  = rows.filter(r => r.dirty).length
  const filledCount = rows.filter(r => r.ca_score !== null && r.exam_score !== null).length
  // Scores are editable only while the offering is a draft (phase38 score-lock);
  // once submitted for verification everything downstream is read-only.
  const isLocked    = (offering?.results_status ?? 'draft') !== 'draft'
  const canSubmit   = offering?.results_status === 'draft' && filledCount === rows.length && rows.length > 0

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-navy-950">
      <div className="text-navy-400 text-xs tracking-widest uppercase">Loading…</div>
    </div>
  )

  if (error || !offering) return (
    <div className="flex-1 flex items-center justify-center bg-navy-950">
      <div className="text-red-400 text-sm">{error ?? 'Course offering not found.'}</div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-navy-950">

      {/* ── Top bar ── */}
      <div className="px-6 py-4 border-b border-navy-800 flex items-start justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-[11px] font-bold text-amber-500 tracking-widest uppercase">
              {offering.course_code}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wide font-medium ${STATUS_STYLE[offering.results_status] ?? STATUS_STYLE.draft}`}>
              {offering.results_status}
            </span>
          </div>
          <h1 className="text-white font-semibold text-[15px] leading-tight">{offering.course_title}</h1>
          <p className="text-navy-400 text-[11px] mt-1">
            {offering.session_label} · {offering.semester_label} · {rows.length} student{rows.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {tab === 'scores' && dirtyCount > 0 && (
            <button onClick={saveAll}
              className="px-3 py-1.5 text-xs bg-navy-700 hover:bg-navy-600 text-white rounded transition-colors">
              Save {dirtyCount} unsaved
            </button>
          )}
          {tab === 'scores' && canSubmit && (
            <button onClick={submitResults} disabled={submitting}
              className="px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-navy-900 font-semibold rounded transition-colors disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Submit to Senate →'}
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-navy-800 flex-shrink-0 px-6">
        {(['scores', 'roster', 'announcements', 'materials', ...(lecturerBoards.length > 0 ? ['board' as const] : [])] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider border-b-2 -mb-px transition-colors',
              tab === t
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-navy-500 hover:text-navy-300'
            )}>
            {t === 'materials'     ? `Materials${materials.length > 0 ? ` (${materials.length})` : ''}`
           : t === 'announcements' ? `Announcements${announcements.length > 0 ? ` (${announcements.length})` : ''}`
           : t === 'roster'        ? `Roster (${rows.length})`
           : t === 'board'         ? 'Board'
           : t}
          </button>
        ))}
      </div>

      {/* ── Scores tab ── */}
      {tab === 'scores' && (
        <>
          <div className="flex-1 overflow-auto">
            {rows.length === 0 ? (
              <div className="flex items-center justify-center h-full text-navy-500 text-sm">
                No students enrolled in this course offering.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-navy-900 z-10">
                  <tr className="text-left border-b border-navy-800">
                    <th className="px-6 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium w-8">#</th>
                    <th className="px-2 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium">Student</th>
                    <th className="px-2 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium">Reg No.</th>
                    <th className="px-2 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium text-center w-32">CA</th>
                    <th className="px-2 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium text-center w-32">Exam</th>
                    <th className="px-2 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium text-center w-20">Total</th>
                    <th className="px-2 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium text-center w-16">Grade</th>
                    <th className="px-6 py-3 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const result = calcResult(row.ca_score, row.exam_score, gradeScales)
                    const gradeColor = !result ? 'text-navy-600'
                      : result.gp >= 4 ? 'text-green-400'
                      : result.gp >= 2 ? 'text-amber-400'
                      : 'text-red-400'

                    return (
                      <tr key={row.reg_id}
                        className={cn(
                          'border-b border-navy-800/40 transition-colors',
                          row.dirty ? 'bg-amber-500/5' : 'hover:bg-navy-800/20'
                        )}>
                        <td className="px-6 py-3 text-navy-600 text-xs">{i + 1}</td>
                        <td className="px-2 py-3">
                          <span className="text-white text-[13px] font-medium">{row.first_name} {row.last_name}</span>
                        </td>
                        <td className="px-2 py-3">
                          <span className="text-navy-400 text-xs font-mono">{row.reg_number}</span>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <input type="number" min={0} max={100 - (row.exam_score ?? 0)}
                            disabled={isLocked} value={row.ca_score ?? ''}
                            onChange={e => setScore(row.reg_id, 'ca_score', e.target.value)}
                            placeholder="—"
                            className="w-24 text-center bg-navy-800 border border-navy-700 focus:border-amber-500 rounded px-2 py-1.5 text-white text-xs outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </td>
                        <td className="px-2 py-3 text-center">
                          <input type="number" min={0} max={100 - (row.ca_score ?? 0)}
                            disabled={isLocked} value={row.exam_score ?? ''}
                            onChange={e => setScore(row.reg_id, 'exam_score', e.target.value)}
                            placeholder="—"
                            className="w-24 text-center bg-navy-800 border border-navy-700 focus:border-amber-500 rounded px-2 py-1.5 text-white text-xs outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </td>
                        <td className="px-2 py-3 text-center">
                          <span className={`text-sm font-semibold tabular-nums ${gradeColor}`}>
                            {result ? result.total : '—'}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center">
                          <span className={`text-xs font-bold tabular-nums ${gradeColor}`}>
                            {result?.grade ?? '—'}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          {row.dirty && !isLocked && (
                            <button onClick={() => saveRow(row.reg_id)} disabled={row.saving}
                              className="text-[10px] px-2 py-1 bg-amber-500/15 hover:bg-amber-500/30 text-amber-400 rounded transition-colors disabled:opacity-50 cursor-pointer">
                              {row.saving ? '…' : 'Save'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {rows.length > 0 && (
            <div className="px-6 py-2.5 border-t border-navy-800 flex items-center gap-4 flex-shrink-0 bg-navy-900/50">
              <span className="text-[11px] text-navy-500 tabular-nums">{filledCount}/{rows.length} scored</span>
              {filledCount < rows.length && (
                <span className="text-[11px] text-amber-500/60">{rows.length - filledCount} pending</span>
              )}
              {filledCount === rows.length && rows.length > 0 && (
                <span className="text-[11px] text-green-400">All scores entered</span>
              )}
              {isLocked && (
                <span className="text-[11px] text-navy-500 ml-auto">
                  Results {offering.results_status} — editing locked
                </span>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Materials tab ── */}
      {tab === 'materials' && (
        <div className="flex-1 overflow-auto p-6 space-y-6">

          {/* Upload form */}
          <div className="bg-navy-900 border border-navy-800 rounded-xl p-5 space-y-4">
            <div className="text-[11px] uppercase tracking-widest text-navy-400 font-semibold">Upload Material</div>

            {matError && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">{matError}</div>
            )}
            {matSuccess && (
              <div className="text-xs text-green-400 bg-green-900/20 border border-green-800/40 rounded px-3 py-2">{matSuccess}</div>
            )}

            <div className="flex gap-3 flex-wrap items-end">
              <div className="flex-1 min-w-48">
                <label className="text-[10px] text-navy-500 uppercase tracking-wider block mb-1.5">Title</label>
                <input
                  type="text"
                  value={matTitle}
                  onChange={e => setMatTitle(e.target.value)}
                  placeholder="e.g. Week 3 Lecture Notes"
                  className="w-full bg-navy-800 border border-navy-700 focus:border-amber-500 rounded px-3 py-2 text-white text-sm outline-none placeholder:text-navy-600"
                />
              </div>

              <div className="flex-1 min-w-48">
                <label className="text-[10px] text-navy-500 uppercase tracking-wider block mb-1.5">File (max 50 MB)</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-2 bg-navy-700 hover:bg-navy-600 text-navy-200 text-xs rounded transition-colors whitespace-nowrap">
                    Choose file
                  </button>
                  <span className="text-navy-400 text-xs truncate max-w-[160px]">
                    {pickedFile ? pickedFile.name : 'No file chosen'}
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={e => { setPickedFile(e.target.files?.[0] ?? null); setMatError(null) }}
                  />
                </div>
              </div>

              <button
                onClick={handleUpload}
                disabled={uploading || !pickedFile || !matTitle.trim()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-navy-900 font-semibold text-xs rounded transition-colors whitespace-nowrap">
                {uploading ? 'Uploading…' : 'Upload →'}
              </button>
            </div>
          </div>

          {/* Materials list */}
          {matLoading ? (
            <div className="text-center text-navy-500 text-sm py-8">Loading…</div>
          ) : materials.length === 0 ? (
            <div className="text-center text-navy-600 text-sm py-8">
              No materials uploaded yet. Upload the first one above.
            </div>
          ) : (
            <div className="space-y-2">
              {materials.map(mat => (
                <div key={mat.id}
                  className="flex items-center gap-4 bg-navy-900 border border-navy-800 rounded-lg px-4 py-3">
                  <span className="text-[10px] font-bold text-navy-500 flex-shrink-0 w-8 text-center">{fileIcon(mat.file_type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium truncate">{mat.title}</div>
                    <div className="text-navy-500 text-[11px] mt-0.5">
                      {mat.file_name}
                      {mat.file_size ? ` · ${fmtSize(mat.file_size)}` : ''}
                      {' · '}
                      {new Date(mat.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleDownload(mat)}
                      className="text-[11px] px-3 py-1.5 bg-navy-700 hover:bg-navy-600 text-navy-200 rounded transition-colors">
                      Download
                    </button>
                    <button
                      onClick={() => handleDelete(mat)}
                      className="text-[11px] px-2 py-1.5 text-navy-600 hover:text-red-400 transition-colors"
                      title="Delete">
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Roster tab ── */}
      {tab === 'roster' && (() => {
        const q = rosterSearch.trim().toLowerCase()
        const filtered = q
          ? rows.filter(r =>
              `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
              r.reg_number.toLowerCase().includes(q)
            )
          : rows

        const scored   = rows.filter(r => r.ca_score !== null && r.exam_score !== null).length
        const partial  = rows.filter(r => (r.ca_score !== null) !== (r.exam_score !== null)).length
        const pending  = rows.filter(r => r.ca_score === null && r.exam_score === null).length

        return (
          <div className="flex-1 overflow-auto p-6 space-y-5">

            {/* Summary chips */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] px-3 py-1.5 rounded-full bg-navy-800 text-navy-300">
                {rows.length} enrolled
              </span>
              {scored > 0 && (
                <span className="text-[11px] px-3 py-1.5 rounded-full bg-green-900/40 text-green-400">
                  {scored} fully scored
                </span>
              )}
              {partial > 0 && (
                <span className="text-[11px] px-3 py-1.5 rounded-full bg-amber-900/30 text-amber-400">
                  {partial} partially scored
                </span>
              )}
              {pending > 0 && (
                <span className="text-[11px] px-3 py-1.5 rounded-full bg-navy-800 text-navy-500">
                  {pending} not yet scored
                </span>
              )}
            </div>

            {/* Search */}
            <input
              type="text"
              value={rosterSearch}
              onChange={e => setRosterSearch(e.target.value)}
              placeholder="Search by name or reg number…"
              className="w-full max-w-sm bg-navy-900 border border-navy-700 focus:border-amber-500 rounded px-3 py-2 text-white text-sm outline-none placeholder:text-navy-600"
            />

            {/* Table */}
            {rows.length === 0 ? (
              <div className="text-center text-navy-600 text-sm py-12">No students enrolled.</div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-navy-600 text-sm py-12">No students match "{rosterSearch}".</div>
            ) : (
              <div className="bg-navy-900 border border-navy-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-navy-800/60">
                    <tr className="text-left border-b border-navy-800">
                      <th className="px-5 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium w-8">#</th>
                      <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium">Name</th>
                      <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium">Reg Number</th>
                      <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium text-center w-20">CA</th>
                      <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium text-center w-20">Exam</th>
                      <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium text-center w-20">Total</th>
                      <th className="px-3 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium text-center w-16">Grade</th>
                      <th className="px-5 py-3 text-[10px] uppercase tracking-widest text-navy-500 font-medium w-24">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row, i) => {
                      const result = calcResult(row.ca_score, row.exam_score, gradeScales)
                      const gradeColor = !result ? 'text-navy-600'
                        : result.gp >= 4 ? 'text-green-400'
                        : result.gp >= 2 ? 'text-amber-400'
                        : 'text-red-400'
                      const hasCA   = row.ca_score !== null
                      const hasExam = row.exam_score !== null
                      const status  = hasCA && hasExam ? 'scored' : hasCA || hasExam ? 'partial' : 'pending'

                      return (
                        <tr key={row.reg_id} className="border-b border-navy-800/40 hover:bg-navy-800/20 transition-colors">
                          <td className="px-5 py-3 text-navy-600 text-xs tabular-nums">{i + 1}</td>
                          <td className="px-3 py-3">
                            <span className="text-white text-[13px] font-medium">{row.first_name} {row.last_name}</span>
                          </td>
                          <td className="px-3 py-3">
                            <span className="text-navy-400 text-xs font-mono">{row.reg_number}</span>
                          </td>
                          <td className="px-3 py-3 text-center text-navy-300 text-xs tabular-nums">
                            {row.ca_score ?? <span className="text-navy-700">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center text-navy-300 text-xs tabular-nums">
                            {row.exam_score ?? <span className="text-navy-700">—</span>}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`text-sm font-semibold tabular-nums ${gradeColor}`}>
                              {result ? result.total : <span className="text-navy-700 text-xs">—</span>}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`text-xs font-bold ${gradeColor}`}>
                              {result?.grade ?? <span className="text-navy-700">—</span>}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <span className={cn(
                              'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                              status === 'scored'  && 'bg-green-900/40 text-green-400',
                              status === 'partial' && 'bg-amber-900/30 text-amber-400',
                              status === 'pending' && 'bg-navy-800 text-navy-600',
                            )}>
                              {status}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Announcements tab ── */}
      {tab === 'announcements' && (
        <div className="flex-1 overflow-auto p-6 space-y-6">

          {/* Post form */}
          <div className="bg-navy-900 border border-navy-800 rounded-xl p-5 space-y-4">
            <div className="text-[11px] uppercase tracking-widest text-navy-400 font-semibold">New Announcement</div>

            {annError && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">{annError}</div>
            )}
            {annSuccess && (
              <div className="text-xs text-green-400 bg-green-900/20 border border-green-800/40 rounded px-3 py-2">{annSuccess}</div>
            )}

            <div>
              <label className="text-[10px] text-navy-500 uppercase tracking-wider block mb-1.5">Title</label>
              <input
                type="text"
                value={annTitle}
                onChange={e => { setAnnTitle(e.target.value); setAnnError(null) }}
                placeholder="e.g. Assignment 1 Due Friday"
                className="w-full bg-navy-800 border border-navy-700 focus:border-amber-500 rounded px-3 py-2 text-white text-sm outline-none placeholder:text-navy-600"
              />
            </div>

            <div>
              <label className="text-[10px] text-navy-500 uppercase tracking-wider block mb-1.5">Message</label>
              <textarea
                rows={4}
                value={annBody}
                onChange={e => { setAnnBody(e.target.value); setAnnError(null) }}
                placeholder="Write your announcement here…"
                className="w-full bg-navy-800 border border-navy-700 focus:border-amber-500 rounded px-3 py-2 text-white text-sm outline-none placeholder:text-navy-600 resize-none"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={handlePost}
                disabled={posting || !annTitle.trim() || !annBody.trim()}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-navy-900 font-semibold text-xs rounded transition-colors">
                {posting ? 'Posting…' : 'Post to Students →'}
              </button>
            </div>
          </div>

          {/* Announcements list */}
          {annLoading ? (
            <div className="text-center text-navy-500 text-sm py-8">Loading…</div>
          ) : announcements.length === 0 ? (
            <div className="text-center text-navy-600 text-sm py-8">
              No announcements yet. Post one above to notify all enrolled students.
            </div>
          ) : (
            <div className="space-y-3">
              {announcements.map(ann => (
                <div key={ann.id}
                  className="bg-navy-900 border border-navy-800 rounded-xl px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-semibold text-[13px] leading-snug">{ann.title}</div>
                      <div className="text-[10px] text-navy-500 mt-0.5">
                        {new Date(ann.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteAnnouncement(ann.id)}
                      className="text-navy-600 hover:text-red-400 transition-colors text-sm flex-shrink-0 mt-0.5"
                      title="Delete announcement">
                      ×
                    </button>
                  </div>
                  <div className="mt-3 text-navy-300 text-sm whitespace-pre-wrap leading-relaxed">{ann.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Board tab ── */}
      {tab === 'board' && (() => {
        const canSubmit = offering.results_status !== 'draft'
        const subStatusStyle: Record<string, string> = {
          pending:  'bg-navy-800 text-navy-400',
          reviewed: 'bg-blue-900/40 text-blue-300',
          ratified: 'bg-green-900/40 text-green-400',
          rejected: 'bg-red-900/30 text-red-400',
        }
        const unsubmittedBoards = lecturerBoards.filter(
          b => !boardSubmissions.find(s => s.board_id === b.board_id)
        )

        return (
          <div className="flex-1 overflow-auto p-6 space-y-6">

            {/* Submit form */}
            <div className="bg-navy-900 border border-navy-800 rounded-xl p-5 space-y-4">
              <div className="text-[11px] uppercase tracking-widest text-navy-400 font-semibold">Submit for Ratification</div>

              {!canSubmit && (
                <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800/40 rounded px-3 py-2">
                  Scores must be submitted to Senate before sending to a board. Use "Submit to Senate →" on the Scores tab.
                </div>
              )}

              {canSubmit && boardSubError && (
                <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded px-3 py-2">{boardSubError}</div>
              )}
              {canSubmit && boardSubSuccess && (
                <div className="text-xs text-green-400 bg-green-900/20 border border-green-800/40 rounded px-3 py-2">{boardSubSuccess}</div>
              )}

              {canSubmit && unsubmittedBoards.length === 0 && boardSubmissions.length > 0 && (
                <div className="text-xs text-navy-400">Submitted to all your assigned boards.</div>
              )}

              {canSubmit && unsubmittedBoards.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-navy-500 uppercase tracking-wider block mb-1.5">Board</label>
                    <select
                      value={selectedBoardId}
                      onChange={e => { setSelectedBoardId(e.target.value); setBoardSubError(null) }}
                      className="w-full bg-navy-800 border border-navy-700 focus:border-amber-500 rounded px-3 py-2 text-white text-sm outline-none appearance-none">
                      <option value="">— Select board —</option>
                      {unsubmittedBoards.map(b => (
                        <option key={b.board_id} value={b.board_id}>{b.board_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-navy-500 uppercase tracking-wider block mb-1.5">Note (optional)</label>
                    <textarea
                      rows={3}
                      value={submissionNote}
                      onChange={e => setSubmissionNote(e.target.value)}
                      placeholder="Add context for the board — e.g. grading criteria, class performance notes…"
                      className="w-full bg-navy-800 border border-navy-700 focus:border-amber-500 rounded px-3 py-2 text-white text-sm outline-none placeholder:text-navy-600 resize-none"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={handleSubmitToBoard}
                      disabled={submittingToBoard || !selectedBoardId}
                      className="px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-navy-900 font-semibold text-xs rounded transition-colors">
                      {submittingToBoard ? 'Submitting…' : 'Submit to Board →'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Existing submissions */}
            {boardSubmissions.length > 0 && (
              <div className="space-y-3">
                <div className="text-[11px] uppercase tracking-widest text-navy-500 font-semibold px-1">Submission History</div>
                {boardSubmissions.map(sub => {
                  const boardName = lecturerBoards.find(b => b.board_id === sub.board_id)?.board_name ?? '—'
                  return (
                    <div key={sub.id} className="bg-navy-900 border border-navy-800 rounded-xl px-5 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-white font-semibold text-[13px]">{boardName}</div>
                          <div className="text-[10px] text-navy-500 mt-0.5">
                            {new Date(sub.submitted_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${subStatusStyle[sub.status] ?? 'bg-navy-800 text-navy-500'}`}>
                          {sub.status}
                        </span>
                      </div>
                      {sub.note && (
                        <div className="mt-3 text-navy-400 text-xs leading-relaxed border-t border-navy-800 pt-3">{sub.note}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
