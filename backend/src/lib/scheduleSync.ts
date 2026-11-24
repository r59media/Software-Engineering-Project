export interface WeeklyAvailabilityTimeframe {
  id?: number
  start: string
  end: string
  label?: string
  repeat?: string
}

export interface WeeklyAvailabilityRule {
  day: string
  available: boolean
  timeframes?: WeeklyAvailabilityTimeframe[]
}

export interface SyncRollingSlotsOptions {
  horizonDays?: number
}

export interface SyncRollingSlotsResult {
  inserted: number
  deleted: number
  syncDate: string
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const DEFAULT_TIMEZONE = 'America/New_York'
const BATCH_CHUNK_SIZE = 50
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

const lastSyncDateByDb = new WeakMap<D1Database, string>()
const inFlightSyncByDb = new WeakMap<D1Database, Promise<void>>()

const SCHEDULE_TABLES_DDL = [
  `CREATE TABLE IF NOT EXISTS Schedule_Slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    is_booked BOOLEAN DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS Blocked_Dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS Admin_Settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS Revoked_Sessions (
    signature TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS Login_Attempts (
    bucket TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  )`
] as const

export async function ensureScheduleTables(db: D1Database): Promise<void> {
  for (const sql of SCHEDULE_TABLES_DDL) {
    await db.prepare(sql).run()
  }
}

function getTodayInTimezone(timezone: string): string {
  const now = new Date()
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  }
  const parts = formatter.formatToParts(now)
  const map: Record<string, string> = {}
  for (const part of parts) {
    map[part.type] = part.value
  }
  return `${map.year}-${map.month}-${map.day}`
}

function addDaysToIsoDate(isoDate: string, days: number): { date: string; dayOfWeek: string } {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const baseUtc = match
    ? Date.UTC(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10))
    : Date.now()
  const target = new Date(baseUtc + days * 86400000)
  const y = target.getUTCFullYear()
  const m = String(target.getUTCMonth() + 1).padStart(2, '0')
  const d = String(target.getUTCDate()).padStart(2, '0')
  return {
    date: `${y}-${m}-${d}`,
    dayOfWeek: DAY_NAMES[target.getUTCDay()]
  }
}

export function parseTimeToMinutes(timeStr: string): number | null {
  const match = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hours = parseInt(match[1], 10)
  const mins = parseInt(match[2], 10)
  if (!Number.isFinite(hours) || !Number.isFinite(mins) || hours < 0 || hours > 23 || mins < 0 || mins > 59) {
    return null
  }
  return hours * 60 + mins
}

export function formatMinutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

async function runBatchInChunks(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH_CHUNK_SIZE) {
    const chunk = statements.slice(i, i + BATCH_CHUNK_SIZE)
    if (chunk.length > 0) {
      await db.batch(chunk)
    }
  }
}

