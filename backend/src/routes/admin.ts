import { Hono, Context } from 'hono'
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
import { DEFAULT_PROFILE, ensurePortfolioDefaults, listPortfolio, portfolioListQuery } from './portfolio'
import { bumpPublicContentVersion } from '../lib/edgeCache'
import { releaseBookingSlots, syncRollingScheduleSlots } from '../lib/scheduleSync'
import { isEmailConfigured, sendEmail } from '../email'
import {
  addDaysISO,
  bookingTotalCents,
  computeTotals,
  DEFAULT_BOOKING_POLICY,
  DEFAULT_DEPOSIT_PERCENT,
  DESCRIPTION_MAX,
  normalizeBookingPolicy,
  normalizeDepositPercent,
  normalizeFeeRules,
  parseMoneyToCents
} from '../lib/billingMath'
import {
  BillingError,
  cancelOpenInvoice,
  getSquare,
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
import { syncBookingToGoogleCalendarApi } from '../lib/googleCalendar'
import {
  BOOKING_PAYMENTS_TABLE_SQL,
  BOOKING_PAYMENTS_INDEX_SQL,
  BILLING_SCHEMA_STEPS,
  ensurePhotoPermissionsColumns,
  replaceMediaStorageChunks
} from '../lib/billingSchema'
import { signMediaKey, parseMediaVariantWidth } from '../utils/signedUrl'

function isValidId(id: string | undefined): boolean {
  return typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id)
}

const ADMIN_CALENDAR_BOOKING_SELECT = `SELECT b.id, b.client_name, b.client_email, b.customer_phone,
        COALESCE(NULLIF(b.event_location, ''), b.location) AS location,
        b.notes, b.attendees, b.status,
        ss.date, ss.start_time, ss.end_time,
        s.name AS service_name
 FROM Bookings b
 INNER JOIN Schedule_Slots ss ON b.slot_id = ss.id
 LEFT JOIN Services s ON b.service_id = s.id`

function mapRowToCalendarBooking(row: any, timeZone: string) {
  return {
    id: row.id,
    date: row.date,
    start_time: row.start_time,
    end_time: row.end_time,
    client_name: row.client_name,
    client_email: row.client_email,
    customer_phone: row.customer_phone,
    package_name: row.service_name,
    service_name: row.service_name,
    status: row.status,
    notes: row.notes,
    location: row.location,
    attendees: row.attendees,
    timeZone
  }
}

function scheduleGoogleCalendarSync(
  c: Context<{ Bindings: Bindings }>,
  bookingId: number | string,
  action: 'upsert' | 'delete'
) {
  const task = (async () => {
    if (action === 'delete') {
      await syncBookingToGoogleCalendarApi(c.env, { id: bookingId, date: '', start_time: '' }, 'delete')
      return
    }
    const row = await c.env.DB.prepare(`${ADMIN_CALENDAR_BOOKING_SELECT} WHERE b.id = ?`).bind(bookingId).first<any>()
    if (!row || !row.date || !row.start_time) return
    const timeZone = await getStudioTimeZone(c.env.DB)
    await syncBookingToGoogleCalendarApi(c.env, mapRowToCalendarBooking(row, timeZone), 'upsert')
  })().catch((err) => {
    console.warn('Non-blocking admin calendar sync error:', err)
  })

  try {
    c.executionCtx?.waitUntil(task)
  } catch {
    // Ignore when executionCtx is unavailable (e.g. unit tests)
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const adminRouter = new Hono<{ Bindings: Bindings }>()
export { DEFAULT_PROFILE, ensurePhotoPermissionsColumns, replaceMediaStorageChunks }

// ── Live D1 Schema Auto-Migration (OPT-02: once per db/isolate) ─────
const schemaReadyByDb = new WeakMap<object, Promise<void>>()

export async function ensureSchemaReady(db?: D1Database): Promise<void> {
  if (!db) return
  const existing = schemaReadyByDb.get(db)
  if (existing) return existing

  const promise = (async () => {
    let allSucceeded = true
    try {
      await db.prepare(BOOKING_PAYMENTS_TABLE_SQL).run()
      await db.prepare(BOOKING_PAYMENTS_INDEX_SQL).run()
      for (const step of BILLING_SCHEMA_STEPS) {
        try {
          await db.prepare(step.sql).run()
        } catch (err) {
          if (!step.ignoreError) {
            allSucceeded = false
            console.warn('Schema step failed (non-fatal):', err)
          }
        }
      }
      const photoOk = await ensurePhotoPermissionsColumns(db)
      if (!photoOk) {
        allSucceeded = false
      }
    } catch (err) {
      allSucceeded = false
      console.warn('ensureSchemaReady failed:', err)
    } finally {
      if (!allSucceeded) {
        schemaReadyByDb.delete(db)
      }
    }
  })()

  schemaReadyByDb.set(db, promise)
  return promise
}

function toConsentFlag(val: unknown): number {
  return val === true || val === 1 || val === '1' || val === 'true' ? 1 : 0
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
  'event_location', 'agreement_signed_name', 'agreement_signed_at', 'applied_fees_json'
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

// GET: Public authentication configuration for Google Sign-In
adminRouter.get('/auth-config', (c) => {
  noStore(c)
  return c.json({ googleClientId: c.env.GOOGLE_CLIENT_ID || '' })
})

// POST: Google Sign-In authentication via Google ID token
adminRouter.post('/google-login', async (c) => {
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

    const body = await c.req.json().catch(() => ({}))
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
    const body = await c.req.json()

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
    const date = body.date
    const start_time = body.start_time || body.startTime
    const end_time = body.end_time || body.endTime

    const errors = []
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      errors.push({ field: 'date', message: 'Date is required (YYYY-MM-DD).', code: 'REQUIRED_FIELD' })
    }
    if (!start_time) errors.push({ field: 'start_time', message: 'Start time is required (HH:MM).', code: 'REQUIRED_FIELD' })
    if (!end_time) errors.push({ field: 'end_time', message: 'End time is required (HH:MM).', code: 'REQUIRED_FIELD' })

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

// DELETE: Remove a timeslot (only if not booked)
adminRouter.delete('/schedule/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const result = await c.env.DB.prepare(
      'DELETE FROM Schedule_Slots WHERE id = ? AND is_booked = 0'
    ).bind(id).run()

    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Slot not found or already booked.', details: [] } }, 404)
    }

    return c.json({ success: true, status: 'success' })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete slot.', details: [] } }, 500)
  }
})

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
    const body = await c.req.json()
    const rawAvailability = body.availability !== undefined ? body.availability : body
    if (!Array.isArray(rawAvailability)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Availability must be an array.', details: [] } }, 400)
    }

    const ALLOWED_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const cleanAvailability = rawAvailability.map((item: any) => {
      const day = ALLOWED_DAYS.includes(item.day) ? item.day : 'Monday'
      const available = Boolean(item.available)
      const timeframes = Array.isArray(item.timeframes)
        ? item.timeframes.map((tf: any) => ({
            id: Number(tf.id) || Date.now(),
            start: String(tf.start || '09:00').slice(0, 5),
            end: String(tf.end || '17:00').slice(0, 5),
            label: String(tf.label || `${tf.start} - ${tf.end}`).slice(0, 50),
            repeat: tf.repeat === 'none' ? 'none' : 'weekly'
          }))
        : []
      return { day, available, timeframes }
    })

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
    const body = await c.req.json()
    const date = String(body.date || body.dateStr || '').trim()
    const endDate = String(body.endDate || body.end_date || '').trim()
    const reason = String(body.reason || '').trim()

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Valid date (YYYY-MM-DD) is required.',
          details: [{ field: 'date', message: 'Date must be in YYYY-MM-DD format.', code: 'INVALID_FORMAT' }]
        }
      }, 400)
    }

    let dates: string[]
    if (endDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < date) {
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
adminRouter.delete('/blocked-dates/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const result = await c.env.DB.prepare('DELETE FROM Blocked_Dates WHERE id = ?').bind(id).run()

    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Blocked date not found.', details: [] } }, 404)
    }

    return c.json({ success: true, status: 'success' })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete blocked date.', details: [] } }, 500)
  }
})

