import type { Bindings } from '../index'
import { syncBookingToGoogleCalendarApi } from './googleCalendar.ts'

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

export function getNowPartsInTimezone(timezone: string, now: Date = new Date()): { currentDate: string; currentTime: string } {
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  }
  const parts = formatter.formatToParts(now)
  const map: Record<string, string> = {}
  for (const part of parts) {
    map[part.type] = part.value
  }
  let hour = map.hour
  if (hour === '24') hour = '00'
  return {
    currentDate: `${map.year}-${map.month}-${map.day}`,
    currentTime: `${hour}:${map.minute}`
  }
}

function getTodayInTimezone(timezone: string): string {
  return getNowPartsInTimezone(timezone).currentDate
}

/**
 * Returns true when a slot's start date/time is at or before the current instant in `timeZone`.
 */
export function isSlotInPast(
  slot: { date: string; start_time: string },
  timeZone: string = DEFAULT_TIMEZONE,
  now: Date = new Date()
): boolean {
  const { currentDate, currentTime } = getNowPartsInTimezone(timeZone, now)
  if (slot.date < currentDate) return true
  if (slot.date > currentDate) return false
  const slotStartMins = parseTimeToMinutes(slot.start_time)
  const currentMins = parseTimeToMinutes(currentTime)
  if (slotStartMins !== null && currentMins !== null) {
    return slotStartMins <= currentMins
  }
  return slot.start_time <= currentTime
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
  const trimmed = String(timeStr ?? '').trim()
  if (!trimmed) return null

  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (match12) {
    const rawHours = parseInt(match12[1], 10)
    const mins = parseInt(match12[2], 10)
    if (!Number.isFinite(rawHours) || !Number.isFinite(mins) || rawHours < 1 || rawHours > 12 || mins < 0 || mins >= 60) {
      return null
    }
    const period = match12[3].toUpperCase()
    let hours = rawHours === 12 ? 0 : rawHours
    if (period === 'PM') hours += 12
    return hours * 60 + mins
  }

  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (!match24) return null

  const hours = parseInt(match24[1], 10)
  const mins = parseInt(match24[2], 10)
  if (!Number.isFinite(hours) || !Number.isFinite(mins) || hours < 0 || hours > 24 || mins < 0 || mins >= 60) {
    return null
  }
  if (hours === 24 && mins !== 0) {
    return null
  }
  return hours * 60 + mins
}

export function formatMinutesToTime(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return '00:00'
  const clamped = Math.max(0, Math.min(1440, Math.round(totalMinutes)))
  if (clamped === 1440) return '24:00'
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

export function computeSessionEndTime(
  startTime: string,
  fallbackEndTime: string,
  durationMinutes: number
): string {
  const startMin = parseTimeToMinutes(startTime)
  if (startMin === null || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return fallbackEndTime
  }
  return formatMinutesToTime(Math.min(1439, startMin + durationMinutes))
}

export async function getBufferMinutesFromRules(db: D1Database): Promise<number> {
  const toNonNegInt = (raw: unknown): number | null => {
    if (raw === null || raw === undefined || raw === '') return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) return null
    return Math.round(n)
  }

  try {
    const siteRow = await db
      .prepare("SELECT value FROM Site_Settings WHERE key = 'availability_rules'")
      .first<{ value?: string }>()
    if (siteRow?.value) {
      const parsed = JSON.parse(siteRow.value)
      const buf = toNonNegInt(parsed?.buffer_minutes)
      if (buf !== null) return buf
    }
  } catch {}

  try {
    const adminRows = await db
      .prepare(
        "SELECT setting_key, setting_value FROM Admin_Settings WHERE setting_key IN ('buffer_minutes', 'availability_rules')"
      )
      .all<{ setting_key: string; setting_value: string }>()
    const rows = adminRows.results || []
    const rulesRow = rows.find((r) => r.setting_key === 'availability_rules')
    if (rulesRow?.setting_value) {
      try {
        const parsed = JSON.parse(rulesRow.setting_value)
        const buf = toNonNegInt(parsed?.buffer_minutes)
        if (buf !== null) return buf
      } catch {}
    }
    const bufRow = rows.find((r) => r.setting_key === 'buffer_minutes')
    if (bufRow?.setting_value !== undefined) {
      const buf = toNonNegInt(bufRow.setting_value)
      if (buf !== null) return buf
    }
  } catch {}

  return 0
}

