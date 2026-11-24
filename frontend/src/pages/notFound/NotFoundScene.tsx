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

export function NotFoundScene({
  leftOn,
  rightOn,
  onToggleLeft: _onToggleLeft,
  onToggleRight: _onToggleRight,
}: NotFoundSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<StudioLightControls | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const requestRenderRef = useRef<(() => void) | null>(null)

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

    const render = (timestamp: number) => {
      frameId = null
      if (disposed || !renderer || !scene || !camera) return
      const changing = controls?.update(timestamp) ?? false
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
      const spanY = Math.max(3.2, 5.5 / aspect)
      camera.top = spanY / 2
      camera.bottom = -spanY / 2
      camera.right = (spanY * aspect) / 2
      camera.left = (-spanY * aspect) / 2
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      requestRender()
    }

    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setClearColor(0x000000, 0)
      renderer.toneMapping = THREE.AgXToneMapping
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMappingExposure = 1

      const canvas = renderer.domElement
      canvas.className = 'not-found__canvas'
      container.appendChild(canvas)

      scene = new THREE.Scene()
      camera = new THREE.OrthographicCamera(-3, 3, 2, -2, 0.01, 100)
      camera.position.set(0.4, 3, 7)
      camera.lookAt(0, 1.1, -0.15)

      scene.add(new THREE.HemisphereLight(0xf3f6ff, 0x293037, 0.7))
      const fill = new THREE.DirectionalLight(0xffffff, 1.0)
      fill.position.set(0, 4, 5)
      scene.add(fill)

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

          try {
            controls = createStudioLightControls(gltf.scene)
            controlsRef.current = controls
            controls.set('left', leftOn, { immediate: true })
            controls.set('right', rightOn, { immediate: true })
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
      setFailed(true)
    }

    return () => {
      disposed = true
      requestRenderRef.current = null
      if (frameId !== null) cancelAnimationFrame(frameId)
      observer?.disconnect()
      controls?.dispose()
      controlsRef.current = null

      if (gltfModel) {
        gltfModel.traverse((node) => {
          const mesh = node as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.geometry?.dispose()
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          materials.forEach((mat) => mat?.dispose())
        })
      }

      renderer?.dispose()
      if (renderer?.domElement && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  // Respond to light switch toggles
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    controls.set('left', leftOn, { immediate: reduced })
    requestRenderRef.current?.()
  }, [leftOn])

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    controls.set('right', rightOn, { immediate: reduced })
    requestRenderRef.current?.()
  }, [rightOn])

  return (
    <div
      ref={containerRef}
      className={`not-found__stage ${loaded ? 'not-found__stage--loaded' : ''}`}
      role="img"
      aria-label="3D photography studio scene with red 404 lettering between two softbox lights"
    >
      {!loaded && !failed && (
        <div className="not-found__stage-placeholder" aria-hidden="true">
          <img
            src={`${import.meta.env.BASE_URL}models/r59-404-preview.png`}
            alt=""
            className="not-found__preview-img"
          />
          <div className="not-found__stage-spinner">
            <span className="not-found__spinner-dot" />
            <span>Powering studio lights…</span>
          </div>
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
