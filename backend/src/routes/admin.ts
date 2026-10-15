import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth, timingSafeEqual, createSessionToken } from '../middleware/auth'

export const adminRouter = new Hono<{ Bindings: Bindings }>()

// In-memory sliding window rate limiter for admin login: IP -> { attempts, resetAt }
const loginAttempts = new Map<string, { attempts: number; resetAt: number }>()

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { attempts: 1, resetAt: now + 60 * 1000 })
    return true
  }
  if (entry.attempts >= 5) {
    return false
  }
  entry.attempts++
  return true
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

    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'default'
    if (!checkLoginRateLimit(clientIp)) {
      return c.json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many login attempts. Please wait 1 minute before trying again.',
          details: []
        }
      }, 429)
    }

    const body = await c.req.json().catch(() => ({}))
    const email = (body.email || '').trim().toLowerCase()
    const password = typeof body.password === 'string' ? body.password : ''

    // Both email and password must be non-empty
    if (!email || !password) {
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
    const token = await createSessionToken(signingSecret, email)

    return c.json({
      success: true,
      token,
      email: expectedEmail
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

// All subsequent admin routes require valid admin authentication
adminRouter.use('*', adminAuth)

// Session verification endpoint for frontend startup and route guards
adminRouter.get('/verify', async (c) => {
  const expectedEmail = (c.env.ADMIN_EMAIL || 'r59mediatesting@gmail.com').trim().toLowerCase()
  return c.json({
    authenticated: true,
    email: expectedEmail
  })
})

// ── Schedule Management ──────────────────────────────────────────

// GET: View all schedule slots (admin calendar)
adminRouter.get('/schedule', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots ORDER BY date ASC, start_time ASC'
    ).all()

    return c.json({ slots: results })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch schedule slots.', details: [] } }, 500)
  }
})

// POST: Add a new available timeslot
adminRouter.post('/schedule', async (c) => {
  try {
    const body = await c.req.json()
    const { date, start_time, end_time } = body

    const errors = []
    if (!date) errors.push({ field: 'date', message: 'Date is required (YYYY-MM-DD).', code: 'REQUIRED_FIELD' })
    if (!start_time) errors.push({ field: 'start_time', message: 'Start time is required (HH:MM).', code: 'REQUIRED_FIELD' })
    if (!end_time) errors.push({ field: 'end_time', message: 'End time is required (HH:MM).', code: 'REQUIRED_FIELD' })

    if (errors.length > 0) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not create slot.', details: errors } }, 400)
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO Schedule_Slots (date, start_time, end_time) VALUES (?, ?, ?)'
    ).bind(date, start_time, end_time).run()

    return c.json({ success: true, id: result.meta.last_row_id })
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

    return c.json({ success: true })
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
    return c.json({ availability })
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

    return c.json({ success: true, availability: cleanAvailability })
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

    return c.json({ blockedDates: results })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch blocked dates.', details: [] } }, 500)
  }
})

// POST: Add a blocked date
adminRouter.post('/blocked-dates', async (c) => {
  try {
    const body = await c.req.json()
    const { date, reason = '' } = body

    if (!date) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Date is required.', details: [] } }, 400)
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO Blocked_Dates (date, reason) VALUES (?, ?)'
    ).bind(date, reason).run()

    return c.json({ success: true, id: result.meta.last_row_id })
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

    return c.json({ success: true })
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
              s.name as service_name, sl.date, sl.start_time, sl.end_time
       FROM Bookings b
       LEFT JOIN Services s ON b.service_id = s.id
       LEFT JOIN Schedule_Slots sl ON b.slot_id = sl.id
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all()

    return c.json({ bookings: results, limit, offset })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch bookings.', details: [] } }, 500)
  }
})

// POST: Create a manual booking (admin)
adminRouter.post('/bookings', async (c) => {
  try {
    const body = await c.req.json()
    const { client_name, client_email, service_id, slot_id, price_at_booking, status = 'confirmed', date, start_time, end_time } = body

    if (!client_name || !client_email) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Client name and email are required.', details: [] } }, 400)
    }

    let targetSlotId = slot_id

    // If slot details provided without slot_id, create slot
    if (!targetSlotId && date && start_time && end_time) {
      const slotResult = await c.env.DB.prepare(
        'INSERT INTO Schedule_Slots (date, start_time, end_time, is_booked) VALUES (?, ?, ?, 1)'
      ).bind(date, start_time, end_time).run()
      targetSlotId = slotResult.meta.last_row_id
    }

    if (!targetSlotId) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Slot ID or date/time details required.', details: [] } }, 400)
    }

    let targetServiceId = service_id
    let finalPrice = price_at_booking

    if (!targetServiceId) {
      const defaultService = await c.env.DB.prepare('SELECT id, price FROM Services LIMIT 1').first<any>()
      if (defaultService) {
        targetServiceId = defaultService.id
        if (finalPrice == null) finalPrice = defaultService.price
      }
    }

    // Mark slot booked
    await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ?').bind(targetSlotId).run()

    const bookingResult = await c.env.DB.prepare(
      'INSERT INTO Bookings (service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(targetServiceId || 1, targetSlotId, client_name, client_email, finalPrice || 0, status).run()

    return c.json({ success: true, id: bookingResult.meta.last_row_id })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not create booking.', details: [] } }, 500)
  }
})

