import { Hono, type Context } from 'hono'
import type { Bindings } from '../index'
import { ensureSchemaReady } from './admin'
import {
  computeSessionEndTime,
  getBufferMinutesFromRules,
  getStudioCurrentDateTime,
  isSlotInPast,
  isSlotInWeeklyAvailability,
  loadWeeklyAvailability,
  lockSlotsAtomically,
  queryAvailableSlots,
  releaseBookingSlots,
  resolveBookingSlotIds,
  resolveSlotWindow,
  type SlotRowLike
} from '../lib/scheduleSync'
import { getMediaSigningSecret, getSigningSecret } from '../middleware/auth'
import { enforceRouteRateLimit } from '../middleware/rateLimit'
import { parseJsonObject } from '../utils/validation'
import {
  signRescheduleToken,
  verifyRescheduleToken,
  signCalendarFeedToken,
  verifyCalendarFeedToken,
  getCalendarFeedVersion
} from '../utils/signedUrl'
import {
  BillingError,
  cancelOpenInvoice,
  getStudioTimeZone,
  loadBookingTotals,
  sendBalanceInvoice
} from '../lib/squareBilling'
import {
  addDaysISO,
  type BookingPolicySettings,
  countRescheduleIdentityMatches,
  daysBetweenISO,
  DEFAULT_BOOKING_POLICY,
  type DynamicFeeRule,
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
  mapRowToCalendarBooking,
  syncBookingToGoogleCalendarApi
} from '../lib/googleCalendar'

export const rescheduleRoutes = new Hono<{ Bindings: Bindings }>()

rescheduleRoutes.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

export { signRescheduleToken, verifyRescheduleToken, signCalendarFeedToken, verifyCalendarFeedToken }

const RESCHEDULE_RATE_WINDOW_SECONDS = 60
const RESCHEDULE_RATE_MAX_ATTEMPTS = 15

async function enforceRescheduleRateLimit(c: Context<{ Bindings: Bindings }>): Promise<Response | null> {
  return enforceRouteRateLimit(c, {
    prefix: 'reschedule',
    maxRequests: RESCHEDULE_RATE_MAX_ATTEMPTS,
    windowSeconds: RESCHEDULE_RATE_WINDOW_SECONDS,
    message: 'Too many verification attempts. Please wait 1 minute before trying again.'
  })
}

