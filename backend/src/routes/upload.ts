import { Hono } from 'hono'
import { Bindings } from '../index'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { adminAuth } from '../middleware/auth'

const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']

export const uploadRouter = new Hono<{ Bindings: Bindings }>()

// All upload routes require admin auth
uploadRouter.use('*', adminAuth)

uploadRouter.get('/', async (c) => {
  try {
    const filename = c.req.query('filename')
    const contentType = c.req.query('contentType') || 'image/jpeg'

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

    if (!c.env.CLOUDFLARE_ACCOUNT_ID || !c.env.R2_ACCESS_KEY_ID || !c.env.R2_SECRET_ACCESS_KEY) {
       return c.json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'R2 credentials are not configured on the server.',
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

    // Create unique key for the file
    const uniqueKey = `${Date.now()}-${filename}`

    const signedUrl = await getSignedUrl(
      S3,
      new PutObjectCommand({
        Bucket: 'r59-portfolio-images',
        Key: uniqueKey,
        ContentType: contentType
      }),
      { expiresIn: 3600 }
    )
    
    return c.json({ 
      uploadUrl: signedUrl,
      fileKey: uniqueKey
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
