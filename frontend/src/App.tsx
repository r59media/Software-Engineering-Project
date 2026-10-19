import { useEffect, useState } from 'react'
import './styles/global.css'
import { fetchHeroSlides } from './api/client'
import { SiteHeader } from './components/SiteHeader'
import { heroDestinations, heroSlides } from './config/hero'
import { Hero } from './sections/hero/Hero'
import type { HeroSlide } from './types/hero'

function App() {
  const [slides, setSlides] = useState<readonly HeroSlide[]>(heroSlides)

  useEffect(() => {
    const controller = new AbortController()
    void fetchHeroSlides(heroSlides, controller.signal).then(remoteSlides => {
      if (!controller.signal.aborted && remoteSlides.length > 0) {
        setSlides(remoteSlides)
      }
    })
    return () => controller.abort()
  }, [])

  return <div className="site-shell">
    <a className="skip-link" href="#hero">Skip to content</a>
    <SiteHeader destinations={heroDestinations} />
    <main><Hero slides={slides} destinations={heroDestinations} /></main>
  </div>
}

export default App
