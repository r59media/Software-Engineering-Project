import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

// Import routes
import { contactRouter } from './routes/contact'
import { scheduleRouter } from './routes/schedule'
import { uploadRouter } from './routes/upload'
import { checkoutRouter } from './routes/checkout'
import { portfolioRouter } from './routes/portfolio'
import { servicesRouter } from './routes/services'
import { adminRouter, DEFAULT_PROFILE, replaceMediaStorageChunks, ensurePhotoPermissionsColumns, ensureSchemaReady } from './routes/admin'
import { squareWebhookRouter } from './routes/squareWebhook'
import { pricingRouter, couponsRouter } from './routes/pricing'
import { rescheduleRoutes } from './routes/reschedule'
import { addressRouter } from './routes/address'
import { extractSessionToken, verifySessionToken, isTokenRevokedInDb, adminAuth, getSigningSecret, getMediaSigningSecret, getSessionsValidAfter, timingSafeEqual } from './middleware/auth'
import { signMediaKey, verifyMediaSignature, parseRangeHeader, parseMediaVariantWidth } from './utils/signedUrl'
import {
  buildEdgeCacheKey,
  bumpPublicContentVersion,
  getExecutionCtx,
  getPublicContentVersion,
  MEDIA_CACHE_CONTROL,
  MEDIA_PRIVATE_CACHE_CONTROL,
  MEDIA_VERSIONED_CACHE_CONTROL,
  PUBLIC_READ_CACHE_CONTROL,
  scheduleEdgeCachePut,
  shouldBypassPublicEdgeCache,
  tryEdgeCacheMatch
} from './lib/edgeCache'
import { runDailyMaintenance } from './lib/scheduleSync'

export { replaceMediaStorageChunks, ensurePhotoPermissionsColumns, ensureSchemaReady }

export type Bindings = {
  DB: D1Database
  ASSETS?: Fetcher
  ENVIRONMENT?: string
  SQUARE_ACCESS_TOKEN?: string
  SQUARE_APPLICATION_ID?: string
  SQUARE_ENVIRONMENT?: string
  SQUARE_LOCATION_ID?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  ADMIN_SECRET?: string
  ADMIN_EMAIL?: string
  ALLOWED_ORIGINS?: string
  SESSION_SECRET?: string
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string
  SQUARE_WEBHOOK_URL?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_CALENDAR_ID?: string
  GOOGLE_CALENDAR_REFRESH_TOKEN?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  SQUARE_TERMINAL_DEVICE_ID?: string
  MEDIA_SIGNING_SECRET?: string
  GOOGLE_MAPS_API_KEY?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Request logging
app.use('*', logger())

// Global Security Headers
app.use('*', async (c, next) => {
  c.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  await next()
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client https://cdn.jsdelivr.net https://web.squarecdn.com https://sandbox.web.squarecdn.com; connect-src 'self' https://accounts.google.com/gsi/ https://connect.squareup.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com; frame-src https://accounts.google.com/gsi/ https://web.squarecdn.com https://sandbox.web.squarecdn.com; frame-ancestors 'self'; img-src 'self' data: blob: https://web.squarecdn.com https://sandbox.web.squarecdn.com; font-src 'self' https://fonts.gstatic.com data: https://web.squarecdn.com https://sandbox.web.squarecdn.com; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style https://web.squarecdn.com https://sandbox.web.squarecdn.com; worker-src 'self'; object-src 'none'; base-uri 'self'"
  )
  c.header('X-Frame-Options', 'SAMEORIGIN')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)')
  c.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
})

// CORS — restrict to known frontend origins and same-origin requests (Finding 6)
app.use('*', async (c, next) => {
  const configuredOrigins = (c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)

  const isDev = c.env.ENVIRONMENT === 'development'
  const devOrigins = [
    'http://localhost:5173',
    'http://localhost:8787',
    'http://localhost:8000',
    'http://localhost:3000',
    'http://127.0.0.1:8000',
    'http://127.0.0.1:5500'
  ]
  const allowedOrigins = isDev
    ? [...new Set([...configuredOrigins, ...devOrigins])]
    : configuredOrigins

  const requestOrigin = c.req.header('Origin') || ''
  const currentUrl = new URL(c.req.url)
  const isApiOrAdmin =
    currentUrl.pathname === '/api' ||
    currentUrl.pathname.startsWith('/api/') ||
    currentUrl.pathname === '/admin' ||
    currentUrl.pathname.startsWith('/admin/')

  // Explicitly disallow 'null' and verify origin is in allowed list or same-origin
  const isAllowed = Boolean(
    requestOrigin &&
    requestOrigin !== 'null' &&
    (allowedOrigins.includes(requestOrigin) || requestOrigin === currentUrl.origin)
  )

  if (!isAllowed) {
    // Only vary on Origin for API/admin routes; static GET/HEAD assets must not fragment PoP cache
    if (isApiOrAdmin) {
      c.header('Vary', 'Origin')
    }
    // For non-allowed origins, proceed without reflecting Access-Control-Allow-Origin
    await next()
    if (isApiOrAdmin && c.res) {
      const existingVary = c.res.headers.get('Vary') || ''
      if (!existingVary.toLowerCase().split(',').map(v => v.trim()).includes('origin')) {
        c.header('Vary', 'Origin', { append: true })
      }
    }
    return
  }

  const corsMiddleware = cors({
    origin: requestOrigin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-R59-Client', 'Idempotency-Key'],
    exposeHeaders: ['Content-Length', 'X-Requested-With'],
    credentials: false,
  })
  return corsMiddleware(c, next)
})

