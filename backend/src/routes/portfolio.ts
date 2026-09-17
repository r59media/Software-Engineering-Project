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
      'SELECT id, r2_object_key, category, alt_text, display_order FROM Portfolio_Images WHERE is_active = 1 ORDER BY display_order ASC LIMIT ? OFFSET ?'
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
    const { r2_object_key, category = 'All', alt_text = null, display_order = 0 } = body

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

    await c.env.DB.prepare(
      'INSERT INTO Portfolio_Images (r2_object_key, category, alt_text, display_order) VALUES (?, ?, ?, ?)'
    ).bind(r2_object_key, category, alt_text, display_order).run()

    return c.json({ success: true })
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
