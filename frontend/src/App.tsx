import { useEffect, useState } from 'react'
import './styles/global.css'
import { fetchHeroSlides } from './api/client'
import { SiteHeader } from './components/SiteHeader'
import { heroDestinations, heroSlides } from './config/hero'
import { AboutToRecent } from './sections/transition/AboutToRecent'
import { Hero } from './sections/hero/Hero'
import { SiteFooter } from './sections/footer/SiteFooter'
import type { HeroSlide } from './types/hero'

function App() {
  const [slides, setSlides] = useState<readonly HeroSlide[]>(heroSlides)

  useEffect(() => {
    const controller = new AbortController()
    void fetchHeroSlides(heroSlides, controller.signal)
      .then(remoteSlides => {
        if (!controller.signal.aborted && remoteSlides !== heroSlides && remoteSlides.length > 0) {
          setSlides(remoteSlides)
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const protectMedia = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'IMG' ||
          target.tagName === 'CANVAS' ||
          target.closest('.recent__photo, .about__artwork, .about__portrait, .photo-viewer__image'))
      ) {
        e.preventDefault()
      }
    }
    document.addEventListener('contextmenu', protectMedia)
    return () => document.removeEventListener('contextmenu', protectMedia)
  }, [])

  return <div id="top" className="site-shell">
    <a className="skip-link" href="#hero">Skip to content</a>
    <main>
      <div className="site-intro">
        <SiteHeader destinations={heroDestinations} />
        <Hero slides={slides} destinations={heroDestinations} />
      </div>
      <AboutToRecent />
    </main>
    <SiteFooter />
  </div>
}

export default App
