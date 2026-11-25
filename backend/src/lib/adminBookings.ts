import type { Context } from 'hono'
import type { Bindings } from '../index'
import { bookingsServiceIdNullable } from '../routes/admin'
import {
  getBufferMinutesFromRules,
  lockSlotsAtomically,
  parseTimeToMinutes,
  releaseBookingSlots,
  resolveBookingSlotIds,
  resolveSlotWindow,
  type SlotRowLike
} from './scheduleSync'
import { bookingTotalCents, parseNonNegativeMoneyToCents } from './billingMath'
import {
  BillingError,
  cancelOpenInvoice,
  getSquare,
  getStudioTimeZone,
  OPEN_INVOICE_EXISTS_SQL
} from './squareBilling'
import { mapRowToCalendarBooking, syncBookingToGoogleCalendarApi } from './googleCalendar'
import { isRealCalendarDate } from '../utils/validation'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BOOKING_STATUSES = ['pending', 'confirmed', 'cancelled']

export const ADMIN_CALENDAR_BOOKING_SELECT = `SELECT b.id, b.client_name, b.client_email, b.customer_phone,
        COALESCE(NULLIF(b.event_location, ''), b.location) AS location,
        b.notes, b.attendees, b.status,
        ss.date, ss.start_time, ss.end_time,
        s.name AS service_name
 FROM Bookings b
 INNER JOIN Schedule_Slots ss ON b.slot_id = ss.id
 LEFT JOIN Services s ON b.service_id = s.id`

export const INVALID_STATUS_RESPONSE = {
  error: {
    code: 'VALIDATION_FAILED',
    message: 'Status must be pending, confirmed or cancelled.',
    details: [{ field: 'status', message: 'Status must be pending, confirmed or cancelled.', code: 'INVALID_VALUE' }]
  }
}

export const INVOICE_OPEN_RESPONSE = {
  error: { code: 'INVOICE_OPEN', message: 'An invoice is out for this booking. Cancel it to change amounts.', details: [] }
}
export const BOOKING_NOT_FOUND_RESPONSE = { error: { code: 'NOT_FOUND', message: 'Booking not found.', details: [] } }
export const SCHEMA_PENDING_RESPONSE = {
  error: {
    code: 'SCHEMA_PENDING',
    message: "The database update for bookings without a package hasn't run yet. Try again in a minute.",
    details: []
  }
}
export const PACKAGE_MISSING_RESPONSE = {
  error: {
    code: 'VALIDATION_FAILED',
    message: 'The selected package no longer exists.',
    details: [{ field: 'packageId', message: 'The selected package no longer exists.', code: 'INVALID_VALUE' }]
  }
}

export function toConsentFlag(val: unknown): number {
  return val === true || val === 1 || val === '1' || val === 'true' ? 1 : 0
}

export function parseBookingStatus(raw: unknown): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  return BOOKING_STATUSES.includes(value) ? value : null
}

export function isPresentNumber(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

export function billingErrorResponse(c: Context, err: unknown, fallbackMessage = 'Something went wrong.') {
  if (err instanceof BillingError) {
    return c.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      err.httpStatus as 400 | 404 | 409 | 500 | 502 | 503
    )
  }
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: fallbackMessage, details: [] } }, 500)
}

export async function bookingStatusFor(db: D1Database, bookingId: string | number): Promise<string | null> {
  const row = await db.prepare('SELECT status FROM Bookings WHERE id = ?').bind(bookingId).first<{ status: string | null }>()
  return row ? String(row.status || '').toLowerCase() : null
}

export type NormalizedPackage = { kind: 'none' } | { kind: 'id'; id: number } | { kind: 'invalid' }

export function normalizePackageInput(raw: unknown): NormalizedPackage {
  if (raw === undefined || raw === null) return { kind: 'none' }
  const text = String(raw).trim()
  if (text === '' || text.toLowerCase() === 'none' || text.toLowerCase() === 'custom') return { kind: 'none' }
  if (!/^[1-9]\d{0,9}$/.test(text)) return { kind: 'invalid' }
  return { kind: 'id', id: Number(text) }
}

