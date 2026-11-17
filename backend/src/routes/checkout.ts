import { Hono } from 'hono'
import type { Bindings } from '../index'
import { ensureSchemaReady } from './admin'
import { getTrustedClientIp, hasForbiddenPaymentFields } from '../middleware/auth'
import { buildHybridSquareNote, ensureCustomer, getSquare, getStudioTimeZone, sendBalanceInvoice } from '../lib/squareBilling'
import { depositFor, localDateTimeToRFC3339, normalizeDepositPercent } from '../lib/billingMath'
import { isSlotInWeeklyAvailability } from './schedule'

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
    const rawPhone = body.customer_phone ?? body.customerPhone ?? body.phone
    const customerPhone = typeof rawPhone === 'string' ? rawPhone.trim().slice(0, 50) : ''
    const rawNotes = body.notes ?? body.message ?? body.clientNotes
    let notes = typeof rawNotes === 'string' ? rawNotes.trim().slice(0, 2000) : ''
    const rawAttendees = body.attendees ?? body.party_size ?? body.people
    const attendees = Number.isInteger(Number(rawAttendees)) && Number(rawAttendees) > 0 ? Number(rawAttendees) : 1
    const idempotencyKey = body.idempotencyKey ?? body.idempotency_key

    const rawSlotId = body.slot_id !== undefined ? body.slot_id : body.slotId
    if (typeof rawSlotId === 'number' && Number.isInteger(rawSlotId) && rawSlotId > 0) {
      slotId = rawSlotId
    } else if (typeof rawSlotId === 'string' && /^[1-9]\d*$/.test(rawSlotId.trim())) {
      slotId = parseInt(rawSlotId.trim(), 10)
    }

    const couponCode = typeof (body.coupon_code ?? body.couponCode) === 'string' ? (body.coupon_code ?? body.couponCode).trim().toUpperCase() : ''

    const photoPermissions = body.photoPermissions ?? body.photo_permissions
    let photoPermissionPortfolio = 0
    let photoPermissionSocial = 0
    let photoPermissionAcceptedAt: string | null = null
    const photoPermissionVersion = 'v1'

    if (photoPermissions && typeof photoPermissions === 'object') {
      photoPermissionPortfolio = (photoPermissions.websitePortfolio ?? photoPermissions.website_portfolio) ? 1 : 0
      photoPermissionSocial = (photoPermissions.socialMedia ?? photoPermissions.social_media) ? 1 : 0
      photoPermissionAcceptedAt = new Date().toISOString()
    }
    const consentSummary = `Photo Consent: Portfolio=[${photoPermissionPortfolio ? 'YES' : 'NO'}], Social=[${photoPermissionSocial ? 'YES' : 'NO'}]`
    if (photoPermissions && typeof photoPermissions === 'object') {
      notes = notes ? `${notes}\n\n${consentSummary}` : consentSummary
    }

    const errors = []
    if (!sourceId || typeof sourceId !== 'string') {
      errors.push({ field: 'sourceId', message: 'Payment source token is required.', code: 'REQUIRED_FIELD' })
    }
    if (!slotId) {
      errors.push({ field: 'slot_id', message: 'A valid numeric timeslot id is required.', code: 'REQUIRED_FIELD' })
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

    // Validate slot exists
    const slot = await c.env.DB.prepare(
      'SELECT id, date, start_time, end_time, is_booked FROM Schedule_Slots WHERE id = ?'
    ).bind(slotId).first<any>()

    if (!slot) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected timeslot does not exist.',
          target: 'checkout_form',
          details: [{ field: 'slot_id', message: 'Timeslot does not exist.', code: 'NOT_FOUND' }]
        }
      }, 400)
    }

    // Validate slot matches requested date/time if provided
    const requestedDate = body.date || body.dateStr || body.slot_date || body.slotDate
    if (requestedDate && String(requestedDate).trim() !== slot.date) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Selected timeslot date does not match requested date.',
          target: 'checkout_form',
          details: [{ field: 'slot_id', message: 'Timeslot date mismatch.', code: 'DATE_MISMATCH' }]
        }
      }, 400)
    }

    const requestedTime = body.start_time || body.startTime || body.time || body.slot_time
    if (requestedTime) {
      const normReq = String(requestedTime).trim().slice(0, 5)
      const normSlot = String(slot.start_time).trim().slice(0, 5)
      if (normReq !== normSlot) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Selected timeslot time does not match requested time.',
            target: 'checkout_form',
            details: [{ field: 'slot_id', message: 'Timeslot time mismatch.', code: 'TIME_MISMATCH' }]
          }
        }, 400)
      }
    }

    // Validate slot is available
    if (slot.is_booked) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected timeslot is already booked.',
          target: 'checkout_form',
          details: [{ field: 'slot_id', message: 'Timeslot unavailable.', code: 'UNAVAILABLE' }]
        }
      }, 409)
    }

    // Validate slot is not blocked
    const blocked = await c.env.DB.prepare(
      'SELECT id FROM Blocked_Dates WHERE date = ?'
    ).bind(slot.date).first()

    if (blocked) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected timeslot falls on a blocked date.',
          target: 'checkout_form',
          details: [{ field: 'slot_id', message: 'Timeslot falls on a blocked date.', code: 'BLOCKED_DATE' }]
        }
      }, 409)
    }

    // Validate slot is within weekly availability
    let weeklyAvailability: any[] = []
    try {
      const waRow = await c.env.DB.prepare(
        "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'weekly_availability'"
      ).first<{ setting_value: string }>()
      if (waRow?.setting_value) {
        weeklyAvailability = JSON.parse(waRow.setting_value)
      }
    } catch {}

    if (!isSlotInWeeklyAvailability(slot, weeklyAvailability)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected timeslot is outside studio weekly availability.',
          target: 'checkout_form',
          details: [{ field: 'slot_id', message: 'Timeslot is outside weekly availability windows.', code: 'OUTSIDE_AVAILABILITY' }]
        }
      }, 400)
    }

    // 1. Atomic Slot Lock (conditional UPDATE ... WHERE is_booked = 0 and date NOT IN (SELECT date FROM Blocked_Dates))
    const lockResult = await c.env.DB.prepare(
      'UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ? AND is_booked = 0 AND date NOT IN (SELECT date FROM Blocked_Dates)'
    ).bind(slotId).run()

    if (!lockResult.success || lockResult.meta.changes === 0) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected timeslot is no longer available or falls on a blocked date.',
          target: 'checkout_form',
          details: [{ field: 'slot_id', message: 'Timeslot unavailable.', code: 'UNAVAILABLE' }]
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

    // Pricing settings from Admin_Settings
    let pricingSettings: any = null
    try {
      const pricingRow: any = await c.env.DB.prepare(
        "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'pricing'"
      ).first()
      pricingSettings = pricingRow?.setting_value ? JSON.parse(pricingRow.setting_value) : null
    } catch (pricingErr) {
      console.warn('Could not read pricing settings; using the default pricing settings.')
    }

    const baseFeeDollars = Number(pricingSettings?.baseFee) || 0
    const baseFeeCents = Math.round(baseFeeDollars * 100)

    const perPersonDollars = Number(pricingSettings?.perPerson) || 0
    const perPersonCents = Math.round(perPersonDollars * 100)

    let includedPeople = 1
    let serviceExtraPersonPriceCents = 0
    if (service.additional_people) {
      let ap: any = null
      if (typeof service.additional_people === 'string') {
        try { ap = JSON.parse(service.additional_people) } catch {}
      } else if (typeof service.additional_people === 'object') {
        ap = service.additional_people
      }
      if (ap?.includedPeople !== undefined && Number.isFinite(Number(ap.includedPeople))) {
        includedPeople = Math.max(1, Math.round(Number(ap.includedPeople)))
      }
      if (ap?.extraPersonPriceMinor !== undefined && Number.isFinite(Number(ap.extraPersonPriceMinor))) {
        serviceExtraPersonPriceCents = Math.round(Number(ap.extraPersonPriceMinor))
      }
    }

    const additionalPeople = Math.max(0, attendees - includedPeople)
    const ratePerPersonCents = perPersonCents > 0 ? perPersonCents : serviceExtraPersonPriceCents
    const extraPeopleFeeCents = ratePerPersonCents * additionalPeople

    const subtotalCents = priceCents + baseFeeCents + extraPeopleFeeCents

    let couponDiscountCents = 0
    let validCouponCode = ''
    if (couponCode) {
      const coupon: any = await c.env.DB.prepare(
        'SELECT id, code, discount_type, discount_value, is_active FROM Coupons WHERE UPPER(code) = ? AND is_active = 1'
      ).bind(couponCode).first()

      if (coupon) {
        let expired = false
        if (coupon.expires_at) {
          const exp = new Date(coupon.expires_at).getTime()
          if (!Number.isNaN(exp) && Date.now() > exp) {
            expired = true
          }
        }

        let usageLimitReached = false
        if (coupon.max_uses || coupon.usage_limit) {
          const limit = Number(coupon.max_uses || coupon.usage_limit)
          const countRow = await c.env.DB.prepare(
            "SELECT COUNT(*) as count FROM Bookings WHERE UPPER(coupon_code) = ? AND status != 'cancelled'"
          ).bind(couponCode).first<{ count: number }>()
          if ((countRow?.count ?? 0) >= limit) {
            usageLimitReached = true
          }
        }

        if (!expired && !usageLimitReached) {
          validCouponCode = couponCode
          const discountVal = Number(coupon.discount_value) || 0
          if (coupon.discount_type === 'percent') {
            const pct = Math.min(100, Math.max(0, discountVal))
            couponDiscountCents = Math.round((subtotalCents * pct) / 100)
          } else {
            couponDiscountCents = Math.round(Math.max(0, discountVal) * 100)
          }
        }
      }
    }

    const finalPriceCents = Math.max(0, subtotalCents - couponDiscountCents)
    const depositPercent = normalizeDepositPercent(pricingSettings?.depositPercent)
    const depositCents = Math.round((finalPriceCents * depositPercent) / 100)
    const squareChargeCents = finalPriceCents > 0 ? Math.min(finalPriceCents, Math.max(100, depositCents)) : 0
    const lineItemName = depositPercent === 100 ? service.name : `${service.name} – ${depositPercent}% deposit`
    const serviceCategory = String(service.category ?? service.best_for ?? '').trim() || 'Photography'
    const packageTitle = String(service.title ?? service.name ?? '').trim()
    const hybridNote = buildHybridSquareNote({
      category: serviceCategory,
      packageName: packageTitle,
      date: slot.date,
      time: slot.start_time,
      guests: attendees,
      couponCode: validCouponCode || couponCode,
      photoPermissionPortfolio,
      photoPermissionSocial,
      bookingId: null
    })

    // Throws SquareNotConfiguredError when the token or location is missing; the catch below
    // answers 500 PAYMENT_FAILED and releases the slot.
    const { client, locationId: squareLocationId } = await getSquare(c.env)

    // 1b. Attach or create Square Customer so client name/email/phone appear on Transactions & Customers
    let squareCustomerId: string | undefined
    try {
      squareCustomerId = await ensureCustomer(
        client,
        { client_email: clientEmail, client_name: clientName, customer_phone: customerPhone },
        idempotencyKey
      )
    } catch (custErr) {
      console.warn('Square customer lookup/create failed during checkout:', custErr)
    }

    // 2. Create Ad-Hoc Order
    const orderResponse = await client.orders.create({
      order: {
        locationId: squareLocationId,
        customerId: squareCustomerId,
        lineItems: [
          {
            name: lineItemName,
            quantity: '1',
            note: hybridNote,
            basePriceMoney: {
              amount: BigInt(squareChargeCents),
              currency: 'USD'
            }
          }
        ],
        metadata: {
          booking_id: 'pending',
          category: serviceCategory.slice(0, 255),
          session_type: (packageTitle || 'Custom Session').slice(0, 255),
          photo_permission_portfolio: photoPermissionPortfolio ? 'YES' : 'NO',
          photo_permission_social: photoPermissionSocial ? 'YES' : 'NO'
        }
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
      customerId: squareCustomerId,
      autocomplete: true,
      acceptPartialAuthorization: false,
      note: hybridNote,
      buyerEmailAddress: clientEmail,
      amountMoney: {
        amount: BigInt(squareChargeCents),
        currency: 'USD'
      }
    })

    const payment = paymentResponse.payment
    const paymentId = payment?.id

    if (payment?.status !== 'COMPLETED' || payment.amountMoney?.amount !== BigInt(squareChargeCents)) {
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
        // Online checkout charges only the deposit: price_at_booking is the total after coupon,
        // deposit_paid is the amount charged now, and deposit_percent is the percent that produced it
        "INSERT INTO Bookings (service_id, slot_id, client_name, client_email, customer_phone, notes, attendees, price_at_booking, square_payment_id, status, coupon_code, deposit_paid, deposit_percent, photo_permission_portfolio, photo_permission_social, photo_permission_accepted_at, photo_permission_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        service.id, slotId, clientName, clientEmail, customerPhone, notes, attendees,
        finalPriceCents, paymentId, validCouponCode || couponCode, depositCents, depositPercent,
        photoPermissionPortfolio, photoPermissionSocial, photoPermissionAcceptedAt, photoPermissionVersion
      ).run()
      bookingId = bookingInsert.meta?.last_row_id

      if (validCouponCode) {
        try {
          await c.env.DB.prepare('UPDATE Coupons SET used_count = COALESCE(used_count, 0) + 1 WHERE UPPER(code) = ?').bind(validCouponCode).run()
        } catch {}
        try {
          await c.env.DB.prepare('UPDATE Coupons SET times_used = COALESCE(times_used, 0) + 1 WHERE UPPER(code) = ?').bind(validCouponCode).run()
        } catch {}
      }
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
            amount: BigInt(squareChargeCents),
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

    const balanceCents = Math.max(0, finalPriceCents - depositCents)
    if (bookingId && balanceCents > 0) {
      try {
        const timeZone = await getStudioTimeZone(c.env.DB)
        const scheduledAt = localDateTimeToRFC3339(slot.date, slot.start_time, timeZone)
        await sendBalanceInvoice(
          c.env.DB,
          c.env,
          bookingId,
          balanceCents,
          scheduledAt ? { scheduledAt } : undefined
        )
      } catch (invoiceErr) {
        console.error('Checkout succeeded, but failed to schedule balance invoice:', {
          bookingId,
          error: invoiceErr
        })
      }
    }

    return c.json({
      success: true,
      status: 'success',
      paymentId,
      orderId,
      bookingId,
      deposit_cents: depositCents,
      deposit_percent: depositPercent,
      total_cents: finalPriceCents,
      balance_cents: balanceCents,
      photo_consent: {
        portfolio: photoPermissionPortfolio === 1,
        social: photoPermissionSocial === 1,
        accepted_at: photoPermissionAcceptedAt,
        version: photoPermissionVersion
      },
      consent_summary: consentSummary,
      data: {
        booking_id: bookingId,
        payment_id: paymentId,
        order_id: orderId,
        deposit_cents: depositCents,
        deposit_percent: depositPercent,
        total_cents: finalPriceCents,
        balance_cents: balanceCents,
        photo_permission_portfolio: photoPermissionPortfolio,
        photo_permission_social: photoPermissionSocial,
        photo_permission_accepted_at: photoPermissionAcceptedAt,
        photo_permission_version: photoPermissionVersion,
        consent_summary: consentSummary
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
