import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, type TargetAndTransition } from 'motion/react'
import type { PhotoshootPhoto } from '../../types/recentPhotoshoot'
import { recentInitialPhotoId, recentPhotos } from '../../config/recentPhotoshoot'
import { preloadProtectedImage } from '../../components/ProtectedCanvasImage'
import { PhotoImage } from './PhotoImage'
import { PhotoViewer } from './PhotoViewer'
import { useRecentPhotos } from './useRecentPhotos'
import { isIPad } from '../../utils/browserEnv'
import './RecentPhotoshoot.css'

interface RecentPhotoshootProps {
  photos?: readonly PhotoshootPhoto[]
  initialPhotoId?: string
}

type SlotConfig = TargetAndTransition

const getSlotStyles = (isMobile: boolean): Record<number, SlotConfig> => ({
  0: {
    left: '50%',
    top: 'min(6.16cqw, 10svh)',
    rotate: 0,
    scale: 1,
    zIndex: 5,
    opacity: 1,
    x: '-50%',
  },
  '-1': {
    left: isMobile ? '-5%' : '22.9%',
    top: isMobile ? 'min(8cqw, 12svh)' : 'min(7.5cqw, 12svh)',
    rotate: -8.66,
    scale: 0.95,
    zIndex: 3,
    opacity: 0.55,
    x: '-50%',
  },
  1: {
    left: isMobile ? '105%' : '77.1%',
    top: isMobile ? 'min(8cqw, 12svh)' : 'min(7.5cqw, 12svh)',
    rotate: 8.66,
    scale: 0.95,
    zIndex: 3,
    opacity: 0.55,
    x: '-50%',
  },
  '-2': {
    left: isMobile ? '-45%' : '-4.2%',
    top: 'min(13.5cqw, 22svh)',
    rotate: -17.32,
    scale: 0.85,
    zIndex: 1,
    opacity: isMobile ? 0 : 0.35,
    x: '-50%',
  },
  2: {
    left: isMobile ? '145%' : '104.2%',
    top: 'min(13.5cqw, 22svh)',
    rotate: 17.32,
    scale: 0.85,
    zIndex: 1,
    opacity: isMobile ? 0 : 0.35,
    x: '-50%',
  },
})

const getOffscreenLeft = (isMobile: boolean): SlotConfig => ({
  left: isMobile ? '-45%' : '-25%',
  top: 'min(18cqw, 28svh)',
  rotate: -25,
  scale: 0.75,
  zIndex: 0,
  opacity: 0,
  x: '-50%',
})

const getOffscreenRight = (isMobile: boolean): SlotConfig => ({
  left: isMobile ? '145%' : '125%',
  top: 'min(18cqw, 28svh)',
  rotate: 25,
  scale: 0.75,
  zIndex: 0,
  opacity: 0,
  x: '-50%',
})

const CAROUSEL_EASING: [number, number, number, number] = [0.25, 1, 0.5, 1]

