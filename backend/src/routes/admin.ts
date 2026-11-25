import { Hono, type Context } from 'hono'
import type { Bindings } from '../index'
import {
  adminAuth,
  createSessionToken,
  extractSessionToken,
  getSigningSecret,
  getMediaSigningSecret,
  consumeOneTimeTokenDigest,
  verifySessionToken,
  revokeSessionToken,
  revokeTokenInDb,
  verifyGoogleIdToken,
  getTrustedClientIp,
  hasForbiddenPaymentFields,
  normalizeIpBucket,
  checkAndRecordLoginAttempt,
  clearLoginAttempts
} from '../middleware/auth'
import {
  DEFAULT_PROFILE,
  deletePortfolioRecord,
  ensurePortfolioDefaults,
  getStudioProfile,
  listPortfolio,
  portfolioListQuery,
  updatePortfolioRecord
} from './portfolio'
import { bumpPublicContentVersion } from '../lib/edgeCache'
import {
  parseTimeToMinutes,
  releaseBookingSlots,
  resolveBookingSlotIds,
  syncRollingScheduleSlots
} from '../lib/scheduleSync'
import { isEmailConfigured, sendEmail } from '../email'
import {
  addDaysISO,
  bookingTotalCents,
  computeTotals,
  DEFAULT_BOOKING_POLICY,
  DESCRIPTION_MAX,
  normalizeBookingPolicy,
  normalizeDepositPercent,
  normalizeFeeRules,
  parseMoneyToCents,
  parseNonNegativeMoneyToCents
} from '../lib/billingMath'
import {
  deleteOrDeactivateService,
  parseServicePayload,
  saveServiceRecord
} from './services'
import {
  BillingError,
  cancelOpenInvoice,
  getStudioTimeZone,
  loadBookingTotals,
  OPEN_INVOICE_EXISTS_SQL,
  PAYMENTS_SELECT_SQL,
  refreshBilling,
  sendBalanceInvoice,
  sendTerminalCheckout,
  studioTodayISO,
  toChargeJSON,
  toPayment
} from '../lib/squareBilling'
import { signCalendarFeedToken } from './reschedule'
import { hmacSha256Hex, timingSafeEqual } from '../utils/crypto'
import { isValidId, isRealCalendarDate, parseJsonObject } from '../utils/validation'
import { handleValidatedMediaPut } from '../utils/mediaUpload'
import { getCalendarFeedVersion, rotateCalendarFeedVersion, signMediaKey, parseMediaVariantWidth } from '../utils/signedUrl'
import { mapRowToCalendarBooking, syncBookingToGoogleCalendarApi } from '../lib/googleCalendar'
import {
  BOOKING_PAYMENTS_TABLE_SQL,
  BOOKING_PAYMENTS_INDEX_SQL,
  BILLING_SCHEMA_STEPS,
  ensurePhotoPermissionsColumns,
  replaceMediaStorageChunks,
  runOncePerDb
} from '../lib/billingSchema'
import {
  ADMIN_CALENDAR_BOOKING_SELECT,
  billingErrorResponse,
  BOOKING_NOT_FOUND_RESPONSE,
  bookingStatusFor,
  cancelAdminBookingWithRefund,
  createAdminManualBooking,
  INVOICE_OPEN_RESPONSE,
  scheduleGoogleCalendarSync,
  updateAdminBooking
} from '../lib/adminBookings'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidIanaTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== 'string' || !tz.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() })
    return true
  } catch {
    return false
  }
}

async function parseOptionalJsonObject(
  c: Context
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; response: Response }> {
  const rawText = await c.req.text()
  if (!rawText.trim()) {
    return { ok: true, data: {} }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return {
      ok: false,
      response: c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON request body.', details: [] } }, 400)
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      response: c.json({ error: { code: 'VALIDATION_FAILED', message: 'Request body must be a JSON object.', details: [] } }, 400)
    }
  }
  return { ok: true, data: parsed as Record<string, unknown> }
}

export const adminRouter = new Hono<{ Bindings: Bindings }>()
export { DEFAULT_PROFILE, ensurePhotoPermissionsColumns, replaceMediaStorageChunks }

// ── Live D1 Schema Auto-Migration (OPT-02: once per db/isolate) ─────
const schemaReadyByDb = new WeakMap<object, Promise<void>>()

async function runAdminSchemaMigration(targetDb: D1Database): Promise<boolean> {
  let allSucceeded = true
  try {
    await targetDb.prepare(BOOKING_PAYMENTS_TABLE_SQL).run()
    await targetDb.prepare(BOOKING_PAYMENTS_INDEX_SQL).run()
    for (const step of BILLING_SCHEMA_STEPS) {
      try {
        await targetDb.prepare(step.sql).run()
      } catch (err) {
        if (!step.ignoreError) {
          allSucceeded = false
          console.warn('Schema step failed (non-fatal):', err)
        }
      }
    }
    if (!(await ensurePhotoPermissionsColumns(targetDb))) {
      allSucceeded = false
    }
  } catch (err) {
    allSucceeded = false
    console.warn('ensureSchemaReady failed:', err)
  }
  return allSucceeded
}

export async function ensureSchemaReady(db?: D1Database): Promise<void> {
  return runOncePerDb(schemaReadyByDb, db, runAdminSchemaMigration)
}

const BOOKINGS_ACTIVE_SLOT_INDEX_SQL =
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot ON Bookings(slot_id) WHERE status != 'cancelled'"

// The exact Bookings columns the rebuild copies. IMPORTANT: any future Bookings column must be added
// here AND to the CREATE/INSERT...SELECT below, otherwise the rebuild is skipped (unknown column).
const BOOKINGS_REBUILD_COLUMNS = [
  'id', 'service_id', 'slot_id', 'client_name', 'client_email', 'price_at_booking',
  'square_payment_id', 'status', 'customer_phone', 'location', 'notes', 'attendees',
  'deposit_paid', 'coupon_code', 'custom_price', 'deposit_percent', 'created_at',
  'photo_permission_portfolio', 'photo_permission_social', 'photo_permission_accepted_at', 'photo_permission_version',
  'event_location', 'agreement_signed_name', 'agreement_signed_at', 'applied_fees_json',
  'checkout_idempotency_key', 'locked_slot_ids_json', 'gcal_sync_status', 'reschedule_count'
]

const BOOKINGS_SLOT_UNIQUE_RE = /slot_id\s+INTEGER\s+NOT\s+NULL\s+UNIQUE/i
const BOOKINGS_SERVICE_NOT_NULL_RE = /service_id\s+INTEGER\s+NOT\s+NULL/i

async function readBookingsTableSql(db: D1Database): Promise<string> {
  const row = await db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'Bookings'"
  ).first<{ sql: string }>()
  return row?.sql || ''
}

/** True once Bookings.service_id accepts NULL ("No package" bookings). */
export async function bookingsServiceIdNullable(db: D1Database): Promise<boolean> {
  const sql = await readBookingsTableSql(db)
  return Boolean(sql) && !BOOKINGS_SERVICE_NOT_NULL_RE.test(sql)
}

