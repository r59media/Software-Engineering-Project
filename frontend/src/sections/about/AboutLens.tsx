import { Component, lazy, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { LensTransitionContext } from '../transition/LensTransitionContext'
import { aboutLens } from '../../config/aboutLens'
import { isSlowConnection } from '../../utils/browserEnv'

const loadLensScene = () => import('./LensScene')
const LensScene = lazy(loadLensScene)

function LensFallback() {
  return <div className="about__lens-fallback" data-lens-state="fallback" />
}

class LensBoundary extends Component<{ children: ReactNode; onFailure?: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure?.() }
  render() { return this.state.failed ? <LensFallback /> : this.props.children }
}

export function AboutLens() {
  const transition = useContext(LensTransitionContext)
  const host = useRef<HTMLDivElement>(null)
  const [engaged, setEngaged] = useState(
    () => typeof window !== 'undefined' && (window.scrollY > 10 || Boolean(window.location.hash)),
  )
  const [ready, setReady] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia(aboutLens.mobileQuery).matches)

  useEffect(() => {
    const media = window.matchMedia(aboutLens.mobileQuery)
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => { media.removeEventListener('change', update) }
  }, [])

  useEffect(() => {
    if (engaged) return
    const engage = () => setEngaged(true)
    const events: Array<keyof WindowEventMap> = ['scroll', 'wheel', 'touchstart', 'pointerdown', 'keydown']
    events.forEach(eventName => window.addEventListener(eventName, engage, { passive: true, once: true }))

    const target = document.getElementById('about') ?? host.current
    const observer =
      target && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            ([entry]) => {
              if (entry?.isIntersecting && entry.intersectionRect.height > 1) {
                engage()
                observer?.disconnect()
              }
            },
            { rootMargin: '-1px 0px -1px 0px', threshold: 0.01 },
          )
        : null
    if (target && observer) observer.observe(target)

    return () => {
      events.forEach(eventName => window.removeEventListener(eventName, engage))
      observer?.disconnect()
    }
  }, [engaged])

  useEffect(() => {
    if (!engaged) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setReady(true); observer.disconnect() }
    }, { rootMargin: '800px' })
    if (host.current) observer.observe(host.current)
    return () => { observer.disconnect() }
  }, [engaged])

  const url = mobile ? aboutLens.mobileUrl : aboutLens.desktopUrl

  useEffect(() => {
    if (!engaged || isSlowConnection) return
    let cancelled = false
    fetch(url, {
      headers: { 'X-R59-Client': 'media-viewer' },
      credentials: 'omit',
    }).catch(() => {})
    const warm = () => {
      if (cancelled) return
      void loadLensScene()
        .then(mod => {
          if (!cancelled) mod.preloadLensModel(url)
        })
        .catch(() => {})
    }
    const timer = window.setTimeout(warm, 50)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [engaged, url])

  return <div ref={host} className="about__lens" data-about-part="lens-transition" aria-hidden="true">
    <div className="about__motion" data-about-motion="lens-transition">
      <LensBoundary key={url} onFailure={transition?.fail}>
        <Suspense fallback={<LensFallback />}>
          {ready ? <LensScene url={url} aperture={aboutLens.aperture} transition={transition} staticSnapshot /> : <LensFallback />}
        </Suspense>
      </LensBoundary>
    </div>
  </div>
}
