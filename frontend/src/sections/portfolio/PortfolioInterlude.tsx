import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import './PortfolioInterlude.css'

const TABLET_LINES_QUERY = '(min-width: 640px)'
const MIN_LINE_WIDTH_PX = 48
const DEFAULT_HEADLINE = 'We don’t just capture how it looked, we hold onto how it felt.'

export interface PortfolioInterludeProps {
  headline?: string
}

/** Full-bleed yellow editorial interlude with responsive scroll-drawn side rules. */
export function PortfolioInterlude({ headline = DEFAULT_HEADLINE }: PortfolioInterludeProps) {
  const bandRef = useRef<HTMLElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const headlineRef = useRef<HTMLParagraphElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const [hasLineRoom, setHasLineRoom] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(TABLET_LINES_QUERY).matches : true,
  )

  useEffect(() => {
    const row = rowRef.current
    const text = headlineRef.current
    if (!row || !text || typeof window === 'undefined') return

    const tabletQuery = window.matchMedia(TABLET_LINES_QUERY)
    const evaluateRoom = () => {
      if (!tabletQuery.matches) {
        setHasLineRoom(false)
        return
      }
      const gap = parseFloat(getComputedStyle(row).columnGap || '0') || 0
      const sideSpace = (row.clientWidth - text.offsetWidth) / 2 - gap
      setHasLineRoom(sideSpace >= MIN_LINE_WIDTH_PX)
    }

    evaluateRoom()
    tabletQuery.addEventListener('change', evaluateRoom)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(evaluateRoom) : null
    observer?.observe(row)
    observer?.observe(text)

    return () => {
      tabletQuery.removeEventListener('change', evaluateRoom)
      observer?.disconnect()
    }
  }, [headline])

  const { scrollYProgress } = useScroll({
    target: bandRef,
    offset: ['start 0.94', 'start 0.46'],
  })
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 165,
    damping: 25,
    mass: 0.34,
  })

  const y = useTransform(smoothProgress, [0, 0.92], [28, 0], { clamp: true })
  const opacity = useTransform(smoothProgress, [0, 0.78], [0, 1], { clamp: true })
  const lineScaleX = useTransform(smoothProgress, [0.05, 1], [0.08, 1], { clamp: true })
  const lineOpacity = useTransform(smoothProgress, [0.02, 0.45], [0, 1], { clamp: true })
  const leftFadePos = useTransform(smoothProgress, [0.05, 1], ['96% 0%', '48% 0%'], { clamp: true })
  const rightFadePos = useTransform(smoothProgress, [0.05, 1], ['4% 0%', '52% 0%'], { clamp: true })

  return (
    <aside
      ref={bandRef}
      className="portfolio-interlude"
      data-has-lines={hasLineRoom ? 'true' : 'false'}
      aria-label="R59 Media photography philosophy"
    >
      <div ref={rowRef} className="portfolio-interlude__row">
        <span className="portfolio-interlude__line portfolio-interlude__line--left" aria-hidden="true">
          <motion.span
            className="portfolio-interlude__line-bar"
            style={
              prefersReducedMotion
                ? undefined
                : { scaleX: lineScaleX, opacity: lineOpacity, backgroundPosition: leftFadePos }
            }
          />
        </span>
        <motion.p
          ref={headlineRef}
          className="portfolio-interlude__headline"
          style={prefersReducedMotion ? undefined : { y, opacity }}
        >
          {headline}
        </motion.p>
        <span className="portfolio-interlude__line portfolio-interlude__line--right" aria-hidden="true">
          <motion.span
            className="portfolio-interlude__line-bar"
            style={
              prefersReducedMotion
                ? undefined
                : { scaleX: lineScaleX, opacity: lineOpacity, backgroundPosition: rightFadePos }
            }
          />
        </span>
      </div>
    </aside>
  )
}