async function rebuildBookingsTableIfNeeded(db: D1Database): Promise<void> {
  const tableSql = await readBookingsTableSql(db)
  if (!tableSql) return
  if (!BOOKINGS_SLOT_UNIQUE_RE.test(tableSql) && !BOOKINGS_SERVICE_NOT_NULL_RE.test(tableSql)) return

  // Pre-check 1: the table must have exactly the columns the rebuild knows how to copy
  const info = await db.prepare('PRAGMA table_info(Bookings)').all<{ name: string }>()
  const actual = (info.results || []).map(col => String(col.name))
  const unknown = actual.filter(name => !BOOKINGS_REBUILD_COLUMNS.includes(name))
  const missing = BOOKINGS_REBUILD_COLUMNS.filter(name => !actual.includes(name))
  if (unknown.length > 0 || missing.length > 0) {
    console.warn('Skipping Bookings rebuild: column list differs from the rebuild list.', { unknown, missing })
    return
  }

  // Pre-check 2: an orphaned slot_id can't be nulled (slot_id is NOT NULL), so skip and log.
  // Orphaned service_id values are copied as NULL by the INSERT...SELECT below.
  const fkRows = await db.prepare('PRAGMA foreign_key_check(Bookings)').all<{ parent: string; rowid: number }>()
  const orphanedSlots = (fkRows.results || []).filter(row => String(row.parent) === 'Schedule_Slots')
  if (orphanedSlots.length > 0) {
    console.warn('Skipping Bookings rebuild: bookings point at missing schedule slots.', {
      bookingRowIds: orphanedSlots.map(row => row.rowid)
    })
    return
  }

  await db.batch([
    db.prepare('PRAGMA defer_foreign_keys = true'),
    db.prepare('DROP TABLE IF EXISTS Bookings_new'),
    db.prepare(`CREATE TABLE Bookings_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      slot_id INTEGER NOT NULL,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      price_at_booking INTEGER NOT NULL,
      square_payment_id TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      customer_phone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      attendees INTEGER DEFAULT 1,
      deposit_paid INTEGER DEFAULT 0,
      coupon_code TEXT DEFAULT '',
      custom_price INTEGER,
      deposit_percent INTEGER,
      photo_permission_portfolio BOOLEAN DEFAULT 0,
      photo_permission_social BOOLEAN DEFAULT 0,
      photo_permission_accepted_at TEXT,
      photo_permission_version TEXT DEFAULT 'v1',
      event_location TEXT,
      agreement_signed_name TEXT,
      agreement_signed_at TEXT,
      applied_fees_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (service_id) REFERENCES Services(id),
      FOREIGN KEY (slot_id) REFERENCES Schedule_Slots(id)
    )`),
    db.prepare(`INSERT INTO Bookings_new (
      id, service_id, slot_id, client_name, client_email, price_at_booking,
      square_payment_id, status, customer_phone, location, notes, attendees,
      deposit_paid, coupon_code, custom_price, deposit_percent,
      photo_permission_portfolio, photo_permission_social, photo_permission_accepted_at, photo_permission_version,
      event_location, agreement_signed_name, agreement_signed_at, applied_fees_json,
      created_at
    ) SELECT
      id,
      CASE WHEN EXISTS (SELECT 1 FROM Services WHERE id = Bookings.service_id) THEN service_id END,
      slot_id, client_name, client_email, price_at_booking,
      square_payment_id, status, COALESCE(customer_phone, ''), COALESCE(location, ''),
      COALESCE(notes, ''), COALESCE(attendees, 1), COALESCE(deposit_paid, 0),
      COALESCE(coupon_code, ''), custom_price, deposit_percent,
      COALESCE(photo_permission_portfolio, 0), COALESCE(photo_permission_social, 0),
      photo_permission_accepted_at, COALESCE(photo_permission_version, 'v1'),
      event_location, agreement_signed_name, agreement_signed_at, applied_fees_json,
      created_at
    FROM Bookings`),
    db.prepare('DROP TABLE Bookings'),
    db.prepare('ALTER TABLE Bookings_new RENAME TO Bookings'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_bookings_slot ON Bookings(slot_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_bookings_service ON Bookings(service_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_bookings_created ON Bookings(created_at DESC)')
  ])
}

// Re-export rate limiting helpers from middleware/auth
export { normalizeIpBucket, checkAndRecordLoginAttempt, clearLoginAttempts }

function noStore(c: Context): void {
  c.header('Cache-Control', 'no-store')
  c.header('Pragma', 'no-cache')
}

// ── Admin Google Sign-In Authentication ──────────────────────────

const OAUTH_NONCE_COOKIE_NAME = 'r59_oauth_nonce'
const OAUTH_NONCE_TTL_SECONDS = 300
const OAUTH_NONCE_PREFIX = 'r59-oauth-nonce-v1'

function isHttpsRequest(c: Context): boolean {
  try {
    if (new URL(c.req.url).protocol === 'https:') return true
  } catch {}
  return (c.req.header('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase() === 'https'
}

function buildOAuthNonceSetCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${OAUTH_NONCE_COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/api/admin; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`
}

function extractCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    const k = part.slice(0, eqIdx).trim()
    if (k === name) {
      return part.slice(eqIdx + 1).trim()
    }
  }
  return null
}

function generateRandomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let bin = ''
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i])
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signOAuthNonceCookieValue(nonce: string, expMs: number, secret: string): Promise<string> {
  const sig = await hmacSha256Hex(`${OAUTH_NONCE_PREFIX}:${nonce}:${expMs}`, secret)
  return `${nonce}.${expMs}.${sig}`
}

async function verifyOAuthNonceCookie(
  cookieHeader: string | undefined,
  submittedNonce: string,
  secret: string
): Promise<boolean> {
  const raw = extractCookieValue(cookieHeader, OAUTH_NONCE_COOKIE_NAME)
  if (!raw || !submittedNonce || !secret) return false

  const parts = raw.split('.')
  if (parts.length !== 3) return false
  const [cookieNonce, expStr, providedSig] = parts
  if (!cookieNonce || !/^\d+$/.test(expStr) || !/^[0-9a-f]{64}$/i.test(providedSig)) {
    return false
  }

  const expMs = Number(expStr)
  if (!Number.isFinite(expMs) || Date.now() > expMs) {
    return false
  }

  const expectedSig = await hmacSha256Hex(`${OAUTH_NONCE_PREFIX}:${cookieNonce}:${expMs}`, secret)
  if (!timingSafeEqual(expectedSig, providedSig.toLowerCase())) {
    return false
  }

  return timingSafeEqual(cookieNonce, submittedNonce)
}

// GET: Public authentication configuration for Google Sign-In
adminRouter.get('/auth-config', (c) => {
  noStore(c)
  return c.json({ googleClientId: c.env.GOOGLE_CLIENT_ID || '' })
})

// GET: Issue server-bound cryptographic nonce for Google Sign-In
adminRouter.get('/auth/nonce', async (c) => {
  noStore(c)
  const sessionSecret = getSigningSecret(c.env) || c.env.SESSION_SECRET
  if (!sessionSecret || sessionSecret.length < 32) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Server authentication is not configured.',
        details: []
      }
    }, 500)
  }

  const nonce = generateRandomNonce()
  const expMs = Date.now() + OAUTH_NONCE_TTL_SECONDS * 1000
  const cookieVal = await signOAuthNonceCookieValue(nonce, expMs, sessionSecret)
  c.header('Set-Cookie', buildOAuthNonceSetCookie(cookieVal, OAUTH_NONCE_TTL_SECONDS, isHttpsRequest(c)))
  return c.json({ nonce })
})

// POST: Google Sign-In authentication via Google ID token
adminRouter.post('/google-login', async (c) => {
  noStore(c)
  try {
    const sessionSecret = getSigningSecret(c.env) || c.env.SESSION_SECRET
    if (!sessionSecret || sessionSecret.length < 32) {
      return c.json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Server authentication is not configured.',
          details: []
        }
      }, 500)
    }

    const clientIp = getTrustedClientIp(c)
    const rateLimit = await checkAndRecordLoginAttempt(c.env.DB, clientIp)
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds))
      return c.json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many login attempts. Please wait 1 minute before trying again.',
          details: []
        }
      }, 429)
    }

    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data
    const idToken = typeof body?.idToken === 'string' ? body.idToken.trim() : ''
    const nonce = typeof body?.nonce === 'string' ? body.nonce.trim() : ''

    if (!idToken) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Missing Google ID token.',
          details: [{ field: 'idToken', message: 'idToken is required', code: 'REQUIRED_FIELD' }]
        }
      }, 400)
    }

    if (!nonce) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Missing nonce.',
          details: [{ field: 'nonce', message: 'nonce is required', code: 'REQUIRED_FIELD' }]
        }
      }, 400)
    }

    const nonceCookieValid = await verifyOAuthNonceCookie(c.req.header('Cookie'), nonce, sessionSecret)
    if (!nonceCookieValid) {
      c.header('Set-Cookie', buildOAuthNonceSetCookie('', 0, isHttpsRequest(c)))
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const authorizedEmail = (c.env.ADMIN_EMAIL || '').trim().toLowerCase()
    if (!authorizedEmail) {
      console.error('[auth] Server misconfigured: ADMIN_EMAIL is unset or empty')
      return c.json({ error: 'Server misconfigured' }, 500)
    }

    const verified = await verifyGoogleIdToken(idToken, c.env.GOOGLE_CLIENT_ID, authorizedEmail, { expectedNonce: nonce })
    if (!verified.success) {
      console.warn('[auth] Google login verification failed:', verified.error)
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const isFirstUse = await consumeOneTimeTokenDigest(c.env.DB, idToken, verified.exp)
    if (!isFirstUse) {
      console.warn('[auth] Google ID token replay rejected')
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Clear nonce cookie after successful verification so it cannot be reused
    c.header('Set-Cookie', buildOAuthNonceSetCookie('', 0, isHttpsRequest(c)))

    // Clear failed login attempts on success
    await clearLoginAttempts(c.env.DB, clientIp)

    // Opportunistically prune expired revoked sessions
    if (c.env.DB) {
      c.env.DB.prepare('DELETE FROM Revoked_Sessions WHERE expires_at <= ?').bind(Date.now()).run().catch(() => {})
    }

    // Generate secure session token (secret: string, email: string)
    const token = await createSessionToken(sessionSecret, verified.email)

    return c.json({ ok: true, email: verified.email, token })
  } catch (e: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Google login error.',
        details: []
      }
    }, 500)
  }
})

// ── Deprecated Password Endpoints (Replaced by Google Sign-In) ───

adminRouter.get('/password-reset/available', (c) => {
  noStore(c)
  return c.json({ available: false, deprecated: true }, 410)
})

adminRouter.post('/forgot-password', (c) => {
  noStore(c)
  return c.json({
    error: {
      code: 'DEPRECATED',
      message: 'Password reset is deprecated. Please use Google Sign-In.',
      details: []
    }
  }, 410)
})

adminRouter.post('/reset-password', (c) => {
  noStore(c)
  return c.json({
    error: {
      code: 'DEPRECATED',
      message: 'Password reset is deprecated. Please use Google Sign-In.',
      details: []
    }
  }, 410)
})

adminRouter.post('/login', (c) => {
  return c.json({
    error: {
      code: 'DEPRECATED',
      message: 'Password login is deprecated. Please use Google Sign-In.',
      details: []
    }
  }, 410)
})

// Public logout endpoint
adminRouter.post('/logout', async (c) => {
  const { token } = extractSessionToken(c)
  const signingSecret = getSigningSecret(c.env)
  if (token && signingSecret) {
    const verified = await verifySessionToken(token, signingSecret)
    if (verified.valid) {
      revokeSessionToken(token)
      await revokeTokenInDb(c.env.DB, token)
    }
  }
  return c.json({
    success: true,
    status: 'success',
    message: 'Logged out',
    data: { message: 'Logged out' }
  })
})

// All subsequent admin routes require valid admin authentication
adminRouter.use('*', adminAuth)

// Ensure D1 schema migrations have run once per isolate
adminRouter.use('*', async (c, next) => {
  await ensureSchemaReady(c.env.DB)
  return await next()
})

// Session verification endpoint for frontend startup and route guards
adminRouter.get('/verify', async (c) => {
  const expectedEmail = (c.env.ADMIN_EMAIL || '').trim().toLowerCase()
  return c.json({
    authenticated: true,
    status: 'success',
    email: expectedEmail,
    data: {
      authenticated: true,
      email: expectedEmail
    }
  })
})

// POST /api/admin/media-token — Generates short-lived HMAC signed media URL for streaming (30s TTL)
adminRouter.post('/media-token', async (c) => {
  try {
    const body = await c.req.json().catch(() => null)
    const fileKey = typeof body?.file_key === 'string' ? body.file_key.trim() : ''
    if (!fileKey || fileKey.includes('..')) {
      return c.json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid or missing file_key',
          details: []
        }
      }, 400)
    }

    const secret = await getMediaSigningSecret(c.env)
    if (!secret) {
      return c.json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Media signing secret is not configured.',
          details: []
        }
      }, 500)
    }
    const width = parseMediaVariantWidth(body?.w)
    const { exp, sig } = await signMediaKey(fileKey, secret, 30, width)

    return c.json({
      url: `/api/media/${fileKey}?exp=${exp}&sig=${sig}${width ? `&w=${width}` : ''}`
    }, 200)
  } catch (err: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to generate signed media token',
        details: []
      }
    }, 500)
  }
})

// PUT: Deprecated password update endpoint (Replaced by Google Sign-In)
adminRouter.put('/password', (c) => {
  return c.json({
    error: {
      code: 'DEPRECATED',
      message: 'Password management is deprecated. Please use Google Sign-In.',
      details: []
    }
  }, 410)
})

// GET: account settings shown in the Settings dialog
adminRouter.get('/account', async (c) => {
  noStore(c)
  try {
    return c.json({ recovery_email: '', email_configured: isEmailConfigured(c.env) })
  } catch {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not load account settings.', details: [] } }, 500)
  }
})

// PUT: Deprecated recovery email endpoint (Replaced by Google Sign-In)
adminRouter.put('/recovery-email', (c) => {
  noStore(c)
  return c.json({
    error: {
      code: 'DEPRECATED',
      message: 'Password recovery email is deprecated. Please use Google Sign-In.',
      details: []
    }
  }, 410)
})

// ── Schedule Management ──────────────────────────────────────────

// GET: View all schedule slots (admin calendar)
adminRouter.get('/schedule', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots ORDER BY date ASC, start_time ASC'
    ).all()

    return c.json({ slots: results, status: 'success', data: results })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch schedule slots.', details: [] } }, 500)
  }
})

// POST: Add a new available timeslot OR save schedule settings in batch
adminRouter.post('/schedule', async (c) => {
  try {
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data

    // Case 1: Schedule settings batch update (slotDurationMinutes, bufferMinutes, timezone, weeklySchedule)
    if (
      body.slotDurationMinutes !== undefined ||
      body.bufferMinutes !== undefined ||
      body.timezone !== undefined ||
      body.weeklySchedule !== undefined
    ) {
      if (body.slotDurationMinutes !== undefined) {
        const dur = Number(body.slotDurationMinutes)
        if (!Number.isFinite(dur) || dur < 15 || dur > 480) {
          return c.json({
            error: {
              code: 'VALIDATION_FAILED',
              message: 'slotDurationMinutes must be between 15 and 480.',
              details: [{ field: 'slotDurationMinutes', message: 'Must be between 15 and 480 minutes.', code: 'OUT_OF_RANGE' }]
            }
          }, 400)
        }
      }

      if (body.timezone !== undefined) {
        if (typeof body.timezone !== 'string' || !isValidIanaTimeZone(body.timezone)) {
          return c.json({
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Valid IANA timezone is required (e.g., America/New_York).',
              details: [{ field: 'timezone', message: 'Invalid IANA timezone.', code: 'INVALID_VALUE' }]
            }
          }, 400)
        }
      }

      const statements: D1PreparedStatement[] = []
      const upsertSql =
        'INSERT INTO Admin_Settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value'

      if (body.slotDurationMinutes !== undefined) {
        statements.push(c.env.DB.prepare(upsertSql).bind('slot_duration_minutes', String(Math.round(Number(body.slotDurationMinutes)))))
      }
      if (body.bufferMinutes !== undefined) {
        const buf = Math.max(0, Math.min(240, Math.round(Number(body.bufferMinutes) || 0)))
        statements.push(c.env.DB.prepare(upsertSql).bind('buffer_minutes', String(buf)))
      }
      if (body.timezone !== undefined && typeof body.timezone === 'string') {
        statements.push(c.env.DB.prepare(upsertSql).bind('timezone', body.timezone.trim()))
      }
      if (body.weeklySchedule !== undefined) {
        statements.push(c.env.DB.prepare(upsertSql).bind('weekly_availability', JSON.stringify(body.weeklySchedule)))
      }

      if (statements.length > 0) {
        await c.env.DB.batch(statements)
        await syncRollingScheduleSlots(c.env.DB)
      }

      return c.json({ success: true, status: 'success', data: { updated: true } })
    }

    // Case 2: Individual timeslot creation
    const date = typeof body.date === 'string' ? body.date.trim() : ''
    const start_time = typeof (body.start_time ?? body.startTime) === 'string' ? String(body.start_time ?? body.startTime).trim() : ''
    const end_time = typeof (body.end_time ?? body.endTime) === 'string' ? String(body.end_time ?? body.endTime).trim() : ''

    const errors = []
    if (!isRealCalendarDate(date)) {
      errors.push({ field: 'date', message: 'Valid real calendar date is required (YYYY-MM-DD).', code: 'INVALID_FORMAT' })
    }
    const startMin = parseTimeToMinutes(start_time)
    const endMin = parseTimeToMinutes(end_time)
    if (startMin === null) {
      errors.push({ field: 'start_time', message: 'Valid start time is required (HH:MM).', code: 'INVALID_FORMAT' })
    }
    if (endMin === null) {
      errors.push({ field: 'end_time', message: 'Valid end time is required (HH:MM).', code: 'INVALID_FORMAT' })
    }
    if (startMin !== null && endMin !== null && endMin <= startMin) {
      errors.push({ field: 'end_time', message: 'End time must be after start time.', code: 'INVALID_RANGE' })
    }

    if (errors.length > 0) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not create slot.', details: errors } }, 400)
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO Schedule_Slots (date, start_time, end_time) VALUES (?, ?, ?)'
    ).bind(date, start_time, end_time).run()

    return c.json({
      success: true,
      status: 'success',
      id: result.meta.last_row_id,
      data: { id: result.meta.last_row_id, date, start_time, end_time }
    })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not create schedule slot.', details: [] } }, 500)
  }
})

// ── Shared Validated Delete Helper ───────────────────────────────
async function deleteEntityById(
  c: Context<{ Bindings: Bindings }>,
  options: {
    table: 'Schedule_Slots' | 'Blocked_Dates' | 'Coupons'
    notFoundMessage: string
    errorMessage: string
    extraWhereSql?: string
  }
): Promise<Response> {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const whereClause = options.extraWhereSql ? `id = ? AND ${options.extraWhereSql}` : 'id = ?'
    const result = await c.env.DB.prepare(`DELETE FROM ${options.table} WHERE ${whereClause}`).bind(id).run()
    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: options.notFoundMessage, details: [] } }, 404)
    }
    return c.json({ success: true, status: 'success' })
  } catch {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: options.errorMessage, details: [] } }, 500)
  }
}

// DELETE: Remove a timeslot (only if not booked)
adminRouter.delete('/schedule/:id', (c) =>
  deleteEntityById(c, {
    table: 'Schedule_Slots',
    extraWhereSql: 'is_booked = 0',
    notFoundMessage: 'Slot not found or already booked.',
    errorMessage: 'Could not delete slot.'
  })
)

// ── Availability Rules ──────────────────────────────────────────

// GET: Weekly recurring availability rules
adminRouter.get('/availability', async (c) => {
  try {
    const row = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'weekly_availability'"
    ).first<{ setting_value: string }>()

    const availability = row?.setting_value ? JSON.parse(row.setting_value) : []
    return c.json({ availability, status: 'success', data: availability })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch availability.', details: [] } }, 500)
  }
})

// PUT: Save weekly recurring availability rules
adminRouter.put('/availability', async (c) => {
  try {
    let body: any
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON request body.', details: [] } }, 400)
    }
    const rawAvailability = body && typeof body === 'object' && !Array.isArray(body) && body.availability !== undefined ? body.availability : body
    if (!Array.isArray(rawAvailability)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Availability must be an array.', details: [] } }, 400)
    }

    const ALLOWED_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const cleanAvailability: any[] = []
    for (const item of rawAvailability) {
      if (!item || typeof item !== 'object') {
        return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Each availability entry must be an object.', details: [] } }, 400)
      }
      const day = ALLOWED_DAYS.includes(item.day) ? item.day : 'Monday'
      const available = Boolean(item.available)
      const timeframes: any[] = []
      if (Array.isArray(item.timeframes)) {
        for (const tf of item.timeframes) {
          const start = String(tf?.start || '09:00').trim().slice(0, 5)
          const end = String(tf?.end || '17:00').trim().slice(0, 5)
          const startMin = parseTimeToMinutes(start)
          const endMin = parseTimeToMinutes(end)
          if (startMin === null || endMin === null || endMin <= startMin) {
            return c.json({
              error: {
                code: 'VALIDATION_FAILED',
                message: `Invalid timeframe for ${day}: end time must be after start time.`,
                details: []
              }
            }, 400)
          }
          timeframes.push({
            id: Number(tf?.id) || Date.now(),
            start,
            end,
            label: String(tf?.label || `${start} - ${end}`).slice(0, 50),
            repeat: tf?.repeat === 'none' ? 'none' : 'weekly'
          })
        }
      }
      cleanAvailability.push({ day, available, timeframes })
    }

    const val = JSON.stringify(cleanAvailability)
    await c.env.DB.prepare(
      "INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('weekly_availability', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value"
    ).bind(val).run()
    await syncRollingScheduleSlots(c.env.DB)

    return c.json({ success: true, status: 'success', availability: cleanAvailability, data: cleanAvailability })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not save availability.', details: [] } }, 500)
  }
})

// ── Blocked Dates ────────────────────────────────────────────────

// GET: List all blocked dates
adminRouter.get('/blocked-dates', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, date, reason FROM Blocked_Dates ORDER BY date ASC'
    ).all()

    const blockedDates = (results || []).map((r: any) => ({
      id: r.id,
      date: r.date,
      dateStr: r.date,
      reason: r.reason || ''
    }))

    return c.json({ blockedDates, status: 'success', data: blockedDates })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch blocked dates.', details: [] } }, 500)
  }
})

// POST: Add a blocked date (or inclusive vacation date range)
adminRouter.post('/blocked-dates', async (c) => {
  try {
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data
    const date = String(body.date || body.dateStr || '').trim()
    const endDate = String(body.endDate || body.end_date || '').trim()
    const reason = String(body.reason || '').trim()

    if (!isRealCalendarDate(date)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Valid date (YYYY-MM-DD) is required.',
          details: [{ field: 'date', message: 'Date must be a valid calendar date in YYYY-MM-DD format.', code: 'INVALID_FORMAT' }]
        }
      }, 400)
    }

    let dates: string[]
    if (endDate) {
      if (!isRealCalendarDate(endDate) || endDate < date) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Valid endDate (YYYY-MM-DD) on or after date is required.',
            details: [{ field: 'endDate', message: 'endDate must be YYYY-MM-DD and >= date.', code: 'INVALID_FORMAT' }]
          }
        }, 400)
      }

      const toUtcMs = (iso: string) => {
        const [y, m, d] = iso.split('-').map(Number)
        return Date.UTC(y, m - 1, d)
      }
      const spanDays = Math.round((toUtcMs(endDate) - toUtcMs(date)) / 86_400_000) + 1
      if (spanDays > 90) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Blocked date range cannot exceed 90 days.',
            details: [{ field: 'endDate', message: 'Blocked date range cannot exceed 90 days.', code: 'RANGE_TOO_LARGE' }]
          }
        }, 400)
      }

      dates = Array.from({ length: spanDays }, (_, i) => addDaysISO(date, i))
    } else {
      dates = [date]
    }

    const placeholders = dates.map(() => '?').join(', ')
    const existingRes = await c.env.DB.prepare(
      `SELECT id, date, reason FROM Blocked_Dates WHERE date IN (${placeholders})`
    ).bind(...dates).all<{ id: number; date: string; reason: string }>()

    const byDate = new Map<string, { id: number; date: string; reason: string }>()
    for (const row of existingRes.results || []) {
      byDate.set(row.date, row)
    }

    for (const d of dates) {
      if (!byDate.has(d)) {
        const result = await c.env.DB.prepare(
          'INSERT INTO Blocked_Dates (date, reason) VALUES (?, ?)'
        ).bind(d, reason).run()
        byDate.set(d, {
          id: Number(result.meta.last_row_id),
          date: d,
          reason
        })
      }
    }

    const items = dates
      .slice()
      .sort()
      .map((d) => {
        const row = byDate.get(d)!
        return {
          id: row.id,
          date: row.date,
          dateStr: row.date,
          reason: row.reason || ''
        }
      })

    const firstItem = items[0]
    return c.json({
      success: true,
      status: 'success',
      ...firstItem,
      blockedDates: items,
      count: items.length,
      data: firstItem
    })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not add blocked date.', details: [] } }, 500)
  }
})

// DELETE: Remove a blocked date
adminRouter.delete('/blocked-dates/:id', (c) =>
  deleteEntityById(c, {
    table: 'Blocked_Dates',
    notFoundMessage: 'Blocked date not found.',
    errorMessage: 'Could not delete blocked date.'
  })
)

// ── Bookings ─────────────────────────────────────────────────────

const NO_PACKAGE_LABEL = 'No package'
const PAYMENT_METHODS = ['Cash', 'Card', 'Square', 'Zelle', 'Venmo', 'Cash App', 'Other']
const MAX_PAYMENT_CENTS = 100_000_000
const PAYMENT_NOTE_MAX = 500
const INVALID_ID_RESPONSE = { error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }

const FORBIDDEN_PAYMENT_RESPONSE = {
  error: {
    code: 'VALIDATION_FAILED',
    message: 'Raw card or bank account numbers cannot be stored. Use Square tokenization.',
    details: []
  }
}

// GET: View all bookings
adminRouter.get('/bookings', async (c) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 100))
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)

    const { results } = await c.env.DB.prepare(
      `SELECT b.id, b.client_name, b.client_email, b.price_at_booking, b.square_payment_id, b.status, b.created_at,
              b.service_id, b.slot_id,
              b.customer_phone, COALESCE(NULLIF(b.event_location, ''), b.location) AS location, b.notes, b.attendees, b.deposit_paid, b.coupon_code, b.custom_price,
              b.deposit_percent, b.photo_permission_portfolio, b.photo_permission_social, b.photo_permission_accepted_at, b.photo_permission_version,
              s.name as service_name, s.price as service_price, sl.date, sl.start_time, sl.end_time,
              COALESCE(p.payments_total, 0) AS payments_total, COALESCE(p.payments_count, 0) AS payments_count,
              COALESCE(ch.charges_total, 0) AS charges_total
       FROM Bookings b
       LEFT JOIN Services s ON b.service_id = s.id
       LEFT JOIN Schedule_Slots sl ON b.slot_id = sl.id
       LEFT JOIN (
         SELECT booking_id, SUM(amount) AS payments_total, COUNT(*) AS payments_count
         FROM Booking_Payments
         GROUP BY booking_id
       ) p ON p.booking_id = b.id
       LEFT JOIN (
         SELECT booking_id, SUM(amount_cents) AS charges_total
         FROM Booking_Charges
         GROUP BY booking_id
       ) ch ON ch.booking_id = b.id
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all()

    const bookings = (results || []).map((b: any) => {
      const priceCents = bookingTotalCents(b)
      const chargesCents = Number(b.charges_total) || 0
      const depositCents = Number(b.deposit_paid) || 0
      const hasPackage = b.service_id !== null && b.service_id !== undefined && b.service_name !== null && b.service_name !== undefined
      const totalPriceDollars = priceCents ? priceCents / 100 : 0
      const depositDollars = depositCents ? depositCents / 100 : 0

      return {
        ...b,
        price_at_booking: priceCents,
        client: b.client_name,
        customer: b.client_name,
        email: b.client_email,
        phone: b.customer_phone || '',
        location: b.location || '',
        notes: b.notes || '',
        people: b.attendees ?? 1,
        attendees: b.attendees ?? 1,
        deposit: depositDollars,
        coupon: b.coupon_code || '',
        totalPrice: totalPriceDollars,
        price: totalPriceDollars,
        package: hasPackage ? b.service_name : NO_PACKAGE_LABEL,
        packageId: b.service_id ?? null,
        payments_total: Number(b.payments_total) || 0,
        payments_count: Number(b.payments_count) || 0,
        base_cents: priceCents,
        charges_cents: chargesCents,
        deposit_percent: b.deposit_percent ?? null,
        photo_permission_portfolio: b.photo_permission_portfolio ? 1 : 0,
        photo_permission_social: b.photo_permission_social ? 1 : 0,
        photo_permission_accepted_at: b.photo_permission_accepted_at ?? null,
        photo_permission_version: b.photo_permission_version || 'v1',
        total_cents: priceCents + chargesCents
      }
    })

    return c.json({ bookings, limit, offset, status: 'success', data: bookings })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch bookings.', details: [] } }, 500)
  }
})

// POST: Create a manual booking (admin)
adminRouter.post('/bookings', async (c) => {
  try {
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    if (hasForbiddenPaymentFields(parsedBody.data)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }
    return await createAdminManualBooking(c, c.env.DB, parsedBody.data)
  } catch {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not create booking.', details: [] } }, 500)
  }
})

// PUT & PATCH: Update an existing booking
async function updateBookingHandler(c: Context<{ Bindings: Bindings }>) {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    if (hasForbiddenPaymentFields(parsedBody.data)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }
    return await updateAdminBooking(c, c.env.DB, id, parsedBody.data)
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not update booking.')
  }
}

adminRouter.put('/bookings/:id', updateBookingHandler)
adminRouter.patch('/bookings/:id', updateBookingHandler)

// PATCH: Cancel a booking and release slot
adminRouter.patch('/bookings/:id/cancel', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }
    const parsedBody = await parseOptionalJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    return await cancelAdminBookingWithRefund(c, c.env.DB, id, parsedBody.data as { refund?: boolean; reason?: string })
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not cancel booking.')
  }
})

