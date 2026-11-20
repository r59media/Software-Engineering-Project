import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { isWebKit } from '../utils/browserEnv'

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
  loading?: 'lazy' | 'eager' | string
  fetchPriority?: 'high' | 'low' | 'auto'
  forceOriginal?: boolean
  minDpr?: number
  rootMargin?: string
  placeholderColor?: string
  onError?: () => void
  onLoad?: () => void
}

type MediaWidthVariant = 640 | 1280

// eslint-disable-next-line react-refresh/only-export-components
export function pickRequiredMediaWidth(
  cssWidth: number,
  dpr: number,
  forceOriginal: boolean,
): MediaWidthVariant | undefined {
  if (forceOriginal || cssWidth <= 0) {
    return undefined
  }
  const needed = Math.ceil(cssWidth * Math.max(1, dpr))
  if (needed <= 640) {
    return 640
  }
  if (needed <= 1280) {
    return 1280
  }
  return undefined
}

// eslint-disable-next-line react-refresh/only-export-components
export function withMediaWidth(src: string, w?: MediaWidthVariant): string {
  if (!w || !src.includes('/api/media/')) {
    return src
  }
  return `${src}${src.includes('?') ? '&' : '?'}w=${w}`
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
      const evicted = drawableCache.get(oldestKey)
      drawableCache.delete(oldestKey)
      if (evicted && evicted !== source && 'close' in evicted && typeof evicted.close === 'function') {
        evicted.close()
      }
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

function fetchProtectedBlob(
  src: string,
  fetchPriority?: 'high' | 'low' | 'auto',
  signal?: AbortSignal,
): Promise<Blob> {
  const cached = blobCache.get(src)
  if (cached) {
    cacheBlob(src, cached)
    return Promise.resolve(cached)
  }

  const inFlight = inFlightFetches.get(src)
  if (inFlight) {
    return inFlight
  }

  const requestInit: RequestInit & { priority?: 'high' | 'low' | 'auto' } = {
    credentials: 'omit',
    headers: {
      'X-R59-Client': 'media-viewer',
    },
  }
  if (fetchPriority === 'high' || fetchPriority === 'low') {
    requestInit.priority = fetchPriority
  }
  if (signal) {
    requestInit.signal = signal
  }

  const request = fetch(src, requestInit)
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

async function getOrDecodeDrawable(
  src: string,
  fetchPriority?: 'high' | 'low' | 'auto',
  signal?: AbortSignal,
): Promise<DrawableSource> {
  const cached = getCachedDrawable(src)
  if (cached) return cached

  const inFlight = inFlightDecodes.get(src)
  if (inFlight) return inFlight

  const decodePromise = (async () => {
    const blob = await fetchProtectedBlob(src, fetchPriority, signal)
    if (signal?.aborted) {
      const abortError = new Error('Aborted')
      abortError.name = 'AbortError'
      throw abortError
    }
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

const yieldToMain = (): Promise<void> =>
  typeof window !== 'undefined' &&
  'scheduler' in window &&
  typeof (window as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler?.yield === 'function'
    ? (window as unknown as { scheduler: { yield: () => Promise<void> } }).scheduler.yield()
    : new Promise<void>((resolve) => setTimeout(resolve, 0))

// eslint-disable-next-line react-refresh/only-export-components
export async function prewarmProtectedImages(
  urls: string[],
  options?: { signal?: AbortSignal },
): Promise<void> {
  const signal = options?.signal
  if (signal?.aborted || urls.length === 0) return

  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)))
  const pendingUrls = uniqueUrls.filter((url) => {
    if (getCachedDrawable(url)) return false
    if (inFlightDecodes.has(url) || inFlightFetches.has(url)) return false
    return true
  })

  if (pendingUrls.length === 0) return

  const BATCH_SIZE = 2
  for (let i = 0; i < pendingUrls.length; i += BATCH_SIZE) {
    if (signal?.aborted) return

    const batch = pendingUrls.slice(i, i + BATCH_SIZE)
    await Promise.allSettled(
      batch.map(async (url) => {
        if (
          signal?.aborted ||
          getCachedDrawable(url) ||
          inFlightDecodes.has(url) ||
          (!blobCache.has(url) && inFlightFetches.has(url))
        ) {
          return
        }
        try {
          await getOrDecodeDrawable(url, 'low', signal)
        } catch {
          // Ignore aborted/failed prewarm errors silently
        }
      }),
    )

    if (i + BATCH_SIZE < pendingUrls.length && !signal?.aborted) {
      await yieldToMain()
    }
  }
}

function computeTargetDimensions(
  canvas: HTMLCanvasElement,
  srcW: number,
  srcH: number,
  propWidth?: number,
  minDpr = 1,
): { targetW: number; targetH: number } {
  const rect = canvas.getBoundingClientRect()
  let cssWidth = rect.width > 0 ? rect.width : canvas.clientWidth
  if (rect.width > 0 && rect.height > 0 && typeof window !== 'undefined') {
    if (window.getComputedStyle(canvas).objectFit === 'cover') {
      cssWidth = Math.max(cssWidth, rect.height * (srcW / srcH))
    }
  }
  if (cssWidth <= 0) {
    cssWidth = propWidth && propWidth > 0 ? propWidth : srcW
  }

  const dpr = typeof window !== 'undefined'
    ? Math.min(Math.max(window.devicePixelRatio || 1, minDpr), 2)
    : Math.min(Math.max(1, minDpr), 2)
  let targetW = Math.min(srcW, MAX_CANVAS_DIMENSION, Math.max(1, Math.ceil(cssWidth * dpr)))
  let targetH = Math.max(1, Math.round(targetW * (srcH / srcW)))
  if (targetH > MAX_CANVAS_DIMENSION) {
    targetH = MAX_CANVAS_DIMENSION
    targetW = Math.max(1, Math.round(targetH * (srcW / srcH)))
  }
  return { targetW, targetH }
}

function drawDrawableToCanvas(
  canvas: HTMLCanvasElement,
  source: DrawableSource,
  propWidth?: number,
  minDpr = 1,
): boolean {
  const { width: srcW, height: srcH } = getDrawableDimensions(source)
  if (srcW === 0 || srcH === 0) {
    return false
  }
  const { targetW, targetH } = computeTargetDimensions(canvas, srcW, srcH, propWidth, minDpr)
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW
    canvas.height = targetH
  }
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
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
  loading,
  fetchPriority,
  forceOriginal = false,
  minDpr = 1,
  rootMargin = '600px',
  placeholderColor = 'transparent',
  onError,
  onLoad,
}: ProtectedCanvasImageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const widthRef = useRef(width)
  const onErrorRef = useRef(onError)
  const onLoadRef = useRef(onLoad)

  useEffect(() => {
    widthRef.current = width
  }, [width])

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
    let webkitObserver: IntersectionObserver | null = null
    let resizeObserver: ResizeObserver | null = null
    let rafId: number | null = null
    let started = false
    let hasDrawn = false
    let offscreenReleased = false
    let loadedWidth = 0
    let requestedWidth = 0
    let activeEffectiveSrc = src

    const measureCssWidth = (): number => {
      const canvasWidth = canvasRef.current?.getBoundingClientRect().width ?? 0
      if (canvasWidth > 0) return canvasWidth
      return containerRef.current?.getBoundingClientRect().width ?? 0
    }

    const renderDrawable = (source: DrawableSource, cacheKey: string, notifyLoad = true) => {
      if (signal.aborted || offscreenReleased) return
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        if (drawDrawableToCanvas(canvas, source, widthRef.current, minDpr)) {
          hasDrawn = true
          offscreenReleased = false
          setLoadedSrc(src)
          if (notifyLoad) {
            onLoadRef.current?.()
          }
        }
      } catch (err) {
        if (drawableCache.get(cacheKey) === source) {
          drawableCache.delete(cacheKey)
          if ('close' in source && typeof source.close === 'function') {
            source.close()
          }
        }
        throw err
      }
    }

    async function decodeWithRetry(targetSrc: string): Promise<DrawableSource> {
      try {
        return await getOrDecodeDrawable(targetSrc, fetchPriority)
      } catch (err: unknown) {
        if (!signal.aborted && err instanceof Error && err.name === 'AbortError') {
          return await getOrDecodeDrawable(targetSrc, fetchPriority)
        }
        throw err
      }
    }

    async function repaintFromCacheOrDecode() {
      if (signal.aborted || offscreenReleased) return
      const targetSrc = activeEffectiveSrc
      try {
        const cachedDrawable = getCachedDrawable(targetSrc)
        if (cachedDrawable) {
          renderDrawable(cachedDrawable, targetSrc)
          return
        }
        const drawable = await decodeWithRetry(targetSrc)
        if (signal.aborted || offscreenReleased) return
        renderDrawable(drawable, targetSrc)
      } catch (err: unknown) {
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          return
        }
        console.error('ProtectedCanvasImage repaint error:', err)
      }
    }

    async function loadVariant(targetWidth: MediaWidthVariant | undefined, isUpgrade: boolean) {
      if (signal.aborted) return
      const numericWidth = targetWidth ?? Infinity
      const effectiveSrc = withMediaWidth(src, targetWidth)
      requestedWidth = Math.max(requestedWidth, numericWidth)
      activeEffectiveSrc = effectiveSrc

      try {
        const cachedDrawable = getCachedDrawable(effectiveSrc)
        if (cachedDrawable) {
          loadedWidth = Math.max(loadedWidth, numericWidth)
          renderDrawable(cachedDrawable, effectiveSrc)
          return
        }

        const drawable = await decodeWithRetry(effectiveSrc)
        if (signal.aborted || numericWidth < requestedWidth) return

        loadedWidth = Math.max(loadedWidth, numericWidth)

        if (rafId !== null) {
          cancelAnimationFrame(rafId)
        }
        rafId = requestAnimationFrame(() => {
          rafId = null
          try {
            renderDrawable(drawable, effectiveSrc)
          } catch (err: unknown) {
            if (signal.aborted) return
            console.error('ProtectedCanvasImage load error:', err)
            if (!isUpgrade && !hasDrawn) {
              setErrorSrc(src)
              onErrorRef.current?.()
            }
          }
        })
      } catch (err: unknown) {
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          return
        }
        console.error('ProtectedCanvasImage load error:', err)
        if (!isUpgrade && !hasDrawn) {
          setErrorSrc(src)
          onErrorRef.current?.()
        }
      }
    }

    async function loadImage() {
      if (started || signal.aborted) return
      started = true

      if (drawableCache.has(src)) {
        await loadVariant(undefined, false)
        return
      }

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
      const targetWidth = pickRequiredMediaWidth(measureCssWidth(), dpr, forceOriginal)
      await loadVariant(targetWidth, false)
    }

    const canvas = canvasRef.current
    const observeTarget = containerRef.current ?? canvas
    if (typeof ResizeObserver !== 'undefined' && observeTarget) {
      resizeObserver = new ResizeObserver(() => {
        if (!started || signal.aborted || offscreenReleased) return
        if (src.includes('/api/media/') && !forceOriginal) {
          const currentMax = Math.max(loadedWidth, requestedWidth)
          if (currentMax !== Infinity) {
            const cssWidth = measureCssWidth()
            if (cssWidth > 0) {
              const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
              const neededWidth = pickRequiredMediaWidth(cssWidth, dpr, forceOriginal)
              const neededNumeric = neededWidth ?? Infinity
              if (neededNumeric > currentMax) {
                void loadVariant(neededWidth, true)
                return
              }
            }
          }
        }

        if (!hasDrawn || !canvas) return
        const cachedDrawable = getCachedDrawable(activeEffectiveSrc)
        if (!cachedDrawable) return
        const { width: srcW, height: srcH } = getDrawableDimensions(cachedDrawable)
        if (srcW === 0 || srcH === 0) return

        const { targetW, targetH } = computeTargetDimensions(canvas, srcW, srcH, widthRef.current, minDpr)
        const maxTargetW = Math.min(srcW, MAX_CANVAS_DIMENSION)
        const maxTargetH = Math.min(srcH, MAX_CANVAS_DIMENSION)
        const grewEnough =
          (targetW > canvas.width * 1.15 && canvas.width < maxTargetW) ||
          (targetH > canvas.height * 1.15 && canvas.height < maxTargetH)

        if (grewEnough && (targetW > canvas.width || targetH > canvas.height)) {
          if (rafId !== null) {
            cancelAnimationFrame(rafId)
          }
          rafId = requestAnimationFrame(() => {
            rafId = null
            if (signal.aborted || offscreenReleased) return
            const current = getCachedDrawable(activeEffectiveSrc)
            if (current) {
              renderDrawable(current, activeEffectiveSrc, false)
            }
          })
        }
      })
      resizeObserver.observe(observeTarget)
    }

    if (isWebKit && typeof IntersectionObserver !== 'undefined' && canvas) {
      webkitObserver = new IntersectionObserver(
        (entries) => {
          const isVisible = entries.some((entry) => entry.isIntersecting)
          if (!isVisible) {
            if (hasDrawn && !offscreenReleased) {
              offscreenReleased = true
              canvas.width = 1
              canvas.height = 1
            }
          } else if (offscreenReleased) {
            offscreenReleased = false
            void repaintFromCacheOrDecode()
          }
        },
        { rootMargin: '900px' },
      )
      webkitObserver.observe(canvas)
    }

    const shouldLoadEagerly = eager || loading === 'eager' || fetchPriority === 'high'
    if (shouldLoadEagerly || drawableCache.has(src) || blobCache.has(src) || typeof IntersectionObserver === 'undefined' || !canvas) {
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
        { rootMargin },
      )
      observer.observe(canvas)
    }

    return () => {
      abortController.abort()
      observer?.disconnect()
      webkitObserver?.disconnect()
      resizeObserver?.disconnect()
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [src, eager, loading, fetchPriority, forceOriginal, minDpr, rootMargin])

  const canvasStyle: CSSProperties = objectPosition ? { objectPosition } : {}
  const containerStyle: CSSProperties = {
    ...(!isLoaded && !hasError ? { backgroundColor: placeholderColor } : {}),
    ...style,
  }

  return (
    <div
      ref={containerRef}
      className={`protected-media-container ${containerClassName || ''}`.trim()}
      style={containerStyle}
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
