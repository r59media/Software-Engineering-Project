import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth, verifySessionToken, extractSessionToken, isTokenRevoked, isTokenRevokedInDb, hasForbiddenPaymentFields } from '../middleware/auth'
import defaultPortfolioSeed from '../defaultPortfolioSeed.json'

function isValidId(id: string | undefined): boolean {
  return typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id)
}

export const DEFAULT_STUDIO_TIERS = [
  {
    name: 'Portrait',
    description: 'Individual headshots and portraits that feel like you.',
    best_for: 'LinkedIn, resumes & personal branding',
    duration_minutes: 60,
    photo_count: 5,
    outfits: 1,
    price: 6000,
    currency: 'USD',
    booking_mode: 'direct',
    additional_people: JSON.stringify({ includedPeople: 1 }),
    display_order: 1
  },
  {
    name: 'Grad Pics',
    description: 'Celebrate your achievement with photos made for you.',
    best_for: 'Graduation announcements & keepsakes',
    duration_minutes: 120,
    photo_count: 10,
    outfits: 2,
    price: 15000,
    currency: 'USD',
    booking_mode: 'direct',
    additional_people: JSON.stringify({ includedPeople: 1 }),
    display_order: 2
  },
  {
    name: 'Branding Pics',
    description: 'A focused session to bring your personal brand to life.',
    best_for: 'Creators & entrepreneurs',
    duration_minutes: 120,
    photo_count: 15,
    outfits: null,
    price: 23000,
    currency: 'USD',
    booking_mode: 'direct',
    additional_people: null,
    display_order: 3
  },
  {
    name: 'Event',
    description: 'Capture the people, details and moments that matter.',
    best_for: 'Celebrations & special occasions',
    duration_minutes: 300,
    photo_count: 300,
    outfits: null,
    price: 70000,
    currency: 'USD',
    booking_mode: 'direct',
    additional_people: null,
    display_order: 4
  },
  {
    name: 'Business package',
    description: 'Photography tailored to your team, business and goals.',
    best_for: 'Teams & business content',
    duration_minutes: null,
    photo_count: null,
    outfits: null,
    price: null,
    currency: 'USD',
    booking_mode: 'inquiry',
    additional_people: null,
    display_order: 5
  }
]

export function mapServiceRow(s: any) {
  let additionalPeople: any = undefined
  if (s.additional_people) {
    if (typeof s.additional_people === 'string') {
      try {
        additionalPeople = JSON.parse(s.additional_people)
      } catch {
        additionalPeople = undefined
      }
    } else if (typeof s.additional_people === 'object') {
      additionalPeople = s.additional_people
    }
  }

  return {
    id: String(s.id),
    name: s.name,
    title: s.name,
    description: s.description || '',
    bestFor: s.best_for || '',
    image: s.image_url ? { url: s.image_url, alt: s.image_alt || s.name } : undefined,
    durationMinutes: s.duration_minutes !== null && s.duration_minutes !== undefined ? Number(s.duration_minutes) : null,
    photoCount: s.photo_count !== null && s.photo_count !== undefined ? Number(s.photo_count) : undefined,
    outfits: s.outfits !== null && s.outfits !== undefined ? Number(s.outfits) : undefined,
    priceMinor: s.price !== null && s.price !== undefined ? Number(s.price) : null,
    price: s.price !== null && s.price !== undefined ? Number(s.price) : 0, // backwards-compatibility for existing admin callers
    duration_minutes: s.duration_minutes,
    currency: s.currency || 'USD',
    bookingMode: (s.booking_mode || 'direct') as 'direct' | 'inquiry',
    additionalPeople,
    displayOrder: s.display_order ?? 0,
    isActive: s.is_active !== 0,
    is_active: s.is_active
  }
}

