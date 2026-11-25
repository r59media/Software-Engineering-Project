/**
 * Reusable D1-backed sliding-window rate limiter with bounded in-memory fallback for isolated unit tests.
 */
import type { Context } from 'hono'
import { getTrustedClientIp, normalizeIpBucket } from './auth.ts'

const MAX_IN_MEMORY_BUCKETS = 1000
const inMemoryBuckets = new Map<string, { count: number; windowStart: number }>()

const CREATE_RATE_LIMITS_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS Rate_Limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)'

export interface MemoryBucketEntry {
  count: number
  windowStart: number
}

/**
 * Shared bounded in-memory sliding/fixed-window rate-limit check.
 */
export function checkInMemoryBucket(
  buckets: Map<string, MemoryBucketEntry>,
  bucketKey: string,
  maxRequests: number,
  windowMs: number,
  now: number,
  options?: { maxBuckets?: number; strictExpiry?: boolean }
): { allowed: boolean; retryAfterSeconds: number } {
  const maxBuckets = options?.maxBuckets ?? MAX_IN_MEMORY_BUCKETS
  const isExpired = (windowStart: number) =>
    options?.strictExpiry ? now - windowStart > windowMs : now - windowStart >= windowMs

  const existing = buckets.get(bucketKey)
  if (!existing || isExpired(existing.windowStart)) {
    if (!existing && buckets.size >= maxBuckets) {
      for (const [k, v] of buckets.entries()) {
        if (isExpired(v.windowStart)) buckets.delete(k)
      }
      if (buckets.size >= maxBuckets) {
        const oldestKey = buckets.keys().next().value
        if (oldestKey !== undefined) buckets.delete(oldestKey)
      }
    }
    buckets.set(bucketKey, { count: 1, windowStart: now })
    const allowed = 1 <= maxRequests
    return { allowed, retryAfterSeconds: allowed ? 0 : Math.ceil(windowMs / 1000) }
  }

  existing.count += 1
  if (existing.count > maxRequests) {
    const remainingMs = Math.max(1000, windowMs - (now - existing.windowStart))
    return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/**
 * Creates an isolated bounded in-memory rate limiter (used for synchronous route checks & tests).
 */
export function createMemoryRateLimiter(options: {
  maxRequests: number
  windowMs: number
  maxBuckets?: number
}) {
  const buckets = new Map<string, MemoryBucketEntry>()
  return {
    check(key: string, now: number = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
      return checkInMemoryBucket(buckets, key, options.maxRequests, options.windowMs, now, {
        maxBuckets: options.maxBuckets ?? MAX_IN_MEMORY_BUCKETS,
        strictExpiry: true
      })
    },
    reset(): void {
      buckets.clear()
    }
  }
}

/**
 * Shared atomic D1 rate-limit counter upsert for both Rate_Limits and Login_Attempts tables.
 */
export async function upsertD1RateLimitBucket(
  db: D1Database,
  table: 'Rate_Limits' | 'Login_Attempts',
  countColumn: 'count' | 'attempts',
  bucketKey: string,
  maxRequests: number,
  windowMs: number,
  now: number,
  strictExpiry = false
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const cmp = strictExpiry ? '>' : '>='
  const row = await db
    .prepare(
      `INSERT INTO ${table} (bucket, ${countColumn}, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET
         ${countColumn} = CASE WHEN ?2 - window_start ${cmp} ?3 THEN 1 ELSE ${countColumn} + 1 END,
         window_start = CASE WHEN ?2 - window_start ${cmp} ?3 THEN ?2 ELSE window_start END
       RETURNING ${countColumn} AS current_count, window_start`
    )
    .bind(bucketKey, now, windowMs)
    .first<{ current_count: number; window_start: number }>()

  if (row && row.current_count > maxRequests) {
    const remainingMs = Math.max(1000, windowMs - (now - row.window_start))
    return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/**
 * Checks and increments a rate limit counter in D1 Rate_Limits, falling back safely to isolate memory if D1 is absent or unavailable.
 */
export async function checkD1RateLimit(
  db: D1Database | undefined,
  bucketKey: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = Date.now()
  const windowMs = Math.max(1000, Math.floor(windowSeconds * 1000))

  if (!db) {
    return checkInMemoryBucket(inMemoryBuckets, bucketKey, maxRequests, windowMs, now)
  }

  try {
    return await upsertD1RateLimitBucket(db, 'Rate_Limits', 'count', bucketKey, maxRequests, windowMs, now)
  } catch (firstErr) {
    try {
      await db.prepare(CREATE_RATE_LIMITS_TABLE_SQL).run()
      return await upsertD1RateLimitBucket(db, 'Rate_Limits', 'count', bucketKey, maxRequests, windowMs, now)
    } catch (err) {
      console.warn('[rate-limit] D1 rate limiter error (using isolate memory fallback):', err || firstErr)
      return checkInMemoryBucket(inMemoryBuckets, bucketKey, maxRequests, windowMs, now)
    }
  }
}

/**
 * Shared route-level D1 rate-limit enforcement returning a 429 JSON response with Retry-After when exceeded.
 */
export async function enforceRouteRateLimit(
  c: Context<{ Bindings: any }>,
  options: {
    prefix: string
    maxRequests: number
    windowSeconds: number
    message: string
    includeDetails?: boolean
  }
): Promise<Response | null> {
  const clientIp = getTrustedClientIp(c)
  const rate = await checkD1RateLimit(
    c.env?.DB,
    `${options.prefix}:${normalizeIpBucket(clientIp)}`,
    options.maxRequests,
    options.windowSeconds
  )
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSeconds))
    return c.json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: options.message,
        ...(options.includeDetails !== false ? { details: [] } : {})
      }
    }, 429)
  }
  return null
}

/**
 * Clears a rate limit bucket in both isolate memory and D1.
 */
export async function clearD1RateLimit(db: D1Database | undefined, bucketKey: string): Promise<void> {
  inMemoryBuckets.delete(bucketKey)
  if (!db) return
  try {
    await db.prepare('DELETE FROM Rate_Limits WHERE bucket = ?').bind(bucketKey).run()
  } catch {}
}
