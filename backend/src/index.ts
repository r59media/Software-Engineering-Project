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
  BUCKET?: R2Bucket
  ASSETS?: Fetcher
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
  const defaultOrigins = 'http://localhost:5173,http://localhost:8787,http://localhost:8000,http://localhost:3000,http://127.0.0.1:8000,http://127.0.0.1:5500'
  const allowedRaw = c.env.ALLOWED_ORIGINS || defaultOrigins
  const allowedOrigins = allowedRaw.split(',').map(o => o.trim())

  const requestOrigin = c.req.header('Origin') || ''
  const isAllowed = allowedOrigins.includes(requestOrigin) || requestOrigin === 'null' || allowedOrigins.includes('*')

  const corsMiddleware = cors({
    origin: isAllowed ? requestOrigin : allowedOrigins[0],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposeHeaders: ['Content-Length', 'X-Requested-With'],
    credentials: true,
  })
  return corsMiddleware(c, next)
})

// Serve admin dashboard at root via ASSETS or redirect
app.get('/', async (c) => {
  if (c.env.ASSETS) {
    return await c.env.ASSETS.fetch(c.req.raw)
  }
  return c.text('R59 Media API is running!')
})

// Convenience redirect for /admin to /
app.get('/admin', (c) => {
  return c.redirect('/')
})

// API status endpoint
app.get('/api', (c) => {
  return c.json({ status: 'ok', message: 'R59 Media API is running!' })
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
