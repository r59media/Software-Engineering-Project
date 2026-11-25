import { Hono } from 'hono'
import type { Bindings } from '../index'
import { adminAuth, verifyAdminSessionRequest, hasForbiddenPaymentFields } from '../middleware/auth'
import { isValidId, parseJsonObject } from '../utils/validation'
import defaultPortfolioSeed from '../defaultPortfolioSeed.json'
import { bumpPublicContentVersion, withPublicEdgeCache } from '../lib/edgeCache'
import { runOncePerDb } from '../lib/billingSchema'

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

function parseJsonSafe(raw: unknown): any {
  if (!raw) return undefined
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function toNullableNumber(val: unknown): number | null {
  return val !== null && val !== undefined ? Number(val) : null
}

function toOptionalNumber(val: unknown): number | undefined {
  return val !== null && val !== undefined ? Number(val) : undefined
}

function toRoundedIntOrNull(val: unknown): number | null {
  return val !== null && val !== undefined ? Math.round(Number(val)) : null
}

function serializeAdditionalPeopleValue(val: unknown): string | null {
  if (typeof val === 'object' && val !== null) return JSON.stringify(val)
  return (val as string | null) ?? null
}

export function mapServiceRow(s: any) {
  const additionalPeople = parseJsonSafe(s.additional_people)
  const bookingMode = (s.booking_mode || 'direct') as 'direct' | 'inquiry'
  const fullDay = Boolean(s.full_day)
  const displayOrder = s.display_order ?? 0
  const priceMinor = toNullableNumber(s.price)

  return {
    id: String(s.id),
    name: s.name,
    title: s.name,
    description: s.description || '',
    bestFor: s.best_for || '',
    best_for: s.best_for || '',
    image: s.image_url ? { url: s.image_url, alt: s.image_alt || s.name } : undefined,
    image_url: s.image_url || null,
    image_alt: s.image_alt || null,
    durationMinutes: toNullableNumber(s.duration_minutes),
    photoCount: toOptionalNumber(s.photo_count),
    photo_count: toNullableNumber(s.photo_count),
    outfits: toOptionalNumber(s.outfits),
    full_day: fullDay,
    fullDay,
    priceMinor,
    price: priceMinor ?? 0,
    duration_minutes: s.duration_minutes,
    currency: s.currency || 'USD',
    bookingMode,
    booking_mode: bookingMode,
    additionalPeople,
    additional_people: additionalPeople ?? null,
    displayOrder,
    display_order: displayOrder,
    isActive: s.is_active !== 0,
    is_active: s.is_active
  }
}

const SERVICES_ALTER_COLS = [
  'ALTER TABLE Services ADD COLUMN best_for TEXT',
  'ALTER TABLE Services ADD COLUMN image_url TEXT',
  'ALTER TABLE Services ADD COLUMN image_alt TEXT',
  'ALTER TABLE Services ADD COLUMN photo_count INTEGER',
  'ALTER TABLE Services ADD COLUMN outfits INTEGER',
  'ALTER TABLE Services ADD COLUMN full_day INTEGER DEFAULT 0',
  'ALTER TABLE Services ADD COLUMN currency TEXT DEFAULT "USD"',
  'ALTER TABLE Services ADD COLUMN booking_mode TEXT DEFAULT "direct"',
  'ALTER TABLE Services ADD COLUMN additional_people TEXT',
  'ALTER TABLE Services ADD COLUMN display_order INTEGER DEFAULT 0'
]

async function ensureServicesTablesAndColumns(db: D1Database): Promise<void> {
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
      full_day INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      booking_mode TEXT DEFAULT 'direct',
      additional_people TEXT,
      display_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => {})

  for (const stmt of SERVICES_ALTER_COLS) {
    await db.prepare(stmt).run().catch(() => {})
  }
}

