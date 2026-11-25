import { Hono, type Context } from 'hono'
import type { Bindings } from '../index'
import { ensureSchemaReady } from './admin'
import { hasForbiddenPaymentFields, getSigningSecret, getMediaSigningSecret } from '../middleware/auth'
import { enforceRouteRateLimit } from '../middleware/rateLimit'
import { parseJsonObject } from '../utils/validation'
import { buildHybridSquareNote, ensureCustomer, getSquare, getStudioTimeZone, sendBalanceInvoice } from '../lib/squareBilling'
import {
  addDaysISO,
  type BookingPolicySettings,
  depositFor,
  type DynamicFeeRule,
  evaluateDynamicFees,
  localDateTimeToRFC3339,
  normalizeBookingPolicy,
  normalizeDepositPercent,
  normalizeFeeRules,
  parseNonNegativeMoneyToCents
} from '../lib/billingMath'
import { isSlotInWeeklyAvailability } from './schedule'
import {
  computeSessionEndTime,
  getBufferMinutesFromRules,
  isSlotInPast,
  loadWeeklyAvailability,
  lockSlotsAtomically,
  resolveSlotWindow,
  type SlotRowLike
} from '../lib/scheduleSync.ts'
import { signRescheduleToken } from './reschedule'
import { buildGoogleCalendarTemplateUrl, syncBookingToGoogleCalendarApi } from '../lib/googleCalendar'
import { sendBookingConfirmationEmail } from '../email'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9_-]{8,36}$/

export function stripControlChars(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\x00-\x1F\x7F]/g, '').trim() : ''
}

export function sanitizeCheckoutIdentityAndLocation(body: Record<string, unknown>) {
  const rawName = body.clientName ?? body.customer_name
  const clientName = stripControlChars(rawName)

  const rawLocationMode = body.locationMode ?? body.location_mode
  const locationMode: 'studio' | 'on_location' = rawLocationMode === 'on_location' ? 'on_location' : 'studio'
  const isOnLocation = locationMode === 'on_location'
  const rawEventLocation = body.eventLocation ?? body.event_location ?? body.location
  const trimmedEventLocation = stripControlChars(rawEventLocation).slice(0, 500)
  const eventLocation = isOnLocation ? (trimmedEventLocation || 'R59 Media Studio') : 'R59 Media Studio'

  const rawAgreementSig = body.agreementSignatureName ?? body.agreement_signature_name
  const agreementSignatureName = stripControlChars(rawAgreementSig).slice(0, 200)

  return {
    clientName,
    locationMode,
    isOnLocation,
    trimmedEventLocation,
    eventLocation,
    agreementSignatureName
  }
}

// Per-IP rate limiter for checkout (D1-backed)
const CHECKOUT_RATE_WINDOW_SECONDS = 60
const CHECKOUT_RATE_MAX_REQUESTS = 10
const MAX_GLOBAL_ATTENDEES = 50

export interface ParsedCheckoutPayload {
  body: Record<string, any>
  sourceId: unknown
  serviceId: unknown
  slotId: number
  clientEmail: string
  clientName: string
  locationMode: 'studio' | 'on_location'
  isOnLocation: boolean
  eventLocation: string
  agreementSignatureName: string
  customerPhone: string
  notes: string
  attendees: number
  idempotencyKey: string
  couponCode: string
  selectedFeeIds: string[]
  photoPermissionPortfolio: number
  photoPermissionSocial: number
  photoPermissionAcceptedAt: string | null
  photoPermissionVersion: string
  consentSummary: string
}

function parseAttendees(rawAttendees: unknown): { attendees: number; error: string | null } {
  if (rawAttendees === undefined || rawAttendees === null || rawAttendees === '') {
    return { attendees: 1, error: null }
  }
  const parsedAtt =
    typeof rawAttendees === 'number'
      ? rawAttendees
      : /^\d+$/.test(String(rawAttendees).trim())
        ? Number(String(rawAttendees).trim())
        : NaN
  if (!Number.isInteger(parsedAtt) || parsedAtt < 1 || parsedAtt > MAX_GLOBAL_ATTENDEES) {
    return { attendees: 1, error: `Attendees must be a whole number between 1 and ${MAX_GLOBAL_ATTENDEES}.` }
  }
  return { attendees: parsedAtt, error: null }
}

function parseSlotIdValue(rawSlotId: unknown): number | undefined {
  if (typeof rawSlotId === 'number' && Number.isInteger(rawSlotId) && rawSlotId > 0) return rawSlotId
  if (typeof rawSlotId === 'string' && /^[1-9]\d*$/.test(rawSlotId.trim())) return parseInt(rawSlotId.trim(), 10)
  return undefined
}

function validateCheckoutFields(params: {
  sourceId: unknown
  slotId: number | undefined
  serviceId: unknown
  clientName: string
  clientEmail: string
  attendeesError: string | null
  idempotencyKey: unknown
  isOnLocation: boolean
  trimmedEventLocation: string
}) {
  const errors: Array<{ field: string; message: string; code: string }> = []
  if (params.sourceId !== undefined && params.sourceId !== null && typeof params.sourceId !== 'string') {
    errors.push({ field: 'sourceId', message: 'Payment source token must be a string.', code: 'INVALID_FORMAT' })
  }
  if (!params.slotId) errors.push({ field: 'slot_id', message: 'A valid numeric timeslot id is required.', code: 'REQUIRED_FIELD' })
  if (!params.serviceId) errors.push({ field: 'serviceId', message: 'A service must be selected.', code: 'REQUIRED_FIELD' })
  if (!params.clientName) errors.push({ field: 'clientName', message: 'Client name is required.', code: 'REQUIRED_FIELD' })
  if (!params.clientEmail) {
    errors.push({ field: 'clientEmail', message: 'Client email is required.', code: 'REQUIRED_FIELD' })
  } else if (!EMAIL_REGEX.test(params.clientEmail)) {
    errors.push({ field: 'clientEmail', message: 'Please enter a valid email address.', code: 'INVALID_FORMAT' })
  }
  if (params.attendeesError) errors.push({ field: 'attendees', message: params.attendeesError, code: 'OUT_OF_RANGE' })
  if (!params.idempotencyKey || typeof params.idempotencyKey !== 'string') {
    errors.push({ field: 'idempotencyKey', message: 'Idempotency key is required to prevent double charges.', code: 'REQUIRED_FIELD' })
  } else if (!IDEMPOTENCY_KEY_REGEX.test(params.idempotencyKey)) {
    errors.push({
      field: 'idempotencyKey',
      message: 'Idempotency key must be 8 to 36 alphanumeric, hyphen, or underscore characters.',
      code: 'INVALID_FORMAT'
    })
  }
  if (params.isOnLocation && params.trimmedEventLocation.length === 0) {
    errors.push({ field: 'eventLocation', message: 'Event location is required for on-location sessions.', code: 'REQUIRED_FIELD' })
  }
  return errors
}

