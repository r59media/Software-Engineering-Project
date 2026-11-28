import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { HeroDestinations, HeroSlide } from '../../types/hero'
import { ActionLink } from '../../components/ActionLink'
import { ProtectedCanvasImage, preloadProtectedImage } from '../../components/ProtectedCanvasImage'
import { usePublicProfile } from '../../hooks/usePublicProfile'
import './Hero.css'

export interface HeroProps {
  slides: readonly HeroSlide[]
  activeSlideId?: string
  destinations: HeroDestinations
}

interface HeroImageProps {
  slide: HeroSlide
  fallbackImageUrl?: string
  isFirst?: boolean
}

function HeroImage({ slide, fallbackImageUrl, isFirst = false }: HeroImageProps) {
  const [currentUrl, setCurrentUrl] = useState(slide.imageUrl)
  const [failed, setFailed] = useState(false)

  const handleImageError = () => {
    if (fallbackImageUrl && currentUrl !== fallbackImageUrl) {
      setCurrentUrl(fallbackImageUrl)
    } else {
      setFailed(true)
    }
  }

  const position = {
    '--image-position': slide.objectPosition ?? '50% 50%',
    '--image-position-mobile': slide.mobileObjectPosition ?? slide.objectPosition ?? '50% 50%',
  } as CSSProperties

  return (
    <div
      className="hero__media"
      data-slide-id={slide.id}
      data-embedded-overlay={Boolean(slide.hasEmbeddedOverlay)}
      style={position}
    >
      {!failed && (
        <ProtectedCanvasImage
          key={currentUrl}
          src={currentUrl}
          alt={slide.alt.trim() || 'R59 Media featured automotive and portrait photography'}
          className="hero__canvas"
          width={slide.width}
          height={slide.height}
          loading={isFirst ? 'eager' : undefined}
          fetchPriority={isFirst ? 'high' : undefined}
          eager={!isFirst}
          placeholderColor="#141414"
          onError={handleImageError}
        />
      )}
    </div>
  )
}

