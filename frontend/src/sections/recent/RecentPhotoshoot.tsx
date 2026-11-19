import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
type ViewportMode = 'desktop' | 'tablet' | 'mobile'

const MODE_METRICS: Record<ViewportMode, { x1: number; x2: number; xOff: number; y1: number; opacity2: number }> = {
  desktop: { x1: 0.271, x2: 0.542, xOff: 0.75, y1: 0.075, opacity2: 0.35 },
  tablet: { x1: 0.32, x2: 0.75, xOff: 0.75, y1: 0.08, opacity2: 0 },
  mobile: { x1: 0.55, x2: 0.95, xOff: 0.95, y1: 0.08, opacity2: 0 },
}

const getSlotStyles = (mode: ViewportMode, stageWidth: number, svh: number): Record<number, SlotConfig> => {
  const { x1, x2, y1, opacity2 } = MODE_METRICS[mode]
  const y0 = Math.min(0.0616 * stageWidth, 0.10 * svh)
  const y1Px = Math.min(y1 * stageWidth, 0.12 * svh)
  const y2 = Math.min(0.135 * stageWidth, 0.22 * svh)

  return {
    0: {
      x: 0,
      y: y0,
      rotate: 0,
      scale: 1,
      zIndex: 5,
      opacity: 1,
    },
    '-1': {
      x: -x1 * stageWidth,
      y: y1Px,
      rotate: -8.66,
      scale: 0.95,
      zIndex: 3,
      opacity: 0.55,
    },
    1: {
      x: x1 * stageWidth,
      y: y1Px,
      rotate: 8.66,
      scale: 0.95,
      zIndex: 3,
      opacity: 0.55,
    },
    '-2': {
      x: -x2 * stageWidth,
      y: y2,
      rotate: -17.32,
      scale: 0.85,
      zIndex: 1,
      opacity: opacity2,
    },
    2: {
      x: x2 * stageWidth,
      y: y2,
      rotate: 17.32,
      scale: 0.85,
      zIndex: 1,
      opacity: opacity2,
    },
  }
}

const getOffscreenLeft = (mode: ViewportMode, stageWidth: number, svh: number): SlotConfig => ({
  x: -MODE_METRICS[mode].xOff * stageWidth,
  y: Math.min(0.18 * stageWidth, 0.28 * svh),
  rotate: -25,
  scale: 0.75,
  zIndex: 0,
  opacity: 0,
})

const getOffscreenRight = (mode: ViewportMode, stageWidth: number, svh: number): SlotConfig => ({
  x: MODE_METRICS[mode].xOff * stageWidth,
  y: Math.min(0.18 * stageWidth, 0.28 * svh),
  rotate: 25,
  scale: 0.75,
  zIndex: 0,
  opacity: 0,
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
  const stageRef = useRef<HTMLDivElement>(null)
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
  const [isTablet, setIsTablet] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px) and (max-width: 1024px)').matches : false)
  const [stageSize, setStageSize] = useState<{ width: number; svh: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1440,
    svh: typeof window !== 'undefined' ? window.innerHeight : 900,
  }))

  useEffect(() => {
    const mobileMql = window.matchMedia('(max-width: 1000px)')
    const tabletMql = window.matchMedia('(min-width: 768px) and (max-width: 1024px)')
    const onMobileChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    const onTabletChange = (e: MediaQueryListEvent) => setIsTablet(e.matches)
    mobileMql.addEventListener('change', onMobileChange)
    tabletMql.addEventListener('change', onTabletChange)
    return () => {
      mobileMql.removeEventListener('change', onMobileChange)
      tabletMql.removeEventListener('change', onTabletChange)
    }
  }, [])

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return

    const updateSize = () => {
      const rect = el.getBoundingClientRect()
      const width = rect.width || window.innerWidth
      const svh = window.innerHeight
      setStageSize(prev => (prev.width === width && prev.svh === svh ? prev : { width, svh }))
    }

    updateSize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }

    const observer = new ResizeObserver(updateSize)
    observer.observe(el)
    window.addEventListener('resize', updateSize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [])

  const viewportMode: ViewportMode = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop'
  const slotStyles = useMemo(() => getSlotStyles(viewportMode, stageSize.width, stageSize.svh), [viewportMode, stageSize.width, stageSize.svh])
  const offscreenLeft = useMemo(() => getOffscreenLeft(viewportMode, stageSize.width, stageSize.svh), [viewportMode, stageSize.width, stageSize.svh])
  const offscreenRight = useMemo(() => getOffscreenRight(viewportMode, stageSize.width, stageSize.svh), [viewportMode, stageSize.width, stageSize.svh])

  const offsets = useMemo(() => {
    if (isMobile || isTablet) {
      return items.length >= 3 ? [-1, 0, 1] : items.length === 2 ? [0, 1] : items.length === 1 ? [0] : []
    }
    return items.length >= 5 ? [-2, -1, 0, 1, 2] : items.length === 4 ? [-1, 0, 1, 2] : items.length === 3 ? [-1, 0, 1] : items.length === 2 ? [0, 1] : items.length === 1 ? [0] : []
  }, [items.length, isMobile, isTablet])

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
        ref={stageRef}
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
              <filter id="recent-gooey" x="-25%" y="-25%" width="150%" height="150%">
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