export interface SlotRowLike {
  id: number
  date: string
  start_time: string
  end_time: string
  is_booked: number
}

export function resolveSlotWindow(params: {
  daySlots: SlotRowLike[]
  startSlot: SlotRowLike
  durationMinutes: number
  fullDay?: boolean
  bufferMinutes?: number
  exemptSlotIds?: readonly number[]
}):
  | { ok: true; slotIds: number[]; endTime: string }
  | {
      ok: false
      reason: 'INVALID_TIME' | 'EXCEEDS_MIDNIGHT' | 'SLOT_OVERLAPS_BOOKED' | 'INSUFFICIENT_COVERAGE'
      slotIds: []
    } {
  const { daySlots, startSlot, durationMinutes, fullDay = false, bufferMinutes = 0, exemptSlotIds = [] } = params
  const exemptSet = new Set<number>(exemptSlotIds)
  const sameDaySlots = (daySlots || []).filter((s) => s.date === startSlot.date)

  if (fullDay === true) {
    if (Number(startSlot.is_booked) === 1 && !exemptSet.has(startSlot.id)) {
      return { ok: false, reason: 'SLOT_OVERLAPS_BOOKED', slotIds: [] }
    }
    const sortedDay = [...sameDaySlots].sort((a, b) => {
      const aStart = parseTimeToMinutes(a.start_time) ?? 0
      const bStart = parseTimeToMinutes(b.start_time) ?? 0
      if (aStart !== bStart) return aStart - bStart
      return a.id - b.id
    })
    for (const s of sortedDay) {
      if (Number(s.is_booked) === 1 && !exemptSet.has(s.id)) {
        return { ok: false, reason: 'SLOT_OVERLAPS_BOOKED', slotIds: [] }
      }
    }
    const allDaySlotIds = Array.from(
      new Set(sortedDay.length > 0 ? sortedDay.map((s) => s.id) : [startSlot.id])
    )
    if (!allDaySlotIds.includes(startSlot.id)) {
      allDaySlotIds.unshift(startSlot.id)
    }
    const lastSlot = sortedDay[sortedDay.length - 1] ?? startSlot
    return {
      ok: true,
      slotIds: allDaySlotIds,
      endTime: lastSlot.end_time
    }
  }

  const startMin = parseTimeToMinutes(startSlot.start_time)
  if (startMin === null) {
    return { ok: false, reason: 'INVALID_TIME', slotIds: [] }
  }

  const effectiveDuration = Number.isFinite(durationMinutes) ? Math.max(1, durationMinutes) : 1
  const endMin = startMin + effectiveDuration
  if (endMin > 1440) {
    return { ok: false, reason: 'EXCEEDS_MIDNIGHT', slotIds: [] }
  }

  if (Number(startSlot.is_booked) === 1 && !exemptSet.has(startSlot.id)) {
    return { ok: false, reason: 'SLOT_OVERLAPS_BOOKED', slotIds: [] }
  }

  const overlapping: Array<{ id: number; sStart: number; sEnd: number }> = []
  for (const s of sameDaySlots) {
    const sStart = parseTimeToMinutes(s.start_time)
    let sEnd = parseTimeToMinutes(s.end_time)
    if (sStart === null || sEnd === null) continue
    if (sEnd === 1439 && endMin === 1440) {
      sEnd = 1440
    }
    if (sEnd <= sStart) continue

    if (sStart < endMin && sEnd > startMin) {
      if (Number(s.is_booked) === 1 && !exemptSet.has(s.id)) {
        return { ok: false, reason: 'SLOT_OVERLAPS_BOOKED', slotIds: [] }
      }
      overlapping.push({ id: s.id, sStart, sEnd })
    }
  }

  overlapping.sort((a, b) => {
    if (a.sStart !== b.sStart) return a.sStart - b.sStart
    if (a.sEnd !== b.sEnd) return a.sEnd - b.sEnd
    return a.id - b.id
  })

  if (overlapping.length === 0 || overlapping[0].sStart > startMin) {
    return { ok: false, reason: 'INSUFFICIENT_COVERAGE', slotIds: [] }
  }

  const allowedGap = Math.max(0, Number.isFinite(bufferMinutes) ? bufferMinutes : 0)
  let coveredUntil = overlapping[0].sStart
  for (const s of overlapping) {
    if (s.sStart > coveredUntil + allowedGap) {
      return { ok: false, reason: 'INSUFFICIENT_COVERAGE', slotIds: [] }
    }
    coveredUntil = Math.max(coveredUntil, s.sEnd)
  }

  if (coveredUntil < endMin && !(coveredUntil === 1439 && endMin === 1440)) {
    return { ok: false, reason: 'INSUFFICIENT_COVERAGE', slotIds: [] }
  }

  const dedupedIds = Array.from(new Set([startSlot.id, ...overlapping.map((s) => s.id)]))
  return {
    ok: true,
    slotIds: dedupedIds,
    endTime: computeSessionEndTime(startSlot.start_time, startSlot.end_time, durationMinutes)
  }
}

