import { Hono } from 'hono'
import { Bindings } from '../index'

export const servicesRouter = new Hono<{ Bindings: Bindings }>()

servicesRouter.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, name, description, price, duration_minutes FROM Services WHERE is_active = 1 ORDER BY id ASC'
    ).all()
    
    return c.json({ services: results })
  } catch (e: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not fetch services.',
        details: []
      }
    }, 500)
  }
})
