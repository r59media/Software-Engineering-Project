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
const MAX_DRAWABLE_CACHE_ENTRIES = 16
const MAX_CANVAS_DIMENSION = 2048
const blobCache = new Map<string, Blob>()
const drawableCache = new Map<string, DrawableSource>()
const inFlightFetches = new Map<string, Promise<Blob>>()
const inFlightDecodes = new Map<string, Promise<DrawableSource>>()

function getDrawableSize(source: DrawableSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
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

function cacheDrawable(src: string, drawable: DrawableSource) {
  if (drawableCache.has(src)) {
    drawableCache.delete(src)
  } else if (drawableCache.size >= MAX_DRAWABLE_CACHE_ENTRIES) {
    const oldestKey = drawableCache.keys().next().value
    if (oldestKey !== undefined) {
      // Evict without calling .close() so active/queued canvases never hit InvalidStateError
      drawableCache.delete(oldestKey)
    }
  }
  drawableCache.set(src, drawable)
}

function getCachedDrawable(src: string): DrawableSource | undefined {
  const cached = drawableCache.get(src)
  if (!cached) return undefined
  const { width, height } = getDrawableSize(cached)
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
      // Fall back to HTMLImageElement decoding for WebKit, Ladybird, or hardened Gecko
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
      try {
        await img.decode()
      } catch {
        // Image already loaded via onload; continue with decoded HTMLImageElement
      }
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

type ObjectFitMode = 'contain' | 'cover' | 'fill'

function parsePositionToken(token: string, axis: 'x' | 'y'): number | null {
  if (token === 'center') return 0.5
  if (axis === 'x') {
    if (token === 'left') return 0
    if (token === 'right') return 1
  } else {
    if (token === 'top') return 0
    if (token === 'bottom') return 1
  }
  if (token.endsWith('%')) {
    const parsed = parseFloat(token.slice(0, -1))
    if (Number.isFinite(parsed)) {
      return parsed / 100
    }
  }
  return null
}

function parseObjectPosition(value: string | undefined): { x: number; y: number } {
  if (!value) return { x: 0.5, y: 0.5 }
  const parts = value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { x: 0.5, y: 0.5 }

  if (parts.length === 1) {
    const token = parts[0]
    if (token === 'top') return { x: 0.5, y: 0 }
    if (token === 'bottom') return { x: 0.5, y: 1 }
    const x = parsePositionToken(token, 'x')
    return { x: x ?? 0.5, y: 0.5 }
  }

  const [first, second] = parts
  // Handle swapped keyword order like "top left" or "bottom right"
  if ((first === 'top' || first === 'bottom') && (second === 'left' || second === 'right' || second === 'center')) {
    return {
      x: parsePositionToken(second, 'x') ?? 0.5,
      y: parsePositionToken(first, 'y') ?? 0.5,
    }
  }

  return {
    x: parsePositionToken(first, 'x') ?? 0.5,
    y: parsePositionToken(second, 'y') ?? 0.5,
  }
}

function drawDrawableToCanvas(
  canvas: HTMLCanvasElement,
  source: DrawableSource,
  objectPositionProp?: string,
): boolean {
  const { width: sourceWidth, height: sourceHeight } = getDrawableSize(source)
  if (sourceWidth === 0 || sourceHeight === 0) {
    return false
  }

  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const hasLayoutSize = rect.width > 0 && rect.height > 0

  const targetWidth = hasLayoutSize
    ? Math.min(Math.max(1, Math.round(rect.width * dpr)), MAX_CANVAS_DIMENSION)
    : Math.min(Math.max(1, sourceWidth), MAX_CANVAS_DIMENSION)
  const targetHeight = hasLayoutSize
    ? Math.min(Math.max(1, Math.round(rect.height * dpr)), MAX_CANVAS_DIMENSION)
    : Math.min(Math.max(1, sourceHeight), MAX_CANVAS_DIMENSION)

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  const computedStyle = window.getComputedStyle(canvas)
  const rawFit = computedStyle.objectFit
  const objectFit: ObjectFitMode =
    rawFit === 'contain' || rawFit === 'cover' || rawFit === 'fill' ? rawFit : 'cover'
  const { x: posX, y: posY } = parseObjectPosition(
    computedStyle.objectPosition || objectPositionProp || '50% 50%',
  )

  const cw = canvas.width
  const ch = canvas.height

  let sx = 0
  let sy = 0
  let sw = sourceWidth
  let sh = sourceHeight
  let dx = 0
  let dy = 0
  let dw = cw
  let dh = ch

  if (objectFit === 'cover') {
    const canvasAspect = cw / ch
    const sourceAspect = sourceWidth / sourceHeight
    if (sourceAspect > canvasAspect) {
      sh = sourceHeight
      sw = sourceHeight * canvasAspect
      sx = (sourceWidth - sw) * posX
      sy = 0
    } else {
      sw = sourceWidth
      sh = sourceWidth / canvasAspect
      sx = 0
      sy = (sourceHeight - sh) * posY
    }
  } else if (objectFit === 'contain') {
    const scale = Math.min(cw / sourceWidth, ch / sourceHeight)
    dw = sourceWidth * scale
    dh = sourceHeight * scale
    dx = (cw - dw) * posX
    dy = (ch - dh) * posY
  }

  ctx.clearRect(0, 0, cw, ch)
  ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh)
  return true
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
    let intersectionObserver: IntersectionObserver | null = null
    let resizeObserver: ResizeObserver | null = null
    let rafId: number | null = null
    let resizeRafId: number | null = null
    let started = false
    let loaded = false
    let notifiedLoad = false

    const renderDrawable = (drawable: DrawableSource) => {
      if (signal.aborted) return
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        if (drawDrawableToCanvas(canvas, drawable, objectPosition)) {
          loaded = true
          setLoadedSrc(src)
          if (!notifiedLoad) {
            notifiedLoad = true
            onLoadRef.current?.()
          }
        }
      } catch (err) {
        if (drawableCache.get(src) === drawable) {
          drawableCache.delete(src)
        }
        throw err
      }
    }

    const redrawFromCache = async () => {
      if (signal.aborted || !loaded) return
      try {
        const cached = getCachedDrawable(src)
        if (cached) {
          try {
            renderDrawable(cached)
            return
          } catch {
            // Stale/invalidated drawable; re-decode from blobCache below
          }
        }
        const redecoded = await getOrDecodeDrawable(src)
        if (signal.aborted) return
        renderDrawable(redecoded)
      } catch {
        // Ignore transient redraw errors
      }
    }

    const scheduleRedraw = () => {
      if (signal.aborted || !loaded || resizeRafId !== null) return
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null
        void redrawFromCache()
      })
    }

    const handleVisibilityOrPageShow = (event?: Event) => {
      if (event?.type === 'visibilitychange' && document.visibilityState === 'hidden') {
        return
      }
      scheduleRedraw()
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
    if (canvas && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleRedraw()
      })
      resizeObserver.observe(canvas)
    }

    window.addEventListener('pageshow', handleVisibilityOrPageShow)
    document.addEventListener('visibilitychange', handleVisibilityOrPageShow)

    if (eager || drawableCache.has(src) || blobCache.has(src) || typeof IntersectionObserver === 'undefined' || !canvas) {
      void loadImage()
    } else {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            intersectionObserver?.disconnect()
            intersectionObserver = null
            void loadImage()
          }
        },
        { rootMargin: '400px 0px' },
      )
      intersectionObserver.observe(canvas)
    }

    return () => {
      abortController.abort()
      intersectionObserver?.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('pageshow', handleVisibilityOrPageShow)
      document.removeEventListener('visibilitychange', handleVisibilityOrPageShow)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
      if (resizeRafId !== null) {
        cancelAnimationFrame(resizeRafId)
      }
    }
  }, [src, eager, objectPosition])

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
