import { Hono } from 'hono'
import type { Bindings } from '../index'
import {
  isSlotInWeeklyAvailability,
  queryAvailableSlots
} from '../lib/scheduleSync.ts'

export { isSlotInWeeklyAvailability }

export const scheduleRouter = new Hono<{ Bindings: Bindings }>()

scheduleRouter.get('/', async (c) => {
  try {
    const tzSetting: any = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'timezone'"
    ).first()
    const tz = tzSetting?.setting_value || 'America/New_York'

    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 100))
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)
    const durationQuery = parseInt(c.req.query('duration') || '0', 10)
    const fullDayParam = c.req.query('fullDay') ?? c.req.query('full_day')
    const serviceIdParam = c.req.query('serviceId') ?? c.req.query('service_id')
    const serviceIdNum = serviceIdParam ? parseInt(serviceIdParam, 10) : NaN

    const matching = await queryAvailableSlots(c.env.DB, {
      timeZone: tz,
      durationMinutes: durationQuery > 0 ? durationQuery : undefined,
      fullDay: fullDayParam === '1' || fullDayParam === 'true' ? true : undefined,
      serviceId: Number.isFinite(serviceIdNum) && serviceIdNum > 0 ? serviceIdNum : null,
      requireUnbooked: true
    })

    const finalSlots = matching.slice(offset, offset + limit)

    c.header('Cache-Control', 'no-store')
    return c.json({ slots: finalSlots, limit, offset, status: 'success', data: finalSlots })
  } catch {
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