async function seedServicesList(db: D1Database, seedList: any[]): Promise<void> {
  const inserts = seedList.map((s: any) =>
    db.prepare(
      `INSERT INTO Services (
        name, description, best_for, image_url, image_alt,
        price, duration_minutes, photo_count, outfits, full_day,
        currency, booking_mode, additional_people, display_order, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      s.name,
      s.description ?? null,
      s.best_for ?? s.bestFor ?? null,
      s.image_url ?? s.imageUrl ?? null,
      s.image_alt ?? s.imageAlt ?? null,
      toRoundedIntOrNull(s.price),
      toRoundedIntOrNull(s.duration_minutes),
      toRoundedIntOrNull(s.photo_count),
      toRoundedIntOrNull(s.outfits),
      s.full_day ? 1 : 0,
      s.currency || 'USD',
      s.booking_mode || s.bookingMode || 'direct',
      serializeAdditionalPeopleValue(s.additional_people),
      s.display_order ?? s.displayOrder ?? 0,
      1
    )
  )
  await db.batch(inserts)
}

async function backfillServicesDefaults(db: D1Database, seedList: any[]): Promise<void> {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)'
  ).run().catch(() => {})
  const flag = await db.prepare(
    "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'services_defaults_backfilled_v1'"
  ).first<{ setting_value: string }>().catch(() => null)
  if (flag) return

  const updates = seedList.map((s: any) =>
    db.prepare(
      `UPDATE Services SET
        best_for = COALESCE(NULLIF(best_for, ''), ?),
        photo_count = COALESCE(photo_count, ?),
        outfits = COALESCE(outfits, ?),
        booking_mode = COALESCE(NULLIF(booking_mode, ''), ?),
        additional_people = COALESCE(additional_people, ?),
        display_order = CASE WHEN display_order IS NULL OR display_order = 0 THEN ? ELSE display_order END
      WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`
    ).bind(
      s.best_for ?? s.bestFor ?? null,
      toRoundedIntOrNull(s.photo_count),
      toRoundedIntOrNull(s.outfits),
      s.booking_mode || s.bookingMode || 'direct',
      serializeAdditionalPeopleValue(s.additional_people),
      s.display_order ?? s.displayOrder ?? 0,
      s.name
    )
  )
  updates.push(
    db.prepare(
      "INSERT OR REPLACE INTO Admin_Settings (setting_key, setting_value) VALUES ('services_defaults_backfilled_v1', '1')"
    )
  )
  await db.batch(updates).catch(() => {})
}

const servicesSchemaByDb = new WeakMap<object, Promise<void>>()

async function runServicesSchemaMigration(targetDb: D1Database): Promise<boolean> {
  try {
    await ensureServicesTablesAndColumns(targetDb)
    const row = await targetDb.prepare('SELECT COUNT(*) as count FROM Services').first<{ count: number }>().catch(() => null)
    const seedList = (defaultPortfolioSeed as any)?.services || DEFAULT_STUDIO_TIERS
    if (row && row.count === 0) {
      await seedServicesList(targetDb, seedList)
    } else if (row && row.count > 0) {
      await backfillServicesDefaults(targetDb, seedList)
    }
    return true
  } catch (err) {
    console.error('[services] ensureServicesSchemaAndDefaults non-fatal error:', err)
    return false
  }
}

export async function ensureServicesSchemaAndDefaults(db: D1Database): Promise<void> {
  return runOncePerDb(servicesSchemaByDb, db, runServicesSchemaMigration)
}

export function extractMediaStorageKey(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null
  const trimmed = rawUrl.trim()
  if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/assets/') || trimmed.startsWith('data:')) {
    return null
  }
  const key = trimmed.split('?')[0].replace(/^\/api\/media\//, '').replace(/^\/+/, '')
  if (!key || key.includes('..')) return null
  return key
}

/** Deletes a service image's Media_Storage chunks if no other service or portfolio row still references it. */
export async function deleteServiceImageIfUnreferenced(db: D1Database, rawImageUrl: unknown): Promise<void> {
  const key = extractMediaStorageKey(rawImageUrl)
  if (!key) return
  try {
    const refService = await db
      .prepare('SELECT 1 FROM Services WHERE image_url IN (?, ?, ?) LIMIT 1')
      .bind(key, `/api/media/${key}`, `/${key}`)
      .first()
    if (refService) return

    const refPortfolio = await db
      .prepare('SELECT 1 FROM Portfolio_Images WHERE media_key IN (?, ?, ?) LIMIT 1')
      .bind(key, `/api/media/${key}`, `/${key}`)
      .first()
      .catch(() => null)
    if (refPortfolio) return

    await db
      .prepare('DELETE FROM Media_Storage WHERE file_key IN (?, ?, ?)')
      .bind(key, `${key}__w640`, `${key}__w1280`)
      .run()
  } catch {}
}

export interface ParsedServicePayload {
  name: string
  description: string | null
  bestFor: string | null
  imageUrl: string | null
  imageAlt: string | null
  price: number | null
  durationMinutes: number | null
  photoCount: number | null
  outfits: number | null
  fullDay: number
  currency: string
  bookingMode: string
  additionalPeople: string | null
  displayOrder: number
  isActive: number
}

type FieldError = { field: string; message: string; code: string }

function parseOptionalNonNegInt(
  raw: unknown,
  fallback: number | null,
  field: string,
  message: string,
  errors: FieldError[]
): number | null {
  if (raw === undefined) return fallback
  if (raw === null) return null
  const num = Number(raw)
  if (!Number.isFinite(num) || num < 0) {
    errors.push({ field, message, code: 'INVALID_VALUE' })
    return fallback
  }
  return Math.round(num)
}

function parseAdditionalPeopleInput(
  raw: unknown,
  fallback: string | null,
  errors: FieldError[]
): string | null {
  if (raw === undefined) return fallback
  if (raw === null || raw === '') return null
  if (typeof raw === 'string') {
    try {
      JSON.parse(raw)
      return raw
    } catch {
      errors.push({ field: 'additional_people', message: 'Additional people must be a valid JSON string or object.', code: 'INVALID_VALUE' })
      return fallback
    }
  }
  if (typeof raw === 'object') return JSON.stringify(raw)
  errors.push({ field: 'additional_people', message: 'Additional people must be an object or JSON string.', code: 'INVALID_VALUE' })
  return fallback
}

function firstDefined(body: Record<string, any>, ...keys: string[]): any {
  for (const k of keys) {
    if (body[k] !== undefined) return body[k]
  }
  return undefined
}

function parseOptionalTextField(raw: unknown, fallback: string | null): string | null {
  if (raw === undefined) return fallback
  return raw === null ? null : String(raw)
}

function resolvePriceAndDuration(
  body: Record<string, any>,
  existing: any | undefined,
  bookingMode: string,
  errors: FieldError[]
): { price: number | null; durationMinutes: number | null } {
  const isCreate = !existing
  const rawPrice = firstDefined(body, 'priceMinor', 'price')
  let price: number | null = existing ? existing.price : null
  if (rawPrice === null || (rawPrice === undefined && bookingMode === 'inquiry' && isCreate)) {
    price = null
  } else if (rawPrice !== undefined) {
    const num = Number(rawPrice)
    if (!Number.isFinite(num) || num < 0) {
      errors.push({
        field: 'price',
        message: isCreate ? 'Price (in cents) must be a valid number >= 0.' : 'Price must be a valid number >= 0.',
        code: 'INVALID_VALUE'
      })
    } else {
      price = Math.round(num)
    }
  } else if (isCreate) {
    errors.push({ field: 'price', message: 'Price (in cents) is required for direct booking mode.', code: 'REQUIRED_FIELD' })
  }

  const rawDuration = firstDefined(body, 'duration_minutes', 'durationMinutes')
  let durationMinutes: number | null = existing ? existing.duration_minutes : 60
  if (rawDuration === null || (rawDuration === undefined && bookingMode === 'inquiry' && (isCreate || existing?.duration_minutes == null))) {
    durationMinutes = null
  } else if (rawDuration !== undefined) {
    const num = Number(rawDuration)
    if (!Number.isFinite(num) || num < 0) {
      errors.push({ field: 'duration_minutes', message: 'Duration in minutes must be >= 0.', code: 'INVALID_VALUE' })
    } else {
      durationMinutes = Math.round(num)
    }
  }

  return { price, durationMinutes }
}

/**
 * Shared service/package payload parser & validator used by POST /api/services,
 * PUT /api/services/:id, and PUT /api/admin/packages/:id.
 */
export function parseServicePayload(
  body: Record<string, any>,
  existing?: any
): { ok: true; data: ParsedServicePayload } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = []
  const isCreate = !existing

  const rawName = body.name ?? body.title
  const name = rawName !== undefined ? (typeof rawName === 'string' || !isCreate ? String(rawName).trim() : '') : String(existing?.name || '').trim()
  if (!name) {
    errors.push({
      field: 'name',
      message: isCreate ? 'Service name/title is required.' : 'Service name/title cannot be empty.',
      code: 'REQUIRED_FIELD'
    })
  }

  const rawBookingMode = firstDefined(body, 'booking_mode', 'bookingMode')
  const bookingMode = rawBookingMode !== undefined ? String(rawBookingMode) : (existing?.booking_mode || 'direct')
  if (bookingMode !== 'direct' && bookingMode !== 'inquiry') {
    errors.push({ field: 'booking_mode', message: "Booking mode must be 'direct' or 'inquiry'.", code: 'INVALID_VALUE' })
  }

  const { price, durationMinutes } = resolvePriceAndDuration(body, existing, bookingMode, errors)

  const photoCount = parseOptionalNonNegInt(
    firstDefined(body, 'photo_count', 'photoCount'),
    existing?.photo_count ?? null,
    'photo_count',
    'Photo count must be an integer >= 0.',
    errors
  )
  const outfits = parseOptionalNonNegInt(
    body.outfits,
    existing?.outfits ?? null,
    'outfits',
    'Outfits must be an integer >= 0.',
    errors
  )
  const additionalPeople = parseAdditionalPeopleInput(
    firstDefined(body, 'additional_people', 'additionalPeople'),
    existing?.additional_people ?? null,
    errors
  )

  const rawDisplayOrder = firstDefined(body, 'display_order', 'displayOrder')
  let displayOrder = existing?.display_order ?? 0
  if (rawDisplayOrder !== undefined) {
    if (rawDisplayOrder === null) {
      displayOrder = 0
    } else {
      const num = Number(rawDisplayOrder)
      if (!Number.isFinite(num)) {
        errors.push({ field: 'display_order', message: 'Display order must be an integer.', code: 'INVALID_VALUE' })
      } else {
        displayOrder = Math.round(num)
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const rawFullDay = firstDefined(body, 'full_day', 'fullDay')
  const fullDay = rawFullDay !== undefined
    ? (rawFullDay === true || Number(rawFullDay) === 1 ? 1 : 0)
    : (existing?.full_day ? 1 : 0)
  const rawActive = firstDefined(body, 'is_active', 'active')
  const isActive = rawActive !== undefined ? (rawActive ? 1 : 0) : (existing ? existing.is_active : 1)
  const currency = typeof body.currency === 'string' && body.currency.trim()
    ? body.currency.trim()
    : (existing?.currency || 'USD')

  return {
    ok: true,
    data: {
      name,
      description: parseOptionalTextField(body.description, existing?.description ?? null),
      bestFor: parseOptionalTextField(firstDefined(body, 'best_for', 'bestFor'), existing?.best_for ?? null),
      imageUrl: parseOptionalTextField(firstDefined(body, 'image_url', 'imageUrl') ?? body.image?.url, existing?.image_url ?? null),
      imageAlt: parseOptionalTextField(firstDefined(body, 'image_alt', 'imageAlt') ?? body.image?.alt, existing?.image_alt ?? null),
      price,
      durationMinutes,
      photoCount,
      outfits,
      fullDay,
      currency,
      bookingMode,
      additionalPeople,
      displayOrder,
      isActive
    }
  }
}

/**
 * Persists a validated service payload (insert when `existing` is omitted, update otherwise),
 * cleans up replaced image blobs, and bumps public edge cache version.
 */
export async function saveServiceRecord(
  db: D1Database,
  payload: ParsedServicePayload,
  existing?: any
): Promise<{ id: number; row: any; mapped: ReturnType<typeof mapServiceRow> }> {
  const binds = [
    payload.name,
    payload.description,
    payload.bestFor,
    payload.imageUrl,
    payload.imageAlt,
    payload.price,
    payload.durationMinutes,
    payload.photoCount,
    payload.outfits,
    payload.fullDay,
    payload.currency,
    payload.bookingMode,
    payload.additionalPeople,
    payload.displayOrder,
    payload.isActive
  ]

  let targetId: number
  if (existing) {
    targetId = Number(existing.id)
    await db.prepare(
      `UPDATE Services SET
        name = ?, description = ?, best_for = ?, image_url = ?, image_alt = ?,
        price = ?, duration_minutes = ?, photo_count = ?, outfits = ?, full_day = ?,
        currency = ?, booking_mode = ?, additional_people = ?, display_order = ?, is_active = ?
      WHERE id = ?`
    ).bind(...binds, existing.id).run()

    if (existing.image_url && existing.image_url !== payload.imageUrl) {
      await deleteServiceImageIfUnreferenced(db, existing.image_url)
    }
  } else {
    const result = await db.prepare(
      `INSERT INTO Services (
        name, description, best_for, image_url, image_alt,
        price, duration_minutes, photo_count, outfits, full_day,
        currency, booking_mode, additional_people, display_order, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(...binds).run()
    targetId = Number(result.meta.last_row_id)
  }

  const row = await db.prepare('SELECT * FROM Services WHERE id = ?').bind(targetId).first()
  await bumpPublicContentVersion(db)
  return { id: targetId, row, mapped: mapServiceRow(row) }
}

/**
 * Deletes a service if it has no bookings, or soft-deactivates it (`is_active = 0`) otherwise.
 */
export async function deleteOrDeactivateService(
  db: D1Database,
  id: string
): Promise<
  | { ok: true; deactivated: boolean; reason?: 'has_bookings' | 'fk_constraint' }
  | { ok: false; status: 404 }
> {
  const existing = await db.prepare('SELECT id, image_url FROM Services WHERE id = ?').bind(id).first<{ id: number; image_url: string | null }>()
  if (!existing) return { ok: false, status: 404 }

  const bookingCheck = await db.prepare('SELECT id FROM Bookings WHERE service_id = ? LIMIT 1').bind(id).first()
  if (bookingCheck) {
    await db.prepare('UPDATE Services SET is_active = 0 WHERE id = ?').bind(id).run()
    await bumpPublicContentVersion(db)
    return { ok: true, deactivated: true, reason: 'has_bookings' }
  }

  try {
    await db.prepare('DELETE FROM Services WHERE id = ?').bind(id).run()
    await deleteServiceImageIfUnreferenced(db, existing.image_url)
    await bumpPublicContentVersion(db)
    return { ok: true, deactivated: false }
  } catch {
    await db.prepare('UPDATE Services SET is_active = 0 WHERE id = ?').bind(id).run()
    await bumpPublicContentVersion(db)
    return { ok: true, deactivated: true, reason: 'fk_constraint' }
  }
}

export const servicesRouter = new Hono<{ Bindings: Bindings }>()

// GET: List services (active only by default, or all if requested with valid admin auth)
servicesRouter.get('/', async (c) => {
  const includeAllRequested = c.req.query('all') === 'true'
  return withPublicEdgeCache(c, async ({ cacheControl }) => {
    try {
      let includeAll = false
      if (includeAllRequested) {
        const authResult = await verifyAdminSessionRequest(c)
        if (authResult.ok) {
          includeAll = true
        } else if (authResult.status === 503) {
          c.header('Cache-Control', 'no-store')
          return {
            cacheable: false,
            response: c.json({ error: { code: authResult.code, message: authResult.message, details: [] } }, 503)
          }
        }
      }

      await ensureServicesSchemaAndDefaults(c.env.DB)
      const query = includeAll
        ? 'SELECT * FROM Services ORDER BY display_order ASC, id ASC'
        : 'SELECT * FROM Services WHERE is_active = 1 ORDER BY display_order ASC, id ASC'

      const { results } = await c.env.DB.prepare(query).all()
      const services = (results || []).map(mapServiceRow)

      c.header('Cache-Control', cacheControl)
      return { response: c.json({ services, status: 'success', data: services }) }
    } catch {
      c.header('Cache-Control', 'no-store')
      return {
        cacheable: false,
        response: c.json({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Could not fetch services.',
            details: []
          }
        }, 500)
      }
    }
  }, { bypass: includeAllRequested })
})

// GET /:id: Get a single service
servicesRouter.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!isValidId(id)) {
    return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
  }

  return withPublicEdgeCache(c, async ({ cacheControl }) => {
    try {
      await ensureServicesSchemaAndDefaults(c.env.DB)
      const row = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ?').bind(id).first<any>()
      if (!row) {
        c.header('Cache-Control', 'no-store')
        return { cacheable: false, response: c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404) }
      }

      const isInactive = row.is_active === 0 || row.is_active === false
      if (isInactive) {
        const authResult = await verifyAdminSessionRequest(c)
        if (!authResult.ok) {
          c.header('Cache-Control', 'no-store')
          if (authResult.status === 503) {
            return { cacheable: false, response: c.json({ error: { code: authResult.code, message: authResult.message, details: [] } }, 503) }
          }
          return { cacheable: false, response: c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404) }
        }
        const service = mapServiceRow(row)
        c.header('Cache-Control', 'private, no-store')
        return { cacheable: false, response: c.json({ service, status: 'success', data: service }) }
      }

      const service = mapServiceRow(row)
      c.header('Cache-Control', cacheControl)
      return { response: c.json({ service, status: 'success', data: service }) }
    } catch {
      return { cacheable: false, response: c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch service.', details: [] } }, 500) }
    }
  })
})

