import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import realApp, { type Bindings } from '../src/index.ts'
import { BOOKING_PAYMENTS_TABLE_SQL, BILLING_SCHEMA_STEPS } from '../src/lib/billingSchema.ts'
import { depositFor } from '../src/lib/billingMath.ts'

function createD1(sqlite: DatabaseSync): any {
  const plain = (row: any) => (row ? { ...row } : null)
  const makeStmt = (sql: string, params: any[] = []): any => ({
    sql,
    params,
    bind: (...values: any[]) => makeStmt(sql, values),
    first: async (col?: string) => {
      const row = plain(sqlite.prepare(sql).get(...params))
      return row && col ? row[col] : row
    },
    all: async () => ({
      success: true,
      results: sqlite.prepare(sql).all(...params).map(plain),
      meta: {}
    }),
    run: async () => {
      const info = sqlite.prepare(sql).run(...params)
      return {
        success: true,
        results: [],
        meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }
      }
    }
  })
  return {
    prepare: (sql: string) => makeStmt(sql),
    exec: async (sql: string) => sqlite.exec(sql),
    batch: async (statements: any[]) => {
      sqlite.exec('BEGIN')
      try {
        const out = []
        for (const s of statements) {
          out.push(/^\s*(SELECT|PRAGMA)/i.test(s.sql) ? await s.all() : await s.run())
        }
        sqlite.exec('COMMIT')
        return out
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
    }
  }
}

function getFutureDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86400_000)
  return d.toISOString().slice(0, 10)
}

function setupCheckoutDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      best_for TEXT,
      price INTEGER,
      duration_minutes INTEGER DEFAULT 60,
      full_day INTEGER DEFAULT 0,
      additional_people TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE Schedule_Slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_booked INTEGER DEFAULT 0
    );
    CREATE TABLE Blocked_Dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      reason TEXT
    );
    CREATE TABLE Bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      slot_id INTEGER,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      customer_phone TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      attendees INTEGER DEFAULT 1,
      price_at_booking INTEGER NOT NULL,
      square_payment_id TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      coupon_code TEXT DEFAULT '',
      deposit_paid INTEGER DEFAULT 0,
      deposit_percent INTEGER,
      custom_price INTEGER,
      photo_permission_portfolio BOOLEAN DEFAULT 0,
      photo_permission_social BOOLEAN DEFAULT 0,
      photo_permission_accepted_at TEXT,
      photo_permission_version TEXT DEFAULT 'v1',
      event_location TEXT,
      agreement_signed_name TEXT,
      agreement_signed_at TEXT,
      applied_fees_json TEXT,
      checkout_idempotency_key TEXT,
      locked_slot_ids_json TEXT,
      gcal_sync_status TEXT,
      reschedule_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL,
      discount_value REAL NOT NULL,
      is_active INTEGER DEFAULT 1,
      expires_at TEXT,
      max_uses INTEGER,
      used_count INTEGER DEFAULT 0
    );
    CREATE TABLE Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
  `)
  sqlite.exec(BOOKING_PAYMENTS_TABLE_SQL)
  for (const step of BILLING_SCHEMA_STEPS) {
    try {
      sqlite.exec(step.sql)
    } catch (err) {
      if (!step.ignoreError) throw err
    }
  }
  sqlite.exec("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('timezone', 'America/New_York')")

  const futureDate = getFutureDate(14)
  sqlite.prepare(
    "INSERT INTO Services (id, name, best_for, price, duration_minutes, additional_people, is_active) VALUES (1, 'Portrait Session', 'Portraits', 20000, 60, ?, 1)"
  ).run(JSON.stringify({ includedPeople: 1, maxPeople: 4, extraPersonPriceMinor: 2500 }))
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 0)").run(futureDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '12:00', '13:00', 0)").run(futureDate)

  const env: Bindings = {
    DB: createD1(sqlite),
    SESSION_SECRET: 'c'.repeat(32),
    ADMIN_EMAIL: 'admin@r59media.com',
    SQUARE_ACCESS_TOKEN: 'sq-test-token',
    SQUARE_LOCATION_ID: 'LOC_123',
    SQUARE_ENVIRONMENT: 'sandbox',
    PUBLIC_ORIGIN: 'https://r59media.com'
  }
  return { sqlite, env, futureDate }
}

function makeSquareFetchMock(opts: {
  paymentStatus?: string
  paymentAmountCents?: number | ((body: any) => number)
  onRefund?: (body: any) => void
  onPaymentCreate?: (body: any) => void
  squareCalls?: string[]
}) {
  let payCounter = 0
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method || 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    opts.squareCalls?.push(`${method} ${new URL(url).pathname}`)

    if (url.includes('/v2/customers/search')) {
      return new Response(JSON.stringify({ customers: [{ id: 'cust_1', email_address: body?.query?.filter?.email_address?.exact || 'client@example.com' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    if (url.includes('/v2/orders') && method === 'POST') {
      return new Response(JSON.stringify({ order: { id: 'ord_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    if (url.includes('/v2/payments') && method === 'POST') {
      opts.onPaymentCreate?.(body)
      const amt = typeof opts.paymentAmountCents === 'function'
        ? opts.paymentAmountCents(body)
        : (opts.paymentAmountCents ?? Number(body?.amount_money?.amount ?? 12000))
      return new Response(
        JSON.stringify({
          payment: {
            id: `pay_sq_${++payCounter}`,
            status: opts.paymentStatus ?? 'COMPLETED',
            amount_money: { amount: amt, currency: 'USD' }
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    if (url.includes('/v2/refunds') && method === 'POST') {
      opts.onRefund?.(body)
      return new Response(JSON.stringify({ refund: { id: 'ref_1', status: 'COMPLETED' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    if (url.includes('/v2/invoices/') && url.endsWith('/publish')) {
      return new Response(
        JSON.stringify({
          invoice: {
            id: 'inv_bal_1',
            version: 1,
            status: 'SCHEDULED',
            invoice_number: '00042',
            public_url: 'https://squareup.com/pay/inv_bal_1',
            payment_requests: [{ due_date: '2026-12-30', total_completed_amount_money: { amount: 0, currency: 'USD' } }]
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    if (url.includes('/v2/invoices') && method === 'POST') {
      return new Response(
        JSON.stringify({
          invoice: { id: 'inv_bal_1', version: 0, status: 'DRAFT' }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response(JSON.stringify({}), { status: 404 })
  }) as typeof fetch
}

test('POST /api/checkout happy path creates booking, charges 60% deposit, locks slot, and replays idempotency key', async () => {
  const { sqlite, env } = setupCheckoutDb()
  const squareCalls: string[] = []
  const origFetch = globalThis.fetch
  globalThis.fetch = makeSquareFetchMock({ squareCalls })

  try {
    const payload = {
      serviceId: 1,
      slot_id: 1,
      sourceId: 'cnon:card-nonce-ok',
      clientName: 'Maya Lin',
      clientEmail: 'maya@example.com',
      customer_phone: '555-0199',
      attendees: 1,
      idempotencyKey: 'chk_happy_0001',
      agreementSignatureName: 'Maya Lin',
      photoPermissions: { websitePortfolio: true, socialMedia: false }
    }

    const res = await realApp.fetch(
      new Request('http://localhost/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.10' },
        body: JSON.stringify(payload)
      }),
      env
    )
    assert.equal(res.status, 201)
    const json = (await res.json()) as any
    assert.equal(json.success, true)
    assert.equal(json.paymentId, 'pay_sq_1')
    assert.equal(json.deposit_cents, 12000)
    assert.equal(json.total_cents, 20000)
    assert.equal(json.balance_cents, 8000)
    assert.ok(json.reschedule_token)
    assert.ok(json.reschedule_url.includes('https://r59media.com/reschedule'))
    assert.ok(json.ics_url.includes('/api/bookings/'))
    assert.ok(json.google_calendar_url.includes('calendar.google.com'))

    const slotRow = sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 1').get() as any
    assert.equal(slotRow.is_booked, 1)

    // Replay same checkout_idempotency_key -> returns original booking without calling Square or locking again
    const callsBeforeReplay = squareCalls.length
    const replayRes = await realApp.fetch(
      new Request('http://localhost/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.11' },
        body: JSON.stringify(payload)
      }),
      env
    )
    assert.equal(replayRes.status, 200)
    const replayJson = (await replayRes.json()) as any
    assert.equal(replayJson.idempotent, true)
    assert.equal(replayJson.bookingId, json.bookingId)
    assert.equal(squareCalls.length, callsBeforeReplay)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('POST /api/checkout rejects past slot (409), slot-lock race (409), and $0 100%-coupon skips Square', async () => {
  const { sqlite, env } = setupCheckoutDb()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (9, '2020-01-01', '10:00', '11:00', 0)").run()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (10, ?, '14:00', '15:00', 1)").run(getFutureDate(14))
  sqlite.prepare("INSERT INTO Coupons (code, discount_type, discount_value, is_active) VALUES ('COMP100', 'percent', 100, 1)").run()

  // Past slot -> 409
  const pastRes = await realApp.fetch(
    new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.12' },
      body: JSON.stringify({
        serviceId: 1,
        slot_id: 9,
        sourceId: 'cnon:card-nonce-ok',
        clientName: 'Past Client',
        clientEmail: 'past@example.com',
        idempotencyKey: 'chk_past_0001'
      })
    }),
    env
  )
  assert.equal(pastRes.status, 409)
  assert.equal(((await pastRes.json()) as any).error.code, 'SLOT_UNAVAILABLE')

  // Already-booked slot race -> 409
  const raceRes = await realApp.fetch(
    new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.13' },
      body: JSON.stringify({
        serviceId: 1,
        slot_id: 10,
        sourceId: 'cnon:card-nonce-ok',
        clientName: 'Race Client',
        clientEmail: 'race@example.com',
        idempotencyKey: 'chk_race_0001'
      })
    }),
    env
  )
  assert.equal(raceRes.status, 409)

  // 100% coupon -> skips Square even without credentials & sets deposit_paid = 0
  const noSquareEnv: Bindings = { DB: env.DB, SESSION_SECRET: env.SESSION_SECRET, ADMIN_EMAIL: env.ADMIN_EMAIL }
  const freeRes = await realApp.fetch(
    new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.14' },
      body: JSON.stringify({
        serviceId: 1,
        slot_id: 2,
        clientName: 'Free Client',
        clientEmail: 'free@example.com',
        couponCode: 'COMP100',
        agreementSignatureName: 'Free Client',
        idempotencyKey: 'chk_free_0001'
      })
    }),
    noSquareEnv
  )
  assert.equal(freeRes.status, 201)
  const freeJson = (await freeRes.json()) as any
  assert.equal(freeJson.deposit_cents, 0)
  assert.equal(freeJson.total_cents, 0)
  const bookingRow = sqlite.prepare('SELECT deposit_paid, coupon_code FROM Bookings WHERE id = ?').get(freeJson.bookingId) as any
  assert.equal(bookingRow.deposit_paid, 0)
  assert.equal(bookingRow.coupon_code, 'COMP100')
})

test('POST /api/checkout deposit rounding consistency ($1.20 subtotal) and Square failure / rollback unlock slots', async () => {
  const { sqlite, env } = setupCheckoutDb()
  sqlite.prepare("INSERT INTO Services (id, name, price, duration_minutes, is_active) VALUES (2, 'Mini', 120, 60, 1)").run()
  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('pricing', ?)").run(
    JSON.stringify({ depositPercent: 50 })
  )

  const expectedDep = depositFor(120, 50)
  assert.deepEqual(expectedDep, { cents: 100, percent: 50 })

  const origFetch = globalThis.fetch
  let chargedAmount = 0
  globalThis.fetch = makeSquareFetchMock({
    onPaymentCreate: (b) => {
      chargedAmount = Number(b?.amount_money?.amount || 0)
    }
  })

  try {
    const res = await realApp.fetch(
      new Request('http://localhost/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.15' },
        body: JSON.stringify({
          serviceId: 2,
          slot_id: 1,
          sourceId: 'cnon:card-nonce-ok',
          clientName: 'Mini Client',
          clientEmail: 'mini@example.com',
          agreementSignatureName: 'Mini Client',
          idempotencyKey: 'chk_mini_0001'
        })
      }),
      env
    )
    assert.equal(res.status, 201)
    const json = (await res.json()) as any
    assert.equal(chargedAmount, 100)
    assert.equal(json.deposit_cents, 100)

    // Square declined payment -> 402 and slot 2 remains unlocked (is_booked = 0)
    globalThis.fetch = makeSquareFetchMock({ paymentStatus: 'FAILED' })
    const failRes = await realApp.fetch(
      new Request('http://localhost/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.16' },
        body: JSON.stringify({
          serviceId: 2,
          slot_id: 2,
          sourceId: 'cnon:card-nonce-fail',
          clientName: 'Declined Client',
          clientEmail: 'declined@example.com',
          agreementSignatureName: 'Declined Client',
          idempotencyKey: 'chk_fail_0001'
        })
      }),
      env
    )
    assert.equal(failRes.status, 402)
    assert.equal(((await failRes.json()) as any).error.code, 'PAYMENT_FAILED')
    assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 2').get() as any).is_booked, 0)

    // Square payment succeeds but Bookings insert fails -> 500 BOOKING_RECORD_ERROR + refunds Square payment + unlocks slot 2
    let refundedPaymentId = ''
    globalThis.fetch = makeSquareFetchMock({
      onRefund: (body) => {
        refundedPaymentId = String(body?.payment_id || '')
      }
    })
    const origBatch = env.DB.batch.bind(env.DB)
    env.DB.batch = async () => {
      throw new Error('DB_WRITE_FAILED')
    }
    const origErr = console.error
    console.error = () => {}
    try {
      const rbRes = await realApp.fetch(
        new Request('http://localhost/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.29' },
          body: JSON.stringify({
            serviceId: 2,
            slot_id: 2,
            sourceId: 'cnon:card-nonce-ok',
            clientName: 'Rollback Client',
            clientEmail: 'rb@example.com',
            agreementSignatureName: 'Rollback Client',
            idempotencyKey: 'chk_rb_0001'
          })
        }),
        env
      )
      assert.equal(rbRes.status, 500)
      assert.equal(((await rbRes.json()) as any).error.code, 'BOOKING_RECORD_ERROR')
      assert.equal(refundedPaymentId, 'pay_sq_1')
      assert.equal((sqlite.prepare('SELECT is_booked FROM Schedule_Slots WHERE id = 2').get() as any).is_booked, 0)
    } finally {
      console.error = origErr
      env.DB.batch = origBatch
    }
  } finally {
    globalThis.fetch = origFetch
  }
})

test('POST /api/checkout validates forbidden payment fields (400), maxPeople (400), expired/maxed coupons, and malformed JSON (400)', async () => {
  const { sqlite, env } = setupCheckoutDb()
  sqlite.prepare("INSERT INTO Coupons (code, discount_type, discount_value, is_active, expires_at) VALUES ('OLD10', 'percent', 50, 1, '2020-01-01')").run()
  sqlite.prepare("INSERT INTO Coupons (code, discount_type, discount_value, is_active, max_uses, used_count) VALUES ('MAXED', 'percent', 50, 1, 1, 1)").run()

  // Malformed JSON -> 400
  const badJsonRes = await realApp.fetch(
    new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.17' },
      body: '{bad'
    }),
    env
  )
  assert.equal(badJsonRes.status, 400)

  // Forbidden raw PAN / CVV -> 400
  const pciRes = await realApp.fetch(
    new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.18' },
      body: JSON.stringify({
        serviceId: 1,
        slot_id: 1,
        sourceId: '4111111111111111',
        cvv: '123',
        clientName: 'PCI Bad',
        clientEmail: 'pci@example.com',
        idempotencyKey: 'chk_pci_0001'
      })
    }),
    env
  )
  assert.equal(pciRes.status, 400)

  // attendees > maxPeople (maxPeople = 4) -> 400
  const attRes = await realApp.fetch(
    new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.19' },
      body: JSON.stringify({
        serviceId: 1,
        slot_id: 1,
        sourceId: 'cnon:card-nonce-ok',
        attendees: 5,
        clientName: 'Big Group',
        clientEmail: 'group@example.com',
        idempotencyKey: 'chk_att_0001'
      })
    }),
    env
  )
  assert.equal(attRes.status, 400)
  assert.equal(((await attRes.json()) as any).error.details[0].field, 'attendees')

  // Expired and maxed-out coupons do not apply discount
  const origFetch = globalThis.fetch
  globalThis.fetch = makeSquareFetchMock({})
  try {
    const expRes = await realApp.fetch(
      new Request('http://localhost/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.20' },
        body: JSON.stringify({
          serviceId: 1,
          slot_id: 1,
          sourceId: 'cnon:card-nonce-ok',
          couponCode: 'OLD10',
          clientName: 'Coupon User',
          clientEmail: 'coupon1@example.com',
          agreementSignatureName: 'Coupon User',
          idempotencyKey: 'chk_exp_0001'
        })
      }),
      env
    )
    assert.equal(expRes.status, 201)
    assert.equal(((await expRes.json()) as any).total_cents, 20000)

    const maxRes = await realApp.fetch(
      new Request('http://localhost/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.21' },
        body: JSON.stringify({
          serviceId: 1,
          slot_id: 2,
          sourceId: 'cnon:card-nonce-ok',
          couponCode: 'MAXED',
          clientName: 'Coupon User 2',
          clientEmail: 'coupon2@example.com',
          agreementSignatureName: 'Coupon User 2',
          idempotencyKey: 'chk_max_0001'
        })
      }),
      env
    )
    assert.equal(maxRes.status, 201)
    assert.equal(((await maxRes.json()) as any).total_cents, 20000)
  } finally {
    globalThis.fetch = origFetch
  }
})
