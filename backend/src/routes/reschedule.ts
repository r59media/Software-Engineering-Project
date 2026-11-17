import { Hono, type Context } from 'hono'
import type { Bindings } from '../index'
import { ensureSchemaReady } from './admin'
import { isSlotInWeeklyAvailability } from './schedule'
import { getMediaSigningSecret, getSigningSecret, getTrustedClientIp, normalizeIpBucket } from '../middleware/auth'
import {
  signRescheduleToken,
  verifyRescheduleToken,
  signCalendarFeedToken,
  verifyCalendarFeedToken
} from '../utils/signedUrl'
import {
  cancelOpenInvoice,
  getStudioTimeZone,
  loadBookingTotals,
  sendBalanceInvoice
} from '../lib/squareBilling'
import {
  addDaysISO,
  BookingPolicySettings,
  countRescheduleIdentityMatches,
  daysBetweenISO,
  DEFAULT_BOOKING_POLICY,
  DynamicFeeRule,
  evaluateDynamicFees,
  localDateTimeToRFC3339,
  normalizeBookingPolicy,
  normalizeFeeRules
} from '../lib/billingMath'
export { countRescheduleIdentityMatches }
import {
  buildBookingIcs,
  buildGoogleCalendarTemplateUrl,
  buildStudioIcsFeed,
  syncBookingToGoogleCalendarApi
} from '../lib/googleCalendar'

export const rescheduleRoutes = new Hono<{ Bindings: Bindings }>()

export { signRescheduleToken, verifyRescheduleToken, signCalendarFeedToken, verifyCalendarFeedToken }

const RESCHEDULE_RATE_WINDOW_MS = 60_000
const RESCHEDULE_RATE_MAX_ATTEMPTS = 15
const rescheduleRateAttempts = new Map<string, { count: number; windowStart: number }>()

function checkRescheduleRateLimit(c: Context<{ Bindings: Bindings }>): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  if (rescheduleRateAttempts.size > 500) {
    for (const [k, v] of rescheduleRateAttempts.entries()) {
      if (now - v.windowStart > RESCHEDULE_RATE_WINDOW_MS) {
        rescheduleRateAttempts.delete(k)
      }
    }
  }
  const bucket = normalizeIpBucket(getTrustedClientIp(c))
  const existing = rescheduleRateAttempts.get(bucket)
  if (!existing || now - existing.windowStart > RESCHEDULE_RATE_WINDOW_MS) {
    rescheduleRateAttempts.set(bucket, { count: 1, windowStart: now })
    return { allowed: true, retryAfterSeconds: 0 }
  }
  existing.count += 1
  if (existing.count > RESCHEDULE_RATE_MAX_ATTEMPTS) {
    const remainingMs = Math.max(1000, RESCHEDULE_RATE_WINDOW_MS - (now - existing.windowStart))
    return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/**
 * Counts how many of the 3 identity fields (name, email, phone) match the booking record.
 */
async function resolveSigningSecret(env: Bindings): Promise<string | null> {
  return getSigningSecret(env) || (await getMediaSigningSecret(env))
}

function getStudioCurrentDateTime(timeZone: string): { currentDate: string; currentTime: string } {
  const now = new Date()
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  }
  const parts = formatter.formatToParts(now)
  const hash: Record<string, string> = {}
  for (const p of parts) {
    hash[p.type] = p.value
  }
  const currentDate = `${hash.year}-${hash.month}-${hash.day}`
  let currentHour = hash.hour
  if (currentHour === '24') currentHour = '00'
  const currentTime = `${currentHour}:${hash.minute}`
  return { currentDate, currentTime }
}

