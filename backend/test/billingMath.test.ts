import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  normalizeDepositPercent,
  depositFor,
  buildInvoiceLines,
  computeTotals,
  invoiceStatusLabel,
  addDaysISO,
  dateInTimeZone,
  localDateTimeToRFC3339,
  parseMoneyToCents,
  DEFAULT_BOOKING_POLICY,
  normalizeBookingPolicy,
  normalizeFeeRules,
  evaluateDynamicFees,
  type DynamicFeeRule
} from '../src/lib/billingMath.ts'
import { verifySquareSignature } from '../src/lib/squareWebhookAuth.ts'
import { buildHybridSquareNote } from '../src/lib/squareBilling.ts'

test('normalizeDepositPercent', () => {
  assert.equal(normalizeDepositPercent('60'), 60)
  assert.equal(normalizeDepositPercent(59.6), 60)
  assert.equal(normalizeDepositPercent(0), 1)
  assert.equal(normalizeDepositPercent(150), 100)
  for (const v of ['', null, undefined, 'abc', []]) {
    assert.equal(normalizeDepositPercent(v), 60, `value ${JSON.stringify(v)}`)
  }
})

test('depositFor', () => {
  assert.deepEqual(depositFor(50000, 60), { cents: 30000, percent: 60 })
  assert.equal(depositFor(33333, 60).cents, 20000)
  assert.deepEqual(depositFor(120, 60), { cents: 100, percent: 60 })
  assert.deepEqual(depositFor(80, 60), { cents: 80, percent: 100 })
  assert.deepEqual(depositFor(50000, 100), { cents: 50000, percent: 100 })
})

test('buildInvoiceLines: CUJ 2 lines', () => {
  assert.deepEqual(
    buildInvoiceLines({
      balanceCents: 27500,
      packageName: 'Portrait',
      charges: [{ description: 'Overtime – 1 hr', amount_cents: 7500 }]
    }),
    [
      { name: 'Portrait – session balance', amountCents: 20000 },
      { name: 'Overtime – 1 hr', amountCents: 7500 }
    ]
  )
})

test('buildInvoiceLines: balance below charges gives one line', () => {
  assert.deepEqual(
    buildInvoiceLines({
      balanceCents: 5000,
      packageName: 'Portrait',
      charges: [{ description: 'Overtime', amount_cents: 7500 }]
    }),
    [{ name: 'Remaining balance', amountCents: 5000 }]
  )
})

test('buildInvoiceLines: zero session remainder drops that line', () => {
  assert.deepEqual(
    buildInvoiceLines({
      balanceCents: 7500,
      packageName: 'Portrait',
      charges: [{ description: 'Overtime', amount_cents: 7500 }]
    }),
    [{ name: 'Overtime', amountCents: 7500 }]
  )
  assert.deepEqual(
    buildInvoiceLines({ balanceCents: 1000, packageName: null, charges: [] }),
    [{ name: 'Session balance', amountCents: 1000 }]
  )
  assert.deepEqual(buildInvoiceLines({ balanceCents: 0, packageName: 'Portrait', charges: [] }), [])
})

test('buildInvoiceLines: lines always sum to the balance', () => {
  const chargeSets = [[], [100], [7500], [2500, 2500], [1, 99, 10000], [50000, 1]]
  const balances = [0, 1, 100, 2500, 5000, 7500, 10100, 20000, 60001]
  for (const amounts of chargeSets) {
    const charges = amounts.map((amount_cents, i) => ({ description: `Charge ${i + 1}`, amount_cents }))
    for (const balanceCents of balances) {
      const lines = buildInvoiceLines({ balanceCents, packageName: 'Portrait', charges })
      const sum = lines.reduce((s, l) => s + l.amountCents, 0)
      assert.equal(sum, balanceCents, `balance ${balanceCents}, charges ${JSON.stringify(amounts)}`)
      for (const l of lines) assert.ok(l.amountCents > 0)
    }
  }
})

test('computeTotals: without charges', () => {
  assert.deepEqual(computeTotals({ price_at_booking: 50000, deposit_paid: 30000 }, 0), {
    base_cents: 50000, charges_cents: 0, total_cents: 50000, paid_at_booking_cents: 30000,
    payments_total_cents: 0, paid_cents: 30000, balance_cents: 20000, overpaid_cents: 0,
    base: 500, charges: 0, total: 500, paid_at_booking: 300, payments_total: 0, paid: 300, balance: 200, overpaid: 0
  })
})

