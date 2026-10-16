import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth } from '../middleware/auth'

export const portfolioRouter = new Hono<{ Bindings: Bindings }>()

// GET: Fetch the public gallery (with optional pagination)
portfolioRouter.get('/', async (c) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 100))
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0)

    const { results } = await c.env.DB.prepare(
      'SELECT id, r2_object_key, category, alt_text, display_order, is_featured FROM Portfolio_Images WHERE is_active = 1 ORDER BY display_order ASC LIMIT ? OFFSET ?'
    ).bind(limit, offset).all()

    return c.json({ images: results, limit, offset, status: 'success', data: results })
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
    const body = await c.req.json()
    const { r2_object_key, category = 'All', alt_text = null, display_order = 0, is_featured = false } = body

    if (
      typeof r2_object_key !== 'string' ||
      r2_object_key.trim().length < 1 ||
      r2_object_key.trim().length > 1024 ||
      r2_object_key.includes('..')
    ) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'A valid r2_object_key (1-1024 characters, no path traversal) is required.',
          target: 'portfolio',
          details: [{ field: 'r2_object_key', message: 'Valid R2 Object Key is required.', code: 'INVALID_VALUE' }]
        }
      }, 400)
    }

    const cleanKey = r2_object_key.trim()
    const result = await c.env.DB.prepare(
      'INSERT INTO Portfolio_Images (r2_object_key, category, alt_text, display_order, is_featured) VALUES (?, ?, ?, ?, ?)'
    ).bind(cleanKey, category, alt_text, display_order, is_featured ? 1 : 0).run()

    return c.json({
      success: true,
      status: 'success',
      id: result.meta.last_row_id,
      data: { id: result.meta.last_row_id, r2_object_key: cleanKey, category, alt_text, display_order }
    })
  } catch (e: any) {
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
    const body = await c.req.json()
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

// PUT: Update single image metadata (admin only)
portfolioRouter.put('/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()

    const existing = await c.env.DB.prepare('SELECT * FROM Portfolio_Images WHERE id = ?').bind(id).first<any>()
    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Image record not found.', details: [] } }, 404)
    }

    const category = body.category !== undefined ? String(body.category) : existing.category
    const alt_text = body.alt_text !== undefined ? (body.alt_text === null ? null : String(body.alt_text)) : existing.alt_text
    const is_active =
      body.is_active !== undefined
        ? (body.is_active ? 1 : 0)
        : body.active !== undefined
          ? (body.active ? 1 : 0)
          : existing.is_active
    const is_featured = body.is_featured !== undefined ? (body.is_featured ? 1 : 0) : existing.is_featured
    const display_order = body.display_order !== undefined ? Number(body.display_order) : existing.display_order

    await c.env.DB.prepare(
      'UPDATE Portfolio_Images SET category = ?, alt_text = ?, is_active = ?, is_featured = ?, display_order = ? WHERE id = ?'
    ).bind(category, alt_text, is_active, is_featured, display_order, id).run()

    return c.json({
      success: true,
      status: 'success',
      data: { id: Number(id), category, alt_text, is_active, is_featured, display_order }
    })
  } catch (e: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not update portfolio image.',
        details: []
      }
    }, 500)
  }
})

// DELETE: Remove an image and clean up R2 object if bound (admin only)
portfolioRouter.delete('/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')
    const existing = await c.env.DB.prepare(
      'SELECT id, r2_object_key FROM Portfolio_Images WHERE id = ?'
    ).bind(id).first<{ id: number; r2_object_key: string }>()

    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Image record not found.', details: [] } }, 404)
    }

    await c.env.DB.prepare('DELETE FROM Portfolio_Images WHERE id = ?').bind(id).run()

    if (c.env.BUCKET && existing.r2_object_key && existing.r2_object_key.startsWith('portfolio/')) {
      await c.env.BUCKET.delete(existing.r2_object_key).catch(() => {})
    }

    return c.json({ success: true, status: 'success' })
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
