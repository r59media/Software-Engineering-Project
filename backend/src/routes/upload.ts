import { Hono } from 'hono'
import { Bindings } from '../index'
import { adminAuth } from '../middleware/auth'

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB

export const uploadRouter = new Hono<{ Bindings: Bindings }>()

// POST: JSON body upload URL generation (admin only) - routes 100% to Cloudflare D1 media endpoint
uploadRouter.post('/', adminAuth, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
    const contentType = body.contentType || 'image/jpeg'
    const rawSize = body.fileSize ?? body.contentLength

    if (!filename) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Could not generate upload URL. Please provide a filename.',
          target: 'upload',
          details: [{ field: 'filename', message: 'Filename is required.', code: 'REQUIRED_FIELD' }]
        }
      }, 400)
    }

    // File-type whitelist
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return c.json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Only image files (JPEG, PNG, WebP, HEIC) are allowed.',
          target: 'upload',
          details: [{ field: 'contentType', message: `Type '${contentType}' is not permitted.`, code: 'INVALID_TYPE' }]
        }
      }, 400)
    }

    // Optional fileSize / contentLength validation (max 50 MB)
    if (rawSize !== undefined && rawSize !== null) {
      const sizeBytes = Number(rawSize)
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return c.json({
          error: {
            code: 'VALIDATION_FAILED',
            message: 'File size must be a positive number of bytes.',
            target: 'upload',
            details: [{ field: 'fileSize', message: 'Invalid file size.', code: 'INVALID_VALUE' }]
          }
        }, 400)
      }
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        return c.json({
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'File size exceeds the 50 MB maximum limit.',
            target: 'upload',
            details: [{ field: 'fileSize', message: 'Maximum allowed file size is 50 MB.', code: 'FILE_TOO_LARGE' }]
          }
        }, 400)
      }
    }

    // Sanitize filename to prevent directory traversal and overwrite attacks
    const cleanBaseName = filename.replace(/[^a-zA-Z0-9._-]/g, '').replace(/^\.+/, '')
    const safeFilename = cleanBaseName.length > 0 ? cleanBaseName : 'upload.webp'
    const uniqueKey = `portfolio/${Date.now()}-${crypto.randomUUID()}-${safeFilename}`

    const mediaPath = `/api/media/${uniqueKey}`

    return c.json({
      success: true,
      uploadUrl: mediaPath,
      fileKey: uniqueKey,
      key: uniqueKey,
      publicUrl: mediaPath,
      url: mediaPath,
      storage: 'd1',
      data: {
        uploadUrl: mediaPath,
        fileKey: uniqueKey,
        key: uniqueKey,
        publicUrl: mediaPath,
        url: mediaPath,
        storage: 'd1'
      }
    })
  } catch (e: any) {
    return c.json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while generating upload URL.',
        details: []
      }
    }, 500)
  }
})
