import { useCallback, useEffect, useState } from 'react'
import './styles/global.css'
import { fetchBookingServices, fetchHeroSlides, fetchPricing, submitContactLead, type PricingData } from './api/client'
import { SiteHeader } from './components/SiteHeader'
import { heroDestinations, heroSlides } from './config/hero'
import { previewBookingServices } from './config/booking'
import { AboutToRecent } from './sections/transition/AboutToRecent'
import { PortfolioGallery } from './sections/portfolio/PortfolioGallery'
import { ContactSection } from './sections/contact/ContactSection'
import { BookingSection } from './sections/booking/BookingSection'
import { Hero } from './sections/hero/Hero'
import { SiteFooter } from './sections/footer/SiteFooter'
import type { HeroSlide } from './types/hero'
import type { BookingReviewDraft, BookingService } from './types/booking'
import type { ContactInquiry } from './types/contact'
import { DepositCheckoutModal } from './sections/booking/DepositCheckoutModal'
import { LegalPage } from './pages/legal/LegalPage'
import { FaqPage } from './pages/faq/FaqPage'

function App() {
  const [slides, setSlides] = useState<readonly HeroSlide[]>(heroSlides)
  const [bookingServices, setBookingServices] = useState<readonly BookingService[]>(previewBookingServices)
  const [pricing, setPricing] = useState<PricingData | null>(null)
  const [bookingStatus, setBookingStatus] = useState<'ready' | 'loading' | 'error'>('loading')
  const [depositDraft, setDepositDraft] = useState<BookingReviewDraft | null>(null)
  const baseUrl = import.meta.env.BASE_URL
  const path = window.location.pathname.replace(/\/$/, '')
  const cleanBase = baseUrl.replace(/\/$/, '')
  const legalPage =
    path === `${cleanBase}/privacy-policy` || path === `${cleanBase}/privacy`
      ? 'privacy'
      : path === `${cleanBase}/terms-and-conditions` || path === `${cleanBase}/terms`
        ? 'terms'
        : null
  const isFaqPage = path === `${cleanBase}/faq`
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

  if (legalPage) {
    const homeDestinations = Object.fromEntries(
      Object.entries(heroDestinations).map(([key, href]) => [key, href?.startsWith('#') ? `${baseUrl}${href}` : href])
    )
    return <div id="top" className="site-shell">
      <a className="skip-link" href="#legal-content">Skip to content</a>
      <SiteHeader destinations={homeDestinations} homeHref={baseUrl} />
      <LegalPage page={legalPage} />
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
      <FaqPage />
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
      <AboutToRecent />
      <PortfolioGallery />
      <BookingSection
        services={bookingServices}
        pricing={pricing}
        status={bookingStatus}
        onRetry={loadBookingServices}
        inquiryHref="#contact"
        onProceedToDeposit={draft => setDepositDraft(draft)}
      />
      <ContactSection onSendInquiry={handleSendInquiry} />
    </main>
    <SiteFooter />
    {depositDraft && (
      <DepositCheckoutModal
        draft={depositDraft}
        service={bookingServices.find(s => s.id === depositDraft.serviceId) || null}
        onClose={() => setDepositDraft(null)}
      />
    )}
  </div>
}

export default App
