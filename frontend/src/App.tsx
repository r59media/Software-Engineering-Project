import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import './styles/global.css'
import { fetchBookingServices, fetchHeroSlides, fetchPricing, submitContactLead, type PricingData } from './api/client'
import { SiteHeader } from './components/SiteHeader'
import { heroDestinations, heroSlides } from './config/hero'
import { Hero } from './sections/hero/Hero'
import type { HeroSlide } from './types/hero'
import type { BookingService, ConfirmedBookingSummary } from './types/booking'
import type { ContactInquiry } from './types/contact'
const SiteFooter = lazy(() => import('./sections/footer/SiteFooter').then(m => ({ default: m.SiteFooter })))
const PortfolioGallery = lazy(() => import('./sections/portfolio/PortfolioGallery').then(m => ({ default: m.PortfolioGallery })))
const RescheduleModal = lazy(() => import('./sections/booking/RescheduleModal').then(m => ({ default: m.RescheduleModal })))

const AboutToRecent = lazy(() => import('./sections/transition/AboutToRecent').then(m => ({ default: m.AboutToRecent })))
const ContactSection = lazy(() => import('./sections/contact/ContactSection').then(m => ({ default: m.ContactSection })))
const BookingSection = lazy(() => import('./sections/booking/BookingSection').then(m => ({ default: m.BookingSection })))
const LegalPage = lazy(() => import('./pages/legal/LegalPage').then(m => ({ default: m.LegalPage })))
const FaqPage = lazy(() => import('./pages/faq/FaqPage').then(m => ({ default: m.FaqPage })))
const FaqSection = lazy(() => import('./pages/faq/FaqPage').then(m => ({ default: m.FaqSection })))
const NotFoundPage = lazy(() => import('./pages/notFound/NotFoundPage'))

const SECTION_IDS = ['about', 'portfolio', 'booking', 'faq', 'contact'] as const

const HASH_TO_SECTION_INDEX: Record<string, number> = {
  about: 0,
  'recent-photoshoot': 0,
  portfolio: 1,
  booking: 2,
  services: 2,
  pricing: 2,
  faq: 3,
  contact: 4,
}

