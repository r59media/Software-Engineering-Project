import { Hono } from 'hono'
import { Bindings } from '../index'

export const contactRouter = new Hono<{ Bindings: Bindings }>()

contactRouter.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { name, email, message } = body

    const errors = []
    if (!name) errors.push({ field: 'name', message: 'Name is required.', code: 'REQUIRED_FIELD' })
    if (!email) errors.push({ field: 'email', message: 'Email address is required.', code: 'REQUIRED_FIELD' })
    if (!message) errors.push({ field: 'message', message: 'Message is required.', code: 'REQUIRED_FIELD' })

    if (errors.length > 0) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: `Your message could not be sent. Please correct the ${errors.length} error(s) below.`,
          target: 'contact_form',
          details: errors
        }
      }, 400)
    }

    await c.env.DB.prepare(
      'INSERT INTO Leads (name, email, message) VALUES (?, ?, ?)'
    ).bind(name, email, message).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while submitting your message.',
        details: []
      }
    }, 500)
  }
})