export function scheduleGoogleCalendarSync(
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

function normalizeSlotRow(row: SlotRowLike): SlotRowLike {
  return {
    ...row,
    is_booked: Number(row.is_booked) === 1 || (row.is_booked as unknown) === true ? 1 : 0
  }
}

export async function rollbackLockedSlots(db: D1Database, slotIds: readonly number[]): Promise<void> {
  if (slotIds.length === 0) return
  const ph = slotIds.map(() => '?').join(', ')
  await db
    .prepare(`UPDATE Schedule_Slots SET is_booked = 0 WHERE id IN (${ph})`)
    .bind(...slotIds)
    .run()
    .catch(() => {})
}

export async function validateAndLockBookingSlotWindow(
  db: D1Database,
  params: {
    slotId: number | string
    durationMinutes: number | null
    fullDay: boolean
    overrideDate?: string | null
    overrideStartTime?: string | null
    overrideEndTime?: string | null
    exemptSlotIds?: readonly number[]
  }
): Promise<{ ok: true; newlyLockedIds: number[]; windowSlotIds: number[] } | { ok: false; message: string }> {
  const rawSlot = await db
    .prepare('SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots WHERE id = ?')
    .bind(params.slotId)
    .first<SlotRowLike>()
  if (!rawSlot) {
    return { ok: false, message: 'The selected slot is already booked or does not exist.' }
  }

  const startSlot: SlotRowLike = normalizeSlotRow({
    ...rawSlot,
    date: params.overrideDate || rawSlot.date,
    start_time: params.overrideStartTime || rawSlot.start_time,
    end_time: params.overrideEndTime || rawSlot.end_time
  })

  const daySlotsRes = await db
    .prepare('SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots WHERE date = ? ORDER BY start_time ASC, id ASC')
    .bind(startSlot.date)
    .all<SlotRowLike>()
  const daySlots = (daySlotsRes.results || []).map((row) =>
    row.id === startSlot.id ? startSlot : normalizeSlotRow(row)
  )
  if (!daySlots.some((row) => row.id === startSlot.id)) {
    daySlots.push(startSlot)
  }

  let effectiveDuration = Number(params.durationMinutes) > 0 ? Number(params.durationMinutes) : 0
  if (!effectiveDuration) {
    const sStart = parseTimeToMinutes(startSlot.start_time)
    const sEnd = parseTimeToMinutes(startSlot.end_time)
    effectiveDuration = sStart !== null && sEnd !== null && sEnd > sStart
      ? (sEnd === 1439 ? 1440 : sEnd) - sStart
      : 60
  }

  const bufferMinutes = await getBufferMinutesFromRules(db)
  const windowRes = resolveSlotWindow({
    daySlots,
    startSlot,
    durationMinutes: effectiveDuration,
    fullDay: params.fullDay,
    bufferMinutes,
    exemptSlotIds: params.exemptSlotIds
  })
  if (!windowRes.ok) {
    const message =
      windowRes.reason === 'SLOT_OVERLAPS_BOOKED'
        ? 'The selected slot overlaps an existing booking.'
        : 'The selected slot does not have enough continuous availability for this service duration.'
    return { ok: false, message }
  }

  const lockRes = await lockSlotsAtomically(db, windowRes.slotIds, params.exemptSlotIds)
  if (!lockRes.ok) {
    return { ok: false, message: 'The selected slot is already booked or unavailable.' }
  }
  return { ok: true, newlyLockedIds: lockRes.newlyLockedIds, windowSlotIds: windowRes.slotIds }
}

function parseMoneyField(centsRaw: unknown, dollarsRaw: unknown, fallback: number | null): number | null {
  if (centsRaw !== undefined) {
    return centsRaw === null ? null : Math.max(0, Math.round(Number(centsRaw) || 0))
  }
  if (dollarsRaw !== undefined) {
    return parseNonNegativeMoneyToCents(dollarsRaw) ?? Math.max(0, Math.round((Number(dollarsRaw) || 0) * 100))
  }
  return fallback
}

function parseCouponField(body: Record<string, any>, fallback: string): string {
  if (body.coupon === undefined && body.coupon_code === undefined) return fallback
  if (typeof body.coupon === 'object' && body.coupon !== null) return String(body.coupon.code || '').trim()
  return String(body.coupon_code ?? body.coupon ?? '').trim()
}

export async function resolveAdminSlotAssignment(
  db: D1Database,
  params: {
    slotId?: unknown
    date?: string
    startTime: string
    endTime: string
    durationMinutes: number | null
    fullDay: boolean
  }
): Promise<
  | { ok: true; targetSlotId: number | string; slotWasCreated: boolean; lockedSlotIds: number[] }
  | { ok: false; status: 400 | 409; body: Record<string, unknown> }
> {
  if (params.slotId) {
    const lockRes = await validateAndLockBookingSlotWindow(db, {
      slotId: params.slotId as number | string,
      durationMinutes: params.durationMinutes,
      fullDay: params.fullDay
    })
    if (!lockRes.ok) {
      return { ok: false, status: 409, body: { error: { code: 'SLOT_ALREADY_BOOKED', message: lockRes.message, details: [] } } }
    }
    return { ok: true, targetSlotId: params.slotId as number | string, slotWasCreated: false, lockedSlotIds: lockRes.windowSlotIds }
  }

  const date = params.date ?? ''
  if (!date) {
    return { ok: false, status: 400, body: { error: { code: 'VALIDATION_FAILED', message: 'Slot ID or date/time details required.', details: [] } } }
  }
  if (!isRealCalendarDate(date)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Valid real calendar date is required (YYYY-MM-DD).',
          details: [{ field: 'date', message: 'Invalid date.', code: 'INVALID_FORMAT' }]
        }
      }
    }
  }
  const startMin = parseTimeToMinutes(params.startTime)
  const endMin = parseTimeToMinutes(params.endTime)
  if (startMin === null || endMin === null || endMin <= startMin) {
    return {
      ok: false,
      status: 400,
      body: { error: { code: 'VALIDATION_FAILED', message: 'Valid start_time and end_time (with end_time after start_time) are required.', details: [] } }
    }
  }

  const blocked = await db.prepare('SELECT id FROM Blocked_Dates WHERE date = ?').bind(date).first()
  if (blocked) {
    return { ok: false, status: 409, body: { error: { code: 'BLOCKED_DATE', message: 'Selected date is blocked.', details: [] } } }
  }

  const existingSlot = await db.prepare(
    'SELECT id, is_booked FROM Schedule_Slots WHERE date = ? AND start_time = ? ORDER BY is_booked ASC LIMIT 1'
  ).bind(date, params.startTime).first<{ id: number; is_booked: number }>()

  if (existingSlot) {
    const lockRes = await validateAndLockBookingSlotWindow(db, {
      slotId: existingSlot.id,
      durationMinutes: params.durationMinutes,
      fullDay: params.fullDay
    })
    if (!lockRes.ok) {
      return { ok: false, status: 409, body: { error: { code: 'SLOT_ALREADY_BOOKED', message: lockRes.message, details: [] } } }
    }
    return { ok: true, targetSlotId: existingSlot.id, slotWasCreated: false, lockedSlotIds: lockRes.windowSlotIds }
  }

  const slotResult = await db.prepare(
    'INSERT INTO Schedule_Slots (date, start_time, end_time, is_booked) VALUES (?, ?, ?, 0)'
  ).bind(date, params.startTime, params.endTime).run()
  const createdSlotId = slotResult.meta.last_row_id

  const lockRes = await validateAndLockBookingSlotWindow(db, {
    slotId: createdSlotId,
    durationMinutes: params.durationMinutes,
    fullDay: params.fullDay
  })
  if (!lockRes.ok) {
    await db.prepare('DELETE FROM Schedule_Slots WHERE id = ?').bind(createdSlotId).run().catch(() => {})
    return { ok: false, status: 409, body: { error: { code: 'SLOT_ALREADY_BOOKED', message: lockRes.message, details: [] } } }
  }
  return { ok: true, targetSlotId: createdSlotId, slotWasCreated: true, lockedSlotIds: lockRes.windowSlotIds }
}

