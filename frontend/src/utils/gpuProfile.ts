import { isBraveBrowser, isHdrDisplay, isIPad, isWebKit } from './browserEnv.ts'

export type GpuTier = 0 | 1 | 2 | 3

export type GpuProfileId =
  | 'software-legacy'
  | 'intel-igpu-legacy'
  | 'intel-igpu-modern'
  | 'amd-igpu'
  | 'unknown-privacy-desktop'
  | 'apple-arm-webkit'
  | 'mobile-arm'
  | 'discrete-amd'
  | 'discrete-nvidia'

export type GpuProbeInput = {
  renderer: string
  vendor: string
  isWebGL2: boolean
  majorPerformanceCaveat: boolean
  maxTextureSize: number
  maxSamples: number
  isWebKit: boolean
  isIPad: boolean
  isMobile: boolean
  isBrave: boolean
  isHdrDisplay: boolean
  devicePixelRatio: number
}

export type GpuRenderProfile = {
  id: GpuProfileId
  tier: GpuTier
  subTier: string
  renderer: string
  isHdrDisplay: boolean
  isSpoofedOrUnknown: boolean
  lens: {
    powerPreference: WebGLPowerPreference
    liveAntialias: boolean
    snapshotAntialias: boolean
    fboSamples: number
    precision: 'highp' | 'mediump'
    maxDpr: number
    minDpr: number
    modelVariant: 'desktop' | 'mobile'
    usePmrem: boolean
    disableScrollTransition: boolean
  }
  memoryCard: {
    powerPreference: WebGLPowerPreference
    antialias: boolean
    precision: 'highp' | 'mediump'
    maxDpr: number
    targetFps: 60 | 30
    disabled: boolean
  }
}

const SOFTWARE_RENDERER_RE =
  /swiftshader|llvmpipe|softpipe|mesa offscreen|microsoft basic render|vmware|virtualbox/i
const LEGACY_2010_2012_RE =
  /intel.*hd graphics (2000|2500|3000|4000)\b|geforce (gt|gts|gtx)? ?(4[0-9]{2}|5[0-9]{2})\b|radeon hd (5[0-9]{3}|6[0-9]{3})\b/i

const APPLE_ARM_RE = /apple gpu|apple m\d+/i

const DISCRETE_NVIDIA_RE = /nvidia|geforce|quadro|rtx\b|gtx\b|titan/i
const LEGACY_NVIDIA_RE = /geforce (gt \d|mx\d{3}|gtx [6789]\d{2}\b)|quadro [km]\d/i

const DISCRETE_AMD_RE =
  /radeon rx|radeon pro|firepro|radeon r[79]|radeon vii|rx vega|navi|rdna|radeon hd 7[7-9]\d{2}|radeon hd 8[7-9]\d{2}/i
const MODERN_AMD_RDNA_RE = /rx (?:[5-9]\d{3}|\d{5})|pro w[6-9]\d{3}|rdna|navi/i

const INTEL_RE = /intel/i
const INTEL_MODERN_XE_RE = /(iris(?:\(r\))?\s*xe|arc\b|xe-lpg|xe2|xe3)/i

const AMD_ANY_RE = /amd|ati|radeon/i
const AMD_PRE_VEGA_APU_RE = /radeon r[2-7]\b|radeon\(tm\) r[2-7]/i

const MOBILE_ARM_RE = /adreno|mali|immortalis|powervr|tegra/i
const HIGH_END_ARM_RE =
  /adreno.*(6[5-9]\d|[7-9]\d{2}|\d{4})|immortalis|mali-g7[1-9]\d|mali-g78|mali-g710/i

