import { useState } from 'react'
import { useOnline } from '../../hooks/useOnline'
import { drainMutationQueue } from '../../lib/syncManager'

export function SyncBanner() {
  const { isOnline, pendingCount } = useOnline()
  const [syncing, setSyncing] = useState(false)

  // Nothing to show when fully online and nothing pending
  if (isOnline && pendingCount === 0) return null

  async function handleSync() {
    setSyncing(true)
    await drainMutationQueue()
    window.dispatchEvent(new CustomEvent('regentos:synced'))
    setSyncing(false)
  }

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-between px-5 py-2.5 text-[13px] font-medium shadow-lg ${
        isOnline
          ? 'bg-amber-500 text-white'
          : 'bg-gray-900 text-white'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-white/80' : 'bg-red-400 animate-pulse'}`} />
        {isOnline
          ? `${pendingCount} change${pendingCount !== 1 ? 's' : ''} waiting to sync`
          : 'Offline — changes will sync when connected'}
      </div>

      {isOnline && pendingCount > 0 && (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="text-[12px] font-semibold bg-white/20 hover:bg-white/30 px-3 py-1 rounded cursor-pointer disabled:opacity-60 transition-colors ml-4 flex-shrink-0"
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      )}
    </div>
  )
}
