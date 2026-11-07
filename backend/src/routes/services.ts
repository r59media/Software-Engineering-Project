import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth, verifySessionToken, extractSessionToken, isTokenRevoked, isTokenRevokedInDb, hasForbiddenPaymentFields } from '../middleware/auth'
import { ensureSchemaReady } from './admin'

function isValidId(id: string | undefined): boolean {
  return typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id)
}

const OUTFITS_MESSAGE = 'Number of outfits must be a whole number from 0 to 50.'
const DURATION_MESSAGE = 'Session length must be a whole number of minutes from 15 to 1440.'

/** outfits: null or '' means not set; otherwise a whole number 0–50. Returns undefined when invalid. */
function parseOutfits(raw: unknown): number | null | undefined {
  if (raw === null || raw === '') return null
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' ? Number(raw.trim()) : NaN)
  if (!Number.isInteger(n) || n < 0 || n > 50) return undefined
  return n
}

/** duration_minutes: a whole number 15–1440. Returns undefined when invalid. */
function parseDuration(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : NaN)
  if (!Number.isInteger(n) || n < 15 || n > 1440) return undefined
  return n
}

const FULL_DAY_MESSAGE = 'Entire day must be true or false.'
/** Stored length for a new entire-day package (the booking dialog does not use it). */
const FULL_DAY_MINUTES = 1440

/** full_day: boolean, 0/1 or "true"/"false"/"0"/"1". Returns undefined when invalid. */
function parseFullDay(raw: unknown): boolean | undefined {
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') return true
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') return false
  return undefined
}

const isMissingColumn = (e: unknown): boolean => /no such column/i.test(String((e as { message?: string })?.message ?? e))

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

    const where = includeAll ? '' : ' WHERE is_active = 1'
    const query = `SELECT id, name, description, price, duration_minutes, outfits, full_day, is_active FROM Services${where} ORDER BY id ASC`
    const noFullDayQuery = `SELECT id, name, description, price, duration_minutes, outfits, is_active FROM Services${where} ORDER BY id ASC`
    const legacyQuery = `SELECT id, name, description, price, duration_minutes, is_active FROM Services${where} ORDER BY id ASC`

    // This public route can run before any admin route has added the outfits / full_day columns to an
    // older database: on "no such column", run the schema migration and retry, then fall back without
    // full_day, then without both.
    let results: any[] | undefined
    try {
      results = (await c.env.DB.prepare(query).all()).results
    } catch (e) {
      if (!isMissingColumn(e)) throw e
      await ensureSchemaReady(c.env.DB)
      for (const sql of [query, noFullDayQuery, legacyQuery]) {
        try {
          results = (await c.env.DB.prepare(sql).all()).results
          break
        } catch (retryErr) {
          if (!isMissingColumn(retryErr) || sql === legacyQuery) throw retryErr
        }
      }
    }
    const services = (results || []).map((s: any) => ({
      ...s,
      outfits: s.outfits ?? null,
      full_day: Number(s.full_day ?? 0) === 1,
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
    const fullDay = body.full_day === undefined || body.full_day === null ? false : parseFullDay(body.full_day)
    // Entire day: the length is not used, so it is not validated and is stored as 1440.
    const rawDuration = body.duration_minutes ?? body.durationMinutes ?? 60
    const cleanDuration = fullDay ? FULL_DAY_MINUTES : parseDuration(rawDuration)
    const outfits = body.outfits === undefined ? null : parseOutfits(body.outfits)
    const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : (body.active !== undefined ? (body.active ? 1 : 0) : 1)

    const errors = []
    if (!name) {
      errors.push({ field: 'name', message: 'Service name/title is required.', code: 'REQUIRED_FIELD' })
    }
    if (body.price === undefined || body.price === null || !Number.isFinite(numPrice) || numPrice < 0) {
      errors.push({ field: 'price', message: 'Price (in cents) is required and must be >= 0.', code: 'INVALID_VALUE' })
    }
    if (cleanDuration === undefined) {
      errors.push({ field: 'duration_minutes', message: DURATION_MESSAGE, code: 'INVALID_VALUE' })
    }
    if (outfits === undefined) {
      errors.push({ field: 'outfits', message: OUTFITS_MESSAGE, code: 'INVALID_VALUE' })
    }

    if (fullDay === undefined) {
      errors.push({ field: 'full_day', message: FULL_DAY_MESSAGE, code: 'INVALID_VALUE' })
    }

    if (errors.length > 0 || cleanDuration === undefined || outfits === undefined || fullDay === undefined) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not create service.', details: errors } }, 400)
    }

    const cleanPrice = Math.round(numPrice)

    await ensureSchemaReady(c.env.DB) // older databases: adds the outfits and full_day columns
    const result = await c.env.DB.prepare(
      'INSERT INTO Services (name, description, price, duration_minutes, outfits, full_day, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(name, description, cleanPrice, cleanDuration, outfits, fullDay ? 1 : 0, isActive).run()

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
        outfits,
        full_day: fullDay,
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

    await ensureSchemaReady(c.env.DB) // older databases: adds the outfits and full_day columns
    const existing = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ?').bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }

    const rawName = body.name ?? body.title
    const name = rawName !== undefined ? String(rawName).trim() : String(existing.name || '').trim()
    const description = body.description !== undefined ? (body.description === null ? null : String(body.description)) : existing.description
    const rawPrice = body.price !== undefined ? body.price : existing.price
    const numPrice = Number(rawPrice)
    // Partial update: a field that is not sent keeps its stored value (stored values are not re-validated)
    const fullDay = body.full_day !== undefined && body.full_day !== null
      ? parseFullDay(body.full_day)
      : Number(existing.full_day ?? 0) === 1
    const storedDuration = Math.round(Number(existing.duration_minutes ?? 60))
    const durationGiven = body.duration_minutes !== undefined || body.durationMinutes !== undefined
    const sentDuration = durationGiven ? parseDuration(body.duration_minutes ?? body.durationMinutes) : undefined
    // Entire day: the length is not validated; keep the stored one unless a valid one is sent.
    const cleanDuration = fullDay
      ? (sentDuration ?? storedDuration)
      : (durationGiven ? sentDuration : storedDuration)
    const outfits = body.outfits !== undefined ? parseOutfits(body.outfits) : (existing.outfits ?? null)
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
    if (cleanDuration === undefined || !Number.isFinite(cleanDuration)) {
      errors.push({ field: 'duration_minutes', message: DURATION_MESSAGE, code: 'INVALID_VALUE' })
    }
    if (outfits === undefined) {
      errors.push({ field: 'outfits', message: OUTFITS_MESSAGE, code: 'INVALID_VALUE' })
    }

    if (fullDay === undefined) {
      errors.push({ field: 'full_day', message: FULL_DAY_MESSAGE, code: 'INVALID_VALUE' })
    }

    if (errors.length > 0 || cleanDuration === undefined || outfits === undefined || fullDay === undefined) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not update service.', details: errors } }, 400)
    }

    const cleanPrice = Math.round(numPrice)

    await c.env.DB.prepare(
      'UPDATE Services SET name = ?, description = ?, price = ?, duration_minutes = ?, outfits = ?, full_day = ?, is_active = ? WHERE id = ?'
    ).bind(name, description, cleanPrice, cleanDuration, outfits, fullDay ? 1 : 0, isActive, id).run()

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
        outfits,
        full_day: fullDay,
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
