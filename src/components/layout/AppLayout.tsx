import { Suspense, useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { isK12Office, k12RouteAllowed, k12DefaultRoute } from '../../lib/roles'
import type { AppUser } from '../../types'

interface AppLayoutProps {
  appUser: AppUser
  onSignOut: () => void
  onSwitchMembership: (id: string) => void
}

interface Notification {
  id: string
  title: string
  body: string | null
  type: string
  link: string | null
  is_read: boolean
  created_at: string
}

function NotificationBell({ profileId }: { profileId: string }) {
  const navigate = useNavigate()
  const [open, setOpen]   = useState(false)
  const [notes, setNotes] = useState<Notification[]>([])
  const panelRef          = useRef<HTMLDivElement>(null)
  const unread            = notes.filter(n => !n.is_read).length

  useEffect(() => {
    supabase.from('notifications').select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setNotes((data ?? []) as Notification[]))

    const channel = supabase
      .channel(`notif:${profileId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `profile_id=eq.${profileId}`,
      }, payload => setNotes(prev => [payload.new as Notification, ...prev]))
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [profileId])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function markAllRead() {
    const ids = notes.filter(n => !n.is_read).map(n => n.id)
    if (ids.length === 0) return
    await supabase.from('notifications').update({ is_read: true }).in('id', ids)
    setNotes(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  function handleClick(n: Notification) {
    if (!n.is_read) {
      supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
      setNotes(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    }
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(v => !v); if (open === false && unread > 0) markAllRead() }}
        className="relative w-8 h-8 flex items-center justify-center text-navy-400 hover:text-white transition-colors"
        title="Notifications"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-10 w-80 bg-white border border-gray-200 rounded-sm shadow-modal z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-500">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-navy-700 font-semibold hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
            {notes.length === 0 ? (
              <div className="px-4 py-8 text-sm text-gray-400 text-center">No notifications</div>
            ) : notes.map(n => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  'w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors',
                  !n.is_read && 'bg-blue-50/40'
                )}
              >
                <div className="flex items-start gap-2">
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5',
                    n.type === 'success' ? 'bg-green-500' :
                    n.type === 'warning' ? 'bg-amber-500' :
                    n.type === 'alert'   ? 'bg-red-500' :
                    'bg-blue-500'
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-navy-900 leading-tight">{n.title}</div>
                    {n.body && <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{n.body}</div>}
                    <div className="text-[10px] text-gray-300 mt-1">
                      {new Date(n.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function AppLayout({ appUser, onSignOut, onSwitchMembership }: AppLayoutProps) {
  const location = useLocation()
  const office   = appUser.activeMembership?.office?.name ?? ''

  // Route guard: a K-12 office that opens a /k12 route outside its allowlist
  // (by typing the URL or a stale link) is bounced to its dashboard. The
  // sidebar already hides these; this closes the URL-typing gap.
  const blocked =
    isK12Office(office) &&
    location.pathname.startsWith('/k12') &&
    !k12RouteAllowed(office, location.pathname)

  return (
    <div className="flex fixed inset-0">
      <Sidebar appUser={appUser} onSignOut={onSignOut} onSwitchMembership={onSwitchMembership}>
        <NotificationBell profileId={appUser.profile.id} />
      </Sidebar>
      <main className="flex-1 flex flex-col overflow-auto bg-surface">
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="text-navy-400 text-xs tracking-widest uppercase">Loading…</div>
          </div>
        }>
          {blocked ? <Navigate to={k12DefaultRoute(office)} replace /> : <Outlet />}
        </Suspense>
      </main>
    </div>
  )
}
