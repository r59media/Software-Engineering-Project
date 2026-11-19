import { classifyGpuRenderer } from './gpuProfile.ts'

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

export const isIPad: boolean =
  typeof navigator !== 'undefined' &&
  (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

export const isWebKit: boolean =
  typeof navigator !== 'undefined' &&
  (isIPad ||
    /iPhone|iPod/i.test(ua) ||
    /^((?!chrome|chromium|crios|fxios|edgios|opr|android).)*safari/i.test(ua))

export const isBraveBrowser: boolean =
  typeof navigator !== 'undefined' &&
  Boolean((navigator as Navigator & { brave?: unknown }).brave)

export function isHdrDisplay(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(dynamic-range: high)').matches
  )
}

type NetworkInformationLike = {
  saveData?: boolean
  effectiveType?: string
}

const connection: NetworkInformationLike | undefined =
  typeof navigator !== 'undefined'
    ? (navigator as Navigator & { connection?: NetworkInformationLike }).connection
    : undefined

export const isSlowConnection: boolean = Boolean(
  connection?.saveData || /^(slow-2g|2g|3g)$/.test(connection?.effectiveType || ''),
)

export function initBrowserEnv(): void {
  if (typeof document === 'undefined') return
  const { dataset } = document.documentElement
  if (isWebKit) {
    dataset.engine = 'webkit'
  }
  if (isIPad) {
    dataset.device = 'ipad'
  }
}

export function isIntegratedOrLowPowerGpu(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  if (isWebKit || isIPad) return true
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '')
      : String(gl.getParameter(gl.RENDERER) || '')
    const vendor = ext
      ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '')
      : String(gl.getParameter(gl.VENDOR) || '')
    const profile = classifyGpuRenderer({
      renderer,
      vendor,
      isWebGL2: true,
      majorPerformanceCaveat: false,
      maxTextureSize: 4096,
      maxSamples: 4,
      isWebKit,
      isIPad,
      isMobile: false,
      isBrave: isBraveBrowser,
      isHdrDisplay: isHdrDisplay(),
      devicePixelRatio: 1,
    })
    return profile.tier < 3
  } catch {
    return false
  }
}
