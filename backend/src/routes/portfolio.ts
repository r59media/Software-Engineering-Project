import { Hono } from 'hono'
import type { Bindings } from '../index'
import { adminAuth, hasForbiddenPaymentFields } from '../middleware/auth'
import { isValidId, parseJsonObject } from '../utils/validation'
import defaultPortfolioSeed from '../defaultPortfolioSeed.json'
import { bumpPublicContentVersion, getPublicContentVersion, withPublicEdgeCache, withPublicJsonCache } from '../lib/edgeCache'
import { runOncePerDb } from '../lib/billingSchema'

// Which part of the public site a photo belongs to (one per admin "Photos" tab, plus hero)
export const PORTFOLIO_SECTIONS = ['recent', 'gallery', 'about', 'hero'] as const
export type PortfolioSection = (typeof PORTFOLIO_SECTIONS)[number]
export const VALID_SECTIONS = new Set(['recent', 'gallery', 'about', 'hero'])

const SELECT_COLUMNS =
  'id, media_key, section, category, title, alt_text, display_order, is_featured, is_active'

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

export function resolveMediaUrl(key: string, version?: string): string {
  if (!key) return ''
  const resolved =
    key.startsWith('https://') || key.startsWith('http://') || key.startsWith('/') || key.startsWith('data:image/')
      ? key
      : `/api/media/${key.replace(/^\/+/, '')}`

  if (version && resolved.startsWith('/api/media/') && !/[?&](?:v|exp|sig)=/.test(resolved)) {
    const sep = resolved.includes('?') ? '&' : '?'
    return `${resolved}${sep}v=${encodeURIComponent(version)}`
  }
  return resolved
}

function withUrls<T extends { media_key: string }>(row: T, mediaVersion?: string) {
  const url = resolveMediaUrl(row.media_key, mediaVersion)
  return { ...row, url, public_url: url }
}

function buildPortfolioSeedStatements(
  db: D1Database,
  sections: readonly PortfolioSection[],
  seededFlags: Set<string>,
  existingCounts: Map<string, number>
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = []

  for (const sec of sections) {
    const defaults = (defaultPortfolioSeed as any)[sec] || []
    for (const item of defaults) {
      statements.push(
        db.prepare(
          "UPDATE Portfolio_Images SET media_key = ? WHERE LOWER(section) = ? AND title = ? AND display_order = ? AND media_key LIKE '/assets/%' AND media_key != ?"
        ).bind(item.media_key, sec, item.title, item.display_order ?? item.order ?? 1, item.media_key)
      )
    }

    const flagKey = `portfolio_seeded_${sec}`
    const count = existingCounts.get(sec) ?? 0
    if (count > 0 && seededFlags.has(flagKey)) continue

    statements.push(
      db.prepare(
        "INSERT INTO Admin_Settings (setting_key, setting_value) VALUES (?, 'true') ON CONFLICT(setting_key) DO NOTHING"
      ).bind(flagKey)
    )
    if (count > 0) continue

    for (const item of defaults) {
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

  return statements
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

    await db.prepare(
      'CREATE TABLE IF NOT EXISTS Portfolio_Images (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'media_key TEXT NOT NULL, ' +
      "section TEXT NOT NULL DEFAULT 'gallery', " +
      'category TEXT NOT NULL, ' +
      'title TEXT, ' +
      'alt_text TEXT, ' +
      'display_order INTEGER NOT NULL, ' +
      'is_featured INTEGER DEFAULT 0, ' +
      'is_active INTEGER DEFAULT 1, ' +
      'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
      ')'
    ).run().catch(() => {})

    const flagRows = await db.prepare(
      "SELECT setting_key FROM Admin_Settings WHERE setting_key LIKE 'portfolio_seeded_%'"
    ).all<{ setting_key: string }>().catch(() => ({ results: [] as { setting_key: string }[] }))
    const seededFlags = new Set((flagRows.results || []).map(row => row.setting_key))

    const countRows = await db.prepare(
      'SELECT LOWER(section) AS section, COUNT(*) AS cnt FROM Portfolio_Images GROUP BY LOWER(section)'
    ).all<{ section: string; cnt: number }>().catch(() => ({ results: [] as { section: string; cnt: number }[] }))
    const existingCounts = new Map((countRows.results || []).map(row => [row.section, Number(row.cnt) || 0]))

    const statements = buildPortfolioSeedStatements(db, PORTFOLIO_SECTIONS, seededFlags, existingCounts)
    if (statements.length > 0) {
      await db.batch(statements)
    }
  } catch (err) {
    console.error('ensurePortfolioDefaults warning:', err)
  }
}

const portfolioSchemaByDb = new WeakMap<object, Promise<void>>()

/**
 * Older databases were created before photos were tagged with a site section and title.
 * Add those columns on first use so existing local and remote D1 databases keep working
 * without a manual migration. Runs once per D1Database instance.
 */
async function runPortfolioSchemaMigration(targetDb: D1Database): Promise<void> {
  const info = await targetDb.prepare('PRAGMA table_info(Portfolio_Images)').all<{ name: string }>().catch(() => ({ results: [] }))
  const columns = new Set((info.results || []).map(col => col.name))

  const migrations: string[] = []
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
    await targetDb.prepare(sql).run().catch(err => {
      const message = String(err?.message || err)
      if (!message.includes('duplicate column') && !message.includes('no such column')) throw err
    })
  }
  await targetDb.prepare(
    'CREATE INDEX IF NOT EXISTS idx_portfolio_section_order ON Portfolio_Images(is_active, section, display_order)'
  ).run().catch(() => {})

  await ensurePortfolioDefaults(targetDb)
}

