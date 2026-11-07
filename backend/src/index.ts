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
import { squareWebhookRouter } from './routes/squareWebhook'
import { extractSessionToken, verifySessionToken, isTokenRevokedInDb, adminAuth } from './middleware/auth'

export type Bindings = {
  DB: D1Database
  ASSETS?: Fetcher
  SQUARE_ACCESS_TOKEN?: string
  SQUARE_ENVIRONMENT?: string
  SQUARE_LOCATION_ID?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  ADMIN_SECRET?: string
  ADMIN_EMAIL?: string
  ALLOWED_ORIGINS?: string
  SESSION_SECRET?: string
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string
  SQUARE_WEBHOOK_URL?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Request logging
app.use('*', logger())

// Global Security Headers
app.use('*', async (c, next) => {
  await next()
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.workers.dev; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
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
    allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-R59-Client'],
    exposeHeaders: ['Content-Length', 'X-Requested-With'],
    credentials: false,
  })
  return corsMiddleware(c, next)
})

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

    // For images: enforce authorized in-memory fetch carrying 'X-R59-Client: media-viewer'
    // OR authenticated admin session (allows Admin dashboard to display, preview, and replace photos)
    if (isProtectedImage) {
      const clientHeader = c.req.header('X-R59-Client')
      const token = extractSessionToken(c)
      const isAuthorizedClient = clientHeader === 'media-viewer' || Boolean(token)
      if (!isAuthorizedClient) {
        return c.redirect('/', 302)
      }
    }
  }

  await next()

  if ((isProtectedImage || is3DModel) && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    c.header('Content-Disposition', 'inline')
    c.header('X-Content-Type-Options', 'nosniff')
  }
})

// Route /admin and /admin/* to Admin Dashboard static assets
app.get('/admin', (c) => {
  return c.redirect('/admin/', 301)
})

const STATIC_EXT_REGEX = /\.(css|js|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|json|glb)$/i
const GATED_ADMIN_SCRIPT_REGEX = /^\/admin\/assets\/js\/(pages\/|utils\/webpConverter\.js|api\/(bookingsApi|dashboardApi|packagesApi|paymentsApi|personalApi|photographyApi|scheduleApi)\.js)/i

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

  // Gate sensitive admin scripts behind valid authentication
  if (GATED_ADMIN_SCRIPT_REGEX.test(url.pathname)) {
    const token = extractSessionToken(c)
    const secret = c.env.ADMIN_SECRET
    const signingSecret = c.env.SESSION_SECRET || secret || ''
    const isAuthed = Boolean(
      token &&
      signingSecret &&
      !(await isTokenRevokedInDb(c.env.DB, token)) &&
      (await verifySessionToken(token, signingSecret)).valid
    )
    if (!isAuthed) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        }
      })
    }
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
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  const isProtectedAsset =
    !url.pathname.startsWith('/favicon') &&
    (url.pathname.startsWith('/api/media/') || /\.(webp|png|jpe?g|glb)$/i.test(url.pathname))
  if (isProtectedAsset) {
    headers.set('Cross-Origin-Resource-Policy', 'same-origin')
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
  try {
    let parsed: any = null
    if (c.env.DB) {
      try {
        const row = await c.env.DB.prepare(
          "SELECT setting_value FROM Admin_Settings WHERE setting_key = 'profile'"
        ).first<{ setting_value: string }>()
        if (row?.setting_value) {
          parsed = JSON.parse(row.setting_value)
        }
      } catch {}
    }

    // A stored value (including '') is returned as stored; a missing or null field is empty
    const text = (value: unknown): string =>
      value === undefined || value === null ? '' : String(value).trim()

    const profile = {
      bio: text(parsed?.bio),
      email: text(parsed?.email),
      phone: text(parsed?.phone),
      location: text(parsed?.location),
      // The admin saves travel as a label (e.g. "Studio only"); keep that text instead of coercing it to true
      travel: parsed?.travel !== undefined && parsed?.travel !== null
        ? (typeof parsed.travel === 'string' ? parsed.travel : Boolean(parsed.travel))
        : EMPTY_PROFILE.travel,
      // No placeholder social links: an unsaved profile has none
      social: parsed?.social ?? []
    }

    c.header('Cache-Control', 'no-store')
    return c.json({
      status: 'success',
      profile,
      data: profile
    })
  } catch {
    const profile = { ...EMPTY_PROFILE, social: [] }
    return c.json({ status: 'success', profile, data: profile })
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
app.route('/api/square/webhook', squareWebhookRouter)

// D1 Media Storage Upload (admin only) — same limits the upload-url route advertises
const MEDIA_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
const MAX_MEDIA_BYTES = 50 * 1024 * 1024

app.put('/api/media/*', adminAuth, async (c) => {
  const url = new URL(c.req.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/media\//, '')).replace(/^\/+/, '')
  if (!key || key.includes('..')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid media key', details: [] } }, 400)
  }

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
    // 1. Ensure Media_Storage table exists in D1
    await c.env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS Media_Storage (file_key TEXT NOT NULL, chunk_index INTEGER NOT NULL, content_type TEXT NOT NULL DEFAULT \'image/webp\', data BLOB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (file_key, chunk_index))'
    ).run()

    // 2. Delete existing chunks for key
    await c.env.DB.prepare('DELETE FROM Media_Storage WHERE file_key = ?').bind(key).run()

    // 3. Chunk arrayBuffer into 512 KB pieces to stay well within D1 statement limits
    const CHUNK_SIZE = 512 * 1024
    const statements: D1PreparedStatement[] = []
    let chunkIndex = 0

    for (let offset = 0; offset < arrayBuffer.byteLength; offset += CHUNK_SIZE) {
      const chunk = new Uint8Array(arrayBuffer.slice(offset, offset + CHUNK_SIZE))
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)'
        ).bind(key, chunkIndex, contentType, chunk)
      )
      chunkIndex++
    }

    if (statements.length === 0) {
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO Media_Storage (file_key, chunk_index, content_type, data) VALUES (?, ?, ?, ?)'
        ).bind(key, 0, contentType, new Uint8Array(0))
      )
    }

    // Execute in batches of 50 to respect statement limits
    for (let i = 0; i < statements.length; i += 50) {
      await c.env.DB.batch(statements.slice(i, i + 50))
    }

    return c.json({ success: true, fileKey: key, key }, 200)
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

