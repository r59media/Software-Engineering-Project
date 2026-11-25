import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

import { contactRouter } from './routes/contact'
import { scheduleRouter } from './routes/schedule'
import { uploadRouter } from './routes/upload'
import { checkoutRouter } from './routes/checkout'
import { getStudioProfile, portfolioRouter } from './routes/portfolio'
import { servicesRouter } from './routes/services'
import { adminRouter, DEFAULT_PROFILE, replaceMediaStorageChunks, ensurePhotoPermissionsColumns, ensureSchemaReady } from './routes/admin'
import { squareWebhookRouter } from './routes/squareWebhook'
import { pricingRouter, couponsRouter } from './routes/pricing'
import { rescheduleRoutes } from './routes/reschedule'
import { addressRouter } from './routes/address'
import { adminAuth, verifyAdminSessionRequest, getSigningSecret, getMediaSigningSecret } from './middleware/auth'
import { signMediaKey, verifyMediaSignature, parseRangeHeader, parseMediaVariantWidth } from './utils/signedUrl'
import { safeDecodeURIComponent, isAllowedMediaContentType } from './utils/validation'
import { handleValidatedMediaPut } from './utils/mediaUpload'
import {
  buildEdgeCacheKey,
  getExecutionCtx,
  getPublicContentVersion,
  MEDIA_CACHE_CONTROL,
  MEDIA_PRIVATE_CACHE_CONTROL,
  MEDIA_VERSIONED_CACHE_CONTROL,
  scheduleEdgeCachePut,
  shouldBypassPublicEdgeCache,
  tryEdgeCacheMatch,
  withPublicJsonCache
} from './lib/edgeCache'
import { runDailyMaintenance } from './lib/scheduleSync'
import { isEmailConfigured, sendOperationalAlertEmail } from './email'

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
  TURNSTILE_SECRET_KEY?: string
  PUBLIC_ORIGIN?: string
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
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js https://web.squarecdn.com https://sandbox.web.squarecdn.com; connect-src 'self' https://accounts.google.com/gsi/ https://connect.squareup.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com; frame-src https://accounts.google.com/gsi/ https://web.squarecdn.com https://sandbox.web.squarecdn.com; frame-ancestors 'self'; img-src 'self' data: blob: https://web.squarecdn.com https://sandbox.web.squarecdn.com; font-src 'self' https://fonts.gstatic.com data: https://web.squarecdn.com https://sandbox.web.squarecdn.com; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style https://web.squarecdn.com https://sandbox.web.squarecdn.com; worker-src 'self'; object-src 'none'; base-uri 'self'"
  )
  c.header('X-Frame-Options', 'SAMEORIGIN')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)')
  c.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
})

