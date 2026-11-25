/**
 * Signed Media URL utility for HMAC-SHA256 short-lived token generation and verification.
 */

import { timingSafeEqual, hmacSha256Hex } from './crypto.ts'
import { isRealCalendarDate } from './validation.ts'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export type MediaVariantWidth = 640 | 1280

/**
 * Parses an optional media variant width (640 or 1280); returns undefined for any other value.
 */
export function parseMediaVariantWidth(raw: unknown): MediaVariantWidth | undefined {
  if (raw === 640 || raw === '640') return 640
  if (raw === 1280 || raw === '1280') return 1280
  return undefined
}

function buildMediaSignatureMessage(fileKey: string, exp: number, width?: MediaVariantWidth): string {
  return width ? `${fileKey}:${exp}:w${width}` : `${fileKey}:${exp}`
}

/**
 * Generates an HMAC-SHA256 signature and expiration timestamp for a media file key.
 */
export async function signMediaKey(
  fileKey: string,
  secret: string,
  ttlSeconds: number = 30,
  width?: MediaVariantWidth
): Promise<{ exp: number; sig: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const data = encoder.encode(buildMediaSignatureMessage(fileKey, exp, width))
  const signatureBytes = await crypto.subtle.sign('HMAC', key, data)
  const sig = toBase64Url(new Uint8Array(signatureBytes))
  return { exp, sig }
}

/**
 * Verifies an HMAC-SHA256 signature for a media file key and expiration timestamp.
 */
export async function verifyMediaSignature(
  fileKey: string,
  exp: number,
  sig: string,
  secret: string,
  width?: MediaVariantWidth
): Promise<boolean> {
  try {
    if (!fileKey || !sig || !secret || typeof exp !== 'number' || isNaN(exp)) {
      return false
    }

    const now = Math.floor(Date.now() / 1000)
    if (now > exp) {
      return false
    }

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const data = encoder.encode(buildMediaSignatureMessage(fileKey, exp, width))
    const signatureBytes = await crypto.subtle.sign('HMAC', key, data)
    const expectedSig = toBase64Url(new Uint8Array(signatureBytes))

    return timingSafeEqual(sig, expectedSig)
  } catch {
    return false
  }
}

export interface ByteRange {
  start: number
  end: number
}

/**
 * Parses HTTP Range header according to RFC 7233 / 9110.
 * Returns range offsets, null if header is missing/invalid, or 'unsatisfiable'.
 */
export function parseRangeHeader(
  rangeHeader: string | undefined | null,
  totalLength: number
): ByteRange | null | 'unsatisfiable' {
  if (!rangeHeader || typeof rangeHeader !== 'string' || totalLength <= 0) {
    return null
  }

  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null

  const [, startStr, endStr] = match
  if (!startStr && !endStr) return null

  let start: number
  let end: number

  if (!startStr) {
    // Suffix range: bytes=-500 (last 500 bytes)
    const suffix = parseInt(endStr, 10)
    if (isNaN(suffix) || suffix <= 0) return null
    start = Math.max(0, totalLength - suffix)
    end = totalLength - 1
  } else if (!endStr) {
    // Prefix range: bytes=500- (from 500 to end)
    start = parseInt(startStr, 10)
    if (isNaN(start) || start < 0) return null
    end = totalLength - 1
  } else {
    start = parseInt(startStr, 10)
    end = parseInt(endStr, 10)
    if (isNaN(start) || isNaN(end) || start < 0) return null
  }

  if (start >= totalLength || start > end) {
    return 'unsatisfiable'
  }

  end = Math.min(end, totalLength - 1)
  return { start, end }
}

const RESCHEDULE_TOKEN_PREFIX = 'r59-booking-reschedule-v1'
const CALENDAR_FEED_TOKEN_PREFIX = 'r59-calendar-feed-v1'
const DEFAULT_RESCHEDULE_TTL_DAYS = 30