async function resolveCreatePackageAndPrice(
  db: D1Database,
  body: Record<string, any>,
  initialCustomPrice: number | null
): Promise<
  | {
      ok: true
      targetServiceId: number | null
      serviceDurationMinutes: number | null
      serviceFullDay: boolean
      customPrice: number | null
      finalPrice: number | null
    }
  | { ok: false; status: 400 | 503; body: Record<string, unknown> }
> {
  const packageInput = normalizePackageInput(body.service_id ?? body.packageId)
  let customPrice = initialCustomPrice
  let finalPrice =
    body.price_at_booking !== undefined && body.price_at_booking !== null
      ? Math.max(0, Math.round(Number(body.price_at_booking) || 0))
      : customPrice

  if (packageInput.kind === 'none') {
    const rawDollars = body.totalPrice !== undefined ? body.totalPrice : body.price
    const noPackageCents = isPresentNumber(body.custom_price)
      ? Math.round(Number(body.custom_price))
      : isPresentNumber(rawDollars)
        ? (parseNonNegativeMoneyToCents(rawDollars) ?? Math.round(Number(rawDollars) * 100))
        : null
    if (noPackageCents === null || noPackageCents < 0) {
      return {
        ok: false,
        status: 400,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Enter a custom price for a booking without a package.',
            details: [{ field: 'custom_price', message: 'Enter a custom price for a booking without a package.', code: 'REQUIRED_FIELD' }]
          }
        }
      }
    }
    if (!(await bookingsServiceIdNullable(db))) {
      return { ok: false, status: 503, body: SCHEMA_PENDING_RESPONSE }
    }
    customPrice = noPackageCents
    if (body.price_at_booking === undefined || body.price_at_booking === null) finalPrice = noPackageCents
    return { ok: true, targetServiceId: null, serviceDurationMinutes: null, serviceFullDay: false, customPrice, finalPrice }
  }

  const svc = packageInput.kind === 'id'
    ? await db.prepare('SELECT id, price, duration_minutes, full_day FROM Services WHERE id = ?').bind(packageInput.id).first<any>()
    : null
  if (!svc) {
    return { ok: false, status: 400, body: PACKAGE_MISSING_RESPONSE }
  }
  return {
    ok: true,
    targetServiceId: Number(svc.id),
    serviceDurationMinutes: Number(svc.duration_minutes) > 0 ? Number(svc.duration_minutes) : null,
    serviceFullDay: Number(svc.full_day) === 1,
    customPrice,
    finalPrice: finalPrice ?? svc.price
  }
}