export function classifyGpuRenderer(input: GpuProbeInput): GpuRenderProfile {
  const r = input.renderer || ''

  // 1. software-legacy (Tier 0)
  if (
    !input.isWebGL2 ||
    input.majorPerformanceCaveat ||
    input.maxTextureSize < 4096 ||
    SOFTWARE_RENDERER_RE.test(r) ||
    LEGACY_2010_2012_RE.test(r)
  ) {
    return {
      id: 'software-legacy',
      tier: 0,
      subTier: SOFTWARE_RENDERER_RE.test(r) ? '0-software' : '0-legacy',
      renderer: input.renderer,
      isHdrDisplay: input.isHdrDisplay,
      isSpoofedOrUnknown: false,
      lens: {
        powerPreference: 'low-power',
        liveAntialias: false,
        snapshotAntialias: false,
        fboSamples: 0,
        precision: 'mediump',
        maxDpr: 1,
        minDpr: 1,
        modelVariant: 'mobile',
        usePmrem: false,
        disableScrollTransition: true,
      },
      memoryCard: {
        powerPreference: 'low-power',
        antialias: false,
        precision: 'mediump',
        maxDpr: 1,
        targetFps: 30,
        disabled: true,
      },
    }
  }

  // 2. apple-arm-webkit (Tier 2A)
  if (input.isWebKit || input.isIPad || APPLE_ARM_RE.test(r)) {
    const isMobileApple = input.isIPad || input.isMobile
    const maxDpr = isMobileApple ? 1.25 : 1.5
    const powerPreference: WebGLPowerPreference = isMobileApple ? 'default' : 'high-performance'

    return {
      id: 'apple-arm-webkit',
      tier: 2,
      subTier: isMobileApple ? '2A-mobile' : '2A-desktop',
      renderer: input.renderer,
      isHdrDisplay: input.isHdrDisplay,
      isSpoofedOrUnknown: false,
      lens: {
        powerPreference,
        liveAntialias: false,
        snapshotAntialias: true,
        fboSamples: 4,
        precision: 'highp',
        maxDpr,
        minDpr: 1,
        modelVariant: isMobileApple ? 'mobile' : 'desktop',
        usePmrem: true,
        disableScrollTransition: false,
      },
      memoryCard: {
        powerPreference,
        antialias: false,
        precision: 'highp',
        maxDpr,
        targetFps: 60,
        disabled: false,
      },
    }
  }

  // 3. discrete-nvidia (Tier 3B)
  if (DISCRETE_NVIDIA_RE.test(r)) {
    const isLegacyEntry = LEGACY_NVIDIA_RE.test(r)
    const maxDpr = isLegacyEntry ? 1.5 : 2

    return {
      id: 'discrete-nvidia',
      tier: 3,
      subTier: isLegacyEntry ? '3B-entry' : '3B-modern',
      renderer: input.renderer,
      isHdrDisplay: input.isHdrDisplay,
      isSpoofedOrUnknown: false,
      lens: {
        powerPreference: 'high-performance',
        liveAntialias: !isLegacyEntry,
        snapshotAntialias: true,
        fboSamples: 4,
        precision: 'highp',
        maxDpr,
        minDpr: isLegacyEntry ? 1 : 1.25,
        modelVariant: 'desktop',
        usePmrem: true,
        disableScrollTransition: false,
      },
      memoryCard: {
        powerPreference: 'high-performance',
        antialias: true,
        precision: 'highp',
        maxDpr,
        targetFps: 60,
        disabled: false,
      },
    }
  }

  // 4. discrete-amd (Tier 3A)
  if (DISCRETE_AMD_RE.test(r)) {
    const isModernRdna = MODERN_AMD_RDNA_RE.test(r)
    const maxDpr = isModernRdna ? 2 : 1.5

    return {
      id: 'discrete-amd',
      tier: 3,
      subTier: isModernRdna ? '3A-rdna' : '3A-gcn',
      renderer: input.renderer,
      isHdrDisplay: input.isHdrDisplay,
      isSpoofedOrUnknown: false,
      lens: {
        powerPreference: 'high-performance',
        liveAntialias: isModernRdna,
        snapshotAntialias: true,
        fboSamples: 4,
        precision: 'highp',
        maxDpr,
        minDpr: isModernRdna ? 1.25 : 1,
        modelVariant: 'desktop',
        usePmrem: true,
        disableScrollTransition: false,
      },
      memoryCard: {
        powerPreference: 'high-performance',
        antialias: true,
        precision: 'highp',
        maxDpr,
        targetFps: 60,
        disabled: false,
      },
    }
  }

  // 5. intel-igpu-modern (Tier 1B)
  if (INTEL_RE.test(r) && INTEL_MODERN_XE_RE.test(r)) {
    return {
      id: 'intel-igpu-modern',
      tier: 1,
      subTier: '1B',
      renderer: input.renderer,
      isHdrDisplay: input.isHdrDisplay,
      isSpoofedOrUnknown: false,
      lens: {
        powerPreference: 'high-performance',
        liveAntialias: false,
        snapshotAntialias: true,
        fboSamples: 4,
        precision: 'highp',
        maxDpr: input.isHdrDisplay ? 1.25 : 1.5,
        minDpr: 1,
        modelVariant: 'desktop',
        usePmrem: true,
        disableScrollTransition: false,
      },
      memoryCard: {
        powerPreference: 'high-performance',
        antialias: true,
        precision: 'highp',
        maxDpr: 1.25,
        targetFps: 60,
        disabled: false,
      },
    }
  }

  // 6. intel-igpu-legacy (Tier 1A)
  if (INTEL_RE.test(r)) {
    return {
      id: 'intel-igpu-legacy',
      tier: 1,
      subTier: '1A',
      renderer: input.renderer,
      isHdrDisplay: input.isHdrDisplay,
      isSpoofedOrUnknown: false,
      lens: {
        powerPreference: 'high-performance',
        liveAntialias: false,
        snapshotAntialias: true,
        fboSamples: 2,
        precision: 'mediump',
        maxDpr: input.isHdrDisplay ? 1.0 : 1.15,
        minDpr: 0.85,
        modelVariant: 'mobile',
        usePmrem: true,
        disableScrollTransition: false,
      },
      memoryCard: {
        powerPreference: 'high-performance',
        antialias: false,
        precision: 'mediump',
        maxDpr: 1,
        targetFps: 30,
        disabled: false,
      },
    }
  }

  // 7. amd-igpu (Tier 1C)
  if (AMD_ANY_RE.test(r)) {
    const isPreVega = AMD_PRE_VEGA_APU_RE.test(r)

    if (isPreVega) {
      return {
        id: 'amd-igpu',
        tier: 1,
        subTier: '1C-pre-vega',
        renderer: input.renderer,
        isHdrDisplay: input.isHdrDisplay,
        isSpoofedOrUnknown: false,
        lens: {
          powerPreference: 'high-performance',
          liveAntialias: false,
          snapshotAntialias: true,
          fboSamples: 2,
          precision: 'mediump',
          maxDpr: 1.15,
          minDpr: 0.85,
          modelVariant: 'mobile',
          usePmrem: true,
          disableScrollTransition: false,
        },
        memoryCard: {
          powerPreference: 'high-performance',
          antialias: false,
          precision: 'mediump',
          maxDpr: 1,
          targetFps: 30,
          disabled: false,
        },
      }
    }

    return {
      id: 'amd-igpu',
      tier: 1,
      subTier: '1C-modern-apu',
      renderer: input.renderer,
      isHdrDisplay: input.isHdrDisplay,
      isSpoofedOrUnknown: false,
      lens: {
        powerPreference: 'high-performance',
        liveAntialias: false,
        snapshotAntialias: true,
        fboSamples: 4,
        precision: 'highp',
        maxDpr: input.isHdrDisplay ? 1.25 : 1.5,
        minDpr: 1,
        modelVariant: 'desktop',
        usePmrem: true,
        disableScrollTransition: false,
      },
      memoryCard: {
        powerPreference: 'high-performance',
        antialias: true,
        precision: 'highp',
        maxDpr: 1.25,
        targetFps: 60,
        disabled: false,
      },
    }
  }

  // 8. mobile-arm (Tier 2B)
  if (MOBILE_ARM_RE.test(r) || input.isMobile) {
    const isHighEnd = HIGH_END_ARM_RE.test(r)

    return {
      id: 'mobile-arm',
      tier: 2,
      subTier: isHighEnd ? '2B-high' : '2B-legacy',
      renderer: input.renderer,
      isHdrDisplay: input.isHdrDisplay,
      isSpoofedOrUnknown: false,
      lens: {
        powerPreference: 'default',
        liveAntialias: false,
        snapshotAntialias: true,
        fboSamples: isHighEnd ? 4 : 2,
        precision: isHighEnd ? 'highp' : 'mediump',
        maxDpr: isHighEnd ? 1.5 : 1,
        minDpr: isHighEnd ? 1 : 0.85,
        modelVariant: 'mobile',
        usePmrem: true,
        disableScrollTransition: false,
      },
      memoryCard: {
        powerPreference: 'default',
        antialias: false,
        precision: isHighEnd ? 'highp' : 'mediump',
        maxDpr: isHighEnd ? 1.25 : 1,
        targetFps: isHighEnd ? 60 : 30,
        disabled: false,
      },
    }
  }

  // 9. unknown-privacy-desktop (Tier 1D)
  return {
    id: 'unknown-privacy-desktop',
    tier: 1,
    subTier: '1D',
    renderer: input.renderer,
    isHdrDisplay: input.isHdrDisplay,
    isSpoofedOrUnknown: true,
    lens: {
      powerPreference: 'high-performance',
      liveAntialias: false,
      snapshotAntialias: true,
      fboSamples: 4,
      precision: 'highp',
      maxDpr: input.isHdrDisplay ? 1.0 : 1.25,
      minDpr: 0.85,
      modelVariant: 'desktop',
      usePmrem: true,
      disableScrollTransition: false,
    },
    memoryCard: {
      powerPreference: 'high-performance',
      antialias: false,
      precision: 'highp',
      maxDpr: 1.25,
      targetFps: 60,
      disabled: false,
    },
  }
}