async function resolveSigningSecret(env: Bindings): Promise<string | null> {
  return getSigningSecret(env) || (await getMediaSigningSecret(env))
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

async function loadAvailableSlots(
  db: D1Database,
  timeZone: string,
  booking?: {
    id?: number
    slot_id?: number | null
    service_id?: number | null
    duration_minutes?: number | null
    full_day?: number | boolean | null
  }
): Promise<SlotRowLike[]> {
  let durationMinutes = Number(booking?.duration_minutes) > 0 ? Number(booking!.duration_minutes) : 60
  let fullDay = booking?.full_day === true || Number(booking?.full_day) === 1
  if (booking?.service_id && (booking.duration_minutes === undefined || booking.full_day === undefined)) {
    const svc = await db
      .prepare('SELECT duration_minutes, full_day FROM Services WHERE id = ?')
      .bind(booking.service_id)
      .first<{ duration_minutes: number | null; full_day: number | boolean | null }>()
    if (svc) {
      if (Number(svc.duration_minutes) > 0) durationMinutes = Number(svc.duration_minutes)
      fullDay = svc.full_day === true || Number(svc.full_day) === 1
    }
  }

  let exemptSlotIds: number[] = []
  if (booking?.id) {
    const { slotIds: oldSlotIds, protectedOtherSlotIds } = await resolveBookingSlotIds(db, {
      bookingId: booking.id,
      slotId: booking.slot_id ?? null,
      serviceId: booking.service_id ?? null,
      durationMinutes,
      fullDay
    })
    const protectedSet = new Set<number>(protectedOtherSlotIds)
    exemptSlotIds = oldSlotIds.filter((id) => !protectedSet.has(id))
  }

  return queryAvailableSlots(db, {
    timeZone,
    durationMinutes,
    fullDay,
    exemptSlotIds,
    excludeSlotIds: booking?.slot_id ? [booking.slot_id] : []
  })
}

async function loadBookingWithSlot(db: D1Database, bookingId: number) {
  return db
    .prepare(
      `SELECT b.id, b.service_id, b.slot_id, b.client_name, b.client_email, b.customer_phone,
              COALESCE(NULLIF(b.event_location, ''), b.location) AS location, b.notes, b.attendees, b.price_at_booking, b.deposit_paid, b.status,
              ss.date AS slot_date, ss.start_time AS slot_start_time, ss.end_time AS slot_end_time,
              s.name AS service_name, s.duration_minutes, s.full_day
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

function buildBookingCalendarLinks(
  c: Context<{ Bindings: Bindings }>,
  bookingId: number,
  token: string
): { rescheduleUrl: string; icsUrl: string } {
  const origin = (c.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '') || new URL(c.req.url).origin
  return {
    rescheduleUrl: `${origin}/reschedule?booking=${bookingId}&token=${encodeURIComponent(token)}`,
    icsUrl: `${origin}/api/bookings/${bookingId}/calendar.ics?token=${encodeURIComponent(token)}`
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
    const feedVersion = await getCalendarFeedVersion(c.env.DB)
    if (!(await verifyCalendarFeedToken(token, secret, feedVersion))) {
      return c.text('Invalid or missing calendar feed token.', 401)
    }

    const timeZone = await getStudioTimeZone(c.env.DB)
    const { currentDate } = getStudioCurrentDateTime(timeZone)
    const minFeedDate = addDaysISO(currentDate, -90)

    const { results: bookingRows } = await c.env.DB.prepare(
      `SELECT b.id, b.client_name, b.client_email, b.customer_phone, COALESCE(NULLIF(b.event_location, ''), b.location) AS location, b.notes,
              b.attendees, b.status, ss.date, ss.start_time, ss.end_time,
              s.name AS service_name
       FROM Bookings b
       INNER JOIN Schedule_Slots ss ON b.slot_id = ss.id
       LEFT JOIN Services s ON b.service_id = s.id
       WHERE COALESCE(LOWER(b.status), '') != 'cancelled'
         AND ss.date >= ?
       ORDER BY ss.date ASC, ss.start_time ASC`
    )
      .bind(minFeedDate)
      .all<any>()

    const { results: blockedRows } = await c.env.DB.prepare(
      'SELECT id, date, reason FROM Blocked_Dates WHERE date >= ? ORDER BY date ASC'
    )
      .bind(minFeedDate)
      .all<any>()

    const bookings = (bookingRows || []).map((row) => mapRowToCalendarBooking(row, timeZone))

    const ics = buildStudioIcsFeed(bookings, blockedRows || [], timeZone, (c.env.GOOGLE_CALENDAR_ID || '').trim())
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
  const slots = rescheduleAllowed ? await loadAvailableSlots(c.env.DB, timeZone, booking) : []
  const { rescheduleUrl, icsUrl } = buildBookingCalendarLinks(c, booking.id, token)
  const googleCalendarUrl = booking.slot_date
    ? buildGoogleCalendarTemplateUrl(
        mapRowToCalendarBooking(
          { ...booking, date: booking.slot_date, start_time: booking.slot_start_time, end_time: booking.slot_end_time },
          timeZone
        ),
        rescheduleUrl,
        (c.env.GOOGLE_CALENDAR_ID || '').trim()
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
    package_name: booking.service_name || 'Photography Session',
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
    const limited = await enforceRescheduleRateLimit(c)
    if (limited) return limited

    await ensureSchemaReady(c.env.DB)
    const secret = await resolveSigningSecret(c.env)
    if (!secret) {
      return c.json({ error: { code: 'NOT_CONFIGURED', message: 'Reschedule signing is not configured.', details: [] } }, 503)
    }

    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body: Record<string, any> = parsedBody.data
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
                s.name AS service_name, s.duration_minutes, s.full_day
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
                s.name AS service_name, s.duration_minutes, s.full_day
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

    const signedToken = await signRescheduleToken(matchedBooking.id, matchedBooking.client_email, secret, {
      eventDate: matchedBooking.slot_date
    })
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
      const limited = await enforceRescheduleRateLimit(c)
      if (limited) return limited
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
        serviceName: booking.service_name || 'Photography Session'
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

// ── Decomposed POST /:id/reschedule Helpers ──────────────────────

function parsePositiveSlotId(rawSlotId: unknown): number {
  if (typeof rawSlotId === 'number' && Number.isInteger(rawSlotId)) return rawSlotId
  if (typeof rawSlotId === 'string' && /^[1-9]\d*$/.test(rawSlotId.trim())) {
    return parseInt(rawSlotId.trim(), 10)
  }
  return 0
}

export async function verifyRescheduleAccess(
  c: Context<{ Bindings: Bindings }>
): Promise<
  | {
      ok: true
      booking: any
      token: string
      newSlotId: number
      timeZone: string
      currentDate: string
      policy: BookingPolicySettings
      feeRules: DynamicFeeRule[]
    }
  | { ok: false; response: Response }
> {
  const limited = await enforceRescheduleRateLimit(c)
  if (limited) return { ok: false, response: limited }

  await ensureSchemaReady(c.env.DB)
  const bookingId = Number(c.req.param('id'))
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return { ok: false, response: c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid booking id.', details: [] } }, 400) }
  }

  const parsedBody = await parseJsonObject(c)
  if (!parsedBody.ok) return { ok: false, response: parsedBody.response }
  const body = parsedBody.data
  const token = String(body?.token ?? c.req.query('token') ?? '').trim()
  const verifyName = typeof (body?.verifyName ?? body?.name) === 'string' ? String(body?.verifyName ?? body?.name).trim() : ''
  const verifyEmail = typeof (body?.verifyEmail ?? body?.email) === 'string' ? String(body?.verifyEmail ?? body?.email).trim() : ''
  const verifyPhone = typeof (body?.verifyPhone ?? body?.phone) === 'string' ? String(body?.verifyPhone ?? body?.phone).trim() : ''
  const newSlotId = parsePositiveSlotId(body?.slot_id !== undefined ? body.slot_id : body?.slotId)

  if (!newSlotId || newSlotId <= 0) {
    return { ok: false, response: c.json({ error: { code: 'VALIDATION_FAILED', message: 'A valid slot_id is required.', details: [] } }, 400) }
  }

  const secret = await resolveSigningSecret(c.env)
  if (!secret) {
    return { ok: false, response: c.json({ error: { code: 'NOT_CONFIGURED', message: 'Reschedule signing is not configured.', details: [] } }, 503) }
  }

  const booking = await loadBookingWithSlot(c.env.DB, bookingId)
  if (!booking) {
    return { ok: false, response: c.json({ error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }, 404) }
  }
  if (!(await verifyRescheduleToken(booking.id, booking.client_email, token, secret))) {
    return { ok: false, response: c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired reschedule token.', details: [] } }, 401) }
  }
  if (countRescheduleIdentityMatches(booking, { name: verifyName, email: verifyEmail, phone: verifyPhone }) < 2) {
    return {
      ok: false,
      response: c.json({
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'Identity verification failed. Please verify at least 2 of your Name, Email, and Phone Number.',
          details: []
        }
      }, 403)
    }
  }
  if (String(booking.status || '').trim().toLowerCase() === 'cancelled') {
    return { ok: false, response: c.json({ error: { code: 'BOOKING_CANCELLED', message: 'Cancelled bookings cannot be rescheduled.', details: [] } }, 409) }
  }

  const timeZone = await getStudioTimeZone(c.env.DB)
  const { policy, feeRules } = await loadPricingConfig(c.env.DB)
  const { currentDate } = getStudioCurrentDateTime(timeZone)
  const daysUntilSession = booking.slot_date ? daysBetweenISO(currentDate, booking.slot_date) : null
  if (daysUntilSession !== null && daysUntilSession < policy.rescheduleCutoffDays) {
    return {
      ok: false,
      response: c.json({
        error: {
          code: 'RESCHEDULE_WINDOW_CLOSED',
          message: `Rescheduling is closed within ${policy.rescheduleCutoffDays} day${policy.rescheduleCutoffDays === 1 ? '' : 's'} of the session date.`,
          details: [{ cutoffDays: policy.rescheduleCutoffDays, rescheduleAllowed: false }]
        }
      }, 403)
    }
  }

  return { ok: true, booking, token, newSlotId, timeZone, currentDate, policy, feeRules }
}

export async function validateRescheduleTargetSlot(
  c: Context<{ Bindings: Bindings }>,
  booking: any,
  newSlotId: number,
  timeZone: string
): Promise<
  | {
      ok: true
      targetSlot: any
      durationMinutes: number
      windowSlotIds: number[]
      windowEndTime: string
      exemptSlotIds: number[]
    }
  | { ok: false; response: Response }
> {
  if (booking.slot_id === newSlotId) {
    return { ok: false, response: c.json({ error: { code: 'VALIDATION_FAILED', message: 'Please select a different timeslot.', details: [] } }, 400) }
  }

  const targetSlot = await c.env.DB.prepare(
    'SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots WHERE id = ?'
  ).bind(newSlotId).first<any>()
  if (!targetSlot) {
    return { ok: false, response: c.json({ error: { code: 'NOT_FOUND', message: 'Selected timeslot does not exist.', details: [] } }, 404) }
  }
  if (isSlotInPast(targetSlot, timeZone)) {
    return { ok: false, response: c.json({ error: { code: 'VALIDATION_FAILED', message: 'Selected timeslot is in the past.', details: [] } }, 400) }
  }

  let durationMinutes = Number(booking.duration_minutes) > 0 ? Number(booking.duration_minutes) : 60
  let fullDay = booking.full_day === true || Number(booking.full_day) === 1
  if (booking.service_id) {
    const svc = await c.env.DB.prepare('SELECT duration_minutes, full_day FROM Services WHERE id = ?')
      .bind(booking.service_id)
      .first<{ duration_minutes: number | null; full_day: number | boolean | null }>()
    if (svc) {
      if (Number(svc.duration_minutes) > 0) durationMinutes = Number(svc.duration_minutes)
      fullDay = svc.full_day === true || Number(svc.full_day) === 1
    }
  }

  const bufferMinutes = await getBufferMinutesFromRules(c.env.DB)
  const { slotIds: oldSlotIds, protectedOtherSlotIds } = await resolveBookingSlotIds(c.env.DB, {
    bookingId: booking.id,
    slotId: booking.slot_id ?? null,
    serviceId: booking.service_id,
    durationMinutes,
    fullDay
  })
  const protectedSet = new Set<number>(protectedOtherSlotIds)
  const exemptSlotIds = oldSlotIds.filter((id) => !protectedSet.has(id))

  const weeklyAvailability = await loadWeeklyAvailability(c.env.DB)
  if (!isSlotInWeeklyAvailability(targetSlot, weeklyAvailability, fullDay ? undefined : durationMinutes)) {
    return { ok: false, response: c.json({ error: { code: 'VALIDATION_FAILED', message: 'Selected timeslot is outside studio weekly availability.', details: [] } }, 400) }
  }

  const blockedTarget = await c.env.DB.prepare('SELECT id FROM Blocked_Dates WHERE date = ?').bind(targetSlot.date).first()
  if (blockedTarget) {
    return { ok: false, response: c.json({ error: { code: 'SLOT_UNAVAILABLE', message: 'Selected date is blocked.', details: [] } }, 409) }
  }

  const daySlotsRes = await c.env.DB.prepare(
    'SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots WHERE date = ? ORDER BY start_time ASC, id ASC'
  ).bind(targetSlot.date).all<SlotRowLike>()

  const normalizeSlot = (row: any): SlotRowLike => ({
    id: row.id,
    date: row.date || targetSlot.date,
    start_time: row.start_time,
    end_time: row.end_time,
    is_booked: Number(row.is_booked) === 1 || row.is_booked === true ? 1 : 0
  })

  const windowRes = resolveSlotWindow({
    daySlots: (daySlotsRes.results || []).map(normalizeSlot),
    startSlot: normalizeSlot(targetSlot),
    durationMinutes,
    fullDay,
    bufferMinutes,
    exemptSlotIds
  })

  if (!windowRes.ok) {
    const msg =
      windowRes.reason === 'EXCEEDS_MIDNIGHT'
        ? 'Selected timeslot and service duration extend past the end of the day.'
        : windowRes.reason === 'SLOT_OVERLAPS_BOOKED'
          ? 'Required consecutive timeslots overlap an existing booking.'
          : 'Required consecutive timeslots are unavailable or booked.'
    return {
      ok: false,
      response: c.json(
        {
          error: {
            code: windowRes.reason === 'EXCEEDS_MIDNIGHT' ? 'VALIDATION_FAILED' : 'SLOT_UNAVAILABLE',
            message: msg,
            details: [{ reason: windowRes.reason }]
          }
        },
        windowRes.reason === 'EXCEEDS_MIDNIGHT' ? 400 : 409
      )
    }
  }

  return {
    ok: true,
    targetSlot,
    durationMinutes,
    windowSlotIds: windowRes.slotIds,
    windowEndTime: windowRes.endTime,
    exemptSlotIds
  }
}

async function releaseNewlyLockedRescheduleSlots(db: D1Database, slotIds: number[]): Promise<void> {
  if (slotIds.length === 0) return
  const ph = slotIds.map(() => '?').join(', ')
  await db.prepare(
    `UPDATE Schedule_Slots
     SET is_booked = 0
     WHERE id IN (${ph})
       AND id NOT IN (
         SELECT slot_id
         FROM Bookings
         WHERE LOWER(COALESCE(status, '')) != 'cancelled'
           AND slot_id IS NOT NULL
       )`
  ).bind(...slotIds).run().catch(() => {})
}

export async function executeRescheduleSwap(
  c: Context<{ Bindings: Bindings }>,
  params: {
    booking: any
    newSlotId: number
    targetSlot: any
    windowSlotIds: number[]
    exemptSlotIds: number[]
    timeZone: string
    currentDate: string
    feeRules: DynamicFeeRule[]
  }
): Promise<
  | { ok: true; rescheduleFeeCents: number; rescheduleFeeItems: ReturnType<typeof evaluateDynamicFees>['appliedFees'] }
  | { ok: false; response: Response }
> {
  const { booking, newSlotId, targetSlot, windowSlotIds, exemptSlotIds, timeZone, currentDate, feeRules } = params
  const oldSlotId: number | null = booking.slot_id ?? null

  try {
    await cancelOpenInvoice(c.env.DB, c.env, booking.id)
  } catch (cancelErr) {
    if (cancelErr instanceof BillingError) {
      return {
        ok: false,
        response: c.json(
          { error: { code: cancelErr.code, message: cancelErr.message, details: cancelErr.details } },
          cancelErr.httpStatus as 400 | 404 | 409 | 500 | 502 | 503
        )
      }
    }
    return { ok: false, response: c.json({ error: { code: 'SQUARE_ERROR', message: 'Could not cancel existing invoice before rescheduling.', details: [] } }, 502) }
  }

  const lockRes = await lockSlotsAtomically(c.env.DB, windowSlotIds, exemptSlotIds)
  if (!lockRes.ok) {
    return { ok: false, response: c.json({ error: { code: 'SLOT_UNAVAILABLE', message: 'The selected timeslot is no longer available.', details: [] } }, 409) }
  }
  const newlyLockedIds = lockRes.newlyLockedIds

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
  const lockedSlotIdsJson = JSON.stringify(windowSlotIds)

  const currentCountRow = await c.env.DB.prepare(
    'SELECT COALESCE(reschedule_count, 0) AS reschedule_count FROM Bookings WHERE id = ?'
  ).bind(booking.id).first<{ reschedule_count: number }>()
  const nextRescheduleCount = (Number(currentCountRow?.reschedule_count) || 0) + 1

  const batchStatements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE Bookings
       SET slot_id = ?, locked_slot_ids_json = ?, reschedule_count = ?
       WHERE id = ? AND slot_id = ?`
    ).bind(newSlotId, lockedSlotIdsJson, nextRescheduleCount, booking.id, oldSlotId)
  ]

  for (const fee of rescheduleFeeItems) {
    if (fee.amountCents > 0) {
      const desc = String(fee.name || 'Reschedule Fee').trim().slice(0, 120) || 'Reschedule Fee'
      batchStatements.push(
        c.env.DB.prepare(
          `INSERT INTO Booking_Charges (booking_id, description, amount_cents)
           SELECT ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM Bookings WHERE id = ? AND slot_id = ? AND reschedule_count = ?
           )`
        ).bind(booking.id, desc, fee.amountCents, booking.id, newSlotId, nextRescheduleCount)
      )
    }
  }

  try {
    const batchResults = await c.env.DB.batch(batchStatements)
    if (!batchResults[0]?.meta?.changes) {
      await releaseNewlyLockedRescheduleSlots(c.env.DB, newlyLockedIds)
      return { ok: false, response: c.json({ error: { code: 'CONFLICT', message: 'Booking was updated concurrently. Please refresh and try again.', details: [] } }, 409) }
    }
    if (oldSlotId && oldSlotId !== newSlotId) {
      await releaseBookingSlots(c.env.DB, booking.id, oldSlotId, { keepSlotIds: windowSlotIds })
    }
  } catch (dbErr) {
    await releaseNewlyLockedRescheduleSlots(c.env.DB, newlyLockedIds)
    throw dbErr
  }

  return { ok: true, rescheduleFeeCents, rescheduleFeeItems }
}

