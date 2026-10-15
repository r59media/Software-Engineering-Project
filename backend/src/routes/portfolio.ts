import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth } from '../middleware/auth'

export const portfolioRouter = new Hono<{ Bindings: Bindings }>()

// GET: Fetch the public gallery (with optional pagination)
portfolioRouter.get('/', async (c) => {
  try {
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100)
    const offset = parseInt(c.req.query('offset') || '0', 10)

    const { results } = await c.env.DB.prepare(
      'SELECT id, r2_object_key, category, alt_text, display_order, is_featured FROM Portfolio_Images WHERE is_active = 1 ORDER BY display_order ASC LIMIT ? OFFSET ?'
    ).bind(limit, offset).all()
    
    return c.json({ images: results, limit, offset })
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

    if (!r2_object_key) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Cannot save image record without an object key.',
          target: 'portfolio',
          details: [{ field: 'r2_object_key', message: 'R2 Object Key is required.', code: 'REQUIRED_FIELD' }]
        }
      }, 400)
    }

    const result = await c.env.DB.prepare(
      'INSERT INTO Portfolio_Images (r2_object_key, category, alt_text, display_order, is_featured) VALUES (?, ?, ?, ?, ?)'
    ).bind(r2_object_key, category, alt_text, display_order, is_featured ? 1 : 0).run()

    return c.json({ success: true, id: result.meta.last_row_id })
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

    return c.json({ success: true })
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

// DELETE: Remove an image (admin only)
portfolioRouter.delete('/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')
    const result = await c.env.DB.prepare(
      'DELETE FROM Portfolio_Images WHERE id = ?'
    ).bind(id).run()

    if (result.meta.changes === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Image record not found.', details: [] } }, 404)
    }

    return c.json({ success: true })
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