// DELETE: Delete a booking
adminRouter.delete('/bookings/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }

    const booking = await c.env.DB.prepare('SELECT slot_id, service_id FROM Bookings WHERE id = ?')
      .bind(id)
      .first<{ slot_id: number | null; service_id: number | null }>()
    if (!booking) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    // Withdraw any open invoice first; a BillingError leaves the booking unchanged
    await cancelOpenInvoice(c.env.DB, c.env, id)

    let releasableSlotIds: number[] = []
    if (booking.slot_id) {
      const { slotIds, protectedOtherSlotIds } = await resolveBookingSlotIds(c.env.DB, {
        bookingId: id,
        slotId: booking.slot_id,
        serviceId: booking.service_id
      })
      const protectedSet = new Set(protectedOtherSlotIds)
      releasableSlotIds = slotIds.filter((slotId) => !protectedSet.has(slotId))
    }

    // One batch (one transaction). Every statement carries the open-invoice guard, so a Send that claimed
    // the booking after the withdraw above makes the whole batch a no-op (no live Square invoice is ever
    // orphaned). The invoice rows go last, so the guard still sees them while the other rows are removed.
    const noOpenInvoice = `NOT ${OPEN_INVOICE_EXISTS_SQL}`
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(`DELETE FROM Booking_Payments WHERE booking_id = ? AND ${noOpenInvoice}`).bind(id, id),
      c.env.DB.prepare(`DELETE FROM Booking_Charges WHERE booking_id = ? AND ${noOpenInvoice}`).bind(id, id),
      c.env.DB.prepare(`DELETE FROM Bookings WHERE id = ? AND ${noOpenInvoice}`).bind(id, id)
    ]
    if (releasableSlotIds.length > 0) {
      const ph = releasableSlotIds.map(() => '?').join(', ')
      statements.push(c.env.DB.prepare(
        `UPDATE Schedule_Slots SET is_booked = 0 WHERE id IN (${ph}) AND id NOT IN (SELECT slot_id FROM Bookings WHERE LOWER(COALESCE(status, '')) != 'cancelled' AND slot_id IS NOT NULL AND id != ?) AND ${noOpenInvoice}`
      ).bind(...releasableSlotIds, id, id))
    }
    statements.push(c.env.DB.prepare(`DELETE FROM Booking_Invoices WHERE booking_id = ? AND ${noOpenInvoice}`).bind(id, id))
    const results = await c.env.DB.batch(statements)
    if (!results[2]?.meta?.changes) {
      return c.json(INVOICE_OPEN_RESPONSE, 409)
    }

    scheduleGoogleCalendarSync(c, id, 'delete')

    return c.json({ success: true, status: 'success' })
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not delete booking.')
  }
})