function extractPhotoConsent(photoPermissions: unknown) {
  const hasPhotoPermissions = Boolean(photoPermissions && typeof photoPermissions === 'object')
  const perms = (hasPhotoPermissions ? photoPermissions : {}) as Record<string, unknown>
  const portfolio = hasPhotoPermissions && (perms.websitePortfolio ?? perms.website_portfolio) ? 1 : 0
  const social = hasPhotoPermissions && (perms.socialMedia ?? perms.social_media) ? 1 : 0
  const acceptedAt = hasPhotoPermissions ? new Date().toISOString() : null
  const summary = `Photo Consent: Portfolio=[${portfolio ? 'YES' : 'NO'}], Social=[${social ? 'YES' : 'NO'}]`
  return { hasPhotoPermissions, portfolio, social, acceptedAt, version: 'v1', summary }
}

export async function parseCheckoutPayload(
  c: Context<{ Bindings: Bindings }>
): Promise<{ ok: true; data: ParsedCheckoutPayload } | { ok: false; response: Response }> {
  const parsedBody = await parseJsonObject(c)
  if (!parsedBody.ok) return { ok: false, response: parsedBody.response }
  const body: Record<string, any> = parsedBody.data

  const sourceId = body.sourceId ?? body.source_id
  if (hasForbiddenPaymentFields(body) || /^\d{13,19}$/.test(String(sourceId || '').replace(/[\s-]/g, ''))) {
    return {
      ok: false,
      response: c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account details are prohibited. Tokenize payments with the Square Web Payments SDK.',
          target: 'checkout',
          details: []
        }
      }, 400)
    }
  }

  const serviceId = body.serviceId ?? body.service_id
  const rawEmail = body.clientEmail ?? body.customer_email
  const clientEmail = typeof rawEmail === 'string' ? rawEmail.trim() : ''
  const identity = sanitizeCheckoutIdentityAndLocation(body)
  const rawPhone = body.customer_phone ?? body.customerPhone ?? body.phone
  const customerPhone = typeof rawPhone === 'string' ? rawPhone.trim().slice(0, 50) : ''
  const rawNotes = body.notes ?? body.message ?? body.clientNotes
  let notes = typeof rawNotes === 'string' ? rawNotes.trim().slice(0, 2000) : ''
  const { attendees, error: attendeesError } = parseAttendees(body.attendees ?? body.party_size ?? body.people)
  const idempotencyKey = body.idempotencyKey ?? body.idempotency_key
  const slotId = parseSlotIdValue(body.slot_id !== undefined ? body.slot_id : body.slotId)
  const rawCoupon = body.coupon_code ?? body.couponCode
  const couponCode = typeof rawCoupon === 'string' ? rawCoupon.trim().toUpperCase() : ''
  const rawSelectedFeeIds = body.selectedFeeIds ?? body.selected_fee_ids
  const selectedFeeIds = Array.isArray(rawSelectedFeeIds) ? rawSelectedFeeIds.map((id: unknown) => String(id).trim()).filter(Boolean) : []

  const consent = extractPhotoConsent(body.photoPermissions ?? body.photo_permissions)
  if (consent.hasPhotoPermissions) {
    notes = notes ? `${notes}\n\n${consent.summary}` : consent.summary
  }

  const errors = validateCheckoutFields({
    sourceId,
    slotId,
    serviceId,
    clientName: identity.clientName,
    clientEmail,
    attendeesError,
    idempotencyKey,
    isOnLocation: identity.isOnLocation,
    trimmedEventLocation: identity.trimmedEventLocation
  })

  if (errors.length > 0) {
    return {
      ok: false,
      response: c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Your booking request could not be processed. Please correct the errors below.',
          target: 'checkout_form',
          details: errors
        }
      }, 400)
    }
  }

  return {
    ok: true,
    data: {
      body,
      sourceId,
      serviceId,
      slotId: slotId!,
      clientEmail,
      clientName: identity.clientName,
      locationMode: identity.locationMode,
      isOnLocation: identity.isOnLocation,
      eventLocation: identity.eventLocation,
      agreementSignatureName: identity.agreementSignatureName,
      customerPhone,
      notes,
      attendees,
      idempotencyKey,
      couponCode,
      selectedFeeIds,
      photoPermissionPortfolio: consent.portfolio,
      photoPermissionSocial: consent.social,
      photoPermissionAcceptedAt: consent.acceptedAt,
      photoPermissionVersion: consent.version,
      consentSummary: consent.summary
    }
  }
}

