/**
 * Pure billing math for deposits, totals and balance invoices.
 * No imports and no side effects, so Node can run it directly in tests.
 */

export const DEFAULT_DEPOSIT_PERCENT = 60
export const SQUARE_MIN_CHARGE_CENTS = 100
export const INVOICE_DUE_DAYS = 7
export const STALE_SEND_MS = 120000
export const OPEN_INVOICE_STATUSES: readonly string[] = [
  'CREATING',
  'DRAFT',
  'UNPAID',
  'SCHEDULED',
  'PARTIALLY_PAID',
  'PAYMENT_PENDING'
]
export const PAID_LIKE_STATUSES: readonly string[] = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']
export const MAX_CHARGE_CENTS = 100000000
export const DESCRIPTION_MAX = 120
export const DEFAULT_TIMEZONE = 'America/New_York'

/** True for statuses that count as an open invoice (see the status table). */
export function isOpenInvoiceStatus(s: unknown): boolean {
  return typeof s === 'string' && OPEN_INVOICE_STATUSES.includes(s)
}

/** Whole deposit percent from 1 to 100; 60 when the value is missing or invalid. */
export function normalizeDepositPercent(v: unknown): number {
  let n: number
  if (typeof v === 'number' && Number.isFinite(v)) {
    n = v
  } else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) {
    n = Number(v)
  } else {
    return DEFAULT_DEPOSIT_PERCENT
  }
  if (!Number.isFinite(n)) return DEFAULT_DEPOSIT_PERCENT
  return Math.min(100, Math.max(1, Math.round(n)))
}

/** Deposit charged at checkout: at least Square's $1 minimum, never more than the total. */
export function depositFor(totalCents: number, percent: number): { cents: number; percent: number } {
  const cents = Math.min(totalCents, Math.max(SQUARE_MIN_CHARGE_CENTS, Math.round((totalCents * percent) / 100)))
  return { cents, percent: cents === totalCents ? 100 : percent }
}

