import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

// Import routes
import { contactRouter } from './routes/contact'
import { scheduleRouter } from './routes/schedule'
import { uploadRouter } from './routes/upload'
import { checkoutRouter } from './routes/checkout'
import { portfolioRouter } from './routes/portfolio'
import { servicesRouter } from './routes/services'
import { adminRouter } from './routes/admin'

export type Bindings = {
  DB: D1Database
  BUCKET: R2Bucket
  SQUARE_ACCESS_TOKEN?: string
  SQUARE_ENVIRONMENT?: string
  SQUARE_LOCATION_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  ADMIN_SECRET?: string
  ALLOWED_ORIGINS?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Request logging
app.use('*', logger())

// CORS — restrict to known frontend origins
app.use('*', async (c, next) => {
  const allowedRaw = c.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8787'
  const allowedOrigins = allowedRaw.split(',').map(o => o.trim())
  const corsMiddleware = cors({
    origin: allowedOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
  return corsMiddleware(c, next)
})

app.get('/', (c) => {
  return c.text('R59 Media API is running!')
})

// Healthcheck — returns only status, never data
app.get('/api/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ status: 'ok' })
  } catch {
    return c.json({ status: 'error' }, 503)
  }
})

// Mount routes
app.route('/api/contact', contactRouter)
app.route('/api/schedule', scheduleRouter)
app.route('/api/upload-url', uploadRouter)
app.route('/api/checkout', checkoutRouter)
app.route('/api/portfolio', portfolioRouter)
app.route('/api/services', servicesRouter)
app.route('/api/admin', adminRouter)

export default app