async function buildIdempotentCheckoutResponse(
  c: Context<{ Bindings: Bindings }>,
  existingByIdem: any,
  publicOrigin: string,
  calendarTargetEmail: string
): Promise<Response> {
  const timeZone = await getStudioTimeZone(c.env.DB)
  const signingSecret = getSigningSecret(c.env) || (await getMediaSigningSecret(c.env))
  const rescheduleToken = signingSecret
    ? await signRescheduleToken(existingByIdem.id, existingByIdem.client_email, signingSecret, { eventDate: existingByIdem.slot_date })
    : ''
  const rescheduleUrl = rescheduleToken
    ? `${publicOrigin}/reschedule?booking=${existingByIdem.id}&token=${encodeURIComponent(rescheduleToken)}`
    : ''
  const icsUrl = rescheduleToken
    ? `${publicOrigin}/api/bookings/${existingByIdem.id}/calendar.ics?token=${encodeURIComponent(rescheduleToken)}`
    : ''
  const durationMins = Number(existingByIdem.duration_minutes) > 0 ? Number(existingByIdem.duration_minutes) : 60
  const sessionEndTime = existingByIdem.slot_start_time
    ? computeSessionEndTime(existingByIdem.slot_start_time, existingByIdem.slot_end_time || '00:00', durationMins)
    : ''
  const googleCalendarUrl = existingByIdem.slot_date
    ? buildGoogleCalendarTemplateUrl(
        {
          id: existingByIdem.id,
          date: existingByIdem.slot_date,
          start_time: existingByIdem.slot_start_time,
          end_time: sessionEndTime,
          client_name: existingByIdem.client_name,
          client_email: existingByIdem.client_email,
          customer_phone: existingByIdem.customer_phone,
          package_name: existingByIdem.service_name,
          service_name: existingByIdem.service_name,
          status: existingByIdem.status,
          notes: existingByIdem.notes,
          location: existingByIdem.event_location || existingByIdem.location,
          attendees: existingByIdem.attendees,
          timeZone
        },
        rescheduleUrl,
        calendarTargetEmail
      )
    : ''

  let existingAppliedFees: any[] = []
  if (existingByIdem.applied_fees_json) {
    try { existingAppliedFees = JSON.parse(existingByIdem.applied_fees_json) } catch {}
  }
  const existingFeeTotal = existingAppliedFees.reduce((s: number, f: any) => s + (Number(f?.amountCents) || 0), 0)
  const totalCents = (Number(existingByIdem.price_at_booking) || 0) + (existingFeeTotal > 0 && Number(existingByIdem.price_at_booking) >= 0 ? existingFeeTotal : 0)
  const depCents = Number(existingByIdem.deposit_paid) || 0
  const balCents = Math.max(0, totalCents - depCents)

  return c.json({
    success: true,
    status: 'success',
    idempotent: true,
    paymentId: existingByIdem.square_payment_id ?? null,
    bookingId: existingByIdem.id,
    deposit_cents: depCents,
    deposit_percent: existingByIdem.deposit_percent ?? 100,
    total_cents: totalCents,
    balance_cents: balCents,
    reschedule_token: rescheduleToken,
    reschedule_url: rescheduleUrl,
    ics_url: icsUrl,
    google_calendar_url: googleCalendarUrl,
    data: {
      booking_id: existingByIdem.id,
      payment_id: existingByIdem.square_payment_id ?? null,
      deposit_cents: depCents,
      deposit_percent: existingByIdem.deposit_percent ?? 100,
      total_cents: totalCents,
      balance_cents: balCents,
      reschedule_token: rescheduleToken,
      reschedule_url: rescheduleUrl,
      ics_url: icsUrl,
      google_calendar_url: googleCalendarUrl
    }
  }, 200)
}

function checkoutFormError(
  c: Context,
  status: 400 | 409,
  code: string,
  message: string,
  details: Array<{ field: string; message: string; code: string }>
): Response {
  return c.json({ error: { code, message, target: 'checkout_form', details } }, status)
}

export async function validateAndResolveCheckoutSlot(
  c: Context<{ Bindings: Bindings }>,
  payload: ParsedCheckoutPayload
): Promise<
  | {
      ok: true
      slot: any
      service: any
      parsedServiceAdditionalPeople: any
      timeZone: string
      effectiveDurationMinutes: number
      windowEndTime: string
      lockedSlotIds: number[]
    }
  | { ok: false; response: Response }
