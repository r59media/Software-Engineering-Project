import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { Group, MathUtils } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { MutableRefObject } from 'react'

export type CardMotion = { x: number; y: number }
function Model({ target, automatic, reduced, ready }: { target: MutableRefObject<CardMotion>; automatic: boolean; reduced: boolean; ready: () => void }) {
  const gltf = useLoader(GLTFLoader, '/models/r59-memory-card.glb')
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const group = useRef<Group>(null)
  const announced = useRef(false)
  useFrame((_, dt) => {
    if (!group.current) return
    if (!announced.current) { announced.current = true; ready() }
    const step = Math.min(dt, .05)
    if (automatic && !reduced) group.current.rotation.y += step * Math.PI / 6
    else {
      group.current.rotation.x = MathUtils.damp(group.current.rotation.x, reduced ? -.08 : target.current.x, 7, step)
      group.current.rotation.y = MathUtils.damp(group.current.rotation.y, reduced ? -.28 : target.current.y, 7, step)
    }
  })
  return <group ref={group} rotation={[-.08, -.28, -.04]}><group rotation={[Math.PI / 2, 0, 0]}><primitive object={model} dispose={null} /></group></group>
}
export default function MemoryCardScene({ target, automatic, reduced, active, ready, fail }: { target: MutableRefObject<CardMotion>; automatic: boolean; reduced: boolean; active: boolean; ready: () => void; fail: () => void }) {
  return <Canvas camera={{ position: [0, 0, 7], fov: 35 }} dpr={[1, 1.5]} frameloop={active ? 'always' : 'never'} gl={{ alpha: true, antialias: true }} onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', fail, { once: true }) }} fallback={null}>
    <ambientLight intensity={1.3} />
    <directionalLight position={[-3, 4, 5]} intensity={2} />
    <directionalLight position={[3, -2, -4]} intensity={1.2} />
    <Suspense fallback={null}><Model target={target} automatic={automatic} reduced={reduced} ready={ready} /></Suspense>
  </Canvas>
}