// ── Booking Payments (money owed after the down payment) ─────────
// Paths have three/four segments (/bookings/:id/payments[/:paymentId]), so they never collide with
// the two-segment /bookings/:id routes or /bookings/:id/cancel.

function paymentValidationError(field: string, message: string, code: string) {
  return {
    error: {
      code: 'VALIDATION_FAILED',
      message,
      details: [{ field, message, code }]
    }
  }
}

// GET: A booking's recorded payments plus its totals
adminRouter.get('/bookings/:id/payments', async (c) => {
  c.header('Cache-Control', 'no-store')
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }

    const loaded = await loadBookingTotals(c.env.DB, id)
    if (!loaded) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    const { results } = await c.env.DB.prepare(PAYMENTS_SELECT_SQL).bind(id).all<any>()
    const payments = (results || []).map(toPayment)

    return c.json({ status: 'success', payments, totals: loaded.totals, data: { payments, totals: loaded.totals } })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch payments.', details: [] } }, 500)
  }
})

// POST: Record a payment on a (non-cancelled) booking
adminRouter.post('/bookings/:id/payments', async (c) => {
  c.header('Cache-Control', 'no-store')
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data
    if (hasForbiddenPaymentFields(body)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }
    const input = body

    // amount: dollars as text or number, up to 7 whole digits and 2 decimals
    const amountText = input.amount === undefined || input.amount === null ? '' : String(input.amount).trim()
    const amountCents = parseMoneyToCents(amountText)
    if (amountCents === null || amountCents > MAX_PAYMENT_CENTS) {
      return c.json(paymentValidationError('amount', 'Enter an amount in dollars between $0.01 and $1,000,000.00.', 'INVALID_FORMAT'), 400)
    }

    const method = typeof input.method === 'string' ? input.method.trim() : ''
    if (!PAYMENT_METHODS.includes(method)) {
      return c.json(paymentValidationError('method', `Choose a payment method: ${PAYMENT_METHODS.join(', ')}.`, 'INVALID_VALUE'), 400)
    }

    const paidOn = typeof input.paid_on === 'string' ? input.paid_on.trim() : ''
    if (!isRealCalendarDate(paidOn)) {
      return c.json(paymentValidationError('paid_on', 'Enter a real date (YYYY-MM-DD).', 'INVALID_FORMAT'), 400)
    }
    const latestAllowed = addDaysISO(await studioTodayISO(c.env.DB), 1)
    if (paidOn < '2000-01-01' || paidOn > latestAllowed) {
      return c.json(paymentValidationError('paid_on', 'The payment date must be between 2000-01-01 and tomorrow.', 'OUT_OF_RANGE'), 400)
    }

    let note = ''
    if (input.note !== undefined && input.note !== null) {
      if (typeof input.note !== 'string') {
        return c.json(paymentValidationError('note', 'The note must be text.', 'INVALID_VALUE'), 400)
      }
      note = input.note.trim()
      if (note.length > PAYMENT_NOTE_MAX) {
        return c.json(paymentValidationError('note', `The note must be at most ${PAYMENT_NOTE_MAX} characters.`, 'TOO_LONG'), 400)
      }
    }

    // Atomic: the row is only written while the booking exists, isn't cancelled and has no open invoice
    const insert = await c.env.DB.prepare(
      `INSERT INTO Booking_Payments (booking_id, amount, method, paid_on, note)
       SELECT ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM Bookings WHERE id = ? AND LOWER(COALESCE(status, '')) != 'cancelled')
         AND NOT ${OPEN_INVOICE_EXISTS_SQL}`
    ).bind(Number(id), amountCents, method, paidOn, note, id, id).run()

    if (!insert.meta.changes) {
      const bookingStatus = await bookingStatusFor(c.env.DB, id)
      if (bookingStatus === null) {
        return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)
      }
      if (bookingStatus === 'cancelled') {
        return c.json({
          error: { code: 'BOOKING_CANCELLED', message: "Cancelled bookings can't take payments.", details: [] }
        }, 409)
      }
      return c.json(INVOICE_OPEN_RESPONSE, 409)
    }

    // A manual payment has no Square invoice, so invoice_status is NULL (removable)
    const row = await c.env.DB.prepare(
      'SELECT *, NULL AS invoice_status FROM Booking_Payments WHERE id = ?'
    ).bind(insert.meta.last_row_id).first<any>()
    const payment = toPayment(row ?? {
      id: insert.meta.last_row_id, booking_id: Number(id), amount: amountCents, method, paid_on: paidOn, note, created_at: null
    })
    const loaded = await loadBookingTotals(c.env.DB, id)
    const totals = loaded ? loaded.totals : computeTotals({}, amountCents)

    return c.json({ status: 'success', payment, totals, data: { payment, totals } }, 201)
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not record payment.', details: [] } }, 500)
  }
})