> {
  const { body, slotId, serviceId, attendees } = payload
  const slot = await c.env.DB.prepare(
    'SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots WHERE id = ?'
  ).bind(slotId).first<any>()
  if (!slot) {
    return {
      ok: false,
      response: checkoutFormError(c, 400, 'VALIDATION_FAILED', 'The selected timeslot does not exist.', [
        { field: 'slot_id', message: 'Timeslot does not exist.', code: 'NOT_FOUND' }
      ])
    }
  }

  const timeZone = await getStudioTimeZone(c.env.DB)
  if (isSlotInPast(slot, timeZone)) {
    return {
      ok: false,
      response: checkoutFormError(c, 409, 'SLOT_UNAVAILABLE', 'The selected timeslot is in the past.', [
        { field: 'slot_id', message: 'Timeslot is in the past.', code: 'PAST_SLOT' }
      ])
    }
  }

  const requestedDate = body.date || body.dateStr || body.slot_date || body.slotDate
  if (requestedDate && String(requestedDate).trim() !== slot.date) {
    return {
      ok: false,
      response: checkoutFormError(c, 400, 'VALIDATION_FAILED', 'Selected timeslot date does not match requested date.', [
        { field: 'slot_id', message: 'Timeslot date mismatch.', code: 'DATE_MISMATCH' }
      ])
    }
  }

  const requestedTime = body.start_time || body.startTime || body.time || body.slot_time
  if (requestedTime && String(requestedTime).trim().slice(0, 5) !== String(slot.start_time).trim().slice(0, 5)) {
    return {
      ok: false,
      response: checkoutFormError(c, 400, 'VALIDATION_FAILED', 'Selected timeslot time does not match requested time.', [
        { field: 'slot_id', message: 'Timeslot time mismatch.', code: 'TIME_MISMATCH' }
      ])
    }
  }

  if (slot.is_booked) {
    return {
      ok: false,
      response: checkoutFormError(c, 409, 'VALIDATION_FAILED', 'The selected timeslot is already booked.', [
        { field: 'slot_id', message: 'Timeslot unavailable.', code: 'UNAVAILABLE' }
      ])
    }
  }

  const blocked = await c.env.DB.prepare('SELECT id FROM Blocked_Dates WHERE date = ?').bind(slot.date).first()
  if (blocked) {
    return {
      ok: false,
      response: checkoutFormError(c, 409, 'VALIDATION_FAILED', 'The selected timeslot falls on a blocked date.', [
        { field: 'slot_id', message: 'Timeslot falls on a blocked date.', code: 'BLOCKED_DATE' }
      ])
    }
  }

  const service: any = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ? AND is_active = 1').bind(serviceId).first()
  if (!service) {
    return {
      ok: false,
      response: checkoutFormError(c, 400, 'VALIDATION_FAILED', 'The selected service is invalid or unavailable.', [
        { field: 'serviceId', message: 'Service unavailable.', code: 'UNAVAILABLE' }
      ])
    }
  }

  const priceCents = Number(service.price)
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    return {
      ok: false,
      response: checkoutFormError(c, 400, 'VALIDATION_FAILED', 'The selected service does not have a valid online checkout price.', [
        { field: 'serviceId', message: 'Service price must be greater than zero.', code: 'INVALID_PRICE' }
      ])
    }
  }

  let parsedServiceAdditionalPeople: any = null
  if (service.additional_people) {
    if (typeof service.additional_people === 'string') {
      try { parsedServiceAdditionalPeople = JSON.parse(service.additional_people) } catch {}
    } else if (typeof service.additional_people === 'object') {
      parsedServiceAdditionalPeople = service.additional_people
    }
  }
  const rawMaxPeople = Number(parsedServiceAdditionalPeople?.maxPeople)
  const maxPeopleAllowed = Number.isFinite(rawMaxPeople) && rawMaxPeople > 0
    ? Math.min(MAX_GLOBAL_ATTENDEES, Math.round(rawMaxPeople))
    : MAX_GLOBAL_ATTENDEES
  if (attendees > maxPeopleAllowed) {
    return {
      ok: false,
      response: checkoutFormError(c, 400, 'VALIDATION_FAILED', `Maximum ${maxPeopleAllowed} attendees allowed for this package.`, [
        { field: 'attendees', message: `Maximum ${maxPeopleAllowed} attendees allowed.`, code: 'OUT_OF_RANGE' }
      ])
    }
  }

  const effectiveDurationMinutes = Number(service.duration_minutes) > 0 ? Number(service.duration_minutes) : 60
  const isFullDay = service.full_day === true || Number(service.full_day) === 1
  const weeklyAvailability = await loadWeeklyAvailability(c.env.DB)

  if (!isSlotInWeeklyAvailability(slot, weeklyAvailability, isFullDay ? undefined : effectiveDurationMinutes)) {
    return {
      ok: false,
      response: checkoutFormError(c, 400, 'VALIDATION_FAILED', 'The selected timeslot and duration exceed studio weekly availability.', [
        { field: 'slot_id', message: 'Timeslot is outside weekly availability windows.', code: 'OUTSIDE_AVAILABILITY' }
      ])
    }
  }

  const bufferMinutes = await getBufferMinutesFromRules(c.env.DB)
  const daySlotsRes = await c.env.DB.prepare(
    'SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots WHERE date = ? ORDER BY start_time ASC, id ASC'
  ).bind(slot.date).all<SlotRowLike>()

  const normalizeSlot = (row: any): SlotRowLike => ({
    id: row.id,
    date: row.date || slot.date,
    start_time: row.start_time,
    end_time: row.end_time,
    is_booked: Number(row.is_booked) === 1 || row.is_booked === true ? 1 : 0
  })

  const windowRes = resolveSlotWindow({
    daySlots: (daySlotsRes.results || []).map(normalizeSlot),
    startSlot: normalizeSlot(slot),
    durationMinutes: effectiveDurationMinutes,
    fullDay: isFullDay,
    bufferMinutes
  })

  if (!windowRes.ok) {
    const reasonMessage =
      windowRes.reason === 'EXCEEDS_MIDNIGHT'
        ? 'The selected service duration extends past the end of the day.'
        : windowRes.reason === 'SLOT_OVERLAPS_BOOKED'
          ? 'One or more required timeslots for this session overlap an existing booking.'
          : windowRes.reason === 'INVALID_TIME'
            ? 'The selected timeslot has an invalid start time.'
            : 'One or more required timeslots for this session duration are unavailable or insufficient.'

    return {
      ok: false,
      response: checkoutFormError(c, 409, 'SLOT_UNAVAILABLE', reasonMessage, [
        { field: 'slot_id', message: reasonMessage, code: windowRes.reason }
      ])
    }
  }

  const lockRes = await lockSlotsAtomically(c.env.DB, windowRes.slotIds)
  if (!lockRes.ok) {
    return {
      ok: false,
      response: checkoutFormError(c, 409, 'SLOT_UNAVAILABLE', 'The selected timeslot is no longer available or falls on a blocked date.', [
        { field: 'slot_id', message: 'Timeslot unavailable.', code: 'UNAVAILABLE' }
      ])
    }
  }

  return {
    ok: true,
    slot,
    service,
    parsedServiceAdditionalPeople,
    timeZone,
    effectiveDurationMinutes,
    windowEndTime: windowRes.endTime,
    lockedSlotIds: lockRes.newlyLockedIds
  }
}

export async function resolveCheckoutCouponDiscount(
  db: D1Database,
  couponCode: string,
  subtotalCents: number
): Promise<{ validCouponCode: string; couponDiscountCents: number }> {
  if (!couponCode) return { validCouponCode: '', couponDiscountCents: 0 }

  const coupon: any = await db.prepare(
    'SELECT id, code, discount_type, discount_value, is_active, expires_at, max_uses, used_count FROM Coupons WHERE UPPER(code) = ? AND is_active = 1'
  ).bind(couponCode).first()
  if (!coupon) return { validCouponCode: '', couponDiscountCents: 0 }

  if (coupon.expires_at) {
    const expStr = String(coupon.expires_at).trim()
    const expMs = /^\d{4}-\d{2}-\d{2}$/.test(expStr) ? Date.parse(`${expStr}T23:59:59.999Z`) : Date.parse(expStr)
    if (!Number.isNaN(expMs) && Date.now() > expMs) {
      return { validCouponCode: '', couponDiscountCents: 0 }
    }
  }

  const rawLimit = coupon.max_uses ?? coupon.usage_limit
  if (rawLimit !== null && rawLimit !== undefined && Number(rawLimit) > 0) {
    const limit = Number(rawLimit)
    const usedCount = Number(coupon.used_count) || 0
    const countRow = await db.prepare(
      "SELECT COUNT(*) as count FROM Bookings WHERE UPPER(coupon_code) = ? AND status != 'cancelled'"
    ).bind(couponCode).first<{ count: number }>().catch(() => null)
    if (Math.max(usedCount, countRow?.count ?? 0) >= limit) {
      return { validCouponCode: '', couponDiscountCents: 0 }
    }
  }

  const discountVal = Number(coupon.discount_value) || 0
  const couponDiscountCents = coupon.discount_type === 'percent'
    ? Math.round((subtotalCents * Math.min(100, Math.max(0, discountVal))) / 100)
    : (parseNonNegativeMoneyToCents(coupon.discount_value) ?? Math.round(Math.max(0, discountVal) * 100))

  return { validCouponCode: couponCode, couponDiscountCents }
}

export interface ComputedCheckoutPricing {
  policy: BookingPolicySettings
  appliedFees: ReturnType<typeof evaluateDynamicFees>['appliedFees']
  totalFeeCents: number
  validCouponCode: string
  finalPriceCents: number
  depositCents: number
  depositPercent: number
  squareChargeCents: number
  agreementSignedAt: string | null
  lineItemName: string
  serviceCategory: string
  packageTitle: string
  hybridNote: string
}

