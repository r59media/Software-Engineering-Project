import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import './styles/global.css'
import { fetchBookingServices, fetchHeroSlides, fetchPricing, submitContactLead, type PricingData } from './api/client'
import { SiteHeader } from './components/SiteHeader'
import { heroDestinations, heroSlides } from './config/hero'
import { previewBookingServices } from './config/booking'
import { PortfolioGallery } from './sections/portfolio/PortfolioGallery'
import { Hero } from './sections/hero/Hero'
import { SiteFooter } from './sections/footer/SiteFooter'
import type { HeroSlide } from './types/hero'
import type { BookingService, ConfirmedBookingSummary } from './types/booking'
import type { ContactInquiry } from './types/contact'
const RescheduleModal = lazy(() => import('./sections/booking/RescheduleModal').then(m => ({ default: m.RescheduleModal })))

const AboutToRecent = lazy(() => import('./sections/transition/AboutToRecent').then(m => ({ default: m.AboutToRecent })))
const ContactSection = lazy(() => import('./sections/contact/ContactSection').then(m => ({ default: m.ContactSection })))
const BookingSection = lazy(() => import('./sections/booking/BookingSection').then(m => ({ default: m.BookingSection })))
const LegalPage = lazy(() => import('./pages/legal/LegalPage').then(m => ({ default: m.LegalPage })))
const FaqPage = lazy(() => import('./pages/faq/FaqPage').then(m => ({ default: m.FaqPage })))
const FaqSection = lazy(() => import('./pages/faq/FaqPage').then(m => ({ default: m.FaqSection })))

function App() {
  const [slides, setSlides] = useState<readonly HeroSlide[]>(heroSlides)
  const [bookingServices, setBookingServices] = useState<readonly BookingService[]>(previewBookingServices)
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
  const loadBookingServices = useCallback(async () => {
    try {
      const [services, livePricing] = await Promise.all([
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

  useEffect(() => {
    if (legalPage) document.title = legalPage === 'privacy' ? 'Privacy Policy | R59 Media' : 'Terms and Conditions | R59 Media'
    if (isFaqPage) document.title = 'FAQ | R59 Media'
  }, [legalPage, isFaqPage])

  useEffect(() => {
    if (legalPage) return
    let controller: AbortController | null = null

    const load = () => {
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
        load()
        void loadBookingServices()
      }
    }

    load()

    let idleHandle: number | null = null
    let timeoutHandle: number | null = null
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(() => {
        idleHandle = null
        void loadBookingServices()
      }, { timeout: 1200 })
    } else {
      timeoutHandle = window.setTimeout(() => {
        timeoutHandle = null
        void loadBookingServices()
      }, 250)
    }

    window.addEventListener('focus', handleVisibilityChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      controller?.abort()
      if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle)
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle)
      }
      window.removeEventListener('focus', handleVisibilityChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [legalPage, loadBookingServices])

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
      <SiteFooter destinations={homeDestinations} homeHref={baseUrl} />
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
      <SiteFooter destinations={homeDestinations} homeHref={baseUrl} />
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
      <SiteFooter destinations={homeDestinations} homeHref={baseUrl} />
    </div>
  }

  return <div id="top" className="site-shell">
    <a className="skip-link" href="#hero">Skip to content</a>
    <SiteHeader destinations={heroDestinations} />
    <main>
      <div className="site-intro">
        <Hero slides={slides} destinations={heroDestinations} />
      </div>
      <Suspense fallback={<div className="about-transition-placeholder" />}>
        <AboutToRecent />
      </Suspense>
      <PortfolioGallery />
      <Suspense fallback={null}>
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
      </Suspense>
      <Suspense fallback={null}>
        <FaqSection />
      </Suspense>
      <Suspense fallback={null}>
        <ContactSection onSendInquiry={handleSendInquiry} />
      </Suspense>
    </main>
    <SiteFooter />
  </div>
}

export default App
