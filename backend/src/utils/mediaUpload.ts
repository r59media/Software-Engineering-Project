import type { Context } from 'hono'
import type { Bindings } from '../index'
import { replaceMediaStorageChunks } from '../lib/billingSchema.ts'
import { bumpPublicContentVersion } from '../lib/edgeCache.ts'
import { parseMediaVariantWidth } from './signedUrl.ts'
import { safeDecodeURIComponent, validateMediaUpload } from './validation.ts'

/**
 * Shared handler for PUT /api/media/* and PUT /api/admin/media/*.
 * Safely decodes the key, validates variant width, enforces image MIME + magic bytes + size limits,
 * and atomically writes chunks to D1 Media_Storage.
 */
export async function handleValidatedMediaPut(
  c: Context<{ Bindings: Bindings }>,
  rawPathSuffix: string
): Promise<Response> {
  const decodedKey = safeDecodeURIComponent(rawPathSuffix)
  if (decodedKey === null) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid media key encoding', details: [] } }, 400)
  }

  const key = decodedKey.replace(/^\/+/, '')
  if (!key || key.includes('..')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid media key', details: [] } }, 400)
  }

  const url = new URL(c.req.url)
  const rawVariant = url.searchParams.get('variant')
  const variant = parseMediaVariantWidth(rawVariant)
  if (rawVariant !== null && rawVariant !== '' && !variant) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid variant width. Must be 640 or 1280.', details: [] } }, 400)
  }
  const storageKey = variant ? `${key}__w${variant}` : key

  const arrayBuffer = await c.req.arrayBuffer()
  const validation = validateMediaUpload(c.req.header('Content-Type'), arrayBuffer)
  if (!validation.ok) {
    return c.json({
      error: {
        code: validation.code,
        message: validation.message,
        details: []
      }
    }, validation.status)
  }

  try {
    await replaceMediaStorageChunks(c.env.DB, storageKey, arrayBuffer, validation.contentType)
    await bumpPublicContentVersion(c.env.DB)
    return c.json({ success: true, fileKey: storageKey, key: storageKey, baseKey: key, variant: variant ?? null }, 200)
  } catch {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to store image in database storage.',
        details: []
      }
    }, 500)
  }
}