export async function ensurePortfolioSchema(db: D1Database): Promise<void> {
  return runOncePerDb(portfolioSchemaByDb, db, runPortfolioSchemaMigration)
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

export async function deleteStoredMedia(db: D1Database, key: string | null | undefined): Promise<void> {
  if (!key || isExternalUrl(key) || key.startsWith('/assets/')) return
  await db.prepare('DELETE FROM Media_Storage WHERE file_key IN (?, ?, ?)').bind(
    key,
    `${key}__w640`,
    `${key}__w1280`
  ).run().catch(() => {})
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
  email: "hello@r59media.com",
  phone: "(123) 456-7890",
  location: "Studio & On-Location (Worldwide)",
  travel: "Studio & On-Location (Worldwide)",
  social: [
    { platform: "Instagram", url: "https://www.instagram.com/r59media" },
    { platform: "Facebook", url: "https://www.facebook.com/r59media" },
    { platform: "Pinterest", url: "https://www.pinterest.com/r59media" }
  ]
}

export interface StudioProfile {
  bio: string
  email: string
  phone: string
  location: string
  travel: string
  social: { platform: string; url: string }[]
}

function normalizeSocialList(rawSocial: unknown): { platform: string; url: string }[] {
  if (Array.isArray(rawSocial)) return rawSocial
  if (rawSocial && typeof rawSocial === 'object') {
    return Object.entries(rawSocial as Record<string, unknown>)
      .filter(([_, url]) => Boolean(url))
      .map(([platform, url]) => ({
        platform: platform.charAt(0).toUpperCase() + platform.slice(1),
        url: String(url)
      }))
  }
  return []
}

/**
 * Reads the studio profile from Admin_Settings, preserving admin-saved fields as-is
 * and falling back to DEFAULT_PROFILE only when no saved profile exists or JSON is invalid.
 */
export async function getStudioProfile(db: D1Database | undefined): Promise<StudioProfile> {
  if (!db) return DEFAULT_PROFILE
  const row = await db
    .prepare("SELECT setting_value FROM Admin_Settings WHERE setting_key = 'profile'")
    .first<{ setting_value: string }>()
    .catch(() => null)

  if (!row || row.setting_value === null || row.setting_value === undefined) {
    return DEFAULT_PROFILE
  }

  let parsed: any = null
  try {
    parsed = JSON.parse(row.setting_value)
  } catch {
    return DEFAULT_PROFILE
  }

  if (!parsed || typeof parsed !== 'object') {
    return DEFAULT_PROFILE
  }

  const text = (value: unknown): string =>
    value === undefined || value === null ? '' : String(value)

  return {
    bio: text(parsed.bio),
    email: text(parsed.email),
    phone: text(parsed.phone),
    location: text(parsed.location),
    travel: text(parsed.travel),
    social: normalizeSocialList(parsed.social)
  }
}

export const portfolioRouter = new Hono<{ Bindings: Bindings }>()

// GET: Public studio profile information
portfolioRouter.get('/profile', (c) =>
  withPublicJsonCache(
    c,
    async () => {
      const profile = await getStudioProfile(c.env.DB)
      return { status: 'success', profile, data: profile }
    },
    () => ({ status: 'success', profile: DEFAULT_PROFILE, data: DEFAULT_PROFILE })
  )
)

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
  { includeInactive = false, mediaVersion }: { includeInactive?: boolean; mediaVersion?: string } = {}
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

  const resolvedVersion = !includeInactive ? (mediaVersion ?? await getPublicContentVersion(db)) : undefined
  const images = (queryRes.results || []).map((row: any) => withUrls({ ...row, is_active: row.is_active ? 1 : 0 }, resolvedVersion))
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

export async function updatePortfolioRecord(
  db: D1Database,
  id: string,
  body: Record<string, any>,
  options: { verifyMediaExists?: boolean } = {}
): Promise<
  | { ok: true; data: any }
  | { ok: false; status: 400 | 404 | 409; body: Record<string, unknown> }
> {
  await ensurePortfolioSchema(db)

  const existing = await db.prepare(`SELECT ${SELECT_COLUMNS} FROM Portfolio_Images WHERE id = ?`).bind(id).first<any>()
  if (!existing) {
    return { ok: false, status: 404, body: { error: { code: 'NOT_FOUND', message: 'Image record not found.', details: [] } } }
  }

  let section = existing.section || 'gallery'
  if (body.section !== undefined) {
    const parsed = parseSection(body.section)
    if (!parsed) {
      return {
        ok: false,
        status: 400,
        body: validationError(`Unknown section. Use one of: ${PORTFOLIO_SECTIONS.join(', ')}.`, 'section')
      }
    }
    section = parsed
  }

  let objectKey = existing.media_key
  if (body.media_key !== undefined && body.media_key !== existing.media_key) {
    if (!isValidObjectKey(body.media_key)) {
      if (options.verifyMediaExists !== false) {
        return {
          ok: false,
          status: 400,
          body: validationError('A valid media_key (1-1024 characters, no path traversal) is required.', 'media_key')
        }
      }
    } else {
      const trimmedKey = body.media_key.trim()
      if (options.verifyMediaExists !== false && !(await mediaExists(db, trimmedKey))) {
        return {
          ok: false,
          status: 400,
          body: validationError('The uploaded image could not be found. Please upload it again.', 'media_key')
        }
      }
      objectKey = trimmedKey
    }
  }

  let display_order = existing.display_order
  if (body.display_order !== undefined) {
    const parsedOrder = Number(body.display_order)
    if (!Number.isFinite(parsedOrder)) {
      if (options.verifyMediaExists === false) {
        return {
          ok: false,
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'display_order must be a finite number.',
              details: [{ field: 'display_order', message: 'Must be a finite number.', code: 'INVALID_VALUE' }]
            }
          }
        }
      }
    } else {
      display_order = options.verifyMediaExists === false ? Math.round(parsedOrder) : parsedOrder
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

  await db.prepare(
    'UPDATE Portfolio_Images SET media_key = ?, section = ?, category = ?, title = ?, alt_text = ?, is_active = ?, is_featured = ?, display_order = ? WHERE id = ?'
  ).bind(objectKey, section, category, title, alt_text, is_active, is_featured, display_order, id).run()

  if (objectKey !== existing.media_key) {
    await deleteStoredMedia(db, existing.media_key)
  }

  await bumpPublicContentVersion(db)

  return {
    ok: true,
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
  }
}

export async function deletePortfolioRecord(
  db: D1Database,
  id: string
): Promise<{ ok: true } | { ok: false; status: 404; body: Record<string, unknown> }> {
  const existing = await db.prepare(
    'SELECT id, media_key FROM Portfolio_Images WHERE id = ?'
  ).bind(id).first<{ id: number; media_key: string }>()

  if (!existing) {
    return { ok: false, status: 404, body: { error: { code: 'NOT_FOUND', message: 'Image record not found.', details: [] } } }
  }

  await db.prepare('DELETE FROM Portfolio_Images WHERE id = ?').bind(id).run()
  await deleteStoredMedia(db, existing.media_key)
  await bumpPublicContentVersion(db)

  return { ok: true }
}

// GET: Public gallery, optionally narrowed to one site section and/or category
portfolioRouter.get('/', async (c) => {
  return withPublicEdgeCache(c, async ({ cacheControl, version }) => {
    try {
      const result = await listPortfolio(c.env.DB, portfolioListQuery(c.req), { mediaVersion: version })
      if (!result.ok) {
        c.header('Cache-Control', 'no-store')
        return { cacheable: false, response: c.json(result.body, result.status) }
      }

      c.header('Cache-Control', cacheControl)
      return { response: c.json(result.body) }
    } catch {
      c.header('Cache-Control', 'no-store')
      return {
        cacheable: false,
        response: c.json({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Could not fetch portfolio images.',
            details: []
          }
        }, 500)
      }
    }
  })
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

    await bumpPublicContentVersion(c.env.DB)

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

    await bumpPublicContentVersion(c.env.DB)

    return c.json({ success: true, status: 'success' })
  } catch {
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

    const result = await updatePortfolioRecord(c.env.DB, id, body, { verifyMediaExists: true })
    if (!result.ok) return c.json(result.body, result.status)

    return c.json({ success: true, status: 'success', data: result.data })
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
    const result = await deletePortfolioRecord(c.env.DB, id)
    if (!result.ok) return c.json(result.body, result.status)

    return c.json({ success: true, status: 'success', data: { id: Number(id), deleted: true } })
  } catch {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not delete portfolio image.',
        details: []
      }
    }, 500)
  }
})