export async function computeCheckoutPricing(
  db: D1Database,
  params: {
    payload: ParsedCheckoutPayload
    slot: any
    service: any
    parsedServiceAdditionalPeople: any
    timeZone: string
  }
): Promise<
  | { ok: true; pricing: ComputedCheckoutPricing }
  | { ok: false; code: 'SIGNATURE_REQUIRED' }
> {
  const { payload, slot, service, parsedServiceAdditionalPeople, timeZone } = params
  let pricingSettings: any = null
  try {
    const pricingRow: any = await db.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'pricing'"
    ).first()
    pricingSettings = pricingRow?.setting_value ? JSON.parse(pricingRow.setting_value) : null
  } catch {
    console.warn('Could not read pricing settings; using the default pricing settings.')
  }

  const feeRules: DynamicFeeRule[] = normalizeFeeRules(pricingSettings?.feeRules)
  const policy = normalizeBookingPolicy(pricingSettings?.policy)
  if (policy.requireSignature && !payload.agreementSignatureName) {
    return { ok: false, code: 'SIGNATURE_REQUIRED' }
  }

  const agreementSignedAt = payload.agreementSignatureName ? new Date().toISOString() : null
  const baseFeeDollars = Number(pricingSettings?.baseFee) || 0
  const baseFeeCents = parseNonNegativeMoneyToCents(baseFeeDollars) ?? Math.round(baseFeeDollars * 100)
  const perPersonDollars = Number(pricingSettings?.perPerson) || 0
  const perPersonCents = parseNonNegativeMoneyToCents(perPersonDollars) ?? Math.round(perPersonDollars * 100)

  const includedPeople =
    parsedServiceAdditionalPeople?.includedPeople !== undefined && Number.isFinite(Number(parsedServiceAdditionalPeople.includedPeople))
      ? Math.max(1, Math.round(Number(parsedServiceAdditionalPeople.includedPeople)))
      : 1
  const serviceExtraPersonPriceCents =
    parsedServiceAdditionalPeople?.extraPersonPriceMinor !== undefined && Number.isFinite(Number(parsedServiceAdditionalPeople.extraPersonPriceMinor))
      ? Math.round(Number(parsedServiceAdditionalPeople.extraPersonPriceMinor))
      : 0

  const additionalPeople = Math.max(0, payload.attendees - includedPeople)
  const ratePerPersonCents = perPersonCents > 0 ? perPersonCents : serviceExtraPersonPriceCents
  const subtotalCents = Number(service.price) + baseFeeCents + ratePerPersonCents * additionalPeople

  const { validCouponCode, couponDiscountCents } = await resolveCheckoutCouponDiscount(db, payload.couponCode, subtotalCents)
  const feeEval = evaluateDynamicFees(feeRules, {
    subtotalCents,
    sessionDate: slot.date,
    timeZone,
    attendees: payload.attendees,
    photoPermissionPortfolio: Boolean(payload.photoPermissionPortfolio),
    photoPermissionSocial: Boolean(payload.photoPermissionSocial),
    selectedFeeIds: payload.selectedFeeIds,
    isOnLocation: payload.isOnLocation,
    isReschedule: false
  })

  const finalPriceCents = Math.max(0, subtotalCents + feeEval.totalFeeCents - couponDiscountCents)
  const requestedDepositPercent = normalizeDepositPercent(pricingSettings?.depositPercent)
  const depositInfo = finalPriceCents > 0 ? depositFor(finalPriceCents, requestedDepositPercent) : { cents: 0, percent: 100 }
  const serviceCategory = String(service.category ?? service.best_for ?? '').trim() || 'Photography'
  const packageTitle = String(service.title ?? service.name ?? '').trim()
  const hybridNote = buildHybridSquareNote({
    category: serviceCategory,
    packageName: packageTitle,
    date: slot.date,
    time: slot.start_time,
    guests: payload.attendees,
    couponCode: validCouponCode,
    photoPermissionPortfolio: payload.photoPermissionPortfolio,
    photoPermissionSocial: payload.photoPermissionSocial,
    agreementSignedName: payload.agreementSignatureName,
    eventLocation: payload.eventLocation,
    bookingId: null
  })

  return {
    ok: true,
    pricing: {
      policy,
      appliedFees: feeEval.appliedFees,
      totalFeeCents: feeEval.totalFeeCents,
      validCouponCode,
      finalPriceCents,
      depositCents: depositInfo.cents,
      depositPercent: depositInfo.percent,
      squareChargeCents: depositInfo.cents,
      agreementSignedAt,
      lineItemName: depositInfo.percent === 100 ? service.name : `${service.name} – ${depositInfo.percent}% deposit`,
      serviceCategory,
      packageTitle,
      hybridNote
    }
  }
}

export async function unlockCheckoutSlots(db: D1Database, slotIds: number[]): Promise<void> {
  if (slotIds.length === 0) return
  try {
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
    ).bind(...slotIds).run()
  } catch (releaseErr) {
    console.error('Failed to release slot lock:', releaseErr)
  }
}

export async function processSquareDepositPayment(
  c: Context<{ Bindings: Bindings }>,
  payload: ParsedCheckoutPayload,
  pricing: ComputedCheckoutPricing
): Promise<
  | {
      ok: true
      paymentId: string | null
      orderId: string | null
      squareClientRef: Awaited<ReturnType<typeof getSquare>>['client'] | null
    }
  | { ok: false; response: Response }
