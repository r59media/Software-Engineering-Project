import { useEffect, useRef, useState, type CSSProperties } from 'react'

export interface ProtectedCanvasImageProps {
  src: string
  alt: string
  className?: string
  containerClassName?: string
  style?: CSSProperties
  objectPosition?: string
  width?: number
  height?: number
  eager?: boolean
  onError?: () => void
  onLoad?: () => void
}

const MAX_BLOB_CACHE_ENTRIES = 100
const MAX_BITMAP_CACHE_ENTRIES = 24
const blobCache = new Map<string, Blob>()
const bitmapCache = new Map<string, ImageBitmap>()
const inFlightFetches = new Map<string, Promise<Blob>>()

function cacheBlob(src: string, blob: Blob) {
  if (blobCache.has(src)) {
    blobCache.delete(src)
  } else if (blobCache.size >= MAX_BLOB_CACHE_ENTRIES) {
    const oldestKey = blobCache.keys().next().value
    if (oldestKey !== undefined) {
      blobCache.delete(oldestKey)
    }
  }
  blobCache.set(src, blob)
}

function cacheBitmap(src: string, bitmap: ImageBitmap) {
  const existing = bitmapCache.get(src)
  if (existing) {
    bitmapCache.delete(src)
    if (existing !== bitmap) {
      existing.close?.()
    }
  } else if (bitmapCache.size >= MAX_BITMAP_CACHE_ENTRIES) {
    const oldestKey = bitmapCache.keys().next().value
    if (oldestKey !== undefined) {
      const oldestBitmap = bitmapCache.get(oldestKey)
      bitmapCache.delete(oldestKey)
      oldestBitmap?.close?.()
    }
  }
  bitmapCache.set(src, bitmap)
}

function getCachedBitmap(src: string): ImageBitmap | undefined {
  const cached = bitmapCache.get(src)
  if (!cached) return undefined
  // Refresh LRU order on read
  bitmapCache.delete(src)
  bitmapCache.set(src, cached)
  return cached
}

function fetchProtectedBlob(src: string): Promise<Blob> {
  const cached = blobCache.get(src)
  if (cached) {
    cacheBlob(src, cached)
    return Promise.resolve(cached)
  }

  const inFlight = inFlightFetches.get(src)
  if (inFlight) {
    return inFlight
  }

  const request = fetch(src, {
    credentials: 'omit',
    headers: {
      'X-R59-Client': 'media-viewer',
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load protected media: ${response.status}`)
      }
      const blob = await response.blob()
      cacheBlob(src, blob)
      return blob
    })
    .finally(() => {
      inFlightFetches.delete(src)
    })

  inFlightFetches.set(src, request)
  return request
}

async function decodeBlobToBitmap(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob)
  }
  const img = new Image()
  const blobUrl = URL.createObjectURL(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = blobUrl
    })
    return await createImageBitmap(img)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

async function getOrDecodeBitmap(src: string): Promise<ImageBitmap> {
  const cached = getCachedBitmap(src)
  if (cached) return cached

  const blob = await fetchProtectedBlob(src)
  const rechecked = getCachedBitmap(src)
  if (rechecked) return rechecked

  const bitmap = await decodeBlobToBitmap(blob)
  cacheBitmap(src, bitmap)
  return bitmap
}

// eslint-disable-next-line react-refresh/only-export-components
export async function preloadProtectedImage(src: string): Promise<void> {
  if (!src) return
  try {
    await getOrDecodeBitmap(src)
  } catch {
    // Ignore preload failures; component mount will handle/report errors if needed
  }
}

function drawBitmapToCanvas(canvas: HTMLCanvasElement, bitmap: ImageBitmap): boolean {
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas.width = bitmap.width
    canvas.height = bitmap.height
  }
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    return true
  }
  return false
}

export function ProtectedCanvasImage({
  src,
  alt,
  className = '',
  containerClassName,
  style,
  objectPosition,
  width,
  height,
  eager = false,
  onError,
  onLoad,
}: ProtectedCanvasImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onErrorRef = useRef(onError)
  const onLoadRef = useRef(onLoad)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    onLoadRef.current = onLoad
  }, [onLoad])

  const [loadedSrc, setLoadedSrc] = useState<string | null>(() => (src && (bitmapCache.has(src) || blobCache.has(src)) ? src : null))
  const [errorSrc, setErrorSrc] = useState<string | null>(null)
  const isLoaded = Boolean(src) && (loadedSrc === src || bitmapCache.has(src) || blobCache.has(src))
  const hasError = Boolean(src && errorSrc === src)

  useEffect(() => {
    if (!src) return

    const abortController = new AbortController()
    const { signal } = abortController
    let observer: IntersectionObserver | null = null
    let rafId: number | null = null
    let started = false

    const renderBitmap = (bitmap: ImageBitmap) => {
      if (signal.aborted) return
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        if (drawBitmapToCanvas(canvas, bitmap)) {
          setLoadedSrc(src)
          onLoadRef.current?.()
        }
      } catch (err) {
        if (bitmapCache.get(src) === bitmap) {
          bitmapCache.delete(src)
          bitmap.close?.()
        }
        throw err
      }
    }

    async function loadImage() {
      if (started || signal.aborted) return
      started = true

      try {
        const cachedBitmap = getCachedBitmap(src)
        if (cachedBitmap) {
          renderBitmap(cachedBitmap)
          return
        }

        const bitmap = await getOrDecodeBitmap(src)
        if (signal.aborted) return

        rafId = requestAnimationFrame(() => {
          rafId = null
          try {
            renderBitmap(bitmap)
          } catch (err: unknown) {
            if (signal.aborted) return
            console.error('ProtectedCanvasImage load error:', err)
            setErrorSrc(src)
            onErrorRef.current?.()
          }
        })
      } catch (err: unknown) {
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          return
        }
        console.error('ProtectedCanvasImage load error:', err)
        setErrorSrc(src)
        onErrorRef.current?.()
      }
    }

    const canvas = canvasRef.current
    if (eager || bitmapCache.has(src) || blobCache.has(src) || typeof IntersectionObserver === 'undefined' || !canvas) {
      void loadImage()
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect()
            observer = null
            void loadImage()
          }
        },
        { rootMargin: '400px 0px' },
      )
      observer.observe(canvas)
    }

    return () => {
      abortController.abort()
      observer?.disconnect()
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [src, eager])

  const canvasStyle: CSSProperties = objectPosition ? { objectPosition } : {}

  return (
    <div
      className={`protected-media-container ${containerClassName || ''}`.trim()}
      style={style}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {!hasError && (
        <canvas
          ref={canvasRef}
          className={`protected-canvas ${isLoaded ? 'is-loaded' : ''} ${className}`.trim()}
          aria-label={alt}
          role="img"
          draggable={false}
          width={width}
          height={height}
          style={canvasStyle}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        />
      )}
      {/* THE SHIELD MUST BE RENDERED AFTER THE CANVAS SO IT IS ON TOP IN STACKING ORDER */}
      <div
        className="media-shield"
        aria-hidden="true"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      />
    </div>
  )
}
