import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { isSlotInWeeklyAvailability } from '../src/routes/schedule.ts'
import {
  computeTotals,
  depositFor,
  evaluateDynamicFees,
  normalizeDepositPercent
} from '../src/lib/billingMath.ts'
import { computeCheckoutPricing, type ParsedCheckoutPayload } from '../src/routes/checkout.ts'

function createPricingDb(pricingSetting?: Record<string, unknown>, coupons: any[] = []): D1Database {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
    CREATE TABLE Coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      discount_type TEXT NOT NULL,
      discount_value REAL NOT NULL,
      is_active INTEGER DEFAULT 1,
      expires_at TEXT,
      max_uses INTEGER,
      used_count INTEGER DEFAULT 0
    );
    CREATE TABLE Bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coupon_code TEXT,
      status TEXT
    );
  `)
  if (pricingSetting) {
    sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('pricing', ?)").run(JSON.stringify(pricingSetting))
  }
  for (const c of coupons) {
    sqlite.prepare(
      'INSERT INTO Coupons (code, discount_type, discount_value, is_active, expires_at, max_uses, used_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(c.code, c.discount_type, c.discount_value, c.is_active ?? 1, c.expires_at ?? null, c.max_uses ?? null, c.used_count ?? 0)
  }

  const plain = (row: any) => (row ? { ...row } : null)
  const makeStmt = (sql: string, params: any[] = []): any => ({
    bind: (...values: any[]) => makeStmt(sql, values),
    first: async (col?: string) => {
      const row = plain(sqlite.prepare(sql).get(...params))
      return row && col ? row[col] : row
    },
    all: async () => ({ success: true, results: sqlite.prepare(sql).all(...params).map(plain), meta: {} }),
    run: async () => {
      const info = sqlite.prepare(sql).run(...params)
      return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } }
    }
  })
  return { prepare: (sql: string) => makeStmt(sql) } as unknown as D1Database
}

function makePayload(overrides: Partial<ParsedCheckoutPayload> = {}): ParsedCheckoutPayload {
  return {
    body: {},
    sourceId: 'cnon:card-nonce-ok',
    serviceId: 1,
    slotId: 1,
    clientEmail: 'client@example.com',
    clientName: 'Alex Rivera',
    locationMode: 'studio',
    isOnLocation: false,
    eventLocation: 'R59 Media Studio',
    agreementSignatureName: 'Alex Rivera',
    customerPhone: '555-0100',
    notes: '',
    attendees: 1,
    idempotencyKey: 'idem_pricing_001',
    couponCode: '',
    selectedFeeIds: [],
    photoPermissionPortfolio: 0,
    photoPermissionSocial: 0,
    photoPermissionAcceptedAt: null,
    photoPermissionVersion: 'v1',
    consentSummary: '',
    ...overrides
  }
}

test('computeCheckoutPricing calculates baseFee, perPerson extra attendees, percent coupon, and deposit via real checkout math', async () => {
  const db = createPricingDb(
    { baseFee: 25, perPerson: 20, depositPercent: 50 },
    [{ code: 'SAVE10', discount_type: 'percent', discount_value: 10, is_active: 1 }]
  )

  const res = await computeCheckoutPricing(db, {
    payload: makePayload({ attendees: 3, couponCode: 'SAVE10' }),
    slot: { id: 1, date: '2026-12-20', start_time: '10:00' },
    service: { id: 1, name: 'Portrait', best_for: 'Portraits', price: 15000 },
    parsedServiceAdditionalPeople: { includedPeople: 1 },
    timeZone: 'America/New_York'
  })

  assert.equal(res.ok, true)
  if (!res.ok) return
  // 15000 + 2500 + 2*2000 = 21500 subtotal; -10% (2150) = 19350; 50% deposit = 9675
  assert.equal(res.pricing.finalPriceCents, 19350)
  assert.equal(res.pricing.depositPercent, 50)
  assert.equal(res.pricing.depositCents, 9675)
  assert.equal(res.pricing.validCouponCode, 'SAVE10')

  const totals = computeTotals({ price_at_booking: res.pricing.finalPriceCents, deposit_paid: res.pricing.depositCents }, 0, 0)
  assert.equal(totals.balance_cents, 9675)
})

test('computeCheckoutPricing floors fixed coupon discounts at $0 and enforces depositFor $1.00 minimum floor', async () => {
  const db = createPricingDb(
    { depositPercent: 60 },
    [{ code: 'FREE150', discount_type: 'fixed', discount_value: 150, is_active: 1 }]
  )

  const zeroRes = await computeCheckoutPricing(db, {
    payload: makePayload({ couponCode: 'FREE150' }),
    slot: { id: 1, date: '2026-12-20', start_time: '10:00' },
    service: { id: 1, name: 'Mini', price: 10000 },
    parsedServiceAdditionalPeople: null,
    timeZone: 'America/New_York'
  })
  assert.equal(zeroRes.ok, true)
  if (!zeroRes.ok) return
  assert.equal(zeroRes.pricing.finalPriceCents, 0)
  assert.equal(zeroRes.pricing.depositCents, 0)
  assert.equal(zeroRes.pricing.squareChargeCents, 0)

  // $1.20 subtotal at 50% -> depositFor raises 60c up to Square $1.00 (100c) minimum; $0.80 -> caps at 80c (100%)
  assert.deepEqual(depositFor(120, normalizeDepositPercent(50)), { cents: 100, percent: 50 })
  assert.deepEqual(depositFor(80, normalizeDepositPercent(50)), { cents: 80, percent: 100 })
})

test('computeCheckoutPricing enforces requireSignature policy and evaluateDynamicFees applies matching rules', async () => {
  const db = createPricingDb({
    depositPercent: 60,
    policy: { requireSignature: true },
    feeRules: [
      { id: 'loc_fee', name: 'On-Location Travel', triggerType: 'on_location', amountType: 'fixed_cents', amountValue: 4500, active: true }
    ]
  })

  const missingSig = await computeCheckoutPricing(db, {
    payload: makePayload({ agreementSignatureName: '' }),
    slot: { id: 1, date: '2026-12-20', start_time: '10:00' },
    service: { id: 1, name: 'Portrait', price: 10000 },
    parsedServiceAdditionalPeople: null,
    timeZone: 'America/New_York'
  })
  assert.deepEqual(missingSig, { ok: false, code: 'SIGNATURE_REQUIRED' })

  const withLoc = await computeCheckoutPricing(db, {
    payload: makePayload({ isOnLocation: true, locationMode: 'on_location', eventLocation: 'Downtown' }),
    slot: { id: 1, date: '2026-12-20', start_time: '10:00' },
    service: { id: 1, name: 'Portrait', price: 10000 },
    parsedServiceAdditionalPeople: null,
    timeZone: 'America/New_York'
  })
  assert.equal(withLoc.ok, true)
  if (!withLoc.ok) return
  assert.equal(withLoc.pricing.totalFeeCents, 4500)
  assert.equal(withLoc.pricing.finalPriceCents, 14500)
  assert.equal(evaluateDynamicFees([], { subtotalCents: 10000, sessionDate: '2026-12-20', timeZone: 'America/New_York' }).totalFeeCents, 0)
})

test('weekly availability: isSlotInWeeklyAvailability with and without active rules', () => {
  assert.equal(isSlotInWeeklyAvailability({ date: '2026-11-16', start_time: '10:00', end_time: '11:00' }, []), true)
  assert.equal(
    isSlotInWeeklyAvailability(
      { date: '2026-11-16', start_time: '10:00', end_time: '11:00' },
      [
        { day: 'Monday', available: false, timeframes: [] },
        { day: 'Tuesday', available: false, timeframes: [] }
      ]
    ),
    false
  )

  const weeklyAvailability = [
    { day: 'Monday', available: true, timeframes: [{ start: '09:00', end: '17:00' }] },
    { day: 'Tuesday', available: false, timeframes: [] }
  ]

  assert.equal(isSlotInWeeklyAvailability({ date: '2026-11-16', start_time: '10:00', end_time: '11:00' }, weeklyAvailability), true)
  assert.equal(isSlotInWeeklyAvailability({ date: '2026-11-16', start_time: '08:00', end_time: '09:00' }, weeklyAvailability), false)
  assert.equal(isSlotInWeeklyAvailability({ date: '2026-11-16', start_time: '16:30', end_time: '17:30' }, weeklyAvailability), false)
  assert.equal(isSlotInWeeklyAvailability({ date: '2026-11-17', start_time: '10:00', end_time: '11:00' }, weeklyAvailability), false)
})