> {
  if (pricing.squareChargeCents <= 0) {
    return { ok: true, paymentId: null, orderId: null, squareClientRef: null }
  }

  const sourceId = payload.sourceId
  if (!sourceId || typeof sourceId !== 'string' || !sourceId.trim()) {
    return {
      ok: false,
      response: checkoutFormError(c, 400, 'VALIDATION_FAILED', 'Payment source token is required.', [
        { field: 'sourceId', message: 'Payment source token is required.', code: 'REQUIRED_FIELD' }
      ])
    }
  }

  const { client, locationId: squareLocationId } = await getSquare(c.env)
  let squareCustomerId: string | undefined
  try {
    squareCustomerId = await ensureCustomer(
      client,
      { client_email: payload.clientEmail, client_name: payload.clientName, customer_phone: payload.customerPhone },
      payload.idempotencyKey
    )
  } catch (custErr) {
    console.warn('Square customer lookup/create failed during checkout:', custErr)
  }

  const feeLineItems: Array<{ name: string; quantity: string; basePriceMoney: { amount: bigint; currency: 'USD' } }> = []
  let feeLineSum = 0
  if (pricing.appliedFees.length > 0 && pricing.finalPriceCents > 0) {
    for (const fee of pricing.appliedFees) {
      const portion = Math.round((fee.amountCents * pricing.squareChargeCents) / pricing.finalPriceCents)
      if (portion > 0) {
        feeLineItems.push({
          name: (pricing.depositPercent === 100 ? fee.name : `${fee.name} (${pricing.depositPercent}% deposit)`).slice(0, 512),
          quantity: '1',
          basePriceMoney: { amount: BigInt(portion), currency: 'USD' as const }
        })
        feeLineSum += portion
      }
    }
  }

  const baseLineCents = pricing.squareChargeCents - feeLineSum
  const orderLineItems =
    feeLineItems.length > 0 && baseLineCents > 0
      ? [{ name: pricing.lineItemName, quantity: '1', note: pricing.hybridNote, basePriceMoney: { amount: BigInt(baseLineCents), currency: 'USD' as const } }, ...feeLineItems]
      : [{ name: pricing.lineItemName, quantity: '1', note: pricing.hybridNote, basePriceMoney: { amount: BigInt(pricing.squareChargeCents), currency: 'USD' as const } }]

  const orderResponse = await client.orders.create({
    order: {
      locationId: squareLocationId,
      customerId: squareCustomerId,
      lineItems: orderLineItems,
      metadata: {
        booking_id: 'pending',
        category: pricing.serviceCategory.slice(0, 255),
        session_type: (pricing.packageTitle || 'Custom Session').slice(0, 255),
        photo_permission_portfolio: payload.photoPermissionPortfolio ? 'YES' : 'NO',
        photo_permission_social: payload.photoPermissionSocial ? 'YES' : 'NO',
        ...(payload.agreementSignatureName && pricing.agreementSignedAt
          ? {
              agreement_signed_name: payload.agreementSignatureName.slice(0, 255),
              agreement_signed_at: pricing.agreementSignedAt.slice(0, 255)
            }
          : {}),
        ...(payload.eventLocation ? { event_location: payload.eventLocation.slice(0, 255) } : {})
      }
    },
    idempotencyKey: payload.idempotencyKey + '_order'
  })

  const orderId = orderResponse.order?.id ?? null
  if (!orderId) throw new Error('Failed to generate Square Order')

  const paymentResponse = await client.payments.create({
    sourceId,
    idempotencyKey: payload.idempotencyKey,
    orderId,
    locationId: squareLocationId,
    customerId: squareCustomerId,
    autocomplete: true,
    acceptPartialAuthorization: false,
    note: pricing.hybridNote,
    buyerEmailAddress: payload.clientEmail,
    amountMoney: { amount: BigInt(pricing.squareChargeCents), currency: 'USD' }
  })

  const payment = paymentResponse.payment
  const paymentId = payment?.id ?? null
  if (payment?.status !== 'COMPLETED' || payment.amountMoney?.amount !== BigInt(pricing.squareChargeCents)) {
    return {
      ok: false,
      response: c.json({
        error: {
          code: 'PAYMENT_FAILED',
          message: `Payment failed with status: ${payment?.status || 'UNKNOWN'}. Please try another card.`,
          details: []
        }
      }, 402)
    }
  }

  return { ok: true, paymentId, orderId, squareClientRef: client }
}

export async function rollbackFailedCheckout(
  db: D1Database,
  params: {
    bookingId?: number
    paymentId: string | null
    squareChargeCents: number
    idempotencyKey: string
    squareClientRef: Awaited<ReturnType<typeof getSquare>>['client'] | null
    lockedSlotIds: number[]
  }
): Promise<void> {
  if (params.bookingId) {
    await db.prepare('DELETE FROM Bookings WHERE id = ?').bind(params.bookingId).run().catch(() => {})
  }
  if (params.paymentId && params.squareClientRef) {
    await params.squareClientRef.refunds.refundPayment({
      idempotencyKey: params.idempotencyKey + '_refund',
      paymentId: params.paymentId,
      amountMoney: { amount: BigInt(params.squareChargeCents), currency: 'USD' }
    }).catch((refundErr) => {
      console.error('Failed to refund payment after booking failure:', refundErr)
    })
  }
  await unlockCheckoutSlots(db, params.lockedSlotIds)
}

export async function persistBookingTransaction(
  db: D1Database,
  params: {
    payload: ParsedCheckoutPayload
    serviceId: number
    pricing: ComputedCheckoutPricing
    paymentId: string | null
    lockedSlotIds: number[]
  }
): Promise<number | undefined> {
  const { payload, serviceId, pricing, paymentId, lockedSlotIds } = params
  let hasBookingChargesTable = false
  if (pricing.appliedFees.length > 0 && pricing.finalPriceCents >= pricing.totalFeeCents) {
    try {
      const tbl = await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Booking_Charges'").first()
      hasBookingChargesTable = Boolean(tbl)
    } catch {}
  }
  const priceAtBookingCents = hasBookingChargesTable ? pricing.finalPriceCents - pricing.totalFeeCents : pricing.finalPriceCents

  const batchStatements: D1PreparedStatement[] = [
    db.prepare(
      "INSERT INTO Bookings (service_id, slot_id, client_name, client_email, customer_phone, notes, attendees, price_at_booking, square_payment_id, status, coupon_code, deposit_paid, deposit_percent, photo_permission_portfolio, photo_permission_social, photo_permission_accepted_at, photo_permission_version, event_location, agreement_signed_name, agreement_signed_at, applied_fees_json, checkout_idempotency_key, locked_slot_ids_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      serviceId,
      payload.slotId,
      payload.clientName,
      payload.clientEmail,
      payload.customerPhone,
      payload.notes,
      payload.attendees,
      priceAtBookingCents,
      paymentId,
      pricing.validCouponCode,
      pricing.depositCents,
      pricing.depositPercent,
      payload.photoPermissionPortfolio,
      payload.photoPermissionSocial,
      payload.photoPermissionAcceptedAt,
      payload.photoPermissionVersion,
      payload.eventLocation,
      payload.agreementSignatureName || null,
      pricing.agreementSignedAt,
      JSON.stringify(pricing.appliedFees),
      payload.idempotencyKey,
      JSON.stringify(lockedSlotIds)
    )
  ]

  if (hasBookingChargesTable) {
    for (const fee of pricing.appliedFees) {
      if (fee.amountCents > 0) {
        const desc = String(fee.name || 'Dynamic fee').slice(0, 120)
        batchStatements.push(
          db.prepare(
            'INSERT INTO Booking_Charges (booking_id, description, amount_cents) SELECT id, ?, ? FROM Bookings WHERE checkout_idempotency_key = ?'
          ).bind(desc, fee.amountCents, payload.idempotencyKey)
        )
      }
    }
  }

  if (pricing.validCouponCode) {
    batchStatements.push(
      db.prepare('UPDATE Coupons SET used_count = COALESCE(used_count, 0) + 1 WHERE UPPER(code) = ?').bind(pricing.validCouponCode)
    )
  }

  const batchResults = await db.batch(batchStatements)
  return batchResults[0]?.meta?.last_row_id
}