test('computeTotals: with charges (doc example, key order)', () => {
  const t = computeTotals({ price_at_booking: 50000, deposit_paid: 30000 }, 0, 7500)
  assert.deepEqual(Object.keys(t), [
    'base_cents', 'charges_cents', 'total_cents', 'paid_at_booking_cents', 'payments_total_cents',
    'paid_cents', 'balance_cents', 'overpaid_cents', 'base', 'charges', 'total', 'paid_at_booking',
    'payments_total', 'paid', 'balance', 'overpaid'
  ])
  assert.deepEqual(t, {
    base_cents: 50000, charges_cents: 7500, total_cents: 57500, paid_at_booking_cents: 30000,
    payments_total_cents: 0, paid_cents: 30000, balance_cents: 27500, overpaid_cents: 0,
    base: 500, charges: 75, total: 575, paid_at_booking: 300, payments_total: 0, paid: 300, balance: 275, overpaid: 0
  })
})

test('computeTotals: overpaid and base precedence', () => {
  const t = computeTotals({ custom_price: 40000, price_at_booking: 50000, service_price: 60000, deposit_paid: 30000 }, 15000, 1000)
  assert.equal(t.base_cents, 40000)
  assert.equal(t.total_cents, 41000)
  assert.equal(t.paid_cents, 45000)
  assert.equal(t.balance_cents, 0)
  assert.equal(t.overpaid_cents, 4000)
  assert.equal(t.overpaid, 40)
  assert.equal(t.payments_total, 150)
  assert.equal(computeTotals({ service_price: 12345 }, 0).base_cents, 12345)
  assert.equal(computeTotals({}, 0).total_cents, 0)
})

test('invoiceStatusLabel: every table row', () => {
  const today = '2026-11-06'
  const rows: [string, string][] = [
    ['CREATING', 'Sending…'],
    ['DRAFT', 'Not sent'],
    ['SCHEDULED', 'Scheduled'],
    ['PARTIALLY_PAID', 'Partly paid'],
    ['PAYMENT_PENDING', 'Payment processing'],
    ['PAID', 'Paid'],
    ['PARTIALLY_REFUNDED', 'Paid, partly refunded'],
    ['REFUNDED', 'Refunded in Square'],
    ['CANCELED', 'Cancelled'],
    ['FAILED', 'Failed'],
    ['SOMETHING_NEW', 'SOMETHING_NEW']
  ]
  for (const [status, label] of rows) {
    assert.equal(invoiceStatusLabel(status, null, today), label, status)
  }
  assert.equal(invoiceStatusLabel('', null, today), '')
  assert.equal(invoiceStatusLabel(null, null, today), '')
})

test('invoiceStatusLabel: UNPAID before and after the due date', () => {
  assert.equal(invoiceStatusLabel('UNPAID', '2026-11-13', '2026-11-06'), 'Sent')
  assert.equal(invoiceStatusLabel('UNPAID', '2026-11-06', '2026-11-06'), 'Sent')
  assert.equal(invoiceStatusLabel('UNPAID', '2026-11-05', '2026-11-06'), 'Overdue')
  assert.equal(invoiceStatusLabel('UNPAID', null, '2026-11-06'), 'Sent')
})

test('addDaysISO across month and year boundaries', () => {
  assert.equal(addDaysISO('2026-11-28', 7), '2026-12-05')
  assert.equal(addDaysISO('2026-12-29', 7), '2027-01-05')
  assert.equal(addDaysISO('2028-02-27', 2), '2028-02-29')
})

test('dateInTimeZone', () => {
  const at = new Date('2026-11-07T03:00:00Z')
  assert.equal(dateInTimeZone('America/New_York', at), '2026-11-06')
  assert.equal(dateInTimeZone('UTC', at), '2026-11-07')
  assert.equal(dateInTimeZone('Not/AZone', at), '2026-11-06')
})

test('parseMoneyToCents', () => {
  assert.equal(parseMoneyToCents('75'), 7500)
  assert.equal(parseMoneyToCents('19.99'), 1999)
  assert.equal(parseMoneyToCents('0.01'), 1)
  assert.equal(parseMoneyToCents('1.5'), 150)
  assert.equal(parseMoneyToCents('1000000'), 100000000)
  assert.equal(parseMoneyToCents('0'), null)
  assert.equal(parseMoneyToCents('1.234'), null)
  assert.equal(parseMoneyToCents('100000000'), null)
  assert.equal(parseMoneyToCents('1000000.01'), null)
  assert.equal(parseMoneyToCents(''), null)
  assert.equal(parseMoneyToCents('-5'), null)
  assert.equal(parseMoneyToCents(75), null)
})