export async function syncRollingScheduleSlots(
  db: D1Database,
  options: SyncRollingSlotsOptions = {}
): Promise<SyncRollingSlotsResult> {
  const horizonDays = Math.max(0, Math.round(options.horizonDays ?? 90))

  await ensureScheduleTables(db)

  const settingsRes = await db
    .prepare(
      `SELECT setting_key, setting_value FROM Admin_Settings
       WHERE setting_key IN ('weekly_availability', 'slot_duration_minutes', 'buffer_minutes', 'timezone')`
    )
    .all<{ setting_key: string; setting_value: string }>()

  const settings = new Map<string, string>()
  for (const row of settingsRes.results || []) {
    settings.set(row.setting_key, row.setting_value)
  }

  const rawDuration = Number(settings.get('slot_duration_minutes'))
  const slotDurationMinutes =
    Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.max(15, Math.min(480, Math.round(rawDuration)))
      : 60

  const rawBuffer = Number(settings.get('buffer_minutes'))
  const bufferMinutes = Number.isFinite(rawBuffer)
    ? Math.max(0, Math.min(240, Math.round(rawBuffer)))
    : 0

  const timezone = (settings.get('timezone') || '').trim() || DEFAULT_TIMEZONE
  const today = getTodayInTimezone(timezone)
  const endDate = addDaysToIsoDate(today, horizonDays).date

  let weeklyAvailability: WeeklyAvailabilityRule[] = []
  const rawWeekly = settings.get('weekly_availability')
  if (rawWeekly) {
    try {
      const parsed = JSON.parse(rawWeekly)
      if (Array.isArray(parsed)) {
        weeklyAvailability = parsed
      }
    } catch {
      weeklyAvailability = []
    }
  }

  let inserted = 0
  let deleted = 0

  if (weeklyAvailability.length > 0) {
    const expectedMap = new Map<string, { date: string; start_time: string; end_time: string }>()

    for (let offset = 0; offset <= horizonDays; offset++) {
      const { date, dayOfWeek } = addDaysToIsoDate(today, offset)
      const dayRule = weeklyAvailability.find(
        (rule) => String(rule.day || '').toLowerCase() === dayOfWeek.toLowerCase()
      )
      if (!dayRule || !dayRule.available || !Array.isArray(dayRule.timeframes) || dayRule.timeframes.length === 0) {
        continue
      }

      for (const tf of dayRule.timeframes) {
        const startMin = parseTimeToMinutes(tf.start)
        const endMin = parseTimeToMinutes(tf.end)
        if (startMin === null || endMin === null || startMin >= endMin) continue

        for (let cur = startMin; cur + slotDurationMinutes <= endMin; cur += slotDurationMinutes + bufferMinutes) {
          const startTime = formatMinutesToTime(cur)
          const endTime = formatMinutesToTime(cur + slotDurationMinutes)
          const key = `${date}|${startTime}`
          if (!expectedMap.has(key)) {
            expectedMap.set(key, { date, start_time: startTime, end_time: endTime })
          }
        }
      }
    }

    const existingRes = await db
      .prepare(
        `SELECT id, date, start_time, end_time, is_booked
         FROM Schedule_Slots
         WHERE date >= ? AND date <= ?
         ORDER BY date ASC, start_time ASC, id ASC`
      )
      .bind(today, endDate)
      .all<{ id: number; date: string; start_time: string; end_time: string; is_booked: number | boolean }>()

    const existingRows = existingRes.results || []
    const bookedKeys = new Set<string>()
    for (const row of existingRows) {
      if (Number(row.is_booked) === 1 || row.is_booked === true) {
        bookedKeys.add(`${row.date}|${row.start_time}`)
      }
    }

    const allKeptKeys = new Set<string>(bookedKeys)
    const seenUnbookedKeys = new Set<string>()
    const deleteIds: number[] = []

    for (const row of existingRows) {
      const isBooked = Number(row.is_booked) === 1 || row.is_booked === true
      if (isBooked) continue

      const key = `${row.date}|${row.start_time}`
      const expected = expectedMap.get(key)
      if (
        !expected ||
        expected.end_time !== row.end_time ||
        bookedKeys.has(key) ||
        seenUnbookedKeys.has(key)
      ) {
        deleteIds.push(row.id)
      } else {
        seenUnbookedKeys.add(key)
        allKeptKeys.add(key)
      }
    }

    if (deleteIds.length > 0) {
      const deleteStatements = deleteIds.map((id) =>
        db.prepare('DELETE FROM Schedule_Slots WHERE id = ? AND is_booked = 0').bind(id)
      )
      await runBatchInChunks(db, deleteStatements)
      deleted = deleteIds.length
    }

    const insertStatements: D1PreparedStatement[] = []
    for (const [key, slot] of expectedMap.entries()) {
      if (!allKeptKeys.has(key)) {
        insertStatements.push(
          db
            .prepare('INSERT INTO Schedule_Slots (date, start_time, end_time, is_booked) VALUES (?, ?, ?, 0)')
            .bind(slot.date, slot.start_time, slot.end_time)
        )
      }
    }

    if (insertStatements.length > 0) {
      await runBatchInChunks(db, insertStatements)
      inserted = insertStatements.length
    }
  }

  await db
    .prepare(
      `INSERT INTO Admin_Settings (setting_key, setting_value)
       VALUES ('last_slot_sync_date', ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`
    )
    .bind(today)
    .run()

  lastSyncDateByDb.set(db, today)
  return { inserted, deleted, syncDate: today }
}

