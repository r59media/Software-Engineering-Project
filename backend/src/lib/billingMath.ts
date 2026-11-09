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
