export const PUBLIC_CACHE_VERSION_KEY = 'public_cache_version'
export const PUBLIC_READ_CACHE_CONTROL = 'public, max-age=30, s-maxage=300, stale-while-revalidate=600'
export const MEDIA_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600'

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
