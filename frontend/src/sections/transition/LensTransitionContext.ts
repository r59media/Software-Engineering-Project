import { createContext } from 'react'

export type LensApertureListener = (aperture: number, force?: boolean) => void

export interface LensTransitionController {
  subscribe: (listener: LensApertureListener) => () => void
  setAperture?: (value: number, force?: boolean) => void
  ready: () => void
  fail: () => void
}

export const LensTransitionContext = createContext<LensTransitionController | null>(null)
