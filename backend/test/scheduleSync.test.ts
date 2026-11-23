import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  ensureScheduleTables,
  syncRollingScheduleSlots,
  ensureRollingSlotsUpToDate,
  runDailyMaintenance
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
      const results = []
      for (const stmt of statements) {
        results.push(await stmt.run())
      }
      return results
    }
  }
}

function getTodayNewYork(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  return `${map.year}-${map.month}-${map.day}`
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000)
  return dt.toISOString().slice(0, 10)
}

function getDayNameIso(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

test('syncRollingScheduleSlots generates 90-day rolling slots and is idempotent', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const db = createD1(sqlite)
  await ensureScheduleTables(db)

  const today = getTodayNewYork()
  const dayName = getDayNameIso(today)
  const weeklyAvailability = [
    {
      day: dayName,
      available: true,
      timeframes: [{ start: '09:00', end: '12:00' }]
    }
  ]

  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('weekly_availability', ?)").run(
    JSON.stringify(weeklyAvailability)
  )
  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('slot_duration_minutes', '60')").run()
  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('buffer_minutes', '30')").run()
  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('timezone', 'America/New_York')").run()

  // With 60m duration + 30m buffer in 09:00-12:00: 09:00-10:00, 10:30-11:30 (2 slots per matching day)
  const first = await syncRollingScheduleSlots(db, { horizonDays: 90 })
  assert.ok(first.inserted > 0, 'Should insert slots across 90-day horizon')
  assert.equal(first.deleted, 0)
  assert.equal(first.syncDate, today)

  const rowsAfterFirst = sqlite.prepare('SELECT date, start_time, end_time, is_booked FROM Schedule_Slots ORDER BY date, start_time').all() as any[]
  assert.equal(rowsAfterFirst.length, first.inserted)
  assert.equal(rowsAfterFirst[0].date, today)
  assert.equal(rowsAfterFirst[0].start_time, '09:00')
  assert.equal(rowsAfterFirst[0].end_time, '10:00')
  assert.equal(rowsAfterFirst[1].start_time, '10:30')
  assert.equal(rowsAfterFirst[1].end_time, '11:30')

  const maxDate = rowsAfterFirst[rowsAfterFirst.length - 1].date
  assert.ok(maxDate <= addDaysIso(today, 90), 'Should not exceed 90-day horizon')
  assert.ok(maxDate >= addDaysIso(today, 83), 'Should cover up to ~90 days out')

  const syncSetting = sqlite.prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'last_slot_sync_date'").get() as any
  assert.equal(syncSetting.setting_value, today)

  // Second run must be completely idempotent
  const second = await syncRollingScheduleSlots(db, { horizonDays: 90 })
  assert.equal(second.inserted, 0)
  assert.equal(second.deleted, 0)
  const rowsAfterSecond = sqlite.prepare('SELECT COUNT(*) as cnt FROM Schedule_Slots').get() as any
  assert.equal(rowsAfterSecond.cnt, rowsAfterFirst.length)
})

test('syncRollingScheduleSlots preserves is_booked = 1 slots and cleans up stale future unbooked slots', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const db = createD1(sqlite)
  await ensureScheduleTables(db)

  const today = getTodayNewYork()
  const dayName = getDayNameIso(today)
  const otherDayDate = addDaysIso(today, 1)
  const otherDayName = getDayNameIso(otherDayDate)

  const initialWeekly = [
    { day: dayName, available: true, timeframes: [{ start: '10:00', end: '11:00' }] },
    { day: otherDayName, available: true, timeframes: [{ start: '14:00', end: '15:00' }] }
  ]
  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('weekly_availability', ?)").run(
    JSON.stringify(initialWeekly)
  )

  await syncRollingScheduleSlots(db, { horizonDays: 14 })

  // Mark one slot on otherDayDate as booked, and mark today 10:00 as booked BEFORE inserting a duplicate unbooked row
  sqlite.prepare('UPDATE Schedule_Slots SET is_booked = 1 WHERE date = ? AND start_time = ?').run(otherDayDate, '14:00')
  sqlite.prepare('UPDATE Schedule_Slots SET is_booked = 1 WHERE date = ? AND start_time = ?').run(today, '10:00')
  sqlite.prepare("INSERT INTO Schedule_Slots (date, start_time, end_time, is_booked) VALUES (?, '10:00', '11:00', 0)").run(today)

  // Now remove otherDayName from weekly availability
  const updatedWeekly = [
    { day: dayName, available: true, timeframes: [{ start: '10:00', end: '11:00' }] }
  ]
  sqlite.prepare("UPDATE Admin_Settings SET setting_value = ? WHERE setting_key = 'weekly_availability'").run(
    JSON.stringify(updatedWeekly)
  )

  const res = await syncRollingScheduleSlots(db, { horizonDays: 14 })
  assert.ok(res.deleted > 0, 'Should delete stale unbooked slots and duplicate unbooked slot')

  // Booked slot on removed day must still exist
  const bookedOther = sqlite.prepare('SELECT * FROM Schedule_Slots WHERE date = ? AND start_time = ?').all(otherDayDate, '14:00') as any[]
  assert.equal(bookedOther.length, 1)
  assert.equal(bookedOther[0].is_booked, 1)

  // Booked slot on today 10:00 must have only 1 row (no unbooked duplicate)
  const todaySlots = sqlite.prepare('SELECT * FROM Schedule_Slots WHERE date = ? AND start_time = ?').all(today, '10:00') as any[]
  assert.equal(todaySlots.length, 1)
  assert.equal(todaySlots[0].is_booked, 1)

  // Unbooked slots on otherDayName (e.g. today + 8) must be gone
  const futureOther = sqlite.prepare('SELECT * FROM Schedule_Slots WHERE date = ? AND is_booked = 0').all(addDaysIso(otherDayDate, 7)) as any[]
  assert.equal(futureOther.length, 0)
})

