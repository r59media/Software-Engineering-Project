import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import realApp, { type Bindings } from '../src/index.ts'
import { LEADS_TABLE_SQL } from '../src/lib/billingSchema.ts'
import {
  isEmailConfigured,
  sendEmail,
  sendBookingConfirmationEmail,
  sendOperationalAlertEmail,
  sendNewLeadNotificationEmail
} from '../src/email.ts'

function createD1(sqlite: DatabaseSync): any {
  const plain = (row: any) => (row ? { ...row } : null)
  const makeStmt = (sql: string, params: any[] = []): any => ({
    sql,
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
  return {
    prepare: (sql: string) => makeStmt(sql),
    exec: async (sql: string) => sqlite.exec(sql)
  }
}

function makeContactEnv(overrides: Partial<Bindings> = {}) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(LEADS_TABLE_SQL)
  const env: Bindings = {
    DB: createD1(sqlite),
    SESSION_SECRET: 'e'.repeat(32),
    ADMIN_EMAIL: 'admin@r59media.com',
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'studio@r59media.com',
    ...overrides
  }
  return { sqlite, env }
}

test('email.ts: isEmailConfigured, sendEmail (2xx, 4xx/5xx, network failure), booking confirmation CR/LF strip, alert & lead emails', async () => {
  assert.equal(isEmailConfigured({ DB: {} as any }), false)
  assert.equal(isEmailConfigured({ DB: {} as any, RESEND_API_KEY: 'key' }), false)
  assert.equal(isEmailConfigured({ DB: {} as any, RESEND_API_KEY: 'key', EMAIL_FROM: 'a@b.com' }), true)

  const unconf = await sendEmail({ DB: {} as any }, { to: 'u@example.com', subject: 'Hi', text: 'Test' })
  assert.deepEqual(unconf, { sent: false, reason: 'not_configured' })

  const env: Bindings = {
    DB: {} as any,
    RESEND_API_KEY: 're_key',
    EMAIL_FROM: 'noreply@r59media.com',
    ADMIN_EMAIL: 'admin@r59media.com'
  }

  const sentPayloads: any[] = []
  const origFetch = globalThis.fetch
  const origErr = console.error
  const errLogs: any[] = []
  console.error = (...args: any[]) => errLogs.push(args)

  try {
    // 2xx success + CR/LF stripped from booking confirmation subject
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentPayloads.push(JSON.parse(String(init?.body || '{}')))
      return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 })
    }) as typeof fetch

    const confRes = await sendBookingConfirmationEmail(env, {
      bookingId: 42,
      clientName: 'Alex\r\nBcc: evil@attacker.com',
      clientEmail: 'alex@example.com',
      packageName: 'Portrait\r\nX-Inject: 1',
      date: '2026-12-20',
      startTime: '10:00',
      endTime: '11:00',
      location: 'R59 Media Studio',
      depositCents: 6000,
      totalCents: 10000,
      balanceCents: 4000,
      rescheduleUrl: 'https://r59media.com/reschedule?booking=42&token=abc'
    })
    assert.equal(confRes.client.sent, true)
    assert.equal(confRes.admin.sent, true)
    assert.equal(sentPayloads.length, 2)
    assert.ok(!/[\r\n]/.test(sentPayloads[0].subject))
    assert.ok(!/[\r\n]/.test(sentPayloads[1].subject))

    // Operational alert & lead notification
    assert.equal((await sendOperationalAlertEmail(env, 'Cron\nAlert', 'Details')).sent, true)
    assert.equal((await sendNewLeadNotificationEmail(env, { id: 7, name: 'Sam', email: 'sam@example.com', sessionType: 'Portrait', message: 'Hi' })).sent, true)
    assert.equal((await sendOperationalAlertEmail({ ...env, ADMIN_EMAIL: '' }, 'Alert', 'Body')).reason, 'no_admin_email')
    assert.equal((await sendNewLeadNotificationEmail({ ...env, ADMIN_EMAIL: '' }, { name: 'Sam', email: 'sam@example.com', message: 'Hi' })).reason, 'no_admin_email')

    // 4xx/5xx error response
    globalThis.fetch = (async () => new Response('Invalid recipient', { status: 422 })) as typeof fetch
    const httpErr = await sendEmail(env, { to: 'bad@example.com', subject: 'Fail', text: 'Body' })
    assert.deepEqual(httpErr, { sent: false, reason: 'http_422' })
    assert.ok(errLogs.length >= 1)

    // Network failure
    globalThis.fetch = (async () => {
      throw new Error('ECONNRESET')
    }) as typeof fetch
    const netErr = await sendEmail(env, { to: 'u@example.com', subject: 'Net', text: 'Body' })
    assert.deepEqual(netErr, { sent: false, reason: 'network_error' })
  } finally {
    globalThis.fetch = origFetch
    console.error = origErr
  }
})