async function loadWeeklyAvailability(db: D1Database): Promise<any[]> {
  try {
    const waRow = await db
      .prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'weekly_availability'")
      .first<{ setting_value: string }>()
    if (waRow?.setting_value) {
      const parsed = JSON.parse(waRow.setting_value)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return []
}

async function loadPricingConfig(db: D1Database): Promise<{ policy: BookingPolicySettings; feeRules: DynamicFeeRule[] }> {
  try {
    const row = await db
      .prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'pricing'")
      .first<{ setting_value: string }>()
    if (row?.setting_value) {
      const parsed = JSON.parse(row.setting_value)
      return {
        policy: normalizeBookingPolicy(parsed?.policy),
        feeRules: normalizeFeeRules(parsed?.feeRules)
      }
    }
  } catch {}
  return { policy: DEFAULT_BOOKING_POLICY, feeRules: [] }
}

async function loadAvailableSlots(db: D1Database, timeZone: string): Promise<any[]> {
  const { currentDate, currentTime } = getStudioCurrentDateTime(timeZone)
  const weeklyAvailability = await loadWeeklyAvailability(db)
  const { results } = await db
    .prepare(
      `SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots
       WHERE is_booked = 0
         AND (date > ? OR (date = ? AND start_time > ?))
         AND date NOT IN (SELECT date FROM Blocked_Dates)
       ORDER BY date ASC, start_time ASC
       LIMIT 1000`
    )
    .bind(currentDate, currentDate, currentTime)
    .all()

  return (results || []).filter((slot) => isSlotInWeeklyAvailability(slot as any, weeklyAvailability))
}

async function loadBookingWithSlot(db: D1Database, bookingId: number) {
  return db
    .prepare(
      `SELECT b.id, b.service_id, b.slot_id, b.client_name, b.client_email, b.customer_phone,
              COALESCE(NULLIF(b.event_location, ''), b.location) AS location, b.notes, b.attendees, b.price_at_booking, b.deposit_paid, b.status,
              ss.date AS slot_date, ss.start_time AS slot_start_time, ss.end_time AS slot_end_time,
              s.name AS service_name, s.title AS service_title
       FROM Bookings b
       LEFT JOIN Schedule_Slots ss ON b.slot_id = ss.id
       LEFT JOIN Services s ON b.service_id = s.id
       WHERE b.id = ?`
    )
    .bind(bookingId)
    .first<any>()
}

function scheduleNonBlocking(c: Context<{ Bindings: Bindings }>, promise: Promise<unknown>) {
  const safe = promise.catch((err) => {
    console.warn('Non-blocking calendar sync error:', err)
  })
  try {
    c.executionCtx?.waitUntil(safe)
  } catch {
    // Ignore when executionCtx is unavailable (e.g. unit tests)
  }
}

// 1. Studio-wide ICS feed for Google Calendar / Apple Calendar subscription
rescheduleRoutes.get('/calendar.ics', async (c) => {
  try {
    await ensureSchemaReady(c.env.DB)
    const token = (c.req.query('token') || '').trim()
    const secret = await resolveSigningSecret(c.env)
    if (!secret) {
      return c.text('Calendar feed signing is not configured.', 503)
    }
    if (!(await verifyCalendarFeedToken(token, secret))) {
      return c.text('Invalid or missing calendar feed token.', 401)
    }

    const timeZone = await getStudioTimeZone(c.env.DB)
    const { results: bookingRows } = await c.env.DB.prepare(
      `SELECT b.id, b.client_name, b.client_email, b.customer_phone, COALESCE(NULLIF(b.event_location, ''), b.location) AS location, b.notes,
              b.attendees, b.status, ss.date, ss.start_time, ss.end_time,
              s.name AS service_name, s.title AS service_title
       FROM Bookings b
       INNER JOIN Schedule_Slots ss ON b.slot_id = ss.id
       LEFT JOIN Services s ON b.service_id = s.id
       WHERE COALESCE(LOWER(b.status), '') != 'cancelled'
       ORDER BY ss.date ASC, ss.start_time ASC`
    ).all<any>()

    const { results: blockedRows } = await c.env.DB.prepare(
      'SELECT id, date, reason FROM Blocked_Dates ORDER BY date ASC'
    ).all<any>()

    const bookings = (bookingRows || []).map((row) => ({
      id: row.id,
      date: row.date,
      start_time: row.start_time,
      end_time: row.end_time,
      client_name: row.client_name,
      client_email: row.client_email,
      customer_phone: row.customer_phone,
      package_name: row.service_title || row.service_name,
      service_name: row.service_name,
      status: row.status,
      notes: row.notes,
      location: row.location,
      attendees: row.attendees
    }))

    const ics = buildStudioIcsFeed(bookings, blockedRows || [], timeZone)
    return new Response(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="r59-studio-bookings.ics"',
        'Cache-Control': 'no-store'
      }
    })
  } catch (err) {
    console.error('Failed to generate studio ICS feed:', err)
    return c.text('Failed to generate calendar feed.', 500)
  }
})

