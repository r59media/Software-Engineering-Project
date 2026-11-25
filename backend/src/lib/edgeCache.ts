export const PUBLIC_CACHE_VERSION_KEY = 'public_cache_version'
export const PUBLIC_READ_CACHE_CONTROL = 'public, max-age=30, s-maxage=300, stale-while-revalidate=600'
export const MEDIA_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'
export const MEDIA_VERSIONED_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const MEDIA_PRIVATE_CACHE_CONTROL = 'private, no-store'

function getDefaultEdgeCache(): Cache | undefined {
  try {
    return (caches as unknown as { default?: Cache })?.default
  } catch {
    return undefined
  }
}

export type EdgeCacheExecutionContext = {
  waitUntil(promise: Promise<unknown>): void
}

/** Safely reads Hono's executionCtx without throwing in Node unit tests. */
export function getExecutionCtx(c: { executionCtx?: EdgeCacheExecutionContext }): EdgeCacheExecutionContext | undefined {
  try {
    return c.executionCtx
  } catch {
    return undefined
  }
}

/** Returns true when a public GET request should bypass Cloudflare edge caching. */
export function shouldBypassPublicEdgeCache(c: {
  req: { query: (name: string) => string | undefined; header: (name: string) => string | undefined }
}): boolean {
  if (c.req.query('preview') !== undefined) return true
  const authHeader = c.req.header('Authorization')
  if (authHeader && authHeader.trim().length > 0) return true
  const cookie = c.req.header('Cookie')
  if (cookie && /(?:^|;\s*)(?:admin_session|session|token)=/i.test(cookie)) return true
  return false
}

/**
 * Reads the current public content cache version from Admin_Settings,
 * initializing it to '1' if missing, and never throwing.
 */
export async function getPublicContentVersion(db: D1Database | undefined): Promise<string> {
  if (!db) return '1'
  try {
    const row = await db
      .prepare('SELECT setting_value FROM Admin_Settings WHERE setting_key = ?')
      .bind(PUBLIC_CACHE_VERSION_KEY)
      .first<{ setting_value: string }>()

    if (row?.setting_value !== undefined && row.setting_value !== null && String(row.setting_value).trim() !== '') {
      return String(row.setting_value).trim()
    }

    await db
      .prepare('INSERT INTO Admin_Settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO NOTHING')
      .bind(PUBLIC_CACHE_VERSION_KEY, '1')
      .run()
      .catch(() => {})

    return '1'
  } catch {
    return '1'
  }
}

/**
 * Atomically increments public_cache_version in Admin_Settings so Cloudflare edge
 * caches across all POPs immediately bust after an Admin mutation.
 */
export async function bumpPublicContentVersion(db: D1Database | undefined): Promise<void> {
  if (!db) return
  try {
    await db
      .prepare('CREATE TABLE IF NOT EXISTS Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)')
      .run()
      .catch(() => {})

    await db
      .prepare(
        `INSERT INTO Admin_Settings (setting_key, setting_value)
         VALUES (?, '2')
         ON CONFLICT(setting_key) DO UPDATE SET
           setting_value = CAST(
             (CASE WHEN CAST(setting_value AS INTEGER) > 0 THEN CAST(setting_value AS INTEGER) ELSE 1 END) + 1
             AS TEXT
           )`
      )
      .bind(PUBLIC_CACHE_VERSION_KEY)
      .run()
  } catch {
    // Non-fatal: cache version bump failure should not fail admin mutations
  }
}

/**
 * Builds a canonical edge cache key URL with __cv=<version>.
 * When stripAuthParams is true (for /api/media/*), strips sig and exp so
 * every 30s signed URL maps to the same edge cache entry.
 */
export function buildEdgeCacheKey(
  requestUrl: string,
  version: string,
  options?: { stripAuthParams?: boolean }
): string {
  const url = new URL(requestUrl)
  if (options?.stripAuthParams) {
    url.searchParams.delete('sig')
    url.searchParams.delete('exp')
  }
  url.searchParams.set('__cv', version)
  return url.toString()
}

/** Attempts to match a GET request in Cloudflare's default edge cache; returns null in Node tests. */
export async function tryEdgeCacheMatch(cacheKeyUrl: string): Promise<Response | null> {
  const edgeCache = getDefaultEdgeCache()
  if (!edgeCache) return null
  try {
    const matched = await edgeCache.match(new Request(cacheKeyUrl, { method: 'GET' }))
    return matched || null
  } catch {
    return null
  }
}

/** Schedules a non-blocking edge cache write for 200 OK responses; no-ops in Node tests. */
export function scheduleEdgeCachePut(
  ctx: EdgeCacheExecutionContext | undefined,
  cacheKeyUrl: string,
  response: Response
): void {
  if (response.status !== 200) return
  const edgeCache = getDefaultEdgeCache()
  if (!edgeCache) return
  try {
    const putPromise = edgeCache.put(new Request(cacheKeyUrl, { method: 'GET' }), response.clone())
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(putPromise)
    }
  } catch {
    // Ignore edge cache write errors
  }
}

export interface PublicEdgeCacheContext {
  bypassEdgeCache: boolean
  cacheControl: string
  version?: string
}

/**
 * Wraps a public GET route with Cloudflare edge cache lookup, __cv cache-busting versioning,
 * and non-blocking cache population for cacheable 200 responses.
 */
export async function withPublicEdgeCache(
  c: {
    req: { url: string; query: (name: string) => string | undefined; header: (name: string) => string | undefined }
    env?: { DB?: D1Database }
    executionCtx?: EdgeCacheExecutionContext
  },
  buildResponse: (ctx: PublicEdgeCacheContext) => Promise<{ response: Response; cacheable?: boolean }>,
  options?: { bypass?: boolean }
): Promise<Response> {
  const bypassEdgeCache = Boolean(options?.bypass) || shouldBypassPublicEdgeCache(c)
  const cacheControl = bypassEdgeCache ? 'no-store' : PUBLIC_READ_CACHE_CONTROL
  let cacheKeyUrl: string | null = null
  let version: string | undefined

  if (!bypassEdgeCache) {
    version = await getPublicContentVersion(c.env?.DB)
    cacheKeyUrl = buildEdgeCacheKey(c.req.url, version)
    const cached = await tryEdgeCacheMatch(cacheKeyUrl)
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: cached.headers
      })
    }
  }

  const { response, cacheable = true } = await buildResponse({
    bypassEdgeCache,
    cacheControl,
    version
  })

  if (cacheable && !bypassEdgeCache && cacheKeyUrl) {
    scheduleEdgeCachePut(getExecutionCtx(c), cacheKeyUrl, response)
  }

  return response
}

/**
 * Convenience wrapper for public JSON GET endpoints: serves edge cache when eligible,
 * sets Cache-Control, and falls back to `fallback()` with `no-store` if `loadPayload()` throws.
 */
export async function withPublicJsonCache(
  c: {
    req: { url: string; query: (name: string) => string | undefined; header: (name: string) => string | undefined }
    env?: { DB?: D1Database }
    executionCtx?: EdgeCacheExecutionContext
    header: (name: string, value: string) => void
    json: (data: any) => Response
  },
  loadPayload: () => Promise<Record<string, unknown>>,
  fallbackPayload: () => Record<string, unknown>
): Promise<Response> {
  return withPublicEdgeCache(c, async ({ cacheControl }) => {
    try {
      const payload = await loadPayload()
      c.header('Cache-Control', cacheControl)
      return { response: c.json(payload) }
    } catch {
      c.header('Cache-Control', 'no-store')
      return { cacheable: false, response: c.json(fallbackPayload()) }
    }
  })
}
