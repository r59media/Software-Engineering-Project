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
  onError?: () => void
  onLoad?: () => void
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

    async function loadImage() {
      try {
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

        const blob = await response.blob()
        if (signal.aborted) return

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

        try {
          if (signal.aborted) return
          const canvas = canvasRef.current
          if (canvas) {
            if (drawBitmapToCanvas(canvas, bitmap)) {
              onLoadRef.current?.()
            }
          }
        } finally {
          bitmap.close?.()
        }
      } catch (err: unknown) {
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          return
        }
        console.error('ProtectedCanvasImage load error:', err)
        setErrorSrc(src)
        onErrorRef.current?.()
      }
    }

    loadImage()

    return () => {
      abortController.abort()
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
