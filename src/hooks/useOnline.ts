import { useEffect, useState } from 'react'
import { db } from '../lib/db'

export function useOnline() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)

  async function refreshCount() {
    const n = await db.mutationQueue.count()
    setPendingCount(n)
  }

  useEffect(() => {
    refreshCount()

    function handleOnline()  { setIsOnline(true);  refreshCount() }
    function handleOffline() { setIsOnline(false); refreshCount() }
    function handleSynced()  { refreshCount() }

    window.addEventListener('online',          handleOnline)
    window.addEventListener('offline',         handleOffline)
    window.addEventListener('regentos:synced',   handleSynced)

    return () => {
      window.removeEventListener('online',        handleOnline)
      window.removeEventListener('offline',       handleOffline)
      window.removeEventListener('regentos:synced', handleSynced)
    }
  }, [])

  return { isOnline, pendingCount }
}