let cachedGpuProfile: GpuRenderProfile | null = null

export function getGpuProfile(): GpuRenderProfile {
  if (cachedGpuProfile) return cachedGpuProfile

  const hdr = isHdrDisplay()
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const isMobile =
    typeof navigator !== 'undefined' &&
    /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

  if (typeof document === 'undefined') {
    return classifyGpuRenderer({
      renderer: '',
      vendor: '',
      isWebGL2: true,
      majorPerformanceCaveat: false,
      maxTextureSize: 4096,
      maxSamples: 4,
      isWebKit,
      isIPad,
      isMobile,
      isBrave: isBraveBrowser,
      isHdrDisplay: hdr,
      devicePixelRatio: dpr,
    })
  }

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1

  let majorPerformanceCaveat = false
  let gl = canvas.getContext('webgl2', {
    failIfMajorPerformanceCaveat: true,
    powerPreference: 'high-performance',
  }) as WebGL2RenderingContext | null

  if (!gl) {
    majorPerformanceCaveat = true
    gl = canvas.getContext('webgl2', {
      failIfMajorPerformanceCaveat: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null
  }

  const isWebGL2 = Boolean(gl)
  let renderer = ''
  let vendor = ''
  let maxTextureSize = 0
  let maxSamples = 0

  if (gl) {
    try {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      renderer = debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '')
        : String(gl.getParameter(gl.RENDERER) || '')
      vendor = debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '')
        : String(gl.getParameter(gl.VENDOR) || '')
      maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0)
      maxSamples = Number(gl.getParameter(gl.MAX_SAMPLES) || 0)
    } finally {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }

  const profile = classifyGpuRenderer({
    renderer,
    vendor,
    isWebGL2,
    majorPerformanceCaveat,
    maxTextureSize,
    maxSamples,
    isWebKit,
    isIPad,
    isMobile,
    isBrave: isBraveBrowser,
    isHdrDisplay: hdr,
    devicePixelRatio: dpr,
  })

  document.documentElement.dataset.gpuTier = String(profile.tier)
  document.documentElement.dataset.gpuProfile = profile.id

  cachedGpuProfile = profile
  return profile
}

