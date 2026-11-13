import { Hono } from 'hono'
import type { Bindings } from '../index'
import { DEFAULT_DEPOSIT_PERCENT, normalizeDepositPercent } from '../lib/billingMath'
import { getTrustedClientIp } from '../middleware/auth'

export const pricingRouter = new Hono<{ Bindings: Bindings }>()
export const couponsRouter = new Hono<{ Bindings: Bindings }>()

// Rate limiter for coupon validation (30 requests/min per IP, max 1000 entries)
const MAX_COUPON_IPS = 1000
const COUPON_WINDOW_MS = 60 * 1000
const MAX_COUPON_REQUESTS = 30
const couponRateMap = new Map<string, { count: number; resetAt: number }>()

function checkCouponRateLimit(ip: string): boolean {
  const now = Date.now()
  for (const [k, v] of couponRateMap.entries()) {
    if (now > v.resetAt) couponRateMap.delete(k)
  }
  const entry = couponRateMap.get(ip)
  if (!entry || now > entry.resetAt) {
    if (couponRateMap.size >= MAX_COUPON_IPS) {
      const oldest = couponRateMap.keys().next().value
      if (oldest) couponRateMap.delete(oldest)
    }
    couponRateMap.set(ip, { count: 1, resetAt: now + COUPON_WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_COUPON_REQUESTS) {
    return false
  }
  entry.count++
  return true
}

// GET /api/pricing (public)
pricingRouter.get('/', async (c) => {
  try {
    const row = await c.env.DB.prepare(
      "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'pricing'"
    ).first<{ setting_value: string }>()

    let depositPercent = DEFAULT_DEPOSIT_PERCENT
    let baseFee = 0
    let perPerson = 0

    if (row?.setting_value) {
      try {
        const parsed = JSON.parse(row.setting_value)
        if (parsed.depositPercent !== undefined) {
          depositPercent = normalizeDepositPercent(parsed.depositPercent)
        }
        if (parsed.baseFee !== undefined && Number.isFinite(Number(parsed.baseFee))) {
          baseFee = Number(parsed.baseFee)
        }
        if (parsed.perPerson !== undefined && Number.isFinite(Number(parsed.perPerson))) {
          perPerson = Number(parsed.perPerson)
        }
      } catch {}
    }

    c.header('Cache-Control', 'no-store')
    return c.json({
      depositPercent,
      baseFee,
      perPerson,
      currency: 'USD'
    })
  } catch {
    c.header('Cache-Control', 'no-store')
    return c.json({
      depositPercent: DEFAULT_DEPOSIT_PERCENT,
      baseFee: 0,
      perPerson: 0,
      currency: 'USD'
    })
  }
})

// GET /api/coupons/validate?code=XYZ (public)
couponsRouter.get('/validate', async (c) => {
  const clientIp = getTrustedClientIp(c)
  if (!checkCouponRateLimit(clientIp)) {
    c.header('Retry-After', '60')
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
    const coupon = await c.env.DB.prepare(
      'SELECT id, code, discount_type, discount_value, is_active FROM Coupons WHERE UPPER(code) = ?'
    ).bind(code).first<any>()

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
      const exp = new Date(coupon.expires_at).getTime()
      if (!Number.isNaN(exp) && Date.now() > exp) {
        return c.json({
          valid: false,
          message: 'This coupon has expired.'
        })
      }
    }

    // Check usage limit if present
    if (coupon.max_uses || coupon.usage_limit) {
      const limit = Number(coupon.max_uses || coupon.usage_limit)
      const countRow = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM Bookings WHERE UPPER(coupon_code) = ? AND status != 'cancelled'"
      ).bind(code).first<{ count: number }>()
      if ((countRow?.count ?? 0) >= limit) {
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
