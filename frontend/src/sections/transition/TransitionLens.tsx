import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'
import type { LensTransitionController } from './LensTransitionContext'

const loadLensScene = () => import('../about/LensScene')
const LensScene = lazy(loadLensScene)

class TransitionBoundary extends Component<{ children: ReactNode; fail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.fail() }
  render() { return this.state.failed ? null : this.props.children }
}

export function TransitionLens({ url, controller }: { url: string; controller: LensTransitionController }) {
  useEffect(() => {
    let cancelled = false
    void loadLensScene()
      .then(mod => {
        if (!cancelled) mod.preloadLensModel(url)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [url])

  return <TransitionBoundary key={url} fail={controller.fail}>
    <Suspense fallback={null}><LensScene url={url} aperture={0} transition={controller} bakeStaticBezel /></Suspense>
  </TransitionBoundary>
}
