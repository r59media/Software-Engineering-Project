import { useCallback, useEffect, useState } from 'react'
import './styles/global.css'
import { fetchBookingServices, fetchHeroSlides } from './api/client'
import { SiteHeader } from './components/SiteHeader'
import { heroDestinations, heroSlides } from './config/hero'
import { previewBookingServices } from './config/booking'
import { AboutToRecent } from './sections/transition/AboutToRecent'
import { PortfolioGallery } from './sections/portfolio/PortfolioGallery'
import { BookingSection } from './sections/booking/BookingSection'
import { Hero } from './sections/hero/Hero'
import { SiteFooter } from './sections/footer/SiteFooter'
import type { HeroSlide } from './types/hero'
import type { BookingReviewDraft, BookingService } from './types/booking'
import { DepositCheckoutModal } from './sections/booking/DepositCheckoutModal'
import { LegalPage } from './pages/legal/LegalPage'

function App() {
  const [slides, setSlides] = useState<readonly HeroSlide[]>(heroSlides)
  const [bookingServices, setBookingServices] = useState<readonly BookingService[]>(previewBookingServices)
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

  const loadBookingServices = useCallback(async () => {
    try {
      const services = await fetchBookingServices()
      if (services && services.length > 0) {
        setBookingServices(services)
      } else {
        setBookingServices(previewBookingServices)
      }
      setBookingStatus('ready')
    } catch {
      setBookingServices(previewBookingServices)
      setBookingStatus('ready')
    }
  }, [])

  useEffect(() => {
    if (legalPage) document.title = legalPage === 'privacy' ? 'Privacy Policy | R59 Media' : 'Terms and Conditions | R59 Media'
  }, [legalPage])

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
    void Promise.resolve().then(() => loadBookingServices())
    window.addEventListener('focus', handleVisibilityChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      controller?.abort()
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
        status={bookingStatus}
        onRetry={loadBookingServices}
        inquiryHref="#contact"
        onProceedToDeposit={draft => setDepositDraft(draft)}
      />
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
