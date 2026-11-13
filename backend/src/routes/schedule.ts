import { Hono } from 'hono'
import type { Bindings } from '../index'

export const scheduleRouter = new Hono<{ Bindings: Bindings }>()

export function isSlotInWeeklyAvailability(
  slot: { date: string; start_time: string; end_time?: string },
  weeklyAvailability: Array<{ day: string; available: boolean; timeframes?: Array<{ start: string; end: string }> }>
): boolean {
  if (!Array.isArray(weeklyAvailability) || weeklyAvailability.length === 0) {
    return true
  }

  // Check if weekly availability has any active window configured
  const hasActiveRules = weeklyAvailability.some(
    d => Boolean(d.available) && Array.isArray(d.timeframes) && d.timeframes.length > 0
  )
  if (!hasActiveRules) {
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

  const norm = (t: string) => {
    const parts = (t || '').trim().split(':')
    if (parts.length >= 2) {
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
    }
    return t || '00:00'
  }

  const slotStart = norm(slot.start_time)
  const slotEnd = slot.end_time ? norm(slot.end_time) : ''

  return dayRule.timeframes.some(tf => {
    const tfStart = norm(tf.start || '00:00')
    const tfEnd = norm(tf.end || '23:59')
    if (slotEnd) {
      return slotStart >= tfStart && slotEnd <= tfEnd
    }
    return slotStart >= tfStart && slotStart < tfEnd
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

    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 100))
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)

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

    const hasActiveRules = weeklyAvailability.some(
      d => Boolean(d.available) && Array.isArray(d.timeframes) && d.timeframes.length > 0
    )

    let finalSlots: any[] = []
    if (!hasActiveRules) {
      const { results } = await c.env.DB.prepare(
        `SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots 
         WHERE is_booked = 0 
         AND (date > ? OR (date = ? AND start_time > ?))
         AND date NOT IN (SELECT date FROM Blocked_Dates)
         ORDER BY date ASC, start_time ASC
         LIMIT ? OFFSET ?`
      ).bind(currentDate, currentDate, currentTime, limit, offset).all()
      finalSlots = results || []
    } else {
      const { results } = await c.env.DB.prepare(
        `SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots 
         WHERE is_booked = 0 
         AND (date > ? OR (date = ? AND start_time > ?))
         AND date NOT IN (SELECT date FROM Blocked_Dates)
         ORDER BY date ASC, start_time ASC
         LIMIT 1000`
      ).bind(currentDate, currentDate, currentTime).all()

      const matching = (results || []).filter(slot =>
        isSlotInWeeklyAvailability(slot as any, weeklyAvailability)
      )
      finalSlots = matching.slice(offset, offset + limit)
    }

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
