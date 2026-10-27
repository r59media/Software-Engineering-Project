import { Hono } from 'hono'
import { Bindings } from '../index'

export const scheduleRouter = new Hono<{ Bindings: Bindings }>()

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

    const { results } = await c.env.DB.prepare(
      `SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots 
       WHERE is_booked = 0 
       AND (date > ? OR (date = ? AND start_time > ?))
       AND date NOT IN (SELECT date FROM Blocked_Dates)
       ORDER BY date ASC, start_time ASC
       LIMIT ? OFFSET ?`
    ).bind(currentDate, currentDate, currentTime, limit, offset).all()
    
    return c.json({ slots: results, limit, offset, status: 'success', data: results })
  } catch (e: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not fetch schedule slots.',
        details: []
      }
    }, 500)
  }
})