export async function syncReschedulePostEffects(
  c: Context<{ Bindings: Bindings }>,
  params: {
    booking: any
    token: string
    newSlotId: number
    targetSlot: any
    durationMinutes: number
    windowEndTime: string
    timeZone: string
    policy: BookingPolicySettings
  }
) {
  const { booking, token, newSlotId, targetSlot, durationMinutes, windowEndTime, timeZone, policy } = params

  try {
    const totalsResult = await loadBookingTotals(c.env.DB, booking.id)
    const balanceCents = totalsResult?.totals?.balance_cents ?? 0
    if (balanceCents > 0) {
      const scheduledAt = localDateTimeToRFC3339(targetSlot.date, targetSlot.start_time, timeZone)
      const dueDateOverride = addDaysISO(targetSlot.date, policy.balanceDueDaysAfterEvent)
      await sendBalanceInvoice(c.env.DB, c.env, booking.id, balanceCents, {
        ...(scheduledAt ? { scheduledAt } : {}),
        dueDateOverride
      })
    }
  } catch (invoiceErr) {
    console.warn('Reschedule: could not schedule updated balance invoice:', invoiceErr)
  }

  const { rescheduleUrl, icsUrl } = buildBookingCalendarLinks(c, booking.id, token)
  const sessionEndTime = windowEndTime || computeSessionEndTime(targetSlot.start_time, targetSlot.end_time, durationMinutes)
  const calendarInput = mapRowToCalendarBooking(
    { ...booking, date: targetSlot.date, start_time: targetSlot.start_time, end_time: sessionEndTime },
    timeZone
  )
  const googleCalendarUrl = buildGoogleCalendarTemplateUrl(calendarInput, rescheduleUrl, (c.env.GOOGLE_CALENDAR_ID || '').trim())
  scheduleNonBlocking(c, syncBookingToGoogleCalendarApi(c.env, calendarInput, 'upsert'))

  return {
    id: booking.id,
    slot_id: newSlotId,
    date: targetSlot.date,
    start_time: targetSlot.start_time,
    end_time: sessionEndTime,
    client_name: booking.client_name,
    client_email: booking.client_email,
    package_name: booking.service_name || 'Photography Session',
    status: booking.status,
    reschedule_url: rescheduleUrl,
    ics_url: icsUrl,
    google_calendar_url: googleCalendarUrl
  }
}

