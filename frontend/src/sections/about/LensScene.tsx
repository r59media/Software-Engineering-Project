import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import {
  ACESFilmicToneMapping,
  Color,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  NormalBlending,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type TextureDataType,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { LensTransitionController } from '../transition/LensTransitionContext'
import { aboutLens } from '../../config/aboutLens'
import { isIntegratedOrLowPowerGpu, isWebKit } from '../../utils/browserEnv'

function StudioLighting() {
  const { gl, scene, invalidate } = useThree()
  useLayoutEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      const generator = new PMREMGenerator(gl)
      const room = new RoomEnvironment()
      const environment = generator.fromScene(room, 0.04)
      room.dispose()
      generator.dispose()
      const previous = scene.environment
      Reflect.set(scene, 'environment', environment.texture)
      invalidate()
      cleanup = () => { Reflect.set(scene, 'environment', previous); environment.dispose() }
    } catch {
      // Brave Shields strict fingerprinting can block float textures;
      // fallback to ambient/directional lights without crashing the scene.
    }
    return () => { cleanup?.() }
  }, [gl, scene, invalidate])
  return <>
    <ambientLight intensity={0.2} />
    <directionalLight position={[-1, 2, 3]} intensity={1} />
    <directionalLight position={[2, -1, 2]} intensity={0.3} />
  </>
}

type LensSceneProps = {
  url: string
  aperture: number
  transition?: LensTransitionController | null
  staticSnapshot?: boolean
  bakeStaticBezel?: boolean
}

type LensModelProps = LensSceneProps & {
  onSnapshot?: (dataUrl: string) => void
  onSnapshotStart?: () => void
}

type IrisBladeRecord = {
  mesh: Mesh
  rest: number
  travel: number
  restX: number
  restY: number
  hx: number
  hy: number
}

type CompositeResources = {
  scene: Scene
  camera: OrthographicCamera
  geometry: PlaneGeometry
  material: ShaderMaterial
}

type BakeState = {
  bezelRT: WebGLRenderTarget | null
  bakedKey: string
  fboSupported: boolean
  irisBlades: IrisBladeRecord[]
  bezelMeshes: Mesh[]
  composite: CompositeResources | null
}

function collectLensMeshes(model: Object3D): { irisBlades: IrisBladeRecord[]; bezelMeshes: Mesh[] } {
  const irisBlades: IrisBladeRecord[] = []
  const bezelMeshes: Mesh[] = []
  model.traverse(object => {
    if (!(object instanceof Mesh)) return
    if (object.name.startsWith('IrisBlade_')) {
      const rest = typeof object.userData.irisRestAngle === 'number' ? object.userData.irisRestAngle : object.rotation.z
      const travel = typeof object.userData.irisTravelAngle === 'number' ? object.userData.irisTravelAngle : aboutLens.iris.travelAngle
      const restX = object.position.x
      const restY = object.position.y
      const rawHinge = Array.isArray(object.userData.irisHinge) ? object.userData.irisHinge : null
      const hx = rawHinge && typeof rawHinge[0] === 'number' ? rawHinge[0] : restX
      const hy = rawHinge && typeof rawHinge[1] === 'number' ? rawHinge[1] : restY
      irisBlades.push({ mesh: object, rest, travel, restX, restY, hx, hy })
    } else {
      bezelMeshes.push(object)
    }
  })
  return { irisBlades, bezelMeshes }
}

