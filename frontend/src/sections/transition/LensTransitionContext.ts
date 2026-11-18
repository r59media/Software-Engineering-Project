import { createContext } from 'react'

export interface LensTransitionController {
  subscribe: (listener: (aperture: number) => void) => () => void
  subscribePaused?: (listener: (paused: boolean) => void) => () => void
  ready: () => void
  fail: () => void
}

export const LensTransitionContext = createContext<LensTransitionController | null>(null)
