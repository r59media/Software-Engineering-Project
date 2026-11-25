import { useRef } from 'react'
import { useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { aboutDecorations } from '../../config/about'
import type { AboutImage } from '../../types/about'
import { AboutArtwork } from './AboutArtwork'

interface ScrollDecorationConfig {
  range: [number, number]
  x: number
  y: number
  rotate: number
}

const DECORATION_SCROLL_MOTION: Record<string, ScrollDecorationConfig> = {
  'top-lens': { range: [0.0, 0.42], x: -180, y: -320, rotate: -18 },
  'top-right-lens': { range: [0.09, 0.51], x: 380, y: -220, rotate: 20 },
  'left-flash': { range: [0.18, 0.6], x: -320, y: 110, rotate: -16 },
  'bottom-right-camera': { range: [0.27, 0.69], x: 420, y: 240, rotate: -14 },
  'left-memory-card': { range: [0.37, 0.78], x: -220, y: -60, rotate: -28 },
  'top-memory-card': { range: [0.47, 0.87], x: 150, y: -220, rotate: 24 },
  'bottom-memory-card': { range: [0.57, 0.98], x: 420, y: 90, rotate: 26 },
}

function ScrollDecoration({
  image,
  progress,
  config,
}: {
  image: AboutImage
  progress: MotionValue<number>
  config: ScrollDecorationConfig
}) {
  const x = useTransform(progress, config.range, [config.x, 0], { clamp: true })
  const y = useTransform(progress, config.range, [config.y, 0], { clamp: true })
  const rotate = useTransform(progress, config.range, [config.rotate, 0], { clamp: true })

  return <AboutArtwork image={image} motionStyle={{ x, y, rotate }} />
}

export function AboutDecorations() {
  const containerRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start 0.96', 'start 0.12'],
  })
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 220,
    damping: 30,
    mass: 0.3,
  })

  return (
    <div ref={containerRef} className="about__decorations" aria-hidden="true">
      {aboutDecorations.map((image) => {
        const config = DECORATION_SCROLL_MOTION[image.id]
        if (!config || prefersReducedMotion) {
          return <AboutArtwork key={image.id} image={image} />
        }
        return (
          <ScrollDecoration
            key={image.id}
            image={image}
            progress={smoothProgress}
            config={config}
          />
        )
      })}
    </div>
  )
}
