import { Hono } from 'hono'
import { Bindings } from '../index'
import { SquareClient, SquareEnvironment } from 'square'

export const checkoutRouter = new Hono<{ Bindings: Bindings }>()

checkoutRouter.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const { sourceId, slotId, clientName, clientEmail, serviceType } = body

    const errors = []
    if (!sourceId) errors.push({ field: 'sourceId', message: 'Payment source token is required.', code: 'REQUIRED_FIELD' })
    if (!slotId) errors.push({ field: 'slotId', message: 'A timeslot must be selected.', code: 'REQUIRED_FIELD' })
    if (!clientName) errors.push({ field: 'clientName', message: 'Client name is required.', code: 'REQUIRED_FIELD' })
    if (!clientEmail) errors.push({ field: 'clientEmail', message: 'Client email is required.', code: 'REQUIRED_FIELD' })
    if (!serviceType) errors.push({ field: 'serviceType', message: 'Service type is required.', code: 'REQUIRED_FIELD' })

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

    // Get Base Price
    const setting: any = await c.env.DB.prepare('SELECT setting_value FROM Admin_Settings WHERE setting_key = "base_price"').first()
    const basePriceCents = setting ? parseInt(setting.setting_value, 10) : 15000 // default $150

    if (!c.env.SQUARE_ACCESS_TOKEN) {
      throw new Error('Square Access Token not configured')
    }

    const client = new SquareClient({
      token: c.env.SQUARE_ACCESS_TOKEN,
      environment: c.env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
    })

    const idempotencyKey = crypto.randomUUID()
    
    // Process Payment
    const paymentResponse = await client.payments.create({
      sourceId,
      idempotencyKey,
      amountMoney: {
        amount: BigInt(basePriceCents),
        currency: 'USD'
      }
    })

    const paymentId = paymentResponse.payment?.id

    // Book it in DB
    await c.env.DB.prepare(
      'UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ?'
    ).bind(slotId).run()

    await c.env.DB.prepare(
      'INSERT INTO Bookings (client_name, client_email, slot_id, service_type, price, square_payment_id, status) VALUES (?, ?, ?, ?, ?, ?, "confirmed")'
    ).bind(clientName, clientEmail, slotId, serviceType, basePriceCents, paymentId).run()

    return c.json({ success: true, paymentId })
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
