import { Context, Next } from 'hono'
import { Bindings } from '../index'

/**
 * Middleware that checks for a valid `Authorization: Bearer <ADMIN_SECRET>` header.
 * Use on any route that should be restricted to the admin (photographer).
 */
export const adminAuth = async (c: Context<{ Bindings: Bindings }>, next: Next) => {
  const auth = c.req.header('Authorization')
  if (!auth || auth !== `Bearer ${c.env.ADMIN_SECRET}`) {
    return c.json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Admin access required. Provide a valid Authorization header.',
        details: []
      }
    }, 401)
  }
  await next()
}
