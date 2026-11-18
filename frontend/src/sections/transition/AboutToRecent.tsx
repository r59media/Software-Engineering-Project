import { useEffect, useMemo, useRef, useState } from 'react'
import { About } from '../about/About'
import { RecentPhotoshoot } from '../recent/RecentPhotoshoot'
import { LensTransitionContext } from './LensTransitionContext'
import { TransitionLens } from './TransitionLens'
import { aboutLens } from '../../config/aboutLens'
import { isIPad } from '../../utils/browserEnv'
import './AboutToRecent.css'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => value * value * (3 - 2 * value)
const getViewportHeight = (host?: HTMLElement | null) => {
  const probeHeight = host?.querySelector<HTMLElement>('.lens-transition__lvh-probe')?.offsetHeight || 0
  return Math.max(probeHeight, window.innerHeight || 0, Math.round(window.visualViewport?.height || 0))
}

export function AboutToRecent() {
  const root = useRef<HTMLDivElement>(null)
  const [mobile, setMobile] = useState(() => matchMedia(aboutLens.mobileQuery).matches)
  const [readyUrl, setReadyUrl] = useState('')
  const url = mobile ? aboutLens.mobileUrl : aboutLens.desktopUrl
  const [loaded, setLoaded] = useState(false)
  const [fits, setFits] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const listeners = useRef(new Set<(value: number) => void>())
  const controller = useMemo(() => ({
    subscribe: () => () => {},
    ready: () => setLoaded(true),
    fail: () => setFailed(true),
  }), [])
  const overlayController = useMemo(() => ({
    subscribe(listener: (value: number) => void) {
      listeners.current.add(listener)
      return () => { listeners.current.delete(listener) }
    },
    ready: () => setReadyUrl(url),
    fail: () => setFailed(true),
  }), [url])
  const canReserve = !failed && !reduced && fits
  const canAnimate = loaded && canReserve
  const enabled = canAnimate && readyUrl === url

  useEffect(() => {
    const media = matchMedia(aboutLens.mobileQuery)
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const section = root.current?.querySelector<HTMLElement>('#recent-photoshoot')
    if (!section) return
    // Keep all gallery cards scrollable on short/landscape viewports.
    const measure = () => setFits(section.offsetHeight <= getViewportHeight(root.current) + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(section)
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [])

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const host = root.current
    if (!host || !canReserve) return
    const stage = host.querySelector<HTMLElement>('.lens-transition__stage')!
    const about = host.querySelector<HTMLElement>('#about')!
    const recent = host.querySelector<HTMLElement>('.lens-transition__recent')!
    let lastViewport = 0
    const reserve = () => {
      const height = about.offsetHeight
      const viewport = getViewportHeight(host)
      lastViewport = viewport
      host.style.height = `${height + viewport * 1.6}px`
      stage.style.top = `${Math.min(0, viewport - height)}px`
      recent.style.height = `${viewport}px`
    }
    const onResize = () => {
      const nextViewport = getViewportHeight(host)
      if (nextViewport !== lastViewport) reserve()
    }
    const resize = new ResizeObserver(reserve)
    resize.observe(about)
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    reserve()
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      host.style.height = ''
      stage.style.top = ''
      recent.style.height = ''
    }
  }, [canReserve])

  useEffect(() => {
    const host = root.current
    if (!host || !enabled) return
    const subscribers = listeners.current
    const stage = host.querySelector<HTMLElement>('.lens-transition__stage')!
    const about = host.querySelector<HTMLElement>('#about')!
    const lens = host.querySelector<HTMLElement>('.about__lens')!
    const overlay = host.querySelector<HTMLElement>('.lens-transition__lens')!
    const recent = host.querySelector<HTMLElement>('.lens-transition__recent')!
    let frame = 0
    let height = 0
    let distance = 0
    let start = 0
    let x = 0
    let y = 0
    let size = 0
    let viewport = 0
    let width = 0

    let targetProgress = 0
    let displayedProgress = 0
    let hasSnapped = false
    let lastTime = 0

    const calculateTarget = () => {
      if (document.body.style.position === 'fixed') return targetProgress
      const scrollY = Math.max(0, window.scrollY)
      if (scrollY >= start + distance - 1) return 1
      return clamp((scrollY - start) / distance)
    }

    const applyProgress = (progress: number) => {
      const move = smooth(clamp(progress / 0.6))
      const zoom = smooth(clamp((progress - 0.08) / 0.92))
      const aperture = smooth(clamp((progress - 0.12) / 0.5))
      const targetRadius = Math.hypot(width, viewport) * 0.56
      const scale = 1 + zoom * (targetRadius / (size * 0.25) - 1)
      const cx = x + (width / 2 - x) * move
      const cy = y + (height - viewport / 2 - y) * move
      overlay.style.transform = `translate(${cx - size * scale / 2}px, ${cy - size * scale / 2}px) scale(${size * scale / 640})`
      recent.style.clipPath = progress >= 1 ? 'none' : `circle(${size * scale * 0.32}px at ${cx}px ${cy - height + viewport}px)`
      recent.style.visibility = progress > 0 ? 'visible' : 'hidden'
      overlay.style.visibility = progress > 0 && progress < 1 ? 'visible' : 'hidden'
      lens.style.visibility = progress > 0 ? 'hidden' : ''
      // Visible photos respond as soon as the iris starts opening.
      recent.inert = aperture <= 0
      about.inert = progress >= 1
      host.dataset.progress = progress.toFixed(3)
      subscribers.forEach(listener => listener(aperture))
    }
    const syncViewportHeight = () => {
      const nextViewport = getViewportHeight(host)
      if (nextViewport === viewport) return false
      viewport = nextViewport
      stage.style.top = `${Math.min(0, viewport - height)}px`
      recent.style.height = `${viewport}px`
      start = host.getBoundingClientRect().top + window.scrollY + height - viewport
      return true
    }

    const tick = (now: number) => {
      frame = 0
      if (document.body.style.position === 'fixed') {
        lastTime = 0
        return
      }
      syncViewportHeight()
      targetProgress = calculateTarget()
      if (!hasSnapped) {
        hasSnapped = true
        displayedProgress = targetProgress
        lastTime = now
        applyProgress(displayedProgress)
        return
      }
      const dt = lastTime > 0 ? Math.min(64, Math.max(1, now - lastTime)) : 16.67
      lastTime = now
      const diff = targetProgress - displayedProgress
      if (Math.abs(diff) < 0.0005) {
        displayedProgress = targetProgress
        lastTime = 0
      } else {
        const alpha = Math.min(1, (Math.abs(diff) > 0.15 ? 0.45 : 0.28) * (dt / 16.67))
        displayedProgress += diff * alpha
        frame = requestAnimationFrame(tick)
      }
      applyProgress(displayedProgress)
    }

    const schedule = () => { if (!frame) frame = requestAnimationFrame(tick) }

    const measure = () => {
      height = about.offsetHeight
      viewport = getViewportHeight(host)
      width = host.clientWidth
      distance = viewport * 1.6
      const bounds = host.getBoundingClientRect()
      host.style.height = `${height + distance}px`
      stage.style.top = `${Math.min(0, viewport - height)}px`
      recent.style.height = `${viewport}px`
      const lensBounds = lens.getBoundingClientRect()
      const aboutBounds = about.getBoundingClientRect()
      x = lensBounds.left - aboutBounds.left + lensBounds.width / 2
      y = lensBounds.top - aboutBounds.top + lensBounds.height / 2
      size = lensBounds.width
      start = bounds.top + window.scrollY + height - viewport
      targetProgress = calculateTarget()
      displayedProgress = targetProgress
      hasSnapped = true
      lastTime = 0
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      applyProgress(displayedProgress)
    }
    const onResize = () => {
      // On mobile viewports (<= 1000px) and iPad (<= 1180px), scrolling dynamically hides/shows the address bar.
      // Sync viewport height in-place without resetting scroll distance or jumping the pin.
      const isTouchViewport = host.clientWidth <= 1000 || (isIPad && host.clientWidth <= 1180)
      if (isTouchViewport && Math.abs(host.clientWidth - width) < 2) {
        if (syncViewportHeight()) {
          targetProgress = calculateTarget()
          displayedProgress = targetProgress
          applyProgress(displayedProgress)
        }
        return
      }
      measure()
    }

    const navigate = () => {
      if (location.hash === '#recent-photoshoot') window.scrollTo({ top: start + distance, behavior: 'instant' })
    }
    const handleRecentLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const link = target?.closest('a[href="#recent-photoshoot"]')
      if (link) {
        event.preventDefault()
        if (location.hash !== '#recent-photoshoot') {
          history.pushState(null, '', '#recent-photoshoot')
        }
        window.scrollTo({ top: start + distance, behavior: 'smooth' })
      }
    }
    let keyboardNavigation = false
    const trackKey = (event: KeyboardEvent) => { keyboardNavigation = event.key === 'Tab' }
    const trackPointer = () => { keyboardNavigation = false }
    const focusRecent = (event: FocusEvent) => {
      // Keyboard users should see the entire focused control; pointer focus must not move it.
      const scrollY = Math.max(0, window.scrollY)
      if (keyboardNavigation && event.target instanceof HTMLElement &&
          document.body.style.position !== 'fixed' && scrollY < start + distance - 1) {
        window.scrollTo({ top: start + distance, behavior: 'instant' })
      }
    }
    const resize = new ResizeObserver(measure)
    resize.observe(about)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    window.addEventListener('hashchange', navigate)
    document.addEventListener('click', handleRecentLinkClick)
    window.addEventListener('keydown', trackKey, true)
    window.addEventListener('pointerdown', trackPointer, true)
    recent.addEventListener('focusin', focusRecent)
    measure()
    navigate()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      window.removeEventListener('hashchange', navigate)
      document.removeEventListener('click', handleRecentLinkClick)
      window.removeEventListener('keydown', trackKey, true)
      window.removeEventListener('pointerdown', trackPointer, true)
      recent.removeEventListener('focusin', focusRecent)
      recent.style.clipPath = ''; recent.style.visibility = ''; lens.style.visibility = ''; overlay.style.cssText = ''
      delete host.dataset.progress
      recent.inert = false; about.inert = false
      subscribers.forEach(listener => listener(0))
    }
  }, [enabled, listeners])

  return <LensTransitionContext.Provider value={controller}>
    <div ref={root} className="lens-transition" data-enabled={enabled} data-reserved={canReserve}>
      <div className="lens-transition__lvh-probe" aria-hidden="true" />
      <div className="lens-transition__stage">
        {enabled && <a className="lens-transition__skip" href="#recent-photoshoot">Skip lens transition</a>}
        <About />
        <div className="lens-transition__recent"><RecentPhotoshoot /></div>
        <div className="lens-transition__lens" aria-hidden="true">
          {canAnimate && <TransitionLens url={url} controller={overlayController} />}
        </div>
      </div>
    </div>
  </LensTransitionContext.Provider>
}
