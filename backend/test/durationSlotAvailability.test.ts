import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import type { Bindings } from '../src/index.ts'
import { isSlotInWeeklyAvailability, scheduleRouter } from '../src/routes/schedule.ts'
import { rescheduleRoutes, signRescheduleToken } from '../src/routes/reschedule.ts'
import { adminRouter } from '../src/routes/admin.ts'
import { createSessionToken } from '../src/middleware/auth.ts'
import { BOOKING_PAYMENTS_TABLE_SQL, BILLING_SCHEMA_STEPS } from '../src/lib/billingSchema.ts'
import {
  computeSessionEndTime,
  lockSlotsAtomically,
  parseTimeToMinutes,
  releaseBookingSlots,
  resolveBookingSlotIds,
  resolveSlotWindow,
  type SlotRowLike
} from '../src/lib/scheduleSync.ts'

function createD1(sqlite: DatabaseSync): any {
  const plain = (row: any) => (row ? { ...row } : null)
  const makeStatement = (sql: string, params: any[] = []): any => ({
    sql,
    params,
    bind: (...values: any[]) => makeStatement(sql, values),
    first: async (column?: string) => {
      const row = plain(sqlite.prepare(sql).get(...params))
      return row && column ? row[column] : row
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
    prepare: (sql: string) => makeStatement(sql),
    exec: async (sql: string) => sqlite.exec(sql),
    batch: async (statements: any[]) => {
      sqlite.exec('BEGIN')
      try {
        const out = []
        for (const s of statements) {
          out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run())
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

function getSlotStates(sqlite: DatabaseSync) {
  return sqlite
    .prepare('SELECT id, is_booked FROM Schedule_Slots ORDER BY id')
    .all()
    .map((r: any) => ({ id: r.id, is_booked: r.is_booked }))
}

function getFutureNewYorkDate(daysAhead: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const base = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day))
  return new Date(base + daysAhead * 86400000).toISOString().slice(0, 10)
}

function setupSchedulingDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE Services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER,
      duration_minutes INTEGER,
      full_day INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT 1
    );
    CREATE TABLE Schedule_Slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_booked BOOLEAN DEFAULT 0
    );
    CREATE TABLE Blocked_Dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Admin_Settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL
    );
    CREATE TABLE Site_Settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE Bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER,
      slot_id INTEGER,
      client_name TEXT NOT NULL,
      client_email TEXT NOT NULL,
      price_at_booking INTEGER NOT NULL,
      square_payment_id TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      customer_phone TEXT DEFAULT '',
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      attendees INTEGER DEFAULT 1,
      deposit_paid INTEGER DEFAULT 0,
      custom_price INTEGER,
      deposit_percent INTEGER,
      event_location TEXT,
      photo_permission_portfolio BOOLEAN DEFAULT 0,
      photo_permission_social BOOLEAN DEFAULT 0,
      photo_permission_accepted_at TEXT,
      photo_permission_version TEXT DEFAULT 'v1',
      agreement_signed_name TEXT,
      agreement_signed_at TEXT,
      applied_fees_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE Revoked_Sessions (
      signature TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE Login_Attempts (
      bucket TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_start INTEGER NOT NULL
    );
  `)
  sqlite.exec(BOOKING_PAYMENTS_TABLE_SQL)
  for (const step of BILLING_SCHEMA_STEPS) {
    try {
      sqlite.exec(step.sql)
    } catch (err) {
      if (!step.ignoreError) throw err
    }
  }
  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('timezone', 'America/New_York')").run()
  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('last_slot_sync_date', '2099-12-31')").run()
  return { sqlite, db: createD1(sqlite) }
}

const slot = (id: number, start_time: string, end_time: string, is_booked = 0, date = '2026-11-25'): SlotRowLike => ({
  id,
  date,
  start_time,
  end_time,
  is_booked
})

// ── 1. Time parsing, midnight & session end time ────────────────────────────

test('parseTimeToMinutes handles 24h, 12h, 24:00 and rejects invalid strings', () => {
  assert.equal(parseTimeToMinutes('09:00'), 540)
  assert.equal(parseTimeToMinutes('23:59'), 1439)
  assert.equal(parseTimeToMinutes('24:00'), 1440)
  assert.equal(parseTimeToMinutes('2:00 PM'), 840)
  assert.equal(parseTimeToMinutes('12:00 AM'), 0)
  assert.equal(parseTimeToMinutes('12:00 PM'), 720)
  assert.equal(parseTimeToMinutes('12:30 am'), 30)

  for (const invalid of ['', '   ', '25:00', '24:01', '13:00 PM', '0:00 AM', '09:60', 'not-a-time']) {
    assert.equal(parseTimeToMinutes(invalid), null, `Expected null for ${JSON.stringify(invalid)}`)
  }
})

test('isSlotInWeeklyAvailability correctly enforces multi-hour service duration', () => {
  const weeklyAvailability = [
    {
      day: 'Sunday',
      available: true,
      timeframes: [{ start: '08:00', end: '23:59' }]
    },
    {
      day: 'Monday',
      available: true,
      timeframes: [{ start: '08:00', end: '23:00' }]
    }
  ]

  // Sunday 2026-11-22: Admin open 08:00 to 23:59
  const sundaySlot7PM = { date: '2026-11-22', start_time: '19:00', end_time: '20:00' }
  const sundaySlot3PM = { date: '2026-11-22', start_time: '15:00', end_time: '16:00' }
  const sundaySlot8AM = { date: '2026-11-22', start_time: '08:00', end_time: '09:00' }

  // 1. Without duration (1-hour default): 7:00 PM fits
  assert.equal(isSlotInWeeklyAvailability(sundaySlot7PM, weeklyAvailability), true)

  // 2. Wedding package (8 hours / 480 min):
  // 7:00 PM (19:00) + 8 hours = 03:00 AM next day -> MUST FAIL
  assert.equal(isSlotInWeeklyAvailability(sundaySlot7PM, weeklyAvailability, 480), false)

  // 3. Wedding package @ 3:00 PM (15:00) + 8 hours = 23:00 <= 23:59 -> MUST SUCCEED
  assert.equal(isSlotInWeeklyAvailability(sundaySlot3PM, weeklyAvailability, 480), true)

  // 4. Wedding package @ 8:00 AM (08:00) + 8 hours = 16:00 <= 23:59 -> MUST SUCCEED
  assert.equal(isSlotInWeeklyAvailability(sundaySlot8AM, weeklyAvailability, 480), true)

  // Monday 2026-11-23: Admin open 08:00 to 23:00
  const mondaySlot4PM = { date: '2026-11-23', start_time: '16:00', end_time: '17:00' }
  const mondaySlot3PM = { date: '2026-11-23', start_time: '15:00', end_time: '16:00' }

  // 16:00 + 8h = 24:00 (crosses 23:00 close) -> MUST FAIL
  assert.equal(isSlotInWeeklyAvailability(mondaySlot4PM, weeklyAvailability, 480), false)

  // 15:00 + 8h = 23:00 (exactly at 23:00 close) -> MUST SUCCEED
  assert.equal(isSlotInWeeklyAvailability(mondaySlot3PM, weeklyAvailability, 480), true)

  // 1-hour session @ 4:00 PM on Monday -> MUST SUCCEED
  assert.equal(isSlotInWeeklyAvailability(mondaySlot4PM, weeklyAvailability, 60), true)
})

test('isSlotInWeeklyAvailability rejects midnight overflow even when weeklyAvailability is empty', () => {
  const lateSlot = { date: '2026-11-22', start_time: '23:00', end_time: '23:59' }
  const exactMidnightSlot = { date: '2026-11-22', start_time: '22:00', end_time: '23:00' }

  assert.equal(isSlotInWeeklyAvailability(lateSlot, [], 120), false)
  assert.equal(isSlotInWeeklyAvailability(exactMidnightSlot, [], 120), true)
  assert.equal(isSlotInWeeklyAvailability({ date: '2026-11-22', start_time: 'bad' }, [], 60), false)
})

test('computeSessionEndTime computes end times and clamps >= 1440 to 23:59', () => {
  assert.equal(computeSessionEndTime('10:00', '11:00', 120), '12:00')
  assert.equal(computeSessionEndTime('22:00', '23:00', 120), '23:59')
  assert.equal(computeSessionEndTime('23:00', '23:59', 120), '23:59')
  assert.equal(computeSessionEndTime('invalid', '11:00', 120), '11:00')
})

// ── 2. resolveSlotWindow ────────────────────────────────────────────────────

test('resolveSlotWindow handles consecutive coverage, missing slots, and booked slots', () => {
  const s1 = slot(1, '10:00', '11:00', 0)
  const s2 = slot(2, '11:00', '12:00', 0)
  assert.deepEqual(
    resolveSlotWindow({ daySlots: [s1, s2], startSlot: s1, durationMinutes: 120 }),
    { ok: true, slotIds: [1, 2], endTime: '12:00' }
  )

  // Missing slot 2
  assert.deepEqual(
    resolveSlotWindow({ daySlots: [s1], startSlot: s1, durationMinutes: 120 }),
    { ok: false, reason: 'INSUFFICIENT_COVERAGE', slotIds: [] }
  )

  // Booked slot 2
  const s2Booked = slot(2, '11:00', '12:00', 1)
  assert.deepEqual(
    resolveSlotWindow({ daySlots: [s1, s2Booked], startSlot: s1, durationMinutes: 120 }),
    { ok: false, reason: 'SLOT_OVERLAPS_BOOKED', slotIds: [] }
  )
})

test('resolveSlotWindow rejects duplicate booked slot even when an unbooked duplicate exists (Medium #9)', () => {
  const s1 = slot(1, '10:00', '11:00', 0)
  const s2Unbooked = slot(2, '11:00', '12:00', 0)
  const s2BookedDup = slot(3, '11:00', '12:00', 1)

  assert.deepEqual(
    resolveSlotWindow({
      daySlots: [s1, s2Unbooked, s2BookedDup],
      startSlot: s1,
      durationMinutes: 120
    }),
    { ok: false, reason: 'SLOT_OVERLAPS_BOOKED', slotIds: [] }
  )

  // Also reject when startSlot itself has a booked duplicate at the same time
  const s1BookedDup = slot(4, '10:00', '11:00', 1)
  assert.deepEqual(
    resolveSlotWindow({
      daySlots: [s1, s1BookedDup, s2Unbooked],
      startSlot: s1,
      durationMinutes: 120
    }),
    { ok: false, reason: 'SLOT_OVERLAPS_BOOKED', slotIds: [] }
  )
})

test('resolveSlotWindow supports bufferMinutes > 0 and rejects gaps exceeding buffer (High #6)', () => {
  const s1 = slot(1, '09:00', '10:00', 0)
  const s2WithinBuffer = slot(2, '10:30', '11:30', 0)

  assert.deepEqual(
    resolveSlotWindow({
      daySlots: [s1, s2WithinBuffer],
      startSlot: s1,
      durationMinutes: 120,
      bufferMinutes: 30
    }),
    { ok: true, slotIds: [1, 2], endTime: '11:00' }
  )

  // Gap of 45m exceeds bufferMinutes = 30
  const s2ExceedsBuffer = slot(3, '10:45', '11:45', 0)
  assert.deepEqual(
    resolveSlotWindow({
      daySlots: [s1, s2ExceedsBuffer],
      startSlot: s1,
      durationMinutes: 120,
      bufferMinutes: 30
    }),
    { ok: false, reason: 'INSUFFICIENT_COVERAGE', slotIds: [] }
  )

  // Gap of 30m exceeds bufferMinutes = 15
  assert.deepEqual(
    resolveSlotWindow({
      daySlots: [s1, s2WithinBuffer],
      startSlot: s1,
      durationMinutes: 120,
      bufferMinutes: 15
    }),
    { ok: false, reason: 'INSUFFICIENT_COVERAGE', slotIds: [] }
  )
})

test('resolveSlotWindow supports exemptSlotIds for overlapping reschedule windows (Critical #3)', () => {
  const s1 = slot(1, '10:00', '11:00', 1)
  const s2 = slot(2, '11:00', '12:00', 1)
  const s3 = slot(3, '12:00', '13:00', 0)

  // Without exemptSlotIds, rescheduling 10:00-12:00 -> 11:00-13:00 fails
  assert.deepEqual(
    resolveSlotWindow({
      daySlots: [s1, s2, s3],
      startSlot: s2,
      durationMinutes: 120
    }),
    { ok: false, reason: 'SLOT_OVERLAPS_BOOKED', slotIds: [] }
  )

  // With exemptSlotIds = [1, 2], overlapping window 11:00-13:00 succeeds
  assert.deepEqual(
    resolveSlotWindow({
      daySlots: [s1, s2, s3],
      startSlot: s2,
      durationMinutes: 120,
      exemptSlotIds: [1, 2]
    }),
    { ok: true, slotIds: [2, 3], endTime: '13:00' }
  )
})

test('resolveSlotWindow fullDay locks all day slots and rejects any non-exempt booked slot', () => {
  const s1 = slot(1, '09:00', '10:00', 0)
  const s2 = slot(2, '10:00', '11:00', 0)
  const s3 = slot(3, '14:00', '15:00', 0)

  assert.deepEqual(
    resolveSlotWindow({
      daySlots: [s1, s2, s3],
      startSlot: s1,
      durationMinutes: 60,
      fullDay: true
    }),
    { ok: true, slotIds: [1, 2, 3], endTime: '15:00' }
  )

  const s3Booked = slot(3, '14:00', '15:00', 1)
  assert.deepEqual(
    resolveSlotWindow({
      daySlots: [s1, s2, s3Booked],
      startSlot: s1,
      durationMinutes: 60,
      fullDay: true
    }),
    { ok: false, reason: 'SLOT_OVERLAPS_BOOKED', slotIds: [] }
  )

  // Succeeds when the only booked slot on that day is exempt
  assert.deepEqual(
    resolveSlotWindow({
      daySlots: [s1, s2, s3Booked],
      startSlot: s1,
      durationMinutes: 60,
      fullDay: true,
      exemptSlotIds: [3]
    }),
    { ok: true, slotIds: [1, 2, 3], endTime: '15:00' }
  )
})

// ── 3. Atomic locking (lockSlotsAtomically) ─────────────────────────────────

test('lockSlotsAtomically locks all free unblocked slots and preserves concurrent locks on race (Critical #2)', async () => {
  const { sqlite, db } = setupSchedulingDb()
  const date = '2026-12-01'
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 0)").run(date)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '11:00', '12:00', 0)").run(date)

  // Blocked date prevents locking
  sqlite.prepare('INSERT INTO Blocked_Dates (date, reason) VALUES (?, ?)').run(date, 'Holiday')
  const blockedRes = await lockSlotsAtomically(db, [1, 2])
  assert.deepEqual(blockedRes, { ok: false, newlyLockedIds: [] })
  assert.deepEqual(getSlotStates(sqlite), [{ id: 1, is_booked: 0 }, { id: 2, is_booked: 0 }])
  sqlite.prepare('DELETE FROM Blocked_Dates WHERE date = ?').run(date)

  // Concurrent race: slot 1 is free (0), slot 2 is already booked (1) by another user
  sqlite.prepare('UPDATE Schedule_Slots SET is_booked = 1 WHERE id = 2').run()
  const raceRes = await lockSlotsAtomically(db, [1, 2])
  assert.deepEqual(raceRes, { ok: false, newlyLockedIds: [] })
  // Must modify 0 rows: slot 1 stays 0, and slot 2 MUST remain is_booked = 1!
  assert.deepEqual(getSlotStates(sqlite), [{ id: 1, is_booked: 0 }, { id: 2, is_booked: 1 }])

  // Free both slots and lock atomically
  sqlite.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = 2').run()
  const okRes = await lockSlotsAtomically(db, [1, 2])
  assert.deepEqual(okRes, { ok: true, newlyLockedIds: [1, 2] })
  assert.deepEqual(getSlotStates(sqlite), [{ id: 1, is_booked: 1 }, { id: 2, is_booked: 1 }])
})

// ── 4. releaseBookingSlots & resolveBookingSlotIds ──────────────────────────

test('releaseBookingSlots respects explicit oldSlotId after DB update and keepSlotIds (Critical #1)', async () => {
  const { sqlite, db } = setupSchedulingDb()
  const date = '2026-12-05'
  sqlite.prepare("INSERT INTO Services (id, name, price, duration_minutes) VALUES (1, '2h Session', 20000, 120)").run()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 1)").run(date)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '11:00', '12:00', 1)").run(date)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (3, ?, '12:00', '13:00', 1)").run(date)
  // Booking already updated to newSlotId = 2 (overlapping 11:00-13:00)
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (10, 1, 2, 'Jane', 'jane@example.com', 20000, 'confirmed')"
  ).run()

  const released = await releaseBookingSlots(db, 10, 1, { keepSlotIds: [2, 3] })
  assert.deepEqual(released, [1])
  assert.deepEqual(getSlotStates(sqlite), [
    { id: 1, is_booked: 0 },
    { id: 2, is_booked: 1 },
    { id: 3, is_booked: 1 }
  ])
})

test('releaseBookingSlots releases both 30-min slots for a 60-min service (no <= 60 shortcut bug)', async () => {
  const { sqlite, db } = setupSchedulingDb()
  const date = '2026-12-06'
  sqlite.prepare("INSERT INTO Services (id, name, price, duration_minutes) VALUES (1, '1h Session', 10000, 60)").run()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '10:30', 1)").run(date)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '10:30', '11:00', 1)").run(date)
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (1, 1, 1, 'Alex', 'alex@example.com', 10000, 'confirmed')"
  ).run()

  const resolved = await resolveBookingSlotIds(db, { bookingId: 1 })
  assert.deepEqual(resolved.slotIds, [1, 2])

  const released = await releaseBookingSlots(db, 1, 1)
  assert.deepEqual(released, [1, 2])
  assert.deepEqual(getSlotStates(sqlite), [
    { id: 1, is_booked: 0 },
    { id: 2, is_booked: 0 }
  ])
})

test('releaseBookingSlots tolerates slot_id = NULL rows and protects active booking slot 1 and trailing slots (High #5)', async () => {
  const { sqlite, db } = setupSchedulingDb()
  const date = '2026-12-07'
  sqlite.prepare("INSERT INTO Services (id, name, price, duration_minutes) VALUES (1, '3h Session', 30000, 180)").run()
  sqlite.prepare("INSERT INTO Services (id, name, price, duration_minutes) VALUES (2, '2h Session', 20000, 120)").run()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 1)").run(date)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '11:00', '12:00', 1)").run(date)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (3, ?, '12:00', '13:00', 1)").run(date)

  // Booking 1: 180m covering slots 1, 2, 3
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (1, 1, 1, 'Alice', 'alice@example.com', 30000, 'confirmed')"
  ).run()
  // Booking 2: active 120m booking covering slot 2 (start) and slot 3 (trailing)
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (2, 2, 2, 'Bob', 'bob@example.com', 20000, 'confirmed')"
  ).run()
  // Booking 3: active row with slot_id = NULL (must not poison NOT IN)
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (3, 2, NULL, 'NullSlot', 'null@example.com', 20000, 'confirmed')"
  ).run()

  const resolved = await resolveBookingSlotIds(db, { bookingId: 1 })
  assert.deepEqual(resolved.slotIds, [1, 2, 3])
  assert.deepEqual(resolved.protectedOtherSlotIds, [2, 3])

  const released = await releaseBookingSlots(db, 1, 1)
  assert.deepEqual(released, [1])
  assert.deepEqual(getSlotStates(sqlite), [
    { id: 1, is_booked: 0 },
    { id: 2, is_booked: 1 },
    { id: 3, is_booked: 1 }
  ])
})

// ── 5. Route-level tests ────────────────────────────────────────────────────

test('GET /api/schedule?duration=120 omits 10:00 when 11:00 is booked', async () => {
  const { sqlite, db } = setupSchedulingDb()
  const targetDate = getFutureNewYorkDate(10)

  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '09:00', '10:00', 0)").run(targetDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '10:00', '11:00', 0)").run(targetDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (3, ?, '11:00', '12:00', 1)").run(targetDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (4, ?, '12:00', '13:00', 0)").run(targetDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (5, ?, '13:00', '14:00', 0)").run(targetDate)

  const app = new Hono<{ Bindings: Bindings }>()
  app.route('/api/schedule', scheduleRouter)

  const res = await app.request(
    'http://localhost/api/schedule?duration=120',
    {},
    { DB: db } as Bindings
  )
  assert.equal(res.status, 200)
  const json = (await res.json()) as { slots: SlotRowLike[] }
  assert.deepEqual(
    json.slots.map((s) => s.start_time),
    ['09:00', '12:00']
  )
})

test('POST /api/bookings/:id/reschedule handles non-overlapping and overlapping (10:00-12:00 -> 11:00-13:00) reschedules', async () => {
  const { sqlite, db } = setupSchedulingDb()
  const sessionDate = getFutureNewYorkDate(14)
  const secret = 'r'.repeat(32)

  sqlite.prepare("INSERT INTO Services (id, name, price, duration_minutes) VALUES (1, '2h Portrait', 25000, 120)").run()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 1)").run(sessionDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '11:00', '12:00', 1)").run(sessionDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (3, ?, '12:00', '13:00', 0)").run(sessionDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (4, ?, '14:00', '15:00', 0)").run(sessionDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (5, ?, '15:00', '16:00', 0)").run(sessionDate)

  sqlite.prepare(
    `INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, customer_phone, price_at_booking, deposit_paid, status)
     VALUES (1, 1, 1, 'Jane Doe', 'jane@example.com', '4045551234', 25000, 25000, 'confirmed')`
  ).run()

  const app = new Hono<{ Bindings: Bindings }>()
  app.route('/api/bookings', rescheduleRoutes)
  const env = { DB: db, SESSION_SECRET: secret } as Bindings
  const token = await signRescheduleToken(1, 'jane@example.com', secret)

  // 1. Overlapping reschedule: 10:00-12:00 (slots 1,2) -> 11:00-13:00 (slots 2,3)
  const overlapRes = await app.request(
    'http://localhost/api/bookings/1/reschedule',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.1' },
      body: JSON.stringify({
        token,
        verifyName: 'Jane Doe',
        verifyEmail: 'jane@example.com',
        slot_id: 2
      })
    },
    env
  )
  assert.equal(overlapRes.status, 200)
  const overlapJson = (await overlapRes.json()) as any
  assert.equal(overlapJson.booking.slot_id, 2)
  assert.equal(overlapJson.booking.end_time, '13:00')
  assert.deepEqual(getSlotStates(sqlite), [
    { id: 1, is_booked: 0 },
    { id: 2, is_booked: 1 },
    { id: 3, is_booked: 1 },
    { id: 4, is_booked: 0 },
    { id: 5, is_booked: 0 }
  ])

  // 2. Non-overlapping reschedule: 11:00-13:00 (slots 2,3) -> 14:00-16:00 (slots 4,5)
  const nonOverlapRes = await app.request(
    'http://localhost/api/bookings/1/reschedule',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.2' },
      body: JSON.stringify({
        token,
        verifyName: 'Jane Doe',
        verifyEmail: 'jane@example.com',
        slot_id: 4
      })
    },
    env
  )
  assert.equal(nonOverlapRes.status, 200)
  const nonOverlapJson = (await nonOverlapRes.json()) as any
  assert.equal(nonOverlapJson.booking.slot_id, 4)
  assert.equal(nonOverlapJson.booking.end_time, '16:00')
  assert.deepEqual(getSlotStates(sqlite), [
    { id: 1, is_booked: 0 },
    { id: 2, is_booked: 0 },
    { id: 3, is_booked: 0 },
    { id: 4, is_booked: 1 },
    { id: 5, is_booked: 1 }
  ])
})

test('DELETE /api/admin/bookings/:id releases ALL consecutive slots 1..N (High #4)', async () => {
  const { sqlite, db } = setupSchedulingDb()
  const sessionDate = getFutureNewYorkDate(14)
  const secret = 'a'.repeat(32)
  const adminEmail = 'admin@example.com'

  sqlite.prepare("INSERT INTO Services (id, name, price, duration_minutes) VALUES (1, '3h Package', 30000, 180)").run()
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (1, ?, '10:00', '11:00', 1)").run(sessionDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (2, ?, '11:00', '12:00', 1)").run(sessionDate)
  sqlite.prepare("INSERT INTO Schedule_Slots (id, date, start_time, end_time, is_booked) VALUES (3, ?, '12:00', '13:00', 1)").run(sessionDate)
  sqlite.prepare(
    "INSERT INTO Bookings (id, service_id, slot_id, client_name, client_email, price_at_booking, status) VALUES (1, 1, 1, 'Sam', 'sam@example.com', 30000, 'confirmed')"
  ).run()

  const app = new Hono<{ Bindings: Bindings }>()
  app.route('/api/admin', adminRouter)
  const sessionToken = await createSessionToken(secret, adminEmail)

  const res = await app.request(
    'http://localhost/api/admin/bookings/1',
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` }
    },
    { DB: db, SESSION_SECRET: secret, ADMIN_EMAIL: adminEmail } as Bindings
  )
  assert.equal(res.status, 200)
  const json = (await res.json()) as any
  assert.equal(json.success, true)

  assert.equal((sqlite.prepare('SELECT COUNT(*) AS cnt FROM Bookings WHERE id = 1').get() as any)?.cnt, 0)
  assert.deepEqual(getSlotStates(sqlite), [
    { id: 1, is_booked: 0 },
    { id: 2, is_booked: 0 },
    { id: 3, is_booked: 0 }
  ])
})