// ── Bookings ─────────────────────────────────────────────────────

const NO_PACKAGE_LABEL = 'No package'
const BOOKING_STATUSES = ['pending', 'confirmed', 'cancelled']
const INVALID_STATUS_RESPONSE = {
  error: {
    code: 'VALIDATION_FAILED',
    message: 'Status must be pending, confirmed or cancelled.',
    details: [{ field: 'status', message: 'Status must be pending, confirmed or cancelled.', code: 'INVALID_VALUE' }]
  }
}

/** Lower-cased booking status, or null when it is not pending, confirmed or cancelled. */
function parseBookingStatus(raw: unknown): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  return BOOKING_STATUSES.includes(value) ? value : null
}
const PAYMENT_METHODS = ['Cash', 'Card', 'Square', 'Zelle', 'Venmo', 'Cash App', 'Other']
const MAX_PAYMENT_CENTS = 100_000_000
const PAYMENT_NOTE_MAX = 500
const INVOICE_OPEN_MESSAGE = 'An invoice is out for this booking. Cancel it to change amounts.'
const INVOICE_OPEN_RESPONSE = { error: { code: 'INVOICE_OPEN', message: INVOICE_OPEN_MESSAGE, details: [] } }
const BOOKING_NOT_FOUND_RESPONSE = { error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }
const INVALID_ID_RESPONSE = { error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }

function isPresentNumber(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

/** BillingError -> its own code and status; anything else -> the usual 500 with `fallbackMessage`. */
function billingErrorResponse(c: Context, err: unknown, fallbackMessage = 'Something went wrong.') {
  if (err instanceof BillingError) {
    return c.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.httpStatus as 400 | 404 | 409 | 500 | 502 | 503
    )
  }
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: fallbackMessage, details: [] } }, 500)
}

/** After a guarded write changed nothing: 404 when the booking is gone, else null (the caller picks the 409). */
async function bookingStatusFor(db: D1Database, bookingId: string | number): Promise<string | null> {
  const row = await db.prepare('SELECT status FROM Bookings WHERE id = ?').bind(bookingId).first<{ status: string | null }>()
  return row ? String(row.status || '').toLowerCase() : null
}

/** Real calendar date check for YYYY-MM-DD (rejects 2026-02-30 etc.). */
function isRealCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

type NormalizedPackage = { kind: 'none' } | { kind: 'id'; id: number } | { kind: 'invalid' }

/** packageId/service_id: empty, null, 'none' or 'custom' = no package; otherwise a positive integer id. */
function normalizePackageInput(raw: unknown): NormalizedPackage {
  if (raw === undefined || raw === null) return { kind: 'none' }
  const text = String(raw).trim()
  if (text === '' || text.toLowerCase() === 'none' || text.toLowerCase() === 'custom') return { kind: 'none' }
  if (!/^[1-9]\d{0,9}$/.test(text)) return { kind: 'invalid' }
  return { kind: 'id', id: Number(text) }
}

const SCHEMA_PENDING_RESPONSE = {
  error: {
    code: 'SCHEMA_PENDING',
    message: "The database update for bookings without a package hasn't run yet. Try again in a minute.",
    details: []
  }
}

