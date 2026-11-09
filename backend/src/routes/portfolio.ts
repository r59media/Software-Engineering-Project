import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth, hasForbiddenPaymentFields } from '../middleware/auth'
import defaultPortfolioSeed from '../defaultPortfolioSeed.json'

// Which part of the public site a photo belongs to (one per admin "Photos" tab, plus hero)
export const PORTFOLIO_SECTIONS = ['recent', 'gallery', 'about', 'hero'] as const
export type PortfolioSection = (typeof PORTFOLIO_SECTIONS)[number]
export const VALID_SECTIONS = new Set(['recent', 'gallery', 'about', 'hero'])

const SELECT_COLUMNS =
  'id, media_key, section, category, title, alt_text, display_order, is_featured, is_active'

function isValidId(id: string | undefined): boolean {
  return typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id)
}

function parseSection(value: unknown): PortfolioSection | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return VALID_SECTIONS.has(normalized) ? (normalized as PortfolioSection) : null
}

function isValidObjectKey(key: unknown): key is string {
  return typeof key === 'string' && key.trim().length > 0 && key.trim().length <= 1024 && !key.includes('..')
}

function isExternalUrl(key: string): boolean {
  return key.startsWith('https://') || key.startsWith('http://') || key.startsWith('data:image/')
}

function optionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return null
  return String(value).slice(0, maxLength)
}

export function resolveMediaUrl(key: string): string {
  if (!key) return ''
  if (key.startsWith('https://') || key.startsWith('http://') || key.startsWith('/') || key.startsWith('data:image/')) {
    return key
  }
  return `/api/media/${key.replace(/^\/+/, '')}`
}

function withUrls<T extends { media_key: string }>(row: T) {
  const url = resolveMediaUrl(row.media_key)
  return { ...row, url, public_url: url }
}

/**
 * Ensures default portfolio images from the Main Page are seeded into Portfolio_Images
 * if a section has 0 images, and keeps Vite compiled asset hashes in sync.
 */
export async function ensurePortfolioDefaults(db: D1Database): Promise<void> {
  try {
    await db.prepare(
      'CREATE TABLE IF NOT EXISTS Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)'
    ).run().catch(() => {})

    const sections = ['hero', 'recent', 'gallery', 'about'] as const
    const statements: any[] = []

    // 1. Update any existing /assets/ rows whose hash changed on rebuild
    for (const sec of sections) {
      const defaults = (defaultPortfolioSeed as any)[sec] || []
      for (const item of defaults) {
        statements.push(
          db.prepare(
            "UPDATE Portfolio_Images SET media_key = ? WHERE LOWER(section) = ? AND title = ? AND display_order = ? AND media_key LIKE '/assets/%' AND media_key != ?"
          ).bind(item.media_key, sec, item.title, item.display_order ?? item.order ?? 1, item.media_key)
        )
      }
    }

    // 2. Seed each section's default images exactly once. A flag in Admin_Settings records the
    //    first run so photos the admin later deletes are not re-inserted. Sections that already
    //    hold photos (databases seeded before the flag existed) are only marked, never re-seeded.
    const flagRows = await db.prepare(
      "SELECT setting_key FROM Admin_Settings WHERE setting_key LIKE 'portfolio_seeded_%'"
    ).all<{ setting_key: string }>().catch(() => ({ results: [] as { setting_key: string }[] }))
    const seededFlags = new Set((flagRows.results || []).map(row => row.setting_key))
    const countRows = await db.prepare(
      'SELECT LOWER(section) AS section, COUNT(*) AS cnt FROM Portfolio_Images GROUP BY LOWER(section)'
    ).all<{ section: string; cnt: number }>().catch(() => ({ results: [] as { section: string; cnt: number }[] }))
    const existingCounts = new Map((countRows.results || []).map(row => [row.section, Number(row.cnt) || 0]))

    for (const sec of sections) {
      const flagKey = `portfolio_seeded_${sec}`
      if (seededFlags.has(flagKey)) continue
      statements.push(
        db.prepare(
          "INSERT INTO Admin_Settings (setting_key, setting_value) VALUES (?, 'true') ON CONFLICT(setting_key) DO NOTHING"
        ).bind(flagKey)
      )
      if ((existingCounts.get(sec) ?? 0) > 0) continue

      const items = (defaultPortfolioSeed as any)[sec] || []
      for (const item of items) {
        const displayOrder = item.display_order ?? item.order ?? 1
        const featured = item.is_featured ? 1 : (sec === 'hero' ? 1 : 0)
        statements.push(
          db.prepare(
            'INSERT INTO Portfolio_Images (media_key, section, category, title, alt_text, display_order, is_featured, is_active) ' +
            'SELECT ?, ?, ?, ?, ?, ?, ?, 1 WHERE NOT EXISTS (' +
            '  SELECT 1 FROM Portfolio_Images WHERE LOWER(section) = ? AND (title = ? OR display_order = ?)' +
            ')'
          ).bind(
            item.media_key,
            sec,
            item.category || (sec === 'hero' ? 'hero' : 'Portrait'),
            item.title || null,
            item.alt_text || null,
            displayOrder,
            featured,
            sec,
            item.title || '',
            displayOrder
          )
        )
      }
    }

    if (statements.length > 0) {
      await db.batch(statements)
    }
  } catch (err) {
    console.error('ensurePortfolioDefaults warning:', err)
  }
}

