import { Hono } from 'hono'
import { Bindings } from '../index'
import { SquareClient, SquareEnvironment } from 'square'
import { ensureSchemaReady } from './admin'
import { getTrustedClientIp, hasForbiddenPaymentFields } from '../middleware/auth'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9_-]{8,36}$/

// Per-IP rate limiter for checkout (max 10 requests/minute, bounded at 1000 entries)
const MAX_CHECKOUT_IPS = 1000
const CHECKOUT_WINDOW_MS = 60 * 1000
const MAX_CHECKOUT_REQUESTS = 10
const checkoutRateMap = new Map<string, { count: number; resetAt: number }>()

function checkCheckoutRateLimit(ip: string): boolean {
  const now = Date.now()
  for (const [k, v] of checkoutRateMap.entries()) {
    if (now > v.resetAt) checkoutRateMap.delete(k)
  }
  const entry = checkoutRateMap.get(ip)
  if (!entry || now > entry.resetAt) {
    if (checkoutRateMap.size >= MAX_CHECKOUT_IPS) {
      const oldest = checkoutRateMap.keys().next().value
      if (oldest) checkoutRateMap.delete(oldest)
    }
    checkoutRateMap.set(ip, { count: 1, resetAt: now + CHECKOUT_WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_CHECKOUT_REQUESTS) {
    return false
  }
  entry.count++
  return true
}

export const checkoutRouter = new Hono<{ Bindings: Bindings }>()

checkoutRouter.post('/', async (c) => {
  let slotLocked = false
  let paymentConfirmed = false
  let slotId: number | undefined

  try {
    const clientIp = getTrustedClientIp(c)
    if (!checkCheckoutRateLimit(clientIp)) {
      c.header('Retry-After', '60')
      return c.json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many checkout requests. Please wait a minute and try again.',
          details: []
        }
      }, 429)
    }

    await ensureSchemaReady(c.env.DB)

    const body = await c.req.json()

    if (hasForbiddenPaymentFields(body)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account details are prohibited. Tokenize payments with the Square Web Payments SDK.',
          target: 'checkout',
          details: []
        }
      }, 400)
    }

    const sourceId = body.sourceId ?? body.source_id

    if (/^\d{13,19}$/.test(String(sourceId || '').replace(/[\s-]/g, ''))) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Raw card or bank account details are prohibited. Tokenize payments with the Square Web Payments SDK.',
          target: 'checkout',
          details: []
        }
      }, 400)
    }
    const serviceId = body.serviceId ?? body.service_id
    const rawName = body.clientName ?? body.customer_name
    const rawEmail = body.clientEmail ?? body.customer_email
    const clientName = typeof rawName === 'string' ? rawName.trim() : ''
    const clientEmail = typeof rawEmail === 'string' ? rawEmail.trim() : ''
    const idempotencyKey = body.idempotencyKey ?? body.idempotency_key
    slotId = body.slotId ?? body.slot_id
    const couponCode = typeof (body.coupon_code ?? body.couponCode) === 'string' ? (body.coupon_code ?? body.couponCode).trim().toUpperCase() : ''

    const errors = []
    if (!sourceId || typeof sourceId !== 'string') {
      errors.push({ field: 'sourceId', message: 'Payment source token is required.', code: 'REQUIRED_FIELD' })
    }
    if (!slotId) {
      errors.push({ field: 'slotId', message: 'A timeslot must be selected.', code: 'REQUIRED_FIELD' })
    }
    if (!serviceId) {
      errors.push({ field: 'serviceId', message: 'A service must be selected.', code: 'REQUIRED_FIELD' })
    }
    if (!clientName || clientName.length === 0) {
      errors.push({ field: 'clientName', message: 'Client name is required.', code: 'REQUIRED_FIELD' })
    }
    if (!clientEmail || clientEmail.length === 0) {
      errors.push({ field: 'clientEmail', message: 'Client email is required.', code: 'REQUIRED_FIELD' })
    } else if (!EMAIL_REGEX.test(clientEmail)) {
      errors.push({ field: 'clientEmail', message: 'Please enter a valid email address.', code: 'INVALID_FORMAT' })
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      errors.push({ field: 'idempotencyKey', message: 'Idempotency key is required to prevent double charges.', code: 'REQUIRED_FIELD' })
    } else if (!IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
      errors.push({
        field: 'idempotencyKey',
        message: 'Idempotency key must be 8 to 36 alphanumeric, hyphen, or underscore characters.',
        code: 'INVALID_FORMAT'
      })
    }

    if (errors.length > 0) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Your booking request could not be processed. Please correct the errors below.',
          target: 'checkout_form',
          details: errors
        }
      }, 400)
    }

    // 0. Check if bookings are enabled globally
    const bookingSetting: any = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'booking_enabled'"
    ).first()
    if (bookingSetting?.setting_value === 'false') {
      return c.json({
        error: {
          code: 'FORBIDDEN',
          message: 'Online bookings are currently disabled. Please contact us directly.',
          details: []
        }
      }, 403)
    }

    // 1. Atomic Slot Lock (excluding blocked dates)
    const lockResult = await c.env.DB.prepare(
      'UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ? AND is_booked = 0 AND date NOT IN (SELECT date FROM Blocked_Dates)'
    ).bind(slotId).run()

    if (!lockResult.success || lockResult.meta.changes === 0) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected timeslot is no longer available or falls on a blocked date.',
          target: 'checkout_form',
          details: [{ field: 'slotId', message: 'Timeslot unavailable.', code: 'UNAVAILABLE' }]
        }
      }, 409)
    }
    slotLocked = true

    // Fetch Service from DB
    const service: any = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ? AND is_active = 1').bind(serviceId).first()
    if (!service) {
      await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(slotId).run()
      slotLocked = false
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected service is invalid or unavailable.',
          target: 'checkout_form',
          details: [{ field: 'serviceId', message: 'Service unavailable.', code: 'UNAVAILABLE' }]
        }
      }, 400)
    }

    const priceCents = Number(service.price)
    if (!Number.isInteger(priceCents) || priceCents <= 0) {
      await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(slotId).run()
      slotLocked = false
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected service does not have a valid online checkout price.',
          target: 'checkout_form',
          details: [{ field: 'serviceId', message: 'Service price must be greater than zero.', code: 'INVALID_PRICE' }]
        }
      }, 400)
    }

    let finalPriceCents = priceCents
    if (couponCode) {
      const coupon: any = await c.env.DB.prepare(
        'SELECT code, discount_type, discount_value FROM Coupons WHERE UPPER(code) = ? AND is_active = 1'
      ).bind(couponCode).first()

      if (coupon) {
        let discountCents = 0
        if (coupon.discount_type === 'percent') {
          discountCents = Math.round(priceCents * (Math.min(100, Math.max(0, Number(coupon.discount_value) || 0)) / 100))
        } else {
          discountCents = Math.round(Math.max(0, Number(coupon.discount_value) || 0) * 100)
        }
        finalPriceCents = Math.max(100, priceCents - discountCents)
      }
    }

    if (!c.env.SQUARE_ACCESS_TOKEN) {
      throw new Error('Square Access Token not configured')
    }

    // Fail loudly if no location ID — only accept from verified server environment
    const squareLocationId = c.env.SQUARE_LOCATION_ID
    if (!squareLocationId) {
      throw new Error('SQUARE_LOCATION_ID is not configured on the server. Cannot process payment.')
    }

    const client = new SquareClient({
      token: c.env.SQUARE_ACCESS_TOKEN,
      environment: c.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
    })

    // 2. Create Ad-Hoc Order
    const orderResponse = await client.orders.create({
      order: {
        locationId: squareLocationId,
        lineItems: [
          {
            name: service.name,
            quantity: '1',
            basePriceMoney: {
              amount: BigInt(finalPriceCents),
              currency: 'USD'
            }
          }
        ]
      },
      idempotencyKey: idempotencyKey + '_order'
    })

    const orderId = orderResponse.order?.id

    if (!orderId) {
      throw new Error('Failed to generate Square Order')
    }

    // 3. Process Payment and attach to Order (require immediate capture and full authorization)
    const paymentResponse = await client.payments.create({
      sourceId,
      idempotencyKey: idempotencyKey,
      orderId: orderId,
      locationId: squareLocationId,
      autocomplete: true,
      acceptPartialAuthorization: false,
      amountMoney: {
        amount: BigInt(finalPriceCents),
        currency: 'USD'
      }
    })

    const payment = paymentResponse.payment
    const paymentId = payment?.id

    if (payment?.status !== 'COMPLETED' || payment.amountMoney?.amount !== BigInt(finalPriceCents)) {
      // Explicitly release slot lock before returning 402 payment error
      try {
        await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(slotId).run()
        slotLocked = false
      } catch (releaseErr) {
        console.error('Failed to release slot lock after payment failure:', releaseErr)
      }

      return c.json({
        error: {
          code: 'PAYMENT_FAILED',
          message: `Payment failed with status: ${payment?.status || 'UNKNOWN'}. Please try another card.`,
          details: []
        }
      }, 402)
    }
    paymentConfirmed = true

    // 4. Record successful booking
    let bookingId: number | undefined
    try {
      const bookingInsert = await c.env.DB.prepare(
        "INSERT INTO Bookings (service_id, slot_id, client_name, client_email, price_at_booking, square_payment_id, status, coupon_code) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)"
      ).bind(service.id, slotId, clientName, clientEmail, finalPriceCents, paymentId, couponCode || null).run()
      bookingId = bookingInsert.meta?.last_row_id
    } catch (bookingErr) {
      console.error('CRITICAL: Payment succeeded but booking insert failed:', {
        paymentId,
        orderId,
        slot_id: slotId,
        service_id: service.id,
        customer_email: clientEmail,
        error: bookingErr
      })

      // S-2: Attempt refund and release slot
      if (paymentId) {
        await client.refunds.refundPayment({
          idempotencyKey: idempotencyKey + '_refund',
          paymentId: paymentId,
          amountMoney: {
            amount: BigInt(finalPriceCents),
            currency: 'USD'
          }
        }).catch((refundErr) => {
          console.error('Failed to refund payment after booking failure:', refundErr)
        })
      }

      try {
        await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(slotId).run()
        slotLocked = false
      } catch (releaseErr) {
        console.error('Failed to release slot lock after booking failure:', releaseErr)
      }

      return c.json({
        error: {
          code: 'BOOKING_RECORD_ERROR',
          message:
            'Your payment was processed (Ref: ' +
            paymentId +
            '), but we encountered an error saving your booking. We have initiated an automatic refund. Please contact us if you need assistance.',
          details: [{ paymentId, orderId }]
        }
      }, 500)
    }

    return c.json({
      success: true,
      status: 'success',
      paymentId,
      orderId,
      bookingId,
      data: {
        booking_id: bookingId,
        payment_id: paymentId,
        order_id: orderId
      }
    })
  } catch (e: any) {
    console.error('Checkout error:', e)

    // Release the slot lock ONLY if payment was not confirmed
    if (slotLocked && !paymentConfirmed && slotId) {
      try {
        await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(slotId).run()
      } catch (releaseErr) {
        console.error('CRITICAL: Failed to release slot lock after error:', releaseErr)
      }
    }

    return c.json({
      error: {
        code: 'PAYMENT_FAILED',
        message: 'Your payment could not be processed. Please check your payment details and try again.',
        details: []
      }
    }, 500)
  }
})
