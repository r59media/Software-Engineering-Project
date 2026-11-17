import { Suspense, useLayoutEffect, useMemo } from 'react'
import { Canvas, useLoader, useThree } from '@react-three/fiber'
import { LinearFilter, LinearMipmapLinearFilter, Mesh, PMREMGenerator } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { LensTransitionController } from '../transition/LensTransitionContext'
import { aboutLens } from '../../config/aboutLens'

function StudioLighting() {
  const { gl, scene, invalidate } = useThree()
  useLayoutEffect(() => {
    let cleanup: (() => void) | undefined
    try {
      const generator = new PMREMGenerator(gl)
      const room = new RoomEnvironment()
      const environment = generator.fromScene(room, 0.04)
      const previous = scene.environment
      // Three.js owns this mutable scene; restore its environment on cleanup.
      // eslint-disable-next-line react-hooks/immutability
      scene.environment = environment.texture
      invalidate()
      room.dispose()
      generator.dispose()
      cleanup = () => { scene.environment = previous; environment.dispose() }
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

type LensProps = { url: string; aperture: number; transition?: LensTransitionController | null }

function configureLensLoader(loader: GLTFLoader) {
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

function LensModel({ url, aperture, transition }: LensProps) {
  const gltf = useLoader(GLTFLoader, url, configureLensLoader)
  // Clone the hierarchy so future aperture/transform changes do not mutate the loader cache.
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const { gl, invalidate } = useThree()

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
    const blades: { mesh: Mesh; rest: number; travel: number }[] = []
    model.traverse(object => {
      if (!(object instanceof Mesh) || !object.name.startsWith('IrisBlade_')) return
      const rest = typeof object.userData.irisRestAngle === 'number' ? object.userData.irisRestAngle : object.rotation.z
      const travel = typeof object.userData.irisTravelAngle === 'number' ? object.userData.irisTravelAngle : aboutLens.iris.travelAngle
      blades.push({ mesh: object, rest, travel })
    })
    const update = (value: number) => {
      const opening = Math.min(1, Math.max(0, value))
      for (const { mesh, rest, travel } of blades) mesh.rotation.z = rest + opening * travel
      invalidate()
    }
    update(aperture)
    transition?.ready()
    const unsubscribe = transition?.subscribe(update)
    return () => {
      unsubscribe?.()
      for (const { mesh, rest } of blades) mesh.rotation.z = rest
    }
  }, [model, aperture, invalidate, transition])
  return <primitive object={model} dispose={null} />
}

export default function LensScene({ url, aperture, transition }: LensProps) {
  return <Canvas
    className="about__lens-canvas"
    onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', () => transition?.fail(), { once: true }) }}
    frameloop="demand"
    resize={{ offsetSize: true }}
    camera={aboutLens.camera}
    dpr={aboutLens.pixelRatio}
    scene={{ environmentIntensity: 0.35 }}
    gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
    fallback={<div className="about__lens-fallback" data-lens-state="fallback" />}
  >
    <StudioLighting />
    <Suspense fallback={null}><LensModel url={url} aperture={aperture} transition={transition} /></Suspense>
  </Canvas>
}