export async function dispatchCheckoutSideEffects(
  c: Context<{ Bindings: Bindings }>,
  params: {
    bookingId: number | undefined
    payload: ParsedCheckoutPayload
    slot: any
    service: any
    pricing: ComputedCheckoutPricing
    balanceCents: number
    timeZone: string
    effectiveDurationMinutes: number
    windowEndTime: string
    publicOrigin: string
    calendarTargetEmail: string
  }
): Promise<{ rescheduleToken: string; rescheduleUrl: string; icsUrl: string; googleCalendarUrl: string }> {
  const { bookingId, payload, slot, service, pricing, balanceCents, timeZone, effectiveDurationMinutes, windowEndTime, publicOrigin, calendarTargetEmail } = params

  if (bookingId && balanceCents > 0) {
    try {
      const scheduledAt = localDateTimeToRFC3339(slot.date, slot.start_time, timeZone)
      const dueDateOverride = addDaysISO(slot.date, pricing.policy.balanceDueDaysAfterEvent)
      await sendBalanceInvoice(c.env.DB, c.env, bookingId, balanceCents, {
        ...(scheduledAt ? { scheduledAt } : {}),
        dueDateOverride
      })
    } catch (invoiceErr) {
      console.error('Checkout succeeded, but failed to schedule balance invoice:', { bookingId, error: invoiceErr })
    }
  }

  let rescheduleToken = ''
  let rescheduleUrl = ''
  let icsUrl = ''
  let googleCalendarUrl = ''

  if (bookingId) {
    const signingSecret = getSigningSecret(c.env) || (await getMediaSigningSecret(c.env))
    if (signingSecret) {
      rescheduleToken = await signRescheduleToken(bookingId, payload.clientEmail, signingSecret, { eventDate: slot.date })
      rescheduleUrl = `${publicOrigin}/reschedule?booking=${bookingId}&token=${encodeURIComponent(rescheduleToken)}`
      icsUrl = `${publicOrigin}/api/bookings/${bookingId}/calendar.ics?token=${encodeURIComponent(rescheduleToken)}`
    }

    const sessionEndTime = windowEndTime || computeSessionEndTime(slot.start_time, slot.end_time, effectiveDurationMinutes)
    const calendarBooking = {
      id: bookingId,
      date: slot.date,
      start_time: slot.start_time,
      end_time: sessionEndTime,
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      customer_phone: payload.customerPhone,
      package_name: pricing.packageTitle || service.name,
      service_name: service.name,
      status: 'confirmed',
      notes: payload.notes,
      location: payload.eventLocation,
      attendees: payload.attendees,
      timeZone
    }

    googleCalendarUrl = buildGoogleCalendarTemplateUrl(calendarBooking, rescheduleUrl, calendarTargetEmail)

    const backgroundTasks = Promise.allSettled([
      sendBookingConfirmationEmail(c.env, {
        bookingId,
        clientName: payload.clientName,
        clientEmail: payload.clientEmail,
        customerPhone: payload.customerPhone,
        packageName: pricing.packageTitle || service.name || 'Photography Session',
        date: slot.date,
        startTime: slot.start_time,
        endTime: sessionEndTime,
        location: payload.eventLocation,
        depositCents: pricing.depositCents,
        totalCents: pricing.finalPriceCents,
        balanceCents,
        rescheduleUrl,
        icsUrl,
        googleCalendarUrl
      }),
      syncBookingToGoogleCalendarApi(c.env, calendarBooking, 'upsert')
    ]).then((results) => {
      const emailSettlement = results[0]
      if (emailSettlement.status === 'rejected') {
        console.error('[checkout] Confirmation email promise rejected:', { bookingId, error: emailSettlement.reason })
      } else {
        const { client: clientEmailRes, admin: adminEmailRes } = emailSettlement.value
        if (!clientEmailRes.sent && clientEmailRes.reason !== 'not_configured') {
          console.error('[checkout] Client confirmation email failed:', { bookingId, reason: clientEmailRes.reason })
        }
        if (!adminEmailRes.sent && adminEmailRes.reason !== 'not_configured' && adminEmailRes.reason !== 'no_admin_email') {
          console.error('[checkout] Admin booking email failed:', { bookingId, reason: adminEmailRes.reason })
        }
      }
      if (results[1].status === 'rejected') {
        console.error('[checkout] Google Calendar sync rejected:', { bookingId, error: results[1].reason })
      }
    })

    try {
      c.executionCtx?.waitUntil(backgroundTasks)
    } catch {
      // Ignore when executionCtx is unavailable (e.g. unit tests)
    }
  }

  return { rescheduleToken, rescheduleUrl, icsUrl, googleCalendarUrl }
}

export const checkoutRouter = new Hono<{ Bindings: Bindings }>()

