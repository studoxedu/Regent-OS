import { getCachedResponse, setCachedResponse, queueMutation } from './db'

function parseJwtUserId(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.sub ?? 'anon'
  } catch {
    return 'anon'
  }
}

function buildCacheKey(url: string, headers: Record<string, string>): string {
  const token = headers['Authorization']?.replace('Bearer ', '') ?? ''
  const userId = token ? parseJwtUserId(token) : 'anon'
  return `${userId}:${url}`
}

function isAuthUrl(url: string): boolean {
  return url.includes('/auth/v1/')
}

function isRpcUrl(url: string): boolean {
  return url.includes('/rest/v1/rpc/')
}

function isStorageUrl(url: string): boolean {
  return url.includes('/storage/v1/')
}

function isFunctionsUrl(url: string): boolean {
  return url.includes('/functions/v1/')
}

const WRITE_RPCS = ['flow_execute', 'create_staff_member']

function isMutation(method: string, url: string): boolean {
  if (method === 'PATCH' || method === 'DELETE') return true
  if (method === 'POST' && !isRpcUrl(url)) return true
  if (method === 'POST' && isRpcUrl(url)) {
    return WRITE_RPCS.some(rpc => url.includes(`/rpc/${rpc}`))
  }
  return false
}

let interceptorInstalled = false

export function installFetchInterceptor() {
  if (interceptorInstalled) return
  interceptorInstalled = true

  const originalFetch = window.fetch.bind(window)

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url

    const isSupabase = url.includes('.supabase.co')
    if (!isSupabase) return originalFetch(input, init)

    // Auth, storage and edge functions (e.g. payments) always go through
    // directly — a queued/faked payment call must never report success.
    if (isAuthUrl(url) || isStorageUrl(url) || isFunctionsUrl(url)) return originalFetch(input, init)

    const method = (init?.method ?? 'GET').toUpperCase()
    const headersObj = Object.fromEntries(
      new Headers(init?.headers ?? {}).entries()
    )
    const cacheKey = buildCacheKey(url, headersObj)

    if (!navigator.onLine) {
      if (isMutation(method, url)) {
        await queueMutation({
          url,
          method,
          body: typeof init?.body === 'string' ? init.body : null,
          headers: JSON.stringify(headersObj),
          timestamp: Date.now(),
        })
        // Return a quiet success so the UI doesn't crash
        const empty = method === 'DELETE' ? [] : {}
        return new Response(JSON.stringify(empty), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      } else {
        // Read — serve from cache
        const cached = await getCachedResponse(cacheKey)
        if (cached !== null) {
          return new Response(JSON.stringify(cached), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Online — execute normally then cache reads
    const response = await originalFetch(input, init)

    if (response.ok && (method === 'GET' || isRpcUrl(url))) {
      try {
        const data = await response.clone().json()
        await setCachedResponse(cacheKey, data)
      } catch {
        // unparseable body — skip caching
      }
    }

    return response
  }
}
