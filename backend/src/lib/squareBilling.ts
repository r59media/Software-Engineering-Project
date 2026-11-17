/**
 * Square billing helpers shared by checkout and the admin billing routes.
 * The Square SDK is imported lazily, so nothing from 'square' loads until a Square call is made.
 */
import type { Bindings } from '../index.ts'
import type { BookingTotals } from './billingMath.ts'
import {
  OPEN_INVOICE_STATUSES,
  PAID_LIKE_STATUSES,
  INVOICE_DUE_DAYS,
  STALE_SEND_MS,
  DEFAULT_TIMEZONE,
  isOpenInvoiceStatus,
  computeTotals,
  buildInvoiceLines,
  addDaysISO,
  dateInTimeZone,
  invoiceStatusLabel
} from './billingMath.ts'

type SquareSdk = typeof import('square')
export type SquareClient = InstanceType<SquareSdk['SquareClient']>

const GENERIC_SQUARE_ERROR = 'Square request failed. Try again in a minute.'
const SQUARE_NOTE_MAX = 500

export interface HybridSquareNoteInput {
  category?: string | null
  packageName?: string | null
  date?: string | null
  time?: string | null
  guests?: number | null
  couponCode?: string | null
  photoPermissionPortfolio?: boolean | number | null
  photoPermissionSocial?: boolean | number | null
  bookingId?: string | number | null
}

/**
 * Formats a concise, <= 500 char hybrid booking/category/consent note for Square Orders, Payments, and Invoices.
 */
export function buildHybridSquareNote(input: HybridSquareNoteInput): string {
  const cat = typeof input.category === 'string' ? input.category.trim() : ''
  const pkg = typeof input.packageName === 'string' && input.packageName.trim() ? input.packageName.trim() : 'Custom Session'
  const header = cat ? `[Category: ${cat}] ${pkg}` : pkg

  const parts: string[] = [header]
  const dateTime = [input.date, input.time]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(' ')
  if (dateTime) parts.push(dateTime)

  if (input.guests != null && Number.isFinite(Number(input.guests)) && Number(input.guests) > 0) {
    parts.push(`Guests: ${Math.round(Number(input.guests))}`)
  }

  const coupon = typeof input.couponCode === 'string' ? input.couponCode.trim() : ''
  if (coupon) parts.push(`Coupon: ${coupon}`)

  const websiteConsent = input.photoPermissionPortfolio ? 'YES' : 'NO'
  const socialConsent = input.photoPermissionSocial ? 'YES' : 'NO'
  parts.push(`Photo Consent: Website=${websiteConsent}, Social=${socialConsent}`)

  if (input.bookingId !== undefined && input.bookingId !== null && String(input.bookingId).trim() !== '') {
    parts.push(`Booking #${String(input.bookingId).trim()}`)
  }

  const full = parts.join(' | ')
  return full.length > SQUARE_NOTE_MAX ? `${full.slice(0, SQUARE_NOTE_MAX - 3)}...` : full
}

/** An error with an API error code and HTTP status, mapped to `{ error: { code, message, details } }`. */
export class BillingError extends Error {
  code: string
  httpStatus: number
  details: unknown[]

  constructor(code: string, httpStatus: number, message: string, details: unknown[] = []) {
    super(message)
    this.name = 'BillingError'
    this.code = code
    this.httpStatus = httpStatus
    this.details = details
  }
}

/** Thrown when SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID is missing. */
export class SquareNotConfiguredError extends BillingError {
  constructor() {
    super('SQUARE_NOT_CONFIGURED', 503, "Square isn't set up on the server.")
    this.name = 'SquareNotConfiguredError'
  }
}

let squareSdkPromise: Promise<SquareSdk> | null = null
function getSquareSdk(): Promise<SquareSdk> {
  if (!squareSdkPromise) {
    squareSdkPromise = import('square')
  }
  return squareSdkPromise
}

/** The Square client and location for this environment. Throws SquareNotConfiguredError when not configured. */
export async function getSquare(
  env: Pick<Bindings, 'SQUARE_ACCESS_TOKEN' | 'SQUARE_LOCATION_ID' | 'SQUARE_ENVIRONMENT'>
): Promise<{ client: SquareClient; locationId: string }> {
  const token = env.SQUARE_ACCESS_TOKEN
  const locationId = env.SQUARE_LOCATION_ID
  if (!token || !locationId) {
    throw new SquareNotConfiguredError()
  }
  const { SquareClient, SquareEnvironment } = await getSquareSdk()
  const client = new SquareClient({
    token,
    environment: env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox
  })
  return { client, locationId }
}

