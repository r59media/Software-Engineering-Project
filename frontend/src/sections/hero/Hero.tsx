import { useState, type CSSProperties } from 'react'
import type { HeroDestinations, HeroSlide } from '../../types/hero'
import { ActionLink } from '../../components/ActionLink'
import './Hero.css'

export interface HeroProps {
  slides: readonly HeroSlide[]
  activeSlideId?: string
  destinations: HeroDestinations
}

function HeroImage({ slide }: { slide: HeroSlide }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  const position = {
    '--image-position': slide.objectPosition ?? '50% 50%',
    '--image-position-mobile': slide.mobileObjectPosition ?? slide.objectPosition ?? '50% 50%',
  } as CSSProperties
  return <div className="hero__media" data-slide-id={slide.id} data-embedded-overlay={Boolean(slide.hasEmbeddedOverlay)} style={position}>
    <img className="hero__image" src={slide.imageUrl} alt={slide.alt.trim() || 'R59 Media featured automotive and portrait photography'} width={slide.width} height={slide.height} fetchPriority="high" decoding="async" onError={() => setFailed(true)} />
  </div>
}

/** Presentation only: a future parent controller owns fetching and slide changes. */
export function Hero({ slides, activeSlideId, destinations }: HeroProps) {
  const availableSlides = slides.filter(slide => slide.imageUrl.trim().length > 0)
  const activeSlide = availableSlides.find(slide => slide.id === activeSlideId) ?? availableSlides[0]
  return <section id="hero" className="hero" aria-labelledby="hero-title" tabIndex={-1}>
    <div className="hero__stage">
      {activeSlide && <HeroImage key={`${activeSlide.id}:${activeSlide.imageUrl}`} slide={activeSlide} />}
      <div className="hero__content">
        <p className="hero__role"><span aria-hidden="true" />Photographer</p>
        <h1 id="hero-title">Kevin D<br />Gonzalez</h1>
        <p className="hero__location">Based in New Jersey<span aria-hidden="true" /></p>
        <p className="hero__description">Photography that feels natural, intentional, and uniquely yours.</p>
        <div className="hero__actions">
          <ActionLink href={destinations.booking} className="action action--primary">Book Your Session</ActionLink>
          <ActionLink href={destinations.explore} className="action action--text">Explore My Work...</ActionLink>
        </div>
      </div>
    </div>
    <div className="hero__footer">
      <p>Portraits, events, and visual stories crafted with intention.</p>
      <ActionLink href={destinations.discover} className="action action--text hero__discover">SCROLL TO DISCOVER ↓</ActionLink>
    </div>
  </section>
}
