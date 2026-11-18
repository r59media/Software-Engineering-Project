import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { HeroDestinations, HeroSlide } from '../../types/hero'
import { ActionLink } from '../../components/ActionLink'
import { ProtectedCanvasImage, preloadProtectedImage } from '../../components/ProtectedCanvasImage'
import { usePublicProfile } from '../about/useAboutData'
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
    return slides.filter(slide => {
      if (!slide.imageUrl.trim() || ids.has(slide.id)) return false
      ids.add(slide.id)
      return true
    })
  }, [slides])
  const sectionRef = useRef<HTMLElement>(null)
  const [currentId, setCurrentId] = useState<string | undefined>(() => availableSlides[0]?.id)
  const [hidden, setHidden] = useState(() => document.hidden)
  const [inView, setInView] = useState(true)
  const controlled = activeSlideId !== undefined
  const activeIndex = Math.max(0, availableSlides.findIndex(slide => slide.id === (controlled ? activeSlideId : currentId)))
  const activeSlide = availableSlides[activeIndex]

  useEffect(() => {
    if (availableSlides.length === 0) return
    const indices = new Set([
      activeIndex,
      (activeIndex + 1) % availableSlides.length,
      (activeIndex - 1 + availableSlides.length) % availableSlides.length,
    ])
    for (const idx of indices) {
      const url = availableSlides[idx]?.imageUrl
      if (url) void preloadProtectedImage(url)
    }
  }, [availableSlides, activeIndex])

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
    }, 1800)
    return () => window.clearInterval(interval)
  }, [controlled, availableSlides, hidden, inView])

  return (
    <section ref={sectionRef} id="hero" className="hero" aria-labelledby="hero-title" tabIndex={-1}>
      <div className="hero__stage">
        <div className="hero__background">
          <AnimatePresence initial={false}>
            {activeSlide && (
              <motion.div
                className="hero__slide"
                key={`${activeSlide.id}:${activeSlide.imageUrl}`}
                initial={{ x: '100%' }}
                animate={{ x: '0%' }}
                exit={{ x: '-100%' }}
                transition={{
                  duration: 0.22,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <HeroImage slide={activeSlide} fallbackImageUrl={slides[0]?.imageUrl} isFirst={activeIndex === 0} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="hero__content">
          <p className="hero__role"><span aria-hidden="true" />Photographer</p>
          <h1 id="hero-title">Kevin D<br />Gonzalez</h1>
          {location ? (
            <p className="hero__location">{location}<span aria-hidden="true" /></p>
          ) : null}
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
