const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

export const isIPad: boolean =
  typeof navigator !== 'undefined' &&
  (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

export const isWebKit: boolean =
  typeof navigator !== 'undefined' &&
  (isIPad ||
    /iPhone|iPod/i.test(ua) ||
    /^((?!chrome|chromium|crios|fxios|edgios|opr|android).)*safari/i.test(ua))

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

const IGPU_PATTERN = /intel|uhd|iris|hd graphics|integrated|radeon(?:\(tm\))? graphics|radeon\s+[6789]\d{2}m|vega|mali|immortalis|adreno|apple gpu|swiftshader|llvmpipe/i

export function isIntegratedOrLowPowerGpu(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  if (isWebKit || isIPad) return true
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '')
      : String(gl.getParameter(gl.RENDERER) || '')
    return IGPU_PATTERN.test(renderer)
  } catch {
    return false
  }
}
