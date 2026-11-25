import { useEffect, type PointerEvent } from 'react'
import { motion, useReducedMotion, type MotionStyle } from 'motion/react'
import { ProtectedCanvasImage, prewarmProtectedImages } from '../../components/ProtectedCanvasImage'
import { aboutDecorations, aboutImages } from '../../config/about'
import type { AboutImage } from '../../types/about'
import { isSlowConnection } from '../../utils/browserEnv'

const ABOUT_ARTWORK_URLS = Array.from(
  new Set([
    aboutImages.paper.imageUrl,
    aboutImages.yellowCard.imageUrl,
    aboutImages.redCard.imageUrl,
    aboutImages.portraitFrame.imageUrl,
    ...aboutDecorations.map((d) => d.imageUrl),
  ]),
)

let mountedArtworkCount = 0
let prewarmStarted = false
let activePrewarmController: AbortController | null = null

export interface AboutArtworkProps {
  image: AboutImage
  className?: string
  motionStyle?: MotionStyle
  onPointerMove?: (e: PointerEvent<HTMLDivElement>) => void
  onPointerLeave?: (e: PointerEvent<HTMLDivElement>) => void
  onPointerCancel?: (e: PointerEvent<HTMLDivElement>) => void
}

export function AboutArtwork({
  image,
  className = '',
  motionStyle,
  onPointerMove,
  onPointerLeave,
  onPointerCancel,
}: AboutArtworkProps) {
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    mountedArtworkCount += 1

    if (mountedArtworkCount === 1 && !prewarmStarted && !isSlowConnection && typeof window !== 'undefined') {
      prewarmStarted = true
      const controller = new AbortController()
      activePrewarmController = controller
      void prewarmProtectedImages(ABOUT_ARTWORK_URLS, { signal: controller.signal })
    }

    return () => {
      mountedArtworkCount = Math.max(0, mountedArtworkCount - 1)
      if (mountedArtworkCount === 0) {
        if (activePrewarmController) {
          activePrewarmController.abort()
          activePrewarmController = null
          prewarmStarted = false
        }
      }
    }
  }, [])

  const content = (
    <ProtectedCanvasImage
      src={image.imageUrl}
      alt={image.alt}
      className="about__art"
      containerClassName="about__art-container"
      width={image.width}
      height={image.height}
      rootMargin="600px"
    />
  )

  return (
    <div
      className={`about__artwork ${className}`}
      data-about-part={image.id}
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
    >
      {motionStyle && !prefersReducedMotion ? (
        <motion.div
          className="about__motion"
          data-about-motion={image.id}
          style={motionStyle}
        >
          {content}
        </motion.div>
      ) : (
        <div className="about__motion" data-about-motion={image.id}>
          {content}
        </div>
      )}
    </div>
  )
}
