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
      'CREATE TABLE IF NOT EXISTS Admin_Settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)'
    ).run().catch(() => {})

    const sections = ['hero', 'recent', 'gallery', 'about'] as const
    const statements: any[] = []

    // 1. Update any existing /assets/ rows whose hash changed on rebuild
    for (const sec of sections) {
      const defaults = (defaultPortfolioSeed as any)[sec] || []
      for (const item of defaults) {
        statements.push(
          db.prepare(
            'UPDATE Portfolio_Images SET media_key = ? WHERE LOWER(section) = ? AND title = ? AND display_order = ? AND media_key LIKE "/assets/%" AND media_key != ?'
          ).bind(item.media_key, sec, item.title, item.display_order ?? item.order ?? 1, item.media_key)
        )
      }
    }

    // 2. Seed default images for any missing display_order / title per section
    for (const sec of sections) {
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
    ).run().catch(() => {})

    portfolioSchemaReady = true
  }

  // Ensure default portfolio seed images exist if database is fresh or missing sections
  const countRow = await db.prepare('SELECT COUNT(*) as cnt FROM Portfolio_Images WHERE is_active = 1').first<{ cnt: number }>().catch(() => null)
  if ((countRow?.cnt ?? 0) < 24) {
    await ensurePortfolioDefaults(db)
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

export const DEFAULT_PROFILE = {
  bio: "I'm the photographer behind R59—drawn to quiet frames, honest light, and the small gestures that make a portrait feel lived-in.\n\nMost of my work sits between editorial portraiture and documentary storytelling. Whether we're in a studio or chasing late-afternoon sun on location, the goal is always the same: images that still feel like you ten years from now.",
  email: "hello@r59.Portraits",
  phone: "123-456-7890",
  location: "Studio & On-Location",
  travel: true,
  social: {
    instagram: "https://www.instagram.com",
    facebook: "https://www.facebook.com",
    pinterest: "https://www.pinterest.com",
    x: "",
    tiktok: "",
    youtube: ""
  }
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

    const profile = {
      bio: (parsed?.bio && String(parsed.bio).trim()) || DEFAULT_PROFILE.bio,
      email: (parsed?.email && String(parsed.email).trim()) || DEFAULT_PROFILE.email,
      phone: (parsed?.phone && String(parsed.phone).trim()) || DEFAULT_PROFILE.phone,
      location: (parsed?.location && String(parsed.location).trim()) || DEFAULT_PROFILE.location,
      travel: parsed?.travel !== undefined ? Boolean(parsed.travel) : DEFAULT_PROFILE.travel,
      social: parsed?.social || DEFAULT_PROFILE.social
    }

    c.header('Cache-Control', 'no-store')
    return c.json({
      status: 'success',
      profile
    })
  } catch {
    return c.json({ status: 'success', profile: { ...DEFAULT_PROFILE } })
  }
})

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

    const isHeroQuery =
      category.toLowerCase() === 'hero' ||
      (rawSection !== undefined && rawSection.trim().toLowerCase() === 'hero')

    if (isHeroQuery) {
      where.push("(LOWER(category) = 'hero' OR is_featured = 1 OR LOWER(section) = 'hero')")
    } else {
      if (rawSection !== undefined && rawSection.trim() !== '') {
        const section = parseSection(rawSection)
        if (!section) {
          return c.json(validationError(`Unknown section. Use one of: ${PORTFOLIO_SECTIONS.join(', ')}.`, 'section'), 400)
        }
        where.push('section = ?')
        params.push(section)
      }

      if (category && category.toLowerCase() !== 'all') {
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