function getCorpPolicy(c: Context<{ Bindings: Bindings }>): string {
  return c.env?.ENVIRONMENT === 'development' ? 'cross-origin' : 'same-origin'
}

async function isActivePortfolioMediaKey(db: D1Database, effectiveKey: string): Promise<boolean> {
  try {
    const row = await db.prepare(
      'SELECT 1 AS found FROM Portfolio_Images WHERE is_active = 1 AND (media_key = ? OR media_key = ? OR media_key = ?) LIMIT 1'
    ).bind(effectiveKey, `/api/media/${effectiveKey}`, `/${effectiveKey}`).first()
    return Boolean(row)
  } catch {
    return false
  }
}

async function isActivePublicMediaKey(db: D1Database, effectiveKey: string): Promise<boolean> {
  if (await isActivePortfolioMediaKey(db, effectiveKey)) {
    return true
  }
  try {
    const escapedLikeKey = effectiveKey.replace(/[\\%_]/g, '\\$&')
    const serviceRow = await db.prepare(
      `SELECT 1 AS found FROM Services
       WHERE is_active = 1
         AND (image_url = ? OR image_url = ? OR image_url = ? OR image_url LIKE ? ESCAPE '\\')
       LIMIT 1`
    ).bind(
      effectiveKey,
      `/api/media/${effectiveKey}`,
      `/${effectiveKey}`,
      `%/api/media/${escapedLikeKey}`
    ).first()
    return Boolean(serviceRow)
  } catch {
    return false
  }
}

const mediaAuthMemo = new WeakMap<object, boolean>()

/**
 * Validates whether a media request is authorized (Finding 8).
 * Accepts valid HMAC signed URLs, valid non-revoked Admin session tokens,
 * active public portfolio/service media for /api/media/*, or media-viewer / active portfolio for /assets/*.
 * Memoizes the decision per Request so middleware and route handlers do not re-query D1.
 */
async function isAuthorizedMediaRequest(c: Context<{ Bindings: Bindings }>, fileKey?: string): Promise<boolean> {
  if (mediaAuthMemo.has(c.req.raw)) {
    return mediaAuthMemo.get(c.req.raw)!
  }
  const authorized = await evaluateMediaAuthorization(c, fileKey)
  mediaAuthMemo.set(c.req.raw, authorized)
  return authorized
}

