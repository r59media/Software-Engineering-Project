import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Group, MathUtils } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { MutableRefObject } from 'react'

function configureCardLoader(loader: GLTFLoader) {
  loader.setMeshoptDecoder(MeshoptDecoder)
}

// eslint-disable-next-line react-refresh/only-export-components
export function preloadMemoryCardModel() {
  useLoader.preload(GLTFLoader, '/models/r59-memory-card.glb', configureCardLoader)
}

preloadMemoryCardModel()

export type CardMotion = { x: number; y: number }

type ModelProps = {
  target: MutableRefObject<CardMotion>
  automatic: boolean
  reduced: boolean
  active: boolean
  ready: () => void
  pokeRef?: MutableRefObject<(() => void) | null>
}

function Model({ target, automatic, reduced, active, ready, pokeRef }: ModelProps) {
  const gltf = useLoader(GLTFLoader, '/models/r59-memory-card.glb', configureCardLoader)
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  const invalidate = useThree(({ invalidate }) => invalidate)
  const group = useRef<Group>(null)
  const announced = useRef(false)

  useEffect(() => {
    if (!pokeRef) return
    pokeRef.current = invalidate
    return () => {
      if (pokeRef.current === invalidate) pokeRef.current = null
    }
  }, [pokeRef, invalidate])

  useEffect(() => {
    if (active) invalidate()
  }, [active, automatic, reduced, model, invalidate])

  useFrame((_, dt) => {
    if (!group.current) return
    if (!announced.current) {
      announced.current = true
      requestAnimationFrame(() => ready())
    }
    const step = Math.min(dt, .05)
    if (automatic && !reduced) {
      group.current.rotation.y += step * Math.PI / 6
    } else {
      const targetX = reduced ? -0.08 : target.current.x
      const targetY = reduced ? -0.28 : target.current.y
      group.current.rotation.x = MathUtils.damp(group.current.rotation.x, targetX, 7, step)
      group.current.rotation.y = MathUtils.damp(group.current.rotation.y, targetY, 7, step)
      if (!automatic && (Math.abs(group.current.rotation.x - targetX) > 0.0005 || Math.abs(group.current.rotation.y - targetY) > 0.0005)) {
        invalidate()
      }
    }
  })
  return <group ref={group} rotation={[-.08, -.28, -.04]}><group rotation={[Math.PI / 2, 0, 0]}><primitive object={model} dispose={null} /></group></group>
}

export default function MemoryCardScene({
  target,
  automatic,
  reduced,
  active,
  ready,
  fail,
  pokeRef,
}: {
  target: MutableRefObject<CardMotion>
  automatic: boolean
  reduced: boolean
  active: boolean
  ready: () => void
  fail: () => void
  pokeRef?: MutableRefObject<(() => void) | null>
}) {
  return <Canvas camera={{ position: [0, 0, 7], fov: 35 }} dpr={[1, 1.5]} frameloop={active ? (automatic ? 'always' : 'demand') : 'never'} gl={{ alpha: true, antialias: true }} onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', fail, { once: true }) }} fallback={null}>
    <ambientLight intensity={1.3} />
    <directionalLight position={[-3, 4, 5]} intensity={2} />
    <directionalLight position={[3, -2, -4]} intensity={1.2} />
    <Suspense fallback={null}><Model target={target} automatic={automatic} reduced={reduced} active={active} ready={ready} pokeRef={pokeRef} /></Suspense>
  </Canvas>
}
