import desktopUrl from '../assets/models/lens/lens-desktop.glb?url'
import mobileUrl from '../assets/models/lens/lens-mobile.glb?url'

// Model units are meters; the optical axis faces +Z with +Y up.
export const aboutLens = {
  desktopUrl,
  mobileUrl,
  mobileQuery: '(max-width: 1000px)',
  aperture: 0,
  camera: { position: [0, 0, 0.2] as [number, number, number], fov: 25, near: 0.001, far: 1 },
  pixelRatio: [1, 2] as [number, number],
}
