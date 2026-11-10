import { Hono } from 'hono'
import type { Bindings } from '../index.ts'
import { getTrustedClientIp, hasForbiddenPaymentFields } from '../middleware/auth.ts'

// Email RFC 5322 regex supporting common TLDs and internationalized local parts
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/
// Phone: 7-25 chars with 7-15 digits
const PHONE_CHARS_REGEX = /^[\d+()\s-]{7,25}$/
const MAX_MESSAGE_LENGTH = 5000
const MAX_NAME_LENGTH = 200
const MAX_EMAIL_LENGTH = 254
const MAX_BODY_BYTES = 10240 // 10KB payload limit

export const VALID_SESSION_TYPES = [
  'Portrait',
  'Grad Pics',
  'Branding Pics',
  'Event',
  'Business package',
  'Brand',
  'Creative',
  'Other'
]

// Strip dangerous control characters (\x00-\x08, \x0B, \x0C, \x0E-\x1F) but preserve newlines (\r\n, \n) and tabs (\t)
export function sanitizeText(str: string): string {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
}

// Bounded in-memory idempotency cache (TTL: 60 seconds, max 1000 items)
interface IdempotentEntry {
  id: number
  expiresAt: number
}
const idempotencyMap = new Map<string, IdempotentEntry>()
const IDEMPOTENCY_TTL_MS = 60 * 1000
const MAX_IDEMPOTENCY_ENTRIES = 1000

function pruneIdempotencyMap(now: number) {
  for (const [k, v] of idempotencyMap.entries()) {
    if (now > v.expiresAt) idempotencyMap.delete(k)
  }
}

export function getIdempotencyResult(key: string): number | null {
  const now = Date.now()
  pruneIdempotencyMap(now)
  const entry = idempotencyMap.get(key)
  if (entry && now <= entry.expiresAt) {
    return entry.id
  }
  return null
}

export function recordIdempotencyResult(key: string, id: number) {
  const now = Date.now()
  pruneIdempotencyMap(now)
  if (idempotencyMap.size >= MAX_IDEMPOTENCY_ENTRIES) {
    const oldest = idempotencyMap.keys().next().value
    if (oldest) idempotencyMap.delete(oldest)
  }
  idempotencyMap.set(key, { id, expiresAt: now + IDEMPOTENCY_TTL_MS })
}

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
    const clientIp = getTrustedClientIp(c)
    if (!checkContactRateLimit(clientIp)) {
      c.header('Retry-After', '60')
      return c.json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many messages sent. Please wait a minute before trying again.',
          details: []
        }
      }, 429)
    }

    const contentLength = c.req.header('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      return c.json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request payload exceeds 10KB limit.',
          target: 'contact_form',
          details: []
        }
      }, 413)
    }

    const rawBodyText = await c.req.text()
    if (rawBodyText.length > MAX_BODY_BYTES) {
      return c.json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request payload exceeds 10KB limit.',
          target: 'contact_form',
          details: []
        }
      }, 413)
    }

    let body: any
    try {
      body = JSON.parse(rawBodyText)
    } catch {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Malformed JSON payload.',
          target: 'contact_form',
          details: []
        }
      }, 400)
    }

    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account details are prohibited.',
          target: 'contact_form',
          details: []
        }
      }, 400)
    }

    const idempotencyHeader = c.req.header('Idempotency-Key')?.trim() || body.idempotency_key?.trim() || body.idempotencyKey?.trim()

    // Accept composite name or split firstName/lastName
    const combinedName = body.name ?? (body.firstName || body.lastName ? `${body.firstName || ''} ${body.lastName || ''}` : '')
    const rawName = typeof combinedName === 'string' ? sanitizeText(combinedName).trim() : ''
    const rawEmail = typeof body.email === 'string' ? sanitizeText(body.email).trim().toLowerCase() : ''
    const rawPhone = typeof body.phone === 'string' ? sanitizeText(body.phone).trim() : ''
    const rawSessionType = typeof body.session_type === 'string'
      ? sanitizeText(body.session_type).trim()
      : (typeof body.sessionType === 'string' ? sanitizeText(body.sessionType).trim() : null)
    const rawMessage = typeof body.message === 'string'
      ? sanitizeText(body.message).trim()
      : (typeof body.notes === 'string' ? sanitizeText(body.notes).trim() : '')

    // Check Idempotency deduplication
    const dedupKey = idempotencyHeader || `${clientIp}:${rawEmail}:${rawSessionType || ''}:${rawMessage.slice(0, 100)}`
    const existingId = getIdempotencyResult(dedupKey)
    if (existingId !== null) {
      return c.json({ success: true, status: 'success', id: existingId, data: { id: existingId } })
    }

    const errors = []
    if (!rawName) {
      errors.push({ field: 'name', message: 'Name is required.', code: 'REQUIRED_FIELD' })
    } else if (rawName.length > MAX_NAME_LENGTH) {
      errors.push({ field: 'name', message: `Name must be under ${MAX_NAME_LENGTH} characters.`, code: 'TOO_LONG' })
    }

    if (!rawEmail) {
      errors.push({ field: 'email', message: 'Email is required.', code: 'REQUIRED_FIELD' })
    } else if (rawEmail.length > MAX_EMAIL_LENGTH) {
      errors.push({ field: 'email', message: `Email must be under ${MAX_EMAIL_LENGTH} characters.`, code: 'TOO_LONG' })
    } else if (!EMAIL_REGEX.test(rawEmail)) {
      errors.push({ field: 'email', message: 'Please enter a valid email address.', code: 'INVALID_FORMAT' })
    }

    if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
      const digitsCount = (rawPhone.match(/\d/g) || []).length
      if (typeof body.phone !== 'string' || !PHONE_CHARS_REGEX.test(rawPhone) || digitsCount < 7 || digitsCount > 15) {
        errors.push({ field: 'phone', message: 'Please enter a valid phone number (7-25 characters with 7-15 digits).', code: 'INVALID_FORMAT' })
      }
    }

    if (rawSessionType) {
      if (rawSessionType.length > 100) {
        errors.push({ field: 'session_type', message: 'Session type must be under 100 characters.', code: 'TOO_LONG' })
      } else if (!VALID_SESSION_TYPES.includes(rawSessionType)) {
        // Allow dynamic strings matching catalog packages or safe printable names
        if (!/^[a-zA-Z0-9\s.,'()&/-]{1,100}$/.test(rawSessionType)) {
          errors.push({
            field: 'session_type',
            message: `Invalid session type. Must be one of: ${VALID_SESSION_TYPES.join(', ')} or a valid catalog package.`,
            code: 'INVALID_VALUE'
          })
        }
      }
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

    const insertRes = await c.env.DB.prepare(
      'INSERT INTO Leads (name, email, phone, session_type, message) VALUES (?, ?, ?, ?, ?)'
    ).bind(rawName, rawEmail, rawPhone || null, rawSessionType || null, rawMessage).run()

    const newId = insertRes.meta?.last_row_id || 0
    if (newId) {
      recordIdempotencyResult(dedupKey, newId)
    }

    return c.json({ success: true, status: 'success', id: newId, data: { id: newId } })
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