/** Square's first error detail, or a generic message. Never includes tokens or the raw error message. */
export function squareErrorMessage(err: unknown): string {
  const errors = (err as { errors?: unknown } | null | undefined)?.errors
  if (Array.isArray(errors)) {
    const detail = (errors[0] as { detail?: unknown } | null | undefined)?.detail
    if (typeof detail === 'string' && detail.trim() !== '') return detail
  }
  return GENERIC_SQUARE_ERROR
}

/** True when a Square SDK error is a 404. */
export function isSquareNotFound(err: unknown): boolean {
  return (err as { statusCode?: unknown } | null | undefined)?.statusCode === 404
}

// ── Phase 3: billing service (Flows 2–5 and 7 of the design doc) ──────────────

export type BillingEnv = Pick<Bindings, 'SQUARE_ACCESS_TOKEN' | 'SQUARE_LOCATION_ID' | 'SQUARE_ENVIRONMENT'>
export type RequestOptions = { timeoutInSeconds?: number; maxRetries?: number }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UNCONFIRMED_MESSAGE = "Square didn't confirm the invoice. Open the booking again in a minute to check."
const SENDING_MESSAGE = 'An invoice is being sent for this booking. Try again in a minute.'
const OPEN_STATUS_LIST = OPEN_INVOICE_STATUSES.map((s) => `'${s}'`).join(',')

/**
 * Lock condition used inside guarded writes: `... WHERE ... AND NOT ${OPEN_INVOICE_EXISTS_SQL}`.
 * Bind the booking id for its `?`.
 */
export const OPEN_INVOICE_EXISTS_SQL =
  `EXISTS (SELECT 1 FROM Booking_Invoices WHERE booking_id = ? AND status IN (${OPEN_STATUS_LIST}))`

/** Payments with the status of their linked invoice (if any), in the order GET /payments returns them. */
export const PAYMENTS_SELECT_SQL = `SELECT p.id, p.booking_id, p.amount, p.method, p.paid_on, p.note, p.created_at,
       p.square_invoice_id, i.status AS invoice_status
FROM Booking_Payments p
LEFT JOIN Booking_Invoices i ON i.square_invoice_id = p.square_invoice_id
WHERE p.booking_id = ?
ORDER BY p.paid_on ASC, p.id ASC`

const BOOKING_SELECT_SQL = `SELECT b.id, b.status, b.client_name, b.client_email, b.service_id, b.custom_price,
       b.price_at_booking, b.deposit_paid, b.deposit_percent,
       b.photo_permission_portfolio, b.photo_permission_social,
       s.price AS service_price, s.name AS service_name, sl.date AS date
FROM Bookings b
LEFT JOIN Services s ON b.service_id = s.id
LEFT JOIN Schedule_Slots sl ON b.slot_id = sl.id
WHERE b.id = ?`

const BOOKING_SUMS_SQL = `SELECT
  (SELECT COALESCE(SUM(amount), 0) FROM Booking_Payments WHERE booking_id = ?) AS payments_total,
  (SELECT COALESCE(SUM(amount_cents), 0) FROM Booking_Charges WHERE booking_id = ?) AS charges_total`

const CHARGES_SELECT_SQL = 'SELECT * FROM Booking_Charges WHERE booking_id = ? ORDER BY id ASC'
const INVOICES_SELECT_SQL = 'SELECT * FROM Booking_Invoices WHERE booking_id = ? ORDER BY id DESC'
const OPEN_INVOICE_SELECT_SQL =
  `SELECT * FROM Booking_Invoices WHERE booking_id = ? AND status IN (${OPEN_STATUS_LIST}) ORDER BY id DESC LIMIT 1`

// ── Settings ──────────────────────────────────────────────────────

/** Admin_Settings.timezone (trimmed), or America/New_York when unset or unreadable. */
export async function getStudioTimeZone(db: D1Database): Promise<string> {
  try {
    const row = await db.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'timezone'"
    ).first<{ setting_value: string }>()
    const value = typeof row?.setting_value === 'string' ? row.setting_value.trim() : ''
    return value || DEFAULT_TIMEZONE
  } catch {
    return DEFAULT_TIMEZONE
  }
}

/** Today's date (YYYY-MM-DD) in the studio time zone. */
export async function studioTodayISO(db: D1Database): Promise<string> {
  return dateInTimeZone(await getStudioTimeZone(db))
}

// ── Loaders and JSON shapes ───────────────────────────────────────

function totalsFrom(booking: any, sums: any): BookingTotals {
  return computeTotals(booking, Number(sums?.payments_total) || 0, Number(sums?.charges_total) || 0)
}

