import { Hono } from 'hono'
import type { Context } from 'hono'
import type { Bindings } from '../index'
import { verifySquareSignature } from '../lib/squareWebhookAuth.ts'
import { fetchAndSyncInvoice, isSquareNotFound } from '../lib/squareBilling.ts'
import { ensureSchemaReady } from './admin'

// Flow 6 of docs/designs/square-deposits-and-invoices.md.
// Logs carry the event id only — never the body, headers or signature.

const MAX_WEBHOOK_BYTES = 65536
const HANDLED_EVENT_TYPES = ['invoice.payment_made', 'invoice.updated', 'invoice.canceled']

type WebhookContext = Context<{ Bindings: Bindings }>

function errorResponse(c: WebhookContext, status: 401 | 413 | 500 | 503, code: string, message: string) {
  return c.json({ error: { code, message, details: [] } }, status)
}

function ignored(c: WebhookContext) {
  return c.json({ received: true, ignored: true }, 200)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export const squareWebhookRouter = new Hono<{ Bindings: Bindings }>()

squareWebhookRouter.post('/', async (c) => {
  // 1. Configuration
  const key = c.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  const notificationUrl = c.env.SQUARE_WEBHOOK_URL
  if (!key || !notificationUrl) {
    return errorResponse(c, 503, 'WEBHOOK_NOT_CONFIGURED', "The Square webhook isn't set up on the server.")
  }

  // 2. Size limits: declared length first, then the body actually read (once)
  const declaredLength = Number(c.req.header('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return errorResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'Webhook body is too large.')
  }
  const rawBody = await c.req.text()
  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    return errorResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'Webhook body is too large.')
  }

  // 3. Signature over SQUARE_WEBHOOK_URL + rawBody
  const valid = await verifySquareSignature({
    body: rawBody,
    signature: c.req.header('x-square-hmacsha256-signature') || '',
    key,
    url: notificationUrl
  })
  if (!valid) {
    console.warn('[square-webhook] rejected: invalid signature')
    return errorResponse(c, 401, 'INVALID_SIGNATURE', 'Invalid webhook signature.')
  }

  // 4. Schema
  await ensureSchemaReady(c.env.DB)

  // 5. Ignore anything that is not a known invoice event for a tracked invoice
  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    console.warn('[square-webhook] ignored: body is not JSON')
    return ignored(c)
  }
  const eventId = nonEmptyString(event?.event_id) || 'unknown'

  if (!HANDLED_EVENT_TYPES.includes(event?.type)) {
    return ignored(c)
  }

  const invoiceId = nonEmptyString(event?.data?.object?.invoice?.id) || nonEmptyString(event?.data?.id)
  if (!invoiceId) {
    console.warn(`[square-webhook] ignored event ${eventId}: no invoice id`)
    return ignored(c)
  }

  const known = await c.env.DB.prepare(
    'SELECT 1 FROM Booking_Invoices WHERE square_invoice_id = ? LIMIT 1'
  ).bind(invoiceId).first()
  if (!known) {
    return ignored(c)
  }

  // 6. Re-read the invoice from Square and record it
  try {
    await fetchAndSyncInvoice(c.env.DB, c.env, invoiceId)
    return c.json({ received: true }, 200)
  } catch (err) {
    if (isSquareNotFound(err)) {
      console.warn(`[square-webhook] ignored event ${eventId}: invoice not found in Square`)
      return ignored(c)
    }
    console.error(`[square-webhook] event ${eventId} failed; Square will retry`)
    return errorResponse(c, 500, 'INTERNAL_SERVER_ERROR', 'Failed to process the webhook.')
  }
})
