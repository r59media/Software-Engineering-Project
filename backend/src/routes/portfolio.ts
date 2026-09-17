import { Hono } from 'hono'
import { Bindings } from '../index'

export const portfolioRouter = new Hono<{ Bindings: Bindings }>()

// GET: Fetch the public gallery
portfolioRouter.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, r2_object_key, category, alt_text, display_order FROM Portfolio_Images WHERE is_active = 1 ORDER BY display_order ASC'
    ).all()
    
    return c.json({ images: results })
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

// POST: Save a new image record
portfolioRouter.post('/', async (c) => {
  try {
    const auth = c.req.header('Authorization')
    if (!auth || auth !== `Bearer ${c.env.ADMIN_SECRET}`) {
      return c.json({ error: 'Unauthorized. Admin access required.' }, 401)
    }

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
