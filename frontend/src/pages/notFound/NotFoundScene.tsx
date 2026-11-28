import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createStudioLightControls, type StudioLightControls } from './studioLightControls'

interface NotFoundSceneProps {
  leftOn: boolean
  rightOn: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}

interface PullCord {
  side: 'left' | 'right'
  group: THREE.Group
  hitMesh: THREE.Mesh
  wireMaterial: THREE.MeshStandardMaterial
  pullMaterial: THREE.MeshStandardMaterial
  pullMesh: THREE.Mesh
  baseY: number
  tugStartedAt: number | null
}

const CORD_COLOR = 0xffcc22 // --color-brand-yellow
const CORD_LENGTH = 0.68
const TUG_DURATION_MS = 320

function createPullCord(
  side: 'left' | 'right',
  anchor: THREE.Vector3,
): PullCord {
  const group = new THREE.Group()
  group.name = `${side}PullCord`
  group.position.copy(anchor)

  const wireMaterial = new THREE.MeshStandardMaterial({
    color: CORD_COLOR,
    emissive: CORD_COLOR,
    emissiveIntensity: 0.35,
    roughness: 0.45,
    metalness: 0.05,
  })
  const wireGeometry = new THREE.CylinderGeometry(0.011, 0.011, CORD_LENGTH, 10)
  wireGeometry.translate(0, -CORD_LENGTH / 2, 0)
  const wireMesh = new THREE.Mesh(wireGeometry, wireMaterial)
  group.add(wireMesh)

  const pullMaterial = new THREE.MeshStandardMaterial({
    color: CORD_COLOR,
    emissive: CORD_COLOR,
    emissiveIntensity: 0.42,
    roughness: 0.35,
    metalness: 0.08,
  })
  const pullGeometry = new THREE.CapsuleGeometry(0.036, 0.095, 8, 16)
  pullGeometry.translate(0, -(CORD_LENGTH + 0.055), 0)
  const pullMesh = new THREE.Mesh(pullGeometry, pullMaterial)
  group.add(pullMesh)

  // Generous invisible collider so tapping or clicking the thin cord stays effortless.
  const hitGeometry = new THREE.CylinderGeometry(0.18, 0.18, CORD_LENGTH + 0.32, 8)
  hitGeometry.translate(0, -(CORD_LENGTH + 0.08) / 2, 0)
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const hitMesh = new THREE.Mesh(hitGeometry, hitMaterial)
  hitMesh.userData.cordSide = side
  group.add(hitMesh)

  return {
    side,
    group,
    hitMesh,
    wireMaterial,
    pullMaterial,
    pullMesh,
    baseY: anchor.y,
    tugStartedAt: null,
  }
}

function getCordAnchor(root: THREE.Object3D, side: 'left' | 'right'): THREE.Vector3 {
  const prefix = side === 'left' ? 'Left' : 'Right'
  const headMesh = root.getObjectByName(`${prefix}Head_Mesh`) ?? root.getObjectByName(`${prefix}HeadPivot`)
  const pivot = root.getObjectByName(`${prefix}HeadPivot`)
  if (!headMesh) {
    return new THREE.Vector3(side === 'left' ? -2.05 : 2.05, 1.9, 0.55)
  }

  const box = new THREE.Box3().setFromObject(headMesh)
  const width = box.max.x - box.min.x
  const height = box.max.y - box.min.y
  const anchorX = side === 'left' ? box.min.x + width * 0.26 : box.max.x - width * 0.26
  const anchorY = box.min.y + height * 0.58
  const anchorZ = (pivot?.position.z ?? box.max.z) + 0.03
  return new THREE.Vector3(anchorX, anchorY, anchorZ)
}

