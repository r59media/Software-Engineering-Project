/// <reference types="node" />
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyGpuRenderer,
  createFrameTimeGovernor,
  type GpuProbeInput,
} from './gpuProfile.ts'

function makeInput(overrides: Partial<GpuProbeInput> = {}): GpuProbeInput {
  return {
    renderer: '',
    vendor: '',
    isWebGL2: true,
    majorPerformanceCaveat: false,
    maxTextureSize: 16384,
    maxSamples: 8,
    isWebKit: false,
    isIPad: false,
    isMobile: false,
    isBrave: false,
    isHdrDisplay: false,
    devicePixelRatio: 2,
    ...overrides,
  }
}

describe('classifyGpuRenderer', () => {
  it('classifies software renderers, WebGL1, caveat, small textures, and 2010-2012 legacy GPUs as software-legacy (Tier 0)', () => {
    const cases: Array<[string, Partial<GpuProbeInput>]> = [
      ['WebGL1 only', { renderer: 'NVIDIA GeForce RTX 4090', isWebGL2: false }],
      ['majorPerformanceCaveat', { renderer: 'Intel(R) UHD Graphics 630', majorPerformanceCaveat: true }],
      ['maxTextureSize < 4096', { renderer: 'AMD Radeon RX 7900 XTX', maxTextureSize: 2048 }],
      ['SwiftShader', { renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' }],
      ['llvmpipe', { renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' }],
      ['Microsoft Basic Render', { renderer: 'Microsoft Basic Render Driver' }],
      ['VMware', { renderer: 'SVGA3D; build: RELEASE; LLVM; VMware' }],
      ['VirtualBox', { renderer: 'VirtualBox Graphics Adapter' }],
      ['Intel HD 3000 (2011)', { renderer: 'Intel(R) HD Graphics 3000' }],
      ['Intel HD 4000 (2012)', { renderer: 'Intel(R) HD Graphics 4000' }],
      ['GeForce GTX 580 (2010)', { renderer: 'NVIDIA GeForce GTX 580' }],
      ['GeForce GT 440 (2010)', { renderer: 'NVIDIA GeForce GT 440' }],
      ['Radeon HD 6850 (2010)', { renderer: 'AMD Radeon HD 6850' }],
    ]

    for (const [label, overrides] of cases) {
      const profile = classifyGpuRenderer(makeInput(overrides))
      assert.equal(profile.id, 'software-legacy', label)
      assert.equal(profile.tier, 0, label)
      assert.equal(profile.lens.powerPreference, 'low-power', label)
      assert.equal(profile.lens.liveAntialias, false, label)
      assert.equal(profile.lens.snapshotAntialias, false, label)
      assert.equal(profile.lens.fboSamples, 0, label)
      assert.equal(profile.lens.precision, 'mediump', label)
      assert.equal(profile.lens.maxDpr, 1, label)
      assert.equal(profile.lens.minDpr, 1, label)
      assert.equal(profile.lens.modelVariant, 'mobile', label)
      assert.equal(profile.lens.usePmrem, false, label)
      assert.equal(profile.lens.disableScrollTransition, true, label)
      assert.equal(profile.memoryCard.disabled, true, label)
      assert.equal(profile.memoryCard.targetFps, 30, label)
    }
  })

  it('classifies Apple Silicon / WebKit / iPadOS as apple-arm-webkit (Tier 2A)', () => {
    const ipad = classifyGpuRenderer(
      makeInput({ renderer: 'Apple GPU', isWebKit: true, isIPad: true }),
    )
    assert.equal(ipad.id, 'apple-arm-webkit')
    assert.equal(ipad.tier, 2)
    assert.equal(ipad.lens.maxDpr, 1.25)
    assert.equal(ipad.lens.modelVariant, 'mobile')
    assert.equal(ipad.lens.powerPreference, 'default')
    assert.equal(ipad.lens.liveAntialias, false)
    assert.equal(ipad.lens.snapshotAntialias, true)
    assert.equal(ipad.memoryCard.maxDpr, 1.25)
    assert.equal(ipad.memoryCard.disabled, false)

    const iphone = classifyGpuRenderer(
      makeInput({ renderer: 'Apple GPU', isWebKit: true, isMobile: true }),
    )
    assert.equal(iphone.id, 'apple-arm-webkit')
    assert.equal(iphone.lens.maxDpr, 1.25)
    assert.equal(iphone.lens.modelVariant, 'mobile')

    const macM3 = classifyGpuRenderer(
      makeInput({ renderer: 'Apple M3 Max', isWebKit: true }),
    )
    assert.equal(macM3.id, 'apple-arm-webkit')
    assert.equal(macM3.tier, 2)
    assert.equal(macM3.lens.maxDpr, 1.5)
    assert.equal(macM3.lens.modelVariant, 'desktop')
    assert.equal(macM3.lens.powerPreference, 'high-performance')
    assert.equal(macM3.memoryCard.maxDpr, 1.5)
    assert.equal(macM3.memoryCard.targetFps, 60)
  })

  it('classifies discrete NVIDIA GPUs (legacy/entry vs modern/future) as discrete-nvidia (Tier 3B)', () => {
    const entryCases = [
      'NVIDIA GeForce GTX 960',
      'NVIDIA GeForce MX450',
      'NVIDIA GeForce GT 730',
      'NVIDIA Quadro K2200',
    ]
    for (const renderer of entryCases) {
      const profile = classifyGpuRenderer(makeInput({ renderer }))
      assert.equal(profile.id, 'discrete-nvidia', renderer)
      assert.equal(profile.tier, 3, renderer)
      assert.equal(profile.lens.liveAntialias, false, renderer)
      assert.equal(profile.lens.maxDpr, 1.5, renderer)
      assert.equal(profile.lens.minDpr, 1, renderer)
      assert.equal(profile.memoryCard.maxDpr, 1.5, renderer)
      assert.equal(profile.memoryCard.antialias, true, renderer)
    }

    const modernCases = [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0)',
      'NVIDIA GeForce RTX 5090',
      'NVIDIA GeForce RTX 6080',
      'NVIDIA GeForce GTX 1660 Ti',
      'NVIDIA RTX A5000',
      'NVIDIA TITAN RTX',
    ]
    for (const renderer of modernCases) {
      const profile = classifyGpuRenderer(makeInput({ renderer }))
      assert.equal(profile.id, 'discrete-nvidia', renderer)
      assert.equal(profile.tier, 3, renderer)
      assert.equal(profile.lens.liveAntialias, true, renderer)
      assert.equal(profile.lens.maxDpr, 2, renderer)
      assert.equal(profile.lens.minDpr, 1.25, renderer)
      assert.equal(profile.memoryCard.maxDpr, 2, renderer)
      assert.equal(profile.memoryCard.antialias, true, renderer)
    }
  })

  it('classifies discrete AMD GPUs (legacy GCN vs modern/future RDNA) as discrete-amd (Tier 3A)', () => {
    const gcnCases = [
      'AMD Radeon RX 580',
      'AMD Radeon R9 390',
      'AMD Radeon HD 7970',
      'AMD Radeon VII',
    ]
    for (const renderer of gcnCases) {
      const profile = classifyGpuRenderer(makeInput({ renderer }))
      assert.equal(profile.id, 'discrete-amd', renderer)
      assert.equal(profile.tier, 3, renderer)
      assert.equal(profile.lens.liveAntialias, false, renderer)
      assert.equal(profile.lens.maxDpr, 1.5, renderer)
      assert.equal(profile.lens.minDpr, 1, renderer)
    }

    const rdnaCases = [
      'AMD Radeon RX 7900 XTX',
      'AMD Radeon RX 9070 XT',
      'AMD Radeon RX 10900',
      'AMD Radeon PRO W7900',
    ]
    for (const renderer of rdnaCases) {
      const profile = classifyGpuRenderer(makeInput({ renderer }))
      assert.equal(profile.id, 'discrete-amd', renderer)
      assert.equal(profile.tier, 3, renderer)
      assert.equal(profile.lens.liveAntialias, true, renderer)
      assert.equal(profile.lens.maxDpr, 2, renderer)
      assert.equal(profile.lens.minDpr, 1.25, renderer)
      assert.equal(profile.memoryCard.maxDpr, 2, renderer)
    }
  })

  it('classifies modern Intel Xe/Arc/Xe2/Xe3 iGPUs as intel-igpu-modern (Tier 1B) with HDR scaling', () => {
    const modernIntel = [
      'Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2)',
      'Intel(R) Arc(TM) A770 Graphics',
      'Intel(R) Graphics (Xe-LPG)',
      'Mesa Intel(R) Graphics (Xe2)',
      'Intel(R) Xe3 Graphics',
    ]
    for (const renderer of modernIntel) {
      const sdr = classifyGpuRenderer(makeInput({ renderer, isHdrDisplay: false }))
      assert.equal(sdr.id, 'intel-igpu-modern', renderer)
      assert.equal(sdr.tier, 1, renderer)
      assert.equal(sdr.lens.liveAntialias, false, renderer)
      assert.equal(sdr.lens.fboSamples, 4, renderer)
      assert.equal(sdr.lens.precision, 'highp', renderer)
      assert.equal(sdr.lens.maxDpr, 1.5, renderer)
      assert.equal(sdr.lens.minDpr, 1, renderer)
      assert.equal(sdr.lens.modelVariant, 'desktop', renderer)

      const hdr = classifyGpuRenderer(makeInput({ renderer, isHdrDisplay: true }))
      assert.equal(hdr.lens.maxDpr, 1.25, renderer)
    }
  })

  it('classifies legacy Intel iGPUs (HD/UHD/Comet Lake CML GT2) as intel-igpu-legacy (Tier 1A) with HDR scaling', () => {
    const legacyIntel = [
      'Mesa Intel(R) UHD Graphics (CML GT2)',
      'Intel(R) UHD Graphics 630',
      'Intel(R) HD Graphics 530',
      'Intel(R) Iris(R) Plus Graphics 655',
    ]
    for (const renderer of legacyIntel) {
      const sdr = classifyGpuRenderer(makeInput({ renderer, isHdrDisplay: false }))
      assert.equal(sdr.id, 'intel-igpu-legacy', renderer)
      assert.equal(sdr.tier, 1, renderer)
      assert.equal(sdr.lens.fboSamples, 2, renderer)
      assert.equal(sdr.lens.precision, 'mediump', renderer)
      assert.equal(sdr.lens.maxDpr, 1.15, renderer)
      assert.equal(sdr.lens.minDpr, 0.85, renderer)
      assert.equal(sdr.lens.modelVariant, 'mobile', renderer)
      assert.equal(sdr.memoryCard.targetFps, 30, renderer)
      assert.equal(sdr.memoryCard.antialias, false, renderer)

      const hdr = classifyGpuRenderer(makeInput({ renderer, isHdrDisplay: true }))
      assert.equal(hdr.lens.maxDpr, 1.0, renderer)
    }
  })

  it('classifies AMD APUs (pre-Vega vs Vega/RDNA) as amd-igpu (Tier 1C)', () => {
    const preVega = classifyGpuRenderer(
      makeInput({ renderer: 'AMD Radeon(TM) R5 Graphics' }),
    )
    assert.equal(preVega.id, 'amd-igpu')
    assert.equal(preVega.tier, 1)
    assert.equal(preVega.lens.maxDpr, 1.15)
    assert.equal(preVega.lens.minDpr, 0.85)
    assert.equal(preVega.lens.fboSamples, 2)
    assert.equal(preVega.lens.modelVariant, 'mobile')
    assert.equal(preVega.memoryCard.targetFps, 30)

    const modernApu = classifyGpuRenderer(
      makeInput({ renderer: 'AMD Radeon(TM) 780M Graphics', isHdrDisplay: false }),
    )
    assert.equal(modernApu.id, 'amd-igpu')
    assert.equal(modernApu.tier, 1)
    assert.equal(modernApu.lens.maxDpr, 1.5)
    assert.equal(modernApu.lens.minDpr, 1)
    assert.equal(modernApu.lens.fboSamples, 4)
    assert.equal(modernApu.lens.modelVariant, 'desktop')
    assert.equal(modernApu.memoryCard.targetFps, 60)

    const modernApuHdr = classifyGpuRenderer(
      makeInput({ renderer: 'AMD Radeon(TM) 890M', isHdrDisplay: true }),
    )
    assert.equal(modernApuHdr.lens.maxDpr, 1.25)
  })

  it('classifies mobile ARM GPUs (OnePlus 15 Adreno 8xx & legacy ARM) as mobile-arm (Tier 2B)', () => {
    const highEndCases = [
      'Adreno (TM) 830',
      'Adreno (TM) 750',
      'Adreno (TM) 1050',
      'ARM Immortalis-G720 MC12',
      'Mali-G710',
    ]
    for (const renderer of highEndCases) {
      const profile = classifyGpuRenderer(makeInput({ renderer, isMobile: true }))
      assert.equal(profile.id, 'mobile-arm', renderer)
      assert.equal(profile.tier, 2, renderer)
      assert.equal(profile.lens.maxDpr, 1.5, renderer)
      assert.equal(profile.lens.minDpr, 1, renderer)
      assert.equal(profile.lens.fboSamples, 4, renderer)
      assert.equal(profile.lens.precision, 'highp', renderer)
      assert.equal(profile.memoryCard.targetFps, 60, renderer)
    }

    const legacyArm = classifyGpuRenderer(
      makeInput({ renderer: 'Adreno (TM) 512', isMobile: true }),
    )
    assert.equal(legacyArm.id, 'mobile-arm')
    assert.equal(legacyArm.tier, 2)
    assert.equal(legacyArm.lens.maxDpr, 1)
    assert.equal(legacyArm.lens.minDpr, 0.85)
    assert.equal(legacyArm.lens.fboSamples, 2)
    assert.equal(legacyArm.lens.precision, 'mediump')
    assert.equal(legacyArm.memoryCard.targetFps, 30)
  })

  it('classifies Brave Shields spoofed / unknown desktop GPUs as unknown-privacy-desktop (Tier 1D)', () => {
    const sdr = classifyGpuRenderer(
      makeInput({
        renderer: 'Google Inc. (Google)',
        vendor: 'Google Inc.',
        isBrave: true,
        isHdrDisplay: false,
      }),
    )
    assert.equal(sdr.id, 'unknown-privacy-desktop')
    assert.equal(sdr.tier, 1)
    assert.equal(sdr.isSpoofedOrUnknown, true)
    assert.equal(sdr.lens.maxDpr, 1.25)
    assert.equal(sdr.lens.minDpr, 0.85)
    assert.equal(sdr.lens.fboSamples, 4)
    assert.equal(sdr.lens.precision, 'highp')

    const hdr = classifyGpuRenderer(
      makeInput({ renderer: '', isBrave: true, isHdrDisplay: true }),
    )
    assert.equal(hdr.id, 'unknown-privacy-desktop')
    assert.equal(hdr.lens.maxDpr, 1.0)
  })
})

describe('createFrameTimeGovernor', () => {
  it('steps down DPR monotonically on slow bake durations and floors at minDpr', () => {
    const profile = classifyGpuRenderer(
      makeInput({ renderer: 'Mesa Intel(R) UHD Graphics (CML GT2)' }),
    )
    // minDpr is 0.85, initialDpr is 1.15
    const steps: number[] = []
    const gov = createFrameTimeGovernor(profile, 1.15, (nextDpr) => steps.push(nextDpr))

    gov.recordBakeDuration(40) // <= 55ms: no step down
    assert.deepEqual(steps, [])

    gov.recordBakeDuration(62) // > 55ms: 1.15 -> 0.9
    gov.recordBakeDuration(65) // > 55ms: 0.9 -> 0.85 (floored at minDpr)
    gov.recordBakeDuration(70) // already at floor: no further step down

    assert.deepEqual(steps, [0.9, 0.85])
    gov.dispose()
  })

  it('steps down DPR only after 4 consecutive slow frames (> 24ms)', () => {
    const profile = classifyGpuRenderer(
      makeInput({ renderer: 'NVIDIA GeForce RTX 4090' }),
    )
    // minDpr is 1.25, initialDpr is 2.0
    const steps: number[] = []
    const gov = createFrameTimeGovernor(profile, 2.0, (nextDpr) => steps.push(nextDpr))

    gov.recordFrameTime(26)
    gov.recordFrameTime(28)
    gov.recordFrameTime(30)
    gov.recordFrameTime(16) // resets consecutive counter
    assert.deepEqual(steps, [])

    gov.recordFrameTime(25)
    gov.recordFrameTime(26)
    gov.recordFrameTime(27)
    gov.recordFrameTime(28) // 4th consecutive -> steps down 2.0 -> 1.75
    assert.deepEqual(steps, [1.75])

    gov.dispose()
    gov.recordBakeDuration(100) // disposed: no-op
    assert.deepEqual(steps, [1.75])
  })

  it('steps down DPR on 2 long-animation-frame entries (> 60ms) via PerformanceObserver', () => {
    const originalPO = globalThis.PerformanceObserver
    type ObserverCb = (list: { getEntries: () => Array<{ duration: number }> }) => void
    let observerCallback: ObserverCb | null = null
    let disconnected = false

    class MockPerformanceObserver {
      constructor(cb: ObserverCb) {
        observerCallback = cb
      }
      observe() {}
      disconnect() {
        disconnected = true
      }
    }

    globalThis.PerformanceObserver = MockPerformanceObserver as unknown as typeof PerformanceObserver

    try {
      const profile = classifyGpuRenderer(
        makeInput({ renderer: 'Intel(R) Iris(R) Xe Graphics' }),
      )
      const steps: number[] = []
      const gov = createFrameTimeGovernor(profile, 1.5, (nextDpr) => steps.push(nextDpr))

      const cb = observerCallback as ObserverCb | null
      if (!cb) {
        throw new Error('Expected observerCallback to be registered')
      }
      cb({ getEntries: () => [{ duration: 45 }, { duration: 75 }] })
      assert.deepEqual(steps, [])

      cb({ getEntries: () => [{ duration: 80 }] })
      assert.deepEqual(steps, [1.25])

      gov.dispose()
      assert.equal(disconnected, true)
    } finally {
      globalThis.PerformanceObserver = originalPO
    }
  })
})
