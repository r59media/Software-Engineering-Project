import { Hono, type Context } from 'hono'
import type { Bindings } from '../index.ts'
import { getTrustedClientIp, hasForbiddenPaymentFields } from '../middleware/auth.ts'
import { enforceRouteRateLimit } from '../middleware/rateLimit.ts'
import { LEADS_TABLE_SQL, LEADS_CREATED_INDEX_SQL } from '../lib/billingSchema.ts'
import { sendNewLeadNotificationEmail } from '../email.ts'

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

const CONTACT_RATE_WINDOW_SECONDS = 60
const CONTACT_RATE_MAX_REQUESTS = 5
const utf8Encoder = new TextEncoder()

export interface ValidatedLeadPayload {
  name: string
  email: string
  phone: string
  sessionType: string | null
  message: string
  dedupKey: string
}

type LeadParseOutcome =
  | { kind: 'ok'; lead: ValidatedLeadPayload; body: Record<string, any> }
  | { kind: 'honeypot' }
  | { kind: 'idempotent'; id: number }
  | { kind: 'error'; response: Response }

function contactError(
  c: Context,
  status: 400 | 403 | 413,
  code: string,
  message: string,
  details: Array<{ field: string; message: string; code: string }> = []
): Response {
  return c.json({
    error: { code, message, target: 'contact_form', details }
  }, status)
}

function validateLeadFields(
  body: Record<string, any>,
  rawName: string,
  rawEmail: string,
  rawPhone: string,
  rawSessionType: string | null,
  rawMessage: string
) {
  const errors: Array<{ field: string; message: string; code: string }> = []
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
    } else if (!VALID_SESSION_TYPES.includes(rawSessionType) && !/^[a-zA-Z0-9\s.,'()&/-]{1,100}$/.test(rawSessionType)) {
      errors.push({
        field: 'session_type',
        message: `Invalid session type. Must be one of: ${VALID_SESSION_TYPES.join(', ')} or a valid catalog package.`,
        code: 'INVALID_VALUE'
      })
    }
  }

  if (!rawMessage) {
    errors.push({ field: 'message', message: 'Message is required.', code: 'REQUIRED_FIELD' })
  } else if (rawMessage.length > MAX_MESSAGE_LENGTH) {
    errors.push({ field: 'message', message: `Message must be under ${MAX_MESSAGE_LENGTH} characters.`, code: 'TOO_LONG' })
  }

  return errors
}

export async function verifyTurnstileToken(
  c: Context<{ Bindings: Bindings }>,
  body: Record<string, any>,
  clientIp: string
): Promise<Response | null> {
  const turnstileSecret = (c.env.TURNSTILE_SECRET_KEY || '').trim()
  if (!turnstileSecret) return null

  const rawToken = body.turnstileToken ?? body['cf-turnstile-response']
  const turnstileToken = typeof rawToken === 'string' ? rawToken.trim() : ''
  if (!turnstileToken) {
    return contactError(c, 403, 'CAPTCHA_FAILED', 'Verification challenge is required.')
  }

  try {
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: turnstileSecret,
        response: turnstileToken,
        remoteip: clientIp
      }),
      signal: AbortSignal.timeout(5000)
    })
    const verifyData = (await verifyRes.json().catch(() => ({}))) as { success?: boolean }
    if (!verifyRes.ok || !verifyData.success) {
      return contactError(c, 403, 'CAPTCHA_FAILED', 'Verification challenge failed. Please try again.')
    }
    return null
  } catch {
    return contactError(c, 403, 'CAPTCHA_FAILED', 'Unable to verify challenge. Please try again.')
  }
}

