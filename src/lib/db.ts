import Dexie, { type Table } from 'dexie'

interface CachedResponse {
  id?: number
  key: string
  data: unknown
  timestamp: number
}

interface QueuedMutation {
  id?: number
  url: string
  method: string
  body: string | null
  headers: string
  timestamp: number
  retries: number
}

class RegentosDB extends Dexie {
  responseCache!: Table<CachedResponse>
  mutationQueue!: Table<QueuedMutation>

  constructor() {
    super('RegentosDB')
    this.version(1).stores({
      responseCache: '++id, key, timestamp',
      mutationQueue: '++id, timestamp, retries',
    })
  }
}

export const db = new RegentosDB()

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function getCachedResponse(key: string): Promise<unknown | null> {
  const entry = await db.responseCache.where('key').equals(key).first()
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    await db.responseCache.where('key').equals(key).delete()
    return null
  }
  return entry.data
}

export async function setCachedResponse(key: string, data: unknown) {
  await db.responseCache.where('key').equals(key).delete()
  await db.responseCache.add({ key, data, timestamp: Date.now() })
}

export async function queueMutation(mutation: Omit<QueuedMutation, 'id' | 'retries'>) {
  await db.mutationQueue.add({ ...mutation, retries: 0 })
}

export async function getPendingCount(): Promise<number> {
  return db.mutationQueue.count()
}