// D1 Media Storage Retrieval
app.get('/api/media/*', async (c) => {
  const fetchDest = c.req.header('Sec-Fetch-Dest')
  const fetchSite = c.req.header('Sec-Fetch-Site')
  if (fetchDest === 'document') {
    return c.redirect('/', 302)
  }
  if (fetchSite === 'cross-site') {
    return c.text('Forbidden', 403)
  }

  const clientHeader = c.req.header('X-R59-Client')
  const token = extractSessionToken(c)
  const isAuthorizedClient = clientHeader === 'media-viewer' || Boolean(token)
  if (!isAuthorizedClient) {
    return c.redirect('/', 302)
  }

  const url = new URL(c.req.url)
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/media\//, '')).replace(/^\/+/, '')
  if (!key || key.includes('..')) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid media key' }, 400)
  }

  try {
    const rows = await c.env.DB.prepare(
      'SELECT chunk_index, content_type, data FROM Media_Storage WHERE file_key = ? ORDER BY chunk_index ASC'
    ).bind(key).all<{ chunk_index: number; content_type: string; data: any }>()

    if (rows?.results && rows.results.length > 0) {
      const results = rows.results
      let totalLength = 0
      const byteChunks: Uint8Array[] = []

      for (const row of results) {
        let chunkArr: Uint8Array
        if (row.data instanceof Uint8Array) {
          chunkArr = row.data
        } else if (row.data instanceof ArrayBuffer) {
          chunkArr = new Uint8Array(row.data)
        } else if (ArrayBuffer.isView(row.data)) {
          chunkArr = new Uint8Array(row.data.buffer, row.data.byteOffset, row.data.byteLength)
        } else if (Array.isArray(row.data)) {
          chunkArr = new Uint8Array(row.data)
        } else if (row.data && typeof row.data === 'object') {
          chunkArr = new Uint8Array(Object.values(row.data as Record<string, number>))
        } else {
          chunkArr = new Uint8Array(0)
        }
        byteChunks.push(chunkArr)
        totalLength += chunkArr.byteLength
      }

      const combined = new Uint8Array(totalLength)
      let currentOffset = 0
      for (const chunk of byteChunks) {
        combined.set(chunk, currentOffset)
        currentOffset += chunk.byteLength
      }

      const contentType = results[0].content_type || 'image/webp'
      return new Response(combined, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(totalLength),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Content-Disposition': 'inline',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    }
  } catch (dbErr) {
    // Media_Storage table may not exist yet or query error
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
    const clientHeader = c.req.header('X-R59-Client')
    const token = extractSessionToken(c)
    const isAuthorizedClient = clientHeader === 'media-viewer' || Boolean(token)
    if (!isAuthorizedClient) {
      return c.redirect('/', 302)
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
  if (isProtectedAsset) {
    headers.set('Cross-Origin-Resource-Policy', 'same-origin')
    headers.set('Content-Disposition', 'inline')
    headers.set('X-Content-Type-Options', 'nosniff')
  }
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