function normalizeHashId(hash: string): string | null {
  const id = hash.replace(/^#/, '').trim().toLowerCase()
  return id in HASH_TO_SECTION_INDEX ? id : null
}

function getSectionIndexForHash(hash: string): number {
  const id = normalizeHashId(hash)
  return id ? HASH_TO_SECTION_INDEX[id] : -1
}

function resolveHashTargetElement(targetId: string): HTMLElement | null {
  return (
    document.getElementById(targetId) ??
    (targetId === 'services' || targetId === 'pricing'
      ? document.getElementById('booking')
      : null)
  )
}

function CommittedSignal({
  sectionId,
  onCommitted,
  children,
}: {
  sectionId: string
  onCommitted?: (sectionId: string) => void
  children: ReactNode
}) {
  useEffect(() => {
    onCommitted?.(sectionId)
  }, [onCommitted, sectionId])
  return <>{children}</>
}

interface DeferredSectionProps {
  id: string
  secondaryId?: string
  heading: string
  fallbackClassName?: string
  minHeight: string
  rootMargin?: string
  engaged: boolean
  forceMount: boolean
  onCommitted?: (sectionId: string) => void
  children: ReactNode
}

function DeferredSection({
  id,
  secondaryId,
  heading,
  fallbackClassName,
  minHeight,
  rootMargin,
  engaged,
  forceMount,
  onCommitted,
  children,
}: DeferredSectionProps) {
  const placeholderRef = useRef<HTMLElement | null>(null)
  const [intersected, setIntersected] = useState(false)
  const mounted = forceMount || intersected

  useEffect(() => {
    if (mounted) return
    const target = placeholderRef.current
    if (!target || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        const hit = engaged
          ? entries.some(entry => entry.isIntersecting)
          : entries.some(entry => entry.isIntersecting && entry.intersectionRect.height > 1)
        if (hit) {
          setIntersected(true)
          observer.disconnect()
        }
      },
      engaged
        ? { rootMargin: rootMargin ?? '600px' }
        : { rootMargin: '-1px 0px -1px 0px', threshold: 0.01 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [mounted, engaged, rootMargin])

  const placeholder = (
    <section
      ref={placeholderRef}
      id={id}
      className={fallbackClassName}
      style={{ minHeight }}
      aria-label={heading}
    >
      <h2 className="sr-only">{heading}</h2>
      {secondaryId ? <div id={secondaryId} /> : null}
    </section>
  )

  if (!mounted) {
    return placeholder
  }

  return (
    <Suspense fallback={placeholder}>
      <CommittedSignal sectionId={id} onCommitted={onCommitted}>
        {children}
      </CommittedSignal>
    </Suspense>
  )
}

function App() {
  const [engaged, setEngaged] = useState(() => window.scrollY > 4 || Boolean(window.location.hash))
  const [staggerIndex, setStaggerIndex] = useState(-1)
  const [forcedSectionIndex, setForcedSectionIndex] = useState(() => getSectionIndexForHash(window.location.hash))
  const pendingHashRef = useRef<string | null>(normalizeHashId(window.location.hash))
  const committedSectionsRef = useRef<Set<string>>(new Set())
  const engagedRef = useRef(engaged)
  const lastHeroFetchAtRef = useRef(0)
  const bookingLoadedOnceRef = useRef(false)
  const [slides, setSlides] = useState<readonly HeroSlide[]>(heroSlides)
  const [bookingServices, setBookingServices] = useState<readonly BookingService[]>([])
  const [pricing, setPricing] = useState<PricingData | null>(null)
  const [bookingStatus, setBookingStatus] = useState<'ready' | 'loading' | 'error'>('loading')
  const [confirmedBooking, setConfirmedBooking] = useState<ConfirmedBookingSummary | null>(null)
  const [rescheduleParams, setRescheduleParams] = useState<{ bookingId: string; token: string } | null>(() => {
    const params = new URLSearchParams(window.location.search)
    const bookingId = (params.get('booking') || params.get('bookingId') || params.get('reschedule') || '').trim()
    const token = (params.get('token') || '').trim()
    return bookingId && token ? { bookingId, token } : null
  })
  const baseUrl = import.meta.env.BASE_URL
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
  const cleanBase = baseUrl.replace(/\/$/, '')
  const isRescheduleRoute =
    normalizedPath === '/reschedule' || (cleanBase !== '' && normalizedPath === `${cleanBase}/reschedule`)
  const handleCloseReschedule = useCallback(() => {
    setRescheduleParams(null)
    if (isRescheduleRoute) {
      window.location.assign(baseUrl)
      return
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('booking')
    url.searchParams.delete('bookingId')
    url.searchParams.delete('reschedule')
    url.searchParams.delete('token')
    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState(window.history.state, '', nextUrl)
  }, [baseUrl, isRescheduleRoute])
  const legalPage =
    normalizedPath === `${cleanBase}/privacy-policy` || normalizedPath === `${cleanBase}/privacy`
      ? 'privacy'
      : normalizedPath === `${cleanBase}/terms-and-conditions` || normalizedPath === `${cleanBase}/terms`
        ? 'terms'
        : null
  const isFaqPage = normalizedPath === `${cleanBase}/faq`
  const isHome =
    normalizedPath === '/' ||
    normalizedPath === '' ||
    (cleanBase !== '' && (normalizedPath === cleanBase || normalizedPath === `${cleanBase}/`))
  const isNotFound = !isHome && !legalPage && !isFaqPage && !isRescheduleRoute && !rescheduleParams
  const loadBookingServices = useCallback(async () => {
    try {
      const [{ previewBookingServices }, services, livePricing] = await Promise.all([
        import('./config/booking'),
        fetchBookingServices(),
        fetchPricing(),
      ])
      if (services && services.length > 0) {
        setBookingServices(services)
      } else {
        setBookingServices(previewBookingServices)
      }
      if (livePricing) {
        setPricing(livePricing)
      }
      setBookingStatus('ready')
    } catch {
      const { previewBookingServices } = await import('./config/booking')
      setBookingServices(previewBookingServices)
      setBookingStatus('ready')
    }
  }, [])

  const handleSendInquiry = useCallback(async (inquiry: ContactInquiry) => {
    const extraParts = [
      inquiry.eventDate?.trim() ? `Target date: ${inquiry.eventDate.trim()}` : '',
      inquiry.location?.trim() ? `Location: ${inquiry.location.trim()}` : '',
    ].filter(Boolean)
    const combinedMessage = extraParts.length > 0
      ? `${extraParts.join(' | ')}\n\n${inquiry.message.trim()}`
      : inquiry.message.trim()

    const result = await submitContactLead({
      name: inquiry.name.trim(),
      email: inquiry.email.trim(),
      phone: inquiry.phone.trim() || undefined,
      session_type: inquiry.inquiryType || 'Other',
      message: combinedMessage,
    })

    if (result.status !== 'success') {
      throw new Error(result.message || 'Unable to send inquiry.')
    }
  }, [])

  const handleSectionCommitted = useCallback((sectionId: string) => {
    committedSectionsRef.current.add(sectionId)
    const pendingId = pendingHashRef.current
    if (!pendingId) return
    const targetIndex = getSectionIndexForHash(pendingId)
    if (targetIndex === -1 || SECTION_IDS[targetIndex] !== sectionId) return
    pendingHashRef.current = null
    requestAnimationFrame(() => {
      resolveHashTargetElement(pendingId)?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [])

  useEffect(() => {
    engagedRef.current = engaged
  }, [engaged])

  useEffect(() => {
    if (engaged) return
    const markEngaged = () => setEngaged(true)
    const events: Array<keyof WindowEventMap> = [
      'scroll',
      'wheel',
      'touchstart',
      'pointerdown',
      'pointermove',
      'keydown',
      'hashchange',
    ]
    events.forEach(eventName =>
      window.addEventListener(eventName, markEngaged, { passive: true, once: true }),
    )
    return () => {
      events.forEach(eventName => window.removeEventListener(eventName, markEngaged))
    }
  }, [engaged])

  useEffect(() => {
    if (!engaged) return
    const schedule: Array<[number, number]> = [
      [1, 150],
      [2, 300],
      [3, 450],
      [4, 600],
    ]
    const timers = schedule.map(([idx, delay]) =>
      window.setTimeout(() => {
        setStaggerIndex(prev => (prev < idx ? idx : prev))
      }, delay),
    )
    return () => {
      timers.forEach(timerId => window.clearTimeout(timerId))
    }
  }, [engaged])

  useEffect(() => {
    if (legalPage || isFaqPage || isRescheduleRoute || rescheduleParams) return

    const navigateToHash = (rawHash: string, event?: MouseEvent) => {
      const targetId = normalizeHashId(rawHash)
      if (!targetId) return
      const sectionIndex = HASH_TO_SECTION_INDEX[targetId]
      setEngaged(true)
      const sectionId = SECTION_IDS[sectionIndex]
      if (committedSectionsRef.current.has(sectionId)) {
        const targetEl = resolveHashTargetElement(targetId)
        if (targetEl) {
          event?.preventDefault()
          if (window.location.hash !== `#${targetId}`) {
            window.history.pushState(null, '', `#${targetId}`)
          }
          requestAnimationFrame(() => {
            targetEl.scrollIntoView({ behavior: 'smooth' })
          })
        }
        return
      }
      event?.preventDefault()
      if (window.location.hash !== `#${targetId}`) {
        window.history.pushState(null, '', `#${targetId}`)
      }
      pendingHashRef.current = targetId
      setForcedSectionIndex(prev => Math.max(prev, sectionIndex))
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const target = event.target as HTMLElement | null
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const rawHref = anchor.getAttribute('href')
      if (!rawHref || !rawHref.includes('#')) return
      let parsed: URL
      try {
        parsed = new URL(anchor.href, window.location.href)
      } catch {
        return
      }
      if (
        parsed.origin !== window.location.origin ||
        parsed.pathname !== window.location.pathname
      ) {
        return
      }
      navigateToHash(parsed.hash, event)
    }

    const handleHashChange = () => {
      navigateToHash(window.location.hash)
    }

    document.addEventListener('click', handleDocumentClick)
    window.addEventListener('hashchange', handleHashChange)
    return () => {
      document.removeEventListener('click', handleDocumentClick)
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [legalPage, isFaqPage, isRescheduleRoute, rescheduleParams])

  useEffect(() => {
    if (legalPage || !engaged || bookingLoadedOnceRef.current) return
    bookingLoadedOnceRef.current = true
    void loadBookingServices()
  }, [legalPage, engaged, loadBookingServices])

  useEffect(() => {
    if (legalPage) document.title = legalPage === 'privacy' ? 'Privacy Policy | R59 Media' : 'Terms and Conditions | R59 Media'
    if (isFaqPage) document.title = 'FAQ | R59 Media'
  }, [legalPage, isFaqPage])

  useEffect(() => {
    if (legalPage || isFaqPage || isNotFound) return
    let controller: AbortController | null = null

    const load = () => {
      lastHeroFetchAtRef.current = Date.now()
      controller?.abort()
      const current = new AbortController()
      controller = current
      void fetchHeroSlides(heroSlides, current.signal)
        .then(remoteSlides => {
          if (current.signal.aborted) return
          setSlides(prev => {
            const prevSig = JSON.stringify(prev)
            const nextSig = JSON.stringify(remoteSlides)
            return prevSig === nextSig ? prev : remoteSlides
          })
        })
        .catch(() => {})
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastHeroFetchAtRef.current < 3000) return
        load()
        if (engagedRef.current) {
          void loadBookingServices()
        }
      }
    }

    load()

    window.addEventListener('focus', handleVisibilityChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      controller?.abort()
      window.removeEventListener('focus', handleVisibilityChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [legalPage, isFaqPage, isNotFound, loadBookingServices])

  useEffect(() => {
    const isProtectedTarget = (target: HTMLElement | null): boolean => {
      if (!target) return false
      return (
        target.tagName === 'IMG' ||
        target.tagName === 'CANVAS' ||
        Boolean(
          target.closest(
            '.photo-shield-container, .photo-shield, .hero-shield, .about__portrait-shield, .recent__photo, .about__artwork, .about__portrait, .photo-viewer__image, .hero__media'
          )
        )
      )
    }

    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (isProtectedTarget(target)) {
        e.preventDefault()
      }
    }

    const handleDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement | null
      if (isProtectedTarget(target)) {
        e.preventDefault()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (isCtrlOrCmd && (key === 's' || key === 'u')) {
        e.preventDefault()
      }
    }

    document.addEventListener('contextmenu', handleContextMenu)
    document.addEventListener('dragstart', handleDragStart)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('dragstart', handleDragStart)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  if (isRescheduleRoute || rescheduleParams) {
    const homeDestinations = Object.fromEntries(
      Object.entries(heroDestinations).map(([key, href]) => [key, href?.startsWith('#') ? `${baseUrl}${href}` : href])
    )
    return <div id="top" className="site-shell">
      <a className="skip-link" href="#reschedule-content">Skip to content</a>
      <SiteHeader destinations={homeDestinations} homeHref={baseUrl} />
      <main id="reschedule-content" style={{ minHeight: '75vh', padding: '7rem 1.5rem 4rem', display: 'grid', placeItems: 'center', background: 'var(--color-brand-black, #0c0c0c)' }}>
        <Suspense fallback={null}>
          <RescheduleModal
            bookingId={rescheduleParams?.bookingId}
            token={rescheduleParams?.token}
            onClose={handleCloseReschedule}
          />
        </Suspense>
      </main>
      <Suspense fallback={null}>
        <SiteFooter destinations={homeDestinations} homeHref={baseUrl} />
      </Suspense>
    </div>
  }

  if (legalPage) {
    const homeDestinations = Object.fromEntries(
      Object.entries(heroDestinations).map(([key, href]) => [key, href?.startsWith('#') ? `${baseUrl}${href}` : href])
    )
    return <div id="top" className="site-shell">
      <a className="skip-link" href="#legal-content">Skip to content</a>
      <SiteHeader destinations={homeDestinations} homeHref={baseUrl} />
      <Suspense fallback={null}>
        <LegalPage page={legalPage} />
      </Suspense>
      <Suspense fallback={null}>
        <SiteFooter destinations={homeDestinations} homeHref={baseUrl} />
      </Suspense>
    </div>
  }

  if (isFaqPage) {
    const homeDestinations = Object.fromEntries(
      Object.entries(heroDestinations).map(([key, href]) => [key, href?.startsWith('#') ? `${baseUrl}${href}` : href])
    )
    return <div id="top" className="site-shell">
      <a className="skip-link" href="#faq-content">Skip to content</a>
      <SiteHeader destinations={homeDestinations} homeHref={baseUrl} />
      <Suspense fallback={null}>
        <FaqPage />
      </Suspense>
      <Suspense fallback={null}>
        <SiteFooter destinations={homeDestinations} homeHref={baseUrl} />
      </Suspense>
    </div>
  }

  if (isNotFound) {
    const homeDestinations = Object.fromEntries(
      Object.entries(heroDestinations).map(([key, href]) => [key, href?.startsWith('#') ? `${baseUrl}${href}` : href])
    )
    return <div id="top" className="site-shell">
      <a className="skip-link" href="#not-found-content">Skip to content</a>
      <SiteHeader destinations={homeDestinations} homeHref={baseUrl} />
      <Suspense fallback={null}>
        <NotFoundPage />
      </Suspense>
      <Suspense fallback={null}>
        <SiteFooter destinations={homeDestinations} homeHref={baseUrl} />
      </Suspense>
    </div>
  }

  return <div id="top" className="site-shell">
    <a className="skip-link" href="#hero">Skip to content</a>
    <SiteHeader destinations={heroDestinations} />
    <main>
      <div className="site-intro">
        <Hero slides={slides} destinations={heroDestinations} />
      </div>
      <DeferredSection
        id="about"
        secondaryId="recent-photoshoot"
        heading="About Me"
        fallbackClassName="about-transition-placeholder"
        minHeight="100svh"
        engaged={engaged}
        forceMount={engaged || forcedSectionIndex >= 0}
        onCommitted={handleSectionCommitted}
      >
        <AboutToRecent />
      </DeferredSection>
      <DeferredSection
        id="portfolio"
        heading="Portfolio"
        minHeight="80vh"
        rootMargin="2000px"
        engaged={engaged}
        forceMount={forcedSectionIndex >= 1 || staggerIndex >= 1}
        onCommitted={handleSectionCommitted}
      >
        <PortfolioGallery />
      </DeferredSection>
      <DeferredSection
        id="booking"
        heading="Book a Session"
        minHeight="85vh"
        rootMargin="2000px"
        engaged={engaged}
        forceMount={forcedSectionIndex >= 2 || staggerIndex >= 2}
        onCommitted={handleSectionCommitted}
      >
        <BookingSection
          services={bookingServices}
          pricing={pricing}
          squareConfig={pricing?.squareConfig ?? null}
          status={bookingStatus}
          onRetry={loadBookingServices}
          inquiryHref="#contact"
          confirmedBooking={confirmedBooking}
          onResetBooking={() => setConfirmedBooking(null)}
          onProceedToDeposit={() => {
            setConfirmedBooking(null)
          }}
        />
      </DeferredSection>
      <DeferredSection
        id="faq"
        heading="Frequently Asked Questions"
        minHeight="60vh"
        rootMargin="2000px"
        engaged={engaged}
        forceMount={forcedSectionIndex >= 3 || staggerIndex >= 3}
        onCommitted={handleSectionCommitted}
      >
        <FaqSection />
      </DeferredSection>
      <DeferredSection
        id="contact"
        heading="Contact"
        minHeight="60vh"
        rootMargin="2000px"
        engaged={engaged}
        forceMount={forcedSectionIndex >= 4 || staggerIndex >= 4}
        onCommitted={handleSectionCommitted}
      >
        <ContactSection onSendInquiry={handleSendInquiry} />
      </DeferredSection>
    </main>
    {engaged ? (
      <Suspense fallback={<footer style={{ minHeight: '280px' }} />}>
        <SiteFooter />
      </Suspense>
    ) : (
      <footer style={{ minHeight: '280px' }} />
    )}
  </div>
}

export default App
