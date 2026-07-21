import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { AppUser } from '../../types'

interface Board {
  id: string
  institution_id: string
  name: string
  description: string | null
  board_type: 'committee' | 'board' | 'task_force' | 'working_group'
  is_active: boolean
  created_by: string | null
  created_at: string
  member_count?: number
}

interface BoardMember {
  id: string
  board_id: string
  user_id: string
  role: 'chair' | 'secretary' | 'member'
  joined_at: string
  profile?: { first_name: string | null; last_name: string | null; email: string } | null
}

interface BoardItem {
  id: string
  board_id: string
  title: string
  body: string | null
  item_type: 'agenda' | 'action' | 'note'
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  assigned_to: string | null
  due_date: string | null
  created_by: string
  created_at: string
  assignee?: { first_name: string | null; last_name: string | null } | null
}

type Tab          = 'items' | 'members' | 'submissions'

interface BoardSubmission {
  id: string
  board_id: string
  offering_id?: string | null
  status: 'pending' | 'reviewed' | 'ratified' | 'rejected'
  note: string | null
  submitted_at: string
  offering?: {
    results_status: string
    course?: { code: string; title: string } | null
    semester?: { label: string; session?: { label: string } | null } | null
  } | null
  submitter?: {
    profile?: { first_name: string | null; last_name: string | null } | null
  } | null
}

const SUB_STATUS_STYLE: Record<string, string> = {
  pending:  'bg-gray-50 text-gray-600 border-gray-200',
  reviewed: 'bg-blue-50 text-blue-700 border-blue-200',
  ratified: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-600 border-red-200',
}

const RESULT_STATUS_STYLE: Record<string, string> = {
  draft:            'bg-gray-100 text-gray-500',
  submitted:        'bg-yellow-50 text-yellow-700',
  dept_verified:    'bg-blue-50 text-blue-700',
  dept_approved:    'bg-purple-50 text-purple-700',
  faculty_verified: 'bg-violet-50 text-violet-700',
  published:        'bg-green-50 text-green-700',
}
type StatusFilter = 'all' | 'open' | 'in_progress' | 'done'

const TYPE_LABEL: Record<string, string> = {
  committee:     'Committee',
  board:         'Board',
  task_force:    'Task Force',
  working_group: 'Working Group',
}

const TYPE_COLOR: Record<string, string> = {
  committee:     'bg-blue-50 text-blue-700 border-blue-200',
  board:         'bg-purple-50 text-purple-700 border-purple-200',
  task_force:    'bg-amber-50 text-amber-700 border-amber-200',
  working_group: 'bg-green-50 text-green-700 border-green-200',
}

const STATUS_STYLE: Record<string, string> = {
  open:        'bg-gray-50 text-gray-600 border-gray-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  done:        'bg-green-50 text-green-700 border-green-200',
  cancelled:   'bg-red-50 text-red-600 border-red-200',
}

function pname(p?: { first_name: string | null; last_name: string | null; email?: string } | null): string {
  if (!p) return '—'
  const n = [p.first_name, p.last_name].filter(Boolean).join(' ')
  return n || (p as any).email || '—'
}

