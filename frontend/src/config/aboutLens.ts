import desktopUrl from '../assets/models/lens/lens-desktop.glb?url'
import mobileUrl from '../assets/models/lens/lens-mobile.glb?url'

// Model units are meters; the optical axis faces +Z with +Y up.
export const aboutLens = {
  desktopUrl,
  mobileUrl,
  mobileQuery: '(max-width: 1000px)',
  aperture: 0,
  // Must match the mechanical Blender rig and its exported leaf-edge geometry.
  iris: { count: 9, pivotRadius: 0.027, leafDepth: -0.005, leafSlope: 0.014,
    travelAngle: -70 * Math.PI / 180, clearRadius: 0.0228 },
  camera: { position: [0, 0, 0.2] as [number, number, number], fov: 25, near: 0.001, far: 1 },
  pixelRatio: [1, 2] as [number, number],
}