function isPresentNumber(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

/** Booking total in cents: custom_price ?? price_at_booking ?? service price ?? 0. */
export function bookingTotalCents(row: {
  custom_price?: unknown
  price_at_booking?: unknown
  service_price?: unknown
}): number {
  if (isPresentNumber(row.custom_price)) return Math.round(Number(row.custom_price))
  if (isPresentNumber(row.price_at_booking)) return Math.round(Number(row.price_at_booking))
  if (isPresentNumber(row.service_price)) return Math.round(Number(row.service_price))
  return 0
}

export interface BookingTotals {
  base_cents: number
  charges_cents: number
  total_cents: number
  paid_at_booking_cents: number
  payments_total_cents: number
  paid_cents: number
  balance_cents: number
  overpaid_cents: number
  base: number
  charges: number
  total: number
  paid_at_booking: number
  payments_total: number
  paid: number
  balance: number
  overpaid: number
}

/** The contract's totals object (cents, plus the same values in dollars). Total = base + charges. */
export function computeTotals(
  row: { custom_price?: unknown; price_at_booking?: unknown; service_price?: unknown; deposit_paid?: unknown },
  paymentsTotalCents: number,
  chargesCents: number = 0
): BookingTotals {
  const base_cents = bookingTotalCents(row)
  const charges_cents = Math.round(Number(chargesCents) || 0)
  const total_cents = base_cents + charges_cents
  const paid_at_booking_cents = isPresentNumber(row.deposit_paid) ? Math.round(Number(row.deposit_paid)) : 0
  const payments_total_cents = Math.round(Number(paymentsTotalCents) || 0)
  const paid_cents = paid_at_booking_cents + payments_total_cents
  const balance_cents = Math.max(0, total_cents - paid_cents)
  const overpaid_cents = Math.max(0, paid_cents - total_cents)
  return {
    base_cents,
    charges_cents,
    total_cents,
    paid_at_booking_cents,
    payments_total_cents,
    paid_cents,
    balance_cents,
    overpaid_cents,
    base: base_cents / 100,
    charges: charges_cents / 100,
    total: total_cents / 100,
    paid_at_booking: paid_at_booking_cents / 100,
    payments_total: payments_total_cents / 100,
    paid: paid_cents / 100,
    balance: balance_cents / 100,
    overpaid: overpaid_cents / 100
  }
}

export interface InvoiceLine {
  name: string
  amountCents: number
}

/**
 * Square order lines for a balance invoice. The lines always add up to exactly the balance.
 * - balance >= sum of charges: "<Package> – session balance" for the remainder (left out when 0),
 *   then one line per charge.
 * - otherwise: a single "Remaining balance" line.
 */
export function buildInvoiceLines(input: {
  balanceCents: number
  packageName?: string | null
  charges: { description: string; amount_cents: number }[]
}): InvoiceLine[] {
  const balance = input.balanceCents
  if (!(balance > 0)) return []
  const charges = input.charges || []
  const sumCharges = charges.reduce((sum, ch) => sum + ch.amount_cents, 0)
  if (balance < sumCharges) {
    return [{ name: 'Remaining balance', amountCents: balance }]
  }
  const lines: InvoiceLine[] = []
  const session = balance - sumCharges
  if (session > 0) {
    const pkg = typeof input.packageName === 'string' ? input.packageName.trim() : ''
    lines.push({ name: pkg ? `${pkg} – session balance` : 'Session balance', amountCents: session })
  }
  for (const ch of charges) {
    lines.push({ name: ch.description, amountCents: ch.amount_cents })
  }
  return lines
}

/** Adds n days to a YYYY-MM-DD date using UTC date math. */
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

/** The calendar date (YYYY-MM-DD) in a time zone; falls back to America/New_York, then UTC. */
export function dateInTimeZone(tz: string, at: Date = new Date()): string {
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  try {
    return format(tz)
  } catch {
    try {
      return format(DEFAULT_TIMEZONE)
    } catch {
      return at.toISOString().slice(0, 10)
    }
  }
}

/**
 * Converts a studio-local date (YYYY-MM-DD) and time (HH:MM or HH:MM:SS) in `timeZone`
 * into an RFC 3339 UTC timestamp string (YYYY-MM-DDTHH:MM:SSZ), or null if invalid.
 */
export function localDateTimeToRFC3339(dateISO: string, timeStr: string, timeZone: string): string | null {
  if (typeof dateISO !== 'string' || typeof timeStr !== 'string' || typeof timeZone !== 'string') return null
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO.trim())
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeStr.trim())
  if (!dateMatch || !timeMatch) return null

  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const second = timeMatch[3] !== undefined ? Number(timeMatch[3]) : 0

  const checkDate = new Date(Date.UTC(year, month - 1, day))
  if (
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() + 1 !== month ||
    checkDate.getUTCDate() !== day
  ) {
    return null
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null
  }

  let dtf: Intl.DateTimeFormat
  try {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone.trim() || DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
  } catch {
    return null
  }

  const getOffsetMs = (utcMs: number): number => {
    const parts = dtf.formatToParts(new Date(utcMs))
    const vals: Record<string, number> = {}
    for (const p of parts) {
      if (p.type !== 'literal') vals[p.type] = Number(p.value)
    }
    const asUtc = Date.UTC(vals.year, vals.month - 1, vals.day, vals.hour, vals.minute, vals.second)
    return asUtc - utcMs
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offset1 = getOffsetMs(utcGuess)
  let candidate = utcGuess - offset1
  const offset2 = getOffsetMs(candidate)
  if (offset2 !== offset1) {
    candidate = utcGuess - offset2
  }

  return new Date(candidate).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** The only status-to-label mapping (see the status table in the design doc). */
export function invoiceStatusLabel(status: string | null | undefined, dueDate: string | null | undefined, today: string): string {
  switch (status) {
    case 'CREATING': return 'Sending…'
    case 'DRAFT': return 'Not sent'
    case 'UNPAID': return dueDate && dueDate < today ? 'Overdue' : 'Sent'
    case 'SCHEDULED': return 'Scheduled'
    case 'PARTIALLY_PAID': return 'Partly paid'
    case 'PAYMENT_PENDING': return 'Payment processing'
    case 'PAID': return 'Paid'
    case 'PARTIALLY_REFUNDED': return 'Paid, partly refunded'
    case 'REFUNDED': return 'Refunded in Square'
    case 'CANCELED': return 'Cancelled'
    case 'FAILED': return 'Failed'
    default: return status ? String(status) : ''
  }
}

/** Dollars as text ("75", "19.99") to integer cents; null unless it matches the money rule and is 1..MAX_CHARGE_CENTS. */
export function parseMoneyToCents(text: unknown): number | null {
  if (typeof text !== 'string' || !/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null
  const [whole, frac = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_CHARGE_CENTS) return null
  return cents
}

// ── Dynamic Fee Rules & Booking Policy ────────────────────────────

export type DynamicFeeTriggerType =
  | 'days_before_max'
  | 'privacy_declined'
  | 'weekend'
  | 'always'
  | 'client_selectable'

export type DynamicFeeAmountType =
  | 'fixed_cents'
  | 'percent_of_subtotal'
  | 'per_person_cents'

export interface DynamicFeeRule {
  id: string
  name: string
  triggerType: DynamicFeeTriggerType
  daysBefore?: number
  amountType: DynamicFeeAmountType
  amountValue: number
  active: boolean
}

export interface BookingPolicySettings {
  balanceDueDaysAfterEvent: number
  rescheduleCutoffDays: number
  requireSignature: boolean
  agreementTitle: string
}

export const DEFAULT_BOOKING_POLICY: BookingPolicySettings = {
  balanceDueDaysAfterEvent: 4,
  rescheduleCutoffDays: 3,
  requireSignature: true,
  agreementTitle: 'Photography Services Agreement'
}

export interface DynamicFeeContext {
  subtotalCents: number
  sessionDate: string
  todayDate?: string
  timeZone?: string
  now?: Date
  attendees?: number
  photoPermissionPortfolio?: boolean
  photoPermissionSocial?: boolean
  selectedFeeIds?: string[]
}

export interface AppliedDynamicFee {
  id: string
  name: string
  triggerType: DynamicFeeTriggerType
  amountType: DynamicFeeAmountType
  amountValue: number
  amountCents: number
}

export interface DynamicFeeEvaluation {
  appliedFees: AppliedDynamicFee[]
  totalFeeCents: number
  daysUntilSession: number | null
}

const VALID_TRIGGER_TYPES: readonly DynamicFeeTriggerType[] = [
  'days_before_max',
  'privacy_declined',
  'weekend',
  'always',
  'client_selectable'
]

const VALID_AMOUNT_TYPES: readonly DynamicFeeAmountType[] = [
  'fixed_cents',
  'percent_of_subtotal',
  'per_person_cents'
]

/** Whole calendar days from `fromISO` to `toISO` (YYYY-MM-DD), or null if either is invalid. */
export function daysBetweenISO(fromISO: string, toISO: string): number | null {
  const fromMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fromISO || '').trim())
  const toMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(toISO || '').trim())
  if (!fromMatch || !toMatch) return null
  const fromMs = Date.UTC(Number(fromMatch[1]), Number(fromMatch[2]) - 1, Number(fromMatch[3]))
  const toMs = Date.UTC(Number(toMatch[1]), Number(toMatch[2]) - 1, Number(toMatch[3]))
  return Math.round((toMs - fromMs) / 86_400_000)
}

