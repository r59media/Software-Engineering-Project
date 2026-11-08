import { useState, useSyncExternalStore } from 'react'
import { motion } from 'motion/react'
import type { ActionLinkProps } from './ActionLink'
import './AnimatedActionLink.css'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotionQuery)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

// Shared CTA effects; links retain their existing destinations and disabled state.
export function AnimatedActionLink({ children, href, className, onNavigate, ariaCurrent, pressKey, pressed, effect }: ActionLinkProps) {
  const reduceMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false)
  const [hovered, setHovered] = useState(false)
  const [held, setHeld] = useState(false)
  const active = Boolean(href) && (hovered || held)
  const filled = effect !== 'red-text'
  const labelColor = effect === 'red-text'
    ? active ? 'var(--color-brand-red)' : 'var(--color-brand-white)'
    : effect === 'portfolio-sweep'
      ? active ? 'var(--color-brand-white)' : 'var(--color-brand-black)'
      : undefined
  const Component = href ? motion.a : motion.span
  const transition = { duration: reduceMotion ? 0 : 0.28, ease: [0.25, 0.1, 0.25, 1] as const }

  return (
    <Component
      href={href}
      role={href ? undefined : 'link'}
      tabIndex={href ? undefined : -1}
      aria-disabled={href ? undefined : true}
      title={href ? undefined : 'This section is not available yet'}
      className={`${className ?? ''} animated-action animated-action--${effect}`}
      aria-current={ariaCurrent}
      data-press-key={pressKey}
      data-pressed={(Boolean(href) && (held || pressed)) || undefined}
      data-active={active || undefined}
      onClick={href ? onNavigate : undefined}
      onHoverStart={() => {
        if (href && window.matchMedia('(hover: hover) and (pointer: fine)').matches) setHovered(true)
      }}
      onHoverEnd={() => setHovered(false)}
      onTapStart={() => { if (href) setHeld(true) }}
      onTap={() => setHeld(false)}
      onTapCancel={() => setHeld(false)}
      onBlur={() => { setHeld(false); setHovered(false) }}
    >
      {filled && <motion.span
        aria-hidden="true"
        className="animated-action__fill"
        initial={false}
        animate={{ scaleX: active ? 1 : 0 }}
        transition={held ? { duration: 0 } : transition}
      />}
      <motion.span
        className="animated-action__label"
        initial={false}
        animate={labelColor && href ? { color: labelColor } : undefined}
        transition={held ? { duration: 0 } : transition}
      >{children}</motion.span>
    </Component>
  )
}
