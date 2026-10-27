import { Hono } from 'hono'
import { Bindings } from '../index'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { adminAuth } from '../middleware/auth'

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024 // 15 MB

export const uploadRouter = new Hono<{ Bindings: Bindings }>()

// POST: JSON body upload URL generation (admin only)
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

    // Optional fileSize / contentLength validation (max 15 MB)
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
            message: 'File size exceeds the 15 MB maximum limit.',
            target: 'upload',
            details: [{ field: 'fileSize', message: 'Maximum allowed file size is 15 MB.', code: 'FILE_TOO_LARGE' }]
          }
        }, 400)
      }
    }

    if (!c.env.CLOUDFLARE_ACCOUNT_ID || !c.env.R2_ACCESS_KEY_ID || !c.env.R2_SECRET_ACCESS_KEY) {
      return c.json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Storage service is not configured on the server.',
          details: []
        }
      }, 500)
    }

    const S3 = new S3Client({
      region: 'auto',
      endpoint: `https://${c.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: c.env.R2_ACCESS_KEY_ID,
        secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      },
    })

    // Sanitize filename to prevent directory traversal and overwrite attacks
    const cleanBaseName = filename.replace(/[^a-zA-Z0-9._-]/g, '').replace(/^\.+/, '')
    const safeFilename = cleanBaseName.length > 0 ? cleanBaseName : 'upload.jpg'
    const uniqueKey = `portfolio/${Date.now()}-${crypto.randomUUID()}-${safeFilename}`

    const signedUrl = await getSignedUrl(
      S3,
      new PutObjectCommand({
        Bucket: 'r59-portfolio-images',
        Key: uniqueKey,
        ContentType: contentType
      }),
      { expiresIn: 300 }
    )

    return c.json({
      uploadUrl: signedUrl,
      fileKey: uniqueKey,
      key: uniqueKey,
      publicUrl: `/api/media/${uniqueKey}`,
      url: `/api/media/${uniqueKey}`
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