// DELETE: Remove one recorded payment (allowed on cancelled bookings)
adminRouter.delete('/bookings/:id/payments/:paymentId', async (c) => {
  c.header('Cache-Control', 'no-store')
  try {
    const id = c.req.param('id')
    const paymentId = c.req.param('paymentId')
    if (!isValidId(id) || !isValidId(paymentId)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const parsedBody = await parseOptionalJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.data
    if (hasForbiddenPaymentFields(body)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }

    // Atomic: refused while an invoice is open, or while the payment's Square invoice is still PAID
    // (the next re-check would add it back)
    const result = await c.env.DB.prepare(
      `DELETE FROM Booking_Payments
       WHERE id = ? AND booking_id = ?
         AND NOT ${OPEN_INVOICE_EXISTS_SQL}
         AND NOT EXISTS (SELECT 1 FROM Booking_Invoices i
                         WHERE i.square_invoice_id = Booking_Payments.square_invoice_id AND i.status = 'PAID')`
    ).bind(paymentId, id, id).run()
    if (!result.meta.changes) {
      const payment = await c.env.DB.prepare(
        `SELECT i.status AS invoice_status
         FROM Booking_Payments p LEFT JOIN Booking_Invoices i ON i.square_invoice_id = p.square_invoice_id
         WHERE p.id = ? AND p.booking_id = ?`
      ).bind(paymentId, id).first<{ invoice_status: string | null }>()
      if (!payment) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Payment not found for this booking.', details: [] } }, 404)
      }
      if (payment.invoice_status === 'PAID') {
        return c.json({
          error: {
            code: 'SQUARE_INVOICE_PAYMENT',
            message: 'This payment came from a paid Square invoice. Refund it in Square first.',
            details: []
          }
        }, 409)
      }
      return c.json(INVOICE_OPEN_RESPONSE, 409)
    }

    const loaded = await loadBookingTotals(c.env.DB, id)
    if (!loaded) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    return c.json({ status: 'success', totals: loaded.totals, data: { totals: loaded.totals } })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not remove payment.', details: [] } }, 500)
  }
})

// ── Booking billing: extra charges and the Square balance invoice ─
// Every lock is a condition inside the write (OPEN_INVOICE_EXISTS_SQL), never a separate pre-check.

// GET: Re-check open invoices with Square, then return charges, invoices, payments and totals
adminRouter.get('/bookings/:id/billing', async (c) => {
  noStore(c)
  try {
    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }
    const billing = await refreshBilling(c.env.DB, c.env, id)
    if (!billing) {
      return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)
    }
    const { charges, invoices, payments, totals, stale } = billing
    return c.json({
      status: 'success', charges, invoices, payments, totals, stale,
      data: { charges, invoices, payments, totals, stale }
    })
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not fetch billing.')
  }
})