const PACKAGE_MISSING_RESPONSE = {
  error: {
    code: 'VALIDATION_FAILED',
    message: 'The selected package no longer exists.',
    details: [{ field: 'packageId', message: 'The selected package no longer exists.', code: 'INVALID_VALUE' }]
  }
}

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
    const body = await c.req.json()
    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account numbers cannot be stored. Use Square tokenization.',
          details: []
        }
      }, 400)
    }
    const client_name = String(body.client_name || body.customer_name || body.customer || body.client || '').trim()
    const client_email = String(body.client_email || body.customer_email || body.email || '').trim()
    const customer_phone = String(body.customer_phone || body.phone || '').trim()
    const location = String(body.location || '').trim()
    const notes = String(body.notes || '').trim()
    const attendees = Math.max(1, Math.round(Number(body.people ?? body.attendees ?? 1) || 1))
    const deposit_paid =
      body.deposit_paid !== undefined
        ? Math.max(0, Math.round(Number(body.deposit_paid) || 0))
        : body.deposit !== undefined
          ? Math.max(0, Math.round((Number(body.deposit) || 0) * 100))
          : 0
    const coupon_code =
      typeof body.coupon === 'object' && body.coupon !== null
        ? String(body.coupon.code || '').trim()
        : String(body.coupon_code || body.coupon || '').trim()
    let custom_price: number | null =
      body.custom_price !== undefined && body.custom_price !== null
        ? Math.max(0, Math.round(Number(body.custom_price) || 0))
        : body.totalPrice !== undefined
          ? Math.max(0, Math.round((Number(body.totalPrice) || 0) * 100))
          : body.price !== undefined
            ? Math.max(0, Math.round((Number(body.price) || 0) * 100))
            : null

    const packageInput = normalizePackageInput(body.service_id ?? body.packageId)
    const slot_id = body.slot_id ?? body.slotId
    const photo_permission_portfolio = toConsentFlag(
      body.photo_permission_portfolio ?? body.photoPermissions?.websitePortfolio ?? body.photoPermissions?.website_portfolio
    )
    const photo_permission_social = toConsentFlag(
      body.photo_permission_social ?? body.photoPermissions?.socialMedia ?? body.photoPermissions?.social_media
    )
    const photo_permission_accepted_at =
      photo_permission_portfolio || photo_permission_social ? new Date().toISOString() : null
    const photo_permission_version = 'v1'
    const status = body.status === undefined || body.status === null || body.status === ''
      ? 'confirmed'
      : parseBookingStatus(body.status)
    if (status === null) {
      return c.json(INVALID_STATUS_RESPONSE, 400)
    }
    const date = body.date
    const start_time = body.start_time || body.startTime || body.time || '09:00'
    const end_time = body.end_time || body.endTime || '10:00'

    if (!client_name || !client_email) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Client name and email are required.', details: [] } }, 400)
    }

    // Resolve the package before touching any slot. No package -> service_id NULL and a custom
    // price is required; a numeric id must point at a real service (foreign key).
    let targetServiceId: number | null = null
    let finalPrice =
      body.price_at_booking !== undefined && body.price_at_booking !== null
        ? Math.max(0, Math.round(Number(body.price_at_booking) || 0))
        : custom_price

    if (packageInput.kind === 'none') {
      // The custom price must be given explicitly (cents in custom_price, or dollars in totalPrice/price) and be >= 0
      const rawDollars = body.totalPrice !== undefined ? body.totalPrice : body.price
      const noPackageCents = isPresentNumber(body.custom_price)
        ? Math.round(Number(body.custom_price))
        : isPresentNumber(rawDollars)
          ? Math.round(Number(rawDollars) * 100)
          : null
      if (noPackageCents === null || noPackageCents < 0) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Enter a custom price for a booking without a package.',
            details: [{ field: 'custom_price', message: 'Enter a custom price for a booking without a package.', code: 'REQUIRED_FIELD' }]
          }
        }, 400)
      }
      if (!(await bookingsServiceIdNullable(c.env.DB))) {
        return c.json(SCHEMA_PENDING_RESPONSE, 503)
      }
      custom_price = noPackageCents
      if (body.price_at_booking === undefined || body.price_at_booking === null) finalPrice = noPackageCents
    } else {
      const svc = packageInput.kind === 'id'
        ? await c.env.DB.prepare('SELECT id, price FROM Services WHERE id = ?').bind(packageInput.id).first<any>()
        : null
      if (!svc) {
        return c.json(PACKAGE_MISSING_RESPONSE, 400)
      }
      targetServiceId = Number(svc.id)
      if (finalPrice == null) finalPrice = svc.price
    }

    let targetSlotId = slot_id
    let slotWasCreated = false

    if (targetSlotId) {
      // Atomically lock existing slot only if not already booked
      const lockRes = await c.env.DB.prepare(
        'UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ? AND is_booked = 0'
      ).bind(targetSlotId).run()

      if (!lockRes.success || lockRes.meta.changes === 0) {
        return c.json({
          error: {
            code: 'SLOT_ALREADY_BOOKED',
            message: 'The selected slot is already booked or does not exist.',
            details: []
          }
        }, 409)
      }
    } else if (date) {
      // Reuse an open slot the weekly availability already created at this time; only add a new one when none exists
      const existingSlot = await c.env.DB.prepare(
        'SELECT id, is_booked FROM Schedule_Slots WHERE date = ? AND start_time = ? ORDER BY is_booked ASC LIMIT 1'
      ).bind(date, start_time).first<{ id: number; is_booked: number }>()

      if (existingSlot) {
        const lockRes = await c.env.DB.prepare(
          'UPDATE Schedule_Slots SET is_booked = 1, end_time = ? WHERE id = ? AND is_booked = 0'
        ).bind(end_time, existingSlot.id).run()
        if (!lockRes.success || lockRes.meta.changes === 0) {
          return c.json({
            error: { code: 'SLOT_ALREADY_BOOKED', message: 'That date and time is already booked.', details: [] }
          }, 409)
        }
        targetSlotId = existingSlot.id
      } else {
        const slotResult = await c.env.DB.prepare(
          'INSERT INTO Schedule_Slots (date, start_time, end_time, is_booked) VALUES (?, ?, ?, 1)'
        ).bind(date, start_time, end_time).run()
        targetSlotId = slotResult.meta.last_row_id
        slotWasCreated = true
      }
    }

    if (!targetSlotId) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Slot ID or date/time details required.', details: [] } }, 400)
    }

    let bookingResult: D1Result
    try {
      bookingResult = await c.env.DB.prepare(
        `INSERT INTO Bookings (
          service_id, slot_id, client_name, client_email, price_at_booking, status,
          customer_phone, location, notes, attendees, deposit_paid, coupon_code, custom_price,
          photo_permission_portfolio, photo_permission_social, photo_permission_accepted_at, photo_permission_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        targetServiceId,
        targetSlotId,
        client_name,
        client_email,
        finalPrice ?? 0,
        status,
        customer_phone,
        location,
        notes,
        attendees,
        deposit_paid,
        coupon_code,
        custom_price,
        photo_permission_portfolio,
        photo_permission_social,
        photo_permission_accepted_at,
        photo_permission_version
      ).run()
    } catch (insertErr) {
      // Undo the slot work so the time doesn't stay blocked by a booking that was never saved
      if (slotWasCreated) {
        await c.env.DB.prepare('DELETE FROM Schedule_Slots WHERE id = ?').bind(targetSlotId).run().catch(() => {})
      } else {
        await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(targetSlotId).run().catch(() => {})
      }
      throw insertErr
    }

    if (bookingResult.meta.last_row_id) {
      scheduleGoogleCalendarSync(c, bookingResult.meta.last_row_id, 'upsert')
    }

    return c.json({
      success: true,
      status: 'success',
      id: bookingResult.meta.last_row_id,
      data: { id: bookingResult.meta.last_row_id, slot_id: targetSlotId }
    })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not create booking.', details: [] } }, 500)
  }
})

// PUT & PATCH: Update an existing booking
async function updateBookingHandler(c: Context<{ Bindings: Bindings }>) {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const body = await c.req.json()
    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account numbers cannot be stored. Use Square tokenization.',
          details: []
        }
      }, 400)
    }

    // service_price feeds bookingTotalCents for the invoice lock below
    const existing = await c.env.DB.prepare(
      'SELECT b.*, s.price AS service_price FROM Bookings b LEFT JOIN Services s ON s.id = b.service_id WHERE b.id = ?'
    ).bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    const rawName = body.client_name ?? body.customer_name ?? body.customer ?? body.client
    const client_name = rawName !== undefined ? String(rawName).trim() : existing.client_name

    const rawEmail = body.client_email ?? body.customer_email ?? body.email
    if (rawEmail !== undefined && rawEmail !== null && String(rawEmail).trim() !== '') {
      if (!EMAIL_REGEX.test(String(rawEmail).trim())) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Please enter a valid client email address.',
            details: [{ field: 'client_email', message: 'Invalid email format.', code: 'INVALID_FORMAT' }]
          }
        }, 400)
      }
    }
    const client_email = rawEmail !== undefined ? String(rawEmail).trim() : existing.client_email

    const newDate = body.date
    if (newDate !== undefined && newDate !== null && String(newDate).trim() !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(newDate).trim())) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Date must be in YYYY-MM-DD format.',
            details: [{ field: 'date', message: 'Invalid date format.', code: 'INVALID_FORMAT' }]
          }
        }, 400)
      }
    }

    const rawPhone = body.customer_phone ?? body.phone
    const customer_phone = rawPhone !== undefined ? String(rawPhone).trim() : (existing.customer_phone || '')

    const location = body.location !== undefined ? String(body.location).trim() : (existing.location || '')
    const notes = body.notes !== undefined ? String(body.notes).trim() : (existing.notes || '')

    const rawAttendees = body.people ?? body.attendees
    const attendees = rawAttendees !== undefined ? Math.max(1, Math.round(Number(rawAttendees) || 1)) : (existing.attendees ?? 1)

    const deposit_paid =
      body.deposit_paid !== undefined
        ? Math.max(0, Math.round(Number(body.deposit_paid) || 0))
        : body.deposit !== undefined
          ? Math.max(0, Math.round((Number(body.deposit) || 0) * 100))
          : (existing.deposit_paid ?? 0)

    const coupon_code =
      body.coupon !== undefined || body.coupon_code !== undefined
        ? typeof body.coupon === 'object' && body.coupon !== null
          ? String(body.coupon.code || '').trim()
          : String(body.coupon_code ?? body.coupon ?? '').trim()
        : (existing.coupon_code || '')

    let custom_price = existing.custom_price
    if (body.custom_price !== undefined) {
      custom_price = body.custom_price === null ? null : Math.max(0, Math.round(Number(body.custom_price) || 0))
    } else if (body.totalPrice !== undefined) {
      custom_price = Math.max(0, Math.round((Number(body.totalPrice) || 0) * 100))
    } else if (body.price !== undefined) {
      custom_price = Math.max(0, Math.round((Number(body.price) || 0) * 100))
    }

    const price_at_booking =
      body.price_at_booking !== undefined
        ? Math.max(0, Math.round(Number(body.price_at_booking) || 0))
        : custom_price !== null && custom_price !== undefined
          ? custom_price
          : existing.price_at_booking

    // Package: only changed when service_id/packageId is sent. 'none' / null / '' -> no package (NULL);
    // a numeric id must point at an existing service.
    let service_id: number | null = existing.service_id ?? null
    let service_price: unknown = existing.service_price
    const packageSent = body.service_id !== undefined || body.packageId !== undefined
    if (packageSent) {
      const packageInput = normalizePackageInput(body.service_id !== undefined ? body.service_id : body.packageId)
      if (packageInput.kind === 'none') {
        if (existing.service_id !== null && existing.service_id !== undefined && !(await bookingsServiceIdNullable(c.env.DB))) {
          return c.json(SCHEMA_PENDING_RESPONSE, 503)
        }
        service_id = null
        service_price = null
      } else {
        const svc = packageInput.kind === 'id'
          ? await c.env.DB.prepare('SELECT id, price FROM Services WHERE id = ?').bind(packageInput.id).first<{ id: number; price: unknown }>()
          : null
        if (!svc) {
          return c.json(PACKAGE_MISSING_RESPONSE, 400)
        }
        service_id = Number(svc.id)
        service_price = svc.price
      }
    }

    const existingStatus = String(existing.status || '').toLowerCase()
    let status: string = existing.status
    if (body.status !== undefined) {
      const requested = parseBookingStatus(body.status)
      if (requested === null) {
        return c.json(INVALID_STATUS_RESPONSE, 400)
      }
      status = requested
    }
    const statusLower = String(status || '').toLowerCase()

    const rawPortfolioConsent =
      body.photo_permission_portfolio !== undefined
        ? body.photo_permission_portfolio
        : body.photoPermissions?.websitePortfolio ?? body.photoPermissions?.website_portfolio
    const rawSocialConsent =
      body.photo_permission_social !== undefined
        ? body.photo_permission_social
        : body.photoPermissions?.socialMedia ?? body.photoPermissions?.social_media
    const photo_permission_portfolio =
      rawPortfolioConsent !== undefined ? toConsentFlag(rawPortfolioConsent) : (existing.photo_permission_portfolio ? 1 : 0)
    const photo_permission_social =
      rawSocialConsent !== undefined ? toConsentFlag(rawSocialConsent) : (existing.photo_permission_social ? 1 : 0)
    const photo_permission_accepted_at =
      photo_permission_portfolio || photo_permission_social
        ? (existing.photo_permission_accepted_at || new Date().toISOString())
        : null
    const photo_permission_version = existing.photo_permission_version || 'v1'

    // Cancelling withdraws the open invoice first; if Square refuses, nothing is changed
    if (statusLower === 'cancelled' && existingStatus !== 'cancelled') {
      await cancelOpenInvoice(c.env.DB, c.env, id)
    }

    // Invoice lock: only when the effective base, deposit_paid or service_id actually changes
    // (resending the same price is not a change). The guard is inside the UPDATE, and the UPDATE
    // runs before the slot writes, so a refused lock leaves nothing changed.
    const beforeBase = bookingTotalCents(existing)
    const afterBase = bookingTotalCents({ custom_price, price_at_booking, service_price })
    const moneyChanged =
      afterBase !== beforeBase ||
      Number(deposit_paid) !== Number(existing.deposit_paid ?? 0) ||
      String(service_id ?? '') !== String(existing.service_id ?? '')
    // A cancel is guarded too, so a Send that claimed the booking after the withdraw above blocks it
    const cancelling = statusLower === 'cancelled' && existingStatus !== 'cancelled'
    const guarded = moneyChanged || cancelling
    const lockSql = guarded ? ` AND NOT ${OPEN_INVOICE_EXISTS_SQL}` : ''
    const lockBinds: unknown[] = guarded ? [id] : []

    const update = await c.env.DB.prepare(
      `UPDATE Bookings
       SET client_name = ?,
           client_email = ?,
           customer_phone = ?,
           location = ?,
           event_location = ?,
           notes = ?,
           attendees = ?,
           deposit_paid = ?,
           coupon_code = ?,
           custom_price = ?,
           price_at_booking = ?,
           service_id = ?,
           status = ?,
           photo_permission_portfolio = ?,
           photo_permission_social = ?,
           photo_permission_accepted_at = ?,
           photo_permission_version = ?
       WHERE id = ?${lockSql}`
    ).bind(
      client_name,
      client_email,
      customer_phone,
      location,
      location,
      notes,
      attendees,
      deposit_paid,
      coupon_code,
      custom_price,
      price_at_booking,
      service_id,
      status,
      photo_permission_portfolio,
      photo_permission_social,
      photo_permission_accepted_at,
      photo_permission_version,
      id,
      ...lockBinds
    ).run()
    if (!update.meta.changes) {
      if ((await bookingStatusFor(c.env.DB, id)) === null) {
        return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)
      }
      return c.json(INVOICE_OPEN_RESPONSE, 409)
    }

    // Update associated Schedule_Slots row if date/startTime/endTime changed
    const newStartTime = body.start_time ?? body.startTime
    const newEndTime = body.end_time ?? body.endTime
    if (existing.slot_id && (newDate !== undefined || newStartTime !== undefined || newEndTime !== undefined)) {
      await c.env.DB.prepare(
        `UPDATE Schedule_Slots
         SET date = COALESCE(?, date),
             start_time = COALESCE(?, start_time),
             end_time = COALESCE(?, end_time)
         WHERE id = ?`
      ).bind(newDate || null, newStartTime || null, newEndTime || null, existing.slot_id).run()
    }

    if (statusLower === 'cancelled' && existing.slot_id) {
      await releaseBookingSlots(c.env.DB, id, existing.slot_id)
    } else if (statusLower !== 'cancelled' && existingStatus === 'cancelled' && existing.slot_id) {
      await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ?').bind(existing.slot_id).run()
    }

    scheduleGoogleCalendarSync(c, id, 'upsert')

    return c.json({ success: true, status: 'success' })
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
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }

    const booking = await c.env.DB.prepare(
      'SELECT slot_id, status, square_payment_id, deposit_paid FROM Bookings WHERE id = ?'
    )
      .bind(id)
      .first<{
        slot_id: number | null
        status: string | null
        square_payment_id: string | null
        deposit_paid: number | null
      }>()
    if (!booking) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    const body = (await c.req.json().catch(() => ({}))) as { refund?: boolean; reason?: string } | null
    const shouldRefund = body?.refund !== false

    if (String(booking.status || '').toLowerCase() === 'cancelled') {
      return c.json({ success: true, status: 'success', refundedCents: 0 })
    }

    // Withdraw any open invoice first; a BillingError leaves the booking unchanged
    await cancelOpenInvoice(c.env.DB, c.env, id)

    let refundedCents = 0
    let squareRefundId: string | null = null

    if (shouldRefund && booking.square_payment_id && Number(booking.deposit_paid || 0) > 0) {
      try {
        const { client } = await getSquare(c.env)
        const paymentRes = await client.payments.get({ paymentId: booking.square_payment_id })
        const payment = paymentRes?.payment
        const refundableCents = Math.max(
          0,
          Number(payment?.amountMoney?.amount ?? booking.deposit_paid) - Number(payment?.refundedMoney?.amount ?? 0)
        )

        if (refundableCents > 0) {
          const refundRes = await client.refunds.refundPayment({
            idempotencyKey: `cancel_${id}_${booking.square_payment_id}`,
            paymentId: booking.square_payment_id,
            amountMoney: { amount: BigInt(refundableCents), currency: 'USD' },
            reason: String(body?.reason || 'Photographer cancelled booking').slice(0, 192)
          })
          squareRefundId = refundRes?.refund?.id || null
          refundedCents = refundableCents

          const existingRefund = await c.env.DB.prepare(
            "SELECT id FROM Booking_Payments WHERE booking_id = ? AND method = 'refund' AND amount = ? LIMIT 1"
          )
            .bind(id, -refundedCents)
            .first<{ id: number }>()

          if (!existingRefund) {
            await c.env.DB.prepare(
              'INSERT INTO Booking_Payments (booking_id, amount, method, paid_on, note) VALUES (?, ?, ?, ?, ?)'
            )
              .bind(
                id,
                -refundedCents,
                'refund',
                new Date().toISOString().slice(0, 10),
                squareRefundId ? `Square refund (${squareRefundId})` : 'Square refund'
              )
              .run()
          }
        }
      } catch (err: unknown) {
        return billingErrorResponse(c, err, 'Could not refund Square payment.')
      }
    }

    // Guarded like every lock: a Send that claimed the booking after the withdraw above blocks the cancel
    const cancelled = await c.env.DB.prepare(
      `UPDATE Bookings SET status = 'cancelled' WHERE id = ? AND NOT ${OPEN_INVOICE_EXISTS_SQL}`
    ).bind(id, id).run()
    if (!cancelled.meta?.changes) {
      return c.json(INVOICE_OPEN_RESPONSE, 409)
    }

    if (booking.slot_id) {
      await releaseBookingSlots(c.env.DB, id, booking.slot_id)
    }

    scheduleGoogleCalendarSync(c, id, 'delete')

    return c.json({ success: true, status: 'success', refundedCents, squareRefundId })
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

    const booking = await c.env.DB.prepare('SELECT slot_id FROM Bookings WHERE id = ?').bind(id).first<{ slot_id: number }>()
    if (!booking) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    // Withdraw any open invoice first; a BillingError leaves the booking unchanged
    await cancelOpenInvoice(c.env.DB, c.env, id)

    // One batch (one transaction). Every statement carries the open-invoice guard, so a Send that claimed
    // the booking after the withdraw above makes the whole batch a no-op (no live Square invoice is ever
    // orphaned). The invoice rows go last, so the guard still sees them while the other rows are removed.
    const noOpenInvoice = `NOT ${OPEN_INVOICE_EXISTS_SQL}`
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(`DELETE FROM Booking_Payments WHERE booking_id = ? AND ${noOpenInvoice}`).bind(id, id),
      c.env.DB.prepare(`DELETE FROM Booking_Charges WHERE booking_id = ? AND ${noOpenInvoice}`).bind(id, id),
      c.env.DB.prepare(`DELETE FROM Bookings WHERE id = ? AND ${noOpenInvoice}`).bind(id, id)
    ]
    if (booking.slot_id) {
      statements.push(c.env.DB.prepare(
        `UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ? AND ${noOpenInvoice}`
      ).bind(booking.slot_id, id))
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
    const body = await c.req.json().catch(() => ({}))
    if (hasForbiddenPaymentFields(body)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }
    const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}

    // amount: dollars as text or number, up to 7 whole digits and 2 decimals
    const amountText = input.amount === undefined || input.amount === null ? '' : String(input.amount).trim()
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(amountText)) {
      return c.json(paymentValidationError('amount', 'Enter an amount in dollars, like 150 or 19.99.', 'INVALID_FORMAT'), 400)
    }
    const amountCents = Math.round(Number(amountText) * 100)
    if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > MAX_PAYMENT_CENTS) {
      return c.json(paymentValidationError('amount', 'The amount must be between $0.01 and $1,000,000.00.', 'OUT_OF_RANGE'), 400)
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
    // A DELETE normally has no body; if one is sent it gets the same card-number guard as POST
    const body = await c.req.json().catch(() => null)
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
    const body = await c.req.json().catch(() => ({}))
    if (hasForbiddenPaymentFields(body)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }
    const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}

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
    const body = await c.req.json().catch(() => ({}))
    if (hasForbiddenPaymentFields(body)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }
    const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}

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
    const body = await c.req.json().catch(() => ({}))
    if (hasForbiddenPaymentFields(body)) {
      return c.json(FORBIDDEN_PAYMENT_RESPONSE, 400)
    }
    const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    const deviceId = typeof input.device_id === 'string' ? input.device_id : undefined

    const { checkout } = await sendTerminalCheckout(c.env.DB, c.env, id, input.expected_amount_cents, deviceId)
    const billing = await refreshBilling(c.env.DB, c.env, id)
    return c.json({ status: 'success', checkout, billing, data: { checkout, billing } })
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not start terminal checkout.')
  }
})

// GET: Admin calendar feed URLs for Google Calendar / Apple Calendar subscription
adminRouter.get('/calendar-feed', async (c) => {
  noStore(c)
  try {
    const secret = getSigningSecret(c.env) || (await getMediaSigningSecret(c.env))
    if (!secret) {
      return c.json(
        { error: { code: 'SIGNING_NOT_CONFIGURED', message: 'Calendar feed signing is not configured.', details: [] } },
        503
      )
    }

    const token = await signCalendarFeedToken(secret)
    const origin = new URL(c.req.url).origin
    const icsFeedUrl = `${origin}/api/bookings/calendar.ics?token=${encodeURIComponent(token)}`
    const webcalUrl = icsFeedUrl.replace(/^https?:\/\//i, 'webcal://')
    const googleCalendarSubscribeUrl = `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(webcalUrl)}`
    const targetCalendarEmail = (c.env.GOOGLE_CALENDAR_ID || 'r59mediatesting@gmail.com').trim() || 'r59mediatesting@gmail.com'

    return c.json({
      status: 'success',
      targetCalendarEmail,
      icsFeedUrl,
      webcalUrl,
      googleCalendarSubscribeUrl,
      data: {
        targetCalendarEmail,
        icsFeedUrl,
        webcalUrl,
        googleCalendarSubscribeUrl
      }
    })
  } catch (e: any) {
    return billingErrorResponse(c, e, 'Could not generate calendar feed URL.')
  }
})

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

async function handleUpdatePricing(c: Context<{ Bindings: Bindings }>) {
  try {
    const body = await c.req.json().catch(() => ({}))
    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account numbers cannot be stored. Use Square tokenization.',
          details: []
        }
      }, 400)
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

    const existingRow = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'pricing'"
    ).first<{ setting_value: string }>()
    let existing: any = {}
    if (existingRow?.setting_value) {
      try {
        existing = JSON.parse(existingRow.setting_value) || {}
      } catch {}
    }

    const depositPercent =
      body.depositPercent !== undefined
        ? normalizeDepositPercent(body.depositPercent)
        : normalizeDepositPercent(existing.depositPercent)

    const parsedBaseFee = body.baseFee !== undefined ? Number(body.baseFee) : Number(existing.baseFee)
    const baseFee = Number.isFinite(parsedBaseFee) && parsedBaseFee >= 0 ? Math.round(parsedBaseFee * 100) / 100 : 0

    const parsedPerPerson = body.perPerson !== undefined ? Number(body.perPerson) : Number(existing.perPerson)
    const perPerson = Number.isFinite(parsedPerPerson) && parsedPerPerson >= 0 ? Math.round(parsedPerPerson * 100) / 100 : 0

    const feeRules =
      body.feeRules !== undefined ? normalizeFeeRules(body.feeRules) : normalizeFeeRules(existing.feeRules)
    const policy =
      body.policy !== undefined
        ? normalizeBookingPolicy({ ...normalizeBookingPolicy(existing.policy), ...body.policy })
        : normalizeBookingPolicy(existing.policy ?? DEFAULT_BOOKING_POLICY)

    const cleanPricing = {
      baseFee,
      perPerson,
      depositPercent,
      feeRules,
      policy
    }
    const val = JSON.stringify(cleanPricing)

    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        "INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('pricing', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value"
      ).bind(val)
    ]

    if (Array.isArray(body.packages)) {
      for (const pkg of body.packages) {
        if (pkg && pkg.id && !String(pkg.id).startsWith('pkg_')) {
          const priceCents = Math.round((Number(pkg.price) || 0) * 100)
          statements.push(
            c.env.DB.prepare(
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

    await c.env.DB.batch(statements)
    await bumpPublicContentVersion(c.env.DB)

    return c.json({ success: true, status: 'success', pricing: cleanPricing, data: cleanPricing })
  } catch (e: any) {
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
      'SELECT id, code, discount_type, discount_value, description, is_active FROM Coupons ORDER BY id DESC'
    ).all()

    const coupons = (results || []).map((r: any) => ({
      id: r.id,
      code: r.code,
      discount: r.discount_value,
      amount: r.discount_value,
      type: r.discount_type,
      discount_type: r.discount_type,
      discount_value: r.discount_value,
      description: r.description || '',
      active: r.is_active === 1,
      is_active: r.is_active
    }))

    return c.json({ coupons, status: 'success', data: coupons })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch coupons.', details: [] } }, 500)
  }
})

// POST: Create coupon
adminRouter.post('/coupons', async (c) => {
  try {
    const body = await c.req.json()
    const code = typeof body.code === 'string' ? body.code.toUpperCase().trim() : ''
    const discountType = body.type || body.discount_type || 'percent'
    const discountVal = Number(body.discount ?? body.amount ?? body.discount_value)
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

    if (!code || !Number.isFinite(discountVal) || discountVal <= 0) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Coupon code and a positive discount amount are required.',
          details: []
        }
      }, 400)
    }

    if (discountType === 'percent' && discountVal > 100) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Percent discount cannot exceed 100%.',
          details: []
        }
      }, 400)
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO Coupons (code, discount_type, discount_value, description, is_active) VALUES (?, ?, ?, ?, ?)'
    ).bind(code, discountType, discountVal, description, isActive).run()

    const created = {
      id: result.meta.last_row_id,
      code,
      discount: discountVal,
      amount: discountVal,
      type: discountType,
      description,
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
    const body = await c.req.json()
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
    const discountType = body.type || body.discount_type || existing.discount_type

    const rawDiscount = body.discount ?? body.amount ?? body.discount_value
    const discountVal = rawDiscount !== undefined ? Number(rawDiscount) : Number(existing.discount_value)

    if (!['percent', 'amount'].includes(discountType)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Discount type must be either "percent" or "amount".',
          details: [{ field: 'discount_type', message: 'Must be "percent" or "amount".', code: 'INVALID_VALUE' }]
        }
      }, 400)
    }

    if (!code || !Number.isFinite(discountVal) || discountVal <= 0) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Coupon code and a positive discount amount are required.',
          details: []
        }
      }, 400)
    }

    if (discountType === 'percent' && discountVal > 100) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Percent discount cannot exceed 100%.',
          details: []
        }
      }, 400)
    }

    const description = body.description !== undefined ? String(body.description || '').trim() : (existing.description || '')
    const isActive =
      body.active !== undefined
        ? (body.active ? 1 : 0)
        : body.is_active !== undefined
          ? (body.is_active ? 1 : 0)
          : existing.is_active

    await c.env.DB.prepare(
      'UPDATE Coupons SET code = ?, discount_type = ?, discount_value = ?, description = ?, is_active = ? WHERE id = ?'
    ).bind(code, discountType, discountVal, description, isActive, id).run()

    const updated = {
      id: Number(id),
      code,
      discount: discountVal,
      amount: discountVal,
      type: discountType,
      description,
      active: isActive === 1
    }

    return c.json({ success: true, status: 'success', coupon: updated, data: updated })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not update coupon.', details: [] } }, 500)
  }
})

// DELETE: Delete coupon
adminRouter.delete('/coupons/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const result = await c.env.DB.prepare('DELETE FROM Coupons WHERE id = ?').bind(id).run()

    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Coupon not found.', details: [] } }, 404)
    }

    return c.json({ success: true, status: 'success' })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete coupon.', details: [] } }, 500)
  }
})

// ── Packages (Services) Aliases for Admin ─────────────────────────
adminRouter.put('/packages/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const body = await c.req.json().catch(() => ({}))
    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account numbers cannot be stored. Use Square tokenization.',
          details: []
        }
      }, 400)
    }

    const existing = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ?').bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }

    const rawName = body.name ?? body.title
    const name = rawName !== undefined ? String(rawName).trim() : String(existing.name || '').trim()
    const description = body.description !== undefined ? (body.description === null ? null : String(body.description)) : existing.description
    const bookingMode = body.booking_mode !== undefined ? String(body.booking_mode) : (body.bookingMode !== undefined ? String(body.bookingMode) : (existing.booking_mode || 'direct'))

    const rawPrice = body.priceMinor !== undefined ? body.priceMinor : (body.price !== undefined ? body.price : existing.price)
    const rawDuration = body.duration_minutes !== undefined ? body.duration_minutes : (body.durationMinutes !== undefined ? body.durationMinutes : existing.duration_minutes)
    const isActive =
      body.is_active !== undefined
        ? (body.is_active ? 1 : 0)
        : body.active !== undefined
          ? (body.active ? 1 : 0)
          : existing.is_active

    const errors = []
    if (!name) {
      errors.push({ field: 'name', message: 'Service name/title cannot be empty.', code: 'REQUIRED_FIELD' })
    }

    let cleanPrice: number | null = null
    if (rawPrice === null || (rawPrice === undefined && bookingMode === 'inquiry')) {
      cleanPrice = null
    } else {
      const numPrice = Number(rawPrice)
      if (!Number.isFinite(numPrice) || numPrice < 0) {
        errors.push({ field: 'price', message: 'Price must be a valid number >= 0.', code: 'INVALID_VALUE' })
      } else {
        cleanPrice = Math.round(numPrice)
      }
    }

    let cleanDuration: number | null = null
    if (rawDuration === null || (rawDuration === undefined && bookingMode === 'inquiry')) {
      cleanDuration = null
    } else {
      const effectiveDuration = rawDuration === undefined ? 60 : rawDuration
      const numDuration = Number(effectiveDuration)
      if (!Number.isFinite(numDuration) || numDuration < 0) {
        errors.push({ field: 'duration_minutes', message: 'Duration in minutes must be >= 0.', code: 'INVALID_VALUE' })
      } else {
        cleanDuration = Math.round(numDuration)
      }
    }

    if (errors.length > 0) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not update service.', details: errors } }, 400)
    }

    const rawFullDay = body.full_day !== undefined ? body.full_day : body.fullDay
    const fullDay = rawFullDay !== undefined
      ? (rawFullDay === true || Number(rawFullDay) === 1 ? 1 : 0)
      : (existing.full_day ? 1 : 0)

    const bestFor = body.best_for !== undefined ? (body.best_for === null ? null : String(body.best_for)) : (body.bestFor !== undefined ? (body.bestFor === null ? null : String(body.bestFor)) : existing.best_for)
    const imageUrl = body.image_url !== undefined ? (body.image_url === null ? null : String(body.image_url)) : (body.image?.url !== undefined ? String(body.image.url) : existing.image_url)
    const imageAlt = body.image_alt !== undefined ? (body.image_alt === null ? null : String(body.image_alt)) : (body.image?.alt !== undefined ? String(body.image.alt) : existing.image_alt)

    let photoCount = existing.photo_count
    const rawPhotoCount = body.photo_count !== undefined ? body.photo_count : body.photoCount
    if (rawPhotoCount !== undefined) {
      photoCount = rawPhotoCount === null ? null : Math.round(Number(rawPhotoCount))
    }

    let outfits = existing.outfits
    const rawOutfits = body.outfits
    if (rawOutfits !== undefined) {
      outfits = rawOutfits === null ? null : Math.round(Number(rawOutfits))
    }

    const currency = body.currency !== undefined ? String(body.currency) : (existing.currency || 'USD')

    let additionalPeople = existing.additional_people
    const rawAdditionalPeople = body.additional_people !== undefined ? body.additional_people : body.additionalPeople
    if (rawAdditionalPeople !== undefined) {
      if (rawAdditionalPeople === null || rawAdditionalPeople === '') {
        additionalPeople = null
      } else if (typeof rawAdditionalPeople === 'string') {
        additionalPeople = rawAdditionalPeople
      } else if (typeof rawAdditionalPeople === 'object') {
        additionalPeople = JSON.stringify(rawAdditionalPeople)
      }
    }

    let displayOrder = existing.display_order ?? 0
    const rawDisplayOrder = body.display_order !== undefined ? body.display_order : body.displayOrder
    if (rawDisplayOrder !== undefined) {
      displayOrder = rawDisplayOrder === null ? 0 : Math.round(Number(rawDisplayOrder))
    }

    await c.env.DB.prepare(
      `UPDATE Services SET
        name = ?, description = ?, price = ?, duration_minutes = ?, full_day = ?, is_active = ?,
        best_for = ?, image_url = ?, image_alt = ?, photo_count = ?, outfits = ?,
        currency = ?, booking_mode = ?, additional_people = ?, display_order = ?
      WHERE id = ?`
    ).bind(
      name, description, cleanPrice, cleanDuration, fullDay, isActive,
      bestFor, imageUrl, imageAlt, photoCount, outfits,
      currency, bookingMode, additionalPeople, displayOrder,
      id
    ).run()

    await bumpPublicContentVersion(c.env.DB)

    return c.json({
      success: true,
      status: 'success',
      data: {
        id: Number(id),
        name,
        title: name,
        description,
        price: cleanPrice,
        duration_minutes: cleanDuration,
        full_day: fullDay === 1,
        is_active: isActive,
        best_for: bestFor,
        image_url: imageUrl,
        image_alt: imageAlt,
        photo_count: photoCount,
        outfits,
        currency,
        booking_mode: bookingMode,
        additional_people: additionalPeople,
        display_order: displayOrder
      }
    })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not update service.', details: [] } }, 500)
  }
})

adminRouter.delete('/packages/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }

    const existing = await c.env.DB.prepare('SELECT id FROM Services WHERE id = ?').bind(id).first()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }

    const bookingCheck = await c.env.DB.prepare(
      'SELECT id FROM Bookings WHERE service_id = ? LIMIT 1'
    ).bind(id).first()

    if (bookingCheck) {
      await c.env.DB.prepare('UPDATE Services SET is_active = 0 WHERE id = ?').bind(id).run()
      await bumpPublicContentVersion(c.env.DB)
      return c.json({
        success: true,
        status: 'success',
        deactivated: true,
        message: 'Service has existing bookings and was deactivated instead of deleted.',
        data: { id: Number(id), deactivated: true }
      })
    }

    await c.env.DB.prepare('DELETE FROM Services WHERE id = ?').bind(id).run()
    await bumpPublicContentVersion(c.env.DB)
    return c.json({ success: true, status: 'success', data: { id: Number(id), deleted: true } })
  } catch (e: any) {
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
  } catch (e: any) {
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
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const body = await c.req.json().catch(() => ({}))
    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account numbers cannot be stored. Use Square tokenization.',
          details: []
        }
      }, 400)
    }

    const existing = await c.env.DB.prepare('SELECT * FROM Portfolio_Images WHERE id = ?').bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Image record not found.', details: [] } }, 404)
    }

    let section = existing.section || 'gallery'
    if (body.section !== undefined) {
      const s = String(body.section).trim().toLowerCase()
      if (!['recent', 'gallery', 'about', 'hero'].includes(s)) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Unknown section. Use one of: recent, gallery, about, hero.',
            details: [{ field: 'section', message: 'Invalid section', code: 'INVALID_VALUE' }]
          }
        }, 400)
      }
      section = s
    }

    const title = body.title !== undefined ? (body.title === null ? null : String(body.title).slice(0, 200)) : existing.title
    const category = body.category !== undefined ? String(body.category) : existing.category
    const alt_text = body.alt_text !== undefined ? (body.alt_text === null ? null : String(body.alt_text).slice(0, 500)) : existing.alt_text
    const is_active =
      body.is_active !== undefined
        ? (body.is_active ? 1 : 0)
        : body.active !== undefined
          ? (body.active ? 1 : 0)
          : existing.is_active
    const is_featured = body.is_featured !== undefined ? (body.is_featured ? 1 : 0) : existing.is_featured
    const display_order = body.display_order !== undefined ? Number(body.display_order) : existing.display_order

    const rawMediaKey = body.media_key !== undefined ? (typeof body.media_key === 'string' ? body.media_key.trim() : null) : undefined
    const media_key = rawMediaKey !== undefined ? (rawMediaKey || existing.media_key) : existing.media_key

    const updateStatements: D1PreparedStatement[] = [
      c.env.DB.prepare(
        'UPDATE Portfolio_Images SET media_key = ?, section = ?, title = ?, category = ?, alt_text = ?, is_active = ?, is_featured = ?, display_order = ? WHERE id = ?'
      ).bind(media_key, section, title, category, alt_text, is_active, is_featured, display_order, id)
    ]

    // If replacing image file with a new key, delete old chunks and variants from Media_Storage atomically
    if (rawMediaKey && existing.media_key && rawMediaKey !== existing.media_key && !existing.media_key.startsWith('/assets/')) {
      updateStatements.push(
        c.env.DB.prepare('DELETE FROM Media_Storage WHERE file_key IN (?, ?, ?)').bind(
          existing.media_key,
          `${existing.media_key}__w640`,
          `${existing.media_key}__w1280`
        )
      )
    }

    if (updateStatements.length === 1) {
      await updateStatements[0].run()
    } else {
      await c.env.DB.batch(updateStatements)
    }

    await bumpPublicContentVersion(c.env.DB)

    return c.json({
      success: true,
      status: 'success',
      data: { id: Number(id), media_key, section, title, category, alt_text, is_active, is_featured, display_order }
    })
  } catch (e: any) {
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
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/admin\/media\//, '').replace(/^\/admin\/media\//, '')).replace(/^\/+/, '')
  if (!key || key.includes('..')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid media key', details: [] } }, 400)
  }

  const rawVariant = url.searchParams.get('variant')
  const variant = parseMediaVariantWidth(rawVariant)
  if (rawVariant !== null && rawVariant !== '' && !variant) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid variant width. Must be 640 or 1280.', details: [] } }, 400)
  }
  const storageKey = variant ? `${key}__w${variant}` : key

  const contentType = (c.req.header('Content-Type') || 'image/webp').split(';')[0].trim().toLowerCase()
  const arrayBuffer = await c.req.arrayBuffer()
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    return c.json({ error: { code: 'VALIDATION_FAILED', message: 'No file data received.', details: [] } }, 400)
  }
  if (arrayBuffer.byteLength > 50 * 1024 * 1024) {
    return c.json({ error: { code: 'FILE_TOO_LARGE', message: 'File size exceeds the 50 MB maximum limit.', details: [] } }, 413)
  }

  try {
    await replaceMediaStorageChunks(c.env.DB, storageKey, arrayBuffer, contentType)
    await bumpPublicContentVersion(c.env.DB)
    return c.json({ success: true, fileKey: storageKey, key: storageKey, baseKey: key, variant: variant ?? null }, 200)
  } catch (err: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to store image in database storage.',
        details: []
      }
    }, 500)
  }
})

adminRouter.delete('/portfolio/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!id || !isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }

    const existing = await c.env.DB.prepare(
      'SELECT id, media_key FROM Portfolio_Images WHERE id = ?'
    ).bind(id).first<{ id: number; media_key: string }>()

    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Image record not found.', details: [] } }, 404)
    }

    await c.env.DB.prepare('DELETE FROM Portfolio_Images WHERE id = ?').bind(id).run()

    if (existing.media_key && !existing.media_key.startsWith('/assets/')) {
      await c.env.DB.prepare('DELETE FROM Media_Storage WHERE file_key IN (?, ?, ?)').bind(
        existing.media_key,
        `${existing.media_key}__w640`,
        `${existing.media_key}__w1280`
      ).run().catch(() => {})
    }

    await bumpPublicContentVersion(c.env.DB)

    return c.json({ success: true, status: 'success' })
  } catch (e: any) {
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
    const row = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'profile'"
    ).first<{ setting_value: string }>()

    let parsed: any = null
    if (row?.setting_value) {
      try { parsed = JSON.parse(row.setting_value) } catch {}
    }

    // Stored social array is returned as-is (an empty array stays empty); legacy object form is converted
    let socialList: { platform: string; url: string }[] = []
    if (Array.isArray(parsed?.social)) {
      socialList = parsed.social
    } else if (parsed?.social && typeof parsed.social === 'object') {
      socialList = Object.entries(parsed.social)
        .filter(([_, url]) => Boolean(url))
        .map(([platform, url]) => ({
          platform: platform.charAt(0).toUpperCase() + platform.slice(1),
          url: String(url)
        }))
    }

    const text = (value: unknown): string =>
      value === undefined || value === null ? '' : String(value).trim()

    const bio = text(parsed?.bio) || DEFAULT_PROFILE.bio
    const email = text(parsed?.email) || DEFAULT_PROFILE.email
    const phone = text(parsed?.phone) || DEFAULT_PROFILE.phone
    const location = text(parsed?.location) || DEFAULT_PROFILE.location
    const travel = parsed?.travel !== undefined && parsed?.travel !== null && String(parsed.travel).trim()
      ? (typeof parsed.travel === 'string' ? parsed.travel : (parsed.travel ? 'Studio & On-Location (Worldwide)' : 'Studio only'))
      : DEFAULT_PROFILE.travel
    const social = socialList.length > 0 ? socialList : DEFAULT_PROFILE.social

    const profile = {
      bio,
      email,
      phone,
      location,
      travel,
      social
    }
    return c.json({ ...profile, status: 'success', data: profile })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch profile.', details: [] } }, 500)
  }
})

// PUT: Save studio profile information
adminRouter.put('/profile', async (c) => {
  try {
    const body = await c.req.json()
    const cleanProfile = {
      bio: String(body.bio || '').slice(0, 2000),
      email: String(body.email || '').slice(0, 100),
      phone: String(body.phone || '').slice(0, 30),
      location: String(body.location || '').slice(0, 100),
      travel: String(body.travel || '').slice(0, 200),
      social: Array.isArray(body.social)
        ? body.social.map((s: any) => ({
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