async function evaluateMediaAuthorization(c: Context<{ Bindings: Bindings }>, fileKey?: string): Promise<boolean> {
  let pathname = ''
  try {
    pathname = decodeURIComponent(new URL(c.req.url).pathname)
  } catch {
    return false
  }

  const exp = c.req.query('exp')
  const sig = c.req.query('sig')
  const width = parseMediaVariantWidth(c.req.query('w'))
  if (exp && sig) {
    const key = fileKey || pathname.replace(/^\/api\/media\//, '').replace(/^\/+/, '')
    const secret = await getMediaSigningSecret(c.env)
    const valid = secret ? await verifyMediaSignature(key, Number(exp), sig, secret, width) : false
    if (valid) return true
  }

  const clientHeader = c.req.header('X-R59-Client')
  const isApiMedia = pathname.startsWith('/api/media/') || Boolean(fileKey)

  // Fast-path non-API media assets (e.g. /assets/*) for media-viewer before D1 session/portfolio queries
  if (!isApiMedia && clientHeader === 'media-viewer') {
    return true
  }

  // Allow same-origin non-document subresource requests for static build/model assets
  if (!isApiMedia && (pathname.startsWith('/assets/') || pathname.startsWith('/models/'))) {
    const fetchDest = c.req.header('Sec-Fetch-Dest')
    const fetchSite = c.req.header('Sec-Fetch-Site')
    if (fetchDest !== 'document') {
      if (fetchSite === 'same-origin') {
        return true
      }
      if (!fetchSite) {
        const referer = c.req.header('Referer')
        if (referer) {
          try {
            if (new URL(referer).origin === new URL(c.req.url).origin) {
              return true
            }
          } catch {
            // Ignore malformed Referer header
          }
        }
      }
    }
  }

  const { token } = extractSessionToken(c)
  if (token) {
    const secret = getSigningSecret(c.env)
    if (secret && !(await isTokenRevokedInDb(c.env.DB, token))) {
      const session = await verifySessionToken(token, secret)
      if (session.valid) {
        const adminEmail = (c.env.ADMIN_EMAIL || '').trim().toLowerCase()
        const sessionEmail = session.email ? session.email.trim().toLowerCase() : ''
        if (adminEmail && sessionEmail && timingSafeEqual(sessionEmail, adminEmail)) {
          const validAfter = await getSessionsValidAfter(c.env.DB)
          if (!validAfter || session.issuedAt === undefined || session.issuedAt >= validAfter) {
            return true
          }
        }
      }
    }
  }

  if (isApiMedia) {
    const effectiveKey = (fileKey || pathname.replace(/^\/api\/media\//, '')).replace(/^\/+/, '')
    if (!effectiveKey || !c.env.DB) return false
    return await isActivePublicMediaKey(c.env.DB, effectiveKey)
  }

  if (pathname.startsWith('/assets/')) {
    const assetKey = pathname.replace(/^\/+/, '')
    if (assetKey && c.env.DB) {
      return await isActivePortfolioMediaKey(c.env.DB, assetKey)
    }
    return false
  }

  return false
}

// Block sourcemap files everywhere & protect media/model assets from standalone scraping & hotlinking
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)

  // Block .map sourcemap files everywhere
  if (url.pathname.endsWith('.map')) {
    return c.notFound()
  }

  // Favicon exemption: allow standard browser favicon loading
  if (url.pathname.startsWith('/favicon')) {
    return await next()
  }

  // Identify protected images (photos, artwork, portfolio media)
  const isProtectedImage =
    url.pathname.startsWith('/api/media/') ||
    /\.(webp|png|jpe?g)$/i.test(url.pathname)

  const is3DModel = /\.glb$/i.test(url.pathname)

  if ((isProtectedImage || is3DModel) && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
    // If request to /api/media/ includes signed parameters, verify signature
    if (url.pathname.startsWith('/api/media/')) {
      const expParam = url.searchParams.get('exp')
      const sigParam = url.searchParams.get('sig')
      if (expParam || sigParam) {
        const fileKey = decodeURIComponent(url.pathname.replace(/^\/api\/media\//, '')).replace(/^\/+/, '')
        const width = parseMediaVariantWidth(url.searchParams.get('w'))
        const secret = await getMediaSigningSecret(c.env)
        const isValid = secret && expParam && sigParam ? await verifyMediaSignature(fileKey, Number(expParam), sigParam, secret, width) : false
        if (!isValid) {
          return c.json({ status: 'error', code: 'UNAUTHORIZED', message: 'Invalid or expired media signature' }, 401)
        }
        await next()
        c.header('Cross-Origin-Resource-Policy', getCorpPolicy(c))
        c.header('Content-Disposition', 'inline')
        c.header('X-Content-Type-Options', 'nosniff')
        return
      }
    }

    const fetchDest = c.req.header('Sec-Fetch-Dest')
    const fetchSite = c.req.header('Sec-Fetch-Site')

    // Block direct navigation to assets via address bar or "Open image/link in new tab"
    if (fetchDest === 'document') {
      return c.redirect('/', 302)
    }

    // Keep cross-site requests blocked
    if (fetchSite === 'cross-site') {
      return c.text('Forbidden', 403)
    }

    // For non-API protected images (e.g. /assets/*.webp): enforce authorized in-memory fetch
    // carrying 'X-R59-Client: media-viewer', authenticated admin session, or active public portfolio asset.
    // /api/media/* checks edge cache first inside mediaGetHandler before running D1 authorization.
    if (isProtectedImage && !url.pathname.startsWith('/api/media/')) {
      const isAuthorizedClient = await isAuthorizedMediaRequest(c)
      if (!isAuthorizedClient) {
        return c.redirect('/', 302)
      }
    }
  }

  await next()

  if ((isProtectedImage || is3DModel) && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
    c.header('Cross-Origin-Resource-Policy', getCorpPolicy(c))
    c.header('Content-Disposition', 'inline')
    c.header('X-Content-Type-Options', 'nosniff')
  }
})

// Route /admin and /admin/* to Admin Dashboard static assets
app.get('/admin', (c) => {
  c.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  return c.redirect('/admin/', 301)
})

// Dedicated handler for Wasm assets: enforces application/wasm and prevents HTML fallback (Audit 1)
app.get('/admin/assets/wasm/*', async (c) => {
  if (!c.env.ASSETS) {
    return c.text('Internal server error.', 500)
  }
  const url = new URL(c.req.url)
  if (!url.pathname.endsWith('.wasm')) {
    return c.notFound()
  }
  const assetRes = await c.env.ASSETS.fetch(c.req.raw)
  if (!assetRes.ok || assetRes.status >= 300 || assetRes.headers.get('content-type')?.includes('text/html')) {
    return c.notFound()
  }
  const headers = new Headers(assetRes.headers)
  headers.set('Content-Type', 'application/wasm')
  headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(assetRes.body, {
    status: assetRes.status,
    statusText: assetRes.statusText,
    headers
  })
})

// Dedicated handlers for webpEncoder worker: enforces application/javascript and prevents HTML fallback (Audit 1)
app.get('/admin/assets/js/webpEncoder.worker.js', async (c) => {
  if (!c.env.ASSETS) {
    return c.text('Internal server error.', 500)
  }
  const assetRes = await c.env.ASSETS.fetch(c.req.raw)
  if (!assetRes.ok || assetRes.status >= 300 || assetRes.headers.get('content-type')?.includes('text/html')) {
    return c.notFound()
  }
  const headers = new Headers(assetRes.headers)
  headers.set('Content-Type', 'application/javascript')
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(assetRes.body, {
    status: assetRes.status,
    statusText: assetRes.statusText,
    headers
  })
})

app.get('/admin/assets/js/utils/webpEncoder.worker.js', async (c) => {
  if (!c.env.ASSETS) {
    return c.text('Internal server error.', 500)
  }
  const assetRes = await c.env.ASSETS.fetch(c.req.raw)
  if (!assetRes.ok || assetRes.status >= 300 || assetRes.headers.get('content-type')?.includes('text/html')) {
    return c.notFound()
  }
  const headers = new Headers(assetRes.headers)
  headers.set('Content-Type', 'application/javascript')
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(assetRes.body, {
    status: assetRes.status,
    statusText: assetRes.statusText,
    headers
  })
})

const STATIC_EXT_REGEX = /\.(css|js|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|json|glb|wasm|txt|xml)$/i

app.get('/admin/*', async (c) => {
  if (!c.env.ASSETS) {
    return c.text('Internal server error.', 500)
  }

  const url = new URL(c.req.url)

  // 1. Block internal documentation files (.md) from public access
  if (url.pathname.toLowerCase().endsWith('.md')) {
    return c.redirect('/admin/', 302)
  }

  // Block sourcemap files (.map)
  if (url.pathname.endsWith('.map')) {
    return c.notFound()
  }

  let assetRes: Response

  // 2. If requesting a static web asset with an extension (excluding html), fetch directly
  if (STATIC_EXT_REGEX.test(url.pathname)) {
    assetRes = await c.env.ASSETS.fetch(c.req.raw)
    // NEVER allow an HTML fallback to intercept static assets (Audit 1)
    if (!assetRes.ok || assetRes.status >= 300 || assetRes.headers.get('content-type')?.includes('text/html')) {
      return c.notFound()
    }
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
  // fetch /admin/ directly or return the body with 200 OK (strictly for HTML routes, never static assets)
  if (assetRes.status >= 300 && assetRes.status < 400) {
    if (STATIC_EXT_REGEX.test(url.pathname)) {
      return c.notFound()
    }
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
  const isCacheableStatic =
    /\.wasm$/i.test(url.pathname) ||
    (url.pathname.startsWith('/admin/assets/fonts/') && /\.(woff2|woff|ttf)$/i.test(url.pathname))
  headers.set(
    'Cache-Control',
    isCacheableStatic ? 'public, max-age=86400, stale-while-revalidate=604800' : 'no-store, no-cache, must-revalidate'
  )
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  if (url.pathname.endsWith('.wasm')) {
    headers.set('Content-Type', 'application/wasm')
  } else if (url.pathname.endsWith('/webpEncoder.worker.js') || url.pathname.endsWith('.js')) {
    headers.set('Content-Type', 'application/javascript')
  }
  const isProtectedAsset =
    !url.pathname.startsWith('/favicon') &&
    (url.pathname.startsWith('/api/media/') || /\.(webp|png|jpe?g|glb)$/i.test(url.pathname))
  if (isProtectedAsset) {
    headers.set('Cross-Origin-Resource-Policy', getCorpPolicy(c))
    headers.set('Content-Disposition', 'inline')
    headers.set('X-Content-Type-Options', 'nosniff')
  }
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

// Public profile: no placeholder content. A field that was never saved is empty.
export const EMPTY_PROFILE = {
  bio: '',
  email: '',
  phone: '',
  location: '',
  travel: '',
  social: [] as { platform: string; url: string }[]
}

// Public studio profile endpoint
app.get('/api/profile', async (c) => {
  const bypassEdgeCache = shouldBypassPublicEdgeCache(c)
  const cacheControl = bypassEdgeCache ? 'no-store' : PUBLIC_READ_CACHE_CONTROL
  let cacheKeyUrl: string | null = null

  if (!bypassEdgeCache) {
    const version = await getPublicContentVersion(c.env.DB)
    cacheKeyUrl = buildEdgeCacheKey(c.req.url, version)
    const cached = await tryEdgeCacheMatch(cacheKeyUrl)
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: cached.headers
      })
    }
  }

  const respondProfile = (payload: Record<string, unknown>, cacheable = true) => {
    c.header('Cache-Control', cacheControl)
    const res = c.json(payload)
    if (cacheable && !bypassEdgeCache && cacheKeyUrl) {
      scheduleEdgeCachePut(getExecutionCtx(c), cacheKeyUrl, res)
    }
    return res
  }

  try {
    let row: { setting_value: string } | null = null
    if (c.env.DB) {
      try {
        row = await c.env.DB.prepare(
          "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'profile'"
        ).first<{ setting_value: string }>()
      } catch {}
    }

    // Defaults only when the profile setting has never been saved
    if (!row || row.setting_value === null || row.setting_value === undefined) {
      return respondProfile({
        ...DEFAULT_PROFILE,
        status: 'success',
        profile: DEFAULT_PROFILE,
        data: DEFAULT_PROFILE
      })
    }

    let parsed: any = null
    try {
      parsed = JSON.parse(row.setting_value)
    } catch {
      return respondProfile({
        ...DEFAULT_PROFILE,
        status: 'success',
        profile: DEFAULT_PROFILE,
        data: DEFAULT_PROFILE
      })
    }

    if (!parsed || typeof parsed !== 'object') {
      return respondProfile({
        ...DEFAULT_PROFILE,
        status: 'success',
        profile: DEFAULT_PROFILE,
        data: DEFAULT_PROFILE
      })
    }

    // Return admin-saved values as-is; if admin saved an empty string/empty array, return empty (no reviving defaults)
    const text = (value: unknown): string =>
      value === undefined || value === null ? '' : String(value)

    let socialList: { platform: string; url: string }[] = []
    if (Array.isArray(parsed.social)) {
      socialList = parsed.social
    } else if (parsed.social && typeof parsed.social === 'object') {
      socialList = Object.entries(parsed.social)
        .filter(([_, url]) => Boolean(url))
        .map(([platform, url]) => ({
          platform: platform.charAt(0).toUpperCase() + platform.slice(1),
          url: String(url)
        }))
    }

    const bio = text(parsed.bio)
    const email = text(parsed.email)
    const phone = text(parsed.phone)
    const location = text(parsed.location)
    const travel = text(parsed.travel)
    const social = socialList

    const profile = {
      bio,
      email,
      phone,
      location,
      travel,
      social
    }

    return respondProfile({
      ...profile,
      status: 'success',
      profile,
      data: profile
    })
  } catch {
    return respondProfile({
      ...DEFAULT_PROFILE,
      status: 'success',
      profile: DEFAULT_PROFILE,
      data: DEFAULT_PROFILE
    }, false)
  }
})

// Mount routes
app.route('/api/pricing', pricingRouter)
app.route('/api/coupons', couponsRouter)
app.route('/api/contact', contactRouter)
app.route('/api/leads', contactRouter)
app.route('/api/schedule', scheduleRouter)
app.route('/api/upload-url', uploadRouter)
app.route('/api/checkout', checkoutRouter)
app.route('/api/address-autocomplete', addressRouter)
app.route('/api/bookings', rescheduleRoutes)
app.route('/api/portfolio', portfolioRouter)
app.route('/api/services', servicesRouter)
app.route('/api/admin', adminRouter)
app.route('/api/webhook/square', squareWebhookRouter)
app.route('/api/square/webhook', squareWebhookRouter)

// D1 Media Storage Upload (admin only) — same limits the upload-url route advertises
const MEDIA_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
const MAX_MEDIA_BYTES = 50 * 1024 * 1024

// Public short-lived signed media token for active portfolio/service media
app.post('/api/media-token', async (c) => {
  try {
    const body = await c.req.json().catch(() => null)
    const rawKey = typeof body?.file_key === 'string' ? body.file_key.trim() : ''
    const fileKey = rawKey.replace(/^\/api\/media\//, '').replace(/^\/+/, '')
    if (!fileKey || fileKey.includes('..')) {
      return c.json({
        error: { code: 'BAD_REQUEST', message: 'Invalid or missing file_key', details: [] }
      }, 400)
    }

    if (!(await isActivePublicMediaKey(c.env.DB, fileKey))) {
      return c.json({
        error: { code: 'NOT_FOUND', message: 'Media not found', details: [] }
      }, 404)
    }

    const secret = await getMediaSigningSecret(c.env)
    if (!secret) {
      return c.json({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'Media signing secret is not configured.', details: [] }
      }, 500)
    }

    const width = parseMediaVariantWidth(body?.w)
    const { exp, sig } = await signMediaKey(fileKey, secret, 30, width)

    return c.json({
      url: `/api/media/${fileKey}?exp=${exp}&sig=${sig}${width ? `&w=${width}` : ''}`
    }, 200)
  } catch {
    return c.json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to generate signed media token', details: [] }
    }, 500)
  }
})

app.put('/api/media/*', adminAuth, async (c) => {
  const url = new URL(c.req.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/media\//, '')).replace(/^\/+/, '')
  if (!key || key.includes('..')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid media key', details: [] } }, 400)
  }

  const rawVariant = url.searchParams.get('variant')
  const variant = parseMediaVariantWidth(rawVariant)
  if (rawVariant !== null && rawVariant !== '' && !variant) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid variant width. Must be 640 or 1280.', details: [] } }, 400)
  }
  const storageKey = variant ? `${key}__w${variant}` : key

  const contentType = (c.req.header('Content-Type') || 'image/webp').split(';')[0].trim().toLowerCase()
  if (!MEDIA_CONTENT_TYPES.includes(contentType)) {
    return c.json({ error: { code: 'VALIDATION_FAILED', message: 'Only JPEG, PNG, WebP or HEIC images can be stored.', details: [] } }, 400)
  }

  const arrayBuffer = await c.req.arrayBuffer()
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    return c.json({ error: { code: 'VALIDATION_FAILED', message: 'No file data received.', details: [] } }, 400)
  }
  if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
    return c.json({ error: { code: 'FILE_TOO_LARGE', message: 'File size exceeds the 50 MB maximum limit.', details: [] } }, 413)
  }

  try {
    await replaceMediaStorageChunks(c.env.DB, storageKey, arrayBuffer, contentType)
    await bumpPublicContentVersion(c.env.DB)
    return c.json({ success: true, fileKey: storageKey, key: storageKey, baseKey: key, variant: variant ?? null }, 200)
  } catch (err: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to store image in database storage.',
        details: []
      }
    }, 500)
  }
})

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (Array.isArray(data)) return new Uint8Array(data)
  if (data && typeof data === 'object') return new Uint8Array(Object.values(data as Record<string, number>))
  return new Uint8Array(0)
}

