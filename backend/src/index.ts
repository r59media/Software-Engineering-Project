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
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.workers.dev https://*.r2.cloudflarestorage.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
  )
  c.header('X-Frame-Options', 'DENY')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)')
  c.header('Cross-Origin-Opener-Policy', 'same-origin')
})

// CORS — restrict to known frontend origins and same-origin requests
app.use('*', async (c, next) => {
  c.header('Vary', 'Origin')

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
    credentials: false,
  })
  return corsMiddleware(c, next)
})

// Route /admin and /admin/* to Admin Dashboard static assets
app.get('/admin', (c) => {
  return c.redirect('/admin/', 301)
})

const STATIC_EXT_REGEX = /\.(css|js|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|json|map)$/i

app.get('/admin/*', async (c) => {
  if (!c.env.ASSETS) {
    return c.text('Internal server error.', 500)
  }

  const url = new URL(c.req.url)

  // 1. Block internal documentation files (.md) from public access
  if (url.pathname.toLowerCase().endsWith('.md')) {
    return c.redirect('/admin/', 302)
  }

  let assetRes: Response

  // 2. If requesting a static web asset with an extension (excluding html), fetch directly
  if (STATIC_EXT_REGEX.test(url.pathname)) {
    assetRes = await c.env.ASSETS.fetch(c.req.raw)
  } else {
    // 3. For '/admin/', '/admin/index.html', or extensionless SPA routes,
    // request canonical '/admin/' so html_handling serves 200 OK directly
    const canonicalAdminUrl = new URL('/admin/', url.origin)
    assetRes = await c.env.ASSETS.fetch(
      new Request(canonicalAdminUrl.toString(), {
        method: 'GET',
        headers: c.req.raw.headers
      })
    )
  }

  // 4. Guard against redirect loops: if ASSETS ever returns a redirect to /admin/,
  // fetch /admin/ directly or return the body with 200 OK
  if (assetRes.status >= 300 && assetRes.status < 400) {
    const loc = assetRes.headers.get('Location')
    if (loc === '/admin/' || loc === url.pathname) {
      const fallbackUrl = new URL('/admin/', url.origin)
      const directRes = await c.env.ASSETS.fetch(
        new Request(fallbackUrl.toString(), {
          method: 'GET',
          headers: c.req.raw.headers
        })
      )
      if (directRes.status === 200) {
        assetRes = directRes
      }
    }
  }

  // Clone with mutable headers so global security header middleware attaches headers cleanly
  const headers = new Headers(assetRes.headers)
  return new Response(assetRes.body, {
    status: assetRes.status,
    statusText: assetRes.statusText,
    headers
  })
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

// R2 Public Media Delivery
app.get('/api/media/*', async (c) => {
  const url = new URL(c.req.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/media\//, '')).replace(/^\/+/, '')
  if (!key || key.includes('..')) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid media key' }, 400)
  }
  if (c.env.BUCKET) {
    const obj = await c.env.BUCKET.get(key)
    if (!obj) return c.notFound()
    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    return new Response(obj.body, { headers })
  }
  return c.notFound()
})

app.get('*', async (c) => {
  const url = new URL(c.req.url)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return c.json({ status: 'error', code: 'NOT_FOUND', message: 'API endpoint not found' }, 404)
  }
  if (!c.env.ASSETS) {
    return c.text('R59 Media API is running!')
  }
  if (url.pathname.toLowerCase().endsWith('.md')) {
    return c.notFound()
  }

  let assetRes: Response
  if (STATIC_EXT_REGEX.test(url.pathname)) {
    assetRes = await c.env.ASSETS.fetch(c.req.raw)
  } else {
    const rootUrl = new URL('/', url.origin)
    assetRes = await c.env.ASSETS.fetch(
      new Request(rootUrl.toString(), {
        method: 'GET',
        headers: c.req.raw.headers
      })
    )
  }

  if (assetRes.status >= 300 && assetRes.status < 400) {
    const loc = assetRes.headers.get('Location')
    if (loc === '/' || loc === url.pathname) {
      const fallbackUrl = new URL('/', url.origin)
      const directRes = await c.env.ASSETS.fetch(
        new Request(fallbackUrl.toString(), {
          method: 'GET',
          headers: c.req.raw.headers
        })
      )
      if (directRes.status === 200) {
        assetRes = directRes
      }
    }
  }

  const headers = new Headers(assetRes.headers)
  return new Response(assetRes.body, {
    status: assetRes.status,
    statusText: assetRes.statusText,
    headers
  })
})

app.notFound((c) => {
  const url = new URL(c.req.url)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return c.json({ status: 'error', code: 'NOT_FOUND', message: 'API endpoint not found' }, 404)
  }
  return c.text('Not Found', 404)
})

export default app