export async function lockSlotsAtomically(
  db: D1Database,
  slotIds: readonly number[],
  exemptSlotIds: readonly number[] = []
): Promise<{ ok: boolean; newlyLockedIds: number[] }> {
  const exemptSet = new Set<number>(exemptSlotIds)
  const toLock = Array.from(new Set(slotIds)).filter((id) => !exemptSet.has(id))
  if (toLock.length === 0) {
    return { ok: true, newlyLockedIds: [] }
  }

  const ph = toLock.map(() => '?').join(', ')
  const res = await db
    .prepare(
      `UPDATE Schedule_Slots
       SET is_booked = 1
       WHERE id IN (${ph})
         AND is_booked = 0
         AND date NOT IN (SELECT date FROM Blocked_Dates)
         AND (
           SELECT COUNT(*)
           FROM Schedule_Slots
           WHERE id IN (${ph})
             AND is_booked = 0
             AND date NOT IN (SELECT date FROM Blocked_Dates)
         ) = ?`
    )
    .bind(...toLock, ...toLock, toLock.length)
    .run()

  if (res.success && (res.meta?.changes ?? 0) === toLock.length) {
    return { ok: true, newlyLockedIds: toLock }
  }
  return { ok: false, newlyLockedIds: [] }
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
        const parsedEndMin = parseTimeToMinutes(tf.end)
        if (startMin === null || parsedEndMin === null) continue
        const endMin = parsedEndMin === 1439 ? 1440 : parsedEndMin
        if (startMin >= endMin) continue

        for (
          let cur = startMin;
          cur + slotDurationMinutes <= endMin && cur + slotDurationMinutes <= 1440;
          cur += slotDurationMinutes + bufferMinutes
        ) {
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
      let hasBookingsTable = false
      try {
        const tbl = await db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Bookings'")
          .first()
        hasBookingsTable = Boolean(tbl)
      } catch {}
      const deleteSql = hasBookingsTable
        ? 'DELETE FROM Schedule_Slots WHERE id = ? AND is_booked = 0 AND id NOT IN (SELECT slot_id FROM Bookings WHERE slot_id IS NOT NULL)'
        : 'DELETE FROM Schedule_Slots WHERE id = ? AND is_booked = 0'
      const deleteStatements = deleteIds.map((id) => db.prepare(deleteSql).bind(id))
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
  let targetDate = currentDate
  if (!targetDate) {
    let tz = DEFAULT_TIMEZONE
    try {
      const tzRow = await db
        .prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'timezone'")
        .first<{ setting_value: string }>()
      if (tzRow?.setting_value && tzRow.setting_value.trim()) {
        tz = tzRow.setting_value.trim()
      }
    } catch {}
    targetDate = getTodayInTimezone(tz)
  }
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

function normalizeMediaRefKey(rawRef: unknown): string {
  if (typeof rawRef !== 'string') return ''
  let s = rawRef.trim()
  if (!s || s.startsWith('data:')) return ''
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname
    } catch {
      return ''
    }
  }
  s = s.split('?')[0].replace(/^\/api\/media\//, '').replace(/^\/+/, '')
  return s
}

async function cleanupOrphanedMediaStorage(db: D1Database): Promise<void> {
  try {
    const staleRows = await db
      .prepare("SELECT DISTINCT file_key FROM Media_Storage WHERE created_at <= datetime('now', '-24 hours')")
      .all<{ file_key: string }>()
    const candidates = (staleRows.results || []).map((r) => r.file_key).filter(Boolean)
    if (candidates.length === 0) return

    const referenced = new Set<string>()
    const addRef = (raw: unknown) => {
      const key = normalizeMediaRefKey(raw)
      if (!key) return
      referenced.add(key)
      referenced.add(`${key}__w640`)
      referenced.add(`${key}__w1280`)
    }

    try {
      const portfolioRows = await db.prepare('SELECT media_key FROM Portfolio_Images').all<{ media_key: string }>()
      for (const r of portfolioRows.results || []) addRef(r.media_key)
    } catch {}
    try {
      const serviceRows = await db
        .prepare('SELECT image_url FROM Services WHERE image_url IS NOT NULL')
        .all<{ image_url: string }>()
      for (const r of serviceRows.results || []) addRef(r.image_url)
    } catch {}

    const toDelete = candidates.filter((k) => !referenced.has(k))
    if (toDelete.length === 0) return

    const stmts = toDelete.map((k) => db.prepare('DELETE FROM Media_Storage WHERE file_key = ?').bind(k))
    await runBatchInChunks(db, stmts)
  } catch {}
}

async function retryFailedGoogleCalendarSyncs(db: D1Database, env?: Bindings): Promise<void> {
  if (!env) return
  const configured = Boolean(
    (env.GOOGLE_CALENDAR_REFRESH_TOKEN || '').trim() &&
      (env.GOOGLE_CLIENT_ID || '').trim() &&
      (env.GOOGLE_CLIENT_SECRET || '').trim() &&
      (env.GOOGLE_CALENDAR_ID || '').trim()
  )
  if (!configured) return

  try {
    const tzRow = await db
      .prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'timezone'")
      .first<{ setting_value: string }>()
    const timeZone = (tzRow?.setting_value || '').trim() || DEFAULT_TIMEZONE

    const failedRows = await db
      .prepare(
        `SELECT b.id, b.client_name, b.client_email, b.customer_phone,
                COALESCE(NULLIF(b.event_location, ''), b.location) AS location,
                b.notes, b.attendees, b.status,
                ss.date, ss.start_time, ss.end_time,
                s.name AS service_name
         FROM Bookings b
         LEFT JOIN Schedule_Slots ss ON b.slot_id = ss.id
         LEFT JOIN Services s ON b.service_id = s.id
         WHERE b.gcal_sync_status = 'failed'
         ORDER BY b.id DESC
         LIMIT 20`
      )
      .all<any>()

    for (const row of failedRows.results || []) {
      const isCancelled = String(row.status || '').trim().toLowerCase() === 'cancelled'
      if (!isCancelled && (!row.date || !row.start_time)) continue
      const res = await syncBookingToGoogleCalendarApi(
        env,
        {
          id: row.id,
          date: row.date || '',
          start_time: row.start_time || '',
          end_time: row.end_time,
          client_name: row.client_name,
          client_email: row.client_email,
          customer_phone: row.customer_phone,
          package_name: row.service_name,
          service_name: row.service_name,
          status: row.status,
          notes: row.notes,
          location: row.location,
          attendees: row.attendees,
          timeZone
        },
        isCancelled ? 'delete' : 'upsert'
      )
      if (res.synced) {
        await db.prepare("UPDATE Bookings SET gcal_sync_status = 'synced' WHERE id = ?").bind(row.id).run().catch(() => {})
      }
    }
  } catch {}
}

export async function runDailyMaintenance(db: D1Database, env?: Bindings): Promise<void> {
  await ensureScheduleTables(db)
  const { syncDate } = await syncRollingScheduleSlots(db, { horizonDays: 90 })
  const nowMs = Date.now()
  const staleAttemptsCutoff = nowMs - SEVEN_DAYS_MS
  const staleRateLimitsCutoff = nowMs - 24 * 60 * 60 * 1000

  let hasBookingsTable = false
  try {
    const tbl = await db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Bookings'")
      .first()
    hasBookingsTable = Boolean(tbl)
  } catch {}
  const purgeSlotsSql = hasBookingsTable
    ? 'DELETE FROM Schedule_Slots WHERE is_booked = 0 AND date < ? AND id NOT IN (SELECT slot_id FROM Bookings WHERE slot_id IS NOT NULL)'
    : 'DELETE FROM Schedule_Slots WHERE is_booked = 0 AND date < ?'

  await db.batch([
    db.prepare(purgeSlotsSql).bind(syncDate),
    db.prepare('DELETE FROM Blocked_Dates WHERE date < ?').bind(syncDate),
    db.prepare('DELETE FROM Revoked_Sessions WHERE expires_at <= ?').bind(nowMs),
    db.prepare('DELETE FROM Login_Attempts WHERE window_start < ?').bind(staleAttemptsCutoff)
  ])

  // Best-effort self-healing cleanups for optional/Phase 2 tables
  await db
    .prepare("DELETE FROM Booking_Invoices WHERE status = 'CREATING' AND created_at <= datetime('now', '-5 minutes')")
    .run()
    .catch(() => {})

  await db
    .prepare('DELETE FROM Rate_Limits WHERE window_start < ?')
    .bind(staleRateLimitsCutoff)
    .run()
    .catch(() => {})

  await db
    .prepare("DELETE FROM Leads WHERE created_at <= datetime('now', '-365 days')")
    .run()
    .catch(() => {})

  await cleanupOrphanedMediaStorage(db)
  await retryFailedGoogleCalendarSyncs(db, env)
}

function computeCoveredSlotIds(
  daySlots: SlotRowLike[],
  startSlot: { id: number; start_time: string; end_time: string },
  durationMinutes: number,
  fullDay: boolean
): number[] {
  if (fullDay) {
    return Array.from(new Set([startSlot.id, ...daySlots.map((s) => s.id)]))
  }

  const startMin = parseTimeToMinutes(startSlot.start_time)
  if (startMin === null) {
    return [startSlot.id]
  }

  const endMin = startMin + Math.max(1, Number.isFinite(durationMinutes) ? durationMinutes : 60)
  const matchedIds: number[] = []

  for (const s of daySlots) {
    const sStart = parseTimeToMinutes(s.start_time)
    let sEnd = parseTimeToMinutes(s.end_time)
    if (sStart === null) continue
    if (sEnd === null || sEnd <= sStart) {
      sEnd = sEnd === 0 && sStart > 0 ? 1440 : sStart + 60
    } else if (sEnd === 1439 && endMin >= 1440) {
      sEnd = 1440
    }

    if (sStart < endMin && sEnd > startMin) {
      matchedIds.push(s.id)
    }
  }

  return Array.from(new Set([startSlot.id, ...matchedIds]))
}

function parseLockedSlotIdsJson(raw: unknown): number[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const ids = parsed.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    return Array.from(new Set(ids))
  } catch {
    return []
  }
}