function assembleChunks(rows: { data: unknown }[], expectedLength?: number): Uint8Array {
  const byteChunks: Uint8Array[] = []
  let totalLength = 0
  for (const row of rows) {
    const chunkArr = toUint8Array(row.data)
    byteChunks.push(chunkArr)
    totalLength += chunkArr.byteLength
  }
  const combined = new Uint8Array(expectedLength ?? totalLength)
  let offset = 0
  for (const chunk of byteChunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined
}

function matchesIfNoneMatch(headerValue: string | undefined, etag: string): boolean {
  if (!headerValue) return false
  const trimmed = headerValue.trim()
  if (trimmed === '*') return true
  return trimmed.split(',').some((part) => {
    const candidate = part.trim()
    return candidate === etag || candidate === `W/${etag}`
  })
}

function buildMediaSecurityHeaders(
  c: Context<{ Bindings: Bindings }>,
  cacheControl: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    'Cache-Control': cacheControl,
    'Cross-Origin-Resource-Policy': getCorpPolicy(c),
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  }
}

// D1 Media Storage Retrieval handler supporting HTTP Range 512KB chunk streaming, ETag/304, Edge Cache, and HMAC signed URLs
const mediaGetHandler = async (c: Context<{ Bindings: Bindings }>) => {
  const fileKeyParam = c.req.param('file_key')
  const url = new URL(c.req.url)
  const fileKey = fileKeyParam
    ? decodeURIComponent(fileKeyParam).replace(/^\/+/, '')
    : decodeURIComponent(url.pathname.replace(/^\/api\/media\//, '')).replace(/^\/+/, '')

  if (!fileKey || fileKey.includes('..')) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid media key' }, 400)
  }

  const exp = c.req.query('exp')
  const sig = c.req.query('sig')
  const width = parseMediaVariantWidth(c.req.query('w'))
  const hasSignedParams = Boolean(exp || sig)

  if (hasSignedParams) {
    const secret = await getMediaSigningSecret(c.env)
    const isValid = secret && exp && sig ? await verifyMediaSignature(fileKey, Number(exp), sig, secret, width) : false
    if (!isValid) {
      return c.json({ status: 'error', code: 'UNAUTHORIZED', message: 'Invalid or expired media signature' }, 401)
    }
  } else {
    const fetchDest = c.req.header('Sec-Fetch-Dest')
    const fetchSite = c.req.header('Sec-Fetch-Site')
    if (fetchDest === 'document') {
      return c.redirect('/', 302)
    }
    if (fetchSite === 'cross-site') {
      return c.text('Forbidden', 403)
    }
  }

  const rangeHeader = c.req.header('Range')
  const ifNoneMatch = c.req.header('If-None-Match')
  const hasAuthCredentials = hasSignedParams || shouldBypassPublicEdgeCache(c)
  const isPublicAsset = c.env.DB ? await isActivePublicMediaKey(c.env.DB, fileKey) : false

  // Verify authorization for non-public or unsigned requests before touching caches.default
  if (!hasSignedParams && !isPublicAsset) {
    const isAuthorizedClient = await isAuthorizedMediaRequest(c, fileKey)
    if (!isAuthorizedClient) {
      return c.redirect('/', 302)
    }
  }

  // Only verified public (is_active = 1) media without admin cookies or signed-URL params may use caches.default
  const isPublicCacheable = !hasAuthCredentials && isPublicAsset
  const versionParam = (c.req.query('v') || '').trim()
  const mediaCacheControl = isPublicCacheable
    ? (versionParam ? MEDIA_VERSIONED_CACHE_CONTROL : MEDIA_CACHE_CONTROL)
    : MEDIA_PRIVATE_CACHE_CONTROL

  let cacheKeyUrl: string | null = null
  if (isPublicCacheable) {
    const version = await getPublicContentVersion(c.env.DB)
    cacheKeyUrl = buildEdgeCacheKey(c.req.url, version, { stripAuthParams: true })

    // Check Cloudflare Worker Edge Cache only for verified public media
    const cachedRes = await tryEdgeCacheMatch(cacheKeyUrl)
    if (cachedRes) {
      const cachedEtag = cachedRes.headers.get('ETag') || ''
      if (cachedEtag && matchesIfNoneMatch(ifNoneMatch, cachedEtag)) {
        return new Response(null, {
          status: 304,
          headers: buildMediaSecurityHeaders(c, mediaCacheControl, { ETag: cachedEtag })
        })
      }

      if (rangeHeader) {
        const cachedBuf = new Uint8Array(await cachedRes.arrayBuffer())
        const parsedRange = parseRangeHeader(rangeHeader, cachedBuf.byteLength)
        if (parsedRange === 'unsatisfiable') {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${cachedBuf.byteLength}`,
              'Accept-Ranges': 'bytes'
            }
          })
        }
        if (parsedRange) {
          const { start, end } = parsedRange
          const slice = cachedBuf.subarray(start, end + 1)
          return new Response(slice, {
            status: 206,
            headers: buildMediaSecurityHeaders(c, mediaCacheControl, {
              'Content-Type': cachedRes.headers.get('Content-Type') || 'image/webp',
              'Content-Range': `bytes ${start}-${end}/${cachedBuf.byteLength}`,
              'Content-Length': String(slice.byteLength),
              'Accept-Ranges': 'bytes',
              ...(cachedEtag ? { ETag: cachedEtag } : {})
            })
          })
        }
      }

      return new Response(cachedRes.body, {
        status: 200,
        headers: buildMediaSecurityHeaders(c, mediaCacheControl, {
          'Content-Type': cachedRes.headers.get('Content-Type') || 'image/webp',
          ...(cachedRes.headers.get('Content-Length')
            ? { 'Content-Length': cachedRes.headers.get('Content-Length')! }
            : {}),
          'Accept-Ranges': 'bytes',
          ...(cachedEtag ? { ETag: cachedEtag } : {})
        })
      })
    }
  }

  try {
    // Query chunk metadata first without transferring BLOB data; check variant first and fall back to original
    type ChunkMetaRow = { chunk_index: number; chunk_size: number; content_type: string; created_at: string | null }
    let resolvedStorageKey = fileKey
    let metaRows: { results?: ChunkMetaRow[] } | null = null

    if (width) {
      const variantKey = `${fileKey}__w${width}`
      const variantMeta = await c.env.DB.prepare(
        'SELECT chunk_index, length(data) AS chunk_size, content_type, created_at FROM Media_Storage WHERE file_key = ? ORDER BY chunk_index ASC'
      ).bind(variantKey).all<ChunkMetaRow>()
      if (variantMeta?.results && variantMeta.results.length > 0) {
        resolvedStorageKey = variantKey
        metaRows = variantMeta
      }
    }

    if (!metaRows) {
      metaRows = await c.env.DB.prepare(
        'SELECT chunk_index, length(data) AS chunk_size, content_type, created_at FROM Media_Storage WHERE file_key = ? ORDER BY chunk_index ASC'
      ).bind(fileKey).all<ChunkMetaRow>()
      resolvedStorageKey = fileKey
    }

    if (metaRows?.results && metaRows.results.length > 0) {
      let runningOffset = 0
      const chunkMeta = metaRows.results.map((r) => {
        const size = Number(r.chunk_size || 0)
        const entry = {
          chunkIndex: Number(r.chunk_index),
          start: runningOffset,
          end: runningOffset + size - 1,
          size
        }
        runningOffset += size
        return entry
      })
      const totalLength = runningOffset

      if (totalLength === 0) {
        return c.notFound()
      }

      const contentType = metaRows.results[0].content_type || 'image/webp'
      const createdAt = metaRows.results[0].created_at ?? ''
      const etag = `"media-${encodeURIComponent(resolvedStorageKey)}-${totalLength}-${createdAt}"`

      if (matchesIfNoneMatch(ifNoneMatch, etag)) {
        return new Response(null, {
          status: 304,
          headers: buildMediaSecurityHeaders(c, mediaCacheControl, { ETag: etag })
        })
      }

      // HTTP Range handling: fetch only overlapping chunk_index bounds from D1
      if (rangeHeader) {
        const parsedRange = parseRangeHeader(rangeHeader, totalLength)
        if (parsedRange === 'unsatisfiable') {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${totalLength}`,
              'Accept-Ranges': 'bytes'
            }
          })
        }
        if (parsedRange) {
          const { start, end } = parsedRange
          const needed = chunkMeta.filter((m) => m.size > 0 && m.end >= start && m.start <= end)
          if (needed.length === 0) {
            return c.notFound()
          }
          const minChunkIndex = needed[0].chunkIndex
          const maxChunkIndex = needed[needed.length - 1].chunkIndex
          const firstChunkStart = needed[0].start

          const rangeRows = await c.env.DB.prepare(
            'SELECT chunk_index, data FROM Media_Storage WHERE file_key = ? AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index ASC'
          ).bind(resolvedStorageKey, minChunkIndex, maxChunkIndex).all<{ chunk_index: number; data: unknown }>()

          if (!rangeRows?.results || rangeRows.results.length === 0) {
            return c.notFound()
          }

          const neededCombined = assembleChunks(rangeRows.results)
          const slice = neededCombined.subarray(start - firstChunkStart, end - firstChunkStart + 1)
          return new Response(slice, {
            status: 206,
            headers: buildMediaSecurityHeaders(c, mediaCacheControl, {
              'Content-Type': contentType,
              'Content-Range': `bytes ${start}-${end}/${totalLength}`,
              'Content-Length': String(slice.byteLength),
              'Accept-Ranges': 'bytes',
              ETag: etag
            })
          })
        }
      }

      const dataRows = await c.env.DB.prepare(
        'SELECT chunk_index, data FROM Media_Storage WHERE file_key = ? ORDER BY chunk_index ASC'
      ).bind(resolvedStorageKey).all<{ chunk_index: number; data: unknown }>()

      if (!dataRows?.results || dataRows.results.length === 0) {
        return c.notFound()
      }

      const combined = assembleChunks(dataRows.results, totalLength)
      const res200 = new Response(combined, {
        status: 200,
        headers: buildMediaSecurityHeaders(c, mediaCacheControl, {
          'Content-Type': contentType,
          'Content-Length': String(totalLength),
          'Accept-Ranges': 'bytes',
          ETag: etag
        })
      })

      if (isPublicCacheable && cacheKeyUrl) {
        scheduleEdgeCachePut(getExecutionCtx(c), cacheKeyUrl, res200)
      }

      return res200
    }
  } catch (dbErr) {
    // Media_Storage table may not exist yet or query error
  }

  return c.notFound()
}

