import { Hono, Context } from 'hono'
import { Bindings } from '../index'
import { adminAuth, timingSafeEqual, createSessionToken, extractSessionToken, revokeSessionToken } from '../middleware/auth'

export const adminRouter = new Hono<{ Bindings: Bindings }>()

// ── Live D1 Schema Auto-Migration (OPT-02: once per isolate) ─────
let schemaInitialized = false

export async function ensureSchemaReady(db: D1Database): Promise<void> {
  if (schemaInitialized) return
  try {
    await db.prepare(
      'CREATE TABLE IF NOT EXISTS Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)'
    ).run()

    const alterStatements = [
      "ALTER TABLE Coupons ADD COLUMN description TEXT DEFAULT ''",
      "ALTER TABLE Bookings ADD COLUMN customer_phone TEXT DEFAULT ''",
      "ALTER TABLE Bookings ADD COLUMN location TEXT DEFAULT ''",
      "ALTER TABLE Bookings ADD COLUMN notes TEXT DEFAULT ''",
      'ALTER TABLE Bookings ADD COLUMN attendees INTEGER DEFAULT 1',
      'ALTER TABLE Bookings ADD COLUMN deposit_paid INTEGER DEFAULT 0',
      "ALTER TABLE Bookings ADD COLUMN coupon_code TEXT DEFAULT ''",
      'ALTER TABLE Bookings ADD COLUMN custom_price INTEGER'
    ]

    for (const sql of alterStatements) {
      await db.prepare(sql).run().catch(() => {})
    }

    // BUG-01: Check if Bookings still has inline `slot_id INTEGER NOT NULL UNIQUE`
    const bookingTable = await db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'Bookings'"
    ).first<{ sql: string }>()

    if (bookingTable?.sql && /slot_id\s+INTEGER\s+NOT\s+NULL\s+UNIQUE/i.test(bookingTable.sql)) {
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS Bookings_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service_id INTEGER NOT NULL,
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
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (service_id) REFERENCES Services(id),
          FOREIGN KEY (slot_id) REFERENCES Schedule_Slots(id)
        )`),
        db.prepare(`INSERT INTO Bookings_new (
          id, service_id, slot_id, client_name, client_email, price_at_booking,
          square_payment_id, status, customer_phone, location, notes, attendees,
          deposit_paid, coupon_code, custom_price, created_at
        ) SELECT
          id, service_id, slot_id, client_name, client_email, price_at_booking,
          square_payment_id, status, COALESCE(customer_phone, ''), COALESCE(location, ''),
          COALESCE(notes, ''), COALESCE(attendees, 1), COALESCE(deposit_paid, 0),
          COALESCE(coupon_code, ''), custom_price, created_at
        FROM Bookings`),
        db.prepare('DROP TABLE Bookings'),
        db.prepare('ALTER TABLE Bookings_new RENAME TO Bookings'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_bookings_slot ON Bookings(slot_id)'),
        db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot ON Bookings(slot_id) WHERE status != 'cancelled'"),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_bookings_service ON Bookings(service_id)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_bookings_created ON Bookings(created_at DESC)')
      ])
    } else {
      await db.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot ON Bookings(slot_id) WHERE status != 'cancelled'"
      ).run().catch(() => {})
    }

    schemaInitialized = true
  } catch (err) {
    console.error('Schema initialization warning:', err)
  }
}

// ── Bounded Rate Limiter for Admin Login ─────────────────────────
const MAX_LOGIN_ATTEMPT_ENTRIES = 1000
const LOGIN_WINDOW_MS = 60 * 1000
const MAX_LOGIN_ATTEMPTS = 5
const loginAttempts = new Map<string, { attempts: number; resetAt: number }>()

function pruneLoginAttempts(now: number): void {
  for (const [key, entry] of loginAttempts.entries()) {
    if (now > entry.resetAt) {
      loginAttempts.delete(key)
    }
  }
}

function isLoginRateLimited(ip: string): boolean {
  const now = Date.now()
  pruneLoginAttempts(now)
  const entry = loginAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    return false
  }
  return entry.attempts >= MAX_LOGIN_ATTEMPTS
}

function recordFailedLoginAttempt(ip: string): void {
  const now = Date.now()
  pruneLoginAttempts(now)
  const entry = loginAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    if (loginAttempts.size >= MAX_LOGIN_ATTEMPT_ENTRIES) {
      const oldestKey = loginAttempts.keys().next().value
      if (oldestKey) loginAttempts.delete(oldestKey)
    }
    loginAttempts.set(ip, { attempts: 1, resetAt: now + LOGIN_WINDOW_MS })
  } else {
    entry.attempts++
  }
}

// Public login endpoint for admin credentials
adminRouter.post('/login', async (c) => {
  try {
    const expectedSecret = c.env.ADMIN_SECRET
    if (!expectedSecret) {
      return c.json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Server authentication is not configured.',
          details: []
        }
      }, 500)
    }

    const expectedEmail = (c.env.ADMIN_EMAIL || 'r59mediatesting@gmail.com').trim().toLowerCase()

    const clientIp = c.req.header('cf-connecting-ip') || 'unknown'
    if (isLoginRateLimited(clientIp)) {
      return c.json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many login attempts. Please wait 1 minute before trying again.',
          details: []
        }
      }, 429)
    }

    const body = await c.req.json().catch(() => ({}))
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''

    // Both email and password must be non-empty
    if (!email || !password) {
      recordFailedLoginAttempt(clientIp)
      return c.json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email address or password.',
          details: []
        }
      }, 401)
    }

    // Timing-safe constant-time credential comparison
    const emailMatches = timingSafeEqual(email, expectedEmail)
    const passwordMatches = timingSafeEqual(password, expectedSecret)

    if (!emailMatches || !passwordMatches) {
      recordFailedLoginAttempt(clientIp)
      // Intentional short delay to mitigate rapid automated brute-force attacks
      await new Promise(r => setTimeout(r, 300))
      return c.json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email address or password.',
          details: []
        }
      }, 401)
    }

    // Clear failed attempts on successful login
    loginAttempts.delete(clientIp)

    // Generate secure HMAC-signed session token with decoupled SESSION_SECRET
    const signingSecret = c.env.SESSION_SECRET || expectedSecret
    const token = await createSessionToken(signingSecret, expectedEmail)

    c.header(
      'Set-Cookie',
      `r59_session=${token}; Path=/; HttpOnly; SameSite=Strict${c.req.url.startsWith('https://') ? '; Secure' : ''}; Max-Age=86400`
    )

    return c.json({
      success: true,
      status: 'success',
      token,
      email: expectedEmail,
      data: {
        token,
        email: expectedEmail
      }
    })
  } catch (e: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Authentication error.',
        details: []
      }
    }, 500)
  }
})

// Public logout endpoint (registered before adminAuth so cookie is always cleared)
adminRouter.post('/logout', async (c) => {
  const token = extractSessionToken(c)
  if (token) {
    revokeSessionToken(token)
  }
  c.header(
    'Set-Cookie',
    `r59_session=; Path=/; HttpOnly; SameSite=Strict${c.req.url.startsWith('https://') ? '; Secure' : ''}; Max-Age=0`
  )
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
  const expectedEmail = (c.env.ADMIN_EMAIL || 'r59mediatesting@gmail.com').trim().toLowerCase()
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

// POST: Add a blocked date
adminRouter.post('/blocked-dates', async (c) => {
  try {
    const body = await c.req.json()
    const date = String(body.date || body.dateStr || '').trim()
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

    const existing = await c.env.DB.prepare(
      'SELECT id, date, reason FROM Blocked_Dates WHERE date = ?'
    ).bind(date).first<{ id: number; date: string; reason: string }>()

    if (existing) {
      const payload = { id: existing.id, date: existing.date, dateStr: existing.date, reason: existing.reason || '' }
      return c.json({ success: true, status: 'success', ...payload, data: payload })
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO Blocked_Dates (date, reason) VALUES (?, ?)'
    ).bind(date, reason).run()

    const payload = { id: result.meta.last_row_id, date, dateStr: date, reason }
    return c.json({ success: true, status: 'success', ...payload, data: payload })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not add blocked date.', details: [] } }, 500)
  }
})

// DELETE: Remove a blocked date
adminRouter.delete('/blocked-dates/:id', async (c) => {
  try {
    const id = c.req.param('id')
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

// GET: View all bookings
adminRouter.get('/bookings', async (c) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 100))
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)

    const { results } = await c.env.DB.prepare(
      `SELECT b.id, b.client_name, b.client_email, b.price_at_booking, b.square_payment_id, b.status, b.created_at,
              b.service_id, b.slot_id,
              b.customer_phone, b.location, b.notes, b.attendees, b.deposit_paid, b.coupon_code, b.custom_price,
              s.name as service_name, s.price as service_price, sl.date, sl.start_time, sl.end_time
       FROM Bookings b
       LEFT JOIN Services s ON b.service_id = s.id
       LEFT JOIN Schedule_Slots sl ON b.slot_id = sl.id
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all()

    const bookings = (results || []).map((b: any) => {
      const priceCents =
        b.custom_price !== null && b.custom_price !== undefined
          ? Number(b.custom_price)
          : b.price_at_booking !== null && b.price_at_booking !== undefined
            ? Number(b.price_at_booking)
            : Number(b.service_price) || 0
      const depositCents = Number(b.deposit_paid) || 0
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
        package: b.service_name || 'Photoshoot',
        packageId: b.service_id
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
    const custom_price =
      body.custom_price !== undefined && body.custom_price !== null
        ? Math.max(0, Math.round(Number(body.custom_price) || 0))
        : body.totalPrice !== undefined
          ? Math.max(0, Math.round((Number(body.totalPrice) || 0) * 100))
          : body.price !== undefined
            ? Math.max(0, Math.round((Number(body.price) || 0) * 100))
            : null

    const service_id = body.service_id ?? body.packageId
    const slot_id = body.slot_id ?? body.slotId
    const status = String(body.status || 'confirmed').toLowerCase()
    const date = body.date
    const start_time = body.start_time || body.startTime || body.time || '09:00'
    const end_time = body.end_time || body.endTime || '10:00'

    if (!client_name || !client_email) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Client name and email are required.', details: [] } }, 400)
    }

    let targetSlotId = slot_id

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
      const slotResult = await c.env.DB.prepare(
        'INSERT INTO Schedule_Slots (date, start_time, end_time, is_booked) VALUES (?, ?, ?, 1)'
      ).bind(date, start_time, end_time).run()
      targetSlotId = slotResult.meta.last_row_id
    }

    if (!targetSlotId) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Slot ID or date/time details required.', details: [] } }, 400)
    }

    let targetServiceId = service_id
    let finalPrice =
      body.price_at_booking !== undefined && body.price_at_booking !== null
        ? Math.max(0, Math.round(Number(body.price_at_booking) || 0))
        : custom_price

    if (!targetServiceId || targetServiceId === 'none' || targetServiceId === 'custom') {
      const defaultService = await c.env.DB.prepare('SELECT id, price FROM Services LIMIT 1').first<any>()
      if (defaultService) {
        targetServiceId = defaultService.id
        if (finalPrice == null) finalPrice = defaultService.price
      } else {
        targetServiceId = 1
      }
    } else if (finalPrice == null) {
      const svc = await c.env.DB.prepare('SELECT price FROM Services WHERE id = ?').bind(targetServiceId).first<any>()
      if (svc) finalPrice = svc.price
    }

    const bookingResult = await c.env.DB.prepare(
      `INSERT INTO Bookings (
        service_id, slot_id, client_name, client_email, price_at_booking, status,
        customer_phone, location, notes, attendees, deposit_paid, coupon_code, custom_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      targetServiceId || 1,
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
      custom_price
    ).run()

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

// PUT: Update an existing booking
adminRouter.put('/bookings/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()

    const existing = await c.env.DB.prepare('SELECT * FROM Bookings WHERE id = ?').bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    const rawName = body.client_name ?? body.customer_name ?? body.customer ?? body.client
    const client_name = rawName !== undefined ? String(rawName).trim() : existing.client_name

    const rawEmail = body.client_email ?? body.customer_email ?? body.email
    const client_email = rawEmail !== undefined ? String(rawEmail).trim() : existing.client_email

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

    const rawServiceId = body.service_id ?? body.packageId
    const service_id =
      rawServiceId !== undefined && rawServiceId !== 'none' && rawServiceId !== 'custom'
        ? Number(rawServiceId) || existing.service_id
        : existing.service_id

    const status = body.status !== undefined ? String(body.status).toLowerCase() : existing.status

    await c.env.DB.prepare(
      `UPDATE Bookings
       SET client_name = ?,
           client_email = ?,
           customer_phone = ?,
           location = ?,
           notes = ?,
           attendees = ?,
           deposit_paid = ?,
           coupon_code = ?,
           custom_price = ?,
           price_at_booking = ?,
           service_id = ?,
           status = ?
       WHERE id = ?`
    ).bind(
      client_name,
      client_email,
      customer_phone,
      location,
      notes,
      attendees,
      deposit_paid,
      coupon_code,
      custom_price,
      price_at_booking,
      service_id,
      status,
      id
    ).run()

    // Update associated Schedule_Slots row if date/startTime/endTime changed
    const newDate = body.date
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

    if (status === 'cancelled' && existing.slot_id) {
      await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(existing.slot_id).run()
    } else if (status !== 'cancelled' && existing.status === 'cancelled' && existing.slot_id) {
      await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ?').bind(existing.slot_id).run()
    }

    return c.json({ success: true, status: 'success' })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not update booking.', details: [] } }, 500)
  }
})

// PATCH: Cancel a booking and release slot
adminRouter.patch('/bookings/:id/cancel', async (c) => {
  try {
    const id = c.req.param('id')

    const booking = await c.env.DB.prepare('SELECT slot_id FROM Bookings WHERE id = ?').bind(id).first<{ slot_id: number }>()
    if (!booking) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    await c.env.DB.prepare("UPDATE Bookings SET status = 'cancelled' WHERE id = ?").bind(id).run()

    if (booking.slot_id) {
      await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(booking.slot_id).run()
    }

    return c.json({ success: true, status: 'success' })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not cancel booking.', details: [] } }, 500)
  }
})

// DELETE: Delete a booking
adminRouter.delete('/bookings/:id', async (c) => {
  try {
    const id = c.req.param('id')

    const booking = await c.env.DB.prepare('SELECT slot_id FROM Bookings WHERE id = ?').bind(id).first<{ slot_id: number }>()
    if (!booking) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    await c.env.DB.prepare('DELETE FROM Bookings WHERE id = ?').bind(id).run()

    if (booking.slot_id) {
      await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(booking.slot_id).run()
    }

    return c.json({ success: true, status: 'success' })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete booking.', details: [] } }, 500)
  }
})

// ── Pricing & Payments Configuration ─────────────────────────────

async function handleGetPricing(c: Context<{ Bindings: Bindings }>) {
  try {
    const row = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'pricing'"
    ).first<{ setting_value: string }>()

    const pricing = row?.setting_value ? JSON.parse(row.setting_value) : { baseFee: 0, perPerson: 0, depositPercent: 50 }
    return c.json({ ...pricing, status: 'success', data: pricing })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch pricing settings.', details: [] } }, 500)
  }
}

async function handleUpdatePricing(c: Context<{ Bindings: Bindings }>) {
  try {
    const body = await c.req.json()
    const parsedDeposit = Number(body.depositPercent)
    const depositPercent =
      Number.isFinite(parsedDeposit) && parsedDeposit >= 0 && parsedDeposit <= 100
        ? Math.round(parsedDeposit)
        : 50

    const parsedBaseFee = Number(body.baseFee)
    const baseFee = Number.isFinite(parsedBaseFee) && parsedBaseFee >= 0 ? Math.round(parsedBaseFee * 100) / 100 : 0

    const parsedPerPerson = Number(body.perPerson)
    const perPerson = Number.isFinite(parsedPerPerson) && parsedPerPerson >= 0 ? Math.round(parsedPerPerson * 100) / 100 : 0

    const cleanPricing = {
      baseFee,
      perPerson,
      depositPercent
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

    return c.json({ success: true, status: 'success', pricing: cleanPricing, data: cleanPricing })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not save pricing settings.', details: [] } }, 500)
  }
}

adminRouter.get('/pricing', handleGetPricing)
adminRouter.put('/pricing', handleUpdatePricing)
adminRouter.get('/payments/settings', handleGetPricing)
adminRouter.put('/payments/settings', handleUpdatePricing)

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
    const body = await c.req.json()

    const existing = await c.env.DB.prepare('SELECT * FROM Coupons WHERE id = ?').bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Coupon not found.', details: [] } }, 404)
    }

    const code = body.code !== undefined ? String(body.code).toUpperCase().trim() : existing.code
    const discountType = body.type || body.discount_type || existing.discount_type

    const rawDiscount = body.discount ?? body.amount ?? body.discount_value
    const discountVal = rawDiscount !== undefined ? Number(rawDiscount) : Number(existing.discount_value)

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
    const result = await c.env.DB.prepare('DELETE FROM Coupons WHERE id = ?').bind(id).run()

    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Coupon not found.', details: [] } }, 404)
    }

    return c.json({ success: true, status: 'success' })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete coupon.', details: [] } }, 500)
  }
})

// ── Profile ──────────────────────────────────────────────────────

// GET: Studio profile information
adminRouter.get('/profile', async (c) => {
  try {
    const row = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'profile'"
    ).first<{ setting_value: string }>()

    const profile = row?.setting_value ? JSON.parse(row.setting_value) : { bio: '', email: '', phone: '', location: '', travel: '', social: [] }
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

    return c.json({ success: true, status: 'success', profile: cleanProfile, data: cleanProfile })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not save profile.', details: [] } }, 500)
  }
})

// ── Leads ────────────────────────────────────────────────────────

// GET: View all contact submissions
adminRouter.get('/leads', async (c) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 100))
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)

    const { results } = await c.env.DB.prepare(
      'SELECT id, name, email, phone, session_type, message, created_at FROM Leads ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).bind(limit, offset).all()

    return c.json({ leads: results, limit, offset, status: 'success', data: results })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch leads.', details: [] } }, 500)
  }
})
