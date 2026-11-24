import { Hono } from 'hono'
import type { Bindings } from '../index'
import {
  ensureRollingSlotsUpToDate,
  getBufferMinutesFromRules,
  parseTimeToMinutes,
  resolveSlotWindow,
  type SlotRowLike
} from '../lib/scheduleSync.ts'

export const scheduleRouter = new Hono<{ Bindings: Bindings }>()

export function isSlotInWeeklyAvailability(
  slot: { date: string; start_time: string; end_time?: string },
  weeklyAvailability: Array<{ day: string; available: boolean; timeframes?: Array<{ start: string; end: string }> }>,
  durationMinutes?: number
): boolean {
  const slotStartMins = parseTimeToMinutes(slot.start_time)
  if (slotStartMins === null) {
    return false
  }

  const parsedSlotEnd = slot.end_time ? parseTimeToMinutes(slot.end_time) : null
  let slotEndMins =
    parsedSlotEnd !== null ? (parsedSlotEnd === 1439 ? 1440 : parsedSlotEnd) : slotStartMins + 60

  if (typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes > 0) {
    slotEndMins = slotStartMins + durationMinutes
  }

  // Crosses calendar day midnight (enforced even when weeklyAvailability is empty)
  if (slotEndMins > 1440) {
    return false
  }

  if (!Array.isArray(weeklyAvailability) || weeklyAvailability.length === 0) {
    return true
  }

  const match = String(slot.date).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  let dayOfWeek = ''
  if (match) {
    const y = parseInt(match[1], 10)
    const m = parseInt(match[2], 10)
    const d = parseInt(match[3], 10)
    dayOfWeek = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  } else {
    dayOfWeek = DAYS[new Date(slot.date).getUTCDay()]
  }

  const dayRule = weeklyAvailability.find(d => String(d.day).toLowerCase() === dayOfWeek.toLowerCase())
  if (!dayRule || !dayRule.available || !Array.isArray(dayRule.timeframes) || dayRule.timeframes.length === 0) {
    return false
  }

  return dayRule.timeframes.some(tf => {
    const tfStartMins = parseTimeToMinutes(tf.start || '00:00')
    const rawTfEndMins = parseTimeToMinutes(tf.end || '23:59')
    if (tfStartMins === null || rawTfEndMins === null) return false
    const tfEndMins = rawTfEndMins === 1439 ? 1440 : rawTfEndMins
    return slotStartMins >= tfStartMins && slotEndMins <= tfEndMins
  })
}

scheduleRouter.get('/', async (c) => {
  try {
    // Read timezone from Admin_Settings, fallback to America/New_York
    const tzSetting: any = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'timezone'"
    ).first()
    const tz = tzSetting?.setting_value || 'America/New_York'

    const now = new Date()
    let formatter: Intl.DateTimeFormat
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
        hour12: false
      })
    } catch {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
        hour12: false
      })
    }
    const parts = formatter.formatToParts(now)
    const hash: Record<string, string> = {}
    parts.forEach(p => hash[p.type] = p.value)
    
    const currentDate = `${hash.year}-${hash.month}-${hash.day}`
    let currentHour = hash.hour
    // Handle 24:00 edge case from Intl
    if (currentHour === '24') currentHour = '00'
    const currentTime = `${currentHour}:${hash.minute}`
    const currentTimeMins = parseTimeToMinutes(currentTime)

    await ensureRollingSlotsUpToDate(c.env.DB, currentDate)

    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 100))
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)
    const durationQuery = parseInt(c.req.query('duration') || '0', 10)
    const fullDayParam = c.req.query('fullDay') ?? c.req.query('full_day')
    const serviceIdParam = c.req.query('serviceId') ?? c.req.query('service_id')

    let fullDay = fullDayParam === '1' || fullDayParam === 'true'
    let durationMinutes: number | undefined = durationQuery > 0 ? durationQuery : undefined

    if (serviceIdParam) {
      const serviceIdNum = parseInt(serviceIdParam, 10)
      if (Number.isFinite(serviceIdNum) && serviceIdNum > 0) {
        try {
          const svc = await c.env.DB.prepare(
            'SELECT duration_minutes, full_day FROM Services WHERE id = ?'
          )
            .bind(serviceIdNum)
            .first<{ duration_minutes: number | null; full_day: number | null }>()
          if (svc) {
            if (Number(svc.full_day) === 1) {
              fullDay = true
            }
            if (!durationMinutes && Number(svc.duration_minutes) > 0) {
              durationMinutes = Number(svc.duration_minutes)
            }
          }
        } catch {}
      }
    }

    const waRow = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'weekly_availability'"
    ).first<{ setting_value: string }>()
    let weeklyAvailability: any[] = []
    if (waRow?.setting_value) {
      try {
        const parsed = JSON.parse(waRow.setting_value)
        if (Array.isArray(parsed)) {
          weeklyAvailability = parsed
        }
      } catch {}
    }

    const bufferMinutes = await getBufferMinutesFromRules(c.env.DB)

    const { results } = await c.env.DB.prepare(
      `SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots
       WHERE date >= ?
         AND date NOT IN (SELECT date FROM Blocked_Dates)
       ORDER BY date ASC, start_time ASC, id ASC
       LIMIT 5000`
    ).bind(currentDate).all<SlotRowLike>()

    const allSlots: SlotRowLike[] = (results || []).map((row) => ({
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

    const matching = allSlots.filter((slot) => {
      if (slot.is_booked !== 0) return false

      if (slot.date === currentDate) {
        const slotStartMins = parseTimeToMinutes(slot.start_time)
        if (slotStartMins !== null && currentTimeMins !== null) {
          if (slotStartMins <= currentTimeMins) return false
        } else if (slot.start_time <= currentTime) {
          return false
        }
      } else if (slot.date < currentDate) {
        return false
      }

      if (!isSlotInWeeklyAvailability(slot, weeklyAvailability, fullDay ? undefined : durationMinutes)) {
        return false
      }

      const daySlots = daySlotsByDate.get(slot.date) || []
      let effectiveDuration = durationMinutes
      if (!effectiveDuration) {
        const sStart = parseTimeToMinutes(slot.start_time)
        const sEnd = parseTimeToMinutes(slot.end_time)
        if (sStart !== null && sEnd !== null && sEnd > sStart) {
          effectiveDuration = (sEnd === 1439 ? 1440 : sEnd) - sStart
        } else {
          effectiveDuration = 60
        }
      }

      const windowRes = resolveSlotWindow({
        daySlots,
        startSlot: slot,
        durationMinutes: effectiveDuration,
        fullDay,
        bufferMinutes
      })
      return windowRes.ok
    })

    const finalSlots = matching.slice(offset, offset + limit)

    c.header('Cache-Control', 'no-store')
    return c.json({ slots: finalSlots, limit, offset, status: 'success', data: finalSlots })
  } catch (e: any) {
    c.header('Cache-Control', 'no-store')
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not fetch schedule slots.',
        details: []
      }
    }, 500)
  }
})