test('verifySquareSignature', async () => {
  const key = 'test-signature-key'
  const url = 'https://example.com/api/square/webhook'
  const body = '{"type":"invoice.payment_made","data":{"id":"inv:1"}}'
  const signature = createHmac('sha256', key).update(url + body).digest('base64')
  assert.equal(await verifySquareSignature({ body, signature, key, url }), true)
  assert.equal(await verifySquareSignature({ body: body + ' ', signature, key, url }), false)
  assert.equal(await verifySquareSignature({ body, signature, key, url: url + '/' }), false)
  assert.equal(await verifySquareSignature({ body, signature: '', key, url }), false)
})

test('buildHybridSquareNote: formats all hybrid fields and enforces 500-char limit', () => {
  const full = buildHybridSquareNote({
    category: 'Portrait',
    packageName: 'Golden Hour',
    date: '2026-11-20',
    time: '15:00',
    guests: 3,
    couponCode: 'FALL20',
    photoPermissionPortfolio: 1,
    photoPermissionSocial: 0,
    bookingId: 42
  })
  assert.equal(
    full,
    '[Category: Portrait] Golden Hour | 2026-11-20 15:00 | Guests: 3 | Coupon: FALL20 | Photo Consent: Website=YES, Social=NO | Booking #42'
  )
  assert.ok(full.length <= 500)

  const minimal = buildHybridSquareNote({
    packageName: 'Mini Session',
    photoPermissionPortfolio: false,
    photoPermissionSocial: false
  })
  assert.equal(minimal, 'Mini Session | Photo Consent: Website=NO, Social=NO')

  const oversized = buildHybridSquareNote({
    category: 'A'.repeat(200),
    packageName: 'B'.repeat(250),
    date: '2026-11-20',
    time: '15:00',
    guests: 5,
    couponCode: 'LONGCOUPONCODE12345',
    photoPermissionPortfolio: true,
    photoPermissionSocial: true,
    bookingId: 999999
  })
  assert.equal(oversized.length, 500)
  assert.ok(oversized.endsWith('...'))
})

test('localDateTimeToRFC3339: converts EST/EDT studio-local times to UTC RFC 3339', () => {
  // Winter EST (UTC-5)
  assert.equal(localDateTimeToRFC3339('2026-01-15', '14:30', 'America/New_York'), '2026-01-15T19:30:00Z')
  assert.equal(localDateTimeToRFC3339('2026-11-20', '20:00:00', 'America/New_York'), '2026-11-21T01:00:00Z')

  // Summer EDT (UTC-4)
  assert.equal(localDateTimeToRFC3339('2026-07-15', '14:30', 'America/New_York'), '2026-07-15T18:30:00Z')
  assert.equal(localDateTimeToRFC3339('2026-06-01', '09:15:30', 'America/New_York'), '2026-06-01T13:15:30Z')

  // Invalid inputs return null
  assert.equal(localDateTimeToRFC3339('2026-02-30', '10:00', 'America/New_York'), null)
  assert.equal(localDateTimeToRFC3339('2026-07-15', '25:00', 'America/New_York'), null)
  assert.equal(localDateTimeToRFC3339('2026-07-15', '10:00', 'Invalid/Zone'), null)
})

test('DEFAULT_BOOKING_POLICY and normalizeBookingPolicy', () => {
  assert.deepEqual(DEFAULT_BOOKING_POLICY, {
    balanceDueDaysAfterEvent: 4,
    rescheduleCutoffDays: 3,
    requireSignature: true,
    agreementTitle: 'Photography Services Agreement'
  })
  assert.deepEqual(normalizeBookingPolicy(null), DEFAULT_BOOKING_POLICY)
  assert.deepEqual(
    normalizeBookingPolicy({
      balanceDueDaysAfterEvent: 7,
      rescheduleCutoffDays: 2,
      requireSignature: false,
      agreementTitle: 'Custom Studio Contract'
    }),
    {
      balanceDueDaysAfterEvent: 7,
      rescheduleCutoffDays: 2,
      requireSignature: false,
      agreementTitle: 'Custom Studio Contract'
    }
  )
})

