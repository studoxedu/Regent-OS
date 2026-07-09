import { useCallback, useEffect, useRef, useState } from 'react'
import { Topbar } from '../../components/layout/Topbar'
import { Card, Alert } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select, Field } from '../../components/ui/Form'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import type { AppUser, Conversation, ChatMessage } from '../../types'

interface Props { appUser: AppUser }

interface Recipient {
  profileId: string
  name: string
  role: string
}

function displayName(p?: { first_name: string | null; last_name: string | null; email?: string } | null) {
  if (!p) return 'Unknown'
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Unknown'
}

function timeAgo(dateStr: string) {
  const diff  = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 1)   return 'now'
  if (mins < 60)  return `${mins}m`
  if (hours < 24) return `${hours}h`
  return `${days}d`
}

export default function Messages({ appUser }: Props) {
  const schoolId  = appUser.activeSchool?.id ?? ''
  const myId      = appUser.profile.id
  const isStudent = (appUser.activeMembership?.office?.name ?? '') === 'student'

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected]           = useState<string | null>(null)
  const [thread, setThread]               = useState<ChatMessage[]>([])
  const [draft, setDraft]                 = useState('')
  const [loading, setLoading]             = useState(true)
  const [sending, setSending]             = useState(false)
  const [toast, setToast]                 = useState<string | null>(null)

  // New-conversation form
  const [composing, setComposing]   = useState(false)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [recipient, setRecipient]   = useState('')
  const [subject, setSubject]       = useState('')
  const [firstMsg, setFirstMsg]     = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from('conversations')
      .select('*, participants:conversation_participants(id, conversation_id, profile_id, last_read_at, created_at, profile:profiles(id, first_name, last_name, email))')
      .order('last_message_at', { ascending: false })
      .limit(100)
    setConversations((data ?? []) as unknown as Conversation[])
    setLoading(false)
  }, [])

  const loadThread = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('*, sender:profiles(id, first_name, last_name, email)')
      .eq('conversation_id', conversationId)
      .order('created_at')
      .limit(500)
    setThread((data ?? []) as unknown as ChatMessage[])
    // Mark read
    await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('profile_id', myId)
  }, [myId])

  // Initial + polled loading (15s keeps the inbox reasonably live without realtime)
  useEffect(() => {
    loadConversations()
    const t = setInterval(loadConversations, 15000)
    return () => clearInterval(t)
  }, [loadConversations])

  useEffect(() => {
    if (!selected) return
    loadThread(selected)
    const t = setInterval(() => loadThread(selected), 10000)
    return () => clearInterval(t)
  }, [selected, loadThread])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread.length])

  // Recipient directory: students see staff; staff see staff + students
  useEffect(() => {
    if (!schoolId) return
    async function loadRecipients() {
      const list: Recipient[] = []
      const { data: staff } = await supabase
        .from('memberships')
        .select('profile_id, office:offices(name), profile:profiles(id, first_name, last_name, email)')
        .eq('school_id', schoolId)
        .eq('is_active', true)
      for (const m of (staff ?? []) as unknown as { profile_id: string; office: { name: string } | null; profile: { first_name: string | null; last_name: string | null; email: string } | null }[]) {
        if (m.profile_id === myId) continue
        list.push({
          profileId: m.profile_id,
          name: displayName(m.profile),
          role: (m.office?.name ?? 'staff').replace(/_/g, ' '),
        })
      }
      if (!isStudent) {
        const { data: students } = await supabase
          .from('students')
          .select('auth_user_id, first_name, last_name, reg_number')
          .eq('institution_id', schoolId)
          .not('auth_user_id', 'is', null)
          .limit(1000)
        for (const s of students ?? []) {
          if (s.auth_user_id === myId) continue
          list.push({
            profileId: s.auth_user_id as string,
            name: `${s.first_name} ${s.last_name} (${s.reg_number})`,
            role: 'student',
          })
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name))
      setRecipients(list)
    }
    loadRecipients()
  }, [schoolId, myId, isStudent])

  function flash(msg: string) {
    setToast(msg); setTimeout(() => setToast(null), 4000)
  }

  async function startConversation() {
    if (!recipient || !firstMsg.trim()) return
    setSending(true)
    const { data: conv, error } = await supabase
      .from('conversations')
      .insert({ school_id: schoolId, subject: subject.trim() || null, created_by: myId })
      .select()
      .single()
    if (error || !conv) { setSending(false); flash(error?.message ?? 'Could not start conversation'); return }

    const { error: pErr } = await supabase.from('conversation_participants').insert([
      { conversation_id: conv.id, profile_id: myId },
      { conversation_id: conv.id, profile_id: recipient },
    ])
    if (pErr) { setSending(false); flash(pErr.message); return }

    const { error: mErr } = await supabase.from('messages').insert({
      conversation_id: conv.id, sender_profile_id: myId, body: firstMsg.trim(),
    })
    setSending(false)
    if (mErr) { flash(mErr.message); return }

    setComposing(false); setRecipient(''); setSubject(''); setFirstMsg('')
    await loadConversations()
    setSelected(conv.id)
  }

  async function send() {
    if (!selected || !draft.trim()) return
    setSending(true)
    const { error } = await supabase.from('messages').insert({
      conversation_id: selected, sender_profile_id: myId, body: draft.trim(),
    })
    setSending(false)
    if (error) { flash(error.message); return }
    setDraft('')
    loadThread(selected)
    loadConversations()
  }

  function conversationLabel(c: Conversation) {
    const others = (c.participants ?? []).filter(p => p.profile_id !== myId)
    const names  = others.map(p => displayName(p.profile)).join(', ')
    return c.subject || names || 'Conversation'
  }

  function isUnread(c: Conversation) {
    const me = (c.participants ?? []).find(p => p.profile_id === myId)
    if (!me) return false
    return !me.last_read_at || new Date(c.last_message_at) > new Date(me.last_read_at)
  }

  const selectedConv = conversations.find(c => c.id === selected) ?? null

  return (
    <>
      <Topbar
        title="Messages"
        meta={appUser.activeSchool?.name}
        actions={
          <Button variant="primary" size="sm" onClick={() => setComposing(v => !v)}>
            {composing ? 'Cancel' : '+ New Message'}
          </Button>
        }
      />

      <div className="p-8 space-y-5">
        {toast && <Alert type="danger">{toast}</Alert>}

        {composing && (
          <Card className="p-5 max-w-xl">
            <div className="text-sm font-bold text-navy-900 mb-4">New Conversation</div>
            <Field label="To" required>
              <Select value={recipient} onChange={e => setRecipient(e.target.value)}
                placeholder="Select recipient…"
                options={recipients.map(r => ({ value: r.profileId, label: `${r.name} — ${r.role}` }))} />
            </Field>
            <Field label="Subject">
              <Input placeholder="e.g. CSC 201 assignment" value={subject} onChange={e => setSubject(e.target.value)} />
            </Field>
            <Field label="Message" required>
              <textarea
                rows={4}
                placeholder="Type your message…"
                value={firstMsg}
                onChange={e => setFirstMsg(e.target.value)}
                className="w-full border border-gray-200 rounded-sm px-3 py-2 text-sm outline-none focus:border-navy-900 resize-none"
              />
            </Field>
            <Button variant="primary" size="sm" onClick={startConversation}
              disabled={sending || !recipient || !firstMsg.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </Card>
        )}

        <div className="flex gap-5 h-[calc(100vh-220px)] min-h-[400px]">
          {/* Conversation list */}
          <Card className="w-72 flex-shrink-0 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 text-sm font-bold text-navy-900">Inbox</div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="text-xs text-gray-400 text-center py-10">Loading…</div>
              ) : conversations.length === 0 ? (
                <div className="text-xs text-gray-400 text-center py-10 px-4">
                  No conversations yet. Start one with “New Message”.
                </div>
              ) : conversations.map(c => {
                const unread = isUnread(c)
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 border-b border-gray-50 transition-colors',
                      selected === c.id ? 'bg-navy-100/60' : 'hover:bg-gray-50'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-[13px] truncate', unread ? 'font-bold text-navy-900' : 'font-medium text-gray-700')}>
                        {conversationLabel(c)}
                      </span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{timeAgo(c.last_message_at)}</span>
                    </div>
                    {unread && <span className="inline-block mt-1 w-1.5 h-1.5 rounded-full bg-amber-500" />}
                  </button>
                )
              })}
            </div>
          </Card>

          {/* Thread */}
          <Card className="flex-1 flex flex-col overflow-hidden">
            {!selectedConv ? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
                Select a conversation to read it.
              </div>
            ) : (
              <>
                <div className="px-5 py-3 border-b border-gray-100">
                  <div className="text-sm font-bold text-navy-900">{conversationLabel(selectedConv)}</div>
                  <div className="text-[11px] text-gray-400">
                    {(selectedConv.participants ?? []).map(p => displayName(p.profile)).join(' · ')}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-gray-50/40">
                  {thread.map(m => {
                    const mine = m.sender_profile_id === myId
                    return (
                      <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                          'max-w-[70%] rounded-sm px-3.5 py-2.5',
                          mine ? 'bg-navy-900 text-white' : 'bg-white border border-gray-200 text-navy-900'
                        )}>
                          {!mine && (
                            <div className="text-[10px] font-bold uppercase tracking-wide mb-0.5 text-gray-400">
                              {displayName(m.sender)}
                            </div>
                          )}
                          <div className="text-sm leading-relaxed whitespace-pre-wrap">{m.body}</div>
                          <div className={cn('text-[10px] mt-1', mine ? 'text-navy-300' : 'text-gray-400')}>
                            {new Date(m.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>

                <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
                  <Input
                    placeholder="Type a message…"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  />
                  <Button variant="primary" size="sm" onClick={send} disabled={sending || !draft.trim()}>
                    Send
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
