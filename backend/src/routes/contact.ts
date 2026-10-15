import { Hono } from 'hono'
import { Bindings } from '../index'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^[\d+()\s-]{7,25}$/
const MAX_MESSAGE_LENGTH = 5000
const MAX_NAME_LENGTH = 200
const VALID_SESSION_TYPES = ['Portrait', 'Brand', 'Creative', 'Event', 'Other']

export const contactRouter = new Hono<{ Bindings: Bindings }>()

contactRouter.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { name, email, phone, session_type, message } = body

    const errors = []
    if (!name || typeof name !== 'string') {
      errors.push({ field: 'name', message: 'Name is required.', code: 'REQUIRED_FIELD' })
    } else if (name.trim().length > MAX_NAME_LENGTH) {
      errors.push({ field: 'name', message: `Name must be under ${MAX_NAME_LENGTH} characters.`, code: 'TOO_LONG' })
    }
    if (!email || typeof email !== 'string') {
      errors.push({ field: 'email', message: 'Email is required.', code: 'REQUIRED_FIELD' })
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.push({ field: 'email', message: 'Please enter a valid email address.', code: 'INVALID_FORMAT' })
    }
    if (phone) {
      if (typeof phone !== 'string' || !PHONE_REGEX.test(phone.trim())) {
        errors.push({ field: 'phone', message: 'Please enter a valid phone number (7-25 digits, +, spaces, hyphens).', code: 'INVALID_FORMAT' })
      }
    }
    if (session_type && !VALID_SESSION_TYPES.includes(session_type)) {
      errors.push({ field: 'session_type', message: `Invalid session type. Must be one of: ${VALID_SESSION_TYPES.join(', ')}`, code: 'INVALID_VALUE' })
    }
    if (!message || typeof message !== 'string') {
      errors.push({ field: 'message', message: 'Message is required.', code: 'REQUIRED_FIELD' })
    } else if (message.trim().length > MAX_MESSAGE_LENGTH) {
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
