import type { Color, Object3D, SpotLight, Mesh, Material } from 'three'

type DiffuserMaterial = Material & {
  emissiveIntensity?: number
  color?: Color
}

interface DiffuserMaterialEntry {
  material: DiffuserMaterial
  intensity: number
  baseColor?: Color
}

interface Fixture {
  light: SpotLight
  originalIntensity: number
  originalVisibility: boolean
  originals: Array<{ node: Mesh; material: Material | Material[] }>
  materials: DiffuserMaterialEntry[]
  current: number
  start: number
  target: number
  startedAt: number | null
}

export interface StudioLightControls {
  set(side: 'left' | 'right', enabled: boolean, options?: { immediate?: boolean }): boolean
  toggle(side: 'left' | 'right', options?: { immediate?: boolean }): boolean
  isOn(side: 'left' | 'right'): boolean
  update(timestamp: number): boolean
  dispose(): void
}

/** Independent light and diffuser control for the R59 MEDIA 404 GLBs. */
export function createStudioLightControls(model: Object3D): StudioLightControls {
  const fixtures = new Map<'left' | 'right', Fixture>()

  for (const side of ['Left', 'Right'] as const) {
    const lightNode = model.getObjectByName(`${side}Spot`)
    const diffuser = model.getObjectByName(`${side}Diffuser`)
    if (!lightNode || !diffuser) {
      throw new Error(`The model is missing the ${side.toLowerCase()} fixture`)
    }

    let light: SpotLight | undefined
    lightNode.traverse((node) => {
      if ((node as SpotLight).isSpotLight) light = node as SpotLight
    })
    if (!light) throw new Error(`${side}Spot does not contain a spot light`)

    const originals: Array<{ node: Mesh; material: Material | Material[] }> = []
    const materials: DiffuserMaterialEntry[] = []
    diffuser.traverse((node) => {
      const mesh = node as Mesh
      if (!mesh.isMesh) return
      const original = mesh.material
      const source = Array.isArray(original) ? original : [original]
      const copies = source.map((material) => {
        const copy = material.clone() as DiffuserMaterial
        materials.push({
          material: copy,
          intensity: copy.emissiveIntensity ?? 1,
          baseColor: copy.color?.clone(),
        })
        return copy
      })
      originals.push({ node: mesh, material: original })
      mesh.material = Array.isArray(original) ? copies : copies[0]
    })

    fixtures.set(side.toLowerCase() as 'left' | 'right', {
      light,
      originalIntensity: light.intensity,
      originalVisibility: light.visible,
      originals,
      materials,
      current: 1,
      start: 1,
      target: 1,
      startedAt: null,
    })
  }

  let disposed = false

  function getFixture(side: 'left' | 'right'): Fixture {
    if (disposed) throw new Error('The light controller has been disposed')
    const fixture = fixtures.get(side)
    if (!fixture) throw new TypeError('Choose left or right')
    return fixture
  }

  function apply(fixture: Fixture, strength: number) {
    fixture.current = strength
    fixture.light.intensity = fixture.originalIntensity * strength
    fixture.light.visible = fixture.originalVisibility && strength > 0
    for (const entry of fixture.materials) {
      entry.material.emissiveIntensity = entry.intensity * strength
      if (entry.material.color && entry.baseColor) {
        // Dim unlit diffuser cloth so an OFF lamp reads clearly against scene fill lights.
        entry.material.color.copy(entry.baseColor).multiplyScalar(0.2 + 0.8 * strength)
      }
    }
  }

  return {
    set(side: 'left' | 'right', enabled: boolean, { immediate = false } = {}) {
      const fixture = getFixture(side)
      fixture.start = fixture.current
      fixture.target = enabled ? 1 : 0
      fixture.startedAt = null
      if (immediate) apply(fixture, fixture.target)
      return enabled
    },

    toggle(side: 'left' | 'right', options?: { immediate?: boolean }) {
      const fixture = getFixture(side)
      return this.set(side, fixture.target === 0, options)
    },

    isOn(side: 'left' | 'right') {
      return getFixture(side).target === 1
    },

    update(timestamp: number) {
      if (disposed) return false
      if (!Number.isFinite(timestamp)) throw new TypeError('timestamp must be finite')
      let changing = false
      for (const fixture of fixtures.values()) {
        if (fixture.current === fixture.target) continue
        if (fixture.startedAt === null) fixture.startedAt = timestamp
        const progress = Math.min(1, Math.max(0, (timestamp - fixture.startedAt) / 180))
        const eased = 1 - Math.pow(1 - progress, 3)
        apply(fixture, fixture.start + (fixture.target - fixture.start) * eased)
        if (progress === 1) apply(fixture, fixture.target)
        else changing = true
      }
      return changing
    },

    dispose() {
      if (disposed) return
      for (const fixture of fixtures.values()) {
        fixture.light.intensity = fixture.originalIntensity
        fixture.light.visible = fixture.originalVisibility
        for (const entry of fixture.originals) entry.node.material = entry.material
        for (const entry of fixture.materials) entry.material.dispose()
      }
      disposed = true
    },
  }
}
