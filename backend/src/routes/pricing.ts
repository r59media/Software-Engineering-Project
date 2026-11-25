import { Hono } from 'hono'
import type { Bindings } from '../index'
import {
  DEFAULT_BOOKING_POLICY,
  DEFAULT_DEPOSIT_PERCENT,
  type DynamicFeeRule,
  normalizeBookingPolicy,
  normalizeDepositPercent,
  normalizeFeeRules
} from '../lib/billingMath'
import { enforceRouteRateLimit } from '../middleware/rateLimit'
import { withPublicJsonCache } from '../lib/edgeCache'

export const pricingRouter = new Hono<{ Bindings: Bindings }>()
export const couponsRouter = new Hono<{ Bindings: Bindings }>()

const COUPON_RATE_WINDOW_SECONDS = 60
const COUPON_RATE_MAX_REQUESTS = 30

function getSquareConfig(env: Bindings) {
  return {
    applicationId: env.SQUARE_APPLICATION_ID || '',
    locationId: env.SQUARE_LOCATION_ID || '',
    environment: (env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox'
  }
}

function parsePricingSetting(rawValue: string | undefined) {
  let depositPercent = DEFAULT_DEPOSIT_PERCENT
  let baseFee = 0
  let perPerson = 0
  let feeRules: DynamicFeeRule[] = []
  let policy = DEFAULT_BOOKING_POLICY

  if (rawValue) {
    try {
      const parsed = JSON.parse(rawValue)
      if (parsed.depositPercent !== undefined) depositPercent = normalizeDepositPercent(parsed.depositPercent)
      if (parsed.baseFee !== undefined && Number.isFinite(Number(parsed.baseFee))) baseFee = Number(parsed.baseFee)
      if (parsed.perPerson !== undefined && Number.isFinite(Number(parsed.perPerson))) perPerson = Number(parsed.perPerson)
      feeRules = normalizeFeeRules(parsed.feeRules)
      policy = normalizeBookingPolicy(parsed.policy)
    } catch {}
  }

  return { depositPercent, baseFee, perPerson, feeRules, policy }
}

// GET /api/pricing (public)
pricingRouter.get('/', (c) =>
  withPublicJsonCache(
    c,
    async () => {
      const row = await c.env.DB.prepare(
        "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'pricing'"
      ).first<{ setting_value: string }>()
      return { ...parsePricingSetting(row?.setting_value), currency: 'USD', squareConfig: getSquareConfig(c.env) }
    },
    () => ({
      depositPercent: DEFAULT_DEPOSIT_PERCENT,
      baseFee: 0,
      perPerson: 0,
      feeRules: [],
      policy: DEFAULT_BOOKING_POLICY,
      currency: 'USD',
      squareConfig: getSquareConfig(c.env)
    })
  )
)

// GET /api/coupons/validate?code=XYZ (public)
couponsRouter.get('/validate', async (c) => {
  const limited = await enforceRouteRateLimit(c, {
    prefix: 'coupon',
    maxRequests: COUPON_RATE_MAX_REQUESTS,
    windowSeconds: COUPON_RATE_WINDOW_SECONDS,
    message: 'Too many requests. Please wait a minute and try again.',
    includeDetails: false
  })
  if (limited) {
    return c.json({
      valid: false,
      message: 'Too many requests. Please wait a minute and try again.'
    }, 429)
  }

  const rawCode = c.req.query('code')
  if (!rawCode || typeof rawCode !== 'string' || !rawCode.trim()) {
    return c.json({
      valid: false,
      message: 'Coupon code is required.'
    })
  }

  const code = rawCode.trim().toUpperCase()

  try {
    let coupon: any = null
    try {
      coupon = await c.env.DB.prepare(
        'SELECT id, code, discount_type, discount_value, is_active, expires_at, max_uses, used_count FROM Coupons WHERE UPPER(code) = ?'
      ).bind(code).first<any>()
    } catch {
      coupon = await c.env.DB.prepare(
        'SELECT id, code, discount_type, discount_value, is_active FROM Coupons WHERE UPPER(code) = ?'
      ).bind(code).first<any>()
    }

    if (!coupon) {
      return c.json({
        valid: false,
        message: 'Invalid coupon code.'
      })
    }

    if (!coupon.is_active) {
      return c.json({
        valid: false,
        message: 'This coupon is no longer active.'
      })
    }

    // Check expiry if present
    if (coupon.expires_at) {
      const expStr = String(coupon.expires_at).trim()
      const expMs = /^\d{4}-\d{2}-\d{2}$/.test(expStr)
        ? Date.parse(`${expStr}T23:59:59.999Z`)
        : Date.parse(expStr)
      if (!Number.isNaN(expMs) && Date.now() > expMs) {
        return c.json({
          valid: false,
          message: 'This coupon has expired.'
        })
      }
    }

    // Check usage limit if present
    const rawLimit = coupon.max_uses ?? coupon.usage_limit
    if (rawLimit !== null && rawLimit !== undefined && Number(rawLimit) > 0) {
      const limit = Number(rawLimit)
      const usedCount = Number(coupon.used_count) || 0
      const countRow = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM Bookings WHERE UPPER(coupon_code) = ? AND status != 'cancelled'"
      ).bind(code).first<{ count: number }>().catch(() => null)
      if (Math.max(usedCount, countRow?.count ?? 0) >= limit) {
        return c.json({
          valid: false,
          message: 'This coupon has reached its usage limit.'
        })
      }
    }

    const type: 'percent' | 'fixed' = coupon.discount_type === 'percent' ? 'percent' : 'fixed'
    const amount = Number(coupon.discount_value) || 0

    return c.json({
      valid: true,
      type,
      amount,
      message: 'Coupon is valid.'
    })
  } catch {
    return c.json({
      valid: false,
      message: 'Could not validate coupon.'
    }, 500)
  }
})
