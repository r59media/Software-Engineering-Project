import { Suspense, useLayoutEffect, useMemo } from 'react'
import { Canvas, useLoader, useThree } from '@react-three/fiber'
import { Mesh, PMREMGenerator } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { aboutLens } from '../../config/aboutLens'

function StudioLighting() {
  const { gl, scene, invalidate } = useThree()
  useLayoutEffect(() => {
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
    return () => { scene.environment = previous; environment.dispose() }
  }, [gl, scene, invalidate])
  return <>
    <ambientLight intensity={0.2} />
    <directionalLight position={[-1, 2, 3]} intensity={1} />
    <directionalLight position={[2, -1, 2]} intensity={0.3} />
  </>
}

function LensModel({ url, aperture }: { url: string; aperture: number }) {
  const gltf = useLoader(GLTFLoader, url, loader => {
    loader.register(parser => ({
      name: 'R59LensMetadata',
      beforeRoot: async () => {
        // Three.js interprets extras.pivot as a numeric transform. These exports use prose.
        for (const node of parser.json.nodes ?? []) {
          if (typeof node.extras?.pivot === 'string') {
            node.extras.pivotDescription = node.extras.pivot
            delete node.extras.pivot
          }
        }
      },
    }))
  })
  // Clone the hierarchy so future aperture/transform changes do not mutate the loader cache.
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const invalidate = useThree(state => state.invalidate)
  useLayoutEffect(() => {
    model.traverse(object => {
      if (!(object instanceof Mesh)) return
      const index = object.morphTargetDictionary?.ApertureOpen
      if (index !== undefined && object.morphTargetInfluences) {
        object.morphTargetInfluences[index] = Math.min(1, Math.max(0, aperture))
      }
    })
    invalidate()
  }, [model, aperture, invalidate])
  return <primitive object={model} dispose={null} />
}

export default function LensScene({ url, aperture }: { url: string; aperture: number }) {
  return <Canvas
    className="about__lens-canvas"
    frameloop="demand"
    camera={aboutLens.camera}
    dpr={aboutLens.pixelRatio}
    scene={{ environmentIntensity: 0.35 }}
    gl={{ alpha: true, antialias: true }}
    fallback={<div className="about__lens-fallback" data-lens-state="fallback" />}
  >
    <StudioLighting />
    <Suspense fallback={null}><LensModel url={url} aperture={aperture} /></Suspense>
  </Canvas>
}
