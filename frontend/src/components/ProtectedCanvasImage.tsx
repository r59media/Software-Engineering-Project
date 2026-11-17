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

type DrawableSource = ImageBitmap | HTMLImageElement

const MAX_BLOB_CACHE_ENTRIES = 100
const MAX_DRAWABLE_CACHE_ENTRIES = 24
const MAX_CANVAS_DIMENSION = 2048
const blobCache = new Map<string, Blob>()
const drawableCache = new Map<string, DrawableSource>()
const inFlightFetches = new Map<string, Promise<Blob>>()
const inFlightDecodes = new Map<string, Promise<DrawableSource>>()

function getDrawableDimensions(source: DrawableSource): { width: number; height: number } {
  if ('naturalWidth' in source) {
    return { width: source.naturalWidth, height: source.naturalHeight }
  }
  return { width: source.width, height: source.height }
}

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

function cacheDrawable(src: string, source: DrawableSource) {
  if (drawableCache.has(src)) {
    drawableCache.delete(src)
  } else if (drawableCache.size >= MAX_DRAWABLE_CACHE_ENTRIES) {
    const oldestKey = drawableCache.keys().next().value
    if (oldestKey !== undefined) {
      // Evict without calling .close() so any in-flight/queued drawImage doesn't hit InvalidStateError
      drawableCache.delete(oldestKey)
    }
  }
  drawableCache.set(src, source)
}

function getCachedDrawable(src: string): DrawableSource | undefined {
  const cached = drawableCache.get(src)
  if (!cached) return undefined
  const { width, height } = getDrawableDimensions(cached)
  if (width === 0 || height === 0) {
    drawableCache.delete(src)
    return undefined
  }
  // Refresh LRU order on read
  drawableCache.delete(src)
  drawableCache.set(src, cached)
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

async function decodeBlobToDrawable(blob: Blob): Promise<DrawableSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      // Fall back to decoded HTMLImageElement when createImageBitmap fails
    }
  }
  const img = new Image()
  const blobUrl = URL.createObjectURL(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = blobUrl
    })
    if (typeof img.decode === 'function') {
      await img.decode().catch(() => undefined)
    }
    return img
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

async function getOrDecodeDrawable(src: string): Promise<DrawableSource> {
  const cached = getCachedDrawable(src)
  if (cached) return cached

  const inFlight = inFlightDecodes.get(src)
  if (inFlight) return inFlight

  const decodePromise = (async () => {
    const blob = await fetchProtectedBlob(src)
    const rechecked = getCachedDrawable(src)
    if (rechecked) return rechecked

    const drawable = await decodeBlobToDrawable(blob)
    cacheDrawable(src, drawable)
    return drawable
  })().finally(() => {
    inFlightDecodes.delete(src)
  })

  inFlightDecodes.set(src, decodePromise)
  return decodePromise
}

// eslint-disable-next-line react-refresh/only-export-components
export async function preloadProtectedImage(src: string): Promise<void> {
  if (!src) return
  try {
    await getOrDecodeDrawable(src)
  } catch {
    // Ignore preload failures; component mount will handle/report errors if needed
  }
}

function drawDrawableToCanvas(canvas: HTMLCanvasElement, source: DrawableSource): boolean {
  const { width: srcW, height: srcH } = getDrawableDimensions(source)
  if (srcW === 0 || srcH === 0) {
    return false
  }
  const scale = Math.min(1, MAX_CANVAS_DIMENSION / Math.max(srcW, srcH))
  const targetW = Math.max(1, Math.round(srcW * scale))
  const targetH = Math.max(1, Math.round(srcH * scale))
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(source, 0, 0, targetW, targetH)
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

  const [loadedSrc, setLoadedSrc] = useState<string | null>(() => (src && (drawableCache.has(src) || blobCache.has(src)) ? src : null))
  const [errorSrc, setErrorSrc] = useState<string | null>(null)
  const isLoaded = Boolean(src) && (loadedSrc === src || drawableCache.has(src) || blobCache.has(src))
  const hasError = Boolean(src && errorSrc === src)

  useEffect(() => {
    if (!src) return

    const abortController = new AbortController()
    const { signal } = abortController
    let observer: IntersectionObserver | null = null
    let rafId: number | null = null
    let started = false

    const renderDrawable = (source: DrawableSource) => {
      if (signal.aborted) return
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        if (drawDrawableToCanvas(canvas, source)) {
          setLoadedSrc(src)
          onLoadRef.current?.()
        }
      } catch (err) {
        if (drawableCache.get(src) === source) {
          drawableCache.delete(src)
          if ('close' in source && typeof source.close === 'function') {
            source.close()
          }
        }
        throw err
      }
    }

    async function loadImage() {
      if (started || signal.aborted) return
      started = true

      try {
        const cachedDrawable = getCachedDrawable(src)
        if (cachedDrawable) {
          renderDrawable(cachedDrawable)
          return
        }

        const drawable = await getOrDecodeDrawable(src)
        if (signal.aborted) return

        rafId = requestAnimationFrame(() => {
          rafId = null
          try {
            renderDrawable(drawable)
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
    if (eager || drawableCache.has(src) || blobCache.has(src) || typeof IntersectionObserver === 'undefined' || !canvas) {
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
