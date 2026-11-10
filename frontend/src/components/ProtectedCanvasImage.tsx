import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

export interface ProtectedCanvasImageProps {
  src: string
  alt: string
  className?: string
  containerClassName?: string
  style?: CSSProperties
  objectPosition?: string
  width?: number
  height?: number
  onError?: () => void
  onLoad?: () => void
}

const MAX_CACHE_SIZE = 50
const bitmapCache = new Map<string, ImageBitmap>()
const inFlightRequests = new Map<string, Promise<ImageBitmap>>()

function getCachedBitmap(url: string): ImageBitmap | undefined {
  const bitmap = bitmapCache.get(url)
  if (bitmap) {
    // Refresh LRU order
    bitmapCache.delete(url)
    bitmapCache.set(url, bitmap)
  }
  return bitmap
}

function setCachedBitmap(url: string, bitmap: ImageBitmap): void {
  if (bitmapCache.has(url)) {
    bitmapCache.delete(url)
  } else if (bitmapCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = bitmapCache.keys().next().value
    if (oldestKey !== undefined) {
      const evicted = bitmapCache.get(oldestKey)
      bitmapCache.delete(oldestKey)
      evicted?.close?.()
    }
  }
  bitmapCache.set(url, bitmap)
}

async function fetchAndCacheBitmap(url: string): Promise<ImageBitmap> {
  const cached = getCachedBitmap(url)
  if (cached) return cached

  const inFlight = inFlightRequests.get(url)
  if (inFlight) return inFlight

  const request = (async () => {
    try {
      const response = await fetch(url, {
        headers: {
          'X-R59-Client': 'media-viewer',
        },
      })
      if (!response.ok) {
        throw new Error(`Failed to load protected media: ${response.status}`)
      }
      const blob = await response.blob()
      let bitmap: ImageBitmap
      if (typeof createImageBitmap === 'function') {
        bitmap = await createImageBitmap(blob)
      } else {
        const img = new Image()
        const blobUrl = URL.createObjectURL(blob)
        try {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error('Failed to load image'))
            img.src = blobUrl
          })
          bitmap = await createImageBitmap(img)
        } finally {
          URL.revokeObjectURL(blobUrl)
        }
      }
      setCachedBitmap(url, bitmap)
      return bitmap
    } finally {
      inFlightRequests.delete(url)
    }
  })()

  inFlightRequests.set(url, request)
  return request
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

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function ProtectedCanvasImage({
  src,
  alt,
  className = '',
  containerClassName,
  style,
  objectPosition,
  width,
  height,
  onError,
  onLoad,
}: ProtectedCanvasImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onErrorRef = useRef(onError)
  const onLoadRef = useRef(onLoad)
  useIsomorphicLayoutEffect(() => {
    onLoadRef.current = onLoad
  }, [onLoad])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const [hasError, setHasError] = useState(false)

  useIsomorphicLayoutEffect(() => {
    if (!src) return

    setHasError(false)
    let isMounted = true

    // Check LRU cache first for instant synchronous render
    const cached = getCachedBitmap(src)
    if (cached) {
      if (canvasRef.current) {
        if (drawBitmapToCanvas(canvasRef.current, cached)) onLoadRef.current?.()
      }
      return
    }

    fetchAndCacheBitmap(src)
      .then((bitmap) => {
        if (!isMounted) return
        if (canvasRef.current) {
          if (drawBitmapToCanvas(canvasRef.current, bitmap)) onLoadRef.current?.()
        }
      })
      .catch((err) => {
        if (!isMounted) return
        console.error('ProtectedCanvasImage load error:', err)
        setHasError(true)
        onErrorRef.current?.()
      })

    return () => {
      isMounted = false
    }
  }, [src])

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
          className={`protected-canvas ${className}`.trim()}
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
