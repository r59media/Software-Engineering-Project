import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth, verifySessionToken, extractSessionToken, isTokenRevoked, isTokenRevokedInDb, hasForbiddenPaymentFields } from '../middleware/auth'

function isValidId(id: string | undefined): boolean {
  return typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id)
}

export const servicesRouter = new Hono<{ Bindings: Bindings }>()

// GET: List services (active only by default, or all if requested with valid admin auth)
servicesRouter.get('/', async (c) => {
  try {
    const includeAllRequested = c.req.query('all') === 'true'
    let includeAll = false

    if (includeAllRequested) {
      const token = extractSessionToken(c)
      const secret = c.env.ADMIN_SECRET
      if (token && secret && !isTokenRevoked(token) && !(await isTokenRevokedInDb(c.env.DB, token))) {
        const signingSecret = c.env.SESSION_SECRET || secret
        const session = await verifySessionToken(token, signingSecret)
        if (session.valid) {
          includeAll = true
        }
      }
    }

    const query = includeAll
      ? 'SELECT id, name, description, price, duration_minutes, is_active FROM Services ORDER BY id ASC'
      : 'SELECT id, name, description, price, duration_minutes, is_active FROM Services WHERE is_active = 1 ORDER BY id ASC'

    const { results } = await c.env.DB.prepare(query).all()
    const services = (results || []).map((s: any) => ({
      ...s,
      title: s.name
    }))

    return c.json({ services, status: 'success', data: services })
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
    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account numbers cannot be stored. Use Square tokenization.',
          details: []
        }
      }, 400)
    }
    const rawName = body.name ?? body.title
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    const description = body.description !== undefined && body.description !== null ? String(body.description) : null
    const numPrice = Number(body.price)
    const rawDuration = body.duration_minutes ?? body.durationMinutes ?? 60
    const numDuration = Number(rawDuration)
    const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : (body.active !== undefined ? (body.active ? 1 : 0) : 1)

    const errors = []
    if (!name) {
      errors.push({ field: 'name', message: 'Service name/title is required.', code: 'REQUIRED_FIELD' })
    }
    if (body.price === undefined || body.price === null || !Number.isFinite(numPrice) || numPrice < 0) {
      errors.push({ field: 'price', message: 'Price (in cents) is required and must be >= 0.', code: 'INVALID_VALUE' })
    }
    if (!Number.isFinite(numDuration) || numDuration < 0) {
      errors.push({ field: 'duration_minutes', message: 'Duration in minutes must be >= 0.', code: 'INVALID_VALUE' })
    }

    if (errors.length > 0) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not create service.', details: errors } }, 400)
    }

    const cleanPrice = Math.round(numPrice)
    const cleanDuration = Math.round(numDuration)

    const result = await c.env.DB.prepare(
      'INSERT INTO Services (name, description, price, duration_minutes, is_active) VALUES (?, ?, ?, ?, ?)'
    ).bind(name, description, cleanPrice, cleanDuration, isActive).run()

    return c.json({
      success: true,
      status: 'success',
      id: result.meta.last_row_id,
      data: {
        id: result.meta.last_row_id,
        name,
        title: name,
        description,
        price: cleanPrice,
        duration_minutes: cleanDuration,
        is_active: isActive
      }
    })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not create service.', details: [] } }, 500)
  }
})

// PUT: Admin — update a service (supports partial updates)
servicesRouter.put('/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const body = await c.req.json()
    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account numbers cannot be stored. Use Square tokenization.',
          details: []
        }
      }, 400)
    }

    const existing = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ?').bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }

    const rawName = body.name ?? body.title
    const name = rawName !== undefined ? String(rawName).trim() : String(existing.name || '').trim()
    const description = body.description !== undefined ? (body.description === null ? null : String(body.description)) : existing.description
    const rawPrice = body.price !== undefined ? body.price : existing.price
    const numPrice = Number(rawPrice)
    const rawDuration = body.duration_minutes ?? body.durationMinutes ?? existing.duration_minutes ?? 60
    const numDuration = Number(rawDuration)
    const isActive =
      body.is_active !== undefined
        ? (body.is_active ? 1 : 0)
        : body.active !== undefined
          ? (body.active ? 1 : 0)
          : existing.is_active

    const errors = []
    if (!name) {
      errors.push({ field: 'name', message: 'Service name/title cannot be empty.', code: 'REQUIRED_FIELD' })
    }
    if (!Number.isFinite(numPrice) || numPrice < 0) {
      errors.push({ field: 'price', message: 'Price must be a valid number >= 0.', code: 'INVALID_VALUE' })
    }
    if (!Number.isFinite(numDuration) || numDuration < 0) {
      errors.push({ field: 'duration_minutes', message: 'Duration in minutes must be >= 0.', code: 'INVALID_VALUE' })
    }

    if (errors.length > 0) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not update service.', details: errors } }, 400)
    }

    const cleanPrice = Math.round(numPrice)
    const cleanDuration = Math.round(numDuration)

    await c.env.DB.prepare(
      'UPDATE Services SET name = ?, description = ?, price = ?, duration_minutes = ?, is_active = ? WHERE id = ?'
    ).bind(name, description, cleanPrice, cleanDuration, isActive, id).run()

    return c.json({
      success: true,
      status: 'success',
      data: {
        id: Number(id),
        name,
        title: name,
        description,
        price: cleanPrice,
        duration_minutes: cleanDuration,
        is_active: isActive
      }
    })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not update service.', details: [] } }, 500)
  }
})

// DELETE: Admin — delete or deactivate a service
servicesRouter.delete('/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }

    const existing = await c.env.DB.prepare('SELECT id FROM Services WHERE id = ?').bind(id).first()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }

    // Check if service has existing bookings
    const bookingCheck = await c.env.DB.prepare(
      'SELECT id FROM Bookings WHERE service_id = ? LIMIT 1'
    ).bind(id).first()

    if (bookingCheck) {
      await c.env.DB.prepare('UPDATE Services SET is_active = 0 WHERE id = ?').bind(id).run()
      return c.json({ success: true, status: 'success', message: 'Service deactivated (has associated bookings).' })
    }

    try {
      await c.env.DB.prepare('DELETE FROM Services WHERE id = ?').bind(id).run()
      return c.json({ success: true, status: 'success' })
    } catch {
      // Fallback to soft-deactivation if foreign key constraint prevents deletion
      await c.env.DB.prepare('UPDATE Services SET is_active = 0 WHERE id = ?').bind(id).run()
      return c.json({ success: true, status: 'success', message: 'Service deactivated (has associated records).' })
    }
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete service.', details: [] } }, 500)
  }
})
