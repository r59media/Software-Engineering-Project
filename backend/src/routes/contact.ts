import { Hono } from 'hono'
import { Bindings } from '../index'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^[\d+()\s-]{7,25}$/
const MAX_MESSAGE_LENGTH = 5000
const MAX_NAME_LENGTH = 200
const VALID_SESSION_TYPES = ['Portrait', 'Brand', 'Creative', 'Event', 'Other']

// Per-IP rate limiter for contact submissions (max 5 requests/minute, bounded at 1000 entries)
const MAX_CONTACT_IPS = 1000
const CONTACT_WINDOW_MS = 60 * 1000
const MAX_CONTACT_REQUESTS = 5
const contactRateMap = new Map<string, { count: number; resetAt: number }>()

function checkContactRateLimit(ip: string): boolean {
  const now = Date.now()
  for (const [k, v] of contactRateMap.entries()) {
    if (now > v.resetAt) contactRateMap.delete(k)
  }
  const entry = contactRateMap.get(ip)
  if (!entry || now > entry.resetAt) {
    if (contactRateMap.size >= MAX_CONTACT_IPS) {
      const oldest = contactRateMap.keys().next().value
      if (oldest) contactRateMap.delete(oldest)
    }
    contactRateMap.set(ip, { count: 1, resetAt: now + CONTACT_WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_CONTACT_REQUESTS) {
    return false
  }
  entry.count++
  return true
}

export const contactRouter = new Hono<{ Bindings: Bindings }>()

contactRouter.post('/', async (c) => {
  try {
    const clientIp = c.req.header('cf-connecting-ip') || 'unknown'
    if (!checkContactRateLimit(clientIp)) {
      return c.json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many messages sent. Please wait a minute before trying again.',
          details: []
        }
      }, 429)
    }

    const body = await c.req.json()
    const rawName = typeof body.name === 'string' ? body.name.trim() : ''
    const rawEmail = typeof body.email === 'string' ? body.email.trim() : ''
    const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : ''
    const session_type = body.session_type
    const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''

    const errors = []
    if (!rawName) {
      errors.push({ field: 'name', message: 'Name is required.', code: 'REQUIRED_FIELD' })
    } else if (rawName.length > MAX_NAME_LENGTH) {
      errors.push({ field: 'name', message: `Name must be under ${MAX_NAME_LENGTH} characters.`, code: 'TOO_LONG' })
    }
    if (!rawEmail) {
      errors.push({ field: 'email', message: 'Email is required.', code: 'REQUIRED_FIELD' })
    } else if (!EMAIL_REGEX.test(rawEmail)) {
      errors.push({ field: 'email', message: 'Please enter a valid email address.', code: 'INVALID_FORMAT' })
    }
    if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
      if (typeof body.phone !== 'string' || !PHONE_REGEX.test(rawPhone)) {
        errors.push({ field: 'phone', message: 'Please enter a valid phone number (7-25 digits, +, spaces, hyphens).', code: 'INVALID_FORMAT' })
      }
    }
    if (session_type && !VALID_SESSION_TYPES.includes(session_type)) {
      errors.push({ field: 'session_type', message: `Invalid session type. Must be one of: ${VALID_SESSION_TYPES.join(', ')}`, code: 'INVALID_VALUE' })
    }
    if (!rawMessage) {
      errors.push({ field: 'message', message: 'Message is required.', code: 'REQUIRED_FIELD' })
    } else if (rawMessage.length > MAX_MESSAGE_LENGTH) {
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
    ).bind(rawName, rawEmail, rawPhone || null, session_type || null, rawMessage).run()

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