/** One booking (with package price, name and slot date) and its totals; null when the booking is missing. */
export async function loadBookingTotals(
  db: D1Database,
  bookingId: string | number
): Promise<{ booking: any; totals: BookingTotals } | null> {
  const booking = await db.prepare(BOOKING_SELECT_SQL).bind(bookingId).first<any>()
  if (!booking) return null
  const sums = await db.prepare(BOOKING_SUMS_SQL).bind(bookingId, bookingId).first<any>()
  return { booking, totals: totalsFrom(booking, sums) }
}

export function toChargeJSON(row: any) {
  const amount_cents = Number(row.amount_cents) || 0
  return {
    id: row.id,
    booking_id: row.booking_id,
    description: row.description,
    amount_cents,
    amount: amount_cents / 100,
    created_at: row.created_at
  }
}

export function toInvoiceJSON(row: any, today: string) {
  const amount_cents = Number(row.amount_cents) || 0
  return {
    id: row.id,
    booking_id: row.booking_id,
    square_invoice_id: row.square_invoice_id ?? null,
    invoice_number: row.invoice_number ?? null,
    status: row.status,
    label: invoiceStatusLabel(row.status, row.due_date, today),
    is_open: isOpenInvoiceStatus(row.status),
    amount_cents,
    amount: amount_cents / 100,
    due_date: row.due_date ?? null,
    public_url: row.public_url ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

/** A Booking_Payments row (from PAYMENTS_SELECT_SQL) as JSON. Not removable while its invoice is PAID. */
export function toPayment(row: any) {
  const amount_cents = Number(row.amount) || 0
  const square_invoice_id = row.square_invoice_id ?? null
  return {
    id: row.id,
    booking_id: row.booking_id,
    amount_cents,
    amount: amount_cents / 100,
    method: row.method,
    paid_on: row.paid_on,
    note: row.note || '',
    created_at: row.created_at,
    square_invoice_id,
    removable: !(square_invoice_id && row.invoice_status === 'PAID')
  }
}

/** Charges (oldest first), invoices (newest first), payments and totals, read in one D1 batch. null if the booking is missing. */
export async function loadBilling(
  db: D1Database,
  bookingId: string | number
): Promise<{ charges: any[]; invoices: any[]; payments: any[]; totals: BookingTotals } | null> {
  const [bookingRes, sumsRes, chargesRes, invoicesRes, paymentsRes] = await db.batch<any>([
    db.prepare(BOOKING_SELECT_SQL).bind(bookingId),
    db.prepare(BOOKING_SUMS_SQL).bind(bookingId, bookingId),
    db.prepare(CHARGES_SELECT_SQL).bind(bookingId),
    db.prepare(INVOICES_SELECT_SQL).bind(bookingId),
    db.prepare(PAYMENTS_SELECT_SQL).bind(bookingId)
  ])
  const booking = bookingRes?.results?.[0]
  if (!booking) return null
  const today = await studioTodayISO(db)
  return {
    charges: (chargesRes?.results || []).map(toChargeJSON),
    invoices: (invoicesRes?.results || []).map((row: any) => toInvoiceJSON(row, today)),
    payments: (paymentsRes?.results || []).map(toPayment),
    totals: totalsFrom(booking, sumsRes?.results?.[0])
  }
}

// ── Square helpers ────────────────────────────────────────────────

function isSquareConfigured(env: BillingEnv): boolean {
  return Boolean(env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID)
}

/** A BillingError as is; anything else (Square or network) as 502 SQUARE_ERROR with Square's message. */
function toSquareFailure(err: unknown): BillingError {
  if (err instanceof BillingError) return err
  return new BillingError('SQUARE_ERROR', 502, squareErrorMessage(err))
}

/** Reads a field by its camelCase name, falling back to snake_case. */
function pick(obj: any, camel: string, snake: string): any {
  if (!obj) return undefined
  return obj[camel] !== undefined ? obj[camel] : obj[snake]
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function formatDollars(cents: number): string {
  return (cents / 100).toFixed(2)
}

/** "Nov 6, 2026" for a YYYY-MM-DD date, or '' when it is not one. */
function formatSlotDate(date: unknown): string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return ''
  const at = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(at)
}

/** "Balance for <Package> on <Mon D, YYYY>"; "Session" when there is no package, no "on …" when there is no slot date. */
function invoiceTitle(booking: any): string {
  const name = typeof booking.service_name === 'string' ? booking.service_name.trim() : ''
  const pkg = name || 'Session'
  const when = formatSlotDate(booking.date)
  return when ? `Balance for ${pkg} on ${when}` : `Balance for ${pkg}`
}

/** Flow 2 step 4: find the Square customer by the booking's normalized email, or create one. Nothing is stored. */
export async function ensureCustomer(client: SquareClient, booking: any, attemptKey: string): Promise<string> {
  const email = String(booking.client_email ?? '').trim().toLowerCase()
  const found = await client.customers.search({
    query: { filter: { emailAddress: { exact: email } } },
    limit: BigInt(10)
  })
  const match = (found.customers || []).find(
    (customer) => customer.id && String(customer.emailAddress ?? '').trim().toLowerCase() === email
  )
  if (match?.id) return match.id
  const fullName = String(booking.client_name ?? '').trim()
  const nameParts = fullName ? fullName.split(/\s+/) : []
  const givenName = nameParts[0] || undefined
  const familyName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined
  const phone = String(booking.customer_phone ?? '').trim() || undefined
  const created = await client.customers.create({
    idempotencyKey: `${attemptKey}-customer`,
    givenName,
    familyName,
    emailAddress: email,
    phoneNumber: phone
  })
  const id = created.customer?.id
  if (!id) throw new Error('Square returned no customer id')
  return id
}

// ── Flow 3: syncInvoice ───────────────────────────────────────────

/**
 * Saves a Square invoice (read from Square, never from a webhook body) onto its Booking_Invoices row, and records
 * the collected amount as one Booking_Payments row when it is paid or refunded. Safe to run any number of times.
 */
export async function syncInvoice(db: D1Database, invoice: any, timeZone: string): Promise<void> {
  const squareInvoiceId = invoice?.id
  if (!squareInvoiceId) return
  const status: string | null = typeof invoice.status === 'string' ? invoice.status : null
  const version = toNumberOrNull(invoice.version)
  const invoiceNumber = pick(invoice, 'invoiceNumber', 'invoice_number') ?? null
  const publicUrl = pick(invoice, 'publicUrl', 'public_url') ?? null
  const rawRequests = pick(invoice, 'paymentRequests', 'payment_requests')
  const requests: any[] = Array.isArray(rawRequests) ? rawRequests : []
  const dueDate = pick(invoice, 'dueDate', 'due_date') ?? pick(requests[0], 'dueDate', 'due_date') ?? null

  // Step 1: an older read never overwrites a newer one. A DRAFT read never replaces our CREATING marker:
  // a send in progress owns that row until publish returns (Flows 2 and 5 handle drafts themselves).
  await db.prepare(
    `UPDATE Booking_Invoices
     SET status = COALESCE(?, status), version = COALESCE(?, version), invoice_number = COALESCE(?, invoice_number),
         public_url = COALESCE(?, public_url), due_date = COALESCE(?, due_date), updated_at = CURRENT_TIMESTAMP
     WHERE square_invoice_id = ? AND (version IS NULL OR version <= ?)
       AND NOT (status = 'CREATING' AND COALESCE(?, '') = 'DRAFT')`
  ).bind(status, version, invoiceNumber, publicUrl, dueDate, squareInvoiceId, version, status).run()

  // Step 2, independent of step 1.
  const collected = requests.reduce((sum: number, request: any) => {
    const money = pick(request, 'totalCompletedAmountMoney', 'total_completed_amount_money')
    return sum + (Number(money?.amount) || 0)
  }, 0)
  if (!(collected > 0) || !status || !PAID_LIKE_STATUSES.includes(status)) return

  const owner = await db.prepare(
    'SELECT booking_id FROM Booking_Invoices WHERE square_invoice_id = ?'
  ).bind(squareInvoiceId).first<{ booking_id: number }>()
  if (!owner) return

  const updatedAtRaw = pick(invoice, 'updatedAt', 'updated_at')
  let paidAt = updatedAtRaw ? new Date(updatedAtRaw) : new Date()
  if (Number.isNaN(paidAt.getTime())) paidAt = new Date()
  const note = invoiceNumber ? `Square invoice #${invoiceNumber}` : 'Square invoice'

  await db.prepare(
    `INSERT INTO Booking_Payments (booking_id, amount, method, paid_on, note, square_invoice_id)
     VALUES (?, ?, 'Square', ?, ?, ?)
     ON CONFLICT(square_invoice_id) DO NOTHING`
  ).bind(owner.booking_id, Math.round(collected), dateInTimeZone(timeZone, paidAt), note, squareInvoiceId).run()
}

/** invoices.get, then syncInvoice. Rethrows Square errors (callers decide what a 404 means). Returns the Square invoice. */
export async function fetchAndSyncInvoice(
  db: D1Database,
  env: BillingEnv,
  squareInvoiceId: string,
  requestOptions?: RequestOptions
): Promise<any> {
  const { client } = await getSquare(env)
  const res = await client.invoices.get({ invoiceId: squareInvoiceId }, requestOptions)
  const invoice = res.invoice
  if (invoice) await syncInvoice(db, invoice, await getStudioTimeZone(db))
  return invoice
}

// ── Flow 5: resolveStaleSends ─────────────────────────────────────

/**
 * Resolves CREATING rows older than STALE_SEND_MS: no Square id -> delete; DRAFT in Square -> delete there and here;
 * anything else -> sync. When Square can't be reached (or isn't configured) the row is left and stale is true.
 * `requestOptions` (optional, beyond the contract) lets the re-check use its short timeout.
 */
export async function resolveStaleSends(
  db: D1Database,
  env: BillingEnv,
  bookingId: string | number,
  requestOptions?: RequestOptions
): Promise<{ stale: boolean }> {
  const { results } = await db.prepare(
    `SELECT * FROM Booking_Invoices
     WHERE booking_id = ? AND status = 'CREATING' AND created_at <= datetime('now', ?)`
  ).bind(bookingId, `-${Math.round(STALE_SEND_MS / 1000)} seconds`).all<any>()
  const rows = results || []
  if (rows.length === 0) return { stale: false }

  let stale = false
  let timeZone: string | null = null
  for (const row of rows) {
    if (!row.square_invoice_id) {
      await db.prepare(
        "DELETE FROM Booking_Invoices WHERE id = ? AND status = 'CREATING' AND square_invoice_id IS NULL"
      ).bind(row.id).run()
      continue
    }
    try {
      const { client } = await getSquare(env)
      const invoice = (await client.invoices.get({ invoiceId: row.square_invoice_id }, requestOptions)).invoice
      if (!invoice) {
        stale = true
        continue
      }
      if (invoice.status === 'DRAFT') {
        await client.invoices.delete({ invoiceId: row.square_invoice_id, version: toNumberOrNull(invoice.version) }, requestOptions)
        await db.prepare("DELETE FROM Booking_Invoices WHERE id = ? AND status = 'CREATING'").bind(row.id).run()
      } else {
        timeZone = timeZone ?? (await getStudioTimeZone(db))
        await syncInvoice(db, invoice, timeZone)
      }
    } catch (err) {
      if (isSquareNotFound(err)) {
        // Square has no such invoice (only drafts can be deleted), so nothing was emailed: drop our row.
        await db.prepare("DELETE FROM Booking_Invoices WHERE id = ? AND status = 'CREATING'").bind(row.id).run()
      } else {
        stale = true
      }
    }
  }
  return { stale }
}

// ── Flow 7: refreshBilling ────────────────────────────────────────

const RECHECK_OPTIONS: RequestOptions = { timeoutInSeconds: 5, maxRetries: 1 }

/** GET /billing: resolve stuck sends, re-read each open invoice from Square, then load everything from D1. */
export async function refreshBilling(
  db: D1Database,
  env: BillingEnv,
  bookingId: string | number
): Promise<{ charges: any[]; invoices: any[]; payments: any[]; totals: BookingTotals; stale: boolean } | null> {
  const exists = await db.prepare('SELECT id FROM Bookings WHERE id = ?').bind(bookingId).first()
  if (!exists) return null

  let stale = false
  try {
    stale = (await resolveStaleSends(db, env, bookingId, RECHECK_OPTIONS)).stale
  } catch {
    stale = true
  }

  const { results } = await db.prepare(
    `SELECT square_invoice_id FROM Booking_Invoices
     WHERE booking_id = ? AND status IN (${OPEN_STATUS_LIST}) AND square_invoice_id IS NOT NULL`
  ).bind(bookingId).all<{ square_invoice_id: string }>()
  for (const row of results || []) {
    try {
      await fetchAndSyncInvoice(db, env, row.square_invoice_id, RECHECK_OPTIONS)
    } catch {
      stale = true
    }
  }

  const billing = await loadBilling(db, bookingId)
  return billing ? { ...billing, stale } : null
}

// ── Flow 2: sendBalanceInvoice ────────────────────────────────────

/** Sends a Square invoice for the booking's balance. Throws BillingError for every error case. */
export async function sendBalanceInvoice(
  db: D1Database,
  env: BillingEnv,
  bookingId: string | number,
  expectedCents: unknown,
  options?: { scheduledAt?: string }
): Promise<{ invoice: any; totals: BookingTotals }> {
  // Pre-checks, in the doc's order.
  const initial = await loadBookingTotals(db, bookingId)
  if (!initial) throw new BillingError('NOT_FOUND', 404, 'Booking not found.')
  if (String(initial.booking.status ?? '').trim().toLowerCase() === 'cancelled') {
    throw new BillingError('BOOKING_CANCELLED', 409, "Cancelled bookings can't be invoiced.")
  }
  if (!isSquareConfigured(env)) throw new SquareNotConfiguredError()
  if (!EMAIL_PATTERN.test(String(initial.booking.client_email ?? '').trim())) {
    throw new BillingError('INVALID_EMAIL', 400, 'Add a valid client email to this booking before sending an invoice.')
  }
  if (typeof expectedCents !== 'number' || !Number.isSafeInteger(expectedCents)) {
    throw new BillingError('VALIDATION_FAILED', 400, 'Check the highlighted fields.', [
      { field: 'expected_amount_cents', message: 'Expected amount must be a whole number of cents.' }
    ])
  }
  const id = initial.booking.id

  // 1. Clear stuck sends.
  await resolveStaleSends(db, env, id)

  // 2. Claim the booking (the partial unique index allows one open invoice per booking).
  const attemptKey = crypto.randomUUID()
  try {
    await db.prepare(
      "INSERT INTO Booking_Invoices (booking_id, attempt_key, amount_cents, status) VALUES (?, ?, 0, 'CREATING')"
    ).bind(id, attemptKey).run()
  } catch (err) {
    const message = String((err as { message?: unknown } | null)?.message ?? '')
    if (!message.includes('UNIQUE constraint failed')) throw err
    const open = await db.prepare(OPEN_INVOICE_SELECT_SQL).bind(id).first<{ status: string }>()
    if (open?.status === 'CREATING') throw new BillingError('INVOICE_SENDING', 409, SENDING_MESSAGE)
    throw new BillingError('INVOICE_OPEN', 409, 'This booking already has an open invoice.')
  }
  const deleteClaim = () =>
    db.prepare('DELETE FROM Booking_Invoices WHERE attempt_key = ?').bind(attemptKey).run().catch(() => null)

  // 3. Compute the balance now, after the claim (every lock checks for this row).
  let booking: any
  let balance: number
  let charges: { description: string; amount_cents: number; category?: string }[]
  try {
    const fresh = await loadBookingTotals(db, id)
    if (!fresh) throw new BillingError('NOT_FOUND', 404, 'Booking not found.')
    booking = fresh.booking
    balance = fresh.totals.balance_cents
    if (balance <= 0) throw new BillingError('NO_BALANCE', 409, 'This booking has no balance to invoice.')
    if (balance !== expectedCents) {
      throw new BillingError('BALANCE_CHANGED', 409, `The balance changed to $${formatDollars(balance)}. Review and send again.`, [
        { balance_cents: balance }
      ])
    }
    await db.prepare('UPDATE Booking_Invoices SET amount_cents = ? WHERE attempt_key = ?').bind(balance, attemptKey).run()
    const { results } = await db.prepare(CHARGES_SELECT_SQL).bind(id).all<any>()
    charges = (results || []).map((row: any) => ({
      description: String(row.description),
      amount_cents: Number(row.amount_cents) || 0,
      category: typeof row.category === 'string' && row.category.trim() ? row.category.trim() : undefined
    }))
  } catch (err) {
    await deleteClaim()
    throw err
  }

  // Optional context for hybrid Square metadata/descriptions (safe if legacy test DB omits these columns).
  const extraContext = await db.prepare(
    `SELECT b.attendees, b.coupon_code, sl.start_time, s.best_for
     FROM Bookings b
     LEFT JOIN Services s ON b.service_id = s.id
     LEFT JOIN Schedule_Slots sl ON b.slot_id = sl.id
     WHERE b.id = ?`
  ).bind(id).first<any>().catch(() => null)

  const serviceCategory = String(extraContext?.best_for || '').trim() || 'Photography'
  const hybridNote = buildHybridSquareNote({
    category: serviceCategory,
    packageName: booking.service_name,
    date: booking.date,
    time: extraContext?.start_time,
    guests: extraContext?.attendees,
    couponCode: extraContext?.coupon_code,
    photoPermissionPortfolio: booking.photo_permission_portfolio,
    photoPermissionSocial: booking.photo_permission_social,
    bookingId: id
  })

  // Steps 4–7 talk to Square.
  let client: SquareClient | null = null
  let squareInvoiceId: string | null = null
  let timeZone = DEFAULT_TIMEZONE
  try {
    const square = await getSquare(env)
    client = square.client
    timeZone = await getStudioTimeZone(db)

    // 4. Customer.
    const customerId = await ensureCustomer(client, booking, attemptKey)

    // 5. Order.
    const annotatedCharges = charges.map((charge) => ({
      description: charge.category ? `[${charge.category}] ${charge.description}` : charge.description,
      amount_cents: charge.amount_cents
    }))
    const lines = buildInvoiceLines({ balanceCents: balance, packageName: booking.service_name, charges: annotatedCharges })
    const orderRes = await client.orders.create({
      idempotencyKey: `${attemptKey}-order`,
      order: {
        locationId: square.locationId,
        customerId,
        lineItems: lines.map((line) => ({
          name: line.name,
          quantity: '1',
          basePriceMoney: { amount: BigInt(line.amountCents), currency: 'USD' }
        })),
        metadata: {
          booking_id: String(id),
          category: serviceCategory.slice(0, 255),
          session_type: String(booking.service_name || 'Custom Session').slice(0, 255),
          photo_permission_portfolio: booking.photo_permission_portfolio ? 'YES' : 'NO',
          photo_permission_social: booking.photo_permission_social ? 'YES' : 'NO'
        },
        pricingOptions: { autoApplyTaxes: false }
      }
    })
    const orderId = orderRes.order?.id
    if (!orderId) throw new Error('Square returned no order id')
    await db.prepare('UPDATE Booking_Invoices SET square_order_id = ? WHERE attempt_key = ?').bind(orderId, attemptKey).run()

    // 6. Create the draft invoice.
    const today = dateInTimeZone(timeZone)
    const defaultDueDate = addDaysISO(today, INVOICE_DUE_DAYS)
    const scheduledAtMs = typeof options?.scheduledAt === 'string' ? Date.parse(options.scheduledAt) : NaN
    const scheduledAt = Number.isFinite(scheduledAtMs) && scheduledAtMs > Date.now() + 60_000
      ? options!.scheduledAt
      : undefined
    const bookingDate = typeof booking.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(booking.date)
      ? booking.date
      : ''
    const dueDate = scheduledAt && bookingDate > defaultDueDate ? bookingDate : defaultDueDate
    const createRes = await client.invoices.create({
      idempotencyKey: `${attemptKey}-invoice`,
      invoice: {
        locationId: square.locationId,
        orderId,
        primaryRecipient: { customerId },
        ...(scheduledAt ? { scheduledAt } : {}),
        paymentRequests: [
          {
            requestType: 'BALANCE',
            dueDate,
            automaticPaymentSource: 'NONE',
            tippingEnabled: false
          }
        ],
        deliveryMethod: 'EMAIL',
        acceptedPaymentMethods: {
          card: true,
          bankAccount: true,
          squareGiftCard: false,
          buyNowPayLater: false,
          cashAppPay: false
        },
        title: invoiceTitle(booking),
        description: hybridNote
      }
    })
    const created = createRes.invoice
    if (!created?.id) throw new Error('Square returned no invoice id')
    squareInvoiceId = created.id
    const createdVersion = toNumberOrNull(created.version) ?? 0
    await db.prepare(
      'UPDATE Booking_Invoices SET square_invoice_id = ?, version = ?, updated_at = CURRENT_TIMESTAMP WHERE attempt_key = ?'
    ).bind(squareInvoiceId, createdVersion, attemptKey).run()

    // 7. Publish. Square emails the client.
    const publishRes = await client.invoices.publish({
      invoiceId: squareInvoiceId,
      version: createdVersion,
      idempotencyKey: `${attemptKey}-publish`
    })
    const published = publishRes.invoice ?? (await client.invoices.get({ invoiceId: squareInvoiceId })).invoice
    if (!published) throw new Error('Square returned no invoice')
    await syncInvoice(db, published, timeZone)
  } catch (err) {
    // Throws unless the invoice turns out to be published, in which case it was sent and we answer 200.
    await handleSendFailure(db, client, attemptKey, squareInvoiceId, timeZone, err)
  }

  const row = await db.prepare('SELECT * FROM Booking_Invoices WHERE attempt_key = ?').bind(attemptKey).first<any>()
  const after = await loadBookingTotals(db, id)
  if (!row || !after) throw new BillingError('SQUARE_ERROR', 502, UNCONFIRMED_MESSAGE)
  return { invoice: toInvoiceJSON(row, dateInTimeZone(timeZone)), totals: after.totals }
}

/** Flow 2 "On failure". Returns normally only when the invoice was published; otherwise throws a BillingError. */
async function handleSendFailure(
  db: D1Database,
  client: SquareClient | null,
  attemptKey: string,
  squareInvoiceId: string | null,
  timeZone: string,
  err: unknown
): Promise<void> {
  const deleteClaim = () =>
    db.prepare('DELETE FROM Booking_Invoices WHERE attempt_key = ?').bind(attemptKey).run().catch(() => null)

  if (!squareInvoiceId || !client) {
    await deleteClaim()
    throw toSquareFailure(err)
  }

  // Make sure the Square id is on our row (its save may be what failed), so Flow 5 can find the invoice.
  await db.prepare(
    'UPDATE Booking_Invoices SET square_invoice_id = ? WHERE attempt_key = ? AND square_invoice_id IS NULL'
  ).bind(squareInvoiceId, attemptKey).run().catch(() => null)

  let invoice: any
  try {
    invoice = (await client.invoices.get({ invoiceId: squareInvoiceId })).invoice
  } catch {
    throw new BillingError('SQUARE_ERROR', 502, UNCONFIRMED_MESSAGE)
  }
  if (!invoice) throw new BillingError('SQUARE_ERROR', 502, UNCONFIRMED_MESSAGE)

  if (invoice.status === 'DRAFT') {
    try {
      await client.invoices.delete({ invoiceId: squareInvoiceId, version: toNumberOrNull(invoice.version) })
    } catch {
      // Leave the row: Flow 5 deletes the draft and the row later.
      throw toSquareFailure(err)
    }
    await deleteClaim()
    throw toSquareFailure(err)
  }

  // Published (any other status): it was sent.
  await syncInvoice(db, invoice, timeZone)
}

// ── Flow 4: cancelOpenInvoice ─────────────────────────────────────

/** Cancels (or deletes, for a draft) the booking's open invoice. null when there is none. */
export async function cancelOpenInvoice(
  db: D1Database,
  env: BillingEnv,
  bookingId: string | number
): Promise<{ invoice: any } | null> {
  await resolveStaleSends(db, env, bookingId)
  const row = await db.prepare(OPEN_INVOICE_SELECT_SQL).bind(bookingId).first<any>()
  if (!row) return null
  if (row.status === 'CREATING') throw new BillingError('INVOICE_SENDING', 409, SENDING_MESSAGE)

  const markCancelled = () =>
    db.prepare("UPDATE Booking_Invoices SET status = 'CANCELED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id).run()

  if (!row.square_invoice_id) {
    // An open row without a Square id can only be CREATING; close any other so it never blocks the booking.
    await markCancelled()
  } else {
    const { client } = await getSquare(env)
    const timeZone = await getStudioTimeZone(db)
    const invoiceId: string = row.square_invoice_id
    try {
      let invoice: any = null
      try {
        invoice = (await client.invoices.get({ invoiceId })).invoice ?? null
      } catch (err) {
        // Only drafts can be deleted in Square, so a missing invoice was never emailed: close our row.
        if (!isSquareNotFound(err)) throw err
        await markCancelled()
      }
      if (invoice) {
        const status = String(invoice.status ?? '')
        if (status === 'DRAFT') {
          await client.invoices.delete({ invoiceId, version: toNumberOrNull(invoice.version) })
          await markCancelled()
        } else if (status === 'UNPAID' || status === 'SCHEDULED' || status === 'PARTIALLY_PAID') {
          const cancelled = (await client.invoices.cancel({ invoiceId, version: toNumberOrNull(invoice.version) ?? 0 })).invoice
          await syncInvoice(db, cancelled ?? (await client.invoices.get({ invoiceId })).invoice, timeZone)
        } else if (PAID_LIKE_STATUSES.includes(status)) {
          await syncInvoice(db, invoice, timeZone)
          throw new BillingError('INVOICE_ALREADY_PAID', 409, "This invoice is already paid, so it can't be cancelled.")
        } else if (status === 'PAYMENT_PENDING') {
          await syncInvoice(db, invoice, timeZone)
          throw new BillingError(
            'INVOICE_PAYMENT_PENDING',
            409,
            "A bank transfer for this invoice is processing, so it can't be cancelled."
          )
        } else {
          // CANCELED, FAILED or any other closed status: sync and treat it as done.
          await syncInvoice(db, invoice, timeZone)
        }
      }
    } catch (err) {
      throw toSquareFailure(err)
    }
  }

  const updated = await db.prepare('SELECT * FROM Booking_Invoices WHERE id = ?').bind(row.id).first<any>()
  return { invoice: toInvoiceJSON(updated ?? row, await studioTodayISO(db)) }
}