export async function resolveBookingSlotIds(
  db: D1Database,
  params: {
    bookingId?: number | string
    slotId?: number | null
    serviceId?: number | null
    durationMinutes?: number
    fullDay?: boolean
  }
): Promise<{ slotIds: number[]; protectedOtherSlotIds: number[] }> {
  const hasBookingId =
    params.bookingId !== undefined && params.bookingId !== null && params.bookingId !== ''
  const bookingIdParam = hasBookingId ? params.bookingId! : null

  let bookingRow: {
    slot_id: number | null
    service_id: number | null
    locked_slot_ids_json?: string | null
    duration_minutes: number | null
    full_day: number | null
  } | null = null

  if (bookingIdParam !== null) {
    try {
      bookingRow = await db
        .prepare(
          `SELECT b.slot_id, b.service_id, b.locked_slot_ids_json, s.duration_minutes, s.full_day
           FROM Bookings b
           LEFT JOIN Services s ON b.service_id = s.id
           WHERE b.id = ?`
        )
        .bind(bookingIdParam)
        .first()
    } catch {
      try {
        bookingRow = await db
          .prepare(
            `SELECT b.slot_id, b.service_id, s.duration_minutes, s.full_day
             FROM Bookings b
             LEFT JOIN Services s ON b.service_id = s.id
             WHERE b.id = ?`
          )
          .bind(bookingIdParam)
          .first()
      } catch {}
    }
  }

  const storedLockedIds = parseLockedSlotIdsJson(bookingRow?.locked_slot_ids_json)
  const effectiveSlotId =
    params.slotId !== undefined ? params.slotId : (bookingRow?.slot_id ?? null)

  if (!effectiveSlotId && storedLockedIds.length === 0) {
    return { slotIds: [], protectedOtherSlotIds: [] }
  }

  let serviceRow: { duration_minutes: number | null; full_day: number | null } | null = null
  if (
    params.serviceId !== undefined &&
    params.serviceId !== null &&
    (params.durationMinutes === undefined || params.fullDay === undefined)
  ) {
    try {
      serviceRow = await db
        .prepare('SELECT duration_minutes, full_day FROM Services WHERE id = ?')
        .bind(params.serviceId)
        .first<{ duration_minutes: number | null; full_day: number | null }>()
    } catch {}
  }

  const fullDay =
    params.fullDay !== undefined
      ? Boolean(params.fullDay)
      : Number(serviceRow?.full_day ?? bookingRow?.full_day ?? 0) === 1

  const rawDuration =
    params.durationMinutes !== undefined
      ? Number(params.durationMinutes)
      : Number(serviceRow?.duration_minutes ?? bookingRow?.duration_minutes ?? 0)
  const durationMinutes = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 60

  let startSlot: SlotRowLike | null = null
  const lookupSlotId = effectiveSlotId ?? storedLockedIds[0]
  if (lookupSlotId) {
    try {
      startSlot = await db
        .prepare('SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots WHERE id = ?')
        .bind(lookupSlotId)
        .first<SlotRowLike>()
    } catch {}
  }

  if (!startSlot) {
    const fallbackIds = storedLockedIds.length > 0 ? storedLockedIds : (effectiveSlotId ? [effectiveSlotId] : [])
    return { slotIds: fallbackIds, protectedOtherSlotIds: [] }
  }

  let daySlots: SlotRowLike[] = [startSlot]
  try {
    const daySlotsRes = await db
      .prepare(
        'SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots WHERE date = ? ORDER BY start_time ASC, id ASC'
      )
      .bind(startSlot.date)
      .all<SlotRowLike>()
    if (daySlotsRes.results && daySlotsRes.results.length > 0) {
      daySlots = daySlotsRes.results
    }
  } catch {}

  const useStoredIds =
    storedLockedIds.length > 0 &&
    (effectiveSlotId === null || effectiveSlotId === undefined || storedLockedIds.includes(effectiveSlotId))
  const slotIds = useStoredIds
    ? storedLockedIds
    : computeCoveredSlotIds(daySlots, startSlot, durationMinutes, fullDay)

  const protectedSet = new Set<number>()
  try {
    let otherResults: Array<{
      id: number
      slot_id: number
      locked_slot_ids_json?: string | null
      duration_minutes: number | null
      full_day: number | null
      start_time: string
      end_time: string
    }> = []
    try {
      const otherRes = await db
        .prepare(
          `SELECT b.id, b.slot_id, b.locked_slot_ids_json, s.duration_minutes, s.full_day, sl.start_time, sl.end_time
           FROM Bookings b
           LEFT JOIN Services s ON b.service_id = s.id
           INNER JOIN Schedule_Slots sl ON b.slot_id = sl.id
           WHERE LOWER(COALESCE(b.status, '')) != 'cancelled'
             AND b.slot_id IS NOT NULL
             AND sl.date = ?
             AND (? IS NULL OR b.id != ?)`
        )
        .bind(startSlot.date, bookingIdParam, bookingIdParam)
        .all<any>()
      otherResults = otherRes.results || []
    } catch {
      const otherRes = await db
        .prepare(
          `SELECT b.id, b.slot_id, s.duration_minutes, s.full_day, sl.start_time, sl.end_time
           FROM Bookings b
           LEFT JOIN Services s ON b.service_id = s.id
           INNER JOIN Schedule_Slots sl ON b.slot_id = sl.id
           WHERE LOWER(COALESCE(b.status, '')) != 'cancelled'
             AND b.slot_id IS NOT NULL
             AND sl.date = ?
             AND (? IS NULL OR b.id != ?)`
        )
        .bind(startSlot.date, bookingIdParam, bookingIdParam)
        .all<any>()
      otherResults = otherRes.results || []
    }

    for (const other of otherResults) {
      const otherStored = parseLockedSlotIdsJson(other.locked_slot_ids_json)
      if (otherStored.length > 0) {
        for (const id of otherStored) protectedSet.add(id)
        continue
      }
      const otherDuration =
        Number(other.duration_minutes) > 0 ? Number(other.duration_minutes) : 60
      const otherFullDay = Number(other.full_day) === 1
      const otherCovered = computeCoveredSlotIds(
        daySlots,
        { id: other.slot_id, start_time: other.start_time, end_time: other.end_time },
        otherDuration,
        otherFullDay
      )
      for (const id of otherCovered) {
        protectedSet.add(id)
      }
    }
  } catch {}

  return {
    slotIds,
    protectedOtherSlotIds: Array.from(protectedSet)
  }
}

