import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import './PortfolioInterlude.css'

export function PortfolioInterlude() {
  const bandRef = useRef<HTMLElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: bandRef,
    offset: ['start 0.92', 'start 0.48'],
  })
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 165,
    damping: 25,
    mass: 0.34,
  })

  const y = useTransform(smoothProgress, [0, 1], [28, 0], { clamp: true })
  const opacity = useTransform(smoothProgress, [0, 0.8], [0, 1], { clamp: true })

  return (
    <aside ref={bandRef} className="portfolio-interlude" aria-label="R59 Media photography philosophy">
      <motion.p
        className="portfolio-interlude__headline"
        style={prefersReducedMotion ? undefined : { y, opacity }}
      >
        We don’t just capture how it looked, we hold onto how it felt.
      </motion.p>
    </aside>
  )
}