export function NotFoundScene({
  leftOn,
  rightOn,
  onToggleLeft,
  onToggleRight,
}: NotFoundSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<StudioLightControls | null>(null)
  const cordsRef = useRef<PullCord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [hoveredSide, setHoveredSide] = useState<'left' | 'right' | null>(null)
  const requestRenderRef = useRef<(() => void) | null>(null)
  const leftOnRef = useRef(leftOn)
  const rightOnRef = useRef(rightOn)
  const onToggleLeftRef = useRef(onToggleLeft)
  const onToggleRightRef = useRef(onToggleRight)
  const hoveredSideRef = useRef<'left' | 'right' | null>(null)
  const hasInteractedRef = useRef(false)
  const initialLightsRef = useRef({ left: leftOn, right: rightOn })

  useEffect(() => {
    leftOnRef.current = leftOn
    if (leftOn !== initialLightsRef.current.left) {
      hasInteractedRef.current = true
    }
  }, [leftOn])

  useEffect(() => {
    rightOnRef.current = rightOn
    if (rightOn !== initialLightsRef.current.right) {
      hasInteractedRef.current = true
    }
  }, [rightOn])

  useEffect(() => {
    onToggleLeftRef.current = onToggleLeft
  }, [onToggleLeft])

  useEffect(() => {
    onToggleRightRef.current = onToggleRight
  }, [onToggleRight])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let frameId: number | null = null
    let renderer: THREE.WebGLRenderer | null = null
    let scene: THREE.Scene | null = null
    let camera: THREE.OrthographicCamera | null = null
    let controls: StudioLightControls | null = null
    let observer: ResizeObserver | null = null
    let gltfModel: THREE.Group | null = null
    let cords: PullCord[] = []
    let cordHitMeshes: THREE.Mesh[] = []
    let shadowGroup: THREE.Group | null = null
    let leftShadowLight: THREE.DirectionalLight | null = null
    let rightShadowLight: THREE.DirectionalLight | null = null
    let hintStartMs: number | null = null
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    const render = (timestamp: number) => {
      frameId = null
      if (disposed || !renderer || !scene || !camera) return
      let changing = controls?.update(timestamp) ?? false
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      for (const cord of cords) {
        let hintLift = 0
        if (cord.tugStartedAt !== null) {
          const progress = Math.min(1, (timestamp - cord.tugStartedAt) / TUG_DURATION_MS)
          // Quick downward pull followed by an elastic return to rest.
          const offset = Math.sin(progress * Math.PI) * -0.14
          cord.group.position.y = cord.baseY + offset
          if (progress >= 1) {
            cord.group.position.y = cord.baseY
            cord.tugStartedAt = null
          } else {
            changing = true
          }
        } else if (
          cord.side === 'right' &&
          !hasInteractedRef.current &&
          !rightOnRef.current &&
          !reducedMotion
        ) {
          // Subtle double-tug invitation on the unlit right cord until the user interacts.
          if (hintStartMs === null) hintStartMs = timestamp
          const elapsed = timestamp - hintStartMs - 600
          if (elapsed > 0) {
            const cycle = (elapsed % 2200) / 2200
            if (cycle < 0.38) {
              const t = cycle / 0.38
              const pulse = Math.pow(Math.sin(t * Math.PI * 2), 2) * (1 - t * 0.35)
              cord.group.position.y = cord.baseY - pulse * 0.11
              hintLift = pulse * 0.55
            } else {
              cord.group.position.y = cord.baseY
            }
          } else {
            cord.group.position.y = cord.baseY
          }
          changing = true
        } else {
          cord.group.position.y = cord.baseY
        }
        const lit = cord.side === 'left' ? leftOnRef.current : rightOnRef.current
        const hovered = hoveredSideRef.current === cord.side
        cord.wireMaterial.emissiveIntensity = (hovered ? 1.15 : lit ? 0.72 : 0.42) + hintLift * 0.65
        cord.pullMaterial.emissiveIntensity = (hovered ? 1.3 : lit ? 0.85 : 0.5) + hintLift
      }

      if (leftShadowLight) leftShadowLight.visible = leftOnRef.current
      if (rightShadowLight) rightShadowLight.visible = rightOnRef.current

      renderer.render(scene, camera)
      if (changing) {
        requestRender()
      }
    }

    const requestRender = () => {
      if (disposed) return
      if (frameId === null) {
        frameId = requestAnimationFrame(render)
      }
    }
    requestRenderRef.current = requestRender

    const resize = () => {
      if (disposed || !container || !renderer || !camera) return
      const width = container.clientWidth
      const height = container.clientHeight
      if (width === 0 || height === 0) return

      const aspect = width / height
      const spanY = Math.max(2.72, 4.9 / aspect)
      camera.top = spanY / 2
      camera.bottom = -spanY / 2
      camera.right = (spanY * aspect) / 2
      camera.left = (-spanY * aspect) / 2
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      requestRender()
    }

    const pickCord = (clientX: number, clientY: number): 'left' | 'right' | null => {
      if (!renderer || !camera || cordHitMeshes.length === 0) return null
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects(cordHitMeshes, false)
      if (hits.length === 0) return null
      const side = hits[0]?.object.userData.cordSide
      return side === 'left' || side === 'right' ? side : null
    }

    let pointerDownPos: { x: number; y: number } | null = null

    const handlePointerMove = (event: PointerEvent) => {
      const hit = pickCord(event.clientX, event.clientY)
      if (hoveredSideRef.current !== hit) {
        hoveredSideRef.current = hit
        setHoveredSide(hit)
        requestRender()
      }
    }

    const handlePointerLeave = () => {
      if (hoveredSideRef.current !== null) {
        hoveredSideRef.current = null
        setHoveredSide(null)
        requestRender()
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      pointerDownPos = { x: event.clientX, y: event.clientY }
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerDownPos) return
      const dx = event.clientX - pointerDownPos.x
      const dy = event.clientY - pointerDownPos.y
      pointerDownPos = null
      if (Math.hypot(dx, dy) > 16) return

      const hit = pickCord(event.clientX, event.clientY)
      if (!hit) return
      hasInteractedRef.current = true
      const targetCord = cords.find((cord) => cord.side === hit)
      if (targetCord && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        targetCord.tugStartedAt = performance.now()
      }
      if (hit === 'left') onToggleLeftRef.current()
      else onToggleRightRef.current()
      requestRender()
    }

    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setClearColor(0x000000, 0)
      renderer.toneMapping = THREE.AgXToneMapping
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMappingExposure = 1
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap

      const canvas = renderer.domElement
      canvas.className = 'not-found__canvas'
      canvas.addEventListener('pointermove', handlePointerMove)
      canvas.addEventListener('pointerleave', handlePointerLeave)
      canvas.addEventListener('pointerdown', handlePointerDown)
      canvas.addEventListener('pointerup', handlePointerUp)
      container.appendChild(canvas)

      scene = new THREE.Scene()
      camera = new THREE.OrthographicCamera(-3, 3, 2, -2, 0.01, 100)
      camera.position.set(0.4, 3, 7)
      camera.lookAt(0, 1.18, -0.15)

      scene.add(new THREE.HemisphereLight(0xf3f6ff, 0x293037, 0.7))
      const fill = new THREE.DirectionalLight(0xffffff, 1.0)
      fill.position.set(0, 4, 5)
      scene.add(fill)

      // Dedicated near-zero-intensity directional lights cast clean geometry shadows without narrow spotlight cone cutoffs.
      const configureShadowCaster = (x: number, targetX: number) => {
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.001)
        dirLight.position.set(x, 2.0, 0.85)
        dirLight.target.position.set(targetX, 0.95, -0.35)
        dirLight.castShadow = true
        dirLight.shadow.mapSize.set(1024, 1024)
        dirLight.shadow.camera.left = -3.0
        dirLight.shadow.camera.right = 3.0
        dirLight.shadow.camera.top = 2.4
        dirLight.shadow.camera.bottom = -2.0
        dirLight.shadow.camera.near = 0.4
        dirLight.shadow.camera.far = 9
        dirLight.shadow.bias = -0.0008
        dirLight.shadow.normalBias = 0.02
        dirLight.shadow.radius = 6
        scene?.add(dirLight)
        scene?.add(dirLight.target)
        return dirLight
      }

      leftShadowLight = configureShadowCaster(-1.85, 0.25)
      leftShadowLight.visible = leftOnRef.current
      rightShadowLight = configureShadowCaster(1.85, -0.25)
      rightShadowLight.visible = rightOnRef.current

      // Invisible floor and rear backdrop catch 3D shadows and fade cleanly before reaching canvas borders.
      shadowGroup = new THREE.Group()
      const shadowMaterial = new THREE.ShadowMaterial({
        color: 0x050505,
        opacity: 0.44,
        transparent: true,
        depthWrite: false,
      })
      shadowMaterial.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vShadowUv;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShadowUv = uv;')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vShadowUv;')
          .replace(
            'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
            'float edgeFade = smoothstep(1.0, 0.3, length((vShadowUv - vec2(0.5)) * 2.0));\n\tgl_FragColor = vec4( color, opacity * edgeFade * ( 1.0 - getShadowMask() ) );',
          )
      }

      const floorReceiver = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 4.4), shadowMaterial)
      floorReceiver.rotation.x = -Math.PI / 2
      floorReceiver.position.set(0, 0.004, -0.05)
      floorReceiver.receiveShadow = true
      floorReceiver.renderOrder = -1
      shadowGroup.add(floorReceiver)

      const wallReceiver = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 3.8), shadowMaterial)
      wallReceiver.position.set(0, 1.55, -0.68)
      wallReceiver.receiveShadow = true
      wallReceiver.renderOrder = -1
      shadowGroup.add(wallReceiver)
      scene.add(shadowGroup)

      observer = new ResizeObserver(resize)
      observer.observe(container)
      resize()

      const loader = new GLTFLoader()
      const modelUrl = `${import.meta.env.BASE_URL}models/R59MEDIA_404_Mobile.glb`

      loader.load(
        modelUrl,
        (gltf) => {
          if (disposed || !scene) return
          gltfModel = gltf.scene
          scene.add(gltf.scene)
          gltf.scene.updateMatrixWorld(true)

          // Only 404 lettering sits in front of the softboxes to cast a studio shadow onto the floor & backdrop.
          const textMeshRoot = gltf.scene.getObjectByName('404Text_Mesh')
          textMeshRoot?.traverse((node) => {
            const mesh = node as THREE.Mesh
            if (mesh.isMesh) {
              mesh.castShadow = true
            }
          })

          cords = [
            createPullCord('left', getCordAnchor(gltf.scene, 'left')),
            createPullCord('right', getCordAnchor(gltf.scene, 'right')),
          ]
          cordsRef.current = cords
          cordHitMeshes = cords.map((c) => c.hitMesh)
          cords.forEach((c) => scene?.add(c.group))

          try {
            controls = createStudioLightControls(gltf.scene)
            controlsRef.current = controls
            controls.set('left', leftOnRef.current, { immediate: true })
            controls.set('right', rightOnRef.current, { immediate: true })
          } catch (ctrlErr) {
            console.warn('Could not initialize light controls:', ctrlErr)
          }

          setLoaded(true)
          resize()
          requestRender()
        },
        undefined,
        (err) => {
          if (disposed) return
          console.error('Failed to load 404 studio model:', err)
          setFailed(true)
        }
      )
    } catch (e) {
      console.error('WebGL init failed:', e)
      queueMicrotask(() => {
        if (!disposed) setFailed(true)
      })
    }

    return () => {
      disposed = true
      requestRenderRef.current = null
      if (frameId !== null) cancelAnimationFrame(frameId)
      observer?.disconnect()
      controls?.dispose()
      controlsRef.current = null
      cordsRef.current = []

      for (const cord of cords) {
        cord.group.traverse((node) => {
          const mesh = node as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.geometry?.dispose()
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          materials.forEach((mat) => mat?.dispose())
        })
      }

      if (shadowGroup) {
        shadowGroup.traverse((node) => {
          const mesh = node as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.geometry?.dispose()
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          materials.forEach((mat) => mat?.dispose())
        })
      }

      if (gltfModel) {
        gltfModel.traverse((node) => {
          const mesh = node as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.geometry?.dispose()
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          materials.forEach((mat) => mat?.dispose())
        })
      }

      if (renderer?.domElement) {
        const canvas = renderer.domElement
        canvas.removeEventListener('pointermove', handlePointerMove)
        canvas.removeEventListener('pointerleave', handlePointerLeave)
        canvas.removeEventListener('pointerdown', handlePointerDown)
        canvas.removeEventListener('pointerup', handlePointerUp)
        if (canvas.parentNode === container) {
          container.removeChild(canvas)
        }
      }
      renderer?.dispose()
    }
  }, [])

  // Trigger tug animation & update studio light intensity when state changes (including keyboard toggles).
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const leftCord = cordsRef.current.find((c) => c.side === 'left')
    if (leftCord && leftCord.tugStartedAt === null && !reduced) {
      leftCord.tugStartedAt = performance.now()
    }
    controls.set('left', leftOn, { immediate: reduced })
    requestRenderRef.current?.()
  }, [leftOn])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rightCord = cordsRef.current.find((c) => c.side === 'right')
    if (rightCord && rightCord.tugStartedAt === null && !reduced) {
      rightCord.tugStartedAt = performance.now()
    }
    controls.set('right', rightOn, { immediate: reduced })
    requestRenderRef.current?.()
  }, [rightOn])

  return (
    <div
      ref={containerRef}
      className={`not-found__stage ${loaded ? 'not-found__stage--loaded' : ''} ${hoveredSide ? 'not-found__stage--cord-hover' : ''}`}
      data-hovered-cord={hoveredSide ?? ''}
      role="img"
      aria-label="3D photography studio scene with red 404 lettering between two softbox lights and interactive pull cords"
    >
      {!loaded && !failed && (
        <div className="not-found__stage-placeholder" aria-hidden="true">
          <p className="not-found__stage-loading">Setting up the studio…</p>
        </div>
      )}
      {failed && (
        <div className="not-found__stage-fallback">
          <img
            src={`${import.meta.env.BASE_URL}models/r59-404-preview.png`}
            alt="Red 404 in photo studio"
            className="not-found__preview-img not-found__preview-img--static"
          />
        </div>
      )}
    </div>
  )
}