export type FrameTimeGovernor = {
  recordBakeDuration: (ms: number) => void
  recordFrameTime: (ms: number) => void
  dispose: () => void
}

export function createFrameTimeGovernor(
  profile: GpuRenderProfile,
  initialDpr: number,
  onStepDown: (nextDpr: number) => void,
): FrameTimeGovernor {
  const minDpr = profile.lens.minDpr
  let currentDpr = Math.max(minDpr, initialDpr)
  let consecutiveSlowFrames = 0
  let longAnimationFrameCount = 0
  let disposed = false
  let observer: PerformanceObserver | null = null

  const stepDown = () => {
    if (disposed || currentDpr <= minDpr) return
    const nextDpr = Math.max(minDpr, Math.round((currentDpr - 0.25) * 100) / 100)
    if (nextDpr < currentDpr) {
      currentDpr = nextDpr
      consecutiveSlowFrames = 0
      longAnimationFrameCount = 0
      onStepDown(nextDpr)
    }
  }

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        if (disposed) return
        for (const entry of list.getEntries()) {
          if (entry.duration > 60) {
            longAnimationFrameCount += 1
            if (longAnimationFrameCount >= 2) {
              stepDown()
              break
            }
          }
        }
      })
      observer.observe({ type: 'long-animation-frame', buffered: false })
    } catch {
      observer = null
    }
  }

  return {
    recordBakeDuration(ms: number) {
      if (disposed) return
      if (ms > 55) {
        stepDown()
      }
    },
    recordFrameTime(ms: number) {
      if (disposed) return
      if (ms > 24) {
        consecutiveSlowFrames += 1
        if (consecutiveSlowFrames >= 4) {
          stepDown()
        }
      } else {
        consecutiveSlowFrames = 0
      }
    },
    dispose() {
      disposed = true
      observer?.disconnect()
      observer = null
    },
  }
}
