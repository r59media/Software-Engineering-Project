import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useLoader, useThree } from '@react-three/fiber'
import { LinearFilter, LinearMipmapLinearFilter, Mesh, PMREMGenerator } from 'three'
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

type LensProps = {
  url: string
  aperture: number
  transition?: LensTransitionController | null
  staticSnapshot?: boolean
}

type LensModelProps = LensProps & {
  onSnapshot?: (dataUrl: string) => void
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

function LensModel({ url, aperture, transition, staticSnapshot, onSnapshot }: LensModelProps) {
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
    const blades: {
      mesh: Mesh
      rest: number
      travel: number
      restX: number
      restY: number
      hx: number
      hy: number
    }[] = []
    model.traverse(object => {
      if (!(object instanceof Mesh) || !object.name.startsWith('IrisBlade_')) return
      const rest = typeof object.userData.irisRestAngle === 'number' ? object.userData.irisRestAngle : object.rotation.z
      const travel = typeof object.userData.irisTravelAngle === 'number' ? object.userData.irisTravelAngle : aboutLens.iris.travelAngle
      const restX = object.position.x
      const restY = object.position.y
      const rawHinge = Array.isArray(object.userData.irisHinge) ? object.userData.irisHinge : null
      const hx = rawHinge && typeof rawHinge[0] === 'number' ? rawHinge[0] : restX
      const hy = rawHinge && typeof rawHinge[1] === 'number' ? rawHinge[1] : restY
      blades.push({ mesh: object, rest, travel, restX, restY, hx, hy })
    })
    let lastOpening = -1
    const update = (value: number) => {
      const opening = Math.min(1, Math.max(0, value))
      if (Math.abs(opening - lastOpening) < 0.0004) return
      lastOpening = opening
      for (const { mesh, rest, travel, restX, restY, hx, hy } of blades) {
        const delta = opening * travel
        const cos = Math.cos(delta)
        const sin = Math.sin(delta)
        const dx = restX - hx
        const dy = restY - hy
        mesh.position.x = hx + dx * cos - dy * sin
        mesh.position.y = hy + dx * sin + dy * cos
        mesh.rotation.z = rest + delta
      }
      invalidate()
    }
    update(aperture)
    transition?.ready()
    const unsubscribe = transition?.subscribe(update)
    return () => {
      unsubscribe?.()
      for (const { mesh, rest, restX, restY } of blades) {
        mesh.position.x = restX
        mesh.position.y = restY
        mesh.rotation.z = rest
      }
    }
  }, [model, aperture, invalidate, transition])

  useEffect(() => {
    if (!staticSnapshot || !onSnapshot) return
    let cancelled = false
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return
        gl.render(scene, camera)
        let dataUrl = gl.domElement.toDataURL('image/webp', 0.98)
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = gl.domElement.toDataURL('image/png')
        }
        if (dataUrl.startsWith('data:image/') && dataUrl.length > 2048) {
          onSnapshot(dataUrl)
        }
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [staticSnapshot, onSnapshot, gl, scene, camera, model, aperture])

  return <primitive object={model} dispose={null} />
}

const lensDpr: [number, number] = isWebKit ? [1, 1.5] : aboutLens.pixelRatio

export default function LensScene({ url, aperture, transition, staticSnapshot }: LensProps) {
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const intentionalUnmountRef = useRef(false)

  useEffect(() => () => {
    intentionalUnmountRef.current = true
  }, [])

  const handleSnapshot = useCallback((dataUrl: string) => {
    intentionalUnmountRef.current = true
    setSnapshotUrl(dataUrl)
  }, [])

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
    gl={{ alpha: true, antialias: true, powerPreference: 'default' }}
    fallback={<div className="about__lens-fallback" data-lens-state="fallback" />}
  >
    <StudioLighting />
    <Suspense fallback={null}>
      <LensModel
        url={url}
        aperture={aperture}
        transition={transition}
        staticSnapshot={staticSnapshot}
        onSnapshot={staticSnapshot ? handleSnapshot : undefined}
      />
    </Suspense>
  </Canvas>
}