function parseManualBookingBody(body: Record<string, any>) {
  const client_name = String(body.client_name || body.customer_name || body.customer || body.client || '').trim()
  const client_email = String(body.client_email || body.customer_email || body.email || '').trim()
  const customer_phone = String(body.customer_phone || body.phone || '').trim()
  const location = String(body.location || '').trim()
  const notes = String(body.notes || '').trim()
  const attendees = Math.max(1, Math.min(50, Math.round(Number(body.people ?? body.attendees ?? 1) || 1)))
  const deposit_paid = parseMoneyField(body.deposit_paid, body.deposit, 0) ?? 0
  const coupon_code = parseCouponField(body, '')
  const initialCustomPrice = parseMoneyField(body.custom_price, body.totalPrice ?? body.price, null)
  const photo_permission_portfolio = toConsentFlag(
    body.photo_permission_portfolio ?? body.photoPermissions?.websitePortfolio ?? body.photoPermissions?.website_portfolio
  )
  const photo_permission_social = toConsentFlag(
    body.photo_permission_social ?? body.photoPermissions?.socialMedia ?? body.photoPermissions?.social_media
  )
  const photo_permission_accepted_at = photo_permission_portfolio || photo_permission_social ? new Date().toISOString() : null
  const date = typeof body.date === 'string' ? body.date.trim() : ''
  const startTime = String(body.start_time || body.startTime || body.time || '09:00').trim()
  const endTime = String(body.end_time || body.endTime || '10:00').trim()

  return {
    client_name,
    client_email,
    customer_phone,
    location,
    notes,
    attendees,
    deposit_paid,
    coupon_code,
    initialCustomPrice,
    photo_permission_portfolio,
    photo_permission_social,
    photo_permission_accepted_at,
    photo_permission_version: 'v1',
    date,
    startTime,
    endTime
  }
}