/** Validates and normalizes BookingPolicySettings with safe defaults. */
export function normalizeBookingPolicy(raw: unknown): BookingPolicySettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const dueDaysRaw = Number(obj.balanceDueDaysAfterEvent)
  const balanceDueDaysAfterEvent =
    Number.isFinite(dueDaysRaw) && dueDaysRaw >= 0 && dueDaysRaw <= 365
      ? Math.round(dueDaysRaw)
      : DEFAULT_BOOKING_POLICY.balanceDueDaysAfterEvent

  const cutoffRaw = Number(obj.rescheduleCutoffDays)
  const rescheduleCutoffDays =
    Number.isFinite(cutoffRaw) && cutoffRaw >= 0 && cutoffRaw <= 365
      ? Math.round(cutoffRaw)
      : DEFAULT_BOOKING_POLICY.rescheduleCutoffDays

  const requireSignature =
    typeof obj.requireSignature === 'boolean'
      ? obj.requireSignature
      : DEFAULT_BOOKING_POLICY.requireSignature

  const rawTitle = typeof obj.agreementTitle === 'string' ? obj.agreementTitle.trim().slice(0, 200) : ''
  const agreementTitle = rawTitle || DEFAULT_BOOKING_POLICY.agreementTitle

  return {
    balanceDueDaysAfterEvent,
    rescheduleCutoffDays,
    requireSignature,
    agreementTitle
  }
}