/**
 * Older databases were created before photos were tagged with a site section and title.
 * Add those columns on first use so existing local and remote D1 databases keep working
 * without a manual migration. Runs once per Worker isolate.
 */
let portfolioSchemaReady = false
export async function ensurePortfolioSchema(db: D1Database): Promise<void> {
  if (!portfolioSchemaReady) {
    const info = await db.prepare('PRAGMA table_info(Portfolio_Images)').all<{ name: string }>().catch(() => ({ results: [] }))
    const columns = new Set((info.results || []).map(col => col.name))

    const migrations: string[] = []
    // Databases created before the r2_object_key -> media_key rename still carry the old column
    if (columns.has('r2_object_key') && !columns.has('media_key')) {
      migrations.push('ALTER TABLE Portfolio_Images RENAME COLUMN r2_object_key TO media_key')
    }
    if (!columns.has('section')) {
      migrations.push("ALTER TABLE Portfolio_Images ADD COLUMN section TEXT NOT NULL DEFAULT 'gallery'")
    }
    if (!columns.has('title')) {
      migrations.push('ALTER TABLE Portfolio_Images ADD COLUMN title TEXT')
    }

    for (const sql of migrations) {
      // Another isolate may win the race and add the column first; that is fine
      await db.prepare(sql).run().catch(err => {
        const message = String(err?.message || err)
        if (!message.includes('duplicate column') && !message.includes('no such column')) throw err
      })
    }
    await db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_portfolio_section_order ON Portfolio_Images(is_active, section, display_order)'
    ).run().catch(() => {})

    // Seed empty sections and refresh rebuilt asset hashes once per isolate (i.e. once per deploy)
    await ensurePortfolioDefaults(db)

    portfolioSchemaReady = true
  }
}

/** Confirm uploaded bytes actually exist before a record points at them, so the site never shows a broken image. */
async function mediaExists(db: D1Database, key: string): Promise<boolean> {
  if (isExternalUrl(key) || key.startsWith('/assets/')) return true
  try {
    const row = await db.prepare('SELECT 1 AS found FROM Media_Storage WHERE file_key = ? LIMIT 1').bind(key).first()
    return Boolean(row)
  } catch {
    return false
  }
}

async function deleteStoredMedia(db: D1Database, key: string | null | undefined): Promise<void> {
  if (!key || isExternalUrl(key) || key.startsWith('/assets/')) return
  await db.prepare('DELETE FROM Media_Storage WHERE file_key = ?').bind(key).run().catch(() => {})
}

function validationError(message: string, field: string) {
  return {
    error: {
      code: 'VALIDATION_FAILED',
      message,
      target: 'portfolio',
      details: [{ field, message, code: 'INVALID_VALUE' }]
    }
  }
}

// Public profile: no placeholder content. A field that was never saved is empty.
export const EMPTY_PROFILE = {
  bio: '',
  email: '',
  phone: '',
  location: '',
  travel: '',
  social: [] as { platform: string; url: string }[]
}

