import { useEffect, useId, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { computeSessionPricing } from '../../api/client'
import { previewBookingServices } from '../../config/booking'
import type { BookingServicesProps, ServiceSelection } from '../../types/booking'
import { BookingProgressBar } from './BookingProgressBar'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import './BookingServices.css'

export function BookingServices({
  services = previewBookingServices,
  pricing = null,
  status = 'ready',
  onRetry,
  onContinue,
  onSelectionChange,
  inquiryHref,
  initialSelection,
}: BookingServicesProps) {
  const [selection, setSelection] = useState<ServiceSelection | null>(initialSelection ?? null)
  const [prevInitial, setPrevInitial] = useState(initialSelection)
  if (initialSelection !== prevInitial) {
    setPrevInitial(initialSelection)
    setSelection(initialSelection ?? null)
  }

  const [visibleIndex, setVisibleIndex] = useState(0)
  const indicatorId = useId().replace(/:/g, '')
  const reducedMotion = useReducedMotion()
  const track = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = track.current
    if (!container) return
    let frame = 0
    const updateDepth = () => {
      const mobile = window.matchMedia('(max-width: 767px)').matches
      const center = container.scrollLeft + container.clientWidth / 2
      Array.from(container.children).forEach(child => {
        const card = child as HTMLElement
        const offset = (card.offsetLeft - container.offsetLeft + card.offsetWidth / 2 - center) / (card.offsetWidth + 16)
        const progress = mobile && !reducedMotion ? Math.max(-1, Math.min(1, offset)) : 0
        card.style.setProperty('--card-tilt', `${progress * 2.5}deg`)
        card.style.setProperty('--card-scale', `${1 - Math.abs(progress) * .035}`)
        card.style.setProperty('--card-depth', `${Math.abs(progress) * 3}px`)
      })
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateDepth)
    }
    container.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      container.removeEventListener('scroll', schedule)
      observer.disconnect()
    }
  }, [services, status, reducedMotion])


  const selected =
    status === 'ready'
      ? services.find(service => service.id === selection?.serviceId && service.bookingMode === 'direct')
      : undefined

  const validSelection =
    selected && selection
      ? {
          ...selection,
          people: Math.max(
            selected.additionalPeople?.includedPeople ?? 1,
            Math.min(
              selection.people,
              selected.additionalPeople ? selected.additionalPeople.maxPeople ?? Number.MAX_SAFE_INTEGER : 1
            )
          ),
        }
      : null

  const updateSelection = (next: ServiceSelection) => {
    setSelection(next)
    onSelectionChange?.(next)
  }

  const showCard = (index: number) => {
    const container = track.current
    const card = container?.children[index] as HTMLElement | undefined
    if (container && card) {
      container.scrollTo({
        left: card.offsetLeft - container.offsetLeft - (container.clientWidth - card.clientWidth) / 2,
        behavior: 'auto',
      })
    }
  }

  return (
    <section id="booking" className="booking" aria-labelledby="booking-title">
      <div className="booking__inner">
        <header className="booking__header">
          <div className="booking__title-group">
            <p className="booking__eyebrow">
              <span aria-hidden="true" />
              Booking
            </p>
            <h2 id="booking-title">BOOK YOUR SESSION</h2>
          </div>
          <p className="booking__subtitle">
            Your next great photo starts here. Choose a session to get started.{' '}
            <a
              href={`${import.meta.env.BASE_URL}reschedule`}
              style={{
                color: '#7a5b00',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                whiteSpace: 'nowrap',
              }}
            >
              Already booked? Reschedule →
            </a>
          </p>
        </header>

        <BookingProgressBar currentStep="services" />

        <h3>Choose your session</h3>
        <p className="booking__intro">Select one service. You’ll choose your date and time next.</p>
        <div className="booking__panel" aria-busy={status === 'loading'}>
          {status === 'loading' ? (
            <div role="status" aria-label="Loading services" className="booking__skeletons">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="booking__skeleton" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : status === 'error' ? (
            <div className="booking__message" role="alert">
              <p>We couldn’t load the services. Please try again.</p>
              {onRetry && (
                <button type="button" className="booking__button" onClick={onRetry}>
                  Try again
                </button>
              )}
            </div>
          ) : !services.length ? (
            <div className="booking__message" role="status">
              No sessions are available right now. Please check back later.
            </div>
          ) : (
            <>
              <div
                className="booking__services"
                ref={track}
                role="group"
                aria-label="Choose one service"
                onScroll={event => {
                  const container = event.currentTarget
                  const center = container.scrollLeft + container.clientWidth / 2
                  let nearest = 0
                  let distance = Infinity
                  Array.from(container.children).forEach((child, index) => {
                    const card = child as HTMLElement
                    const delta = Math.abs(card.offsetLeft - container.offsetLeft + card.clientWidth / 2 - center)
                    if (delta < distance) {
                      nearest = index
                      distance = delta
                    }
                  })
                  setVisibleIndex(nearest)
                }}
              >
                {services.map(service => {
                  const active = selected?.id === service.id
                  const people = active ? validSelection?.people ?? 1 : service.additionalPeople?.includedPeople ?? 1
                  const extra = service.additionalPeople
                  const breakdown = computeSessionPricing(service, people, pricing)
                  const price =
                    breakdown.subtotalMinor === null
                      ? 'Custom pricing'
                      : new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: service.currency,
                          maximumFractionDigits: 2,
                        }).format(breakdown.subtotalMinor / 100)
                  return (
                    <article
                      key={service.id}
                      className="booking__service"
                      data-service-id={service.id}
                      data-selected={active}
                    >
                      {service.image ? (
                        <ProtectedCanvasImage
                          src={service.image.url}
                          alt={service.image.alt}
                          className="booking__image-canvas"
                          containerClassName="booking__image"
                        />
                      ) : (
                        <div className="booking__image booking__placeholder" aria-hidden="true" />
                      )}
                      <div className="booking__description">
                        <h4>{service.name}</h4>
                        <p>{service.description}</p>
                      </div>
                      <p className="booking__best">Best for: {service.bestFor}</p>
                      <div className="booking__details">
                        <span>
                          {service.durationMinutes === null
                            ? 'Scope and timing tailored to you'
                            : `${service.durationMinutes >= 180 ? `${service.durationMinutes / 60} hours` : `${service.durationMinutes} min`}${service.photoCount ? ` · ${service.photoCount} photos` : ''}${service.outfits ? ` · ${service.outfits} outfit${service.outfits === 1 ? '' : 's'}` : ''}`}
                        </span>
                        {active && extra && (
                          <div className="booking__people">
                            <button
                              type="button"
                              aria-label={`Fewer people for ${service.name}`}
                              disabled={people <= extra.includedPeople}
                              onClick={() => updateSelection({ serviceId: service.id, people: people - 1 })}
                            >
                              −
                            </button>
                            <output aria-label="Number of people">{people}</output>
                            <button
                              type="button"
                              aria-label={`More people for ${service.name}`}
                              disabled={people >= (extra.maxPeople ?? Number.MAX_SAFE_INTEGER)}
                              onClick={() => updateSelection({ serviceId: service.id, people: people + 1 })}
                            >
                              +
                            </button>
                            <small>
                              +1 person{' '}
                              <strong>
                                {extra.extraPersonPriceMinor === undefined
                                  ? '+30%'
                                  : `+${new Intl.NumberFormat('en-US', { style: 'currency', currency: service.currency }).format(extra.extraPersonPriceMinor / 100)}`}
                              </strong>
                            </small>
                          </div>
                        )}
                      </div>
                      <strong className="booking__price" data-custom={service.priceMinor === null}>
                        {price}
                      </strong>
                      {service.bookingMode === 'inquiry' ? (
                        <div className="booking__inquiry">
                          {inquiryHref ? (
                            <a className="booking__button" href={inquiryHref}>
                              Request inquiry
                            </a>
                          ) : (
                            <button type="button" className="booking__button" disabled aria-describedby="booking-inquiry-note">
                              Request inquiry
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="booking__button booking__select"
                          aria-pressed={active}
                          aria-label={`${active ? 'Selected' : 'Select'} ${service.name}`}
                          onClick={() => updateSelection({ serviceId: service.id, people })}
                        >
                          {active ? 'Selected' : 'Select session'}
                        </button>
                      )}
                    </article>
                  )
                })}
              </div>
              <div className="booking__mobile-controls">
                <svg className="booking__gooey-filter" aria-hidden="true" focusable="false"><defs><filter id={indicatorId} x="-30%" y="-50%" width="160%" height="200%"><feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" /><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8" /></filter></defs></svg>
                <div className="booking__dots" aria-label="Browse services">
                  <div className="booking__dots-liquid" aria-hidden="true" style={{ filter: reducedMotion ? 'none' : `url(#${indicatorId})` }}>
                    {services.map((service, index) => <span className="booking__dot-slot" key={service.id}>
                      <span className="booking__dot-base" />
                      {index === Math.min(visibleIndex, services.length - 1) && <motion.span className="booking__dot-pill" layoutId={`${indicatorId}-pill`} transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 25 }} initial={false} animate={{ scaleX: reducedMotion ? 1 : [1, 1.45, 1], scaleY: reducedMotion ? 1 : [1, .82, 1] }} />}
                    </span>)}
                  </div>
                  {services.map((service, index) => (
                    <button
                      type="button"
                      key={service.id}
                      aria-label={`Show ${service.name}`}
                      aria-current={index === Math.min(visibleIndex, services.length - 1) ? 'true' : undefined}
                      onClick={() => showCard(index)}
                    >
                    </button>
                  ))}
                </div>
                <div className="booking__browse">
                  <button
                    type="button"
                    aria-label="Previous service"
                    disabled={visibleIndex <= 0}
                    onClick={() => showCard(visibleIndex - 1)}
                  >
                    ←
                  </button>
                  <span>Swipe to explore</span>
                  <button
                    type="button"
                    aria-label="Next service"
                    disabled={visibleIndex >= services.length - 1}
                    onClick={() => showCard(visibleIndex + 1)}
                  >
                    →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <footer className="booking__footer">
          <div>
            <p className="booking__selection" role="status">
              {selected ? `${selected.name} selected` : 'Choose a session to continue'}
            </p>
            <p id="booking-inquiry-note">Business package? Request a quote first; scheduling follows your proposal.</p>
          </div>
          <div className="booking__next">
            <button
              type="button"
              className="booking__button"
              disabled={!validSelection}
              onClick={() => {
                if (validSelection) onContinue?.(validSelection)
              }}
            >
              Continue to date &amp; time →
            </button>
          </div>
        </footer>
      </div>
    </section>
  )
}
