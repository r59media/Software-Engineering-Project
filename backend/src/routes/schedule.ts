import { Hono } from 'hono'
import { Bindings } from '../index'

export const scheduleRouter = new Hono<{ Bindings: Bindings }>()

scheduleRouter.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, date, start_time, end_time FROM Schedule_Slots WHERE is_booked = 0 AND date >= date("now") ORDER BY date ASC, start_time ASC'
    ).all()
    
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
