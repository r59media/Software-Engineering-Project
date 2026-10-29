import { aboutLens } from '../../config/aboutLens'

/** Project the rigid leaf edges into the same coordinate space as the HTML reveal. */
export function irisOpening(opening: number, diameter: number, centerX: number, centerY: number) {
  const { pivotRadius, leafDepth, leafSlope, travelAngle, clearRadius, count } = aboutLens.iris
  const focal = 1 / (2 * Math.tan(aboutLens.camera.fov * Math.PI / 360))
  const project = (theta: number, localX: number) => {
    const angle = theta + opening * travelAngle
    const z = leafDepth + localX * leafSlope
    const factor = focal / (aboutLens.camera.position[2] - z)
    return {
      x: (pivotRadius * Math.cos(theta) + localX * Math.cos(angle)) * factor,
      y: (pivotRadius * Math.sin(theta) + localX * Math.sin(angle)) * factor,
    }
  }
  const edges = Array.from({ length: count }, (_, index) => {
    const theta = index * 2 * Math.PI / count
    const a = project(theta, 0)
    const b = project(theta, -0.04)
    let nx = b.y - a.y
    let ny = a.x - b.x
    let distance = nx * a.x + ny * a.y
    if (distance < 0) { nx = -nx; ny = -ny; distance = -distance }
    return { nx, ny, distance }
  })
  const points = Array.from({ length: 144 }, (_, index) => {
    const angle = index * 2 * Math.PI / 144
    const x = Math.cos(angle)
    const y = Math.sin(angle)
    let radius = clearRadius * focal / (aboutLens.camera.position[2] + 0.004)
    for (const edge of edges) {
      const denominator = edge.nx * x + edge.ny * y
      if (denominator > 1e-10) radius = Math.min(radius, edge.distance / denominator)
    }
    // A subpixel overlap avoids bright seams between WebGL and the HTML aperture.
    const pixels = Math.max(0, radius * diameter + (opening > 0 ? 0.6 : 0))
    return `${centerX + x * pixels}px ${centerY - y * pixels}px`
  })
  return `polygon(${points.join(',')})`
}