export async function createAdminManualBooking(
  c: Context<{ Bindings: Bindings }>,
  db: D1Database,
  body: Record<string, any>
): Promise<Response> {
  const fields = parseManualBookingBody(body)
  if (!fields.client_name || !fields.client_email) {
    return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Client name and email are required.', details: [] } }, 400)
  }
  if (!EMAIL_REGEX.test(fields.client_email)) {
    return c.json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Please enter a valid client email address.',
        details: [{ field: 'client_email', message: 'Invalid email format.', code: 'INVALID_FORMAT' }]
      }
    }, 400)
  }

  const status = body.status === undefined || body.status === null || body.status === ''
    ? 'confirmed'
    : parseBookingStatus(body.status)
  if (status === null) return c.json(INVALID_STATUS_RESPONSE, 400)

  const pkgRes = await resolveCreatePackageAndPrice(db, body, fields.initialCustomPrice)
  if (!pkgRes.ok) return c.json(pkgRes.body, pkgRes.status)

  const slotRes = await resolveAdminSlotAssignment(db, {
    slotId: body.slot_id ?? body.slotId,
    date: body.date !== undefined && body.date !== null && fields.date !== '' ? fields.date : undefined,
    startTime: fields.startTime,
    endTime: fields.endTime,
    durationMinutes: pkgRes.serviceDurationMinutes,
    fullDay: pkgRes.serviceFullDay
  })
  if (!slotRes.ok) return c.json(slotRes.body, slotRes.status)

  const { targetSlotId, slotWasCreated, lockedSlotIds } = slotRes
  const lockedSlotIdsJson = JSON.stringify(lockedSlotIds.length > 0 ? lockedSlotIds : [Number(targetSlotId)])

  let bookingResult: D1Result
  try {
    bookingResult = await db.prepare(
      `INSERT INTO Bookings (
        service_id, slot_id, client_name, client_email, price_at_booking, status,
        customer_phone, location, notes, attendees, deposit_paid, coupon_code, custom_price,
        photo_permission_portfolio, photo_permission_social, photo_permission_accepted_at, photo_permission_version,
        locked_slot_ids_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      pkgRes.targetServiceId,
      targetSlotId,
      fields.client_name,
      fields.client_email,
      pkgRes.finalPrice ?? 0,
      status,
      fields.customer_phone,
      fields.location,
      fields.notes,
      fields.attendees,
      fields.deposit_paid,
      fields.coupon_code,
      pkgRes.customPrice,
      fields.photo_permission_portfolio,
      fields.photo_permission_social,
      fields.photo_permission_accepted_at,
      fields.photo_permission_version,
      lockedSlotIdsJson
    ).run()
  } catch (insertErr) {
    if (slotWasCreated) {
      await db.prepare('DELETE FROM Schedule_Slots WHERE id = ?').bind(targetSlotId).run().catch(() => {})
    }
    const extraToUnlock = lockedSlotIds.filter((sid) => !slotWasCreated || sid !== Number(targetSlotId))
    if (extraToUnlock.length > 0) await rollbackLockedSlots(db, extraToUnlock)
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
}

export interface NormalizedBookingPatch {
  client_name: string
  client_email: string
  customer_phone: string
  location: string
  notes: string
  attendees: number
  deposit_paid: number
  coupon_code: string
  custom_price: number | null
  price_at_booking: number
  service_id: number | null
  service_price: unknown
  service_duration_minutes: number | null
  service_full_day: number | null
  status: string
  statusLower: string
  existingStatus: string
  photo_permission_portfolio: number
  photo_permission_social: number
  photo_permission_accepted_at: string | null
  photo_permission_version: string
  targetSlotId: number | null
  slotChanged: boolean
  scheduleFieldsChanged: boolean
  newDate?: string
  newStartTime?: string
  newEndTime?: string
}

function validatePatchDatesAndTimes(body: Record<string, any>):
  | { ok: true; newDate?: string; newStartTime?: string; newEndTime?: string }
  | { ok: false; body: Record<string, unknown> } {
  const newDate = body.date !== undefined && body.date !== null && String(body.date).trim() !== ''
    ? String(body.date).trim()
    : undefined
  if (newDate !== undefined && !isRealCalendarDate(newDate)) {
    return {
      ok: false,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Date must be a valid calendar date in YYYY-MM-DD format.',
          details: [{ field: 'date', message: 'Invalid date format.', code: 'INVALID_FORMAT' }]
        }
      }
    }
  }

  const newStartTime = (body.start_time ?? body.startTime) !== undefined
    ? String(body.start_time ?? body.startTime).trim()
    : undefined
  const newEndTime = (body.end_time ?? body.endTime) !== undefined
    ? String(body.end_time ?? body.endTime).trim()
    : undefined

  if (newStartTime !== undefined && parseTimeToMinutes(newStartTime) === null) {
    return {
      ok: false,
      body: { error: { code: 'VALIDATION_FAILED', message: 'Invalid start_time format.', details: [{ field: 'start_time', message: 'Invalid time.', code: 'INVALID_FORMAT' }] } }
    }
  }
  if (newEndTime !== undefined && parseTimeToMinutes(newEndTime) === null) {
    return {
      ok: false,
      body: { error: { code: 'VALIDATION_FAILED', message: 'Invalid end_time format.', details: [{ field: 'end_time', message: 'Invalid time.', code: 'INVALID_FORMAT' }] } }
    }
  }
  return { ok: true, newDate, newStartTime, newEndTime }
}

async function resolveUpdatedPackage(
  db: D1Database,
  body: Record<string, any>,
  existing: any
): Promise<
  | {
      ok: true
      packageSent: boolean
      service_id: number | null
      service_price: unknown
      service_duration_minutes: number | null
      service_full_day: number | null
    }
  | { ok: false; status: 400 | 503; body: Record<string, unknown> }
> {
  const packageSent = body.service_id !== undefined || body.packageId !== undefined
  if (!packageSent) {
    return {
      ok: true,
      packageSent: false,
      service_id: existing.service_id ?? null,
      service_price: existing.service_price,
      service_duration_minutes: existing.service_duration_minutes ?? null,
      service_full_day: existing.service_full_day ?? null
    }
  }

  const packageInput = normalizePackageInput(body.service_id !== undefined ? body.service_id : body.packageId)
  if (packageInput.kind === 'none') {
    if (existing.service_id !== null && existing.service_id !== undefined && !(await bookingsServiceIdNullable(db))) {
      return { ok: false, status: 503, body: SCHEMA_PENDING_RESPONSE }
    }
    return { ok: true, packageSent: true, service_id: null, service_price: null, service_duration_minutes: null, service_full_day: null }
  }

  const svc = packageInput.kind === 'id'
    ? await db.prepare('SELECT id, price, duration_minutes, full_day FROM Services WHERE id = ?').bind(packageInput.id).first<{ id: number; price: unknown; duration_minutes: number | null; full_day: number | null }>()
    : null
  if (!svc) return { ok: false, status: 400, body: PACKAGE_MISSING_RESPONSE }
  return {
    ok: true,
    packageSent: true,
    service_id: Number(svc.id),
    service_price: svc.price,
    service_duration_minutes: svc.duration_minutes ?? null,
    service_full_day: svc.full_day ?? null
  }
}

function buildNormalizedPatchValues(
  body: Record<string, any>,
  existing: any,
  client_name: string,
  client_email: string,
  dtCheck: { newDate?: string; newStartTime?: string; newEndTime?: string },
  pkg: { packageSent: boolean; service_id: number | null; service_price: unknown; service_duration_minutes: number | null; service_full_day: number | null },
  status: string
): NormalizedBookingPatch {
  const rawPhone = body.customer_phone ?? body.phone
  const rawAttendees = body.people ?? body.attendees
  const deposit_paid = parseMoneyField(body.deposit_paid, body.deposit, existing.deposit_paid ?? 0) ?? 0
  const custom_price = parseMoneyField(body.custom_price, body.totalPrice ?? body.price, existing.custom_price)
  const price_at_booking =
    body.price_at_booking !== undefined
      ? Math.max(0, Math.round(Number(body.price_at_booking) || 0))
      : (custom_price !== null && custom_price !== undefined ? custom_price : existing.price_at_booking)

  const rawPortfolioConsent = body.photo_permission_portfolio !== undefined
    ? body.photo_permission_portfolio
    : body.photoPermissions?.websitePortfolio ?? body.photoPermissions?.website_portfolio
  const rawSocialConsent = body.photo_permission_social !== undefined
    ? body.photo_permission_social
    : body.photoPermissions?.socialMedia ?? body.photoPermissions?.social_media
  const photo_permission_portfolio = rawPortfolioConsent !== undefined ? toConsentFlag(rawPortfolioConsent) : (existing.photo_permission_portfolio ? 1 : 0)
  const photo_permission_social = rawSocialConsent !== undefined ? toConsentFlag(rawSocialConsent) : (existing.photo_permission_social ? 1 : 0)

  const rawTargetSlotId = body.slot_id ?? body.slotId
  const targetSlotId =
    rawTargetSlotId !== undefined && rawTargetSlotId !== null && String(rawTargetSlotId).trim() !== ''
      ? Number(rawTargetSlotId)
      : existing.slot_id
  const slotChanged = Boolean(targetSlotId && Number(targetSlotId) !== Number(existing.slot_id))
  const scheduleFieldsChanged =
    slotChanged || dtCheck.newDate !== undefined || dtCheck.newStartTime !== undefined || dtCheck.newEndTime !== undefined || pkg.packageSent

  return {
    client_name,
    client_email,
    customer_phone: rawPhone !== undefined ? String(rawPhone).trim() : (existing.customer_phone || ''),
    location: body.location !== undefined ? String(body.location).trim() : (existing.location || ''),
    notes: body.notes !== undefined ? String(body.notes).trim() : (existing.notes || ''),
    attendees: rawAttendees !== undefined ? Math.max(1, Math.min(50, Math.round(Number(rawAttendees) || 1))) : (existing.attendees ?? 1),
    deposit_paid,
    coupon_code: parseCouponField(body, existing.coupon_code || ''),
    custom_price,
    price_at_booking,
    service_id: pkg.service_id,
    service_price: pkg.service_price,
    service_duration_minutes: pkg.service_duration_minutes,
    service_full_day: pkg.service_full_day,
    status,
    statusLower: String(status || '').toLowerCase(),
    existingStatus: String(existing.status || '').toLowerCase(),
    photo_permission_portfolio,
    photo_permission_social,
    photo_permission_accepted_at: photo_permission_portfolio || photo_permission_social
      ? (existing.photo_permission_accepted_at || new Date().toISOString())
      : null,
    photo_permission_version: existing.photo_permission_version || 'v1',
    targetSlotId,
    slotChanged,
    scheduleFieldsChanged,
    newDate: dtCheck.newDate,
    newStartTime: dtCheck.newStartTime,
    newEndTime: dtCheck.newEndTime
  }
}

export async function normalizeBookingPatch(
  db: D1Database,
  body: Record<string, any>,
  existing: any
): Promise<{ ok: true; patch: NormalizedBookingPatch } | { ok: false; status: 400 | 503; body: Record<string, unknown> }> {
  const rawName = body.client_name ?? body.customer_name ?? body.customer ?? body.client
  const client_name = rawName !== undefined ? String(rawName).trim() : existing.client_name

  const rawEmail = body.client_email ?? body.customer_email ?? body.email
  if (rawEmail !== undefined && rawEmail !== null && String(rawEmail).trim() !== '' && !EMAIL_REGEX.test(String(rawEmail).trim())) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Please enter a valid client email address.',
          details: [{ field: 'client_email', message: 'Invalid email format.', code: 'INVALID_FORMAT' }]
        }
      }
    }
  }
  const client_email = rawEmail !== undefined ? String(rawEmail).trim() : existing.client_email

  const dtCheck = validatePatchDatesAndTimes(body)
  if (!dtCheck.ok) return { ok: false, status: 400, body: dtCheck.body }

  const pkg = await resolveUpdatedPackage(db, body, existing)
  if (!pkg.ok) return pkg

  let status: string = existing.status
  if (body.status !== undefined) {
    const requested = parseBookingStatus(body.status)
    if (requested === null) return { ok: false, status: 400, body: INVALID_STATUS_RESPONSE }
    status = requested
  }

  return { ok: true, patch: buildNormalizedPatchValues(body, existing, client_name, client_email, dtCheck, pkg, status) }
}

async function lockUpdatedBookingSlotWindow(
  db: D1Database,
  id: string,
  existing: any,
  patch: NormalizedBookingPatch,
  reactivating: boolean
): Promise<
  | { ok: true; newlyLockedSlotIds: number[]; newWindowSlotIds: number[] | null }
  | { ok: false; status: 409; body: Record<string, unknown> }
> {
  if (patch.statusLower === 'cancelled' || (!reactivating && (!patch.scheduleFieldsChanged || !patch.targetSlotId))) {
    return { ok: true, newlyLockedSlotIds: [], newWindowSlotIds: null }
  }

  let checkDate = patch.newDate
  if (!checkDate && patch.slotChanged && patch.targetSlotId) {
    const targetSlotRow = await db.prepare('SELECT date FROM Schedule_Slots WHERE id = ?').bind(patch.targetSlotId).first<{ date: string }>()
    checkDate = targetSlotRow?.date
  }
  if (checkDate) {
    const blocked = await db.prepare('SELECT id FROM Blocked_Dates WHERE date = ?').bind(checkDate).first()
    if (blocked) {
      return { ok: false, status: 409, body: { error: { code: 'BLOCKED_DATE', message: 'Selected date is blocked.', details: [] } } }
    }
  }

  let exemptSlotIds: number[] = []
  if (!reactivating && existing.slot_id) {
    const { slotIds: oldIds, protectedOtherSlotIds } = await resolveBookingSlotIds(db, {
      bookingId: id,
      slotId: existing.slot_id,
      serviceId: existing.service_id
    })
    const protSet = new Set(protectedOtherSlotIds)
    exemptSlotIds = oldIds.filter((sid) => !protSet.has(sid))
  }

  const lockRes = await validateAndLockBookingSlotWindow(db, {
    slotId: patch.targetSlotId!,
    durationMinutes: Number(patch.service_duration_minutes) > 0 ? Number(patch.service_duration_minutes) : null,
    fullDay: Number(patch.service_full_day) === 1,
    overrideDate: patch.newDate ?? null,
    overrideStartTime: patch.newStartTime ?? null,
    overrideEndTime: patch.newEndTime ?? null,
    exemptSlotIds
  })
  if (!lockRes.ok) {
    return { ok: false, status: 409, body: { error: { code: 'SLOT_ALREADY_BOOKED', message: lockRes.message, details: [] } } }
  }
  return { ok: true, newlyLockedSlotIds: lockRes.newlyLockedIds, newWindowSlotIds: lockRes.windowSlotIds }
}

export async function updateAdminBooking(
  c: Context<{ Bindings: Bindings }>,
  db: D1Database,
  id: string,
  body: Record<string, any>
): Promise<Response> {
  const existing = await db.prepare(
    'SELECT b.*, s.price AS service_price, s.duration_minutes AS service_duration_minutes, s.full_day AS service_full_day FROM Bookings b LEFT JOIN Services s ON s.id = b.service_id WHERE b.id = ?'
  ).bind(id).first<any>()
  if (!existing) return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)

  const normalized = await normalizeBookingPatch(db, body, existing)
  if (!normalized.ok) return c.json(normalized.body, normalized.status)
  const patch = normalized.patch

  const cancelling = patch.statusLower === 'cancelled' && patch.existingStatus !== 'cancelled'
  if (cancelling) {
    await cancelOpenInvoice(db, c.env, id)
  }

  const reactivating = patch.statusLower !== 'cancelled' && patch.existingStatus === 'cancelled' && Boolean(patch.targetSlotId)
  const slotLock = await lockUpdatedBookingSlotWindow(db, id, existing, patch, reactivating)
  if (!slotLock.ok) return c.json(slotLock.body, slotLock.status)

  const lockedSlotIdsJson = slotLock.newWindowSlotIds !== null
    ? JSON.stringify(slotLock.newWindowSlotIds)
    : (existing.locked_slot_ids_json ?? null)

  const moneyChanged =
    bookingTotalCents({ custom_price: patch.custom_price, price_at_booking: patch.price_at_booking, service_price: patch.service_price }) !== bookingTotalCents(existing) ||
    Number(patch.deposit_paid) !== Number(existing.deposit_paid ?? 0) ||
    String(patch.service_id ?? '') !== String(existing.service_id ?? '')
  const guarded = moneyChanged || cancelling
  const lockSql = guarded ? ` AND NOT ${OPEN_INVOICE_EXISTS_SQL}` : ''
  const lockBinds: unknown[] = guarded ? [id] : []

  let update: D1Result
  try {
    update = await db.prepare(
      `UPDATE Bookings
       SET client_name = ?, client_email = ?, customer_phone = ?, location = ?, event_location = ?,
           notes = ?, attendees = ?, deposit_paid = ?, coupon_code = ?, custom_price = ?,
           price_at_booking = ?, service_id = ?, slot_id = ?, locked_slot_ids_json = ?, status = ?,
           photo_permission_portfolio = ?, photo_permission_social = ?, photo_permission_accepted_at = ?, photo_permission_version = ?
       WHERE id = ?${lockSql}`
    ).bind(
      patch.client_name,
      patch.client_email,
      patch.customer_phone,
      patch.location,
      patch.location,
      patch.notes,
      patch.attendees,
      patch.deposit_paid,
      patch.coupon_code,
      patch.custom_price,
      patch.price_at_booking,
      patch.service_id,
      patch.targetSlotId,
      lockedSlotIdsJson,
      patch.status,
      patch.photo_permission_portfolio,
      patch.photo_permission_social,
      patch.photo_permission_accepted_at,
      patch.photo_permission_version,
      id,
      ...lockBinds
    ).run()
  } catch (updateErr) {
    if (slotLock.newlyLockedSlotIds.length > 0) await rollbackLockedSlots(db, slotLock.newlyLockedSlotIds)
    throw updateErr
  }

  if (!update.meta.changes) {
    if (slotLock.newlyLockedSlotIds.length > 0) await rollbackLockedSlots(db, slotLock.newlyLockedSlotIds)
    if ((await bookingStatusFor(db, id)) === null) return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)
    return c.json(INVOICE_OPEN_RESPONSE, 409)
  }

  if (!patch.slotChanged && existing.slot_id && (patch.newDate !== undefined || patch.newStartTime !== undefined || patch.newEndTime !== undefined)) {
    await db.prepare(
      `UPDATE Schedule_Slots
       SET date = COALESCE(?, date), start_time = COALESCE(?, start_time), end_time = COALESCE(?, end_time)
       WHERE id = ?`
    ).bind(patch.newDate || null, patch.newStartTime || null, patch.newEndTime || null, existing.slot_id).run()
  }

  if (patch.statusLower !== 'cancelled' && !reactivating && slotLock.newWindowSlotIds !== null && existing.slot_id) {
    await releaseBookingSlots(db, id, existing.slot_id, { keepSlotIds: slotLock.newWindowSlotIds })
  }
  if (patch.statusLower === 'cancelled' && existing.slot_id) {
    await releaseBookingSlots(db, id, existing.slot_id)
  }

  scheduleGoogleCalendarSync(c, id, patch.statusLower === 'cancelled' ? 'delete' : 'upsert')
  return c.json({ success: true, status: 'success' })
}

async function recordSquareRefundPayment(
  db: D1Database,
  bookingId: string,
  refundedCents: number,
  squareRefundId: string | null
): Promise<void> {
  const paidOn = new Date().toISOString().slice(0, 10)
  if (squareRefundId) {
    await db.prepare(
      `INSERT INTO Booking_Payments (booking_id, amount, method, paid_on, note, square_refund_id)
       VALUES (?, ?, 'refund', ?, ?, ?)
       ON CONFLICT(square_refund_id) WHERE square_refund_id IS NOT NULL DO NOTHING`
    ).bind(bookingId, -refundedCents, paidOn, `Square refund (${squareRefundId})`, squareRefundId).run()
    return
  }

  const existingRefund = await db.prepare(
    "SELECT id FROM Booking_Payments WHERE booking_id = ? AND method = 'refund' AND amount = ? LIMIT 1"
  ).bind(bookingId, -refundedCents).first<{ id: number }>()
  if (!existingRefund) {
    await db.prepare(
      'INSERT INTO Booking_Payments (booking_id, amount, method, paid_on, note) VALUES (?, ?, ?, ?, ?)'
    ).bind(bookingId, -refundedCents, 'refund', paidOn, 'Square refund').run()
  }
}

export async function cancelAdminBookingWithRefund(
  c: Context<{ Bindings: Bindings }>,
  db: D1Database,
  id: string,
  body: { refund?: boolean; reason?: string }
): Promise<Response> {
  const shouldRefund = body?.refund !== false
  const booking = await db.prepare(
    'SELECT slot_id, status, square_payment_id, deposit_paid FROM Bookings WHERE id = ?'
  ).bind(id).first<{
    slot_id: number | null
    status: string | null
    square_payment_id: string | null
    deposit_paid: number | null
  }>()
  if (!booking) return c.json(BOOKING_NOT_FOUND_RESPONSE, 404)

  const previousStatus = booking.status || 'confirmed'
  if (String(previousStatus).toLowerCase() === 'cancelled') {
    return c.json({ success: true, status: 'success', refundedCents: 0 })
  }

  await cancelOpenInvoice(db, c.env, id)

  const cancelled = await db.prepare(
    `UPDATE Bookings SET status = 'cancelled'
     WHERE id = ? AND LOWER(COALESCE(status, '')) != 'cancelled' AND NOT ${OPEN_INVOICE_EXISTS_SQL}`
  ).bind(id, id).run()
  if (!cancelled.meta?.changes) {
    if ((await bookingStatusFor(db, id)) === 'cancelled') {
      return c.json({ success: true, status: 'success', refundedCents: 0 })
    }
    return c.json(INVOICE_OPEN_RESPONSE, 409)
  }

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
        await recordSquareRefundPayment(db, id, refundedCents, squareRefundId)
      }
    } catch (err: unknown) {
      console.error('[admin] Cancel refund failed after status transition; restoring booking status:', {
        bookingId: id,
        previousStatus,
        error: err instanceof Error ? err.message : String(err)
      })
      await db.prepare('UPDATE Bookings SET status = ? WHERE id = ?').bind(previousStatus, id).run().catch((restoreErr) => {
        console.error('[admin] CRITICAL: Failed to restore booking status after refund error:', {
          bookingId: id,
          error: restoreErr
        })
      })
      return billingErrorResponse(c, err, 'Could not refund Square payment.')
    }
  }

  if (booking.slot_id) await releaseBookingSlots(db, id, booking.slot_id)
  scheduleGoogleCalendarSync(c, id, 'delete')
  return c.json({ success: true, status: 'success', refundedCents, squareRefundId })
}