// POST: Add an extra charge (refused on cancelled bookings and while an invoice is open)
adminRouter.post('/bookings/:id/charges', async (c) => {
  noStore(c)
  try {
    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data
    if (hasForbiddenPaymentFields(body)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }
    const input = body

    const description = typeof input.description === 'string' ? input.description.trim() : ''
    if (description.length < 1 || description.length > DESCRIPTION_MAX) {
      return c.json(paymentValidationError(
        'description', `Enter a description of 1 to ${DESCRIPTION_MAX} characters.`, description ? 'TOO_LONG' : 'REQUIRED'
      ), 400)
    }
    const amountText = input.amount === undefined || input.amount === null ? '' : String(input.amount).trim()
    const amountCents = parseMoneyToCents(amountText)
    if (amountCents === null) {
      return c.json(paymentValidationError('amount', 'Enter an amount like 75 or 19.99.', 'INVALID_FORMAT'), 400)
    }

    const bookingStatus = await bookingStatusFor(c.env.DB, id)
    if (bookingStatus === null) {
      return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)
    }
    if (bookingStatus === 'cancelled') {
      return c.json({ error: { code: 'BOOKING_CANCELLED', message: "Cancelled bookings can't take charges.", details: [] } }, 409)
    }

    const insert = await c.env.DB.prepare(
      `INSERT INTO Booking_Charges (booking_id, description, amount_cents)
       SELECT ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM Bookings WHERE id = ? AND LOWER(COALESCE(status, '')) != 'cancelled')
         AND NOT ${OPEN_INVOICE_EXISTS_SQL}`
    ).bind(Number(id), description, amountCents, id, id).run()

    if (!insert.meta.changes) {
      const statusNow = await bookingStatusFor(c.env.DB, id)
      if (statusNow === null) {
        return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)
      }
      if (statusNow === 'cancelled') {
        return c.json({ error: { code: 'BOOKING_CANCELLED', message: "Cancelled bookings can't take charges.", details: [] } }, 409)
      }
      return c.json(INVOICE_OPEN_RESPONSE, 409)
    }

    const row = await c.env.DB.prepare('SELECT * FROM Booking_Charges WHERE id = ?')
      .bind(insert.meta.last_row_id).first<any>()
    const charge = toChargeJSON(row ?? {
      id: insert.meta.last_row_id, booking_id: Number(id), description, amount_cents: amountCents, created_at: null
    })
    const loaded = await loadBookingTotals(c.env.DB, id)
    if (!loaded) {
      return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)
    }

    return c.json({ status: 'success', charge, totals: loaded.totals, data: { charge, totals: loaded.totals } }, 201)
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not add charge.')
  }
})

// DELETE: Remove an extra charge (refused while an invoice is open)
adminRouter.delete('/bookings/:id/charges/:chargeId', async (c) => {
  noStore(c)
  try {
    const id = c.req.param('id')
    const chargeId = c.req.param('chargeId')
    if (!isValidId(id) || !isValidId(chargeId)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }

    const result = await c.env.DB.prepare(
      `DELETE FROM Booking_Charges WHERE id = ? AND booking_id = ? AND NOT ${OPEN_INVOICE_EXISTS_SQL}`
    ).bind(chargeId, id, id).run()
    if (!result.meta.changes) {
      const charge = await c.env.DB.prepare('SELECT id FROM Booking_Charges WHERE id = ? AND booking_id = ?')
        .bind(chargeId, id).first()
      if (!charge) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Charge not found for this booking.', details: [] } }, 404)
      }
      return c.json(INVOICE_OPEN_RESPONSE, 409)
    }

    const loaded = await loadBookingTotals(c.env.DB, id)
    if (!loaded) {
      return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)
    }
    return c.json({ status: 'success', totals: loaded.totals, data: { totals: loaded.totals } })
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not remove charge.')
  }
})

// POST: Send the balance invoice through Square (body { expected_amount_cents })
adminRouter.post('/bookings/:id/invoice', async (c) => {
  noStore(c)
  try {
    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data
    if (hasForbiddenPaymentFields(body)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }
    const input = body

    const { invoice, totals } = await sendBalanceInvoice(c.env.DB, c.env, id, input.expected_amount_cents)
    return c.json({ status: 'success', invoice, totals, data: { invoice, totals } })
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not send invoice.')
  }
})

// POST: Push the booking's remaining balance to a Square Terminal device
adminRouter.post('/bookings/:id/terminal-checkout', async (c) => {
  noStore(c)
  try {
    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data
    if (hasForbiddenPaymentFields(body)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }
    const input = body
    const deviceId = typeof input.device_id === 'string' ? input.device_id : undefined

    const { checkout } = await sendTerminalCheckout(c.env.DB, c.env, id, input.expected_amount_cents, deviceId)
    const billing = await refreshBilling(c.env.DB, c.env, id)
    return c.json({ status: 'success', checkout, billing, data: { checkout, billing } })
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not start terminal checkout.')
  }
})