// CORS — restrict to known frontend origins and same-origin requests
app.use('*', async (c, next) => {
  const configuredOrigins = (c.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)

  const devOrigins = [
    'http://localhost:5173',
    'http://localhost:8787',
    'http://localhost:8000',
    'http://localhost:3000',
    'http://127.0.0.1:8000',
    'http://127.0.0.1:5500'
  ]
  const allowedOrigins = c.env.ENVIRONMENT === 'development'
    ? [...new Set([...configuredOrigins, ...devOrigins])]
    : configuredOrigins

  const requestOrigin = c.req.header('Origin') || ''
  const currentUrl = new URL(c.req.url)
  const isApiOrAdmin =
    currentUrl.pathname === '/api' ||
    currentUrl.pathname.startsWith('/api/') ||
    currentUrl.pathname === '/admin' ||
    currentUrl.pathname.startsWith('/admin/')

  const isAllowed = Boolean(
    requestOrigin &&
    requestOrigin !== 'null' &&
    (allowedOrigins.includes(requestOrigin) || requestOrigin === currentUrl.origin)
  )

  if (!isAllowed) {
    if (isApiOrAdmin) c.header('Vary', 'Origin')
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
  if (await isActivePortfolioMediaKey(db, effectiveKey)) return true
  try {
    const escapedLikeKey = effectiveKey.replace(/[\\%_]/g, '\\$&')
    const serviceRow = await db.prepare(
      `SELECT 1 AS found FROM Services
       WHERE is_active = 1
         AND (image_url = ? OR image_url = ? OR image_url = ? OR image_url LIKE ? ESCAPE '\\')
       LIMIT 1`
    ).bind(effectiveKey, `/api/media/${effectiveKey}`, `/${effectiveKey}`, `%/api/media/${escapedLikeKey}`).first()
    return Boolean(serviceRow)
  } catch {
    return false
  }
}

const mediaAuthMemo = new WeakMap<object, boolean>()

async function isAuthorizedMediaRequest(c: Context<{ Bindings: Bindings }>, fileKey?: string): Promise<boolean> {
  if (mediaAuthMemo.has(c.req.raw)) {
    return mediaAuthMemo.get(c.req.raw)!
  }
  const authorized = await evaluateMediaAuthorization(c, fileKey)
  mediaAuthMemo.set(c.req.raw, authorized)
  return authorized
}

function isSameOriginSubresource(c: Context<{ Bindings: Bindings }>): boolean {
  const fetchDest = c.req.header('Sec-Fetch-Dest')
  if (fetchDest === 'document') return false
  const fetchSite = c.req.header('Sec-Fetch-Site')
  if (fetchSite === 'same-origin') return true
  if (fetchSite) return false
  const referer = c.req.header('Referer')
  if (!referer) return false
  try {
    return new URL(referer).origin === new URL(c.req.url).origin
  } catch {
    return false
  }
}

async function evaluateMediaAuthorization(c: Context<{ Bindings: Bindings }>, fileKey?: string): Promise<boolean> {
  const pathname = safeDecodeURIComponent(new URL(c.req.url).pathname)
  if (pathname === null) return false

  const exp = c.req.query('exp')
  const sig = c.req.query('sig')
  const width = parseMediaVariantWidth(c.req.query('w'))
  if (exp && sig) {
    const key = fileKey || pathname.replace(/^\/api\/media\//, '').replace(/^\/+/, '')
    const secret = await getMediaSigningSecret(c.env)
    if (secret && (await verifyMediaSignature(key, Number(exp), sig, secret, width))) return true
  }

  const isApiMedia = pathname.startsWith('/api/media/') || Boolean(fileKey)
  if (!isApiMedia && (pathname.startsWith('/assets/') || pathname.startsWith('/models/'))) {
    if (isSameOriginSubresource(c)) return true
  }

  const adminSession = await verifyAdminSessionRequest(c)
  if (adminSession.ok) return true

  if (isApiMedia) {
    const effectiveKey = (fileKey || pathname.replace(/^\/api\/media\//, '')).replace(/^\/+/, '')
    return Boolean(effectiveKey && c.env.DB && (await isActivePublicMediaKey(c.env.DB, effectiveKey)))
  }

  if (pathname.startsWith('/assets/')) {
    const assetKey = pathname.replace(/^\/+/, '')
    return Boolean(assetKey && c.env.DB && (await isActivePortfolioMediaKey(c.env.DB, assetKey)))
  }

  return false
}

function attachMediaSecurityHeaders(c: Context<{ Bindings: Bindings }>): void {
  c.header('Cross-Origin-Resource-Policy', getCorpPolicy(c))
  if (!c.res?.headers.has('Content-Disposition')) {
    c.header('Content-Disposition', 'inline')
  }
  c.header('X-Content-Type-Options', 'nosniff')
}

// Block sourcemap files everywhere & protect media/model assets from standalone scraping & hotlinking
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  if (url.pathname.endsWith('.map')) return c.notFound()
  if (url.pathname.startsWith('/favicon')) return await next()

  const isProtectedImage = url.pathname.startsWith('/api/media/') || /\.(webp|png|jpe?g)$/i.test(url.pathname)
  const is3DModel = /\.glb$/i.test(url.pathname)
  const isMediaRead = (isProtectedImage || is3DModel) && (c.req.method === 'GET' || c.req.method === 'HEAD')

  if (isMediaRead) {
    if (url.pathname.startsWith('/api/media/')) {
      const expParam = url.searchParams.get('exp')
      const sigParam = url.searchParams.get('sig')
      if (expParam || sigParam) {
        const decodedKey = safeDecodeURIComponent(url.pathname.replace(/^\/api\/media\//, ''))
        if (decodedKey === null) {
          return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid media key' }, 400)
        }
        const fileKey = decodedKey.replace(/^\/+/, '')
        const width = parseMediaVariantWidth(url.searchParams.get('w'))
        const secret = await getMediaSigningSecret(c.env)
        const isValid = secret && expParam && sigParam
          ? await verifyMediaSignature(fileKey, Number(expParam), sigParam, secret, width)
          : false
        if (!isValid) {
          return c.json({ status: 'error', code: 'UNAUTHORIZED', message: 'Invalid or expired media signature' }, 401)
        }
        await next()
        attachMediaSecurityHeaders(c)
        return
      }
    }

    if (c.req.header('Sec-Fetch-Dest') === 'document') return c.redirect('/', 302)
    if (c.req.header('Sec-Fetch-Site') === 'cross-site') return c.text('Forbidden', 403)

    if (isProtectedImage && !url.pathname.startsWith('/api/media/')) {
      if (!(await isAuthorizedMediaRequest(c))) return c.redirect('/', 302)
    }
  }

  await next()
  if (isMediaRead) attachMediaSecurityHeaders(c)
})

// Route /admin and /admin/* to Admin Dashboard static assets
app.get('/admin', (c) => {
  c.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  return c.redirect('/admin/', 301)
})

async function serveAdminStaticAsset(
  c: Context<{ Bindings: Bindings }>,
  options: { contentType: string; cacheControl: string; requiredExtension?: string }
): Promise<Response> {
  if (!c.env.ASSETS) {
    return c.text('Internal server error.', 500)
  }
  if (options.requiredExtension && !new URL(c.req.url).pathname.endsWith(options.requiredExtension)) {
    return c.notFound()
  }
  const assetRes = await c.env.ASSETS.fetch(c.req.raw)
  if (!assetRes.ok || assetRes.status >= 300 || assetRes.headers.get('content-type')?.includes('text/html')) {
    return c.notFound()
  }
  const headers = new Headers(assetRes.headers)
  headers.set('Content-Type', options.contentType)
  headers.set('Cache-Control', options.cacheControl)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(assetRes.body, {
    status: assetRes.status,
    statusText: assetRes.statusText,
    headers
  })
}

const WASM_CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800'
const WORKER_JS_CACHE_CONTROL = 'no-store, no-cache, must-revalidate'

app.get('/admin/assets/wasm/*', (c) =>
  serveAdminStaticAsset(c, { contentType: 'application/wasm', cacheControl: WASM_CACHE_CONTROL, requiredExtension: '.wasm' })
)
app.get('/admin/assets/js/webpEncoder.worker.js', (c) =>
  serveAdminStaticAsset(c, { contentType: 'application/javascript', cacheControl: WORKER_JS_CACHE_CONTROL })
)
app.get('/admin/assets/js/utils/webpEncoder.worker.js', (c) =>
  serveAdminStaticAsset(c, { contentType: 'application/javascript', cacheControl: WORKER_JS_CACHE_CONTROL })
)

const STATIC_EXT_REGEX = /\.(css|js|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|json|glb|wasm|txt|xml)$/i

async function fetchAdminAssetOrFallback(c: Context<{ Bindings: Bindings }>, url: URL): Promise<Response | null> {
  const isStatic = STATIC_EXT_REGEX.test(url.pathname)
  let assetRes = isStatic
    ? await c.env.ASSETS!.fetch(c.req.raw)
    : await c.env.ASSETS!.fetch(new Request(new URL('/admin/', url.origin).toString(), { method: 'GET', headers: c.req.raw.headers }))

  if (isStatic && (!assetRes.ok || assetRes.status >= 300 || assetRes.headers.get('content-type')?.includes('text/html'))) {
    return null
  }

  if (assetRes.status >= 300 && assetRes.status < 400) {
    if (isStatic) return null
    const loc = assetRes.headers.get('Location')
    if (loc === '/admin/' || loc === url.pathname) {
      const directRes = await c.env.ASSETS!.fetch(
        new Request(new URL('/admin/', url.origin).toString(), { method: 'GET', headers: c.req.raw.headers })
      )
      if (directRes.status === 200) assetRes = directRes
    }
  }
  return assetRes
}

app.get('/admin/*', async (c) => {
  if (!c.env.ASSETS) return c.text('Internal server error.', 500)

  const url = new URL(c.req.url)
  if (url.pathname.toLowerCase().endsWith('.md')) return c.redirect('/admin/', 302)
  if (url.pathname.endsWith('.map')) return c.notFound()

  const assetRes = await fetchAdminAssetOrFallback(c, url)
  if (!assetRes) return c.notFound()

  const headers = new Headers(assetRes.headers)
  const isVersionedAdminAsset =
    (url.pathname.startsWith('/admin/assets/css/') || url.pathname.startsWith('/admin/assets/js/')) &&
    Boolean(url.searchParams.get('v')?.trim())
  const isCacheableStatic =
    /\.wasm$/i.test(url.pathname) ||
    (url.pathname.startsWith('/admin/assets/fonts/') && /\.(woff2|woff|ttf)$/i.test(url.pathname))
  headers.set(
    'Cache-Control',
    isVersionedAdminAsset
      ? 'public, max-age=31536000, immutable'
      : isCacheableStatic
        ? WASM_CACHE_CONTROL
        : WORKER_JS_CACHE_CONTROL
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
  return new Response(assetRes.body, { status: assetRes.status, statusText: assetRes.statusText, headers })
})

// API status endpoint
app.get('/api', (c) => {
  return c.json({ status: 'ok', message: 'R59 Media API is running!' })
})

// Healthcheck — returns only non-sensitive readiness flags, never secrets or row data
app.get('/api/health', async (c) => {
  try {
    if (!c.env?.DB) {
      return c.json({ status: 'error', db: false }, 503)
    }
    await c.env.DB.prepare('SELECT 1').first()

    const { results } = await c.env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('Services', 'Bookings', 'Schedule_Slots', 'Admin_Settings')"
    ).all<{ name: string }>()
    const present = new Set((results || []).map((r) => r.name))

    return c.json({
      status: 'ok',
      db: true,
      tables: {
        services: present.has('Services'),
        bookings: present.has('Bookings'),
        scheduleSlots: present.has('Schedule_Slots'),
        adminSettings: present.has('Admin_Settings')
      },
      config: {
        sessionSecret: Boolean(getSigningSecret(c.env)),
        square: Boolean(c.env.SQUARE_ACCESS_TOKEN && c.env.SQUARE_LOCATION_ID),
        email: isEmailConfigured(c.env)
      }
    })
  } catch {
    return c.json({ status: 'error', db: false }, 503)
  }
})

// Public studio profile endpoint
app.get('/api/profile', (c) =>
  withPublicJsonCache(
    c,
    async () => {
      const profile = await getStudioProfile(c.env.DB)
      return { ...profile, status: 'success', profile, data: profile }
    },
    () => ({ ...DEFAULT_PROFILE, status: 'success', profile: DEFAULT_PROFILE, data: DEFAULT_PROFILE })
  )
)

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

// Public short-lived signed media token for active portfolio/service media
app.post('/api/media-token', async (c) => {
  try {
    const body = await c.req.json().catch(() => null)
    const rawKey = typeof body?.file_key === 'string' ? body.file_key.trim() : ''
    const fileKey = rawKey.replace(/^\/api\/media\//, '').replace(/^\/+/, '')
    if (!fileKey || fileKey.includes('..')) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid or missing file_key', details: [] } }, 400)
    }

    if (!(await isActivePublicMediaKey(c.env.DB, fileKey))) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Media not found', details: [] } }, 404)
    }

    const secret = await getMediaSigningSecret(c.env)
    if (!secret) {
      return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Media signing secret is not configured.', details: [] } }, 500)
    }

    const width = parseMediaVariantWidth(body?.w)
    const { exp, sig } = await signMediaKey(fileKey, secret, 30, width)
    return c.json({ url: `/api/media/${fileKey}?exp=${exp}&sig=${sig}${width ? `&w=${width}` : ''}` }, 200)
  } catch {
    return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to generate signed media token', details: [] } }, 500)
  }
})

app.put('/api/media/*', adminAuth, async (c) => {
  const url = new URL(c.req.url)
  return handleValidatedMediaPut(c, url.pathname.replace(/^\/api\/media\//, ''))
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

function resolveSafeMediaDelivery(rawContentType: string | null | undefined): {
  contentType: string
  contentDisposition: 'inline' | 'attachment'
} {
  const normalized = (rawContentType || '').split(';')[0].trim().toLowerCase()
  if (isAllowedMediaContentType(normalized)) {
    return { contentType: normalized, contentDisposition: 'inline' }
  }
  return { contentType: 'application/octet-stream', contentDisposition: 'attachment' }
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

export async function resolveAndAuthorizeMedia(c: Context<{ Bindings: Bindings }>): Promise<
  | {
      ok: true
      fileKey: string
      width: 640 | 1280 | null
      rangeHeader: string | undefined
      ifNoneMatch: string | undefined
      isPublicCacheable: boolean
      mediaCacheControl: string
    }
  | { ok: false; response: Response }
> {
  const fileKeyParam = c.req.param('file_key')
  const url = new URL(c.req.url)
  const decodedKey = fileKeyParam
    ? safeDecodeURIComponent(fileKeyParam)
    : safeDecodeURIComponent(url.pathname.replace(/^\/api\/media\//, ''))
  if (decodedKey === null) {
    return { ok: false, response: c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid media key' }, 400) }
  }
  const fileKey = decodedKey.replace(/^\/+/, '')
  if (!fileKey || fileKey.includes('..')) {
    return { ok: false, response: c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid media key' }, 400) }
  }

  const exp = c.req.query('exp')
  const sig = c.req.query('sig')
  const width = parseMediaVariantWidth(c.req.query('w'))
  const hasSignedParams = Boolean(exp || sig)

  if (hasSignedParams) {
    const secret = await getMediaSigningSecret(c.env)
    const isValid = secret && exp && sig ? await verifyMediaSignature(fileKey, Number(exp), sig, secret, width) : false
    if (!isValid) {
      return { ok: false, response: c.json({ status: 'error', code: 'UNAUTHORIZED', message: 'Invalid or expired media signature' }, 401) }
    }
  } else {
    if (c.req.header('Sec-Fetch-Dest') === 'document') return { ok: false, response: c.redirect('/', 302) }
    if (c.req.header('Sec-Fetch-Site') === 'cross-site') return { ok: false, response: c.text('Forbidden', 403) }
  }

  const hasAuthCredentials = hasSignedParams || shouldBypassPublicEdgeCache(c)
  const isPublicAsset = c.env.DB ? await isActivePublicMediaKey(c.env.DB, fileKey) : false

  if (!hasSignedParams && !isPublicAsset && !(await isAuthorizedMediaRequest(c, fileKey))) {
    return { ok: false, response: c.redirect('/', 302) }
  }

  const isPublicCacheable = !hasAuthCredentials && isPublicAsset
  const versionParam = (c.req.query('v') || '').trim()
  const mediaCacheControl = isPublicCacheable
    ? (versionParam ? MEDIA_VERSIONED_CACHE_CONTROL : MEDIA_CACHE_CONTROL)
    : MEDIA_PRIVATE_CACHE_CONTROL

  return {
    ok: true,
    fileKey,
    width: width ?? null,
    rangeHeader: c.req.header('Range'),
    ifNoneMatch: c.req.header('If-None-Match'),
    isPublicCacheable,
    mediaCacheControl
  }
}

export async function tryServeMediaFromEdgeCache(
  c: Context<{ Bindings: Bindings }>,
  opts: { isPublicCacheable: boolean; mediaCacheControl: string; rangeHeader: string | undefined; ifNoneMatch: string | undefined }
): Promise<{ cacheKeyUrl: string | null; response: Response | null }> {
  if (!opts.isPublicCacheable) return { cacheKeyUrl: null, response: null }

  const version = await getPublicContentVersion(c.env.DB)
  const cacheKeyUrl = buildEdgeCacheKey(c.req.url, version, { stripAuthParams: true })
  const cachedRes = await tryEdgeCacheMatch(cacheKeyUrl)
  if (!cachedRes) return { cacheKeyUrl, response: null }

  const cachedEtag = cachedRes.headers.get('ETag') || ''
  if (cachedEtag && matchesIfNoneMatch(opts.ifNoneMatch, cachedEtag)) {
    return {
      cacheKeyUrl,
      response: new Response(null, {
        status: 304,
        headers: buildMediaSecurityHeaders(c, opts.mediaCacheControl, { ETag: cachedEtag })
      })
    }
  }

  if (opts.rangeHeader) {
    const cachedBuf = new Uint8Array(await cachedRes.arrayBuffer())
    const parsedRange = parseRangeHeader(opts.rangeHeader, cachedBuf.byteLength)
    if (parsedRange === 'unsatisfiable') {
      return {
        cacheKeyUrl,
        response: new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${cachedBuf.byteLength}`, 'Accept-Ranges': 'bytes' }
        })
      }
    }
    if (parsedRange) {
      const slice = cachedBuf.subarray(parsedRange.start, parsedRange.end + 1)
      const delivery = resolveSafeMediaDelivery(cachedRes.headers.get('Content-Type'))
      return {
        cacheKeyUrl,
        response: new Response(slice, {
          status: 206,
          headers: buildMediaSecurityHeaders(c, opts.mediaCacheControl, {
            'Content-Type': delivery.contentType,
            'Content-Disposition': delivery.contentDisposition,
            'Content-Range': `bytes ${parsedRange.start}-${parsedRange.end}/${cachedBuf.byteLength}`,
            'Content-Length': String(slice.byteLength),
            'Accept-Ranges': 'bytes',
            ...(cachedEtag ? { ETag: cachedEtag } : {})
          })
        })
      }
    }
  }

  const delivery = resolveSafeMediaDelivery(cachedRes.headers.get('Content-Type'))
  return {
    cacheKeyUrl,
    response: new Response(cachedRes.body, {
      status: 200,
      headers: buildMediaSecurityHeaders(c, opts.mediaCacheControl, {
        'Content-Type': delivery.contentType,
        'Content-Disposition': delivery.contentDisposition,
        ...(cachedRes.headers.get('Content-Length') ? { 'Content-Length': cachedRes.headers.get('Content-Length')! } : {}),
        'Accept-Ranges': 'bytes',
        ...(cachedEtag ? { ETag: cachedEtag } : {})
      })
    })
  }
}

type ChunkMetaRow = { chunk_index: number; chunk_size: number; content_type: string; created_at: string | null }

async function loadMediaChunkMeta(
  db: D1Database,
  fileKey: string,
  width: 640 | 1280 | null
): Promise<{ resolvedStorageKey: string; results: ChunkMetaRow[] } | null> {
  if (width) {
    const variantKey = `${fileKey}__w${width}`
    const variantMeta = await db.prepare(
      'SELECT chunk_index, length(data) AS chunk_size, content_type, created_at FROM Media_Storage WHERE file_key = ? ORDER BY chunk_index ASC'
    ).bind(variantKey).all<ChunkMetaRow>()
    if (variantMeta?.results && variantMeta.results.length > 0) {
      return { resolvedStorageKey: variantKey, results: variantMeta.results }
    }
  }

  const baseMeta = await db.prepare(
    'SELECT chunk_index, length(data) AS chunk_size, content_type, created_at FROM Media_Storage WHERE file_key = ? ORDER BY chunk_index ASC'
  ).bind(fileKey).all<ChunkMetaRow>()
  if (baseMeta?.results && baseMeta.results.length > 0) {
    return { resolvedStorageKey: fileKey, results: baseMeta.results }
  }
  return null
}

export async function buildMediaStreamResponse(
  c: Context<{ Bindings: Bindings }>,
  opts: {
    fileKey: string
    width: 640 | 1280 | null
    rangeHeader: string | undefined
    ifNoneMatch: string | undefined
    isPublicCacheable: boolean
    mediaCacheControl: string
    cacheKeyUrl: string | null
  }
): Promise<Response> {
  const meta = await loadMediaChunkMeta(c.env.DB, opts.fileKey, opts.width)
  if (!meta) return c.notFound()

  let runningOffset = 0
  const chunkMeta = meta.results.map((r) => {
    const size = Number(r.chunk_size || 0)
    const entry = { chunkIndex: Number(r.chunk_index), start: runningOffset, end: runningOffset + size - 1, size }
    runningOffset += size
    return entry
  })
  const totalLength = runningOffset
  if (totalLength === 0) return c.notFound()

  const delivery = resolveSafeMediaDelivery(meta.results[0].content_type)
  const etag = `"media-${encodeURIComponent(meta.resolvedStorageKey)}-${totalLength}-${meta.results[0].created_at ?? ''}"`
  if (matchesIfNoneMatch(opts.ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers: buildMediaSecurityHeaders(c, opts.mediaCacheControl, { ETag: etag }) })
  }

  if (opts.rangeHeader) {
    const parsedRange = parseRangeHeader(opts.rangeHeader, totalLength)
    if (parsedRange === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${totalLength}`, 'Accept-Ranges': 'bytes' } })
    }
    if (parsedRange) {
      const needed = chunkMeta.filter((m) => m.size > 0 && m.end >= parsedRange.start && m.start <= parsedRange.end)
      if (needed.length === 0) return c.notFound()
      const rangeRows = await c.env.DB.prepare(
        'SELECT chunk_index, data FROM Media_Storage WHERE file_key = ? AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index ASC'
      ).bind(meta.resolvedStorageKey, needed[0].chunkIndex, needed[needed.length - 1].chunkIndex).all<{ chunk_index: number; data: unknown }>()
      if (!rangeRows?.results || rangeRows.results.length === 0) return c.notFound()

      const slice = assembleChunks(rangeRows.results).subarray(parsedRange.start - needed[0].start, parsedRange.end - needed[0].start + 1)
      return new Response(slice, {
        status: 206,
        headers: buildMediaSecurityHeaders(c, opts.mediaCacheControl, {
          'Content-Type': delivery.contentType,
          'Content-Disposition': delivery.contentDisposition,
          'Content-Range': `bytes ${parsedRange.start}-${parsedRange.end}/${totalLength}`,
          'Content-Length': String(slice.byteLength),
          'Accept-Ranges': 'bytes',
          ETag: etag
        })
      })
    }
  }

  const dataRows = await c.env.DB.prepare(
    'SELECT chunk_index, data FROM Media_Storage WHERE file_key = ? ORDER BY chunk_index ASC'
  ).bind(meta.resolvedStorageKey).all<{ chunk_index: number; data: unknown }>()
  if (!dataRows?.results || dataRows.results.length === 0) return c.notFound()

  const res200 = new Response(assembleChunks(dataRows.results, totalLength), {
    status: 200,
    headers: buildMediaSecurityHeaders(c, opts.mediaCacheControl, {
      'Content-Type': delivery.contentType,
      'Content-Disposition': delivery.contentDisposition,
      'Content-Length': String(totalLength),
      'Accept-Ranges': 'bytes',
      ETag: etag
    })
  })
  if (opts.isPublicCacheable && opts.cacheKeyUrl) {
    scheduleEdgeCachePut(getExecutionCtx(c), opts.cacheKeyUrl, res200)
  }
  return res200
}

const mediaGetHandler = async (c: Context<{ Bindings: Bindings }>) => {
  const auth = await resolveAndAuthorizeMedia(c)
  if (!auth.ok) return auth.response

  const edge = await tryServeMediaFromEdgeCache(c, auth)
  if (edge.response) return edge.response

  try {
    return await buildMediaStreamResponse(c, { ...auth, cacheKeyUrl: edge.cacheKeyUrl })
  } catch (dbErr) {
    console.error('[media] D1 retrieval error:', dbErr)
    return c.json({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'Media storage temporarily unavailable' }, 503)
  }
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
  const remaining = vary.split(',').map(v => v.trim()).filter(v => v && v.toLowerCase() !== 'origin')
  if (remaining.length > 0) headers.set('Vary', remaining.join(', '))
  else headers.delete('Vary')
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

async function applyEarlyHintsHeaders(headers: Headers, assetRes: Response): Promise<void> {
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

function buildPublicAssetHeaders(
  c: Context<{ Bindings: Bindings }>,
  baseHeaders: Headers,
  isProtectedAsset: boolean
): Headers {
  const headers = new Headers(baseHeaders)
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  if (isProtectedAsset) {
    headers.set('Cross-Origin-Resource-Policy', getCorpPolicy(c))
    headers.set('Content-Disposition', 'inline')
    headers.set('X-Content-Type-Options', 'nosniff')
  }
  stripVaryOrigin(headers)
  return headers
}

async function handleAssetOrSpaFallback(c: Context<{ Bindings: Bindings }>, url: URL): Promise<Response> {
  const isProtectedImage =
    !url.pathname.startsWith('/favicon') &&
    (url.pathname.startsWith('/api/media/') || /\.(webp|png|jpe?g)$/i.test(url.pathname))
  const is3DModel = /\.glb$/i.test(url.pathname)
  const isProtectedAsset = isProtectedImage || is3DModel

  if (isProtectedImage && !(await isAuthorizedMediaRequest(c))) {
    return c.redirect('/', 302)
  }

  const isHashedAsset = url.pathname.startsWith('/assets/') && STATIC_EXT_REGEX.test(url.pathname)
  const isModelAsset = (url.pathname.startsWith('/models/') || is3DModel) && STATIC_EXT_REGEX.test(url.pathname)
  const edgeCacheKeyUrl =
    (isHashedAsset || isModelAsset) && c.req.method === 'GET' && !c.req.header('Range')
      ? `${url.origin}${url.pathname}`
      : null

  if (edgeCacheKeyUrl) {
    const cached = await tryEdgeCacheMatch(edgeCacheKeyUrl)
    if (cached) {
      const headers = buildPublicAssetHeaders(c, cached.headers, isProtectedAsset)
      const cachedEtag = headers.get('ETag') || ''
      if (cachedEtag && matchesIfNoneMatch(c.req.header('If-None-Match'), cachedEtag)) {
        return new Response(null, { status: 304, headers })
      }
      return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers })
    }
  }

  const rootUrl = new URL('/', url.origin)
  let assetRes = STATIC_EXT_REGEX.test(url.pathname)
    ? await c.env.ASSETS!.fetch(c.req.raw)
    : await c.env.ASSETS!.fetch(new Request(rootUrl.toString(), { method: 'GET', headers: c.req.raw.headers }))

  if (assetRes.status >= 300 && assetRes.status < 400) {
    const loc = assetRes.headers.get('Location')
    if (loc === '/' || loc === url.pathname) {
      const directRes = await c.env.ASSETS!.fetch(new Request(rootUrl.toString(), { method: 'GET', headers: c.req.raw.headers }))
      if (directRes.status === 200) assetRes = directRes
    }
  }

  const headers = buildPublicAssetHeaders(c, assetRes.headers, isProtectedAsset)
  const isHtmlResponse = (headers.get('content-type') || '').toLowerCase().includes('text/html')

  if (assetRes.ok && !isHtmlResponse) {
    if (isHashedAsset) headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    else if (isModelAsset && !(headers.get('Cache-Control') || '').includes('immutable')) {
      headers.set('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400')
    }
  }
  if (assetRes.ok && isHtmlResponse) {
    await applyEarlyHintsHeaders(headers, assetRes)
  }

  const responseToReturn = new Response(assetRes.body, { status: assetRes.status, statusText: assetRes.statusText, headers })
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
}

app.get('*', async (c) => {
  const url = new URL(c.req.url)
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return c.json({ status: 'error', code: 'NOT_FOUND', message: 'API endpoint not found' }, 404)
  }
  if (!c.env.ASSETS) return c.text('R59 Media API is running!')
  if (url.pathname.toLowerCase().endsWith('.md') || url.pathname.endsWith('.map')) return c.notFound()
  return handleAssetOrSpaFallback(c, url)
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
  async scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        try {
          if (!env?.DB) {
            console.error('[cron] Daily maintenance aborted: DB binding is missing')
            return
          }
          await runDailyMaintenance(env.DB, env)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error('[cron] Daily maintenance failed:', {
            cron: controller?.cron || 'unknown',
            error: message
          })
          await sendOperationalAlertEmail(
            env,
            'R59 Media Cron Maintenance Failed',
            `Scheduled daily maintenance failed (${controller?.cron || 'unknown'}):\n${message}`
          ).catch(() => {})
        }
      })()
    )
  }
}
