import { useEffect, useMemo, useRef, useState } from 'react'
import { About } from '../about/About'
import { RecentPhotoshoot } from '../recent/RecentPhotoshoot'
import { LensTransitionContext } from './LensTransitionContext'
import { irisOpening } from './irisOpening'
import './AboutToRecent.css'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => value * value * (3 - 2 * value)

export function AboutToRecent() {
  const root = useRef<HTMLDivElement>(null)
  const [, setLoaded] = useState(false)
  const [fits, setFits] = useState(() => window.innerHeight >= 500)
  const [, setFailed] = useState(false)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const listeners = useRef(new Set<(value: number) => void>())
  const controller = useMemo(() => ({
    subscribe(listener: (value: number) => void) {
      listeners.current.add(listener)
      return () => { listeners.current.delete(listener) }
    },
    ready: () => setLoaded(true),
    fail: () => setFailed(true),
  }), [listeners])
  const enabled = !reduced && fits

  useEffect(() => {
    const section = root.current?.querySelector<HTMLElement>('#recent-photoshoot')
    if (!section) return
    let lastWidth = window.innerWidth
    // Keep all gallery content scrollable on short/landscape viewports.
    const measure = () => setFits(window.innerHeight >= 480 && section.offsetHeight <= window.innerHeight + 80)
    const onResize = () => {
      if (window.innerWidth <= 1000 && Math.abs(window.innerWidth - lastWidth) < 2) return
      lastWidth = window.innerWidth
      measure()
    }
    const observer = new ResizeObserver(measure)
    observer.observe(section)
    window.addEventListener('resize', onResize)
    measure()
    return () => { observer.disconnect(); window.removeEventListener('resize', onResize) }
  }, [])

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const host = root.current
    if (!host || !enabled) return
    const subscribers = listeners.current
    const stage = host.querySelector<HTMLElement>('.lens-transition__stage')!
    const about = host.querySelector<HTMLElement>('#about')!
    const lens = host.querySelector<HTMLElement>('.about__lens')!
    const motion = lens.querySelector<HTMLElement>('.about__motion')!
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

    const calculateTarget = () => {
      if (document.body.style.position === 'fixed') return targetProgress
      if (window.scrollY >= start + distance - 1) return 1
      return clamp((window.scrollY - start) / distance)
    }

    const applyProgress = (progress: number) => {
      const move = smooth(clamp(progress / 0.6))
      const zoom = smooth(clamp((progress - 0.08) / 0.92))
      const aperture = smooth(clamp((progress - 0.12) / 0.5))
      const targetRadius = Math.hypot(width, viewport) * 0.56
      const scale = 1 + zoom * (targetRadius / (size * 0.25) - 1)
      const cx = x + (width / 2 - x) * move
      const cy = y + (height - viewport / 2 - y) * move
      const currentScale = scale * (size / 960)
      motion.style.transform = `translate3d(${(cx - x).toFixed(2)}px, ${(cy - y).toFixed(2)}px, 0) scale(${currentScale.toFixed(5)})`
      recent.style.clipPath = progress >= 1 ? 'none' : irisOpening(aperture, size * scale, cx, cy - height + viewport)
      recent.style.visibility = progress > 0 ? 'visible' : 'hidden'
      recent.inert = progress < 1
      about.inert = progress >= 1
      host.dataset.progress = progress.toFixed(3)
      host.dataset.zooming = String(progress > 0.005)
      subscribers.forEach(listener => listener(aperture))
    }

    const tick = () => {
      frame = 0
      targetProgress = calculateTarget()
      const diff = targetProgress - displayedProgress
      if (Math.abs(diff) < 0.0005) {
        displayedProgress = targetProgress
      } else {
        displayedProgress += diff * 0.22
        frame = requestAnimationFrame(tick)
      }
      applyProgress(displayedProgress)
    }

    const schedule = () => { if (!frame) frame = requestAnimationFrame(tick) }

    const measure = () => {
      height = about.offsetHeight
      viewport = window.innerHeight || 800
      width = host.clientWidth || window.innerWidth || 1200
      distance = viewport * 1.6
      const bounds = host.getBoundingClientRect()
      host.style.height = `${height + distance}px`
      stage.style.top = `${Math.min(0, viewport - height)}px`
      recent.style.height = `${viewport}px`
      const lensBounds = lens.getBoundingClientRect()
      const aboutBounds = about.getBoundingClientRect()
      x = lensBounds.left - aboutBounds.left + lensBounds.width / 2
      y = lensBounds.top - aboutBounds.top + lensBounds.height / 2
      size = lensBounds.width || 120
      lens.style.setProperty('--lens-render-scale', String(size / 960))
      start = bounds.top + window.scrollY + height - viewport
      targetProgress = calculateTarget()
      displayedProgress = targetProgress
      if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      applyProgress(displayedProgress)
    }

    const onResize = () => {
      // On mobile viewports (<= 1000px), scrolling dynamically hides/shows the address bar,
      // changing innerHeight continuously. Ignore height-only resizes on mobile.
      if (host.clientWidth <= 1000 && Math.abs(host.clientWidth - width) < 2) return
      measure()
    }

    const navigate = () => {
      if (location.hash === '#recent-photoshoot') {
        window.scrollTo({ top: start + distance, behavior: 'instant' })
        targetProgress = 1
        displayedProgress = 1
        if (frame) {
          cancelAnimationFrame(frame)
          frame = 0
        }
        applyProgress(1)
      }
    }

    const focusRecent = () => {
      if (document.body.style.position !== 'fixed' && window.scrollY < start + distance - 1) navigate()
    }

    const resize = new ResizeObserver(measure)
    resize.observe(about)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('hashchange', navigate)
    recent.addEventListener('focusin', focusRecent)
    measure()
    navigate()

    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('hashchange', navigate)
      recent.removeEventListener('focusin', focusRecent)
      host.style.height = ''; stage.style.top = ''; recent.style.cssText = ''
      lens.style.removeProperty('--lens-render-scale')
      motion.style.transform = ''
      delete host.dataset.progress; delete host.dataset.zooming
      recent.inert = false; about.inert = false
      subscribers.forEach(listener => listener(0))
    }
  }, [enabled, listeners])

  return <LensTransitionContext.Provider value={controller}>
    <div ref={root} className="lens-transition" data-enabled={enabled}>
      <div className="lens-transition__stage">
        {enabled && <a className="lens-transition__skip" href="#recent-photoshoot">Skip lens transition</a>}
        <About />
        <div className="lens-transition__recent"><RecentPhotoshoot /></div>
      </div>
    </div>
  </LensTransitionContext.Provider>
}