function resolveRescheduleExpirySeconds(options?: {
  eventDate?: string | null
  expSeconds?: number
  ttlDays?: number
}): number {
  if (typeof options?.expSeconds === 'number' && Number.isFinite(options.expSeconds)) {
    return Math.floor(options.expSeconds)
  }
  if (options?.eventDate && isRealCalendarDate(options.eventDate)) {
    const [y, m, d] = options.eventDate.split('-').map(Number)
    const eventEndSec = Math.floor(Date.UTC(y, m - 1, d, 23, 59, 59) / 1000)
    return eventEndSec + (options?.ttlDays ?? DEFAULT_RESCHEDULE_TTL_DAYS) * 86400
  }
  return Math.floor(Date.now() / 1000) + (options?.ttlDays ?? DEFAULT_RESCHEDULE_TTL_DAYS) * 86400
}

export async function signRescheduleToken(
  bookingId: number | string,
  clientEmail: string,
  secret: string,
  options?: { eventDate?: string | null; expSeconds?: number; ttlDays?: number }
): Promise<string> {
  const exp = resolveRescheduleExpirySeconds(options)
  const payload = `${RESCHEDULE_TOKEN_PREFIX}:${String(bookingId).trim()}:${clientEmail.trim().toLowerCase()}:${exp}`
  const sig = await hmacSha256Hex(payload, secret)
  return `${exp}.${sig}`
}

export async function verifyRescheduleToken(
  bookingId: number | string,
  clientEmail: string,
  token: string,
  secret: string
): Promise<boolean> {
  if (!token || !secret || !clientEmail) return false
  const trimmed = token.trim()
  const parts = trimmed.split('.')
  if (parts.length !== 2) return false
  const [expStr, sigHex] = parts
  if (!/^\d+$/.test(expStr) || !/^[0-9a-f]{64}$/i.test(sigHex)) return false

  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp <= 0) return false

  const payload = `${RESCHEDULE_TOKEN_PREFIX}:${String(bookingId).trim()}:${clientEmail.trim().toLowerCase()}:${exp}`
  const expectedSig = await hmacSha256Hex(payload, secret)
  if (!timingSafeEqual(expectedSig, sigHex.toLowerCase())) return false

  const nowSeconds = Math.floor(Date.now() / 1000)
  return nowSeconds <= exp
}

export async function signCalendarFeedToken(secret: string, version: string = '1'): Promise<string> {
  const cleanVersion = (version || '1').trim() || '1'
  const sig = await hmacSha256Hex(`${CALENDAR_FEED_TOKEN_PREFIX}:v${cleanVersion}`, secret)
  return `v${cleanVersion}.${sig}`
}

export async function verifyCalendarFeedToken(
  token: string,
  secret: string,
  expectedVersion: string = '1'
): Promise<boolean> {
  if (!token || !secret) return false
  const trimmed = token.trim()
  const dotIdx = trimmed.indexOf('.')
  if (dotIdx <= 1) return false
  const tokenVersionPart = trimmed.slice(0, dotIdx)
  const cleanVersion = (expectedVersion || '1').trim() || '1'
  if (!timingSafeEqual(tokenVersionPart, `v${cleanVersion}`)) return false

  const expected = await signCalendarFeedToken(secret, cleanVersion)
  return timingSafeEqual(expected, trimmed)
}

/**
 * Reads the revocable calendar feed version from Admin_Settings ('calendar_feed_version', default '1').
 */
export async function getCalendarFeedVersion(db: D1Database | undefined): Promise<string> {
  if (!db) return '1'
  const row = await db
    .prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'calendar_feed_version'")
    .first<{ setting_value: string }>()
  const val = row?.setting_value ? String(row.setting_value).trim() : ''
  return val || '1'
}

/**
 * Atomically bumps calendar_feed_version in Admin_Settings so prior calendar feed URLs are immediately revoked.
 */
export async function rotateCalendarFeedVersion(db: D1Database): Promise<string> {
  await db
    .prepare('CREATE TABLE IF NOT EXISTS Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)')
    .run()

  const row = await db
    .prepare(
      `INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('calendar_feed_version', '2')
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_value = CAST(COALESCE(CAST(NULLIF(TRIM(setting_value), '') AS INTEGER), 1) + 1 AS TEXT)
       RETURNING setting_value`
    )
    .first<{ setting_value: string }>()

  return row?.setting_value ? String(row.setting_value).trim() : '2'
}