async function buildReschedulePayload(
  c: Context<{ Bindings: Bindings }>,
  booking: any,
  token: string
) {
  const timeZone = await getStudioTimeZone(c.env.DB)
  const { policy, feeRules } = await loadPricingConfig(c.env.DB)
  const cutoffDays = policy.rescheduleCutoffDays
  const { currentDate } = getStudioCurrentDateTime(timeZone)
  const daysUntilSession = booking.slot_date ? daysBetweenISO(currentDate, booking.slot_date) : null
  const withinCutoff = daysUntilSession !== null && daysUntilSession < cutoffDays
  const isCancelled = String(booking.status || '').trim().toLowerCase() === 'cancelled'
  const rescheduleAllowed = !isCancelled && !withinCutoff
  const rescheduleRules = feeRules.filter((r) => r.triggerType === 'reschedule')
  const rescheduleFeeEval = evaluateDynamicFees(rescheduleRules, {
    subtotalCents: Number(booking.price_at_booking) || 0,
    sessionDate: booking.slot_date || currentDate,
    todayDate: currentDate,
    timeZone,
    attendees: Number(booking.attendees) || 1,
    isReschedule: true
  })
  const rescheduleFeeCents = rescheduleFeeEval.totalFeeCents
  const rescheduleFeeItems = rescheduleFeeEval.appliedFees
  const slots = rescheduleAllowed ? await loadAvailableSlots(c.env.DB, timeZone) : []
  const origin = new URL(c.req.url).origin
  const rescheduleUrl = `${origin}/reschedule?booking=${booking.id}&token=${encodeURIComponent(token)}`
  const icsUrl = `${origin}/api/bookings/${booking.id}/calendar.ics?token=${encodeURIComponent(token)}`
  const googleCalendarUrl = booking.slot_date
    ? buildGoogleCalendarTemplateUrl(
        {
          id: booking.id,
          date: booking.slot_date,
          start_time: booking.slot_start_time,
          end_time: booking.slot_end_time,
          client_name: booking.client_name,
          client_email: booking.client_email,
          customer_phone: booking.customer_phone,
          package_name: booking.service_title || booking.service_name,
          service_name: booking.service_name,
          status: booking.status,
          location: booking.location,
          attendees: booking.attendees,
          timeZone
        },
        rescheduleUrl
      )
    : ''

  const summary = {
    id: booking.id,
    slot_id: booking.slot_id,
    date: booking.slot_date,
    start_time: booking.slot_start_time,
    end_time: booking.slot_end_time,
    client_name: booking.client_name,
    client_email: booking.client_email,
    package_name: booking.service_title || booking.service_name || 'Photography Session',
    status: booking.status,
    can_reschedule: rescheduleAllowed,
    rescheduleAllowed,
    cutoffDays,
    reschedule_url: rescheduleUrl,
    ics_url: icsUrl,
    google_calendar_url: googleCalendarUrl
  }

  return {
    status: 'success',
    bookingId: booking.id,
    token,
    booking: summary,
    slots,
    timezone: timeZone,
    rescheduleAllowed,
    cutoffDays,
    rescheduleFeeCents,
    rescheduleFeeItems,
    data: {
      bookingId: booking.id,
      token,
      booking: summary,
      slots,
      timezone: timeZone,
      rescheduleAllowed,
      cutoffDays,
      rescheduleFeeCents,
      rescheduleFeeItems
    }
  }
}