// 3. Reschedule a booking to a new available slot
rescheduleRoutes.post('/:id/reschedule', async (c) => {
  try {
    const access = await verifyRescheduleAccess(c)
    if (!access.ok) return access.response

    const slotCheck = await validateRescheduleTargetSlot(c, access.booking, access.newSlotId, access.timeZone)
    if (!slotCheck.ok) return slotCheck.response

    const swap = await executeRescheduleSwap(c, {
      booking: access.booking,
      newSlotId: access.newSlotId,
      targetSlot: slotCheck.targetSlot,
      windowSlotIds: slotCheck.windowSlotIds,
      exemptSlotIds: slotCheck.exemptSlotIds,
      timeZone: access.timeZone,
      currentDate: access.currentDate,
      feeRules: access.feeRules
    })
    if (!swap.ok) return swap.response

    const updatedBooking = await syncReschedulePostEffects(c, {
      booking: access.booking,
      token: access.token,
      newSlotId: access.newSlotId,
      targetSlot: slotCheck.targetSlot,
      durationMinutes: slotCheck.durationMinutes,
      windowEndTime: slotCheck.windowEndTime,
      timeZone: access.timeZone,
      policy: access.policy
    })

    return c.json({
      status: 'success',
      booking: updatedBooking,
      rescheduleFeeCents: swap.rescheduleFeeCents,
      rescheduleFeeItems: swap.rescheduleFeeItems,
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

    if (String(booking.status || '').trim().toLowerCase() === 'cancelled') {
      return c.text('Cancelled bookings cannot be exported.', 409)
    }

    const timeZone = await getStudioTimeZone(c.env.DB)
    const { rescheduleUrl } = buildBookingCalendarLinks(c, booking.id, token)

    const ics = buildBookingIcs(
      mapRowToCalendarBooking(
        { ...booking, date: booking.slot_date, start_time: booking.slot_start_time, end_time: booking.slot_end_time },
        timeZone
      ),
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
