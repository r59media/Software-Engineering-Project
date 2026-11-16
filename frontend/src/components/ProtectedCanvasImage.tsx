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
const blobCache = new Map<string, Blob>()

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

  const [errorSrc, setErrorSrc] = useState<string | null>(null)
  const hasError = Boolean(src && errorSrc === src)

  useEffect(() => {
    if (!src) return

    const abortController = new AbortController()
    const { signal } = abortController
    let observer: IntersectionObserver | null = null
    let rafId: number | null = null
    let pendingBitmap: ImageBitmap | null = null
    let started = false

    async function loadImage() {
      if (started || signal.aborted) return
      started = true

      try {
        let blob = blobCache.get(src)
        if (!blob) {
          const response = await fetch(src, {
            credentials: 'omit',
            signal,
            headers: {
              'X-R59-Client': 'media-viewer',
            },
          })

          if (!response.ok) {
            throw new Error(`Failed to load protected media: ${response.status}`)
          }

          blob = await response.blob()
          if (signal.aborted) return
          cacheBlob(src, blob)
        }

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

        if (signal.aborted) {
          bitmap.close?.()
          return
        }

        pendingBitmap = bitmap
        rafId = requestAnimationFrame(() => {
          rafId = null
          const bmp = pendingBitmap
          pendingBitmap = null
          try {
            if (signal.aborted || !bmp) return
            const canvas = canvasRef.current
            if (canvas && drawBitmapToCanvas(canvas, bmp)) {
              onLoadRef.current?.()
            }
          } finally {
            bmp?.close?.()
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
    if (eager || blobCache.has(src) || typeof IntersectionObserver === 'undefined' || !canvas) {
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
      if (pendingBitmap) {
        pendingBitmap.close?.()
        pendingBitmap = null
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