// 2a. Unlock / lookup booking for client self-service rescheduling (requires 2-of-3 identity match)
rescheduleRoutes.post('/reschedule/unlock', async (c) => {
  try {
    const rateLimit = checkRescheduleRateLimit(c)
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds))
      return c.json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many verification attempts. Please wait 1 minute before trying again.',
          details: []
        }
      }, 429)
    }

    await ensureSchemaReady(c.env.DB)
    const secret = await resolveSigningSecret(c.env)
    if (!secret) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Reschedule signing is not configured.', details: [] } }, 503)
    }

    const body = await c.req.json().catch(() => ({} as any))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
    const rawBookingId = body?.bookingId !== undefined ? body.bookingId : body?.booking_id
    const parsedBookingId =
      typeof rawBookingId === 'number' && Number.isInteger(rawBookingId)
        ? rawBookingId
        : typeof rawBookingId === 'string' && /^[1-9]\d*$/.test(rawBookingId.trim())
          ? parseInt(rawBookingId.trim(), 10)
          : 0
    const token = typeof body?.token === 'string' ? body.token.trim() : ''

    if (parsedBookingId > 0 && token) {
      const booking = await loadBookingWithSlot(c.env.DB, parsedBookingId)
      if (!booking) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
      }
      if (!(await verifyRescheduleToken(booking.id, booking.client_email, token, secret))) {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired reschedule token.', details: [] } }, 401)
      }
      if (countRescheduleIdentityMatches(booking, { name, email, phone }) < 2) {
        return c.json({
          error: {
            code: 'VERIFICATION_FAILED',
            message: 'Verification failed. Please match at least 2 of your Name, Email, and Phone Number.',
            details: []
          }
        }, 403)
      }
      const payload = await buildReschedulePayload(c, booking, token)
      c.header('Cache-Control', 'no-store')
      return c.json(payload)
    }

    const providedCount = [name, email, phone].filter((v) => v.length > 0).length
    if (providedCount < 2) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Please provide at least 2 of your Name, Email, and Phone Number.',
          details: []
        }
      }, 400)
    }

    const identityInput = { name, email, phone }
    let matchedBooking: any = null

    if (email) {
      const { results: emailRows } = await c.env.DB.prepare(
        `SELECT b.id, b.service_id, b.slot_id, b.client_name, b.client_email, b.customer_phone,
                COALESCE(NULLIF(b.event_location, ''), b.location) AS location, b.notes, b.attendees, b.price_at_booking, b.deposit_paid, b.status,
                ss.date AS slot_date, ss.start_time AS slot_start_time, ss.end_time AS slot_end_time,
                s.name AS service_name, s.title AS service_title
         FROM Bookings b
         LEFT JOIN Schedule_Slots ss ON b.slot_id = ss.id
         LEFT JOIN Services s ON b.service_id = s.id
         WHERE COALESCE(LOWER(TRIM(b.status)), '') != 'cancelled'
           AND LOWER(TRIM(b.client_email)) = ?
         ORDER BY b.id DESC
         LIMIT 50`
      )
        .bind(email.toLowerCase())
        .all<any>()

      matchedBooking = (emailRows || []).find(
        (row) => countRescheduleIdentityMatches(row, identityInput) >= 2
      ) || null
    }

    if (!matchedBooking) {
      const { results: recentRows } = await c.env.DB.prepare(
        `SELECT b.id, b.service_id, b.slot_id, b.client_name, b.client_email, b.customer_phone,
                COALESCE(NULLIF(b.event_location, ''), b.location) AS location, b.notes, b.attendees, b.price_at_booking, b.deposit_paid, b.status,
                ss.date AS slot_date, ss.start_time AS slot_start_time, ss.end_time AS slot_end_time,
                s.name AS service_name, s.title AS service_title
         FROM Bookings b
         LEFT JOIN Schedule_Slots ss ON b.slot_id = ss.id
         LEFT JOIN Services s ON b.service_id = s.id
         WHERE COALESCE(LOWER(TRIM(b.status)), '') != 'cancelled'
         ORDER BY b.id DESC
         LIMIT 500`
      ).all<any>()

      matchedBooking = (recentRows || []).find(
        (row) => countRescheduleIdentityMatches(row, identityInput) >= 2
      ) || null
    }

    if (!matchedBooking) {
      return c.json({
        error: {
          code: 'NOT_FOUND',
          message: 'No matching booking found. Please verify at least 2 of your Name, Email, and Phone Number.',
          details: []
        }
      }, 404)
    }

    const signedToken = await signRescheduleToken(matchedBooking.id, matchedBooking.client_email, secret)
    const payload = await buildReschedulePayload(c, matchedBooking, signedToken)
    c.header('Cache-Control', 'no-store')
    return c.json(payload)
  } catch (err) {
    console.error('POST reschedule unlock error:', err)
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not verify booking details.', details: [] } }, 500)
  }
})