const BEZEL_COMPOSITE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const BEZEL_BAKE_TONEMAP_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tHdrBezel;
  uniform float uExposure;
  uniform float uUseAces;
  varying vec2 vUv;

  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }

  vec3 applyACESFilmic(vec3 color) {
    const mat3 ACESInputMat = mat3(
      vec3(0.59719, 0.07600, 0.02840),
      vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777)
    );
    const mat3 ACESOutputMat = mat3(
      vec3( 1.60475, -0.10208, -0.00327),
      vec3(-0.53108,  1.10813, -0.07276),
      vec3(-0.07367, -0.00605,  1.07602)
    );
    color *= uExposure / 0.6;
    color = ACESInputMat * color;
    color = RRTAndODTFit(color);
    color = ACESOutputMat * color;
    return clamp(color, 0.0, 1.0);
  }

  vec3 linearToSRGB(vec3 c) {
    return mix(
      pow(c, vec3(0.41666)) * 1.055 - vec3(0.055),
      c * 12.92,
      vec3(lessThanEqual(c, vec3(0.0031308)))
    );
  }

  void main() {
    vec4 tex = texture2D(tHdrBezel, vUv);
    if (tex.a < 0.001) {
      gl_FragColor = vec4(0.0);
      return;
    }
    vec3 rgb = tex.rgb / tex.a;
    if (uUseAces > 0.5) {
      rgb = applyACESFilmic(rgb);
    } else {
      rgb = clamp(rgb, 0.0, 1.0);
    }
    rgb = linearToSRGB(rgb);
    gl_FragColor = vec4(rgb * tex.a, tex.a);
  }
`

const BEZEL_COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D tBezel;
  varying vec2 vUv;
  void main() {
    vec4 tex = texture2D(tBezel, vUv);
    if (tex.a < 0.001) discard;
    gl_FragColor = tex;
  }
`

function restoreMeshesForDirectRender(state: BakeState) {
  for (const mesh of state.bezelMeshes) {
    mesh.visible = true
    mesh.matrixAutoUpdate = true
  }
  for (const { mesh } of state.irisBlades) {
    mesh.visible = true
  }
}

function fallbackBezelPassToDirect(
  state: BakeState,
  gl: { getContext: () => WebGLRenderingContext | WebGL2RenderingContext },
  setDpr: (dpr: number) => void,
) {
  state.fboSupported = false
  state.bezelRT?.dispose()
  state.bezelRT = null
  restoreMeshesForDirectRender(state)
  if (isIntegratedOrLowPowerGpu(gl.getContext())) {
    setDpr(Math.min(window.devicePixelRatio || 1, 1.25))
  }
}