export default function TertiaryBoards({ appUser }: { appUser: AppUser }) {
  const schoolId   = appUser.activeSchool?.id ?? ''
  const userId     = appUser.profile.id
  const officeName    = appUser.activeMembership?.office?.name ?? ''
  const isAdmin       = officeName === 'school_admin'
  // Non-admin roles only see boards they're explicitly added to
  const boardAdmins   = ['school_admin', 'registrar', 'senate_secretary']
  const isMemberBased = !boardAdmins.includes(officeName)

  const [boards,   setBoards]   = useState<Board[]>([])
  const [selected, setSelected] = useState<Board | null>(null)
  const [items,    setItems]    = useState<BoardItem[]>([])
  const [members,  setMembers]  = useState<BoardMember[]>([])
  const [tab,      setTab]      = useState<Tab>('items')
  const [filter,   setFilter]   = useState<StatusFilter>('all')
  const [loading,  setLoading]  = useState(true)
  const [toast,    setToast]    = useState<string | null>(null)

  // Create board (admin only)
  const [showNewBoard,  setShowNewBoard]  = useState(false)
  const [newBoardName,  setNewBoardName]  = useState('')
  const [newBoardDesc,  setNewBoardDesc]  = useState('')
  const [newBoardType,  setNewBoardType]  = useState<Board['board_type']>('committee')
  const [creatingBoard, setCreatingBoard] = useState(false)

  // Submissions
  const [submissions,     setSubmissions]     = useState<BoardSubmission[]>([])
  const [subsLoading,     setSubsLoading]     = useState(false)
  const [expandedSub,     setExpandedSub]     = useState<string | null>(null)

  // New item
  const [showNewItem, setShowNewItem] = useState(false)
  const [itemTitle,   setItemTitle]   = useState('')
  const [itemBody,    setItemBody]    = useState('')
  const [itemType,    setItemType]    = useState<BoardItem['item_type']>('action')
  const [itemDue,     setItemDue]     = useState('')
  const [savingItem,  setSavingItem]  = useState(false)

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const loadBoards = useCallback(async () => {
    if (!schoolId) return
    setLoading(true)

    let data: any[] | null = null

    if (isMemberBased) {
      // Non-admin roles only see boards they're assigned to
      const { data: myMems } = await supabase
        .from('board_members').select('board_id').eq('user_id', userId)
      const boardIds = (myMems ?? []).map((m: any) => m.board_id)
      if (!boardIds.length) { setBoards([]); setLoading(false); return }
      const res = await supabase.from('boards').select('*')
        .in('id', boardIds).eq('is_active', true).order('created_at', { ascending: false })
      data = res.data
    } else {
      const res = await supabase.from('boards').select('*')
        .eq('institution_id', schoolId).eq('is_active', true).order('created_at', { ascending: false })
      data = res.data
    }

    const ids = (data ?? []).map((b: any) => b.id)
    let counts: Record<string, number> = {}
    if (ids.length) {
      const { data: mc } = await supabase
        .from('board_members').select('board_id').in('board_id', ids)
      for (const r of mc ?? []) counts[r.board_id] = (counts[r.board_id] ?? 0) + 1
    }
    setBoards((data ?? []).map((b: any) => ({ ...b, member_count: counts[b.id] ?? 0 })))
    setLoading(false)
  }, [schoolId, isMemberBased, userId])

  useEffect(() => { loadBoards() }, [loadBoards])

  async function createBoard() {
    if (!newBoardName.trim() || !schoolId) return
    setCreatingBoard(true)
    const { data, error } = await supabase.from('boards').insert({
      institution_id: schoolId,
      name:           newBoardName.trim(),
      description:    newBoardDesc.trim() || null,
      board_type:     newBoardType,
      created_by:     userId,
      is_active:      true,
    }).select().single()
    setCreatingBoard(false)
    if (error) { flash('Failed to create board.'); return }
    setShowNewBoard(false); setNewBoardName(''); setNewBoardDesc('')
    await loadBoards()
    if (data) loadDetail(data as Board)
  }

  async function loadDetail(board: Board) {
    setSelected(board)
    setTab('items')
    setFilter('all')
    setExpandedSub(null)
    const [{ data: iData }, { data: mData }] = await Promise.all([
      supabase.from('board_items')
        .select('*, assignee:profiles!assigned_to(first_name, last_name)')
        .eq('board_id', board.id)
        .order('created_at', { ascending: false }),
      supabase.from('board_members')
        .select('*, profile:profiles!user_id(id, first_name, last_name, email)')
        .eq('board_id', board.id)
        .order('joined_at'),
    ])
    setItems((iData ?? []) as unknown as BoardItem[])
    setMembers((mData ?? []) as unknown as BoardMember[])
    loadSubmissions(board)
  }

  async function addItem() {
    if (!selected || !itemTitle.trim()) return
    setSavingItem(true)
    const { error } = await supabase.from('board_items').insert({
      board_id:   selected.id,
      title:      itemTitle.trim(),
      body:       itemBody.trim() || null,
      item_type:  itemType,
      due_date:   itemDue || null,
      created_by: userId,
    })
    if (!error) {
      flash('Item added.')
      setShowNewItem(false); setItemTitle(''); setItemBody(''); setItemDue('')
      loadDetail(selected)
    }
    setSavingItem(false)
  }

  async function updateStatus(itemId: string, status: BoardItem['status']) {
    await supabase.from('board_items').update({ status }).eq('id', itemId)
    if (selected) loadDetail(selected)
  }

  async function loadSubmissions(board: Board) {
    setSubsLoading(true)
    const { data } = await supabase
      .from('board_submissions')
      .select(`
        id, board_id, offering_id, status, note, submitted_at,
        offering:course_offerings!offering_id(
          results_status,
          course:courses!course_id(code, title),
          semester:semesters!semester_id(label, session:academic_sessions!session_id(label))
        ),
        submitter:memberships!submitted_by_membership_id(
          profile:profiles!profile_id(first_name, last_name)
        )
      `)
      .eq('board_id', board.id)
      .order('submitted_at', { ascending: false })
    setSubmissions((data ?? []) as unknown as BoardSubmission[])
    setSubsLoading(false)
  }

  async function updateSubmissionStatus(subId: string, status: BoardSubmission['status']) {
    await supabase.from('board_submissions').update({ status }).eq('id', subId)
    if (selected) loadSubmissions(selected)
  }

  const filteredItems = filter === 'all'
    ? items
    : items.filter(i => i.status === filter)

  const openCount = items.filter(i => i.status !== 'done' && i.status !== 'cancelled').length

  return (
    <div className="flex h-[calc(100vh-48px)]">

      {/* ── Left: board list ── */}
      <div className="w-[272px] border-r border-gray-200 bg-white flex flex-col flex-shrink-0">
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] font-bold text-navy-900">Boards</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Committees & working groups</div>
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowNewBoard(true)}
                className="text-[11px] font-semibold text-navy-700 border border-navy-200 px-2.5 py-1 rounded cursor-pointer hover:bg-navy-50 flex-shrink-0"
              >
                + New
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-[12px] text-gray-400">Loading…</div>
          ) : boards.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="text-[12px] text-gray-400">
                {isMemberBased ? 'You have not been assigned to any boards yet.' : 'No boards yet.'}
              </div>
              {isAdmin && (
                <button onClick={() => setShowNewBoard(true)}
                  className="mt-3 text-[11px] font-semibold text-navy-700 border border-navy-200 px-3 py-1.5 rounded cursor-pointer hover:bg-navy-50">
                  + Create Board
                </button>
              )}
            </div>
          ) : boards.map(b => (
            <button
              key={b.id}
              onClick={() => loadDetail(b)}
              className={`w-full text-left px-4 py-3.5 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer ${
                selected?.id === b.id
                  ? 'bg-navy-50 border-l-[3px] border-l-amber-500 pl-[13px]'
                  : ''
              }`}
            >
              <div className="text-[13px] font-semibold text-navy-900 truncate leading-tight">{b.name}</div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${TYPE_COLOR[b.board_type]}`}>
                  {TYPE_LABEL[b.board_type]}
                </span>
                <span className="text-[11px] text-gray-400">
                  {b.member_count} member{b.member_count !== 1 ? 's' : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: board detail ── */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {!selected ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-[13px] font-semibold text-gray-400">Select a board</div>
            </div>
          </div>
        ) : (
          <div className="p-6 max-w-3xl">

            {toast && (
              <div className="mb-4 px-4 py-2 bg-green-50 border border-green-200 rounded text-[13px] text-green-700">
                {toast}
              </div>
            )}

            {/* Header */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-[20px] font-bold text-navy-900">{selected.name}</h1>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${TYPE_COLOR[selected.board_type]}`}>
                  {TYPE_LABEL[selected.board_type]}
                </span>
              </div>
              {selected.description && (
                <p className="text-[13px] text-gray-500">{selected.description}</p>
              )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 mb-5">
              {(['items', 'members', 'submissions'] as Tab[]).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
                    tab === t
                      ? 'border-navy-900 text-navy-900'
                      : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}>
                  {t === 'items'
                    ? `Action Items${openCount > 0 ? ` (${openCount})` : ''}`
                    : t === 'members'
                    ? `Members (${members.length})`
                    : `Submissions${submissions.length > 0 ? ` (${submissions.length})` : ''}`}
                </button>
              ))}
            </div>

            {/* Items tab */}
            {tab === 'items' && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex gap-1">
                    {(['all', 'open', 'in_progress', 'done'] as StatusFilter[]).map(f => (
                      <button key={f} onClick={() => setFilter(f)}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded cursor-pointer transition-colors ${
                          filter === f
                            ? 'bg-navy-900 text-white'
                            : 'bg-white border border-gray-200 text-gray-500 hover:border-navy-300'
                        }`}>
                        {f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowNewItem(true)}
                    className="text-[12px] font-semibold text-navy-700 border border-navy-200 px-3 py-1 rounded cursor-pointer hover:bg-navy-50">
                    + Add Item
                  </button>
                </div>

                {filteredItems.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-[13px] text-gray-400">No items{filter !== 'all' ? ` with status "${filter}"` : ''}.</div>
                    {filter === 'all' && (
                      <div className="text-[11px] text-gray-300 mt-1">Add action items, agenda points, or notes.</div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredItems.map(item => (
                      <div key={item.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13px] font-semibold text-navy-900">{item.title}</span>
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border text-gray-500 bg-gray-50 border-gray-200 capitalize">
                                {item.item_type === 'action' ? 'Action' : item.item_type === 'agenda' ? 'Agenda' : 'Note'}
                              </span>
                            </div>
                            {item.body && (
                              <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{item.body}</p>
                            )}
                            {(item.assignee || item.due_date) && (
                              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                                {item.assignee && <span>↳ {pname(item.assignee)}</span>}
                                {item.due_date && (
                                  <span>Due {new Date(item.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex-shrink-0">
                            <select
                              value={item.status}
                              onChange={e => updateStatus(item.id, e.target.value as BoardItem['status'])}
                              className={`text-[11px] font-semibold px-2 py-1 rounded border cursor-pointer appearance-none ${STATUS_STYLE[item.status]}`}
                            >
                              <option value="open">Open</option>
                              <option value="in_progress">In Progress</option>
                              <option value="done">Done</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Members tab */}
            {tab === 'members' && (
              <div>
                {members.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-[13px] text-gray-400">No members assigned yet.</div>
                    <div className="text-[11px] text-gray-300 mt-1">Members are assigned from Coredesk.</div>
                  </div>
                ) : (
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    {members.map((m, i) => (
                      <div key={m.id}
                        className={`flex items-center justify-between px-4 py-3 ${i < members.length - 1 ? 'border-b border-gray-50' : ''}`}>
                        <div>
                          <div className="text-[13px] font-semibold text-navy-900">{pname(m.profile)}</div>
                          <div className="text-[11px] text-gray-400">{m.profile?.email}</div>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
                          m.role === 'chair'     ? 'bg-navy-900 text-white'       :
                          m.role === 'secretary' ? 'bg-amber-100 text-amber-800'  :
                                                   'bg-gray-100 text-gray-500'
                        }`}>
                          {m.role}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Submissions tab */}
            {tab === 'submissions' && (
              <div>
                {subsLoading ? (
                  <div className="text-center py-12 text-[13px] text-gray-400">Loading…</div>
                ) : submissions.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-[13px] text-gray-400">No submissions yet.</div>
                    <div className="text-[11px] text-gray-300 mt-1">Lecturers assigned to this board can submit their course results here for ratification.</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {submissions.map(sub => {
                      const course  = (sub.offering?.course as any)
                      const sem     = (sub.offering?.semester as any)
                      const lecturer = (sub.submitter?.profile as any)
                      const lecName = lecturer ? `${lecturer.first_name ?? ''} ${lecturer.last_name ?? ''}`.trim() : '—'
                      const isOpen  = expandedSub === sub.id

                      return (
                        <div key={sub.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                          {/* Row */}
                          <div className="flex items-center justify-between px-4 py-3 gap-4">
                            <button
                              onClick={() => setExpandedSub(isOpen ? null : sub.id)}
                              className="flex-1 min-w-0 text-left">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[13px] font-bold text-navy-900 font-mono">{course?.code ?? '—'}</span>
                                <span className="text-[12px] text-gray-600 truncate">{course?.title}</span>
                              </div>
                              <div className="text-[11px] text-gray-400 mt-0.5">
                                {sem?.session?.label} · {sem?.label} · {lecName}
                              </div>
                            </button>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {/* Pipeline status */}
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${RESULT_STATUS_STYLE[sub.offering?.results_status ?? ''] ?? 'bg-gray-100 text-gray-500'}`}>
                                {sub.offering?.results_status ?? '—'}
                              </span>
                              {/* Ratification status */}
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${SUB_STATUS_STYLE[sub.status]}`}>
                                {sub.status}
                              </span>
                            </div>
                          </div>

                          {/* Expanded detail */}
                          {isOpen && (
                            <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-3">
                              <div className="text-[11px] text-gray-500">
                                Submitted {new Date(sub.submitted_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                              {sub.note && (
                                <div className="text-[12px] text-gray-700 bg-white border border-gray-200 rounded p-3 leading-relaxed whitespace-pre-wrap">
                                  {sub.note}
                                </div>
                              )}
                              {/* Status actions */}
                              {sub.status === 'pending' || sub.status === 'reviewed' ? (
                                <div className="flex items-center gap-2 pt-1">
                                  <span className="text-[11px] text-gray-500 mr-1">Board action:</span>
                                  {sub.status === 'pending' && (
                                    <button onClick={() => updateSubmissionStatus(sub.id, 'reviewed')}
                                      className="text-[11px] font-semibold px-3 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer transition-colors">
                                      Mark Reviewed
                                    </button>
                                  )}
                                  <button onClick={() => updateSubmissionStatus(sub.id, 'ratified')}
                                    className="text-[11px] font-semibold px-3 py-1 rounded border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer transition-colors">
                                    Ratify
                                  </button>
                                  <button onClick={() => updateSubmissionStatus(sub.id, 'rejected')}
                                    className="text-[11px] font-semibold px-3 py-1 rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer transition-colors">
                                    Reject
                                  </button>
                                </div>
                              ) : (
                                <div className="text-[11px] text-gray-400">
                                  {sub.status === 'ratified' ? 'Ratified by board' : 'Rejected by board'}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Create Board modal ── */}
      {showNewBoard && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-4">Create Board</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Name</label>
                <input value={newBoardName} onChange={e => setNewBoardName(e.target.value)} autoFocus
                  placeholder="e.g. Academic Standards Committee"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy-300" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Type</label>
                <select value={newBoardType} onChange={e => setNewBoardType(e.target.value as Board['board_type'])}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy-300">
                  <option value="committee">Committee</option>
                  <option value="board">Board</option>
                  <option value="task_force">Task Force</option>
                  <option value="working_group">Working Group</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Description (optional)</label>
                <textarea value={newBoardDesc} onChange={e => setNewBoardDesc(e.target.value)}
                  rows={2} placeholder="Purpose or mandate…"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-1 focus:ring-navy-300" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => { setShowNewBoard(false); setNewBoardName(''); setNewBoardDesc('') }}
                className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={createBoard} disabled={creatingBoard || !newBoardName.trim()}
                className="px-4 py-1.5 bg-navy-900 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-navy-800 disabled:opacity-50">
                {creatingBoard ? 'Creating…' : 'Create Board'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Item modal ── */}
      {showNewItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-navy-900 mb-4">Add Item</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Title</label>
                <input value={itemTitle} onChange={e => setItemTitle(e.target.value)} autoFocus
                  placeholder="e.g. Review fee schedule for 2026/27"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Type</label>
                  <select value={itemType} onChange={e => setItemType(e.target.value as BoardItem['item_type'])}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-navy-300">
                    <option value="action">Action Item</option>
                    <option value="agenda">Agenda</option>
                    <option value="note">Note</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Due Date</label>
                  <input type="date" value={itemDue} onChange={e => setItemDue(e.target.value)}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-navy-300" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes (optional)</label>
                <textarea value={itemBody} onChange={e => setItemBody(e.target.value)}
                  rows={2} placeholder="Additional context or details…"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-1 focus:ring-navy-300" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowNewItem(false)}
                className="px-3 py-1.5 text-[13px] text-gray-600 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={addItem} disabled={savingItem || !itemTitle.trim()}
                className="px-4 py-1.5 bg-navy-900 text-white text-[13px] font-semibold rounded cursor-pointer hover:bg-navy-800 disabled:opacity-50">
                {savingItem ? 'Adding…' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