app.get('/api/media/:file_key', mediaGetHandler)
app.get('/api/media/:file_key{.*}', mediaGetHandler)
app.get('/api/media/*', mediaGetHandler)

const MAX_EARLY_HINT_LINKS = 3
let cachedEarlyHintEtag = ''
let cachedEarlyHintLinks: string[] | null = null

function stripVaryOrigin(headers: Headers): void {
  const vary = headers.get('Vary')
  if (!vary) return
  const remaining = vary
    .split(',')
    .map(v => v.trim())
    .filter(v => v && v.toLowerCase() !== 'origin')
  if (remaining.length > 0) {
    headers.set('Vary', remaining.join(', '))
  } else {
    headers.delete('Vary')
  }
}

const HTML_ATTR_REGEXES = {
  rel: /(?:^|\s)rel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/i,
  href: /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/i,
  as: /(?:^|\s)as\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/i
} as const

function getHtmlAttr(tag: string, attrName: keyof typeof HTML_ATTR_REGEXES): string | null {
  const match = tag.match(HTML_ATTR_REGEXES[attrName])
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null
}

function extractEarlyHintLinks(html: string): string[] {
  const styleHints: string[] = []
  const fontHints: string[] = []
  const seenHrefs = new Set<string>()
  const linkTags = html.match(/<link\b[^>]*>/gi) || []

  for (const tag of linkTags) {
    const relTokens = (getHtmlAttr(tag, 'rel') || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    const href = (getHtmlAttr(tag, 'href') || '').trim()
    if (!href || !href.startsWith('/assets/') || /[\s<>;"'\r\n]/.test(href) || seenHrefs.has(href)) continue

    if (relTokens.includes('stylesheet') && (/\.css(?:$|[?#])/i.test(href) || !href.includes('.'))) {
      seenHrefs.add(href)
      const crossoriginAttr = /\bcrossorigin\b/i.test(tag) ? '; crossorigin' : ''
      styleHints.push(`<${href}>; rel=preload; as=style${crossoriginAttr}`)
    } else if (relTokens.includes('preload')) {
      const asAttr = (getHtmlAttr(tag, 'as') || '').trim().toLowerCase()
      if ((asAttr === 'font' || /\.woff2(?:$|[?#])/i.test(href)) && /\.woff2(?:$|[?#])/i.test(href)) {
        seenHrefs.add(href)
        fontHints.push(`<${href}>; rel=preload; as=font; type=font/woff2; crossorigin`)
      }
    }
  }

  return [...styleHints.slice(0, 1), ...fontHints.slice(0, 2), ...styleHints.slice(1)].slice(0, MAX_EARLY_HINT_LINKS)
}

app.get('*', async (c) => {
  const url = new URL(c.req.url)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return c.json({ status: 'error', code: 'NOT_FOUND', message: 'API endpoint not found' }, 404)
  }
  if (!c.env.ASSETS) {
    return c.text('R59 Media API is running!')
  }
  if (url.pathname.toLowerCase().endsWith('.md') || url.pathname.endsWith('.map')) {
    return c.notFound()
  }

  // Strict check on static assets matching protected media types
  const isProtectedImage =
    !url.pathname.startsWith('/favicon') &&
    (url.pathname.startsWith('/api/media/') || /\.(webp|png|jpe?g)$/i.test(url.pathname))

  const is3DModel = /\.glb$/i.test(url.pathname)
  const isProtectedAsset = isProtectedImage || is3DModel

  if (isProtectedImage) {
    const isAuthorizedClient = await isAuthorizedMediaRequest(c)
    if (!isAuthorizedClient) {
      return c.redirect('/', 302)
    }
  }

  const isHashedAsset = url.pathname.startsWith('/assets/') && STATIC_EXT_REGEX.test(url.pathname)
  const isModelAsset = (url.pathname.startsWith('/models/') || is3DModel) && STATIC_EXT_REGEX.test(url.pathname)
  const isEdgeCacheableAsset =
    (isHashedAsset || isModelAsset) &&
    c.req.method === 'GET' &&
    !c.req.header('Range')
  const edgeCacheKeyUrl = isEdgeCacheableAsset ? `${url.origin}${url.pathname}` : null

  if (edgeCacheKeyUrl) {
    const cached = await tryEdgeCacheMatch(edgeCacheKeyUrl)
    if (cached) {
      const headers = new Headers(cached.headers)
      headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
      if (isProtectedAsset) {
        headers.set('Cross-Origin-Resource-Policy', getCorpPolicy(c))
        headers.set('Content-Disposition', 'inline')
        headers.set('X-Content-Type-Options', 'nosniff')
      }
      stripVaryOrigin(headers)
      const cachedEtag = headers.get('ETag') || ''
      if (cachedEtag && matchesIfNoneMatch(c.req.header('If-None-Match'), cachedEtag)) {
        return new Response(null, { status: 304, headers })
      }
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers
      })
    }
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
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  if (isProtectedAsset) {
    headers.set('Cross-Origin-Resource-Policy', getCorpPolicy(c))
    headers.set('Content-Disposition', 'inline')
    headers.set('X-Content-Type-Options', 'nosniff')
  }
  stripVaryOrigin(headers)

  const contentType = (headers.get('content-type') || '').toLowerCase()
  const isHtmlResponse = contentType.includes('text/html')

  if (assetRes.ok && !isHtmlResponse) {
    if (isHashedAsset) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    } else if (isModelAsset && !(headers.get('Cache-Control') || '').includes('immutable')) {
      headers.set('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400')
    }
  }

  if (assetRes.ok && isHtmlResponse) {
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
    const etag = headers.get('etag') || ''
    let hints: string[]
    if (etag && cachedEarlyHintLinks && cachedEarlyHintEtag === etag) {
      hints = cachedEarlyHintLinks
    } else {
      const html = await assetRes.clone().text()
      hints = extractEarlyHintLinks(html)
      if (etag) {
        cachedEarlyHintEtag = etag
        cachedEarlyHintLinks = hints
      }
    }
    for (const hint of hints) {
      headers.append('Link', hint)
    }
  }

  const responseToReturn = new Response(assetRes.body, {
    status: assetRes.status,
    statusText: assetRes.statusText,
    headers
  })

  if (edgeCacheKeyUrl && assetRes.status === 200 && !isHtmlResponse) {
    const cacheHeaders = new Headers(headers)
    stripVaryOrigin(cacheHeaders)
    const responseToCache = new Response(responseToReturn.clone().body, {
      status: assetRes.status,
      statusText: assetRes.statusText,
      headers: cacheHeaders
    })
    scheduleEdgeCachePut(getExecutionCtx(c), edgeCacheKeyUrl, responseToCache)
  }

  return responseToReturn
})

app.notFound((c) => {
  const url = new URL(c.req.url)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return c.json({ status: 'error', code: 'NOT_FOUND', message: 'API endpoint not found' }, 404)
  }
  return c.text('Not Found', 404)
})

export { app }

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyMaintenance(env.DB))
  }
}