function bakeStaticBezelTarget(
  state: BakeState,
  gl: Parameters<Parameters<typeof useFrame>[0]>[0]['gl'],
  scene: Scene,
  camera: Parameters<Parameters<typeof useFrame>[0]>[0]['camera'],
  model: Object3D,
  w: number,
  h: number,
  key: string,
  clearColorScratch: Color,
  setDpr: (dpr: number) => void,
): boolean {
  const composite = state.composite
  if (!composite || !gl.capabilities.isWebGL2 || state.bezelMeshes.length === 0) {
    fallbackBezelPassToDirect(state, gl, setDpr)
    return false
  }

  const rawGl = gl.getContext() as WebGL2RenderingContext
  const samples = Math.max(0, Math.min(4, gl.capabilities.maxSamples || 0))
  const hasFloatColorBuffer =
    gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float')

  const prevTarget = gl.getRenderTarget()
  const prevClearColor = gl.getClearColor(clearColorScratch)
  const prevClearAlpha = gl.getClearAlpha()
  const prevAutoClear = gl.autoClear

  const restoreGlState = () => {
    gl.setRenderTarget(prevTarget)
    gl.setClearColor(prevClearColor, prevClearAlpha)
    Reflect.set(gl, 'autoClear', prevAutoClear)
  }

  const testCompleteness = (rt: WebGLRenderTarget) => {
    gl.setRenderTarget(rt)
    return rawGl.checkFramebufferStatus(rawGl.FRAMEBUFFER) === rawGl.FRAMEBUFFER_COMPLETE
  }

  const createHdrTarget = (type: TextureDataType) => {
    const candidate = new WebGLRenderTarget(w, h, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      type,
      samples,
    })
    try {
      if (testCompleteness(candidate)) return candidate
    } catch {
      // Fall through to cleanup and retry with UnsignedByteType.
    }
    gl.setRenderTarget(null)
    candidate.dispose()
    return null
  }

  const createSrgbTarget = () => {
    const candidate = new WebGLRenderTarget(w, h, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      type: UnsignedByteType,
      samples: 0,
      depthBuffer: false,
      stencilBuffer: false,
    })
    try {
      if (testCompleteness(candidate)) return candidate
    } catch {
      // Fall through to cleanup.
    }
    gl.setRenderTarget(null)
    candidate.dispose()
    return null
  }

  let hdrRt: WebGLRenderTarget | null = null
  let bakeMaterial: ShaderMaterial | null = null

  try {
    gl.setScissorTest(false)

    if (hasFloatColorBuffer) {
      hdrRt = createHdrTarget(HalfFloatType)
    }
    if (!hdrRt) {
      hdrRt = createHdrTarget(UnsignedByteType)
    }
    if (!hdrRt) {
      restoreGlState()
      fallbackBezelPassToDirect(state, gl, setDpr)
      return false
    }

    let bezelSrgbRt = state.bezelRT
    if (bezelSrgbRt && (bezelSrgbRt.width !== w || bezelSrgbRt.height !== h)) {
      bezelSrgbRt.setSize(w, h)
      if (!testCompleteness(bezelSrgbRt)) {
        gl.setRenderTarget(null)
        bezelSrgbRt.dispose()
        bezelSrgbRt = null
        state.bezelRT = null
      }
    }

    if (!bezelSrgbRt) {
      bezelSrgbRt = createSrgbTarget()
      if (!bezelSrgbRt) {
        hdrRt.dispose()
        hdrRt = null
        restoreGlState()
        fallbackBezelPassToDirect(state, gl, setDpr)
        return false
      }
      state.bezelRT = bezelSrgbRt
    }

    for (const mesh of state.bezelMeshes) {
      mesh.visible = true
    }
    model.updateMatrixWorld(true)
    for (const { mesh } of state.irisBlades) {
      mesh.visible = false
    }

    // Stage 1: Render stationary bezel meshes into temporary MSAA HDR render target.
    Reflect.set(gl, 'autoClear', false)
    gl.setRenderTarget(hdrRt)
    gl.setClearColor(0x000000, 0)
    gl.clear(true, true, true)
    gl.compile(scene, camera)
    gl.render(scene, camera)

    // Stage 2: Resolve, ACESFilmic tone-map, sRGB-encode, and premultiply once into persistent RGBA8 RT.
    bakeMaterial = new ShaderMaterial({
      uniforms: {
        tHdrBezel: { value: hdrRt.texture },
        uExposure: { value: gl.toneMappingExposure },
        uUseAces: { value: gl.toneMapping === ACESFilmicToneMapping ? 1 : 0 },
      },
      vertexShader: BEZEL_COMPOSITE_VERTEX_SHADER,
      fragmentShader: BEZEL_BAKE_TONEMAP_FRAGMENT_SHADER,
      transparent: false,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const bakeScene = new Scene()
    const bakeQuad = new Mesh(composite.geometry, bakeMaterial)
    bakeQuad.frustumCulled = false
    bakeScene.add(bakeQuad)

    gl.setRenderTarget(bezelSrgbRt)
    gl.setClearColor(0x000000, 0)
    gl.clear(true, false, false)
    gl.render(bakeScene, composite.camera)
    gl.setRenderTarget(null)

    hdrRt.dispose()
    hdrRt = null
    bakeMaterial.dispose()
    bakeMaterial = null

    for (const mesh of state.bezelMeshes) {
      mesh.visible = false
      mesh.matrixAutoUpdate = false
    }
    for (const { mesh } of state.irisBlades) {
      mesh.visible = true
    }

    // Warm iris blade & fullscreen composite programs on the default framebuffer upfront.
    gl.compile(scene, camera)
    gl.compile(composite.scene, composite.camera)

    restoreGlState()

    composite.material.uniforms.tBezel.value = bezelSrgbRt.texture
    state.bakedKey = key
    return true
  } catch {
    hdrRt?.dispose()
    bakeMaterial?.dispose()
    restoreGlState()
    fallbackBezelPassToDirect(state, gl, setDpr)
    return false
  }
}

function BezelBakePass({ model }: { model: Object3D }) {
  const { gl, invalidate, setDpr } = useThree()
  const drawingSizeRef = useRef(new Vector2())
  const clearColorRef = useRef(new Color())
  const frameClearColorRef = useRef(new Color())
  const bakeStateRef = useRef<BakeState>({
    bezelRT: null,
    bakedKey: '',
    fboSupported: true,
    irisBlades: [],
    bezelMeshes: [],
    composite: null,
  })

  useLayoutEffect(() => {
    const { irisBlades, bezelMeshes } = collectLensMeshes(model)
    const compositeScene = new Scene()
    const orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const geometry = new PlaneGeometry(2, 2)
    const material = new ShaderMaterial({
      uniforms: { tBezel: { value: null } },
      vertexShader: BEZEL_COMPOSITE_VERTEX_SHADER,
      fragmentShader: BEZEL_COMPOSITE_FRAGMENT_SHADER,
      transparent: true,
      blending: NormalBlending,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const quad = new Mesh(geometry, material)
    quad.frustumCulled = false
    compositeScene.add(quad)

    const state = bakeStateRef.current
    state.irisBlades = irisBlades
    state.bezelMeshes = bezelMeshes
    state.composite = { scene: compositeScene, camera: orthoCamera, geometry, material }
    state.bakedKey = ''
    state.fboSupported = gl.capabilities.isWebGL2
    invalidate()

    return () => {
      state.bezelRT?.dispose()
      state.bezelRT = null
      geometry.dispose()
      material.dispose()
      state.composite = null
      state.bakedKey = ''
      restoreMeshesForDirectRender(state)
      state.irisBlades = []
      state.bezelMeshes = []
    }
  }, [gl, model, invalidate])

  useFrame(({ gl: frameGl, scene: frameScene, camera: frameCamera, size }) => {
    const state = bakeStateRef.current
    const composite = state.composite
    if (state.fboSupported && composite && state.bezelMeshes.length > 0) {
      const sizeVec = frameGl.getDrawingBufferSize(drawingSizeRef.current)
      const w = sizeVec.x
      const h = sizeVec.y
      if (w <= 0 || h <= 0) return

      const currentKey = `${w}x${h}@${frameScene.environment?.uuid ?? 'none'}`
      if (state.bakedKey !== currentKey) {
        bakeStaticBezelTarget(
          state,
          frameGl,
          frameScene,
          frameCamera,
          model,
          w,
          h,
          currentKey,
          clearColorRef.current,
          setDpr,
        )
      }

      if (state.fboSupported && state.bezelRT) {
        const prevAutoClear = frameGl.autoClear
        const prevClearColor = frameGl.getClearColor(frameClearColorRef.current)
        const prevClearAlpha = frameGl.getClearAlpha()
        Reflect.set(frameGl, 'autoClear', false)
        frameGl.setScissorTest(false)
        frameGl.setRenderTarget(null)
        frameGl.setClearColor(0x000000, 0)
        frameGl.clear(true, true, true)

        const sx = Math.floor(size.width * 0.23)
        const sy = Math.floor(size.height * 0.23)
        const sw = Math.min(size.width - sx, Math.ceil(size.width * 0.54))
        const sh = Math.min(size.height - sy, Math.ceil(size.height * 0.54))
        if (sw > 0 && sh > 0) {
          frameGl.setScissor(sx, sy, sw, sh)
          frameGl.setScissorTest(true)
        }
        frameGl.render(frameScene, frameCamera)
        frameGl.setScissorTest(false)

        frameGl.clearDepth()
        frameGl.render(composite.scene, composite.camera)
        frameGl.setClearColor(prevClearColor, prevClearAlpha)
        Reflect.set(frameGl, 'autoClear', prevAutoClear)
        return
      }
    }
    frameGl.render(frameScene, frameCamera)
  }, 1)

  return null
}

function configureLensLoader(loader: GLTFLoader) {
  loader.setMeshoptDecoder(MeshoptDecoder)
  loader.setRequestHeader({ 'X-R59-Client': 'media-viewer' })
  loader.register(parser => ({
    name: 'R59LensMetadata',
    beforeRoot: async () => {
      for (const node of parser.json.nodes ?? []) {
        if (typeof node.extras?.pivot === 'string') {
          node.extras.pivotDescription = node.extras.pivot
          delete node.extras.pivot
        }
      }
    },
  }))
}

// eslint-disable-next-line react-refresh/only-export-components
export function preloadLensModel(url: string) {
  useLoader.preload(GLTFLoader, url, configureLensLoader)
}

function LensModel({
  url,
  aperture,
  transition,
  staticSnapshot,
  bakeStaticBezel = false,
  onSnapshot,
  onSnapshotStart,
}: LensModelProps) {
  const gltf = useLoader(GLTFLoader, url, configureLensLoader)
  // Clone the hierarchy so future aperture/transform changes do not mutate the loader cache.
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const { gl, scene, camera, invalidate } = useThree()

  useLayoutEffect(() => {
    const maxAnisotropy = gl.capabilities?.getMaxAnisotropy?.() ?? 1
    model.traverse(object => {
      if (!(object instanceof Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const mat of materials) {
        if (!mat || typeof mat !== 'object') continue
        const m = mat as Record<string, unknown>
        const textureKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'emissiveMap']
        for (const key of textureKeys) {
          const tex = m[key]
          if (tex && typeof tex === 'object' && 'minFilter' in tex) {
            const t = tex as { minFilter: number; magFilter: number; anisotropy: number; needsUpdate: boolean }
            t.anisotropy = maxAnisotropy
            t.minFilter = LinearMipmapLinearFilter
            t.magFilter = LinearFilter
            t.needsUpdate = true
          }
        }
      }
    })
  }, [model, gl])

  useLayoutEffect(() => {
    const { irisBlades } = collectLensMeshes(model)
    if (bakeStaticBezel) {
      for (const { mesh } of irisBlades) {
        mesh.frustumCulled = false
        mesh.matrixAutoUpdate = false
      }
    }
    let lastOpening = -1
    const update = (value: number, force = false) => {
      const opening = Math.min(1, Math.max(0, value))
      if (!force && Math.abs(opening - lastOpening) < 0.0004) return
      lastOpening = opening
      for (const { mesh, rest, travel, restX, restY, hx, hy } of irisBlades) {
        const delta = opening * travel
        const cos = Math.cos(delta)
        const sin = Math.sin(delta)
        const dx = restX - hx
        const dy = restY - hy
        mesh.position.x = hx + dx * cos - dy * sin
        mesh.position.y = hy + dx * sin + dy * cos
        mesh.rotation.z = rest + delta
        if (bakeStaticBezel) {
          mesh.updateMatrix()
        }
      }
      invalidate()
    }
    update(aperture, true)
    if (!staticSnapshot) {
      transition?.ready()
    }
    const unsubscribe = transition?.subscribe(update)
    return () => {
      unsubscribe?.()
      for (const { mesh, rest, restX, restY } of irisBlades) {
        mesh.position.x = restX
        mesh.position.y = restY
        mesh.rotation.z = rest
        if (bakeStaticBezel) {
          mesh.updateMatrix()
          mesh.frustumCulled = true
          mesh.matrixAutoUpdate = true
        }
      }
    }
  }, [model, aperture, invalidate, transition, staticSnapshot, bakeStaticBezel])

  useEffect(() => {
    if (!staticSnapshot || !onSnapshot) return
    onSnapshotStart?.()
    let cancelled = false
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return
        try {
          gl.render(scene, camera)
          let dataUrl = gl.domElement.toDataURL('image/webp', 0.98)
          if (!dataUrl.startsWith('data:image/webp')) {
            dataUrl = gl.domElement.toDataURL('image/png')
          }
          if (dataUrl.startsWith('data:image/') && dataUrl.length > 2048) {
            onSnapshot(dataUrl)
          }
        } catch {
          // Brave Shields strict fingerprinting can throw on toDataURL;
          // the 450ms safety timeout keeps transition initialization unblocked.
        }
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [staticSnapshot, onSnapshot, onSnapshotStart, gl, scene, camera, model, aperture])

  return <>
    <primitive object={model} dispose={null} />
    {bakeStaticBezel && <BezelBakePass model={model} />}
  </>
}

const lensDpr: [number, number] = isWebKit ? [1, 1.5] : aboutLens.pixelRatio

export default function LensScene({
  url,
  aperture,
  transition,
  staticSnapshot,
  bakeStaticBezel = false,
}: LensSceneProps) {
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const intentionalUnmountRef = useRef(false)
  const readyCalledRef = useRef(false)
  const readyTimerRef = useRef<number | null>(null)
  const safetyTimerRef = useRef<number | null>(null)

  const notifyReady = useCallback(() => {
    if (readyCalledRef.current) return
    readyCalledRef.current = true
    transition?.ready()
  }, [transition])

  useEffect(() => {
    intentionalUnmountRef.current = false
    return () => {
      intentionalUnmountRef.current = true
      if (readyTimerRef.current !== null) {
        window.clearTimeout(readyTimerRef.current)
        readyTimerRef.current = null
      }
      if (safetyTimerRef.current !== null) {
        window.clearTimeout(safetyTimerRef.current)
        safetyTimerRef.current = null
      }
    }
  }, [])

  const handleSnapshotStart = useCallback(() => {
    if (readyCalledRef.current || safetyTimerRef.current !== null) return
    safetyTimerRef.current = window.setTimeout(() => {
      safetyTimerRef.current = null
      notifyReady()
    }, 450)
  }, [notifyReady])

  const handleSnapshot = useCallback((dataUrl: string) => {
    intentionalUnmountRef.current = true
    if (safetyTimerRef.current !== null) {
      window.clearTimeout(safetyTimerRef.current)
      safetyTimerRef.current = null
    }
    setSnapshotUrl(dataUrl)
  }, [])

  useEffect(() => {
    if (!staticSnapshot || !snapshotUrl || readyCalledRef.current) return
    readyTimerRef.current = window.setTimeout(() => {
      readyTimerRef.current = null
      notifyReady()
    }, 60)
    return () => {
      if (readyTimerRef.current !== null) {
        window.clearTimeout(readyTimerRef.current)
        readyTimerRef.current = null
      }
    }
  }, [staticSnapshot, snapshotUrl, notifyReady])

  if (staticSnapshot && snapshotUrl) {
    return (
      <img
        src={snapshotUrl}
        alt=""
        className="about__lens-canvas"
        style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain', pointerEvents: 'none' }}
      />
    )
  }

  return <Canvas
    className="about__lens-canvas"
    onCreated={({ gl, setDpr }) => {
      if (!staticSnapshot && isIntegratedOrLowPowerGpu(gl.getContext())) {
        setDpr(Math.min(window.devicePixelRatio || 1, 1.25))
      }
      gl.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault()
        if (!intentionalUnmountRef.current) {
          transition?.fail()
        }
      }, { once: true })
    }}
    frameloop="demand"
    resize={{ offsetSize: true }}
    camera={aboutLens.camera}
    dpr={lensDpr}
    scene={{ environmentIntensity: 0.35 }}
    gl={{ alpha: true, antialias: true, preserveDrawingBuffer: false, powerPreference: 'default' }}
    fallback={<div className="about__lens-fallback" data-lens-state="fallback" />}
  >
    <StudioLighting />
    <Suspense fallback={null}>
      <LensModel
        url={url}
        aperture={aperture}
        transition={transition}
        staticSnapshot={staticSnapshot}
        bakeStaticBezel={bakeStaticBezel}
        onSnapshot={staticSnapshot ? handleSnapshot : undefined}
        onSnapshotStart={staticSnapshot ? handleSnapshotStart : undefined}
      />
    </Suspense>
  </Canvas>
}