checkoutRouter.post('/', async (c) => {
  let slotLocked = false
  let lockedSlotIds: number[] = []
  let paymentConfirmed = false

  try {
    const limited = await enforceRouteRateLimit(c, {
      prefix: 'checkout',
      maxRequests: CHECKOUT_RATE_MAX_REQUESTS,
      windowSeconds: CHECKOUT_RATE_WINDOW_SECONDS,
      message: 'Too many checkout requests. Please wait a minute and try again.'
    })
    if (limited) return limited

    await ensureSchemaReady(c.env.DB)

    const parsed = await parseCheckoutPayload(c)
    if (!parsed.ok) return parsed.response
    const payload = parsed.data

    const bookingSetting: any = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'booking_enabled'"
    ).first()
    if (bookingSetting?.setting_value === 'false') {
      return c.json({
        error: {
          code: 'FORBIDDEN',
          message: 'Online bookings are currently disabled. Please contact us directly.',
          details: []
        }
      }, 403)
    }

    const publicOrigin = (c.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '') || new URL(c.req.url).origin
    const calendarTargetEmail = (c.env.GOOGLE_CALENDAR_ID || '').trim()

    const existingByIdem = await c.env.DB.prepare(
      `SELECT b.*, ss.date AS slot_date, ss.start_time AS slot_start_time, ss.end_time AS slot_end_time,
              s.name AS service_name, s.duration_minutes
       FROM Bookings b
       LEFT JOIN Schedule_Slots ss ON b.slot_id = ss.id
       LEFT JOIN Services s ON b.service_id = s.id
       WHERE b.checkout_idempotency_key = ?
       LIMIT 1`
    ).bind(payload.idempotencyKey).first<any>()
    if (existingByIdem) {
      return buildIdempotentCheckoutResponse(c, existingByIdem, publicOrigin, calendarTargetEmail)
    }

    const resolvedSlot = await validateAndResolveCheckoutSlot(c, payload)
    if (!resolvedSlot.ok) return resolvedSlot.response
    slotLocked = true
    lockedSlotIds = resolvedSlot.lockedSlotIds

    const pricingRes = await computeCheckoutPricing(c.env.DB, {
      payload,
      slot: resolvedSlot.slot,
      service: resolvedSlot.service,
      parsedServiceAdditionalPeople: resolvedSlot.parsedServiceAdditionalPeople,
      timeZone: resolvedSlot.timeZone
    })
    if (!pricingRes.ok) {
      await unlockCheckoutSlots(c.env.DB, lockedSlotIds)
      slotLocked = false
      return checkoutFormError(c, 400, 'VALIDATION_FAILED', 'Agreement signature is required.', [
        { field: 'agreementSignatureName', message: 'Agreement signature is required.', code: 'REQUIRED_FIELD' }
      ])
    }
    const pricing = pricingRes.pricing

    const paymentRes = await processSquareDepositPayment(c, payload, pricing)
    if (!paymentRes.ok) {
      await unlockCheckoutSlots(c.env.DB, lockedSlotIds)
      slotLocked = false
      return paymentRes.response
    }
    paymentConfirmed = true
    const { paymentId, orderId, squareClientRef } = paymentRes

    let bookingId: number | undefined
    try {
      bookingId = await persistBookingTransaction(c.env.DB, {
        payload,
        serviceId: resolvedSlot.service.id,
        pricing,
        paymentId,
        lockedSlotIds
      })
    } catch (bookingErr) {
      console.error('CRITICAL: Payment succeeded but booking insert failed:', {
        paymentId,
        orderId,
        slot_id: payload.slotId,
        service_id: resolvedSlot.service.id,
        customer_email: payload.clientEmail,
        error: bookingErr
      })
      await rollbackFailedCheckout(c.env.DB, {
        bookingId,
        paymentId,
        squareChargeCents: pricing.squareChargeCents,
        idempotencyKey: payload.idempotencyKey,
        squareClientRef,
        lockedSlotIds
      })
      slotLocked = false
      return c.json({
        error: {
          code: 'BOOKING_RECORD_ERROR',
          message: paymentId
            ? 'Your payment was processed (Ref: ' +
              paymentId +
              '), but we encountered an error saving your booking. We have initiated an automatic refund. Please contact us if you need assistance.'
            : 'We encountered an error saving your booking. Please try again.',
          details: paymentId ? [{ paymentId, orderId }] : []
        }
      }, 500)
    }

    const balanceCents = Math.max(0, pricing.finalPriceCents - pricing.depositCents)
    const links = await dispatchCheckoutSideEffects(c, {
      bookingId,
      payload,
      slot: resolvedSlot.slot,
      service: resolvedSlot.service,
      pricing,
      balanceCents,
      timeZone: resolvedSlot.timeZone,
      effectiveDurationMinutes: resolvedSlot.effectiveDurationMinutes,
      windowEndTime: resolvedSlot.windowEndTime,
      publicOrigin,
      calendarTargetEmail
    })

    return c.json({
      success: true,
      status: 'success',
      paymentId,
      orderId,
      bookingId,
      deposit_cents: pricing.depositCents,
      deposit_percent: pricing.depositPercent,
      total_cents: pricing.finalPriceCents,
      balance_cents: balanceCents,
      reschedule_token: links.rescheduleToken,
      reschedule_url: links.rescheduleUrl,
      ics_url: links.icsUrl,
      google_calendar_url: links.googleCalendarUrl,
      photo_consent: {
        portfolio: payload.photoPermissionPortfolio === 1,
        social: payload.photoPermissionSocial === 1,
        accepted_at: payload.photoPermissionAcceptedAt,
        version: payload.photoPermissionVersion
      },
      consent_summary: payload.consentSummary,
      applied_fees: pricing.appliedFees,
      event_location: payload.eventLocation,
      agreement_signed_name: payload.agreementSignatureName || null,
      agreement_signed_at: pricing.agreementSignedAt,
      data: {
        booking_id: bookingId,
        payment_id: paymentId,
        order_id: orderId,
        deposit_cents: pricing.depositCents,
        deposit_percent: pricing.depositPercent,
        total_cents: pricing.finalPriceCents,
        balance_cents: balanceCents,
        reschedule_token: links.rescheduleToken,
        reschedule_url: links.rescheduleUrl,
        ics_url: links.icsUrl,
        google_calendar_url: links.googleCalendarUrl,
        photo_permission_portfolio: payload.photoPermissionPortfolio,
        photo_permission_social: payload.photoPermissionSocial,
        photo_permission_accepted_at: payload.photoPermissionAcceptedAt,
        photo_permission_version: payload.photoPermissionVersion,
        consent_summary: payload.consentSummary,
        applied_fees: pricing.appliedFees,
        event_location: payload.eventLocation,
        agreement_signed_name: payload.agreementSignatureName || null,
        agreement_signed_at: pricing.agreementSignedAt
      }
    }, 201)
  } catch (e: any) {
    console.error('Checkout error:', e)
    if (slotLocked && !paymentConfirmed) {
      await unlockCheckoutSlots(c.env.DB, lockedSlotIds)
    }
    return c.json({
      error: {
        code: 'PAYMENT_FAILED',
        message: 'Your payment could not be processed. Please check your payment details and try again.',
        details: []
      }
    }, 500)
  }
})