export function Hero({ slides, activeSlideId, destinations }: HeroProps) {
  const { profile } = usePublicProfile()
  const location = profile?.location?.trim()
  const availableSlides = useMemo(() => {
    const ids = new Set<string>()
    const urls = new Set<string>()
    return slides.filter(slide => {
      const url = slide.imageUrl.trim()
      const normalizedUrl = url.toLowerCase()
      if (!url || ids.has(slide.id) || urls.has(normalizedUrl)) return false
      ids.add(slide.id)
      urls.add(normalizedUrl)
      return true
    })
  }, [slides])
  const sectionRef = useRef<HTMLElement>(null)
  const [currentId, setCurrentId] = useState<string | undefined>(() => availableSlides[0]?.id)
  const [hidden, setHidden] = useState(() => document.hidden)
  const [inView, setInView] = useState(true)
  const controlled = activeSlideId !== undefined
  const effectiveId = controlled
    ? activeSlideId
    : (currentId && availableSlides.some(s => s.id === currentId) ? currentId : availableSlides[0]?.id)
  const activeIndex = Math.max(0, availableSlides.findIndex(slide => slide.id === effectiveId))
  const activeSlide = availableSlides[activeIndex]
  const activeKey = activeSlide ? `${activeSlide.id}:${activeSlide.imageUrl}` : ''

  const [preloadUnlocked, setPreloadUnlocked] = useState(false)
  const [slideTransition, setSlideTransition] = useState<{
    activeKey: string
    activeIndex: number
    activeId: string
    currentSlide: HeroSlide | undefined
    exitingSlide: HeroSlide | undefined
    exitingIndex: number
    enteringKey: string | null
  }>(() => ({
    activeKey,
    activeIndex,
    activeId: activeSlide?.id ?? '',
    currentSlide: activeSlide,
    exitingSlide: undefined,
    exitingIndex: 0,
    enteringKey: null,
  }))

  if (activeKey !== slideTransition.activeKey) {
    const isInitialHydration =
      !slideTransition.currentSlide ||
      (slideTransition.activeId.startsWith('hero-') &&
        Boolean(activeSlide?.id.startsWith('api-hero-')) &&
        slideTransition.activeIndex === activeIndex)

    setSlideTransition({
      activeKey,
      activeIndex,
      activeId: activeSlide?.id ?? '',
      currentSlide: activeSlide,
      exitingSlide: isInitialHydration ? undefined : slideTransition.currentSlide,
      exitingIndex: slideTransition.activeIndex,
      enteringKey: isInitialHydration ? null : activeKey,
    })
  }

  useEffect(() => {
    if (!slideTransition.exitingSlide && !slideTransition.enteringKey) return
    const timer = window.setTimeout(() => {
      setSlideTransition(prev =>
        prev.exitingSlide || prev.enteringKey
          ? { ...prev, exitingSlide: undefined, enteringKey: null }
          : prev,
      )
    }, 700)
    return () => window.clearTimeout(timer)
  }, [slideTransition.exitingSlide, slideTransition.enteringKey])

  useEffect(() => {
    if (preloadUnlocked) return
    const unlock = () => setPreloadUnlocked(true)
    const timer = window.setTimeout(unlock, 4500)
    const events = ['scroll', 'wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const event of events) {
      window.addEventListener(event, unlock, { passive: true })
    }
    return () => {
      window.clearTimeout(timer)
      for (const event of events) {
        window.removeEventListener(event, unlock)
      }
    }
  }, [preloadUnlocked])

  useEffect(() => {
    if (!preloadUnlocked || availableSlides.length === 0) return
    const indices = new Set([
      activeIndex,
      (activeIndex + 1) % availableSlides.length,
      (activeIndex - 1 + availableSlides.length) % availableSlides.length,
    ])
    for (const idx of indices) {
      const url = availableSlides[idx]?.imageUrl
      if (url) void preloadProtectedImage(url)
    }
  }, [preloadUnlocked, availableSlides, activeIndex])

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
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
    if (controlled || availableSlides.length <= 1 || hidden || !inView) return
    const interval = window.setInterval(() => {
      setCurrentId(prevId => {
        const currIndex = Math.max(0, availableSlides.findIndex(s => s.id === prevId))
        const nextIndex = (currIndex + 1) % availableSlides.length
        return availableSlides[nextIndex].id
      })
    }, 5000)
    return () => window.clearInterval(interval)
  }, [controlled, availableSlides, hidden, inView])

  return (
    <section ref={sectionRef} id="hero" className="hero" aria-labelledby="hero-title" tabIndex={-1}>
      <div className="hero__stage">
        <div className="hero__background">
          {slideTransition.exitingSlide &&
            `${slideTransition.exitingSlide.id}:${slideTransition.exitingSlide.imageUrl}` !== activeKey && (
              <div
                className="hero__slide hero__slide--exiting"
                key={`${slideTransition.exitingSlide.id}:${slideTransition.exitingSlide.imageUrl}`}
                aria-hidden="true"
              >
                <HeroImage
                  slide={slideTransition.exitingSlide}
                  fallbackImageUrl={slides[0]?.imageUrl}
                  isFirst={slideTransition.exitingIndex === 0}
                />
              </div>
          )}
          {activeSlide && (
            <div
              className={slideTransition.enteringKey === activeKey ? 'hero__slide hero__slide--entering' : 'hero__slide'}
              key={activeKey}
            >
              <HeroImage slide={activeSlide} fallbackImageUrl={slides[0]?.imageUrl} isFirst={activeIndex === 0} />
            </div>
          )}
        </div>
        <div className="hero__content">
          <div className="hero__title-group">
            <p className="hero__role"><span aria-hidden="true" />Photographer</p>
            <h1 id="hero-title">Kevin D<br />Gonzalez</h1>
            {location ? (
              <p className="hero__location">{location}<span aria-hidden="true" /></p>
            ) : null}
          </div>
          <p className="hero__description">Photography that feels natural, intentional, and uniquely yours.</p>
          <div className="hero__actions">
            <ActionLink href={destinations.booking} className="action action--primary" effect="light-sweep">Book Your Session</ActionLink>
            <ActionLink href={destinations.explore} className="action action--text" effect="red-text">Explore My Work...</ActionLink>
          </div>
        </div>
      </div>
      <div className="hero__footer">
        <p>Portraits, events, and visual stories crafted with intention.</p>
        <ActionLink href={destinations.discover} className="action action--text hero__discover" effect="red-sweep">SCROLL TO DISCOVER ↓</ActionLink>
      </div>
    </section>
  )
}
