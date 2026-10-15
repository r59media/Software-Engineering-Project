import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth } from '../middleware/auth'

export const servicesRouter = new Hono<{ Bindings: Bindings }>()

// GET: List services (active only by default, or all if requested with auth)
servicesRouter.get('/', async (c) => {
  try {
    const includeAll = c.req.query('all') === 'true'
    const query = includeAll
      ? 'SELECT id, name, description, price, duration_minutes, is_active FROM Services ORDER BY id ASC'
      : 'SELECT id, name, description, price, duration_minutes, is_active FROM Services WHERE is_active = 1 ORDER BY id ASC'

    const { results } = await c.env.DB.prepare(query).all()
    
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

// POST: Admin — create a new service
servicesRouter.post('/', adminAuth, async (c) => {
  try {
    const body = await c.req.json()
    const { name, description, price, duration_minutes } = body

    const errors = []
    if (!name) errors.push({ field: 'name', message: 'Service name is required.', code: 'REQUIRED_FIELD' })
    if (price == null || price < 0) errors.push({ field: 'price', message: 'Price (in cents) is required and must be >= 0.', code: 'REQUIRED_FIELD' })
    if (!duration_minutes || duration_minutes < 1) errors.push({ field: 'duration_minutes', message: 'Duration in minutes is required.', code: 'REQUIRED_FIELD' })

    if (errors.length > 0) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not create service.', details: errors } }, 400)
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO Services (name, description, price, duration_minutes) VALUES (?, ?, ?, ?)'
    ).bind(name, description || null, price, duration_minutes).run()

    return c.json({ success: true, id: result.meta.last_row_id })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not create service.', details: [] } }, 500)
  }
})

// PUT: Admin — update a service
servicesRouter.put('/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { name, description, price, duration_minutes, is_active } = body

    const result = await c.env.DB.prepare(
      'UPDATE Services SET name = COALESCE(?, name), description = COALESCE(?, description), price = COALESCE(?, price), duration_minutes = COALESCE(?, duration_minutes), is_active = COALESCE(?, is_active) WHERE id = ?'
    ).bind(name || null, description !== undefined ? description : null, price ?? null, duration_minutes ?? null, is_active ?? null, id).run()

    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not update service.', details: [] } }, 500)
  }
})

// DELETE: Admin — delete or deactivate a service
servicesRouter.delete('/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')

    // Check if service has existing bookings
    const bookingCheck = await c.env.DB.prepare(
      'SELECT id FROM Bookings WHERE service_id = ? LIMIT 1'
    ).bind(id).first()

    if (bookingCheck) {
      // Soft delete to protect financial integrity of bookings
      await c.env.DB.prepare('UPDATE Services SET is_active = 0 WHERE id = ?').bind(id).run()
      return c.json({ success: true, message: 'Service deactivated (has associated bookings).' })
    }

    const result = await c.env.DB.prepare('DELETE FROM Services WHERE id = ?').bind(id).run()
    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete service.', details: [] } }, 500)
  }
})