// POST: Admin — create a new service
servicesRouter.post('/', adminAuth, async (c) => {
  try {
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.data
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
    const parsed = parseServicePayload(body)
    if (!parsed.ok) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not create service.', details: parsed.errors } }, 400)
    }

    const saved = await saveServiceRecord(c.env.DB, parsed.data)
    return c.json({ success: true, status: 'success', id: saved.id, data: saved.mapped })
  } catch {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not create service.', details: [] } }, 500)
  }
})

// PUT /order: Admin — update display_order for services in a batch
servicesRouter.put('/order', adminAuth, async (c) => {
  try {
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const ids = parsedBody.data?.ids
    if (!Array.isArray(ids)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Expected { ids: number[] }.',
          details: [{ field: 'ids', message: 'ids must be an array of numbers.', code: 'INVALID_TYPE' }]
        }
      }, 400)
    }

    if (ids.some((id: any) => typeof id !== 'number' || !Number.isInteger(id) || id <= 0)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'All ids in array must be positive integers.',
          details: [{ field: 'ids', message: 'Each id must be a positive integer.', code: 'INVALID_VALUE' }]
        }
      }, 400)
    }

    await ensureServicesSchemaAndDefaults(c.env.DB)

    const statements = ids.map((id: number, index: number) =>
      c.env.DB.prepare('UPDATE Services SET display_order = ? WHERE id = ?').bind(index + 1, id)
    )

    if (statements.length > 0) {
      await c.env.DB.batch(statements)
    }

    await bumpPublicContentVersion(c.env.DB)

    return c.json({ success: true, status: 'success' })
  } catch {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not reorder services.',
        details: []
      }
    }, 500)
  }
})

// PUT: Admin — update a service (supports partial updates)
servicesRouter.put('/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const parsedBody = await parseJsonObject(c)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.data
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

    const parsed = parseServicePayload(body, existing)
    if (!parsed.ok) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Could not update service.', details: parsed.errors } }, 400)
    }

    const saved = await saveServiceRecord(c.env.DB, parsed.data, existing)
    return c.json({ success: true, status: 'success', data: saved.mapped })
  } catch {
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

    const result = await deleteOrDeactivateService(c.env.DB, id)
    if (!result.ok) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Service not found.', details: [] } }, 404)
    }
    if (result.deactivated) {
      const message =
        result.reason === 'has_bookings'
          ? 'Service deactivated (has associated bookings).'
          : 'Service deactivated (has associated records).'
      return c.json({ success: true, status: 'success', message })
    }
    return c.json({ success: true, status: 'success' })
  } catch {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Could not delete service.', details: [] } }, 500)
  }
})