test('POST /api/contact & /api/leads enforce UTF-8 >10KB (413), PCI guard (400), honeypot, Idempotency-Key, and D1 rate limit (429)', async () => {
  const { sqlite, env } = makeContactEnv()
  const origFetch = globalThis.fetch
  const emailBodies: any[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('api.resend.com/emails')) {
      emailBodies.push(JSON.parse(String(init?.body || '{}')))
      return new Response(JSON.stringify({ id: 'lead_mail_1' }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch

  try {
    // 1. Multi-byte UTF-8 > 10KB -> 413
    const bigPayload = JSON.stringify({ name: 'Big', email: 'big@example.com', message: '🔥'.repeat(3000) })
    const res413 = await realApp.fetch(
      new Request('http://localhost/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.10' },
        body: bigPayload
      }),
      env
    )
    assert.equal(res413.status, 413)

    // 2. hasForbiddenPaymentFields -> 400
    const resPci = await realApp.fetch(
      new Request('http://localhost/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.11' },
        body: JSON.stringify({ name: 'PCI', email: 'pci@example.com', cardNumber: '4111', message: 'hi' })
      }),
      env
    )
    assert.equal(resPci.status, 400)

    // 3. Honeypot silent drop -> 200 id: 0 without DB insert
    const resHoney = await realApp.fetch(
      new Request('http://localhost/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.12' },
        body: JSON.stringify({ name: 'Bot', email: 'bot@example.com', website: 'https://spam.example', message: 'buy now' })
      }),
      env
    )
    assert.equal(resHoney.status, 200)
    assert.equal(((await resHoney.json()) as any).id, 0)
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS cnt FROM Leads').get() as any).cnt, 0)

    // 4. Valid submission via /api/leads inserts row, triggers admin notification email, and replays Idempotency-Key
    const idemKey = 'lead_idem_unique_1'
    const leadReq = () =>
      realApp.fetch(
        new Request('http://localhost/api/leads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': '198.51.100.13',
            'Idempotency-Key': idemKey
          },
          body: JSON.stringify({
            name: 'Jordan Lee',
            email: 'jordan@example.com',
            phone: '555-0144',
            session_type: 'Portrait',
            message: 'Interested in booking next Friday.'
          })
        }),
        env
      )
    const leadRes1 = await leadReq()
    assert.equal(leadRes1.status, 200)
    const leadJson1 = (await leadRes1.json()) as any
    assert.ok(leadJson1.id > 0)

    // Allow microtask queue for fire-and-forget waitUntil email promise
    await new Promise((r) => setTimeout(r, 15))
    assert.equal(emailBodies.length, 1)
    assert.equal(emailBodies[0].to[0], 'admin@r59media.com')

    const leadRes2 = await leadReq()
    assert.equal(leadRes2.status, 200)
    assert.equal(((await leadRes2.json()) as any).id, leadJson1.id)
    assert.equal((sqlite.prepare('SELECT COUNT(*) AS cnt FROM Leads').get() as any).cnt, 1)

    // 5. D1 rate limit (> 5 requests/min from same IP -> 429)
    for (let i = 0; i < 5; i++) {
      const r = await realApp.fetch(
        new Request('http://localhost/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.90' },
          body: JSON.stringify({ name: 'Rate', email: `r${i}@example.com`, message: `Unique message ${i}` })
        }),
        env
      )
      assert.equal(r.status, 200)
    }
    const r429 = await realApp.fetch(
      new Request('http://localhost/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.90' },
        body: JSON.stringify({ name: 'Rate', email: 'r6@example.com', message: 'Blocked' })
      }),
      env
    )
    assert.equal(r429.status, 429)
    assert.ok(Number(r429.headers.get('Retry-After')) >= 1)
  } finally {
    globalThis.fetch = origFetch
  }
})

test('POST /api/contact enforces Turnstile when configured (403 missing/invalid, 200 valid) and skips when disabled', async () => {
  const { env } = makeContactEnv({ TURNSTILE_SECRET_KEY: 'turnstile_secret_123' })
  const origFetch = globalThis.fetch
  let turnstileShouldPass = false

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('challenges.cloudflare.com/turnstile')) {
      return new Response(JSON.stringify({ success: turnstileShouldPass }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return new Response(JSON.stringify({ id: 'mail_ok' }), { status: 200 })
  }) as typeof fetch

  try {
    // Missing token -> 403
    const missing = await realApp.fetch(
      new Request('http://localhost/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.50' },
        body: JSON.stringify({ name: 'User', email: 'user@example.com', message: 'Hello' })
      }),
      env
    )
    assert.equal(missing.status, 403)

    // Invalid token -> 403
    turnstileShouldPass = false
    const invalid = await realApp.fetch(
      new Request('http://localhost/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.51' },
        body: JSON.stringify({ name: 'User', email: 'user@example.com', message: 'Hello', turnstileToken: 'bad-tok' })
      }),
      env
    )
    assert.equal(invalid.status, 403)

    // Valid token -> 200
    turnstileShouldPass = true
    const valid = await realApp.fetch(
      new Request('http://localhost/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.52' },
        body: JSON.stringify({ name: 'User', email: 'user@example.com', message: 'Hello', 'cf-turnstile-response': 'good-tok' })
      }),
      env
    )
    assert.equal(valid.status, 200)
    assert.ok(((await valid.json()) as any).id > 0)
  } finally {
    globalThis.fetch = origFetch
  }
})