export const getStudioCurrentDateTime = getNowPartsInTimezone

export async function loadWeeklyAvailability(db: D1Database): Promise<WeeklyAvailabilityRule[]> {
  try {
    const waRow = await db
      .prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'weekly_availability'")
      .first<{ setting_value: string }>()
    if (waRow?.setting_value) {
      const parsed = JSON.parse(waRow.setting_value)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return []
}

export function isSlotInWeeklyAvailability(
  slot: { date: string; start_time: string; end_time?: string },
  weeklyAvailability: Array<{ day: string; available: boolean; timeframes?: Array<{ start: string; end: string }> }>,
  durationMinutes?: number
): boolean {
  const slotStartMins = parseTimeToMinutes(slot.start_time)
  if (slotStartMins === null) return false

  const parsedSlotEnd = slot.end_time ? parseTimeToMinutes(slot.end_time) : null
  let slotEndMins =
    parsedSlotEnd !== null ? (parsedSlotEnd === 1439 ? 1440 : parsedSlotEnd) : slotStartMins + 60

  if (typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes > 0) {
    slotEndMins = slotStartMins + durationMinutes
  }

  if (slotEndMins > 1440) return false
  if (!Array.isArray(weeklyAvailability) || weeklyAvailability.length === 0) return true

  const match = String(slot.date).match(/^(\d{4})-(\d{2})-(\d{2})/)
  let dayOfWeek = ''
  if (match) {
    dayOfWeek = DAY_NAMES[new Date(Date.UTC(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10))).getUTCDay()]
  } else {
    dayOfWeek = DAY_NAMES[new Date(slot.date).getUTCDay()]
  }

  const dayRule = weeklyAvailability.find((d) => String(d.day).toLowerCase() === dayOfWeek.toLowerCase())
  if (!dayRule || !dayRule.available || !Array.isArray(dayRule.timeframes) || dayRule.timeframes.length === 0) {
    return false
  }

  return dayRule.timeframes.some((tf) => {
    const tfStartMins = parseTimeToMinutes(tf.start || '00:00')
    const rawTfEndMins = parseTimeToMinutes(tf.end || '23:59')
    if (tfStartMins === null || rawTfEndMins === null) return false
    const tfEndMins = rawTfEndMins === 1439 ? 1440 : rawTfEndMins
    return slotStartMins >= tfStartMins && slotEndMins <= tfEndMins
  })
}

export interface QueryAvailableSlotsOptions {
  timeZone: string
  durationMinutes?: number
  fullDay?: boolean
  serviceId?: number | null
  exemptSlotIds?: number[]
  excludeSlotIds?: number[]
  requireUnbooked?: boolean
}

export async function queryAvailableSlots(
  db: D1Database,
  options: QueryAvailableSlotsOptions
): Promise<SlotRowLike[]> {
  const { currentDate } = getStudioCurrentDateTime(options.timeZone)
  await ensureRollingSlotsUpToDate(db, currentDate)

  let durationMinutes = options.durationMinutes
  let fullDay = Boolean(options.fullDay)
  if (options.serviceId && (durationMinutes === undefined || options.fullDay === undefined)) {
    try {
      const svc = await db
        .prepare('SELECT duration_minutes, full_day FROM Services WHERE id = ?')
        .bind(options.serviceId)
        .first<{ duration_minutes: number | null; full_day: number | boolean | null }>()
      if (svc) {
        if (svc.full_day === true || Number(svc.full_day) === 1) fullDay = true
        if (!durationMinutes && Number(svc.duration_minutes) > 0) durationMinutes = Number(svc.duration_minutes)
      }
    } catch {}
  }

  const [weeklyAvailability, bufferMinutes, slotsRes] = await Promise.all([
    loadWeeklyAvailability(db),
    getBufferMinutesFromRules(db),
    db
      .prepare(
        `SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots
         WHERE date >= ?
           AND date NOT IN (SELECT date FROM Blocked_Dates)
         ORDER BY date ASC, start_time ASC, id ASC
         LIMIT 10000`
      )
      .bind(currentDate)
      .all<SlotRowLike>()
  ])

  const allSlots: SlotRowLike[] = (slotsRes.results || []).map((row) => ({
    ...row,
    is_booked: Number(row.is_booked) === 1 || (row.is_booked as unknown) === true ? 1 : 0
  }))

  const daySlotsByDate = new Map<string, SlotRowLike[]>()
  for (const slot of allSlots) {
    let list = daySlotsByDate.get(slot.date)
    if (!list) {
      list = []
      daySlotsByDate.set(slot.date, list)
    }
    list.push(slot)
  }

  const excludeSet = new Set<number>(options.excludeSlotIds || [])
  const exemptSlotIds = options.exemptSlotIds || []

  return allSlots.filter((slot) => {
    if (excludeSet.has(slot.id)) return false
    if (options.requireUnbooked && slot.is_booked !== 0) return false
    if (isSlotInPast(slot, options.timeZone)) return false
    if (!isSlotInWeeklyAvailability(slot, weeklyAvailability, fullDay ? undefined : durationMinutes)) return false

    let effectiveDuration = durationMinutes
    if (!effectiveDuration) {
      const sStart = parseTimeToMinutes(slot.start_time)
      const sEnd = parseTimeToMinutes(slot.end_time)
      effectiveDuration =
        sStart !== null && sEnd !== null && sEnd > sStart ? (sEnd === 1439 ? 1440 : sEnd) - sStart : 60
    }

    const windowRes = resolveSlotWindow({
      daySlots: daySlotsByDate.get(slot.date) || [],
      startSlot: slot,
      durationMinutes: effectiveDuration,
      fullDay,
      bufferMinutes,
      exemptSlotIds
    })
    return windowRes.ok
  })
}

export async function releaseBookingSlots(
  db: D1Database,
  bookingId: number | string,
  explicitSlotId?: number | null,
  options?: { keepSlotIds?: readonly number[] }
): Promise<number[]> {
  if ((bookingId === undefined || bookingId === null || bookingId === '') && !explicitSlotId) {
    return []
  }

  const { slotIds, protectedOtherSlotIds } = await resolveBookingSlotIds(db, {
    bookingId,
    slotId: explicitSlotId
  })

  if (slotIds.length === 0) return []

  const keepSet = new Set<number>(options?.keepSlotIds || [])
  const protectedSet = new Set<number>(protectedOtherSlotIds)
  const toRelease = slotIds.filter((id) => !keepSet.has(id) && !protectedSet.has(id))

  if (toRelease.length === 0) return []

  const ph = toRelease.map(() => '?').join(', ')
  try {
    await db
      .prepare(
        `UPDATE Schedule_Slots
         SET is_booked = 0
         WHERE id IN (${ph})
           AND id NOT IN (
             SELECT slot_id
             FROM Bookings
             WHERE LOWER(COALESCE(status, '')) != 'cancelled'
               AND slot_id IS NOT NULL
               AND id != ?
           )`
      )
      .bind(...toRelease, bookingId || 0)
      .run()
  } catch {
    await db
      .prepare(`UPDATE Schedule_Slots SET is_booked = 0 WHERE id IN (${ph})`)
      .bind(...toRelease)
      .run()
      .catch(() => {})
  }

  return toRelease
}
