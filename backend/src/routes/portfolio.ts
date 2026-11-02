import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth, hasForbiddenPaymentFields } from '../middleware/auth'

// Which part of the public site a photo belongs to (one per admin "Photos" tab, plus hero)
export const PORTFOLIO_SECTIONS = ['recent', 'gallery', 'about', 'hero'] as const
export type PortfolioSection = (typeof PORTFOLIO_SECTIONS)[number]

const SELECT_COLUMNS =
  'id, r2_object_key, section, category, title, alt_text, display_order, is_featured, is_active'

function isValidId(id: string | undefined): boolean {
  return typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id)
}

function parseSection(value: unknown): PortfolioSection | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return (PORTFOLIO_SECTIONS as readonly string[]).includes(normalized) ? (normalized as PortfolioSection) : null
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

function withUrls<T extends { r2_object_key: string }>(row: T) {
  const url = resolveMediaUrl(row.r2_object_key)
  return { ...row, url, public_url: url }
}

/**
 * Older databases were created before photos were tagged with a site section and title.
 * Add those columns on first use so existing local and remote D1 databases keep working
 * without a manual migration. Runs once per Worker isolate.
 */
let portfolioSchemaReady = false
export async function ensurePortfolioSchema(db: D1Database): Promise<void> {
  if (portfolioSchemaReady) return

  const info = await db.prepare('PRAGMA table_info(Portfolio_Images)').all<{ name: string }>()
  const columns = new Set((info.results || []).map(col => col.name))

  const migrations: string[] = []
  if (!columns.has('section')) {
    migrations.push("ALTER TABLE Portfolio_Images ADD COLUMN section TEXT NOT NULL DEFAULT 'gallery'")
  }
  if (!columns.has('title')) {
    migrations.push('ALTER TABLE Portfolio_Images ADD COLUMN title TEXT')
  }

  for (const sql of migrations) {
    // Another isolate may win the race and add the column first; that is fine
    await db.prepare(sql).run().catch(err => {
      if (!String(err?.message || err).includes('duplicate column')) throw err
    })
  }
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_portfolio_section_order ON Portfolio_Images(is_active, section, display_order)'
  ).run()

  portfolioSchemaReady = true
}

/** Confirm uploaded bytes actually exist before a record points at them, so the site never shows a broken image. */
async function mediaExists(db: D1Database, key: string): Promise<boolean> {
  if (isExternalUrl(key)) return true
  try {
    const row = await db.prepare('SELECT 1 AS found FROM Media_Storage WHERE file_key = ? LIMIT 1').bind(key).first()
    return Boolean(row)
  } catch {
    return false
  }
}

async function deleteStoredMedia(db: D1Database, key: string | null | undefined): Promise<void> {
  if (!key || isExternalUrl(key)) return
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

export const portfolioRouter = new Hono<{ Bindings: Bindings }>()

// GET: Public gallery, optionally narrowed to one site section and/or category
portfolioRouter.get('/', async (c) => {
  try {
    await ensurePortfolioSchema(c.env.DB)

    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 100))
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)
    const category = (c.req.query('category') || '').trim()
    const rawSection = c.req.query('section')

    const where: string[] = ['is_active = 1']
    const params: (string | number)[] = []

    if (rawSection !== undefined && rawSection.trim() !== '') {
      const section = parseSection(rawSection)
      if (!section) {
        return c.json(validationError(`Unknown section. Use one of: ${PORTFOLIO_SECTIONS.join(', ')}.`, 'section'), 400)
      }
      where.push('section = ?')
      params.push(section)
    }

    if (category && category.toLowerCase() !== 'all') {
      if (category.toLowerCase() === 'hero') {
        // Hero slides predate sections, so keep honouring the legacy category/featured flags too
        where.push("(LOWER(category) = 'hero' OR is_featured = 1 OR section = 'hero')")
      } else {
        where.push('LOWER(category) = LOWER(?)')
        params.push(category)
      }
    }

    const queryRes = await c.env.DB.prepare(
      `SELECT ${SELECT_COLUMNS} FROM Portfolio_Images WHERE ${where.join(' AND ')} ORDER BY display_order ASC, id ASC LIMIT ? OFFSET ?`
    ).bind(...params, limit, offset).all<any>()

    const mapped = (queryRes.results || []).map(withUrls)

    // Admin edits must show up on the next page load, so never let browsers or CDNs cache this list
    c.header('Cache-Control', 'no-store')
    return c.json({ images: mapped, limit, offset, status: 'success', data: mapped })
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
    const { r2_object_key, category = 'All', is_featured = false } = body

    if (!isValidObjectKey(r2_object_key)) {
      return c.json(validationError('A valid r2_object_key (1-1024 characters, no path traversal) is required.', 'r2_object_key'), 400)
    }
    const cleanKey = r2_object_key.trim()

    const section = body.section === undefined ? 'gallery' : parseSection(body.section)
    if (!section) {
      return c.json(validationError(`Unknown section. Use one of: ${PORTFOLIO_SECTIONS.join(', ')}.`, 'section'), 400)
    }

    if (!(await mediaExists(c.env.DB, cleanKey))) {
      return c.json(validationError('The uploaded image could not be found. Please upload it again.', 'r2_object_key'), 400)
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
      'INSERT INTO Portfolio_Images (r2_object_key, section, category, title, alt_text, display_order, is_featured) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(cleanKey, section, String(category), title, altText, displayOrder, featured).run()

    const record = withUrls({
      id: result.meta.last_row_id,
      r2_object_key: cleanKey,
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

    const statements = orderMappings.map((item: any, idx: number) => {
      const id = item.id !== undefined ? item.id : item
      const displayOrder = item.display_order !== undefined ? item.display_order : idx
      return c.env.DB.prepare('UPDATE Portfolio_Images SET display_order = ? WHERE id = ?').bind(displayOrder, id)
    })

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
    let objectKey = existing.r2_object_key
    if (body.r2_object_key !== undefined && body.r2_object_key !== existing.r2_object_key) {
      if (!isValidObjectKey(body.r2_object_key)) {
        return c.json(validationError('A valid r2_object_key (1-1024 characters, no path traversal) is required.', 'r2_object_key'), 400)
      }
      objectKey = body.r2_object_key.trim()
      if (!(await mediaExists(c.env.DB, objectKey))) {
        return c.json(validationError('The uploaded image could not be found. Please upload it again.', 'r2_object_key'), 400)
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
      'UPDATE Portfolio_Images SET r2_object_key = ?, section = ?, category = ?, title = ?, alt_text = ?, is_active = ?, is_featured = ?, display_order = ? WHERE id = ?'
    ).bind(objectKey, section, category, title, alt_text, is_active, is_featured, display_order, id).run()

    // The old file is no longer referenced by anything once it has been swapped out
    if (objectKey !== existing.r2_object_key) {
      await deleteStoredMedia(c.env.DB, existing.r2_object_key)
    }

    return c.json({
      success: true,
      status: 'success',
      data: withUrls({
        id: Number(id),
        r2_object_key: objectKey,
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
      'SELECT id, r2_object_key FROM Portfolio_Images WHERE id = ?'
    ).bind(id).first<{ id: number; r2_object_key: string }>()

    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Image record not found.', details: [] } }, 404)
    }

    await c.env.DB.prepare('DELETE FROM Portfolio_Images WHERE id = ?').bind(id).run()
    await deleteStoredMedia(c.env.DB, existing.r2_object_key)

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
