import { useCallback, useEffect, useRef } from 'react'
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'

interface Particle {
  sx: number
  sy: number
  tx: number
  ty: number
  radius: number
  delay: number
  accent: 'white' | 'yellow' | 'red'
}

interface PortfolioParticleTitleProps {
  id?: string
  text: string
  className?: string
}

const BLEED_X = 48
const BLEED_Y = 44

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function collectWordSegments(heading: HTMLElement): Array<{ text: string; x: number; y: number; height: number }> {
  const textNode = Array.from(heading.childNodes).find((n): n is Text => n.nodeType === Node.TEXT_NODE)
  if (!textNode || !textNode.textContent) return []

  const content = textNode.textContent
  const baseRect = heading.getBoundingClientRect()
  const segments: Array<{ text: string; x: number; y: number; height: number }> = []
  const range = document.createRange()

  const wordRegex = /\S+/g
  let match: RegExpExecArray | null = wordRegex.exec(content)
  while (match !== null) {
    range.setStart(textNode, match.index)
    range.setEnd(textNode, match.index + match[0].length)
    const rect = range.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      segments.push({
        text: match[0],
        x: rect.left - baseRect.left,
        y: rect.top - baseRect.top,
        height: rect.height,
      })
    }
    match = wordRegex.exec(content)
  }

  return segments
}

function sampleHeadingParticles(heading: HTMLElement): {
  width: number
  height: number
  particles: Particle[]
} {
  const rect = heading.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)
  if (width < 2 || height < 2) {
    return { width: 0, height: 0, particles: [] }
  }

  const canvasW = width + BLEED_X * 2
  const canvasH = height + BLEED_Y * 2
  const style = window.getComputedStyle(heading)
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = canvasW
  sampleCanvas.height = canvasH
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { width, height, particles: [] }

  ctx.clearRect(0, 0, canvasW, canvasH)
  ctx.fillStyle = '#f0f0f0'
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  ctx.textBaseline = 'alphabetic'
  if ('letterSpacing' in ctx && style.letterSpacing && style.letterSpacing !== 'normal') {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = style.letterSpacing
  }

  const fontSizePx = Number.parseFloat(style.fontSize) || height
  const sampleMetrics = ctx.measureText('H')
  const fontAscent = sampleMetrics.fontBoundingBoxAscent || fontSizePx * 0.82
  const fontDescent = sampleMetrics.fontBoundingBoxDescent || fontSizePx * 0.22
  const fontTotalHeight = fontAscent + fontDescent

  const upper = style.textTransform === 'uppercase'
  const words = collectWordSegments(heading)
  if (words.length > 0) {
    for (const word of words) {
      const value = upper ? word.text.toUpperCase() : word.text
      const halfLeading = (word.height - fontTotalHeight) / 2
      const baselineY = word.y + halfLeading + fontAscent + BLEED_Y
      ctx.fillText(value, word.x + BLEED_X, baselineY)
    }
  } else {
    const fallbackText = upper ? (heading.textContent ?? '').toUpperCase() : (heading.textContent ?? '')
    const halfLeading = (height - fontTotalHeight) / 2
    ctx.fillText(fallbackText, BLEED_X, halfLeading + fontAscent + BLEED_Y)
  }

  const pixels = ctx.getImageData(0, 0, canvasW, canvasH).data
  const step = Math.max(3, Math.min(4, Math.round(fontSizePx / 22)))
  const particles: Particle[] = []
  let seed = 1

  for (let py = 0; py < canvasH; py += step) {
    for (let px = 0; px < canvasW; px += step) {
      const alpha = pixels[(py * canvasW + px) * 4 + 3]
      if (alpha < 120) continue

      seed += 1
      const r1 = pseudoRandom(seed)
      const r2 = pseudoRandom(seed + 101)
      const r3 = pseudoRandom(seed + 307)
      const r4 = pseudoRandom(seed + 613)
      const r5 = pseudoRandom(seed + 919)

      const jitterX = (r3 - 0.5) * step * 0.7
      const jitterY = (r5 - 0.5) * step * 0.7
      const tx = px + jitterX
      const ty = py + jitterY

      const angle = r1 * Math.PI * 2
      const spread = 24 + r2 * 56
      const sx = tx + Math.cos(angle) * spread * 0.72 + (r3 - 0.5) * 18
      const sy = ty + Math.sin(angle) * spread * 0.45 + (14 + r2 * 36)

      const normalizedX = Math.max(0, Math.min(1, (px - BLEED_X) / Math.max(1, width)))
      const delay = normalizedX * 0.16 + r4 * 0.09
      const accent: Particle['accent'] = r4 > 0.94 ? 'red' : r4 > 0.82 ? 'yellow' : 'white'
      particles.push({
        sx,
        sy,
        tx,
        ty,
        radius: 1.05 + r3 * 1.1,
        delay,
        accent,
      })
    }
  }

  return { width, height, particles }
}

