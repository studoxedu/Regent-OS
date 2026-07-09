import { db } from './db'

let syncing = false

export async function drainMutationQueue(): Promise<{ success: number; failed: number }> {
  if (syncing) return { success: 0, failed: 0 }
  syncing = true

  let success = 0
  let failed = 0

  try {
    const mutations = await db.mutationQueue.orderBy('timestamp').toArray()

    for (const mutation of mutations) {
      try {
        const response = await fetch(mutation.url, {
          method: mutation.method,
          body: mutation.body ?? undefined,
          headers: {
            ...JSON.parse(mutation.headers),
            'Content-Type': 'application/json',
          },
        })

        if (response.ok || response.status === 409) {
          await db.mutationQueue.delete(mutation.id!)
          success++
        } else if (mutation.retries >= 3) {
          await db.mutationQueue.delete(mutation.id!)
          failed++
        } else {
          await db.mutationQueue.update(mutation.id!, { retries: mutation.retries + 1 })
          failed++
        }
      } catch {
        if (mutation.retries >= 3) {
          await db.mutationQueue.delete(mutation.id!)
          failed++
        } else {
          await db.mutationQueue.update(mutation.id!, { retries: mutation.retries + 1 })
        }
      }
    }
  } finally {
    syncing = false
  }

  return { success, failed }
}

export function startSyncManager(onSync?: (r: { success: number; failed: number }) => void) {
  window.addEventListener('online', async () => {
    const result = await drainMutationQueue()
    onSync?.(result)
    window.dispatchEvent(new CustomEvent('regentos:synced', { detail: result }))
  })
}