export function RecentPhotoshoot({ photos: photosOverride, initialPhotoId = recentInitialPhotoId }: RecentPhotoshootProps) {
  // Explicit photos (e.g. tests, previews) win; otherwise show what the admin panel manages
  const livePhotos = useRecentPhotos(recentPhotos)
  const photos = photosOverride ?? livePhotos
  const [activePhotoId, setActivePhotoId] = useState(initialPhotoId)
  const [viewerOpen, setViewerOpen] = useState(false)
  const items = useMemo(() => photos.filter((photo, index) => photo.imageUrl.trim() && photos.findIndex(item => item.id === photo.id) === index), [photos])
  const sectionRef = useRef<HTMLElement>(null)
  const [direction, setDirection] = useState<-1 | 1>(1)
  const [stepCount, setStepCount] = useState(0)
  const [centerHovered, setCenterHovered] = useState(false)
  const [hidden, setHidden] = useState(() => document.hidden)
  const [inView, setInView] = useState(true)
  const [noHover, setNoHover] = useState(() =>
    isIPad || (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches),
  )
  const activeIndex = Math.max(0, items.findIndex(photo => photo.id === activePhotoId))
  const activePhoto = items[activeIndex]

  useEffect(() => {
    if (items.length === 0) return
    const indices = new Set([
      activeIndex,
      (activeIndex + 1) % items.length,
      (activeIndex - 1 + items.length) % items.length,
    ])
    for (const idx of indices) {
      const url = items[idx]?.imageUrl
      if (url) void preloadProtectedImage(url)
    }
  }, [items, activeIndex])

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(max-width: 1000px)').matches : false)

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1000px)')
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const slotStyles = useMemo(() => getSlotStyles(isMobile), [isMobile])
  const offscreenLeft = useMemo(() => getOffscreenLeft(isMobile), [isMobile])
  const offscreenRight = useMemo(() => getOffscreenRight(isMobile), [isMobile])

  const offsets = useMemo(() => {
    if (isMobile) {
      return items.length >= 3 ? [-1, 0, 1] : items.length === 2 ? [0, 1] : items.length === 1 ? [0] : []
    }
    return items.length >= 5 ? [-2, -1, 0, 1, 2] : items.length === 4 ? [-1, 0, 1, 2] : items.length === 3 ? [-1, 0, 1] : items.length === 2 ? [0, 1] : items.length === 1 ? [0] : []
  }, [items.length, isMobile])

  const step = useCallback((stepDirection: -1 | 1) => {
    if (items.length < 2) return
    setDirection(stepDirection)
    setStepCount(prev => prev + 1)
    setActivePhotoId(currentId => {
      const currentIndex = Math.max(0, items.findIndex(item => item.id === currentId))
      const nextIndex = (currentIndex + stepDirection + items.length) % items.length
      return items[nextIndex].id
    })
  }, [items])

  useEffect(() => {
    const visibilityChange = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', visibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', visibilityChange)
    }
  }, [])

  useEffect(() => {
    const el = sectionRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (isIPad || typeof window === 'undefined') return
    const mql = window.matchMedia('(hover: none)')
    const onChange = (e: MediaQueryListEvent) => setNoHover(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (items.length < 2 || centerHovered || hidden || viewerOpen || !inView) return
    const interval = window.setInterval(() => {
      step(1)
    }, 1800)
    return () => window.clearInterval(interval)
  }, [items.length, centerHovered, hidden, viewerOpen, inView, step])

  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const touchDeltaX = useRef<number>(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchDeltaX.current = 0
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return
    const diffX = e.touches[0].clientX - touchStartX.current
    const diffY = e.touches[0].clientY - touchStartY.current
    if (Math.abs(diffX) > Math.abs(diffY)) {
      touchDeltaX.current = diffX
    }
  }

  const handleTouchEnd = () => {
    if (touchStartX.current === null) return
    const threshold = 35
    if (touchDeltaX.current < -threshold) {
      step(1)
    } else if (touchDeltaX.current > threshold) {
      step(-1)
    }
    touchStartX.current = null
    touchStartY.current = null
    touchDeltaX.current = 0
  }

  const transition = { duration: 0.25, ease: CAROUSEL_EASING }

  const disableHoverPause = isMobile || isIPad || noHover

  return <section ref={sectionRef} id="recent-photoshoot" className="recent" aria-labelledby="recent-heading"
    data-active-photo-id={activePhoto?.id} data-viewer-open={viewerOpen && !!activePhoto}>
    <div className="recent__glow" aria-hidden="true" />
    <div className="recent__composition" data-recent-part="composition">
      <div
        className="recent__stage"
        data-recent-part="carousel"
        role="group"
        aria-label="Recent photos"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence initial={false} custom={direction}>
        {offsets.map(offset => {
          const photo = items[(activeIndex + offset + items.length) % items.length]
          const targetStyle = slotStyles[offset] ?? slotStyles[0]
          return <motion.div
            key={photo.id}
            className="recent__slot"
            data-recent-slot={offset}
            data-photo-id={photo.id}
            custom={direction}
            initial={direction > 0 ? offscreenRight : offscreenLeft}
            animate={targetStyle}
            variants={{
              exit: (exitDir: number) => ({
                ...(exitDir > 0 ? offscreenLeft : offscreenRight),
                pointerEvents: 'none' as const,
              }),
            }}
            exit="exit"
            transition={transition}>
            <div className="recent__motion" data-recent-motion={photo.id}>
              <button
                type="button"
                className="recent__photo"
                aria-label={offset === 0 ? `Open photo: ${photo.alt}` : `View photo: ${photo.alt}`}
                tabIndex={offset === 0 ? 0 : -1}
                onMouseEnter={offset === 0 && !disableHoverPause ? () => setCenterHovered(true) : undefined}
                onMouseLeave={offset === 0 && !disableHoverPause ? () => setCenterHovered(false) : undefined}
                onClick={() => {
                  if (offset === 0) {
                    setActivePhotoId(photo.id)
                    setViewerOpen(true)
                  } else {
                    step(offset < 0 ? -1 : 1)
                  }
                }}>
                <PhotoImage key={`${photo.id}:${photo.imageUrl}`} photo={photo} eager={offset === 0} />
              </button>
            </div>
          </motion.div>
        })}
        </AnimatePresence>
        {!activePhoto && <p className="recent__empty">New photos coming soon.</p>}
      </div>
      {activePhoto && (
        <div className="recent__controls" data-recent-part="controls" role="group" aria-label="Photo controls">
          <svg
            className="recent__gooey-svg"
            aria-hidden="true"
            focusable="false"
            style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none', opacity: 0 }}
          >
            <defs>
              <filter id="recent-gooey" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" />
                <feColorMatrix
                  in="blur"
                  mode="matrix"
                  values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8"
                  result="gooey"
                />
              </filter>
            </defs>
          </svg>
          <div className="recent__controls-track">
            {items.length > 1 && (
              <button
                type="button"
                className="recent__control-btn"
                aria-label="Previous carousel photo"
                onClick={() => step(-1)}
              >
                <motion.span
                  key={`dot-left-${stepCount}`}
                  className="recent__dot"
                  initial={{ x: 0, scaleX: 1, scaleY: 1 }}
                  animate={direction === -1 && stepCount > 0 ? {
                    x: [0, 5, 0],
                    scaleX: [1, 1.28, 1],
                    scaleY: [1, 0.88, 1],
                  } : { x: 0, scaleX: 1, scaleY: 1 }}
                  transition={{
                    duration: 0.42,
                    times: [0, 0.38, 1],
                    ease: 'easeInOut',
                  }}
                />
              </button>
            )}
            <button
              type="button"
              className="recent__control-btn recent__control-btn--center"
              aria-label="Open current photo"
              onClick={() => setViewerOpen(true)}
            >
              <motion.span
                key={`pill-${stepCount}`}
                className="recent__dot recent__dot--current"
                initial={{ x: 0, scaleX: 1, scaleY: 1 }}
                animate={stepCount > 0 ? {
                  x: [0, direction * 16, 0],
                  scaleX: [1, 1.45, 1],
                  scaleY: [1, 0.82, 1],
                } : { x: 0, scaleX: 1, scaleY: 1 }}
                transition={{
                  duration: 0.42,
                  times: [0, 0.38, 1],
                  ease: 'easeInOut',
                }}
              />
            </button>
            {items.length > 1 && (
              <button
                type="button"
                className="recent__control-btn"
                aria-label="Next carousel photo"
                onClick={() => step(1)}
              >
                <motion.span
                  key={`dot-right-${stepCount}`}
                  className="recent__dot"
                  initial={{ x: 0, scaleX: 1, scaleY: 1 }}
                  animate={direction === 1 && stepCount > 0 ? {
                    x: [0, -5, 0],
                    scaleX: [1, 1.28, 1],
                    scaleY: [1, 0.88, 1],
                  } : { x: 0, scaleX: 1, scaleY: 1 }}
                  transition={{
                    duration: 0.42,
                    times: [0, 0.38, 1],
                    ease: 'easeInOut',
                  }}
                />
              </button>
            )}
          </div>
        </div>
      )}
      <h2 id="recent-heading" className="recent__heading" data-recent-part="heading"><span>MOST RECENT</span><strong>PHOTOSHOOT</strong></h2>
    </div>
    {viewerOpen && activePhoto && <PhotoViewer photo={activePhoto} photos={items} position={activeIndex} total={items.length} onStep={step} onClose={() => setViewerOpen(false)} />}
  </section>
}
