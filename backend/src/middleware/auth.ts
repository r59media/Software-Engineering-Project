import { Context, Next } from 'hono'
import { Bindings } from '../index'

/**
 * Middleware that checks for a valid `Authorization: Bearer <ADMIN_SECRET>` header.
 * Use on any route that should be restricted to the admin (photographer).
 */
export const adminAuth = async (c: Context<{ Bindings: Bindings }>, next: Next) => {
  const auth = c.req.header('Authorization')
  const secret = c.env.ADMIN_SECRET

  if (secret) {
    if (!auth || auth !== `Bearer ${secret}`) {
      return c.json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Admin access required. Provide a valid Authorization header.',
          details: []
        }
      }, 401)
    }
  } else {
    // If ADMIN_SECRET is not yet configured in local environment, accept dev token
    if (!auth || (auth !== 'Bearer dev-admin-token' && auth !== 'Bearer default_secret')) {
      return c.json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Admin access required. ADMIN_SECRET is unset on worker; set ADMIN_SECRET in wrangler or send Bearer dev-admin-token.',
          details: []
        }
      }, 401)
    }
  }

  await next()
}