export async function parseAndValidateLead(
  c: Context<{ Bindings: Bindings }>,
  clientIp: string
): Promise<LeadParseOutcome> {
  const contentLength = c.req.header('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return { kind: 'error', response: contactError(c, 413, 'PAYLOAD_TOO_LARGE', 'Request payload exceeds 10KB limit.') }
  }

  const rawBodyText = await c.req.text()
  if (utf8Encoder.encode(rawBodyText).byteLength > MAX_BODY_BYTES) {
    return { kind: 'error', response: contactError(c, 413, 'PAYLOAD_TOO_LARGE', 'Request payload exceeds 10KB limit.') }
  }

  let body: any
  try {
    body = JSON.parse(rawBodyText)
  } catch {
    return { kind: 'error', response: contactError(c, 400, 'VALIDATION_FAILED', 'Malformed JSON payload.') }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { kind: 'error', response: contactError(c, 400, 'VALIDATION_FAILED', 'Request body must be a JSON object.') }
  }
  if (hasForbiddenPaymentFields(body)) {
    return { kind: 'error', response: contactError(c, 400, 'VALIDATION_FAILED', 'Raw card or bank account details are prohibited.') }
  }

  if (
    (typeof body.website === 'string' && body.website.trim() !== '') ||
    (typeof body.company_url === 'string' && body.company_url.trim() !== '')
  ) {
    return { kind: 'honeypot' }
  }

  const turnstileErr = await verifyTurnstileToken(c, body, clientIp)
  if (turnstileErr) return { kind: 'error', response: turnstileErr }

  const idempotencyHeader = c.req.header('Idempotency-Key')?.trim() || body.idempotency_key?.trim() || body.idempotencyKey?.trim()
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

  const dedupKey = idempotencyHeader || `${clientIp}:${rawEmail}:${rawSessionType || ''}:${rawMessage.slice(0, 100)}`
  const existingId = getIdempotencyResult(dedupKey)
  if (existingId !== null) {
    return { kind: 'idempotent', id: existingId }
  }

  const errors = validateLeadFields(body, rawName, rawEmail, rawPhone, rawSessionType, rawMessage)
  if (errors.length > 0) {
    return {
      kind: 'error',
      response: contactError(c, 400, 'VALIDATION_FAILED', 'Your message could not be sent. Please correct the errors below.', errors)
    }
  }

  return {
    kind: 'ok',
    body,
    lead: { name: rawName, email: rawEmail, phone: rawPhone, sessionType: rawSessionType, message: rawMessage, dedupKey }
  }
}

export async function storeLeadAndNotify(
  c: Context<{ Bindings: Bindings }>,
  lead: ValidatedLeadPayload
): Promise<number> {
  await c.env.DB.prepare(LEADS_TABLE_SQL).run()
  await c.env.DB.prepare(LEADS_CREATED_INDEX_SQL).run().catch(() => {})

  const insertRes = await c.env.DB.prepare(
    'INSERT INTO Leads (name, email, phone, session_type, message) VALUES (?, ?, ?, ?, ?)'
  ).bind(lead.name, lead.email, lead.phone || null, lead.sessionType || null, lead.message).run()

  const newId = insertRes.meta?.last_row_id || 0
  if (newId) {
    recordIdempotencyResult(lead.dedupKey, newId)
  }

  const notifyTask = sendNewLeadNotificationEmail(c.env, {
    id: newId,
    name: lead.name,
    email: lead.email,
    phone: lead.phone || null,
    sessionType: lead.sessionType,
    message: lead.message
  })
    .then((res) => {
      if (!res.sent && res.reason !== 'not_configured' && res.reason !== 'no_admin_email') {
        console.error('[contact] Lead notification email failed:', res.reason)
      }
    })
    .catch((err) => {
      console.error('[contact] Lead notification email threw:', err)
    })
  try {
    c.executionCtx?.waitUntil(notifyTask)
  } catch {
    // Ignore when executionCtx is unavailable (e.g. unit tests)
  }

  return newId
}

export const contactRouter = new Hono<{ Bindings: Bindings }>()

contactRouter.post('/', async (c) => {
  try {
    const limited = await enforceRouteRateLimit(c, {
      prefix: 'contact',
      maxRequests: CONTACT_RATE_MAX_REQUESTS,
      windowSeconds: CONTACT_RATE_WINDOW_SECONDS,
      message: 'Too many messages sent. Please wait a minute before trying again.'
    })
    if (limited) return limited

    const clientIp = getTrustedClientIp(c)
    const parsed = await parseAndValidateLead(c, clientIp)
    if (parsed.kind === 'error') return parsed.response
    if (parsed.kind === 'honeypot') {
      return c.json({ success: true, status: 'success', id: 0, data: { id: 0 } })
    }
    if (parsed.kind === 'idempotent') {
      return c.json({ success: true, status: 'success', id: parsed.id, data: { id: parsed.id } })
    }

    const newId = await storeLeadAndNotify(c, parsed.lead)
    return c.json({ success: true, status: 'success', id: newId, data: { id: newId } })
  } catch {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while submitting your message.',
        details: []
      }
    }, 500)
  }
})