export function PortfolioParticleTitle({
  id = 'portfolio-heading',
  text,
  className = 'portfolio-gallery__title',
}: PortfolioParticleTitleProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sampleRef = useRef<{ width: number; height: number; particles: Particle[] }>({
    width: 0,
    height: 0,
    particles: [],
  })

  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: stageRef,
    offset: ['start 0.9', 'start 0.44'],
  })
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 150,
    damping: 25,
    mass: 0.34,
  })
  const headingOpacity = useTransform(smoothProgress, [0.58, 0.94], [0, 1], { clamp: true })

  const drawParticles = useCallback(
    (rawProgress: number) => {
      const canvas = canvasRef.current
      const { width, height, particles } = sampleRef.current
      if (!canvas || !width || !height || particles.length === 0 || prefersReducedMotion) {
        return
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const targetW = Math.ceil((width + BLEED_X * 2) * dpr)
      const targetH = Math.ceil((height + BLEED_Y * 2) * dpr)
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW
        canvas.height = targetH
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width + BLEED_X * 2, height + BLEED_Y * 2)

      const p = Math.max(0, Math.min(1, rawProgress))
      if (p <= 0.002) return

      const envelopeIn = Math.min(1, p / 0.14)
      const envelopeOut = p <= 0.68 ? 1 : Math.max(0, 1 - (p - 0.68) / 0.3)
      const globalAlpha = envelopeIn * envelopeOut
      if (globalAlpha <= 0.002) return

      for (const particle of particles) {
        const localT = Math.max(0, Math.min(1, (p - particle.delay) / Math.max(0.22, 0.78 - particle.delay)))
        const eased = easeOutCubic(localT)
        const x = particle.sx + (particle.tx - particle.sx) * eased
        const y = particle.sy + (particle.ty - particle.sy) * eased
        const r = particle.radius * (1.22 - 0.34 * eased)

        // Blend subtle signature yellow/red scatter shimmer into crisp brand white on arrival
        let fill = `rgba(240, 240, 240, ${globalAlpha.toFixed(3)})`
        if (particle.accent === 'yellow' && eased < 0.85) {
          fill = `rgba(255, 204, 34, ${(globalAlpha * (1 - eased * 0.55)).toFixed(3)})`
        } else if (particle.accent === 'red' && eased < 0.85) {
          fill = `rgba(255, 34, 34, ${(globalAlpha * (1 - eased * 0.55)).toFixed(3)})`
        }

        ctx.fillStyle = fill
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    },
    [prefersReducedMotion],
  )

  useEffect(() => {
    const heading = headingRef.current
    if (!heading || prefersReducedMotion) return

    let disposed = false
    const rebuild = () => {
      if (disposed || !headingRef.current) return
      sampleRef.current = sampleHeadingParticles(headingRef.current)
      drawParticles(smoothProgress.get())
    }

    if (document.fonts?.ready) {
      void document.fonts.ready.then(rebuild)
    }
    rebuild()

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(rebuild) : null
    observer?.observe(heading)

    return () => {
      disposed = true
      observer?.disconnect()
    }
  }, [drawParticles, prefersReducedMotion, smoothProgress, text])

  useMotionValueEvent(smoothProgress, 'change', (latest) => {
    drawParticles(latest)
  })

  return (
    <div ref={stageRef} className="portfolio-gallery__title-stage">
      <motion.h2
        ref={headingRef}
        id={id}
        className={className}
        style={prefersReducedMotion ? undefined : { opacity: headingOpacity }}
      >
        {text}
      </motion.h2>
      {!prefersReducedMotion && (
        <canvas
          ref={canvasRef}
          className="portfolio-gallery__title-canvas"
          aria-hidden="true"
        />
      )}
    </div>
  )
}