/** Validates and normalizes an array of DynamicFeeRule entries. */
export function normalizeFeeRules(raw: unknown): DynamicFeeRule[] {
  if (!Array.isArray(raw)) return []
  const out: DynamicFeeRule[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 64) : `fee_${i + 1}`
    if (seenIds.has(id)) continue
    seenIds.add(id)

    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 120) : ''
    if (!name) continue

    const triggerType = r.triggerType as DynamicFeeTriggerType
    if (!VALID_TRIGGER_TYPES.includes(triggerType)) continue

    const amountType = r.amountType as DynamicFeeAmountType
    if (!VALID_AMOUNT_TYPES.includes(amountType)) continue

    const rawVal = Number(r.amountValue)
    if (!Number.isFinite(rawVal) || rawVal < 0) continue
    const amountValue =
      amountType === 'percent_of_subtotal'
        ? Math.min(1000, Math.round(rawVal * 100) / 100)
        : Math.min(MAX_CHARGE_CENTS, Math.round(rawVal))

    let daysBefore: number | undefined
    if (triggerType === 'days_before_max') {
      const db = Number(r.daysBefore)
      if (!Number.isFinite(db) || db < 0) continue
      daysBefore = Math.min(365, Math.round(db))
    }

    const active = r.active === undefined ? true : Boolean(r.active)

    out.push({
      id,
      name,
      triggerType,
      ...(daysBefore !== undefined ? { daysBefore } : {}),
      amountType,
      amountValue,
      active
    })
  }
  return out
}

/** Evaluates active dynamic fee rules against the booking context. */
export function evaluateDynamicFees(
  rules: readonly DynamicFeeRule[],
  context: DynamicFeeContext
): DynamicFeeEvaluation {
  const tz = (context.timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE
  const todayDate =
    context.todayDate && /^\d{4}-\d{2}-\d{2}$/.test(context.todayDate.trim())
      ? context.todayDate.trim()
      : dateInTimeZone(tz, context.now ?? new Date())

  const daysUntilSession = daysBetweenISO(todayDate, context.sessionDate)
  const sessionMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(context.sessionDate || '').trim())
  const isWeekend = sessionMatch
    ? (() => {
        const day = new Date(
          Date.UTC(Number(sessionMatch[1]), Number(sessionMatch[2]) - 1, Number(sessionMatch[3]))
        ).getUTCDay()
        return day === 0 || day === 6
      })()
    : false

  const privacyDeclined = !context.photoPermissionPortfolio && !context.photoPermissionSocial
  const selectedSet = new Set(
    Array.isArray(context.selectedFeeIds) ? context.selectedFeeIds.map((id) => String(id).trim()) : []
  )
  const subtotalCents = Math.max(0, Math.round(Number(context.subtotalCents) || 0))
  const attendees = Math.max(1, Math.round(Number(context.attendees) || 1))

  const appliedFees: AppliedDynamicFee[] = []
  let totalFeeCents = 0

  for (const rule of rules || []) {
    if (!rule || !rule.active) continue

    let matches = false
    switch (rule.triggerType) {
      case 'always':
        matches = true
        break
      case 'weekend':
        matches = isWeekend
        break
      case 'privacy_declined':
        matches = privacyDeclined
        break
      case 'client_selectable':
        matches = selectedSet.has(rule.id)
        break
      case 'days_before_max':
        matches =
          daysUntilSession !== null &&
          typeof rule.daysBefore === 'number' &&
          Number.isFinite(rule.daysBefore) &&
          daysUntilSession >= 0 &&
          daysUntilSession <= rule.daysBefore
        break
    }
    if (!matches) continue

    let amountCents = 0
    switch (rule.amountType) {
      case 'fixed_cents':
        amountCents = Math.max(0, Math.round(rule.amountValue))
        break
      case 'percent_of_subtotal':
        amountCents = Math.max(0, Math.round((subtotalCents * rule.amountValue) / 100))
        break
      case 'per_person_cents':
        amountCents = Math.max(0, Math.round(rule.amountValue * attendees))
        break
    }

    if (amountCents > 0) {
      appliedFees.push({
        id: rule.id,
        name: rule.name,
        triggerType: rule.triggerType,
        amountType: rule.amountType,
        amountValue: rule.amountValue,
        amountCents
      })
      totalFeeCents += amountCents
    }
  }

  return {
    appliedFees,
    totalFeeCents,
    daysUntilSession
  }
}