export const portfolioRouter = new Hono<{ Bindings: Bindings }>()

// GET: Public studio profile information
portfolioRouter.get('/profile', async (c) => {
  try {
    let parsed: any = null
    if (c.env.DB) {
      try {
        const row = await c.env.DB.prepare(
          "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'profile'"
        ).first<{ setting_value: string }>()
        if (row?.setting_value) {
          parsed = JSON.parse(row.setting_value)
        }
      } catch {}
    }

    // A stored value (including '') is returned as stored; a missing or null field is empty
    const text = (value: unknown): string =>
      value === undefined || value === null ? '' : String(value).trim()

    const profile = {
      bio: text(parsed?.bio),
      email: text(parsed?.email),
      phone: text(parsed?.phone),
      location: text(parsed?.location),
      // The admin saves travel as a label (e.g. "Studio only"); keep that text instead of coercing it to true
      travel: parsed?.travel !== undefined && parsed?.travel !== null
        ? (typeof parsed.travel === 'string' ? parsed.travel : Boolean(parsed.travel))
        : EMPTY_PROFILE.travel,
      // No placeholder social links: an unsaved profile has none
      social: parsed?.social ?? []
    }

    c.header('Cache-Control', 'no-store')
    return c.json({
      status: 'success',
      profile,
      data: profile
    })
  } catch {
    const profile = { ...EMPTY_PROFILE, social: [] }
    return c.json({ status: 'success', profile, data: profile })
  }
})

export interface PortfolioListQuery {
  limit?: string
  offset?: string
  category?: string
  section?: string
}

export type PortfolioListResult =
  | { ok: true; body: { images: any[]; limit: number; offset: number; status: 'success'; data: any[] } }
  | { ok: false; status: 400; body: ReturnType<typeof validationError> }

/**
 * The one photo-list query behind GET /api/portfolio (public, active photos only) and
 * GET /api/admin/portfolio (includeInactive: hidden photos too). Same params, hero rules,
 * filters, ordering, paging and row shape for both.
 */
