import { useEffect, useState, useCallback } from 'react'
import { Card, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Field, Select } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import type { AppUser } from '../../types'

interface Props { appUser: AppUser }

// ── Types ────────────────────────────────────────────────────────────────
interface OfficeInstance {
  id: string
  label: string | null
  is_active: boolean
  faculty_id: string | null
  department_id: string | null
  office_type: { id: string; code: string; label: string }
  assignments: Array<{
    id: string
    is_active: boolean
    profile: { id: string; first_name: string | null; last_name: string | null; email: string }
  }>
}

interface Faculty { id: string; name: string }
interface Dept    { id: string; name: string; faculty_id: string }

interface TertCap { code: string; label: string }

interface Delegation {
  id: string
  is_active: boolean
  expires_at: string | null
  reason: string | null
  granted_at: string
  grantor: { id: string; office_type: { label: string } }
  delegate: { id: string; office_type: { label: string } }
  capability: { code: string; label: string }
}

interface FlowEntry {
  id: string
  capability: string
  created_at: string
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  actor_user_id: string
  office_instance_id: string
}

type Tab = 'offices' | 'delegations' | 'audit' | 'courses' | 'boards'

interface BoardRow {
  id: string
  name: string
  description: string | null
  board_type: 'committee' | 'board' | 'task_force' | 'working_group'
  is_active: boolean
  created_at: string
  member_count?: number
}

interface BoardMemberRow {
  id: string
  user_id: string
  role: 'chair' | 'secretary' | 'member'
  joined_at: string
  profile?: { first_name: string | null; last_name: string | null; email: string } | null
}

const BOARD_TYPE_LABEL: Record<string, string> = {
  committee: 'Committee', board: 'Board', task_force: 'Task Force', working_group: 'Working Group',
}
const BOARD_TYPE_COLOR: Record<string, string> = {
  committee: 'bg-blue-50 text-blue-700', board: 'bg-purple-50 text-purple-700',
  task_force: 'bg-amber-50 text-amber-700', working_group: 'bg-green-50 text-green-700',
}

interface CourseOfferingRow {
  id: string
  results_status: string
  lecturer_membership_id: string | null
  course: { code: string; title: string } | null
  lecturer_mem: { id: string; profile: { first_name: string | null; last_name: string | null } | null } | null
}

interface LecturerMem {
  id: string
  profile: { first_name: string | null; last_name: string | null } | null
}

interface CourseSess { id: string; label: string }
interface CourseSem  { id: string; label: string; session_id: string }

const OFFERING_STATUS_STYLE: Record<string, string> = {
  draft:            'bg-gray-100 text-gray-600',
  submitted:        'bg-yellow-50 text-yellow-700',
  dept_verified:    'bg-blue-50 text-blue-700',
  dept_approved:    'bg-purple-50 text-purple-700',
  faculty_verified: 'bg-violet-50 text-violet-700',
  published:        'bg-green-50 text-green-700',
}

// ── Helpers ──────────────────────────────────────────────────────────────
function initials(p: { first_name: string | null; last_name: string | null }) {
  return `${(p.first_name?.[0] ?? '?').toUpperCase()}${(p.last_name?.[0] ?? '').toUpperCase()}`
}

function relTime(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)   return 'just now'
  if (s < 3600) return `${Math.floor(s/60)}m ago`
  if (s < 86400) return `${Math.floor(s/3600)}h ago`
  return `${Math.floor(s/86400)}d ago`
}

const CAP_COLORS: Record<string, string> = {
  'student':     'bg-green-50 text-green-700',
  'result':      'bg-blue-50 text-blue-700',
  'fee':         'bg-amber-50 text-amber-700',
  'institution': 'bg-purple-50 text-purple-700',
  'office':      'bg-navy-50 text-navy-700',
  'delegation':  'bg-rose-50 text-rose-700',
  'session':     'bg-teal-50 text-teal-700',
  'semester':    'bg-teal-50 text-teal-700',
  'offering':    'bg-indigo-50 text-indigo-700',
  'staff':       'bg-orange-50 text-orange-700',
  'course':      'bg-cyan-50 text-cyan-700',
}
function capColor(code: string) {
  const prefix = code.split('.')[0]
  return CAP_COLORS[prefix] ?? 'bg-gray-100 text-gray-600'
}

