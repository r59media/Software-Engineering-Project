import { useEffect, useState } from 'react'

const blobUrlCache = new Map<string, string>()

/**
 * Hydrates an image URL into an in-memory ephemeral Blob URL with Pinterest-style protection.
 * Prevents direct DOM exposure of asset URLs and attaches the custom media-viewer client header.
 */
export function useProtectedImage(rawUrl: string | undefined): string {
  const [resolvedBlobUrl, setResolvedBlobUrl] = useState<string | null>(null)
  const [prevRawUrl, setPrevRawUrl] = useState<string | undefined>(rawUrl)

  if (prevRawUrl !== rawUrl) {
    setPrevRawUrl(rawUrl)
    setResolvedBlobUrl(null)
  }

  useEffect(() => {
    if (!rawUrl || blobUrlCache.has(rawUrl) || rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) {
      return
    }

    const controller = new AbortController()
    let isMounted = true

    fetch(rawUrl, {
      headers: {
        'X-R59-Client': 'media-viewer',
      },
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Failed to load protected image: ${response.status}`)
        }
        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        blobUrlCache.set(rawUrl, objectUrl)
        if (isMounted) {
          setResolvedBlobUrl(objectUrl)
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return
        if (isMounted) {
          setResolvedBlobUrl(rawUrl)
        }
      })

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [rawUrl])

  if (!rawUrl) return ''
  const cached = blobUrlCache.get(rawUrl)
  if (cached) return cached
  if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) return rawUrl
  return resolvedBlobUrl ?? rawUrl
}