export async function listPortfolio(
  db: D1Database,
  query: PortfolioListQuery,
  { includeInactive = false }: { includeInactive?: boolean } = {}
): Promise<PortfolioListResult> {
  await ensurePortfolioSchema(db)

  const limit = Math.max(1, Math.min(parseInt(query.limit || '50', 10) || 50, 100))
  const offset = Math.max(0, parseInt(query.offset || '0', 10) || 0)
  const category = (query.category || '').trim()
  const rawSection = query.section

  const where: string[] = includeInactive ? [] : ['is_active = 1']
  const params: (string | number)[] = []

  const isHeroQuery =
    category.toLowerCase() === 'hero' ||
    (rawSection !== undefined && rawSection.trim().toLowerCase() === 'hero')

  if (isHeroQuery) {
    where.push("(LOWER(category) = 'hero' OR is_featured = 1 OR LOWER(section) = 'hero')")
  } else {
    if (rawSection !== undefined && rawSection.trim() !== '') {
      const section = parseSection(rawSection)
      if (!section) {
        return {
          ok: false,
          status: 400,
          body: validationError(`Unknown section. Use one of: ${PORTFOLIO_SECTIONS.join(', ')}.`, 'section')
        }
      }
      where.push('section = ?')
      params.push(section)
    }

    if (category && category.toLowerCase() !== 'all') {
      where.push('LOWER(category) = LOWER(?)')
      params.push(category)
    }
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const queryRes = await db.prepare(
    `SELECT ${SELECT_COLUMNS} FROM Portfolio_Images ${whereSql} ORDER BY display_order ASC, id ASC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<any>()

  // is_active is always 1 or 0 (the public list only ever holds 1)
  const images = (queryRes.results || []).map((row: any) => withUrls({ ...row, is_active: row.is_active ? 1 : 0 }))
  return { ok: true, body: { images, limit, offset, status: 'success', data: images } }
}

/** Reads the list params from a request. */
export function portfolioListQuery(req: { query: (name: string) => string | undefined }): PortfolioListQuery {
  return {
    limit: req.query('limit'),
    offset: req.query('offset'),
    category: req.query('category'),
    section: req.query('section')
  }
}

// GET: Public gallery, optionally narrowed to one site section and/or category
portfolioRouter.get('/', async (c) => {
  try {
    const result = await listPortfolio(c.env.DB, portfolioListQuery(c.req))
    if (!result.ok) return c.json(result.body, result.status)

    // Admin edits must show up on the next page load, so never let browsers or CDNs cache this list
    c.header('Cache-Control', 'no-store')
    return c.json(result.body)
  } catch (e: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not fetch portfolio images.',
        details: []
      }
    }, 500)
  }
})

// POST: Save a new image record (admin only)
portfolioRouter.post('/', adminAuth, async (c) => {
  try {
    await ensurePortfolioSchema(c.env.DB)

    const body = await c.req.json().catch(() => ({}))
    const { media_key, is_featured = false } = body

    if (!isValidObjectKey(media_key)) {
      return c.json(validationError('A valid media_key (1-1024 characters, no path traversal) is required.', 'media_key'), 400)
    }
    const cleanKey = media_key.trim()

    const section = body.section === undefined ? 'gallery' : parseSection(body.section)
    if (!section) {
      return c.json(validationError(`Unknown section. Use one of: ${PORTFOLIO_SECTIONS.join(', ')}.`, 'section'), 400)
    }

    let category = body.category
    if (category === undefined || category === null || String(category).trim() === '') {
      category = section === 'hero' ? 'hero' : 'All'
    } else {
      category = String(category).trim()
    }

    if (!(await mediaExists(c.env.DB, cleanKey))) {
      return c.json(validationError('The uploaded image could not be found. Please upload it again.', 'media_key'), 400)
    }

    // New photos go to the end of their section unless the caller asks for a specific position
    let displayOrder = Number(body.display_order)
    if (body.display_order === undefined || body.display_order === null || !Number.isFinite(displayOrder)) {
      const last = await c.env.DB.prepare(
        'SELECT COALESCE(MAX(display_order), -1) AS max_order FROM Portfolio_Images WHERE section = ?'
      ).bind(section).first<{ max_order: number }>()
      displayOrder = (last?.max_order ?? -1) + 1
    }

    const title = optionalText(body.title, 200)
    const altText = optionalText(body.alt_text, 500)
    const featured = is_featured ? 1 : 0

    const result = await c.env.DB.prepare(
      'INSERT INTO Portfolio_Images (media_key, section, category, title, alt_text, display_order, is_featured) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(cleanKey, section, String(category), title, altText, displayOrder, featured).run()

    const record = withUrls({
      id: result.meta.last_row_id,
      media_key: cleanKey,
      section,
      category: String(category),
      title,
      alt_text: altText,
      display_order: displayOrder,
      is_featured: featured,
      is_active: 1
    })

    return c.json({ success: true, status: 'success', id: record.id, url: record.url, public_url: record.url, data: record })
  } catch (e: any) {
    if (String(e?.message || e).includes('UNIQUE')) {
      return c.json({ error: { code: 'CONFLICT', message: 'This image is already in the portfolio.', details: [] } }, 409)
    }
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not save the image record.',
        details: []
      }
    }, 500)
  }
})

// PUT: Reorder images (admin only)
portfolioRouter.put('/order', adminAuth, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    const orderMappings = body.order || []

    if (!Array.isArray(orderMappings)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Expected order array with id and display_order.',
          details: []
        }
      }, 400)
    }

    const entries = orderMappings.map((item: any, idx: number) => ({
      id: String(item?.id !== undefined ? item.id : item),
      displayOrder: Number(item?.display_order !== undefined ? item.display_order : idx)
    }))
    if (entries.some(entry => !isValidId(entry.id) || !Number.isFinite(entry.displayOrder))) {
      return c.json({
        error: { code: 'VALIDATION_FAILED', message: 'Each entry needs a valid id and a numeric display_order.', details: [] }
      }, 400)
    }

    const statements = entries.map(entry =>
      c.env.DB.prepare('UPDATE Portfolio_Images SET display_order = ? WHERE id = ?').bind(entry.displayOrder, Number(entry.id))
    )

    if (statements.length > 0) {
      await c.env.DB.batch(statements)
    }

    return c.json({ success: true, status: 'success' })
  } catch (e: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not update image ordering.',
        details: []
      }
    }, 500)
  }
})

// PUT: Update one image's metadata, or swap in a newly uploaded file (admin only)
portfolioRouter.put('/:id', adminAuth, async (c) => {
  try {
    await ensurePortfolioSchema(c.env.DB)

    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const body = await c.req.json().catch(() => ({}))
    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account numbers cannot be stored. Use Square tokenization.',
          details: []
        }
      }, 400)
    }

    const existing = await c.env.DB.prepare(`SELECT ${SELECT_COLUMNS} FROM Portfolio_Images WHERE id = ?`).bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Image record not found.', details: [] } }, 404)
    }

    let section = existing.section
    if (body.section !== undefined) {
      section = parseSection(body.section)
      if (!section) {
        return c.json(validationError(`Unknown section. Use one of: ${PORTFOLIO_SECTIONS.join(', ')}.`, 'section'), 400)
      }
    }

    // Replacing the photo keeps its id, position and captions; only the stored file changes
    let objectKey = existing.media_key
    if (body.media_key !== undefined && body.media_key !== existing.media_key) {
      if (!isValidObjectKey(body.media_key)) {
        return c.json(validationError('A valid media_key (1-1024 characters, no path traversal) is required.', 'media_key'), 400)
      }
      objectKey = body.media_key.trim()
      if (!(await mediaExists(c.env.DB, objectKey))) {
        return c.json(validationError('The uploaded image could not be found. Please upload it again.', 'media_key'), 400)
      }
    }

    const category = body.category !== undefined ? String(body.category) : existing.category
    const title = body.title !== undefined ? optionalText(body.title, 200) : existing.title
    const alt_text = body.alt_text !== undefined ? optionalText(body.alt_text, 500) : existing.alt_text
    const is_active =
      body.is_active !== undefined
        ? (body.is_active ? 1 : 0)
        : body.active !== undefined
          ? (body.active ? 1 : 0)
          : existing.is_active
    const is_featured = body.is_featured !== undefined ? (body.is_featured ? 1 : 0) : existing.is_featured
    const display_order = body.display_order !== undefined && Number.isFinite(Number(body.display_order))
      ? Number(body.display_order)
      : existing.display_order

    await c.env.DB.prepare(
      'UPDATE Portfolio_Images SET media_key = ?, section = ?, category = ?, title = ?, alt_text = ?, is_active = ?, is_featured = ?, display_order = ? WHERE id = ?'
    ).bind(objectKey, section, category, title, alt_text, is_active, is_featured, display_order, id).run()

    // The old file is no longer referenced by anything once it has been swapped out
    if (objectKey !== existing.media_key) {
      await deleteStoredMedia(c.env.DB, existing.media_key)
    }

    return c.json({
      success: true,
      status: 'success',
      data: withUrls({
        id: Number(id),
        media_key: objectKey,
        section,
        category,
        title,
        alt_text,
        is_active,
        is_featured,
        display_order
      })
    })
  } catch (e: any) {
    if (String(e?.message || e).includes('UNIQUE')) {
      return c.json({ error: { code: 'CONFLICT', message: 'That file is already used by another photo.', details: [] } }, 409)
    }
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not update portfolio image.',
        details: []
      }
    }, 500)
  }
})

// DELETE: Remove an image record and its stored file (admin only)
portfolioRouter.delete('/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')
    if (!isValidId(id)) {
      return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid resource ID.', details: [] } }, 400)
    }
    const existing = await c.env.DB.prepare(
      'SELECT id, media_key FROM Portfolio_Images WHERE id = ?'
    ).bind(id).first<{ id: number; media_key: string }>()

    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Image record not found.', details: [] } }, 404)
    }

    await c.env.DB.prepare('DELETE FROM Portfolio_Images WHERE id = ?').bind(id).run()
    await deleteStoredMedia(c.env.DB, existing.media_key)

    return c.json({ success: true, status: 'success', data: { id: Number(id), deleted: true } })
  } catch (e: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not delete portfolio image.',
        details: []
      }
    }, 500)
  }
})
