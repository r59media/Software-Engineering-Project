import { useEffect, useMemo, useRef, useState } from 'react'
import { About } from '../about/About'
import { RecentPhotoshoot } from '../recent/RecentPhotoshoot'
import {
  LensTransitionContext,
  type LensApertureListener,
  type LensTransitionController,
} from './LensTransitionContext'
import { TransitionLens } from './TransitionLens'
import { aboutLens } from '../../config/aboutLens'
import { isIPad } from '../../utils/browserEnv'
import './AboutToRecent.css'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => value * value * (3 - 2 * value)
const roundHalf = (value: number) => Math.round(value * 2) / 2
const getViewportHeight = (host?: HTMLElement | null) => {
  const probeHeight = host?.querySelector<HTMLElement>('.lens-transition__lvh-probe')?.offsetHeight || 0
  return Math.max(probeHeight, window.innerHeight || 0, Math.round(window.visualViewport?.height || 0))
}

export function AboutToRecent() {
  const root = useRef<HTMLDivElement>(null)
  const [mobile, setMobile] = useState(() => matchMedia(aboutLens.mobileQuery).matches)
  const [readyUrl, setReadyUrl] = useState('')
  const url = mobile ? aboutLens.mobileUrl : aboutLens.desktopUrl
  const [fits, setFits] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [engaged, setEngaged] = useState(() => window.scrollY > 10 || Boolean(window.location.hash))
  const listeners = useRef(new Set<LensApertureListener>())
  const wasLensVisibleRef = useRef(false)
  const controller = useMemo<LensTransitionController>(() => ({
    subscribe: () => () => {},
    setAperture: () => {},
    ready: () => {},
    fail: () => setFailed(true),
  }), [])
  const overlayController = useMemo(() => ({
    subscribe(listener: LensApertureListener) {
      listeners.current.add(listener)
      return () => { listeners.current.delete(listener) }
    },
    setAperture(value: number, force = false) {
      listeners.current.forEach(listener => listener(value, force))
    },
    ready: () => setReadyUrl(url),
    fail: () => setFailed(true),
  }), [url])
  const canReserve = !failed && !reduced && fits
  const canAnimate = canReserve && engaged
  const enabled = canAnimate && readyUrl === url

  useEffect(() => {
    if (engaged) return
    const engage = () => setEngaged(true)
    const opts: AddEventListenerOptions = { passive: true, once: true }
    window.addEventListener('scroll', engage, opts)
    window.addEventListener('wheel', engage, opts)
    window.addEventListener('touchstart', engage, opts)
    window.addEventListener('pointerdown', engage, opts)
    window.addEventListener('keydown', engage, opts)
    let observer: IntersectionObserver | undefined
    if (root.current && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting && entry.intersectionRect.height > 1) engage()
        },
        { rootMargin: '-1px 0px -1px 0px', threshold: 0.01 },
      )
      observer.observe(root.current)
    }
    return () => {
      window.removeEventListener('scroll', engage)
      window.removeEventListener('wheel', engage)
      window.removeEventListener('touchstart', engage)
      window.removeEventListener('pointerdown', engage)
      window.removeEventListener('keydown', engage)
      observer?.disconnect()
    }
  }, [engaged])

  useEffect(() => {
    const host = root.current
    if (!host || !enabled || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          host.dataset.transitionWarm = 'true'
        } else {
          delete host.dataset.transitionWarm
        }
      },
      { rootMargin: '450px' }
    )
    observer.observe(host)
    return () => {
      observer.disconnect()
      delete host.dataset.transitionWarm
    }
  }, [enabled])

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
    let prevRecentVisible: boolean | null = null
    let prevOverlayVisible: boolean | null = null
    let prevLensHidden: boolean | null = null
    let prevRecentInert: boolean | null = null
    let prevAboutInert: boolean | null = null
    let prevProgressState: '0' | 'active' | '1' | null = null
    let prevClipPath: string | null = null

    const calculateTarget = () => {
      if (document.body.style.position === 'fixed') return targetProgress
      const scrollY = Math.max(0, window.scrollY)
      if (scrollY >= start + distance - 1) return 1
      return clamp((scrollY - start) / distance)
    }

    const applyProgress = (progress: number) => {
      const revealed = progress >= 1
      const move = smooth(clamp(progress / 0.6))
      const zoom = smooth(clamp((progress - 0.08) / 0.92))
      const aperture = smooth(clamp((progress - 0.12) / 0.5))
      const targetRadius = Math.hypot(width, viewport) * 0.56
      const scale = 1 + zoom * (targetRadius / (size * 0.25) - 1)
      const cx = x + (width / 2 - x) * move
      const cy = y + (height - viewport / 2 - y) * move
      const cyRecent = cy - height + viewport
      const maxCornerDist = Math.hypot(
        Math.max(cx, width - cx),
        Math.max(cyRecent, viewport - cyRecent),
      )
      const innerApertureRadius = size * scale * 0.25
      const lensOffscreen = progress > 0.62 && innerApertureRadius > maxCornerDist
      if (!lensOffscreen) {
        overlay.style.transform = `translate3d(${cx - size * scale / 2}px, ${cy - size * scale / 2}px, 0) scale3d(${size * scale / 640}, ${size * scale / 640}, 1)`
      }
      const recentVisible = aperture > 0 || revealed
      let nextClipPath: string
      if (revealed || lensOffscreen) {
        nextClipPath = 'none'
      } else if (!recentVisible) {
        nextClipPath = 'inset(50% 50% 50% 50%)'
      } else {
        const half = size * scale * 0.29
        const top = Math.max(0, roundHalf(cyRecent - half))
        const right = Math.max(0, roundHalf(width - (cx + half)))
        const bottom = Math.max(0, roundHalf(viewport - (cyRecent + half)))
        const left = Math.max(0, roundHalf(cx - half))
        nextClipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`
      }
      if (nextClipPath !== prevClipPath) {
        prevClipPath = nextClipPath
        recent.style.clipPath = nextClipPath
      }
      if (recentVisible !== prevRecentVisible) {
        prevRecentVisible = recentVisible
        recent.style.visibility = recentVisible ? 'visible' : 'hidden'
      }
      const active = progress > 0 && progress < 1 && !lensOffscreen
      if (active !== prevOverlayVisible) {
        prevOverlayVisible = active
        overlay.style.opacity = active ? '1' : '0'
        overlay.style.visibility = active ? 'visible' : 'hidden'
      }
      const forcePaint = active && !wasLensVisibleRef.current
      wasLensVisibleRef.current = active
      const lensHidden = progress > 0
      if (lensHidden !== prevLensHidden) {
        prevLensHidden = lensHidden
        lens.style.visibility = lensHidden ? 'hidden' : ''
      }
      // Visible photos respond as soon as the iris starts opening.
      const recentInert = aperture <= 0
      if (recentInert !== prevRecentInert) {
        prevRecentInert = recentInert
        recent.inert = recentInert
      }
      const aboutInert = revealed
      if (aboutInert !== prevAboutInert) {
        prevAboutInert = aboutInert
        about.inert = aboutInert
      }
      const progressState: '0' | 'active' | '1' = progress <= 0 ? '0' : revealed ? '1' : 'active'
      if (progressState !== prevProgressState) {
        prevProgressState = progressState
        host.dataset.progress = progressState
      }
      if (!lensOffscreen) {
        overlayController.setAperture(aperture, forcePaint)
      }
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
      const absDiff = Math.abs(diff)
      if (absDiff < 0.025) {
        displayedProgress = targetProgress
        lastTime = 0
      } else {
        const factor = absDiff > 0.12 ? 0.68 : 0.50
        const alpha = Math.min(1, factor * (dt / 16.67))
        displayedProgress += diff * alpha
        if (Math.abs(targetProgress - displayedProgress) < 0.002) {
          displayedProgress = targetProgress
          lastTime = 0
        } else {
          frame = requestAnimationFrame(tick)
        }
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
      prevRecentVisible = null
      prevOverlayVisible = null
      prevLensHidden = null
      prevRecentInert = null
      prevAboutInert = null
      prevProgressState = null
      prevClipPath = null
      wasLensVisibleRef.current = false
      overlayController.setAperture(0, false)
    }
  }, [enabled, overlayController])

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
