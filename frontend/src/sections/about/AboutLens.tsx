import { Component, lazy, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { LensTransitionContext } from '../transition/LensTransitionContext'
import { aboutLens } from '../../config/aboutLens'

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
  const [ready, setReady] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia(aboutLens.mobileQuery).matches)

  useEffect(() => {
    const media = window.matchMedia(aboutLens.mobileQuery)
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setReady(true); observer.disconnect() }
    }, { rootMargin: '3200px' })
    if (host.current) observer.observe(host.current)
    return () => { media.removeEventListener('change', update); observer.disconnect() }
  }, [])

  const url = mobile ? aboutLens.mobileUrl : aboutLens.desktopUrl

  useEffect(() => {
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
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 1500 })
      return () => { cancelled = true; window.cancelIdleCallback(id) }
    }
    const timer = window.setTimeout(warm, 200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [url])

  return <div ref={host} className="about__lens" data-about-part="lens-transition" aria-hidden="true">
    <div className="about__motion" data-about-motion="lens-transition">
      <LensBoundary key={url} onFailure={transition?.fail}>
        <Suspense fallback={<LensFallback />}>
          {ready ? <LensScene url={url} aperture={aboutLens.aperture} transition={transition} /> : <LensFallback />}
        </Suspense>
      </LensBoundary>
    </div>
  </div>
}
