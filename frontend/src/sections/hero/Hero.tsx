import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { HeroDestinations, HeroSlide } from '../../types/hero'
import { ActionLink } from '../../components/ActionLink'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import './Hero.css'

export interface HeroProps {
  slides: readonly HeroSlide[]
  activeSlideId?: string
  destinations: HeroDestinations
}

interface HeroImageProps {
  slide: HeroSlide
  fallbackImageUrl?: string
}

function HeroImage({ slide, fallbackImageUrl }: HeroImageProps) {
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
          onError={handleImageError}
        />
      )}
    </div>
  )
}

export function Hero({ slides, activeSlideId, destinations }: HeroProps) {
  const availableSlides = useMemo(() => {
    const ids = new Set<string>()
    return slides.filter(slide => {
      if (!slide.imageUrl.trim() || ids.has(slide.id)) return false
      ids.add(slide.id)
      return true
    })
  }, [slides])
  const [currentId, setCurrentId] = useState<string | undefined>(() => availableSlides[0]?.id)
  const [hidden, setHidden] = useState(() => document.hidden)
  const controlled = activeSlideId !== undefined
  const activeIndex = Math.max(0, availableSlides.findIndex(slide => slide.id === (controlled ? activeSlideId : currentId)))
  const activeSlide = availableSlides[activeIndex]

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (controlled || availableSlides.length <= 1 || hidden) return
    const interval = window.setInterval(() => {
      setCurrentId(prevId => {
        const currIndex = Math.max(0, availableSlides.findIndex(s => s.id === prevId))
        const nextIndex = (currIndex + 1) % availableSlides.length
        return availableSlides[nextIndex].id
      })
    }, 1800)
    return () => window.clearInterval(interval)
  }, [controlled, availableSlides, hidden])

  return (
    <section id="hero" className="hero" aria-labelledby="hero-title" tabIndex={-1}>
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
                <HeroImage slide={activeSlide} fallbackImageUrl={slides[0]?.imageUrl} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="hero__content">
          <p className="hero__role"><span aria-hidden="true" />Photographer</p>
          <h1 id="hero-title">Kevin D<br />Gonzalez</h1>
          <p className="hero__location">Based in New Jersey<span aria-hidden="true" /></p>
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
