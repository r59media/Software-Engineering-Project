import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { Group, MathUtils } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { MutableRefObject } from 'react'
import { getGpuProfile } from '../../utils/gpuProfile'

function configureCardLoader(loader: GLTFLoader) {
  loader.setMeshoptDecoder(MeshoptDecoder)
}

export type CardMotion = { x: number; y: number }
function Model({ target, automatic, reduced, targetFps, ready }: { target: MutableRefObject<CardMotion>; automatic: boolean; reduced: boolean; targetFps: 30 | 60; ready: () => void }) {
  const gltf = useLoader(GLTFLoader, '/models/r59-memory-card.glb', configureCardLoader)
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const group = useRef<Group>(null)
  const announced = useRef(false)
  const elapsedRef = useRef(0)
  useFrame((_, dt) => {
    if (!group.current) return
    if (!announced.current) { announced.current = true; ready() }
    let elapsed = dt
    if (targetFps === 30) {
      elapsedRef.current += dt
      if (elapsedRef.current < 1 / 32) return
      elapsed = elapsedRef.current
      elapsedRef.current = 0
    }
    const step = Math.min(elapsed, .05)
    if (automatic && !reduced) group.current.rotation.y += step * Math.PI / 6
    else {
      group.current.rotation.x = MathUtils.damp(group.current.rotation.x, reduced ? -.08 : target.current.x, 7, step)
      group.current.rotation.y = MathUtils.damp(group.current.rotation.y, reduced ? -.28 : target.current.y, 7, step)
    }
  })
  return <group ref={group} rotation={[-.08, -.28, -.04]}><group rotation={[Math.PI / 2, 0, 0]}><primitive object={model} dispose={null} /></group></group>
}
export default function MemoryCardScene({ target, automatic, reduced, active, ready, fail }: { target: MutableRefObject<CardMotion>; automatic: boolean; reduced: boolean; active: boolean; ready: () => void; fail: () => void }) {
  const gpu = useMemo(() => getGpuProfile(), [])

  if (gpu.memoryCard.disabled) {
    return <div aria-hidden="true" />
  }

  return <Canvas
    camera={{ position: [0, 0, 7], fov: 35 }}
    dpr={[1, gpu.memoryCard.maxDpr]}
    frameloop={active ? 'always' : 'never'}
    gl={{
      alpha: true,
      antialias: gpu.memoryCard.antialias,
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
      precision: gpu.memoryCard.precision,
      powerPreference: gpu.memoryCard.powerPreference,
    }}
    onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', fail, { once: true }) }}
    fallback={null}
  >
    <ambientLight intensity={1.3} />
    <directionalLight position={[-3, 4, 5]} intensity={2} />
    <directionalLight position={[3, -2, -4]} intensity={1.2} />
    <Suspense fallback={null}><Model target={target} automatic={automatic} reduced={reduced} targetFps={gpu.memoryCard.targetFps} ready={ready} /></Suspense>
  </Canvas>
}