export async function ensureServicesSchemaAndDefaults(db: D1Database): Promise<void> {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS Services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        best_for TEXT,
        image_url TEXT,
        image_alt TEXT,
        price INTEGER,
        duration_minutes INTEGER,
        photo_count INTEGER,
        outfits INTEGER,
        currency TEXT DEFAULT 'USD',
        booking_mode TEXT DEFAULT 'direct',
        additional_people TEXT,
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).run().catch(() => {})

    const alterCols = [
      'ALTER TABLE Services ADD COLUMN best_for TEXT',
      'ALTER TABLE Services ADD COLUMN image_url TEXT',
      'ALTER TABLE Services ADD COLUMN image_alt TEXT',
      'ALTER TABLE Services ADD COLUMN photo_count INTEGER',
      'ALTER TABLE Services ADD COLUMN outfits INTEGER',
      'ALTER TABLE Services ADD COLUMN currency TEXT DEFAULT "USD"',
      'ALTER TABLE Services ADD COLUMN booking_mode TEXT DEFAULT "direct"',
      'ALTER TABLE Services ADD COLUMN additional_people TEXT',
      'ALTER TABLE Services ADD COLUMN display_order INTEGER DEFAULT 0'
    ]
    for (const stmt of alterCols) {
      await db.prepare(stmt).run().catch(() => {})
    }

    const row = await db.prepare('SELECT COUNT(*) as count FROM Services').first<{ count: number }>().catch(() => null)
    if (row && row.count === 0) {
      const seedList = (defaultPortfolioSeed as any)?.services || DEFAULT_STUDIO_TIERS
      const inserts = seedList.map((s: any) =>
        db.prepare(
          `INSERT INTO Services (
            name, description, best_for, image_url, image_alt,
            price, duration_minutes, photo_count, outfits,
            currency, booking_mode, additional_people, display_order, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          s.name,
          s.description ?? null,
          s.best_for ?? s.bestFor ?? null,
          s.image_url ?? s.imageUrl ?? null,
          s.image_alt ?? s.imageAlt ?? null,
          s.price !== null && s.price !== undefined ? Math.round(Number(s.price)) : null,
          s.duration_minutes !== null && s.duration_minutes !== undefined ? Math.round(Number(s.duration_minutes)) : null,
          s.photo_count !== null && s.photo_count !== undefined ? Math.round(Number(s.photo_count)) : null,
          s.outfits !== null && s.outfits !== undefined ? Math.round(Number(s.outfits)) : null,
          s.currency || 'USD',
          s.booking_mode || s.bookingMode || 'direct',
          typeof s.additional_people === 'object' && s.additional_people !== null
            ? JSON.stringify(s.additional_people)
            : (s.additional_people ?? null),
          s.display_order ?? s.displayOrder ?? 0,
          1
        )
      )
      await db.batch(inserts)
    }
  } catch (err) {
    console.error('[services] ensureServicesSchemaAndDefaults non-fatal error:', err)
  }
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

    await ensureServicesSchemaAndDefaults(c.env.DB)

    const query = includeAll
      ? 'SELECT * FROM Services ORDER BY display_order ASC, id ASC'
      : 'SELECT * FROM Services WHERE is_active = 1 ORDER BY display_order ASC, id ASC'

    const { results } = await c.env.DB.prepare(query).all()
    const services = (results || []).map(mapServiceRow)

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

// GET /:id: Get a single service
servicesRouter.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    await ensureServicesSchemaAndDefaults(c.env.DB)
    const row = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ?').bind(id).first()
    if (!row) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }
    const service = mapServiceRow(row)
    return c.json({ service, status: 'success', data: service })
  } catch (e: any) {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch service.', details: [] } }, 500)
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

    await ensureServicesSchemaAndDefaults(c.env.DB)

    const rawName = body.name ?? body.title
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    const description = body.description !== undefined && body.description !== null ? String(body.description) : null
    const rawBestFor = body.best_for ?? body.bestFor
    const bestFor = rawBestFor !== undefined && rawBestFor !== null ? String(rawBestFor) : null

    const rawImageUrl = body.image_url ?? body.imageUrl ?? body.image?.url
    const imageUrl = rawImageUrl !== undefined && rawImageUrl !== null ? String(rawImageUrl) : null
    const rawImageAlt = body.image_alt ?? body.imageAlt ?? body.image?.alt
    const imageAlt = rawImageAlt !== undefined && rawImageAlt !== null ? String(rawImageAlt) : null

    const rawBookingMode = body.booking_mode ?? body.bookingMode ?? 'direct'
    const bookingMode = rawBookingMode === 'inquiry' ? 'inquiry' : 'direct'

    const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim() : 'USD'

    const errors: Array<{ field: string; message: string; code: string }> = []
    if (!name) {
      errors.push({ field: 'name', message: 'Service name/title is required.', code: 'REQUIRED_FIELD' })
    }
    if (rawBookingMode !== 'direct' && rawBookingMode !== 'inquiry' && rawBookingMode !== undefined) {
      errors.push({ field: 'booking_mode', message: "Booking mode must be 'direct' or 'inquiry'.", code: 'INVALID_VALUE' })
    }

    const rawPrice = body.priceMinor !== undefined ? body.priceMinor : body.price
    let cleanPrice: number | null = null
    if (rawPrice === null || (rawPrice === undefined && bookingMode === 'inquiry')) {
      cleanPrice = null
    } else if (rawPrice !== undefined) {
      const numPrice = Number(rawPrice)
      if (!Number.isFinite(numPrice) || numPrice < 0) {
        errors.push({ field: 'price', message: 'Price (in cents) must be a valid number >= 0.', code: 'INVALID_VALUE' })
      } else {
        cleanPrice = Math.round(numPrice)
      }
    } else {
      errors.push({ field: 'price', message: 'Price (in cents) is required for direct booking mode.', code: 'REQUIRED_FIELD' })
    }

    const rawDuration = body.duration_minutes !== undefined ? body.duration_minutes : body.durationMinutes
    let cleanDuration: number | null = null
    if (rawDuration === null || (rawDuration === undefined && bookingMode === 'inquiry')) {
      cleanDuration = null
    } else if (rawDuration !== undefined) {
      const numDuration = Number(rawDuration)
      if (!Number.isFinite(numDuration) || numDuration < 0) {
        errors.push({ field: 'duration_minutes', message: 'Duration in minutes must be >= 0.', code: 'INVALID_VALUE' })
      } else {
        cleanDuration = Math.round(numDuration)
      }
    } else {
      cleanDuration = 60
    }

    const rawPhotoCount = body.photo_count !== undefined ? body.photo_count : body.photoCount
    let cleanPhotoCount: number | null = null
    if (rawPhotoCount !== undefined && rawPhotoCount !== null) {
      const num = Number(rawPhotoCount)
      if (!Number.isFinite(num) || num < 0) {
        errors.push({ field: 'photo_count', message: 'Photo count must be an integer >= 0.', code: 'INVALID_VALUE' })
      } else {
        cleanPhotoCount = Math.round(num)
      }
    }

    const rawOutfits = body.outfits
    let cleanOutfits: number | null = null
    if (rawOutfits !== undefined && rawOutfits !== null) {
      const num = Number(rawOutfits)
      if (!Number.isFinite(num) || num < 0) {
        errors.push({ field: 'outfits', message: 'Outfits must be an integer >= 0.', code: 'INVALID_VALUE' })
      } else {
        cleanOutfits = Math.round(num)
      }
    }

    const rawAdditionalPeople = body.additional_people !== undefined ? body.additional_people : body.additionalPeople
    let cleanAdditionalPeople: string | null = null
    if (rawAdditionalPeople !== undefined && rawAdditionalPeople !== null) {
      if (typeof rawAdditionalPeople === 'string') {
        try {
          JSON.parse(rawAdditionalPeople)
          cleanAdditionalPeople = rawAdditionalPeople
        } catch {
          errors.push({ field: 'additional_people', message: 'Additional people must be a valid JSON string or object.', code: 'INVALID_VALUE' })
        }
      } else if (typeof rawAdditionalPeople === 'object') {
        cleanAdditionalPeople = JSON.stringify(rawAdditionalPeople)
      } else {
        errors.push({ field: 'additional_people', message: 'Additional people must be an object or JSON string.', code: 'INVALID_VALUE' })
      }
    }

    const rawDisplayOrder = body.display_order !== undefined ? body.display_order : body.displayOrder
    let cleanDisplayOrder = 0
    if (rawDisplayOrder !== undefined && rawDisplayOrder !== null) {
      const num = Number(rawDisplayOrder)
      if (!Number.isFinite(num)) {
        errors.push({ field: 'display_order', message: 'Display order must be an integer.', code: 'INVALID_VALUE' })
      } else {
        cleanDisplayOrder = Math.round(num)
      }
    }

    const isActive = body.is_active !== undefined
      ? (body.is_active ? 1 : 0)
      : body.active !== undefined
        ? (body.active ? 1 : 0)
        : 1

    if (errors.length > 0) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not create service.', details: errors } }, 400)
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO Services (
        name, description, best_for, image_url, image_alt,
        price, duration_minutes, photo_count, outfits,
        currency, booking_mode, additional_people, display_order, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      name,
      description,
      bestFor,
      imageUrl,
      imageAlt,
      cleanPrice,
      cleanDuration,
      cleanPhotoCount,
      cleanOutfits,
      currency,
      bookingMode,
      cleanAdditionalPeople,
      cleanDisplayOrder,
      isActive
    ).run()

    const newId = result.meta.last_row_id
    const createdRow = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ?').bind(newId).first()
    const mapped = mapServiceRow(createdRow)

    return c.json({
      success: true,
      status: 'success',
      id: newId,
      data: mapped
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

    await ensureServicesSchemaAndDefaults(c.env.DB)

    const existing = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ?').bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }

    const rawName = body.name ?? body.title
    const name = rawName !== undefined ? String(rawName).trim() : String(existing.name || '').trim()
    const description = body.description !== undefined
      ? (body.description === null ? null : String(body.description))
      : existing.description

    const rawBestFor = body.best_for !== undefined ? body.best_for : body.bestFor
    const bestFor = rawBestFor !== undefined
      ? (rawBestFor === null ? null : String(rawBestFor))
      : existing.best_for

    const rawImageUrl = body.image_url !== undefined ? body.image_url : (body.imageUrl !== undefined ? body.imageUrl : body.image?.url)
    const imageUrl = rawImageUrl !== undefined
      ? (rawImageUrl === null ? null : String(rawImageUrl))
      : existing.image_url

    const rawImageAlt = body.image_alt !== undefined ? body.image_alt : (body.imageAlt !== undefined ? body.imageAlt : body.image?.alt)
    const imageAlt = rawImageAlt !== undefined
      ? (rawImageAlt === null ? null : String(rawImageAlt))
      : existing.image_alt

    const rawBookingMode = body.booking_mode !== undefined ? body.booking_mode : body.bookingMode
    const bookingMode = rawBookingMode !== undefined ? rawBookingMode : (existing.booking_mode || 'direct')

    const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim() : (existing.currency || 'USD')

    const errors: Array<{ field: string; message: string; code: string }> = []
    if (!name) {
      errors.push({ field: 'name', message: 'Service name/title cannot be empty.', code: 'REQUIRED_FIELD' })
    }
    if (bookingMode !== 'direct' && bookingMode !== 'inquiry') {
      errors.push({ field: 'booking_mode', message: "Booking mode must be 'direct' or 'inquiry'.", code: 'INVALID_VALUE' })
    }

    const rawPrice = body.priceMinor !== undefined ? body.priceMinor : body.price
    let cleanPrice: number | null = existing.price
    if (rawPrice !== undefined) {
      if (rawPrice === null) {
        cleanPrice = null
      } else {
        const numPrice = Number(rawPrice)
        if (!Number.isFinite(numPrice) || numPrice < 0) {
          errors.push({ field: 'price', message: 'Price must be a valid number >= 0.', code: 'INVALID_VALUE' })
        } else {
          cleanPrice = Math.round(numPrice)
        }
      }
    } else if (rawBookingMode === 'inquiry' && cleanPrice === null) {
      cleanPrice = null
    }

    const rawDuration = body.duration_minutes !== undefined ? body.duration_minutes : body.durationMinutes
    let cleanDuration: number | null = existing.duration_minutes
    if (rawDuration !== undefined) {
      if (rawDuration === null) {
        cleanDuration = null
      } else {
        const numDuration = Number(rawDuration)
        if (!Number.isFinite(numDuration) || numDuration < 0) {
          errors.push({ field: 'duration_minutes', message: 'Duration in minutes must be >= 0.', code: 'INVALID_VALUE' })
        } else {
          cleanDuration = Math.round(numDuration)
        }
      }
    }

    const rawPhotoCount = body.photo_count !== undefined ? body.photo_count : body.photoCount
    let cleanPhotoCount: number | null = existing.photo_count
    if (rawPhotoCount !== undefined) {
      if (rawPhotoCount === null) {
        cleanPhotoCount = null
      } else {
        const num = Number(rawPhotoCount)
        if (!Number.isFinite(num) || num < 0) {
          errors.push({ field: 'photo_count', message: 'Photo count must be an integer >= 0.', code: 'INVALID_VALUE' })
        } else {
          cleanPhotoCount = Math.round(num)
        }
      }
    }

    const rawOutfits = body.outfits
    let cleanOutfits: number | null = existing.outfits
    if (rawOutfits !== undefined) {
      if (rawOutfits === null) {
        cleanOutfits = null
      } else {
        const num = Number(rawOutfits)
        if (!Number.isFinite(num) || num < 0) {
          errors.push({ field: 'outfits', message: 'Outfits must be an integer >= 0.', code: 'INVALID_VALUE' })
        } else {
          cleanOutfits = Math.round(num)
        }
      }
    }

    const rawAdditionalPeople = body.additional_people !== undefined ? body.additional_people : body.additionalPeople
    let cleanAdditionalPeople: string | null = existing.additional_people
    if (rawAdditionalPeople !== undefined) {
      if (rawAdditionalPeople === null) {
        cleanAdditionalPeople = null
      } else if (typeof rawAdditionalPeople === 'string') {
        try {
          JSON.parse(rawAdditionalPeople)
          cleanAdditionalPeople = rawAdditionalPeople
        } catch {
          errors.push({ field: 'additional_people', message: 'Additional people must be a valid JSON string or object.', code: 'INVALID_VALUE' })
        }
      } else if (typeof rawAdditionalPeople === 'object') {
        cleanAdditionalPeople = JSON.stringify(rawAdditionalPeople)
      } else {
        errors.push({ field: 'additional_people', message: 'Additional people must be an object or JSON string.', code: 'INVALID_VALUE' })
      }
    }

    const rawDisplayOrder = body.display_order !== undefined ? body.display_order : body.displayOrder
    let cleanDisplayOrder = existing.display_order ?? 0
    if (rawDisplayOrder !== undefined) {
      if (rawDisplayOrder === null) {
        cleanDisplayOrder = 0
      } else {
        const num = Number(rawDisplayOrder)
        if (!Number.isFinite(num)) {
          errors.push({ field: 'display_order', message: 'Display order must be an integer.', code: 'INVALID_VALUE' })
        } else {
          cleanDisplayOrder = Math.round(num)
        }
      }
    }

    const isActive = body.is_active !== undefined
      ? (body.is_active ? 1 : 0)
      : body.active !== undefined
        ? (body.active ? 1 : 0)
        : existing.is_active

    if (errors.length > 0) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not update service.', details: errors } }, 400)
    }

    await c.env.DB.prepare(
      `UPDATE Services SET
        name = ?,
        description = ?,
        best_for = ?,
        image_url = ?,
        image_alt = ?,
        price = ?,
        duration_minutes = ?,
        photo_count = ?,
        outfits = ?,
        currency = ?,
        booking_mode = ?,
        additional_people = ?,
        display_order = ?,
        is_active = ?
      WHERE id = ?`
    ).bind(
      name,
      description,
      bestFor,
      imageUrl,
      imageAlt,
      cleanPrice,
      cleanDuration,
      cleanPhotoCount,
      cleanOutfits,
      currency,
      bookingMode,
      cleanAdditionalPeople,
      cleanDisplayOrder,
      isActive,
      id
    ).run()

    const updatedRow = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ?').bind(id).first()
    const mapped = mapServiceRow(updatedRow)

    return c.json({
      success: true,
      status: 'success',
      data: mapped
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
