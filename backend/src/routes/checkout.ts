import { Hono } from 'hono'
import { Bindings } from '../index'
import { SquareClient, SquareEnvironment } from 'square'

export const checkoutRouter = new Hono<{ Bindings: Bindings }>()

checkoutRouter.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { sourceId, slotId, serviceId, clientName, clientEmail, locationId } = body

    const errors = []
    if (!sourceId) errors.push({ field: 'sourceId', message: 'Payment source token is required.', code: 'REQUIRED_FIELD' })
    if (!slotId) errors.push({ field: 'slotId', message: 'A timeslot must be selected.', code: 'REQUIRED_FIELD' })
    if (!serviceId) errors.push({ field: 'serviceId', message: 'A service must be selected.', code: 'REQUIRED_FIELD' })
    if (!clientName) errors.push({ field: 'clientName', message: 'Client name is required.', code: 'REQUIRED_FIELD' })
    if (!clientEmail) errors.push({ field: 'clientEmail', message: 'Client email is required.', code: 'REQUIRED_FIELD' })

    if (errors.length > 0) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: `Your booking request could not be processed. Please correct the ${errors.length} error(s) below.`,
          target: 'checkout_form',
          details: errors
        }
      }, 400)
    }

    // Verify slot is open
    const slot: any = await c.env.DB.prepare('SELECT * FROM Schedule_Slots WHERE id = ? AND is_booked = 0').bind(slotId).first()
    if (!slot) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected timeslot is no longer available.',
          target: 'checkout_form',
          details: [{ field: 'slotId', message: 'Timeslot unavailable.', code: 'UNAVAILABLE' }]
        }
      }, 400)
    }

    // Fetch Service from DB
    const service: any = await c.env.DB.prepare('SELECT * FROM Services WHERE id = ? AND is_active = 1').bind(serviceId).first()
    if (!service) {
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

    // Usually passed from frontend or injected via env vars
    const squareLocationId = c.env.SQUARE_LOCATION_ID || locationId || 'main'

    const client = new SquareClient({
      token: c.env.SQUARE_ACCESS_TOKEN,
      environment: c.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
    })

    const orderIdempotencyKey = crypto.randomUUID()
    
    // 1. Create Ad-Hoc Order
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
      idempotencyKey: orderIdempotencyKey
    })

    const orderId = orderResponse.order?.id

    if (!orderId) {
      throw new Error('Failed to generate Square Order')
    }

    const paymentIdempotencyKey = crypto.randomUUID()

    // 2. Process Payment and attach to Order
    const paymentResponse = await client.payments.create({
      sourceId,
      idempotencyKey: paymentIdempotencyKey,
      orderId: orderId,
      amountMoney: {
        amount: BigInt(priceCents),
        currency: 'USD'
      }
    })

    const paymentId = paymentResponse.payment?.id

    // 3. Book it in DB
    await c.env.DB.prepare(
      'UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ?'
    ).bind(slotId).run()

    await c.env.DB.prepare(
      'INSERT INTO Bookings (service_id, slot_id, client_name, client_email, price_at_booking, square_payment_id, status) VALUES (?, ?, ?, ?, ?, ?, "confirmed")'
    ).bind(service.id, slotId, clientName, clientEmail, priceCents, paymentId).run()

    return c.json({ success: true, paymentId, orderId })
  } catch (e: any) {
    console.error('Checkout error:', e)
    return c.json({
      error: {
        code: 'PAYMENT_FAILED',
        message: 'Your payment could not be processed. Please check your payment details and try again.',
        details: []
      }
    }, 500)
  }
})