// ── Main ─────────────────────────────────────────────────────────────────
export default function Coredesk({ appUser }: Props) {
  const schoolId = appUser.activeSchool?.id ?? ''
  const [tab, setTab] = useState<Tab>('offices')

  const [offices,     setOffices]     = useState<OfficeInstance[]>([])
  const [capsByType,  setCapsByType]  = useState<Record<string, TertCap[]>>({})
  const [allCaps,     setAllCaps]     = useState<TertCap[]>([])
  const [delegations, setDelegations] = useState<Delegation[]>([])
  const [auditLog,    setAuditLog]    = useState<FlowEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [toast,       setToast]       = useState<{ msg: string; ok: boolean } | null>(null)
  const [faculties,   setFaculties]   = useState<Faculty[]>([])
  const [departments, setDepartments] = useState<Dept[]>([])
  const [expandedFaculties, setExpandedFaculties] = useState<Set<string>>(new Set())

  // Course assignments tab
  const [courseSessions,    setCourseSessions]    = useState<CourseSess[]>([])
  const [courseSems,        setCourseSems]         = useState<CourseSem[]>([])
  const [courseSessionId,   setCourseSessionId]    = useState('')
  const [courseSemId,       setCourseSemId]        = useState('')
  const [courseOfferings,   setCourseOfferings]    = useState<CourseOfferingRow[]>([])
  const [lecturerMems,      setLecturerMems]       = useState<LecturerMem[]>([])
  const [assigningOffering, setAssigningOffering]  = useState<CourseOfferingRow | null>(null)
  const [pickedLecId,       setPickedLecId]        = useState('')
  const [savingAssign,      setSavingAssign]        = useState(false)
  const [courseLoading,     setCourseLoading]      = useState(false)

  // Boards tab
  const [boards,           setBoards]           = useState<BoardRow[]>([])
  const [boardsLoading,    setBoardsLoading]    = useState(false)
  const [showCreateBoard,  setShowCreateBoard]  = useState(false)
  const [newBoardName,     setNewBoardName]     = useState('')
  const [newBoardDesc,     setNewBoardDesc]     = useState('')
  const [newBoardType,     setNewBoardType]     = useState<BoardRow['board_type']>('committee')
  const [creatingBoard,    setCreatingBoard]    = useState(false)
  const [managingBoard,    setManagingBoard]    = useState<BoardRow | null>(null)
  const [boardMembers,     setBoardMembers]     = useState<BoardMemberRow[]>([])
  const [memberSearch,     setMemberSearch]     = useState('')
  const [memberSearchRes,  setMemberSearchRes]  = useState<any[]>([])
  const [newMemberRole,    setNewMemberRole]    = useState<BoardMemberRow['role']>('member')
  const [addingMember,     setAddingMember]     = useState(false)

  // Assign modal
  const [assignOffice,  setAssignOffice]  = useState<OfficeInstance | null>(null)
  const [profileSearch, setProfileSearch] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [assigning,     setAssigning]     = useState(false)

  // Delegation modal
  const [showDelModal,   setShowDelModal]   = useState(false)
  const [delForm, setDelForm] = useState({ grantorId:'', delegateId:'', capCode:'', expiresAt:'', reason:'' })
  const [granting, setGranting] = useState(false)

  function flash(msg: string, ok = true) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 4000)
  }

  const load = useCallback(async () => {
    if (!schoolId) return
    setLoading(true)

    // Offices + assignments
    const [{ data: offData }, { data: facData }, { data: deptData }] = await Promise.all([
      supabase.from('office_instances')
        .select(`
          id, label, is_active, faculty_id, department_id,
          office_type:office_types!office_type_id(id, code, label),
          assignments:office_assignments(
            id, is_active,
            profile:profiles!profile_id(id, first_name, last_name, email)
          )
        `)
        .eq('institution_id', schoolId)
        .eq('is_active', true)
        .order('created_at'),
      supabase.from('faculties').select('id, name').eq('school_id', schoolId).order('name'),
      supabase.from('departments').select('id, name, faculty_id').order('name'),
    ])
    setFaculties((facData ?? []) as Faculty[])
    setDepartments((deptData ?? []) as Dept[])
    // Default expand all faculties
    setExpandedFaculties(new Set((facData ?? []).map((f: any) => f.id)))

    const offs = (offData ?? []) as unknown as OfficeInstance[]
    setOffices(offs)

    // Capabilities per office type
    const typeIds = [...new Set(offs.map(o => o.office_type.id))]
    if (typeIds.length) {
      const { data: capData } = await supabase
        .from('office_type_capabilities')
        .select('office_type_id, capability:tert_capabilities!capability_id(code, label)')
        .in('office_type_id', typeIds)

      const map: Record<string, TertCap[]> = {}
      ;(capData ?? []).forEach((row: any) => {
        if (!map[row.office_type_id]) map[row.office_type_id] = []
        if (row.capability) map[row.office_type_id].push(row.capability)
      })
      setCapsByType(map)
    }

    // All capabilities (for delegation grant)
    const { data: allCapData } = await supabase
      .from('tert_capabilities')
      .select('code, label')
      .order('code')
    setAllCaps((allCapData ?? []) as TertCap[])

    // Active delegations for this institution's offices
    const officeIds = offs.map(o => o.id)
    if (officeIds.length) {
      const { data: delData } = await supabase
        .from('office_delegations')
        .select(`
          id, is_active, expires_at, reason, granted_at,
          grantor:office_instances!grantor_office_id(id, office_type:office_types!office_type_id(label)),
          delegate:office_instances!delegate_office_id(id, office_type:office_types!office_type_id(label)),
          capability:tert_capabilities!capability_id(code, label)
        `)
        .in('grantor_office_id', officeIds)
        .eq('is_active', true)
        .order('granted_at', { ascending: false })
      setDelegations((delData ?? []) as unknown as Delegation[])

      // Flow log
      const { data: logData } = await supabase
        .from('flow_log')
        .select('id, capability, created_at, payload, result, actor_user_id, office_instance_id')
        .in('office_instance_id', officeIds)
        .order('created_at', { ascending: false })
        .limit(50)
      setAuditLog((logData ?? []) as FlowEntry[])
    }

    setLoading(false)
  }, [schoolId])

  useEffect(() => { load() }, [load])

  // Course assignments: load sessions + lecturer memberships
  useEffect(() => {
    if (!schoolId) return
    supabase.from('academic_sessions').select('id, label').eq('school_id', schoolId).order('created_at', { ascending: false })
      .then(({ data }) => setCourseSessions((data ?? []) as CourseSess[]))
    supabase.from('memberships')
      .select('id, profile:profiles!profile_id(first_name, last_name), office:offices!office_id(name)')
      .eq('school_id', schoolId).eq('is_active', true)
      .then(({ data }) => {
        setLecturerMems(((data ?? []) as any[]).filter(m => m.office?.name === 'lecturer') as LecturerMem[])
      })
  }, [schoolId])

  useEffect(() => {
    if (!courseSessionId) { setCourseSems([]); setCourseSemId(''); return }
    supabase.from('semesters').select('id, label, session_id').eq('session_id', courseSessionId).order('ordinal')
      .then(({ data }) => {
        setCourseSems((data ?? []) as CourseSem[])
        setCourseSemId(data?.[0]?.id ?? '')
      })
  }, [courseSessionId])

  useEffect(() => {
    if (!courseSemId) { setCourseOfferings([]); return }
    setCourseLoading(true)
    supabase.from('course_offerings')
      .select(`id, results_status, lecturer_membership_id,
               course:courses!course_id(code, title),
               lecturer_mem:memberships!lecturer_membership_id(id, profile:profiles!profile_id(first_name, last_name))`)
      .eq('semester_id', courseSemId).order('created_at')
      .then(({ data }) => {
        setCourseOfferings((data ?? []) as unknown as CourseOfferingRow[])
        setCourseLoading(false)
      })
  }, [courseSemId])

  async function refreshCourseOfferings() {
    if (!courseSemId) return
    const { data } = await supabase.from('course_offerings')
      .select(`id, results_status, lecturer_membership_id,
               course:courses!course_id(code, title),
               lecturer_mem:memberships!lecturer_membership_id(id, profile:profiles!profile_id(first_name, last_name))`)
      .eq('semester_id', courseSemId).order('created_at')
    setCourseOfferings((data ?? []) as unknown as CourseOfferingRow[])
  }

  // Profile search
  useEffect(() => {
    if (profileSearch.length < 2) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email')
        .or(`first_name.ilike.%${profileSearch}%,last_name.ilike.%${profileSearch}%,email.ilike.%${profileSearch}%`)
        .limit(8)
      setSearchResults(data ?? [])
    }, 300)
    return () => clearTimeout(timer)
  }, [profileSearch])

  async function handleAssign(profileId: string) {
    if (!assignOffice) return
    setAssigning(true)
    const { error } = await supabase.rpc('flow_execute', {
      p_capability: 'office.assign',
      p_payload: { office_instance_id: assignOffice.id, profile_id: profileId },
    })
    setAssigning(false)
    if (error) { flash(error.message, false); return }
    flash('Staff assigned successfully.')
    setAssignOffice(null)
    setProfileSearch('')
    setSearchResults([])
    load()
  }

  async function handleUnassign(assignmentId: string) {
    const { error } = await supabase.rpc('flow_execute', {
      p_capability: 'office.unassign',
      p_payload: { assignment_id: assignmentId },
    })
    if (error) { flash(error.message, false); return }
    flash('Assignment removed.')
    load()
  }

  async function handleGrantDelegation() {
    if (!delForm.grantorId || !delForm.delegateId || !delForm.capCode) {
      flash('Grantor, delegate, and capability are required.', false); return
    }
    setGranting(true)
    const { error } = await supabase.rpc('flow_execute', {
      p_capability: 'delegation.grant',
      p_payload: {
        grantor_office_id:  delForm.grantorId,
        delegate_office_id: delForm.delegateId,
        capability_code:    delForm.capCode,
        expires_at:         delForm.expiresAt || '',
        reason:             delForm.reason || '',
      },
    })
    setGranting(false)
    if (error) { flash(error.message, false); return }
    flash('Delegation granted.')
    setShowDelModal(false)
    setDelForm({ grantorId:'', delegateId:'', capCode:'', expiresAt:'', reason:'' })
    load()
  }

  async function handleRevokeDelegation(delegationId: string) {
    const { error } = await supabase.rpc('flow_execute', {
      p_capability: 'delegation.revoke',
      p_payload: { delegation_id: delegationId },
    })
    if (error) { flash(error.message, false); return }
    flash('Delegation revoked.')
    load()
  }

  async function handleAssignLecturer() {
    if (!assigningOffering) return
    setSavingAssign(true)
    const { error } = await supabase
      .from('course_offerings')
      .update({ lecturer_membership_id: pickedLecId || null })
      .eq('id', assigningOffering.id)
    setSavingAssign(false)
    if (error) { flash(error.message, false); return }
    flash('Lecturer assigned.')
    setAssigningOffering(null)
    setPickedLecId('')
    refreshCourseOfferings()
  }

  async function loadBoards() {
    if (!schoolId) return
    setBoardsLoading(true)
    const { data } = await supabase.from('boards').select('*')
      .eq('institution_id', schoolId).eq('is_active', true).order('created_at', { ascending: false })
    const ids = (data ?? []).map((b: any) => b.id)
    let counts: Record<string, number> = {}
    if (ids.length) {
      const { data: mc } = await supabase.from('board_members').select('board_id').in('board_id', ids)
      for (const r of mc ?? []) counts[r.board_id] = (counts[r.board_id] ?? 0) + 1
    }
    setBoards((data ?? []).map((b: any) => ({ ...b, member_count: counts[b.id] ?? 0 })))
    setBoardsLoading(false)
  }

  async function createBoard() {
    if (!newBoardName.trim()) return
    setCreatingBoard(true)
    const { data, error } = await supabase.from('boards').insert({
      institution_id: schoolId,
      name:        newBoardName.trim(),
      description: newBoardDesc.trim() || null,
      board_type:  newBoardType,
      created_by:  appUser.profile.id,
    }).select().single()
    if (error) { flash(error.message, false); setCreatingBoard(false); return }
    flash('Board created.')
    setShowCreateBoard(false); setNewBoardName(''); setNewBoardDesc(''); setNewBoardType('committee')
    setCreatingBoard(false)
    loadBoards()
    if (data) openManageMembers(data as BoardRow)
  }

  async function openManageMembers(board: BoardRow) {
    setManagingBoard(board)
    setMemberSearch(''); setMemberSearchRes([])
    const { data } = await supabase.from('board_members')
      .select('id, user_id, role, joined_at, profile:profiles!user_id(first_name, last_name, email)')
      .eq('board_id', board.id).order('joined_at')
    setBoardMembers((data ?? []) as unknown as BoardMemberRow[])
  }

  async function addBoardMember(profileId: string) {
    if (!managingBoard) return
    setAddingMember(true)
    const { error } = await supabase.from('board_members').insert({
      board_id: managingBoard.id,
      user_id:  profileId,
      role:     newMemberRole,
    })
    setAddingMember(false)
    if (!error) {
      flash('Member added.')
      setMemberSearch(''); setMemberSearchRes([])
      openManageMembers(managingBoard)
      loadBoards()
    } else {
      flash(error.code === '23505' ? 'Already a member.' : error.message, false)
    }
  }

  async function removeBoardMember(memberId: string) {
    await supabase.from('board_members').delete().eq('id', memberId)
    if (managingBoard) openManageMembers(managingBoard)
    loadBoards()
  }

  // Member search (debounced)
  useEffect(() => {
    if (memberSearch.length < 2) { setMemberSearchRes([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, first_name, last_name, email')
        .or(`first_name.ilike.%${memberSearch}%,last_name.ilike.%${memberSearch}%,email.ilike.%${memberSearch}%`)
        .limit(6)
      setMemberSearchRes(data ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [memberSearch])

  // Lazy-load boards when tab is selected
  useEffect(() => {
    if (tab === 'boards' && boards.length === 0 && !boardsLoading) loadBoards()
  }, [tab])

  // Map office IDs to type labels (for audit log)
  const officeMap = Object.fromEntries(offices.map(o => [o.id, o.office_type.label]))

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xl font-bold text-navy-900">Coredesk</div>
          <div className="text-sm text-gray-400 mt-0.5">Office governance, assignments, delegations</div>
        </div>
        {tab === 'delegations' && (
          <Button variant="primary" size="sm" onClick={() => setShowDelModal(true)}>
            + Grant Delegation
          </Button>
        )}
        {tab === 'boards' && (
          <Button variant="primary" size="sm" onClick={() => setShowCreateBoard(true)}>
            + Create Board
          </Button>
        )}
      </div>

      {toast && <Alert type={toast.ok ? 'success' : 'danger'}>{toast.msg}</Alert>}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(['offices','delegations','courses','boards','audit'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px
              ${tab === t
                ? 'border-navy-800 text-navy-900'
                : 'border-transparent text-gray-400 hover:text-navy-700'}`}>
            {t === 'audit' ? 'Audit Log' : t === 'courses' ? 'Course Assignments' : t === 'boards' ? 'Boards' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-sm text-gray-400 text-center">Loading Coredesk…</div>
      ) : (
        <>
          {/* ── OFFICES TAB ──────────────────────────────────────── */}
          {tab === 'offices' && (() => {
            const instOffices = offices.filter(o => !o.faculty_id && !o.department_id)
            const deanOffices = offices.filter(o => o.faculty_id && !o.department_id)
            const hodOffices  = offices.filter(o => o.department_id)

            function OfficeRow({ office, roleLabel }: { office: OfficeInstance; roleLabel?: string }) {
              const caps   = capsByType[office.office_type.id] ?? []
              const active = office.assignments.filter(a => a.is_active)
              return (
                <div className="flex items-start gap-4 py-3 px-4">
                  {/* Role badge */}
                  <div className="flex-shrink-0 pt-0.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-navy-50 text-navy-700 border border-navy-100 uppercase tracking-wide whitespace-nowrap">
                      {roleLabel ?? office.office_type.code}
                    </span>
                  </div>

                  {/* Assigned staff */}
                  <div className="flex-1 min-w-0">
                    {active.length === 0 ? (
                      <span className="text-[12px] text-gray-400 italic">Unassigned</span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {active.map(a => (
                          <div key={a.id} className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-navy-700 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                              {initials(a.profile)}
                            </div>
                            <div className="min-w-0">
                              <span className="text-[13px] font-semibold text-navy-900">{a.profile.first_name} {a.profile.last_name}</span>
                              <span className="ml-2 text-[11px] text-gray-400 truncate">{a.profile.email}</span>
                            </div>
                            <button onClick={() => handleUnassign(a.id)}
                              className="text-[11px] text-gray-300 hover:text-red-500 transition-colors ml-1 flex-shrink-0"
                              title="Remove">×</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Caps + assign */}
                  <div className="flex-shrink-0 flex items-center gap-3">
                    <div className="flex flex-wrap gap-1 max-w-[180px] justify-end">
                      {caps.slice(0, 4).map(c => (
                        <span key={c.code} className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${capColor(c.code)}`} title={c.label}>
                          {c.code}
                        </span>
                      ))}
                      {caps.length > 4 && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gray-100 text-gray-500">+{caps.length - 4}</span>
                      )}
                    </div>
                    <button
                      onClick={() => { setAssignOffice(office); setProfileSearch(''); setSearchResults([]) }}
                      className="text-[11px] font-semibold text-navy-700 border border-navy-200 px-2.5 py-1 rounded cursor-pointer hover:bg-navy-50 whitespace-nowrap">
                      + Assign
                    </button>
                  </div>
                </div>
              )
            }

            return (
              <div className="space-y-6">

                {/* ── Institution-wide ───────────────────────────────── */}
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">
                    Institution-wide
                  </div>
                  <Card className="p-0 divide-y divide-gray-100">
                    {instOffices.map(o => (
                      <OfficeRow key={o.id} office={o} roleLabel={o.office_type.label.replace('Office of the ', '')} />
                    ))}
                  </Card>
                </div>

                {/* ── Faculties ──────────────────────────────────────── */}
                {faculties.map(faculty => {
                  const deanOffice = deanOffices.find(o => o.faculty_id === faculty.id)
                  const depts      = departments.filter(d => d.faculty_id === faculty.id)
                  const isOpen     = expandedFaculties.has(faculty.id)
                  const toggleFac  = () => setExpandedFaculties(prev => {
                    const next = new Set(prev)
                    next.has(faculty.id) ? next.delete(faculty.id) : next.add(faculty.id)
                    return next
                  })

                  return (
                    <div key={faculty.id}>
                      {/* Faculty header row */}
                      <button
                        onClick={toggleFac}
                        className="w-full flex items-center gap-2 text-left px-1 mb-2 cursor-pointer group"
                      >
                        <span className={`text-[11px] text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider group-hover:text-gray-700">
                          {faculty.name}
                        </span>
                      </button>

                      {isOpen && (
                        <Card className="p-0 overflow-hidden">
                          {/* Dean row */}
                          {deanOffice ? (
                            <div className="border-b border-gray-100 bg-gray-50/50">
                              <OfficeRow office={deanOffice} roleLabel="Dean" />
                            </div>
                          ) : (
                            <div className="px-4 py-3 text-[12px] text-gray-400 italic border-b border-gray-100 bg-gray-50/50">
                              No Dean office instance
                            </div>
                          )}

                          {/* Departments */}
                          {depts.map((dept, idx) => {
                            const hodOffice = hodOffices.find(o => o.department_id === dept.id)
                            return (
                              <div key={dept.id}
                                className={`${idx < depts.length - 1 ? 'border-b border-gray-100' : ''}`}>
                                {/* Department label */}
                                <div className="flex items-center gap-2 px-4 pt-2.5 pb-0">
                                  <div className="w-px h-4 bg-gray-200 ml-2 flex-shrink-0" />
                                  <span className="text-[11px] font-semibold text-gray-500">{dept.name}</span>
                                </div>
                                {hodOffice ? (
                                  <div className="ml-4">
                                    <OfficeRow office={hodOffice} roleLabel="HOD" />
                                  </div>
                                ) : (
                                  <div className="px-8 py-2 text-[11px] text-gray-400 italic">No HOD instance</div>
                                )}
                              </div>
                            )
                          })}
                        </Card>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* ── DELEGATIONS TAB ──────────────────────────────────── */}
          {tab === 'delegations' && (
            <Card>
              {delegations.length === 0 ? (
                <div className="px-6 py-12 text-sm text-gray-400 text-center">
                  No active delegations. Grant one to allow an office to act on another's behalf.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Capability','Granted by','Delegated to','Expires',''].map(h => (
                        <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {delegations.map(d => (
                      <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${capColor(d.capability.code)}`}>
                            {d.capability.code}
                          </span>
                          <div className="text-xs text-gray-400 mt-0.5">{d.capability.label}</div>
                        </td>
                        <td className="px-5 py-3 text-gray-700">{(d.grantor as any)?.office_type?.label ?? '—'}</td>
                        <td className="px-5 py-3 text-gray-700">{(d.delegate as any)?.office_type?.label ?? '—'}</td>
                        <td className="px-5 py-3 text-xs text-gray-400">
                          {d.expires_at
                            ? new Date(d.expires_at).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' })
                            : 'No expiry'}
                        </td>
                        <td className="px-5 py-3">
                          <Button variant="ghost" size="sm"
                            onClick={() => handleRevokeDelegation(d.id)}
                            className="text-red-500 hover:text-red-700">
                            Revoke
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {/* ── AUDIT LOG TAB ─────────────────────────────────────── */}
          {tab === 'audit' && (
            <Card>
              {auditLog.length === 0 ? (
                <div className="px-6 py-12 text-sm text-gray-400 text-center">
                  No actions recorded yet. All writes through flow_execute appear here.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['When','Capability','Office','Log ID'].map(h => (
                        <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map(entry => (
                      <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="px-5 py-3 text-xs text-gray-400 whitespace-nowrap">{relTime(entry.created_at)}</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${capColor(entry.capability)}`}>
                            {entry.capability}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-600">
                          {officeMap[entry.office_instance_id] ?? entry.office_instance_id.slice(0, 8)}
                        </td>
                        <td className="px-5 py-3 font-mono text-[10px] text-gray-300">{entry.id.slice(0,8)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {/* ── BOARDS TAB ───────────────────────────────────────── */}
          {tab === 'boards' && (
            <div className="space-y-4">
              {boardsLoading ? (
                <div className="py-16 text-sm text-gray-400 text-center">Loading boards…</div>
              ) : boards.length === 0 ? (
                <Card className="py-16 text-center">
                  <div className="text-sm text-gray-400 mb-4">No boards yet.</div>
                  <Button variant="primary" size="sm" onClick={() => setShowCreateBoard(true)}>+ Create Board</Button>
                </Card>
              ) : (
                <Card>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Board', 'Type', 'Members', ''].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {boards.map(board => (
                        <tr key={board.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                          <td className="px-5 py-3">
                            <div className="font-semibold text-navy-900">{board.name}</div>
                            {board.description && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{board.description}</div>}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${BOARD_TYPE_COLOR[board.board_type] ?? 'bg-gray-100 text-gray-600'}`}>
                              {BOARD_TYPE_LABEL[board.board_type] ?? board.board_type}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-gray-600">
                            {board.member_count ?? 0} member{(board.member_count ?? 0) !== 1 ? 's' : ''}
                          </td>
                          <td className="px-5 py-3">
                            <Button variant="ghost" size="sm" onClick={() => openManageMembers(board)}>
                              Manage Members
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          )}

          {/* ── COURSES TAB ──────────────────────────────────────── */}
          {tab === 'courses' && (
            <div className="space-y-4">
              <div className="flex gap-4 flex-wrap">
                <div className="w-60">
                  <Select value={courseSessionId} onChange={e => setCourseSessionId(e.target.value)}>
                    <option value="">— Select session —</option>
                    {courseSessions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </Select>
                </div>
                {courseSems.length > 0 && (
                  <div className="w-60">
                    <Select value={courseSemId} onChange={e => setCourseSemId(e.target.value)}>
                      {courseSems.filter(s => s.session_id === courseSessionId).map(s =>
                        <option key={s.id} value={s.id}>{s.label}</option>
                      )}
                    </Select>
                  </div>
                )}
              </div>

              {!courseSessionId && (
                <div className="py-12 text-sm text-gray-400 text-center">Select a session to manage course-lecturer assignments.</div>
              )}

              {courseSemId && (
                <Card>
                  {courseLoading ? (
                    <div className="px-6 py-12 text-sm text-gray-400 text-center">Loading offerings…</div>
                  ) : courseOfferings.length === 0 ? (
                    <div className="px-6 py-12 text-sm text-gray-400 text-center">No offerings for this semester.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          {['Course', 'Status', 'Assigned Lecturer', ''].map(h => (
                            <th key={h} className="text-left px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {courseOfferings.map(off => {
                          const lec = (off.lecturer_mem as any)?.profile
                          const lecName = lec
                            ? `${lec.first_name ?? ''} ${lec.last_name ?? ''}`.trim()
                            : null
                          return (
                            <tr key={off.id} className="border-b border-gray-50 hover:bg-gray-50/40">
                              <td className="px-5 py-3">
                                <div className="font-semibold text-navy-900">{(off.course as any)?.code}</div>
                                <div className="text-xs text-gray-500">{(off.course as any)?.title}</div>
                              </td>
                              <td className="px-5 py-3">
                                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${OFFERING_STATUS_STYLE[off.results_status] ?? 'bg-gray-100 text-gray-600'}`}>
                                  {off.results_status}
                                </span>
                              </td>
                              <td className="px-5 py-3">
                                {lecName
                                  ? <span className="text-navy-800 font-medium">{lecName}</span>
                                  : <span className="text-gray-400 italic text-xs">Unassigned</span>}
                              </td>
                              <td className="px-5 py-3">
                                <Button variant="ghost" size="sm"
                                  onClick={() => { setAssigningOffering(off); setPickedLecId(off.lecturer_membership_id ?? '') }}>
                                  {off.lecturer_membership_id ? 'Change' : 'Assign'}
                                </Button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* ── CREATE BOARD MODAL ─────────────────────────────────────── */}
      {showCreateBoard && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="font-bold text-navy-900">Create Board</div>
              <button onClick={() => setShowCreateBoard(false)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label="Name">
                <Input value={newBoardName} onChange={e => setNewBoardName(e.target.value)} autoFocus
                  placeholder="e.g. Finance Committee" />
              </Field>
              <Field label="Type">
                <Select value={newBoardType} onChange={e => setNewBoardType(e.target.value as BoardRow['board_type'])}>
                  <option value="committee">Committee</option>
                  <option value="board">Board</option>
                  <option value="task_force">Task Force</option>
                  <option value="working_group">Working Group</option>
                </Select>
              </Field>
              <Field label="Description (optional)">
                <Input value={newBoardDesc} onChange={e => setNewBoardDesc(e.target.value)}
                  placeholder="Purpose or scope of this board…" />
              </Field>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={() => setShowCreateBoard(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={createBoard} disabled={creatingBoard || !newBoardName.trim()}>
                {creatingBoard ? 'Creating…' : 'Create Board'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── MANAGE BOARD MEMBERS MODAL ──────────────────────────────── */}
      {managingBoard && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
              <div>
                <div className="font-bold text-navy-900">{managingBoard.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">Manage members</div>
              </div>
              <button onClick={() => setManagingBoard(null)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>

            <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
              {/* Add member */}
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Add Member</div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
                      placeholder="Search by name or email…" />
                  </div>
                  <Select value={newMemberRole} onChange={e => setNewMemberRole(e.target.value as BoardMemberRow['role'])}
                    className="w-32">
                    <option value="member">Member</option>
                    <option value="chair">Chair</option>
                    <option value="secretary">Secretary</option>
                  </Select>
                </div>
                {memberSearchRes.length > 0 && (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {memberSearchRes.map(p => (
                      <button key={p.id} onClick={() => addBoardMember(p.id)} disabled={addingMember}
                        className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 transition-colors">
                        <div className="w-7 h-7 rounded-full bg-navy-700 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                          {((p.first_name?.[0] ?? '?') + (p.last_name?.[0] ?? '')).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-navy-900">{p.first_name} {p.last_name}</div>
                          <div className="text-xs text-gray-400 truncate">{p.email}</div>
                        </div>
                        <span className="text-xs text-navy-500 flex-shrink-0">Add →</span>
                      </button>
                    ))}
                  </div>
                )}
                {memberSearch.length >= 2 && memberSearchRes.length === 0 && (
                  <div className="text-sm text-gray-400 text-center py-2">No profiles found.</div>
                )}
              </div>

              {/* Current members */}
              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Current Members ({boardMembers.length})
                </div>
                {boardMembers.length === 0 ? (
                  <div className="text-sm text-gray-400 py-4 text-center">No members yet.</div>
                ) : (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {boardMembers.map((m, i) => {
                      const p = m.profile
                      const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.email || '—'
                      return (
                        <div key={m.id}
                          className={`flex items-center justify-between px-4 py-3 ${i < boardMembers.length - 1 ? 'border-b border-gray-50' : ''}`}>
                          <div>
                            <div className="text-sm font-semibold text-navy-900">{name}</div>
                            <div className="text-xs text-gray-400">{p?.email}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
                              m.role === 'chair'     ? 'bg-navy-900 text-white'       :
                              m.role === 'secretary' ? 'bg-amber-100 text-amber-800'  :
                                                       'bg-gray-100 text-gray-500'
                            }`}>{m.role}</span>
                            <button onClick={() => removeBoardMember(m.id)}
                              className="text-gray-300 hover:text-red-400 text-xs transition-colors ml-1">
                              ×
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ASSIGN STAFF MODAL ─────────────────────────────────────── */}
      {assignOffice && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div>
                <div className="font-bold text-navy-900">Assign Staff</div>
                <div className="text-xs text-gray-400 mt-0.5">{assignOffice.office_type.label}</div>
              </div>
              <button onClick={() => setAssignOffice(null)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>

            <div className="px-6 py-5 space-y-3">
              <Field label="Search by name or email">
                <Input
                  value={profileSearch}
                  onChange={e => setProfileSearch(e.target.value)}
                  placeholder="Type to search profiles…"
                  autoFocus
                />
              </Field>

              {searchResults.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {searchResults.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleAssign(p.id)}
                      disabled={assigning}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 text-left transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-navy-700 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                        {initials(p)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-navy-900">{p.first_name} {p.last_name}</div>
                        <div className="text-xs text-gray-400 truncate">{p.email}</div>
                      </div>
                      <span className="text-xs text-navy-500 flex-shrink-0">Assign →</span>
                    </button>
                  ))}
                </div>
              )}

              {profileSearch.length >= 2 && searchResults.length === 0 && (
                <div className="text-sm text-gray-400 text-center py-4">No profiles found.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── GRANT DELEGATION MODAL ──────────────────────────────────── */}
      {showDelModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="font-bold text-navy-900">Grant Delegation</div>
              <button onClick={() => setShowDelModal(false)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="text-xs text-gray-500 bg-gray-50 rounded p-3 leading-relaxed">
                A delegation lets one office act on behalf of another for a specific capability.
                The delegate cannot exceed the grantor's scope.
              </div>

              <Field label="Grantor (granting) office">
                <Select value={delForm.grantorId} onChange={e => setDelForm(f => ({ ...f, grantorId: e.target.value }))}>
                  <option value="">— Select grantor —</option>
                  {offices.map(o => <option key={o.id} value={o.id}>{o.office_type.label}</option>)}
                </Select>
              </Field>

              <Field label="Delegate (receiving) office">
                <Select value={delForm.delegateId} onChange={e => setDelForm(f => ({ ...f, delegateId: e.target.value }))}>
                  <option value="">— Select delegate —</option>
                  {offices.filter(o => o.id !== delForm.grantorId).map(o => (
                    <option key={o.id} value={o.id}>{o.office_type.label}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Capability to delegate">
                <Select value={delForm.capCode} onChange={e => setDelForm(f => ({ ...f, capCode: e.target.value }))}>
                  <option value="">— Select capability —</option>
                  {allCaps.map(c => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Expires (optional)">
                  <Input type="date" value={delForm.expiresAt}
                    onChange={e => setDelForm(f => ({ ...f, expiresAt: e.target.value }))} />
                </Field>
                <Field label="Reason">
                  <Input value={delForm.reason}
                    onChange={e => setDelForm(f => ({ ...f, reason: e.target.value }))}
                    placeholder="e.g. Acting capacity" />
                </Field>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={() => setShowDelModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleGrantDelegation} disabled={granting}>
                {granting ? 'Granting…' : 'Grant Delegation'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── ASSIGN LECTURER MODAL ──────────────────────────────────── */}
      {assigningOffering && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div>
                <div className="font-bold text-navy-900">Assign Lecturer</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {(assigningOffering.course as any)?.code} — {(assigningOffering.course as any)?.title}
                </div>
              </div>
              <button onClick={() => setAssigningOffering(null)} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>

            <div className="px-6 py-5">
              <Field label="Select Lecturer">
                <Select value={pickedLecId} onChange={e => setPickedLecId(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {lecturerMems.map(m => (
                    <option key={m.id} value={m.id}>
                      {(m.profile as any)?.first_name} {(m.profile as any)?.last_name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <Button variant="ghost" size="sm" onClick={() => setAssigningOffering(null)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleAssignLecturer} disabled={savingAssign}>
                {savingAssign ? 'Saving…' : 'Save Assignment'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
