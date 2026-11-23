import { useEffect, type PointerEvent } from 'react'
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
let cancelPrewarmTrigger: (() => void) | null = null

export interface AboutArtworkProps {
  image: AboutImage
  className?: string
  onPointerMove?: (e: PointerEvent<HTMLDivElement>) => void
  onPointerLeave?: (e: PointerEvent<HTMLDivElement>) => void
  onPointerCancel?: (e: PointerEvent<HTMLDivElement>) => void
}

export function AboutArtwork({
  image,
  className = '',
  onPointerMove,
  onPointerLeave,
  onPointerCancel,
}: AboutArtworkProps) {
  useEffect(() => {
    mountedArtworkCount += 1

    if (mountedArtworkCount === 1 && !prewarmStarted && !isSlowConnection && typeof window !== 'undefined') {
      const startPrewarm = () => {
        if (prewarmStarted) return
        prewarmStarted = true
        cancelPrewarmTrigger?.()
        cancelPrewarmTrigger = null
        const controller = new AbortController()
        activePrewarmController = controller
        void prewarmProtectedImages(ABOUT_ARTWORK_URLS, { signal: controller.signal })
      }

      if (window.scrollY > 20) {
        startPrewarm()
      } else {
        const onScroll = () => {
          if (window.scrollY > 20) {
            startPrewarm()
          }
        }
        const interactionEvents: Array<keyof WindowEventMap> = ['wheel', 'touchstart', 'pointerdown', 'keydown']

        cancelPrewarmTrigger = () => {
          window.removeEventListener('scroll', onScroll)
          interactionEvents.forEach(eventName => window.removeEventListener(eventName, startPrewarm))
        }

        window.addEventListener('scroll', onScroll, { passive: true })
        interactionEvents.forEach(eventName =>
          window.addEventListener(eventName, startPrewarm, { passive: true, once: true }),
        )
      }
    }

    return () => {
      mountedArtworkCount = Math.max(0, mountedArtworkCount - 1)
      if (mountedArtworkCount === 0) {
        cancelPrewarmTrigger?.()
        cancelPrewarmTrigger = null
        if (activePrewarmController) {
          activePrewarmController.abort()
          activePrewarmController = null
          prewarmStarted = false
        }
      }
    }
  }, [])

  return (
    <div
      className={`about__artwork ${className}`}
      data-about-part={image.id}
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
    >
      <div className="about__motion" data-about-motion={image.id}>
        <ProtectedCanvasImage
          src={image.imageUrl}
          alt={image.alt}
          className="about__art"
          containerClassName="about__art-container"
          width={image.width}
          height={image.height}
          rootMargin="200px"
        />
      </div>
    </div>
  )
}