test('runDailyMaintenance purges expired/past unbooked data while preserving historical booked rows', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const db = createD1(sqlite)
  await ensureScheduleTables(db)

  const today = getTodayNewYork()
  const yesterday = addDaysIso(today, -1)
  const tomorrow = addDaysIso(today, 1)
  const nowMs = Date.now()

  // Schedule_Slots: past unbooked (purge), past booked (preserve), future unbooked (preserve if matching or no weekly)
  sqlite.prepare("INSERT INTO Schedule_Slots (date, start_time, end_time, is_booked) VALUES (?, '09:00', '10:00', 0)").run(yesterday)
  sqlite.prepare("INSERT INTO Schedule_Slots (date, start_time, end_time, is_booked) VALUES (?, '11:00', '12:00', 1)").run(yesterday)
  sqlite.prepare("INSERT INTO Schedule_Slots (date, start_time, end_time, is_booked) VALUES (?, '09:00', '10:00', 0)").run(tomorrow)

  // Blocked_Dates: past (purge), future (preserve)
  sqlite.prepare("INSERT INTO Blocked_Dates (date, reason) VALUES (?, 'Old')").run(yesterday)
  sqlite.prepare("INSERT INTO Blocked_Dates (date, reason) VALUES (?, 'Upcoming')").run(tomorrow)

  // Revoked_Sessions: expired (purge), active (preserve)
  sqlite.prepare('INSERT INTO Revoked_Sessions (signature, expires_at) VALUES (?, ?)').run('expired-sig', nowMs - 1000)
  sqlite.prepare('INSERT INTO Revoked_Sessions (signature, expires_at) VALUES (?, ?)').run('active-sig', nowMs + 60000)

  // Login_Attempts: > 7 days old (purge), recent (preserve)
  sqlite.prepare('INSERT INTO Login_Attempts (bucket, attempts, window_start) VALUES (?, 3, ?)').run(
    'ip:1.2.3.4',
    nowMs - 8 * 24 * 60 * 60 * 1000
  )
  sqlite.prepare('INSERT INTO Login_Attempts (bucket, attempts, window_start) VALUES (?, 1, ?)').run(
    'ip:5.6.7.8',
    nowMs - 1000
  )

  await runDailyMaintenance(db)

  const slots = (sqlite.prepare('SELECT date, start_time, is_booked FROM Schedule_Slots ORDER BY date, start_time').all() as any[]).map(r => ({ ...r }))
  assert.equal(slots.length, 2)
  assert.deepEqual(slots[0], { date: yesterday, start_time: '11:00', is_booked: 1 })
  assert.deepEqual(slots[1], { date: tomorrow, start_time: '09:00', is_booked: 0 })

  const blocked = (sqlite.prepare('SELECT date FROM Blocked_Dates').all() as any[]).map(r => ({ ...r }))
  assert.deepEqual(blocked, [{ date: tomorrow }])

  const revoked = (sqlite.prepare('SELECT signature FROM Revoked_Sessions').all() as any[]).map(r => ({ ...r }))
  assert.deepEqual(revoked, [{ signature: 'active-sig' }])

  const attempts = (sqlite.prepare('SELECT bucket FROM Login_Attempts').all() as any[]).map(r => ({ ...r }))
  assert.deepEqual(attempts, [{ bucket: 'ip:5.6.7.8' }])
})

test('ensureRollingSlotsUpToDate syncs once per calendar day lazily', async () => {
  const sqlite = new DatabaseSync(':memory:')
  const db = createD1(sqlite)
  await ensureScheduleTables(db)

  const today = getTodayNewYork()
  const dayName = getDayNameIso(today)
  sqlite.prepare("INSERT INTO Admin_Settings (setting_key, setting_value) VALUES ('weekly_availability', ?)").run(
    JSON.stringify([{ day: dayName, available: true, timeframes: [{ start: '09:00', end: '10:00' }] }])
  )

  await ensureRollingSlotsUpToDate(db, today)
  const countAfterFirst = (sqlite.prepare('SELECT COUNT(*) as cnt FROM Schedule_Slots').get() as any).cnt
  assert.ok(countAfterFirst > 0)

  // Delete all slots directly; calling ensureRollingSlotsUpToDate again on the same day should be a no-op
  sqlite.prepare('DELETE FROM Schedule_Slots').run()
  await ensureRollingSlotsUpToDate(db, today)
  const countAfterSecond = (sqlite.prepare('SELECT COUNT(*) as cnt FROM Schedule_Slots').get() as any).cnt
  assert.equal(countAfterSecond, 0)
})