// PUT: Update an existing booking
adminRouter.put('/bookings/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { client_name, client_email, status, price_at_booking, service_id } = body

    const result = await c.env.DB.prepare(
      'UPDATE Bookings SET client_name = COALESCE(?, client_name), client_email = COALESCE(?, client_email), status = COALESCE(?, status), price_at_booking = COALESCE(?, price_at_booking), service_id = COALESCE(?, service_id) WHERE id = ?'
    ).bind(client_name || null, client_email || null, status || null, price_at_booking ?? null, service_id ?? null, id).run()

    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    if (status === 'cancelled') {
      const booking = await c.env.DB.prepare('SELECT slot_id FROM Bookings WHERE id = ?').bind(id).first<{ slot_id: number }>()
      if (booking?.slot_id) {
        await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(booking.slot_id).run()
      }
    }

    return c.json({ success: true })
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

    return c.json({ success: true })
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

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete booking.', details: [] } }, 500)
  }
})

// ── Pricing Configuration ────────────────────────────────────────

// GET: Global pricing settings
adminRouter.get('/pricing', async (c) => {
  try {
    const row = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'pricing'"
    ).first<{ setting_value: string }>()

    const pricing = row?.setting_value ? JSON.parse(row.setting_value) : { baseFee: 0, perPerson: 0, depositPercent: 50 }
    return c.json(pricing)
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch pricing settings.', details: [] } }, 500)
  }
})

// PUT: Save global pricing settings
adminRouter.put('/pricing', async (c) => {
  try {
    const body = await c.req.json()
    const cleanPricing = {
      baseFee: Math.max(0, parseInt(body.baseFee, 10) || 0),
      perPerson: Math.max(0, parseInt(body.perPerson, 10) || 0),
      depositPercent: Math.min(100, Math.max(0, parseInt(body.depositPercent, 10) || 50))
    }
    const val = JSON.stringify(cleanPricing)

    await c.env.DB.prepare(
      "INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('pricing', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value"
    ).bind(val).run()

    return c.json({ success: true, pricing: cleanPricing })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not save pricing settings.', details: [] } }, 500)
  }
})

// ── Coupons ──────────────────────────────────────────────────────

// GET: List coupons
adminRouter.get('/coupons', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, code, discount_type, discount_value, is_active FROM Coupons ORDER BY id DESC'
    ).all()

    const coupons = results.map((r: any) => ({
      id: r.id,
      code: r.code,
      type: r.discount_type,
      discount: r.discount_value,
      discount_type: r.discount_type,
      discount_value: r.discount_value,
      active: r.is_active === 1,
      is_active: r.is_active
    }))

    return c.json({ coupons })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch coupons.', details: [] } }, 500)
  }
})

// POST: Create coupon
adminRouter.post('/coupons', async (c) => {
  try {
    const body = await c.req.json()
    const code = body.code
    const discountType = body.type || body.discount_type || 'percent'
    const discountValue = body.discount != null ? body.discount : body.discount_value
    const isActive = body.active !== undefined ? (body.active ? 1 : 0) : (body.is_active !== undefined ? body.is_active : 1)

    if (!code || discountValue == null) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Coupon code and discount amount are required.', details: [] } }, 400)
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO Coupons (code, discount_type, discount_value, is_active) VALUES (?, ?, ?, ?)'
    ).bind(code.toUpperCase().trim(), discountType, discountValue, isActive).run()

    return c.json({ success: true, id: result.meta.last_row_id })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not create coupon.', details: [] } }, 500)
  }
})

// PUT: Update coupon
adminRouter.put('/coupons/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const code = body.code
    const discountType = body.type || body.discount_type
    const discountValue = body.discount != null ? body.discount : body.discount_value
    const isActive = body.active !== undefined ? (body.active ? 1 : 0) : (body.is_active !== undefined ? body.is_active : null)

    const result = await c.env.DB.prepare(
      'UPDATE Coupons SET code = COALESCE(?, code), discount_type = COALESCE(?, discount_type), discount_value = COALESCE(?, discount_value), is_active = COALESCE(?, is_active) WHERE id = ?'
    ).bind(code ? code.toUpperCase().trim() : null, discountType || null, discountValue ?? null, isActive ?? null, id).run()

    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Coupon not found.', details: [] } }, 404)
    }

    return c.json({ success: true })
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

    return c.json({ success: true })
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
    return c.json(profile)
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

    return c.json({ success: true, profile: cleanProfile })
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

    return c.json({ leads: results, limit, offset })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch leads.', details: [] } }, 500)
  }
})
