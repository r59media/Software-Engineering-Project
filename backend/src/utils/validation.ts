import type { Context } from 'hono'

/**
 * Decodes a URI component safely, returning null on malformed % escape sequences.
 */
export function safeDecodeURIComponent(value: string): string | null {
  if (typeof value !== 'string') return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * Parses a JSON request body and guarantees it is a plain JSON object (rejects malformed JSON, null, arrays, and primitives).
 */
export async function parseJsonObject(
  c: Context
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; response: Response }> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    return {
      ok: false,
      response: c.json(
        {
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid JSON request body.',
            details: []
          }
        },
        400
      )
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      response: c.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request body must be a JSON object.',
            details: []
          }
        },
        400
      )
    }
  }

  return { ok: true, data: raw as Record<string, unknown> }
}

/**
 * Validates positive integer string resource IDs (1..9999999999).
 */
export function isValidId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[1-9]\d{0,9}$/.test(raw)
}

/**
 * Validates a real YYYY-MM-DD calendar date (rejects invalid dates like 2026-02-30).
 */
export function isRealCalendarDate(iso: unknown): boolean {
  if (typeof iso !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

/**
 * Strips CR, LF, NUL, and ASCII control characters from header-bound strings to prevent header injection.
 */
export function stripHeaderNewlines(s: unknown): string {
  if (typeof s !== 'string') return ''
  return s.replace(/[\r\n\x00-\x1f\x7f]+/g, '')
}

export const MEDIA_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const
export type AllowedMediaContentType = (typeof MEDIA_CONTENT_TYPES)[number]
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024

/**
 * Checks whether a MIME content type is in the strict image upload/delivery allowlist.
 */
export function isAllowedMediaContentType(contentType: string): contentType is AllowedMediaContentType {
  return (MEDIA_CONTENT_TYPES as readonly string[]).includes(contentType.trim().toLowerCase())
}

function matchesImageMagicBytes(contentType: AllowedMediaContentType, bytes: Uint8Array): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case 'image/png':
      return (
        bytes.byteLength >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      )
    case 'image/webp':
      return (
        bytes.byteLength >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      )
    case 'image/heic':
      return (
        bytes.byteLength >= 12 &&
        bytes[4] === 0x66 &&
        bytes[5] === 0x74 &&
        bytes[6] === 0x79 &&
        bytes[7] === 0x70
      )
    default:
      return false
  }
}

export type MediaUploadValidationResult =
  | { ok: true; contentType: AllowedMediaContentType; bytes: Uint8Array }
  | { ok: false; status: 400 | 413; code: string; message: string }

/**
 * Validates media upload Content-Type, byte size limit, and magic-byte signature to prevent stored XSS.
 */
export function validateMediaUpload(
  rawContentType: string | undefined,
  rawData: ArrayBuffer | Uint8Array | null | undefined
): MediaUploadValidationResult {
  const normalizedType = (rawContentType || 'image/webp').split(';')[0].trim().toLowerCase()
  if (!isAllowedMediaContentType(normalizedType)) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Only JPEG, PNG, WebP or HEIC images can be stored.'
    }
  }

  const bytes =
    rawData instanceof Uint8Array
      ? rawData
      : rawData instanceof ArrayBuffer
        ? new Uint8Array(rawData)
        : new Uint8Array(0)

  if (bytes.byteLength === 0) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'No file data received.'
    }
  }

  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'FILE_TOO_LARGE',
      message: 'File size exceeds the 50 MB maximum limit.'
    }
  }

  if (!matchesImageMagicBytes(normalizedType, bytes)) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'File content does not match the declared image format.'
    }
  }

  return { ok: true, contentType: normalizedType, bytes }
}