export async function ensureRollingSlotsUpToDate(db: D1Database, currentDate?: string): Promise<void> {
  const targetDate = currentDate || getTodayInTimezone(DEFAULT_TIMEZONE)
  if (lastSyncDateByDb.get(db) === targetDate) {
    return
  }

  const inFlight = inFlightSyncByDb.get(db)
  if (inFlight) {
    return inFlight
  }

  const task = (async () => {
    try {
      await ensureScheduleTables(db)
      const row = await db
        .prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'last_slot_sync_date'")
        .first<{ setting_value: string }>()

      if (row?.setting_value && row.setting_value >= targetDate) {
        lastSyncDateByDb.set(db, targetDate)
        return
      }

      await syncRollingScheduleSlots(db, { horizonDays: 90 })
      lastSyncDateByDb.set(db, targetDate)
    } finally {
      inFlightSyncByDb.delete(db)
    }
  })()

  inFlightSyncByDb.set(db, task)
  return task
}

export async function runDailyMaintenance(db: D1Database): Promise<void> {
  await ensureScheduleTables(db)
  const { syncDate } = await syncRollingScheduleSlots(db, { horizonDays: 90 })
  const nowMs = Date.now()
  const staleAttemptsCutoff = nowMs - SEVEN_DAYS_MS

  await db.batch([
    db.prepare('DELETE FROM Schedule_Slots WHERE is_booked = 0 AND date < ?').bind(syncDate),
    db.prepare('DELETE FROM Blocked_Dates WHERE date < ?').bind(syncDate),
    db.prepare('DELETE FROM Revoked_Sessions WHERE expires_at <= ?').bind(nowMs),
    db.prepare('DELETE FROM Login_Attempts WHERE window_start < ?').bind(staleAttemptsCutoff)
  ])
}

export async function releaseBookingSlots(
  db: D1Database,
  bookingId: number | string,
  slotId?: number | null
): Promise<void> {
  if (!bookingId && !slotId) return

  let row: any = null
  if (bookingId) {
    try {
      row = await db
        .prepare(
          `SELECT b.slot_id, b.service_id, s.duration_minutes, sl.date, sl.start_time
           FROM Bookings b
           LEFT JOIN Services s ON b.service_id = s.id
           LEFT JOIN Schedule_Slots sl ON b.slot_id = sl.id
           WHERE b.id = ?`
        )
        .bind(bookingId)
        .first()
    } catch {}
  }

  const effectiveSlotId = row?.slot_id || slotId
  if (!effectiveSlotId) return

  const duration = Number(row?.duration_minutes) > 0 ? Number(row.duration_minutes) : 60
  if (duration <= 60 || !row?.date || !row?.start_time) {
    await db.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(effectiveSlotId).run().catch(() => {})
    return
  }

  const startMin = parseTimeToMinutes(row.start_time) ?? 0
  const endMin = startMin + duration

  try {
    const daySlotsRes = await db
      .prepare('SELECT id, start_time, end_time FROM Schedule_Slots WHERE date = ?')
      .bind(row.date)
      .all<{ id: number; start_time: string; end_time: string }>()

    const toRelease: number[] = [effectiveSlotId]
    for (const s of daySlotsRes.results || []) {
      const sStart = parseTimeToMinutes(s.start_time) ?? 0
      let sEnd = s.end_time ? (parseTimeToMinutes(s.end_time) ?? sStart + 60) : sStart + 60
      if (sEnd <= sStart) sEnd = sStart + 60
      if (sEnd >= 1439) sEnd = 1440

      if (Math.max(startMin, sStart) < Math.min(endMin, sEnd)) {
        toRelease.push(s.id)
      }
    }

    const unique = Array.from(new Set(toRelease))
    const ph = unique.map(() => '?').join(', ')
    await db
      .prepare(
        `UPDATE Schedule_Slots SET is_booked = 0 WHERE id IN (${ph}) AND id NOT IN (SELECT slot_id FROM Bookings WHERE status != 'cancelled' AND id != ?)`
      )
      .bind(...unique, bookingId || 0)
      .run()
  } catch {
    await db.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(effectiveSlotId).run().catch(() => {})
  }
}