function buildCalendarFeedResponseData(c: Context<{ Bindings: Bindings }>, token: string, version: string) {
  const origin = (c.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '') || new URL(c.req.url).origin
  const icsFeedUrl = `${origin}/api/bookings/calendar.ics?token=${encodeURIComponent(token)}`
  const webcalUrl = icsFeedUrl.replace(/^https?:\/\//i, 'webcal://')
  const googleCalendarSubscribeUrl = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(webcalUrl)}`
  const targetCalendarEmail = (c.env.GOOGLE_CALENDAR_ID || '').trim()
  return {
    status: 'success',
    version,
    targetCalendarEmail,
    icsFeedUrl,
    webcalUrl,
    googleCalendarSubscribeUrl,
    data: {
      version,
      targetCalendarEmail,
      icsFeedUrl,
      webcalUrl,
      googleCalendarSubscribeUrl
    }
  }
}

async function handleCalendarFeedRequest(
  c: Context<{ Bindings: Bindings }>,
  options: { rotate: boolean; errorMessage: string }
): Promise<Response> {
  noStore(c)
  try {
    const secret = getSigningSecret(c.env) || (await getMediaSigningSecret(c.env))
    if (!secret) {
      return c.json(
        { error: { code: 'SIGNING_NOT_CONFIGURED', message: 'Calendar feed signing is not configured.', details: [] } },
        503
      )
    }
    const version = options.rotate
      ? await rotateCalendarFeedVersion(c.env.DB)
      : await getCalendarFeedVersion(c.env.DB)
    const token = await signCalendarFeedToken(secret, version)
    return c.json(buildCalendarFeedResponseData(c, token, version))
  } catch (e: any) {
    return billingErrorResponse(c, e, options.errorMessage)
  }
}

// GET: Admin calendar feed URLs for Google Calendar / Apple Calendar subscription
adminRouter.get('/calendar-feed', (c) =>
  handleCalendarFeedRequest(c, { rotate: false, errorMessage: 'Could not generate calendar feed URL.' })
)

// POST: Rotate calendar feed version to immediately revoke previously shared subscription URLs
adminRouter.post('/calendar-feed/rotate', (c) =>
  handleCalendarFeedRequest(c, { rotate: true, errorMessage: 'Could not rotate calendar feed URL.' })
)

// POST: Backfill sync all active non-cancelled bookings to Google Calendar
adminRouter.post('/calendar-sync', async (c) => {
  noStore(c)
  try {
    const timeZone = await getStudioTimeZone(c.env.DB)
    const { results: bookingRows } = await c.env.DB.prepare(
      `${ADMIN_CALENDAR_BOOKING_SELECT}
       WHERE LOWER(COALESCE(b.status, '')) != 'cancelled'
       ORDER BY ss.date ASC, ss.start_time ASC`
    ).all<any>()

    const rows = bookingRows || []
    let syncedCount = 0
    let failedCount = 0
    const reasonsSet = new Set<string>()

    for (const row of rows) {
      const res = await syncBookingToGoogleCalendarApi(c.env, mapRowToCalendarBooking(row, timeZone), 'upsert')
      if (res.synced) {
        syncedCount++
      } else {
        failedCount++
        if (res.reason) reasonsSet.add(res.reason)
      }
    }

    const total = rows.length
    const reasons = Array.from(reasonsSet)
    return c.json({
      status: 'success',
      total,
      syncedCount,
      failedCount,
      reasons,
      data: {
        total,
        syncedCount,
        failedCount,
        reasons
      }
    })
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not sync bookings to Google Calendar.')
  }
})

// POST: Cancel the booking's open invoice
adminRouter.post('/bookings/:id/invoice/cancel', async (c) => {
  noStore(c)
  try {
    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }
    if ((await bookingStatusFor(c.env.DB, id)) === null) {
      return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)
    }

    const cancelled = await cancelOpenInvoice(c.env.DB, c.env, id)
    if (!cancelled) {
      return c.json({ error: { code: 'NO_OPEN_INVOICE', message: 'There is no open invoice to cancel.', details: [] } }, 404)
    }
    const loaded = await loadBookingTotals(c.env.DB, id)
    if (!loaded) {
      return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)
    }
    const { invoice } = cancelled
    return c.json({ status: 'success', invoice, totals: loaded.totals, data: { invoice, totals: loaded.totals } })
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not cancel invoice.')
  }
})

// ── Pricing & Payments Configuration ─────────────────────────────

async function handleGetPricing(c: Context<{ Bindings: Bindings }>) {
  try {
    const row = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'pricing'"
    ).first<{ setting_value: string }>()

    let parsed: any = {}
    if (row?.setting_value) {
      try {
        parsed = JSON.parse(row.setting_value) || {}
      } catch {}
    }

    const pricing = {
      baseFee: Number.isFinite(Number(parsed.baseFee)) && Number(parsed.baseFee) >= 0 ? Number(parsed.baseFee) : 0,
      perPerson: Number.isFinite(Number(parsed.perPerson)) && Number(parsed.perPerson) >= 0 ? Number(parsed.perPerson) : 0,
      depositPercent: normalizeDepositPercent(parsed.depositPercent),
      feeRules: normalizeFeeRules(parsed.feeRules),
      policy: normalizeBookingPolicy(parsed.policy)
    }
    return c.json({ ...pricing, status: 'success', data: pricing })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch pricing settings.', details: [] } }, 500)
  }
}

function validatePricingUpdateBody(c: Context, body: Record<string, any>): Response | null {
  if (hasForbiddenPaymentFields(body)) {
    return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
  }
  if (body.feeRules !== undefined && !Array.isArray(body.feeRules)) {
    return c.json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'feeRules must be an array.',
        details: [{ field: 'feeRules', message: 'feeRules must be an array.' }]
      }
    }, 400)
  }
  if (body.policy !== undefined && (!body.policy || typeof body.policy !== 'object' || Array.isArray(body.policy))) {
    return c.json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'policy must be an object.',
        details: [{ field: 'policy', message: 'policy must be an object.' }]
      }
    }, 400)
  }
  return null
}

function normalizePricingSettingsPayload(body: Record<string, any>, existing: Record<string, any>) {
  const depositPercent = body.depositPercent !== undefined
    ? normalizeDepositPercent(body.depositPercent)
    : normalizeDepositPercent(existing.depositPercent)

  const parsedBaseFee = body.baseFee !== undefined ? Number(body.baseFee) : Number(existing.baseFee)
  const baseFee = Number.isFinite(parsedBaseFee) && parsedBaseFee >= 0 ? Math.round(parsedBaseFee * 100) / 100 : 0

  const parsedPerPerson = body.perPerson !== undefined ? Number(body.perPerson) : Number(existing.perPerson)
  const perPerson = Number.isFinite(parsedPerPerson) && parsedPerPerson >= 0 ? Math.round(parsedPerPerson * 100) / 100 : 0

  const feeRules = body.feeRules !== undefined ? normalizeFeeRules(body.feeRules) : normalizeFeeRules(existing.feeRules)
  const policy = body.policy !== undefined
    ? normalizeBookingPolicy({ ...normalizeBookingPolicy(existing.policy), ...body.policy })
    : normalizeBookingPolicy(existing.policy ?? DEFAULT_BOOKING_POLICY)

  return { baseFee, perPerson, depositPercent, feeRules, policy }
}

async function persistPricingAndPackages(
  db: D1Database,
  cleanPricing: ReturnType<typeof normalizePricingSettingsPayload>,
  packages: unknown
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare(
      "INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('pricing', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value"
    ).bind(JSON.stringify(cleanPricing))
  ]

  if (Array.isArray(packages)) {
    for (const pkg of packages) {
      if (pkg && pkg.id && !String(pkg.id).startsWith('pkg_')) {
        const priceCents = parseNonNegativeMoneyToCents(pkg.price) ?? Math.max(0, Math.round((Number(pkg.price) || 0) * 100))
        statements.push(
          db.prepare(
            'UPDATE Services SET name = COALESCE(?, name), description = COALESCE(?, description), price = ?, is_active = ? WHERE id = ?'
          ).bind(
            pkg.name || pkg.title || null,
            pkg.description !== undefined ? pkg.description : null,
            priceCents,
            pkg.active !== undefined ? (pkg.active ? 1 : 0) : 1,
            pkg.id
          )
        )
      }
    }
  }

  await db.batch(statements)
  await bumpPublicContentVersion(db)
}

async function handleUpdatePricing(c: Context<{ Bindings: Bindings }>) {
  try {
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.data
    const validationErr = validatePricingUpdateBody(c, body)
    if (validationErr) return validationErr

    const existingRow = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'pricing'"
    ).first<{ setting_value: string }>()
    let existing: Record<string, any> = {}
    if (existingRow?.setting_value) {
      try { existing = JSON.parse(existingRow.setting_value) || {} } catch {}
    }

    const cleanPricing = normalizePricingSettingsPayload(body, existing)
    await persistPricingAndPackages(c.env.DB, cleanPricing, body.packages)

    return c.json({ success: true, status: 'success', pricing: cleanPricing, data: cleanPricing })
  } catch {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not save pricing settings.', details: [] } }, 500)
  }
}

adminRouter.get('/pricing', handleGetPricing)
adminRouter.put('/pricing', handleUpdatePricing)
adminRouter.get('/payments/settings', handleGetPricing)
adminRouter.put('/payments/settings', handleUpdatePricing)
adminRouter.put('/settings', handleUpdatePricing)

// ── Coupons ──────────────────────────────────────────────────────

// GET: List coupons
adminRouter.get('/coupons', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, code, discount_type, discount_value, description, expires_at, max_uses, used_count, is_active FROM Coupons ORDER BY id DESC'
    ).all()

    const coupons = (results || []).map((r: any) => ({
      id: r.id,
      code: r.code,
      discount: r.discount_value,
      amount: r.discount_value,
      type: r.discount_type === 'percent' ? 'percent' : 'amount',
      discount_type: r.discount_type === 'percent' ? 'percent' : 'amount',
      discount_value: r.discount_value,
      description: r.description || '',
      expires_at: r.expires_at ?? null,
      max_uses: r.max_uses ?? null,
      used_count: Number(r.used_count) || 0,
      active: r.is_active === 1,
      is_active: r.is_active
    }))

    return c.json({ coupons, status: 'success', data: coupons })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch coupons.', details: [] } }, 500)
  }
})

function parseCouponLimits(body: Record<string, any>, existing?: any):
  | { ok: true; expiresAt: string | null; maxUses: number | null }
  | { ok: false; message: string } {
  let expiresAt: string | null = existing?.expires_at ?? null
  if (body.expires_at !== undefined) {
    if (body.expires_at === null || body.expires_at === '') {
      expiresAt = null
    } else if (typeof body.expires_at === 'string') {
      const s = body.expires_at.trim()
      const ms = /^\d{4}-\d{2}-\d{2}$/.test(s)
        ? (isRealCalendarDate(s) ? Date.parse(`${s}T23:59:59.999Z`) : NaN)
        : Date.parse(s)
      if (!Number.isFinite(ms)) {
        return { ok: false, message: 'expires_at must be a valid ISO date or timestamp.' }
      }
      expiresAt = s
    } else {
      return { ok: false, message: 'expires_at must be an ISO date string or null.' }
    }
  }

  let maxUses: number | null = existing?.max_uses ?? null
  if (body.max_uses !== undefined) {
    if (body.max_uses === null || body.max_uses === '') {
      maxUses = null
    } else {
      const n = Number(body.max_uses)
      if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
        return { ok: false, message: 'max_uses must be a positive integer.' }
      }
      maxUses = n
    }
  }
  return { ok: true, expiresAt, maxUses }
}

// POST: Create coupon
adminRouter.post('/coupons', async (c) => {
  try {
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data
    const code = typeof body.code === 'string' ? body.code.toUpperCase().trim() : ''
    const rawType = String(body.type || body.discount_type || 'percent').trim().toLowerCase()
    const discountType = rawType === 'fixed' ? 'amount' : rawType
    const rawDiscount = body.discount ?? body.amount ?? body.discount_value
    const description = String(body.description || '').trim()
    const isActive = body.active !== undefined ? (body.active ? 1 : 0) : (body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1)

    if (!['percent', 'amount'].includes(discountType)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Discount type must be either "percent" or "amount".',
          details: [{ field: 'discount_type', message: 'Must be "percent" or "amount".', code: 'INVALID_VALUE' }]
        }
      }, 400)
    }

    let discountVal: number
    if (discountType === 'percent') {
      discountVal = Number(rawDiscount)
      if (!code || !Number.isFinite(discountVal) || discountVal <= 0) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Coupon code and a positive discount amount are required.',
            details: []
          }
        }, 400)
      }
      if (discountVal > 100) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Percent discount cannot exceed 100%.',
            details: []
          }
        }, 400)
      }
    } else {
      const textAmt =
        typeof rawDiscount === 'number'
          ? (Number.isFinite(rawDiscount) ? rawDiscount.toFixed(2) : '')
          : typeof rawDiscount === 'string'
            ? rawDiscount.trim()
            : ''
      const cents = parseMoneyToCents(textAmt)
      if (!code || cents === null) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Coupon code and a fixed dollar amount between $0.01 and $1,000,000.00 are required.',
            details: []
          }
        }, 400)
      }
      discountVal = cents / 100
    }

    const limits = parseCouponLimits(body)
    if (!limits.ok) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: limits.message, details: [] } }, 400)
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO Coupons (code, discount_type, discount_value, description, expires_at, max_uses, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(code, discountType, discountVal, description, limits.expiresAt, limits.maxUses, isActive).run()

    const created = {
      id: result.meta.last_row_id,
      code,
      discount: discountVal,
      amount: discountVal,
      type: discountType,
      description,
      expires_at: limits.expiresAt,
      max_uses: limits.maxUses,
      used_count: 0,
      active: isActive === 1
    }

    return c.json({ success: true, status: 'success', id: result.meta.last_row_id, coupon: created, data: created })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not create coupon.', details: [] } }, 500)
  }
})

// PUT: Update coupon
adminRouter.put('/coupons/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data
    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account numbers cannot be stored. Use Square tokenization.',
          details: []
        }
      }, 400)
    }

    const existing = await c.env.DB.prepare('SELECT * FROM Coupons WHERE id = ?').bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Coupon not found.', details: [] } }, 404)
    }

    const code = body.code !== undefined ? String(body.code).toUpperCase().trim() : existing.code
    const rawType = String(body.type || body.discount_type || existing.discount_type).trim().toLowerCase()
    const discountType = rawType === 'fixed' ? 'amount' : rawType

    const rawDiscount = body.discount ?? body.amount ?? body.discount_value
    const effectiveRawDiscount = rawDiscount !== undefined ? rawDiscount : existing.discount_value

    if (!['percent', 'amount'].includes(discountType)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Discount type must be either "percent" or "amount".',
          details: [{ field: 'discount_type', message: 'Must be "percent" or "amount".', code: 'INVALID_VALUE' }]
        }
      }, 400)
    }

    let discountVal: number
    if (discountType === 'percent') {
      discountVal = Number(effectiveRawDiscount)
      if (!code || !Number.isFinite(discountVal) || discountVal <= 0) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Coupon code and a positive discount amount are required.',
            details: []
          }
        }, 400)
      }
      if (discountVal > 100) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Percent discount cannot exceed 100%.',
            details: []
          }
        }, 400)
      }
    } else {
      const textAmt =
        typeof effectiveRawDiscount === 'number'
          ? (Number.isFinite(effectiveRawDiscount) ? effectiveRawDiscount.toFixed(2) : '')
          : typeof effectiveRawDiscount === 'string'
            ? effectiveRawDiscount.trim()
            : ''
      const cents = parseMoneyToCents(textAmt)
      if (!code || cents === null) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Coupon code and a fixed dollar amount between $0.01 and $1,000,000.00 are required.',
            details: []
          }
        }, 400)
      }
      discountVal = cents / 100
    }

    const limits = parseCouponLimits(body, existing)
    if (!limits.ok) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: limits.message, details: [] } }, 400)
    }

    const description = body.description !== undefined ? String(body.description || '').trim() : (existing.description || '')
    const isActive =
      body.active !== undefined
        ? (body.active ? 1 : 0)
        : body.is_active !== undefined
          ? (body.is_active ? 1 : 0)
          : existing.is_active

    await c.env.DB.prepare(
      'UPDATE Coupons SET code = ?, discount_type = ?, discount_value = ?, description = ?, expires_at = ?, max_uses = ?, is_active = ? WHERE id = ?'
    ).bind(code, discountType, discountVal, description, limits.expiresAt, limits.maxUses, isActive, id).run()

    const updated = {
      id: Number(id),
      code,
      discount: discountVal,
      amount: discountVal,
      type: discountType,
      description,
      expires_at: limits.expiresAt,
      max_uses: limits.maxUses,
      used_count: Number(existing.used_count) || 0,
      active: isActive === 1
    }

    return c.json({ success: true, status: 'success', coupon: updated, data: updated })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not update coupon.', details: [] } }, 500)
  }
})

// DELETE: Delete coupon
adminRouter.delete('/coupons/:id', (c) =>
  deleteEntityById(c, {
    table: 'Coupons',
    notFoundMessage: 'Coupon not found.',
    errorMessage: 'Could not delete coupon.'
  })
)

// ── Packages (Services) Aliases for Admin ─────────────────────────
adminRouter.put('/packages/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    if (hasForbiddenPaymentFields(parsedBody.data)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }

    const existing = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ?').bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }

    const parsed = parseServicePayload(parsedBody.data, existing)
    if (!parsed.ok) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not update service.', details: parsed.errors } }, 400)
    }

    const saved = await saveServiceRecord(c.env.DB, parsed.data, existing)
    return c.json({ success: true, status: 'success', data: saved.mapped })
  } catch {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not update service.', details: [] } }, 500)
  }
})

adminRouter.delete('/packages/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }

    const result = await deleteOrDeactivateService(c.env.DB, id)
    if (!result.ok) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }
    if (result.deactivated) {
      return c.json({
        success: true,
        status: 'success',
        deactivated: true,
        message: 'Service has existing bookings and was deactivated instead of deleted.',
        data: { id: Number(id), deactivated: true }
      })
    }
    return c.json({ success: true, status: 'success', data: { id: Number(id), deleted: true } })
  } catch {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete service.', details: [] } }, 500)
  }
})

// ── Portfolio Aliases for Admin ──────────────────────────────────

// GET: Admin photo list. Same params, filters, ordering, paging and row shape as the public
// GET /api/portfolio, except hidden (is_active = 0) photos are included so they can be shown again.
adminRouter.get('/portfolio', async (c) => {
  c.header('Cache-Control', 'no-store')
  try {
    const result = await listPortfolio(c.env.DB, portfolioListQuery(c.req), { includeInactive: true })
    if (!result.ok) return c.json(result.body, result.status)
    return c.json(result.body)
  } catch {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not fetch portfolio images.',
        details: []
      }
    }, 500)
  }
})

adminRouter.put('/portfolio/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    if (hasForbiddenPaymentFields(parsedBody.data)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }

    const result = await updatePortfolioRecord(c.env.DB, id, parsedBody.data, { verifyMediaExists: false })
    if (!result.ok) return c.json(result.body, result.status)

    return c.json({ success: true, status: 'success', data: result.data })
  } catch {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not update portfolio image.',
        details: []
      }
    }, 500)
  }
})

// PUT /api/admin/media/* — Direct replacement of image media chunks (Audit 5)
adminRouter.put('/media/*', async (c) => {
  const url = new URL(c.req.url)
  return handleValidatedMediaPut(
    c,
    url.pathname.replace(/^\/api\/admin\/media\//, '').replace(/^\/admin\/media\//, '')
  )
})

adminRouter.delete('/portfolio/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json(INVALID_ID_RESPONSE, 400)
    }
    const result = await deletePortfolioRecord(c.env.DB, id)
    if (!result.ok) return c.json(result.body, result.status)

    return c.json({ success: true, status: 'success' })
  } catch {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not delete portfolio image.',
        details: []
      }
    }, 500)
  }
})

// ── Profile ──────────────────────────────────────────────────────
// GET: Studio profile information
adminRouter.get('/profile', async (c) => {
  try {
    const profile = await getStudioProfile(c.env.DB)
    return c.json({ ...profile, status: 'success', data: profile })
  } catch {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch profile.', details: [] } }, 500)
  }
})

// PUT: Save studio profile information
adminRouter.put('/profile', async (c) => {
  try {
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data
    const cleanProfile = {
      bio: String(body.bio || '').slice(0, 2000),
      email: String(body.email || '').slice(0, 100),
      phone: String(body.phone || '').slice(0, 30),
      location: String(body.location || '').slice(0, 100),
      travel: String(body.travel || '').slice(0, 200),
      social: Array.isArray(body.social)
        ? body.social
            .filter((s: unknown): s is Record<string, unknown> => Boolean(s && typeof s === 'object' && !Array.isArray(s)))
            .map((s) => ({
              platform: String(s.platform || '').slice(0, 50),
              url: /^https?:\/\//i.test(String(s.url || '')) ? String(s.url).slice(0, 300) : ''
            }))
        : []
    }
    const val = JSON.stringify(cleanProfile)

    await c.env.DB.prepare(
      "INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('profile', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value"
    ).bind(val).run()

    await bumpPublicContentVersion(c.env.DB)

    return c.json({ success: true, status: 'success', profile: cleanProfile, data: cleanProfile })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not save profile.', details: [] } }, 500)
  }
})

// ── Leads ────────────────────────────────────────────────────────

// GET: View contact submissions, newest first. Keyset paging with ?before_id= (ORDER BY created_at DESC,
// id DESC); ?offset= is still accepted when before_id is absent (back-compat).
adminRouter.get('/leads', async (c) => {
  c.header('Cache-Control', 'no-store')
  try {
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 100))
    const beforeIdRaw = c.req.query('before_id')
    const LEAD_COLUMNS = 'id, name, email, phone, session_type, message, created_at'

    // One extra row tells us whether another page exists
    let rows: any[] = []
    let offset = 0
    if (beforeIdRaw !== undefined && beforeIdRaw !== '') {
      // A malformed before_id yields an empty page
      if (isValidId(beforeIdRaw)) {
        const cursor = await c.env.DB.prepare('SELECT id, created_at FROM Leads WHERE id = ?')
          .bind(beforeIdRaw).first<{ id: number; created_at: string }>()
        if (cursor) {
          const { results } = await c.env.DB.prepare(
            `SELECT ${LEAD_COLUMNS} FROM Leads
             WHERE (created_at < ?) OR (created_at = ? AND id < ?)
             ORDER BY created_at DESC, id DESC LIMIT ?`
          ).bind(cursor.created_at, cursor.created_at, cursor.id, limit + 1).all()
          rows = results || []
        } else {
          // The cursor row was deleted: continue from the rows inserted before it. Ids grow with
          // insertion (as created_at does), so id order matches the created_at order above.
          const { results } = await c.env.DB.prepare(
            `SELECT ${LEAD_COLUMNS} FROM Leads WHERE id < ? ORDER BY id DESC LIMIT ?`
          ).bind(beforeIdRaw, limit + 1).all()
          rows = results || []
        }
      }
    } else {
      offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)
      const { results } = await c.env.DB.prepare(
        `SELECT ${LEAD_COLUMNS} FROM Leads ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
      ).bind(limit + 1, offset).all()
      rows = results || []
    }

    const has_more = rows.length > limit
    const leads = has_more ? rows.slice(0, limit) : rows
    const next_before_id = leads.length > 0 ? leads[leads.length - 1].id : null

    return c.json({ status: 'success', leads, has_more, next_before_id, limit, offset, data: leads })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch leads.', details: [] } }, 500)
  }
})

// DELETE: Remove one contact submission
adminRouter.delete('/leads/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const result = await c.env.DB.prepare('DELETE FROM Leads WHERE id = ?').bind(id).run()
    if (!result.meta.changes) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Enquiry not found.', details: [] } }, 404)
    }
    return c.json({ status: 'success', data: { id: Number(id), deleted: true } })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete enquiry.', details: [] } }, 500)
  }
})
