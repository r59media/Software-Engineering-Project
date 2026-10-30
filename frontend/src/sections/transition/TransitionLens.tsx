import { Component, lazy, Suspense, type ReactNode } from 'react'
import type { LensTransitionController } from './LensTransitionContext'

const LensScene = lazy(() => import('../about/LensScene'))

class TransitionBoundary extends Component<{ children: ReactNode; fail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.fail() }
  render() { return this.state.failed ? null : this.props.children }
}

export function TransitionLens({ url, controller }: { url: string; controller: LensTransitionController }) {
  return <TransitionBoundary key={url} fail={controller.fail}>
    <Suspense fallback={null}><LensScene url={url} aperture={0} transition={controller} /></Suspense>
  </TransitionBoundary>
}
