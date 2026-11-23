import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './GalleryEmptyState.css'
const Scene = lazy(() => import('./MemoryCardScene'))
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}
export function GalleryEmptyState({ active = true }: { active?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const target = useRef({ x: -.08, y: -.28 })
  const drag = useRef<{ id: number; x: number; y: number; rx: number; ry: number } | null>(null)
  const pokeRef = useRef<(() => void) | null>(null)
  const [interactive, setInteractive] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [inView, setInView] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [showFallback, setShowFallback] = useState(false)
  const visible = active && inView
  const ready = useCallback(() => setLoaded(true), [])
  const fail = useCallback(() => { setFailed(true); setLoaded(false) }, [])
  useEffect(() => {
    const pointer = matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)')
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { setInteractive(pointer.matches); setReduced(motion.matches) }
    update(); pointer.addEventListener('change', update); motion.addEventListener('change', update)
    return () => { pointer.removeEventListener('change', update); motion.removeEventListener('change', update) }
  }, [])
  useLayoutEffect(() => {
    if (!active) return
    let intersecting = false
    if (host.current) {
      const rect = host.current.getBoundingClientRect()
      intersecting = rect.bottom > 0 && rect.top < window.innerHeight
    }
    const visibility = () => setInView(intersecting && !document.hidden)
    visibility()
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; visibility() })
    if (host.current) observer.observe(host.current)
    document.addEventListener('visibilitychange', visibility)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility) }
  }, [active])
  useEffect(() => {
    if (!active || loaded || failed || reduced) return
    const timer = window.setTimeout(() => setShowFallback(true), 450)
    return () => window.clearTimeout(timer)
  }, [active, loaded, failed, reduced])
  const reset = () => { drag.current = null; target.current = { x: -.08, y: -.28 }; pokeRef.current?.() }
  const fallbackVisible = reduced || failed || (active && showFallback && !loaded)
  return <div className="gallery-empty">
    <div ref={host} className="gallery-empty__stage" data-interactive={interactive && !reduced} aria-hidden="true"
      onPointerDown={e => { if (!interactive || reduced || e.pointerType !== 'mouse') return; drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, rx: target.current.x, ry: target.current.y }; e.currentTarget.setPointerCapture(e.pointerId); pokeRef.current?.() }}
      onPointerMove={e => {
        if (!interactive || reduced || e.pointerType !== 'mouse') return
        if (drag.current) { target.current = { x: Math.max(-.7, Math.min(.7, drag.current.rx + (e.clientY - drag.current.y) * .008)), y: drag.current.ry + (e.clientX - drag.current.x) * .012 }; pokeRef.current?.(); return }
        const rect = e.currentTarget.getBoundingClientRect()
        target.current = { x: -.08 + (e.clientY - rect.top - rect.height / 2) / rect.height * .35, y: -.28 + (e.clientX - rect.left - rect.width / 2) / rect.width * .7 }
        pokeRef.current?.()
      }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); reset() }} onPointerCancel={reset} onLostPointerCapture={reset} onPointerLeave={() => { if (!drag.current) reset() }}>
      {fallbackVisible && <img className="gallery-empty__fallback" src="/models/r59-memory-card-preview.webp" alt="" />}
      {!reduced && !failed && (
        <div className="gallery-empty__canvas" data-ready={loaded && !failed && !reduced}>
          <SceneBoundary><Suspense fallback={null}><Scene target={target} automatic={!interactive} reduced={reduced} active={visible} ready={ready} fail={fail} pokeRef={pokeRef} /></Suspense></SceneBoundary>
        </div>
      )}
    </div>
    <div className="gallery-empty__message" role="status"><h3>Oops!</h3><p>No photographs found in this category.</p></div>
  </div>
}