test('evaluateDynamicFees: days_before_max, privacy_declined, weekend, client_selectable, per_person_cents, percent_of_subtotal', () => {
  const rules: DynamicFeeRule[] = [
    {
      id: 'rush_fee',
      name: 'Rush Booking Fee',
      triggerType: 'days_before_max',
      daysBefore: 3,
      amountType: 'fixed_cents',
      amountValue: 5000,
      active: true
    },
    {
      id: 'privacy_fee',
      name: 'Privacy Opt-Out Fee',
      triggerType: 'privacy_declined',
      amountType: 'percent_of_subtotal',
      amountValue: 15,
      active: true
    },
    {
      id: 'weekend_fee',
      name: 'Weekend Surcharge',
      triggerType: 'weekend',
      amountType: 'fixed_cents',
      amountValue: 3500,
      active: true
    },
    {
      id: 'rush_edits',
      name: 'Express Editing Add-On',
      triggerType: 'client_selectable',
      amountType: 'per_person_cents',
      amountValue: 1500,
      active: true
    },
    {
      id: 'inactive_fee',
      name: 'Inactive Fee',
      triggerType: 'always',
      amountType: 'fixed_cents',
      amountValue: 9900,
      active: false
    }
  ]

  // 2026-11-21 is a Saturday (weekend), 2 days after 2026-11-19 (within daysBefore=3)
  // privacy declined (portfolio=false, social=false) -> 15% of 20000 = 3000
  // client_selectable 'rush_edits' selected with 3 attendees -> 1500 * 3 = 4500
  const hitAll = evaluateDynamicFees(rules, {
    subtotalCents: 20000,
    sessionDate: '2026-11-21',
    todayDate: '2026-11-19',
    timeZone: 'America/New_York',
    attendees: 3,
    photoPermissionPortfolio: false,
    photoPermissionSocial: false,
    selectedFeeIds: ['rush_edits']
  })
  assert.equal(hitAll.daysUntilSession, 2)
  assert.equal(hitAll.totalFeeCents, 5000 + 3000 + 3500 + 4500)
  assert.deepEqual(
    hitAll.appliedFees.map((f) => ({ id: f.id, amountCents: f.amountCents })),
    [
      { id: 'rush_fee', amountCents: 5000 },
      { id: 'privacy_fee', amountCents: 3000 },
      { id: 'weekend_fee', amountCents: 3500 },
      { id: 'rush_edits', amountCents: 4500 }
    ]
  )

  // 2026-11-25 is a Wednesday (not weekend), 6 days after 2026-11-19 (outside daysBefore=3)
  // portfolio=true -> privacy NOT declined
  // selectedFeeIds empty -> client_selectable NOT applied
  const hitNone = evaluateDynamicFees(rules, {
    subtotalCents: 20000,
    sessionDate: '2026-11-25',
    todayDate: '2026-11-19',
    timeZone: 'America/New_York',
    attendees: 2,
    photoPermissionPortfolio: true,
    photoPermissionSocial: false,
    selectedFeeIds: []
  })
  assert.equal(hitNone.daysUntilSession, 6)
  assert.equal(hitNone.totalFeeCents, 0)
  assert.deepEqual(hitNone.appliedFees, [])
})

test('evaluateDynamicFees: calculates daysUntilSession in studio timezone', () => {
  const rules: DynamicFeeRule[] = [
    {
      id: 'same_week',
      name: 'Short Notice',
      triggerType: 'days_before_max',
      daysBefore: 2,
      amountType: 'fixed_cents',
      amountValue: 2500,
      active: true
    }
  ]
  // 2026-11-20T03:00:00Z is 2026-11-19 22:00 in America/New_York
  // Session on 2026-11-22 is 3 days away in NY (outside daysBefore=2), vs 2 days away in UTC
  const nyResult = evaluateDynamicFees(rules, {
    subtotalCents: 10000,
    sessionDate: '2026-11-22',
    now: new Date('2026-11-20T03:00:00Z'),
    timeZone: 'America/New_York'
  })
  assert.equal(nyResult.daysUntilSession, 3)
  assert.equal(nyResult.totalFeeCents, 0)

  const utcResult = evaluateDynamicFees(rules, {
    subtotalCents: 10000,
    sessionDate: '2026-11-22',
    now: new Date('2026-11-20T03:00:00Z'),
    timeZone: 'UTC'
  })
  assert.equal(utcResult.daysUntilSession, 2)
  assert.equal(utcResult.totalFeeCents, 2500)
})

test('normalizeFeeRules: filters invalid rules and preserves valid ones', () => {
  const normalized = normalizeFeeRules([
    {
      id: 'valid_1',
      name: 'Travel Fee',
      triggerType: 'always',
      amountType: 'fixed_cents',
      amountValue: 2500,
      active: true
    },
    { id: 'bad_trigger', name: 'Bad', triggerType: 'unknown', amountType: 'fixed_cents', amountValue: 100 },
    { id: 'missing_days', name: 'Rush', triggerType: 'days_before_max', amountType: 'fixed_cents', amountValue: 100 }
  ])
  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].id, 'valid_1')
})