// 2. Get booking summary + available slots for client self-service rescheduling
rescheduleRoutes.get('/:id/reschedule', async (c) => {
  try {
    const name = (c.req.query('name') || '').trim()
    const email = (c.req.query('email') || '').trim()
    const phone = (c.req.query('phone') || '').trim()

    if (name || email || phone) {
      const rateLimit = checkRescheduleRateLimit(c)
      if (!rateLimit.allowed) {
        c.header('Retry-After', String(rateLimit.retryAfterSeconds))
        return c.json({
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many verification attempts. Please wait 1 minute before trying again.',
            details: []
          }
        }, 429)
      }
    }

    await ensureSchemaReady(c.env.DB)
    const bookingId = Number(c.req.param('id'))
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid booking id.', details: [] } }, 400)
    }

    const token = (c.req.query('token') || '').trim()
    const secret = await resolveSigningSecret(c.env)
    if (!secret) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Reschedule signing is not configured.', details: [] } }, 503)
    }

    const booking = await loadBookingWithSlot(c.env.DB, bookingId)
    if (!booking) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    if (!(await verifyRescheduleToken(booking.id, booking.client_email, token, secret))) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired reschedule token.', details: [] } }, 401)
    }

    if ((!name && !email && !phone) || countRescheduleIdentityMatches(booking, { name, email, phone }) < 2) {
      c.header('Cache-Control', 'no-store')
      return c.json({
        status: 'success',
        requiresVerification: true,
        id: booking.id,
        serviceName: booking.service_title || booking.service_name || 'Photography Session'
      })
    }

    const payload = await buildReschedulePayload(c, booking, token)
    c.header('Cache-Control', 'no-store')
    return c.json(payload)
  } catch (err) {
    console.error('GET reschedule error:', err)
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not load reschedule details.', details: [] } }, 500)
  }
})

