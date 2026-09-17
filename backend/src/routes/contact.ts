import { Hono } from 'hono'
import { Bindings } from '../index'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_MESSAGE_LENGTH = 5000
const MAX_NAME_LENGTH = 200

export const contactRouter = new Hono<{ Bindings: Bindings }>()

contactRouter.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { name, email, phone, session_type, message } = body

    const errors = []
    if (!name) {
      errors.push({ field: 'name', message: 'Name is required.', code: 'REQUIRED_FIELD' })
    } else if (name.length > MAX_NAME_LENGTH) {
      errors.push({ field: 'name', message: `Name must be under ${MAX_NAME_LENGTH} characters.`, code: 'TOO_LONG' })
    }
    if (!email) {
      errors.push({ field: 'email', message: 'Email is required.', code: 'REQUIRED_FIELD' })
    } else if (!EMAIL_REGEX.test(email)) {
      errors.push({ field: 'email', message: 'Please enter a valid email address.', code: 'INVALID_FORMAT' })
    }
    if (!message) {
      errors.push({ field: 'message', message: 'Message is required.', code: 'REQUIRED_FIELD' })
    } else if (message.length > MAX_MESSAGE_LENGTH) {
      errors.push({ field: 'message', message: `Message must be under ${MAX_MESSAGE_LENGTH} characters.`, code: 'TOO_LONG' })
    }

    if (errors.length > 0) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Your message could not be sent. Please correct the errors below.',
          target: 'contact_form',
          details: errors
        }
      }, 400)
    }

    await c.env.DB.prepare(
      'INSERT INTO Leads (name, email, phone, session_type, message) VALUES (?, ?, ?, ?, ?)'
    ).bind(name, email, phone || null, session_type || null, message).run()

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
