import { Hono } from 'hono'
import { Bindings } from '../index'
import { SquareClient, SquareEnvironment } from 'square'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const checkoutRouter = new Hono<{ Bindings: Bindings }>()

checkoutRouter.post('/', async (c) => {
  let slotLocked = false
  let paymentConfirmed = false
  let slotId: number | undefined

  try {
    const body = await c.req.json()
    const { sourceId, serviceId, clientName, clientEmail, locationId, idempotencyKey } = body
    slotId = body.slotId

    const errors = []
    if (!sourceId) errors.push({ field: 'sourceId', message: 'Payment source token is required.', code: 'REQUIRED_FIELD' })
    if (!slotId) errors.push({ field: 'slotId', message: 'A timeslot must be selected.', code: 'REQUIRED_FIELD' })
    if (!serviceId) errors.push({ field: 'serviceId', message: 'A service must be selected.', code: 'REQUIRED_FIELD' })
    if (!clientName) errors.push({ field: 'clientName', message: 'Client name is required.', code: 'REQUIRED_FIELD' })
    if (!clientEmail) errors.push({ field: 'clientEmail', message: 'Client email is required.', code: 'REQUIRED_FIELD' })
    if (clientEmail && !EMAIL_REGEX.test(clientEmail)) errors.push({ field: 'clientEmail', message: 'Please enter a valid email address.', code: 'INVALID_FORMAT' })
    if (!idempotencyKey) errors.push({ field: 'idempotencyKey', message: 'Idempotency key is required to prevent double charges.', code: 'REQUIRED_FIELD' })

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

    // 1. Atomic Slot Lock
    const lockResult = await c.env.DB.prepare(
      'UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ? AND is_booked = 0'
    ).bind(slotId).run()

    if (!lockResult.success || lockResult.meta.changes === 0) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected timeslot is no longer available. It may have just been booked by someone else.',
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

    const priceCents = parseInt(service.price, 10)

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
              amount: BigInt(priceCents),
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

    // 3. Process Payment and attach to Order
    const paymentResponse = await client.payments.create({
      sourceId,
      idempotencyKey: idempotencyKey,
      orderId: orderId,
      locationId: squareLocationId,
      amountMoney: {
        amount: BigInt(priceCents),
        currency: 'USD'
      }
    })

    const payment = paymentResponse.payment
    const paymentId = payment?.id

    if (payment?.status !== 'COMPLETED' && payment?.status !== 'APPROVED') {
      // Explicitly release slot lock before returning 402 payment error
      try {
        await c.env.DB.prepare('UPDATE Schedule_Slots SET is_booked = 0 WHERE id = ?').bind(slotId).run()
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
    await c.env.DB.prepare(
      'INSERT INTO Bookings (service_id, slot_id, client_name, client_email, price_at_booking, square_payment_id, status) VALUES (?, ?, ?, ?, ?, ?, "confirmed")'
    ).bind(service.id, slotId, clientName, clientEmail, priceCents, paymentId).run()

    return c.json({ success: true, paymentId, orderId })
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
