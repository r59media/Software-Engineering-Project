import { Hono } from 'hono'
import { Bindings } from '../index'

export const scheduleRouter = new Hono<{ Bindings: Bindings }>()

scheduleRouter.get('/', async (c) => {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false
    })
    const parts = formatter.formatToParts(now)
    const hash: Record<string, string> = {}
    parts.forEach(p => hash[p.type] = p.value)
    
    const currentDate = `${hash.year}-${hash.month}-${hash.day}`
    let currentHour = hash.hour
    // Handle 24:00 edge case from Intl
    if (currentHour === '24') currentHour = '00'
    const currentTime = `${currentHour}:${hash.minute}`

    const { results } = await c.env.DB.prepare(
      `SELECT id, date, start_time, end_time FROM Schedule_Slots 
       WHERE is_booked = 0 
       AND (date > ? OR (date = ? AND start_time > ?))
       ORDER BY date ASC, start_time ASC`
    ).bind(currentDate, currentDate, currentTime).all()
    
    return c.json({ slots: results })
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