// 3. Reschedule a booking to a new available slot
rescheduleRoutes.post('/:id/reschedule', async (c) => {
  try {
    const rateLimit = checkRescheduleRateLimit(c)
    if (!rateLimit.allowed) {
      c.header('Retry-After', String(rateLimit.retryAfterSeconds))
      return c.json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many verification attempts. Please wait 1 minute before trying again.',
          details: []
        }
      }, 429)
    }

    await ensureSchemaReady(c.env.DB)
    const bookingId = Number(c.req.param('id'))
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid booking id.', details: [] } }, 400)
    }

    const body = await c.req.json().catch(() => ({} as any))
    const token = String(body?.token ?? c.req.query('token') ?? '').trim()
    const verifyName = typeof (body?.verifyName ?? body?.name) === 'string' ? String(body?.verifyName ?? body?.name).trim() : ''
    const verifyEmail = typeof (body?.verifyEmail ?? body?.email) === 'string' ? String(body?.verifyEmail ?? body?.email).trim() : ''
    const verifyPhone = typeof (body?.verifyPhone ?? body?.phone) === 'string' ? String(body?.verifyPhone ?? body?.phone).trim() : ''
    const rawSlotId = body?.slot_id !== undefined ? body.slot_id : body?.slotId
    const newSlotId =
      typeof rawSlotId === 'number' && Number.isInteger(rawSlotId)
        ? rawSlotId
        : typeof rawSlotId === 'string' && /^[1-9]\d*$/.test(rawSlotId.trim())
          ? parseInt(rawSlotId.trim(), 10)
          : 0

    if (!newSlotId || newSlotId <= 0) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'A valid slot_id is required.', details: [] } }, 400)
    }

    const secret = await resolveSigningSecret(c.env)
    if (!secret) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Reschedule signing is not configured.', details: [] } }, 503)
    }

    const booking = await loadBookingWithSlot(c.env.DB, bookingId)
    if (!booking) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404)
    }

    if (!(await verifyRescheduleToken(booking.id, booking.client_email, token, secret))) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired reschedule token.', details: [] } }, 401)
    }

    if (countRescheduleIdentityMatches(booking, { name: verifyName, email: verifyEmail, phone: verifyPhone }) < 2) {
      return c.json({
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'Identity verification failed. Please verify at least 2 of your Name, Email, and Phone Number.',
          details: []
        }
      }, 403)
    }

    if (String(booking.status || '').trim().toLowerCase() === 'cancelled') {
      return c.json({ error: { code: 'BOOKING_CANCELLED', message: 'Cancelled bookings cannot be rescheduled.', details: [] } }, 409)
    }

    const timeZone = await getStudioTimeZone(c.env.DB)
    const { policy, feeRules } = await loadPricingConfig(c.env.DB)
    const cutoffDays = policy.rescheduleCutoffDays
    const { currentDate, currentTime } = getStudioCurrentDateTime(timeZone)
    const daysUntilSession = booking.slot_date ? daysBetweenISO(currentDate, booking.slot_date) : null
    if (daysUntilSession !== null && daysUntilSession < cutoffDays) {
      return c.json({
        error: {
          code: 'RESCHEDULE_WINDOW_CLOSED',
          message: `Rescheduling is closed within ${cutoffDays} day${cutoffDays === 1 ? '' : 's'} of the session date.`,
          details: [{ cutoffDays, rescheduleAllowed: false }]
        }
      }, 403)
    }

    if (booking.slot_id === newSlotId) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Please select a different timeslot.', details: [] } }, 400)
    }

    const targetSlot = await c.env.DB.prepare(
      'SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots WHERE id = ?'
    )
      .bind(newSlotId)
      .first<any>()

    if (!targetSlot) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Selected timeslot does not exist.', details: [] } }, 404)
    }

    if (targetSlot.date < currentDate || (targetSlot.date === currentDate && targetSlot.start_time <= currentTime)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Selected timeslot is in the past.', details: [] } }, 400)
    }

    const weeklyAvailability = await loadWeeklyAvailability(c.env.DB)
    if (!isSlotInWeeklyAvailability(targetSlot, weeklyAvailability)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Selected timeslot is outside studio weekly availability.', details: [] } }, 400)
    }

    // Atomically lock the new slot
    const lockRes = await c.env.DB.prepare(
      'UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ? AND is_booked = 0 AND date NOT IN (SELECT date FROM Blocked_Dates)'
    )
      .bind(newSlotId)
      .run()

    if (!lockRes.success || lockRes.meta.changes === 0) {
      return c.json({ error: { code: 'SLOT_UNAVAILABLE', message: 'The selected timeslot is no longer available.', details: [] } }, 409)
    }

    const oldSlotId = booking.slot_id
    try {
      await c.env.DB.prepare('UPDATE Bookings SET slot_id = ? WHERE id = ?').bind(newSlotId, booking.id).run()
      if (oldSlotId && oldSlotId !== newSlotId) {
        await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(oldSlotId).run()
      }
    } catch (dbErr) {
      // Rollback new slot lock on failure
      await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(newSlotId).run().catch(() => {})
      throw dbErr
    }

    // Evaluate active 'reschedule' fee rules server-side and record into Booking_Charges
    const rescheduleRules = feeRules.filter((r) => r.triggerType === 'reschedule')
    const rescheduleFeeEval = evaluateDynamicFees(rescheduleRules, {
      subtotalCents: Number(booking.price_at_booking) || 0,
      sessionDate: targetSlot.date,
      todayDate: currentDate,
      timeZone,
      attendees: Number(booking.attendees) || 1,
      isReschedule: true
    })
    const rescheduleFeeCents = rescheduleFeeEval.totalFeeCents
    const rescheduleFeeItems = rescheduleFeeEval.appliedFees

    if (rescheduleFeeCents > 0) {
      for (const fee of rescheduleFeeItems) {
        if (fee.amountCents > 0) {
          const desc = String(fee.name || 'Reschedule Fee').trim().slice(0, 120) || 'Reschedule Fee'
          await c.env.DB.prepare(
            'INSERT INTO Booking_Charges (booking_id, description, amount_cents) VALUES (?, ?, ?)'
          )
            .bind(booking.id, desc, fee.amountCents)
            .run()
        }
      }
    }

    // Cancel any open/scheduled Square invoice for the old date and re-schedule for the new date
    try {
      await cancelOpenInvoice(c.env.DB, c.env, booking.id)
    } catch (cancelErr) {
      console.warn('Reschedule: could not cancel previous open invoice:', cancelErr)
    }

    try {
      const totalsResult = await loadBookingTotals(c.env.DB, booking.id)
      const balanceCents = totalsResult?.totals?.balance_cents ?? 0
      if (balanceCents > 0) {
        const scheduledAt = localDateTimeToRFC3339(targetSlot.date, targetSlot.start_time, timeZone)
        const dueDateOverride = addDaysISO(targetSlot.date, policy.balanceDueDaysAfterEvent)
        await sendBalanceInvoice(
          c.env.DB,
          c.env,
          booking.id,
          balanceCents,
          {
            ...(scheduledAt ? { scheduledAt } : {}),
            dueDateOverride
          }
        )
      }
    } catch (invoiceErr) {
      console.warn('Reschedule: could not schedule updated balance invoice:', invoiceErr)
    }

    const origin = new URL(c.req.url).origin
    const rescheduleUrl = `${origin}/reschedule?booking=${booking.id}&token=${encodeURIComponent(token)}`
    const icsUrl = `${origin}/api/bookings/${booking.id}/calendar.ics?token=${encodeURIComponent(token)}`
    const calendarInput = {
      id: booking.id,
      date: targetSlot.date,
      start_time: targetSlot.start_time,
      end_time: targetSlot.end_time,
      client_name: booking.client_name,
      client_email: booking.client_email,
      customer_phone: booking.customer_phone,
      package_name: booking.service_title || booking.service_name,
      service_name: booking.service_name,
      status: booking.status,
      notes: booking.notes,
      location: booking.location,
      attendees: booking.attendees,
      timeZone
    }
    const googleCalendarUrl = buildGoogleCalendarTemplateUrl(calendarInput, rescheduleUrl)

    scheduleNonBlocking(c, syncBookingToGoogleCalendarApi(c.env, calendarInput, 'upsert'))

    const updatedBooking = {
      id: booking.id,
      slot_id: newSlotId,
      date: targetSlot.date,
      start_time: targetSlot.start_time,
      end_time: targetSlot.end_time,
      client_name: booking.client_name,
      client_email: booking.client_email,
      package_name: booking.service_title || booking.service_name || 'Photography Session',
      status: booking.status,
      reschedule_url: rescheduleUrl,
      ics_url: icsUrl,
      google_calendar_url: googleCalendarUrl
    }

    return c.json({
      status: 'success',
      booking: updatedBooking,
      rescheduleFeeCents,
      rescheduleFeeItems,
      data: updatedBooking
    })
  } catch (err) {
    console.error('POST reschedule error:', err)
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to reschedule booking.', details: [] } }, 500)
  }
})

