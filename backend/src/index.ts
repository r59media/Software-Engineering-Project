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
  ADMIN_EMAIL?: string
  ALLOWED_ORIGINS?: string
  SESSION_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Request logging
app.use('*', logger())

// Global Security Headers
app.use('*', async (c, next) => {
  await next()
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://*.workers.dev;")
  c.header('X-Frame-Options', 'DENY')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
})

// CORS — restrict to known frontend origins and same-origin requests
app.use('*', async (c, next) => {
  const defaultOrigins = 'http://localhost:5173,http://localhost:8787,http://localhost:8000,http://localhost:3000,http://127.0.0.1:8000,http://127.0.0.1:5500'
  const allowedRaw = c.env.ALLOWED_ORIGINS || defaultOrigins
  const allowedOrigins = allowedRaw.split(',').map(o => o.trim()).filter(Boolean)

  const requestOrigin = c.req.header('Origin') || ''
  const currentUrl = new URL(c.req.url)

  // Explicitly disallow 'null' and verify origin is in allowed list or same-origin
  const isAllowed = Boolean(
    requestOrigin &&
    requestOrigin !== 'null' &&
    (allowedOrigins.includes(requestOrigin) || requestOrigin === currentUrl.origin)
  )

  if (!isAllowed) {
    // For non-allowed origins, proceed without reflecting Access-Control-Allow-Origin
    return await next()
  }

  const corsMiddleware = cors({
    origin: requestOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposeHeaders: ['Content-Length', 'X-Requested-With'],
    credentials: true,
  })
  return corsMiddleware(c, next)
})

// Root route (public facing)
app.get('/', (c) => {
  return c.text('R59 Media API is running!')
})

// Route /admin and /admin/* to Admin Dashboard static assets
app.get('/admin', (c) => {
  return c.redirect('/admin/')
})

const STATIC_EXT_REGEX = /\.(css|js|html|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|json)$/i

app.get('/admin/*', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url)
    // If requesting a static web asset with a legitimate extension, fetch directly
    if (STATIC_EXT_REGEX.test(url.pathname)) {
      return await c.env.ASSETS.fetch(c.req.raw)
    }
    // Otherwise fallback to /admin/index.html for client-side routing
    const adminIndexUrl = new URL('/admin/index.html', url.origin)
    return await c.env.ASSETS.fetch(new Request(adminIndexUrl.toString(), c.req.raw))
  }
  return c.text('Internal server error.', 500)
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