// 4. Single-booking ICS download
rescheduleRoutes.get('/:id/calendar.ics', async (c) => {
  try {
    await ensureSchemaReady(c.env.DB)
    const bookingId = Number(c.req.param('id'))
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return c.text('Invalid booking id.', 400)
    }

    const token = (c.req.query('token') || '').trim()
    const secret = await resolveSigningSecret(c.env)
    if (!secret) {
      return c.text('Calendar signing is not configured.', 503)
    }

    const booking = await loadBookingWithSlot(c.env.DB, bookingId)
    if (!booking || !booking.slot_date) {
      return c.text('Booking not found.', 404)
    }

    if (!(await verifyRescheduleToken(booking.id, booking.client_email, token, secret))) {
      return c.text('Invalid or expired calendar token.', 401)
    }

    const timeZone = await getStudioTimeZone(c.env.DB)
    const origin = new URL(c.req.url).origin
    const rescheduleUrl = `${origin}/reschedule?booking=${booking.id}&token=${encodeURIComponent(token)}`

    const ics = buildBookingIcs(
      {
        id: booking.id,
        date: booking.slot_date,
        start_time: booking.slot_start_time,
        end_time: booking.slot_end_time,
        client_name: booking.client_name,
        client_email: booking.client_email,
        customer_phone: booking.customer_phone,
        package_name: booking.service_title || booking.service_name,
        service_name: booking.service_name,
        status: booking.status,
        notes: booking.notes,
        location: booking.location,
        attendees: booking.attendees
      },
      rescheduleUrl,
      timeZone
    )

    return new Response(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="r59-booking-${booking.id}.ics"`,
        'Cache-Control': 'no-store'
      }
    })
  } catch (err) {
    console.error('GET single booking ICS error:', err)
    return c.text('Failed to generate calendar file.', 500)
  }
})
