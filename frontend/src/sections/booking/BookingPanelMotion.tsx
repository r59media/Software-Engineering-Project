import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

export function BookingPanelMotion({ children, className, entersRightward }: { children: ReactNode; className: string; entersRightward: boolean }) {
  const reduced = useReducedMotion()
  const offset = reduced ? 0 : 48
  return <motion.div className={className} animate={{ x: 0, opacity: 1 }} variants={{
    enterPanels: { x: entersRightward ? -offset : offset },
    leave: (move: { direction: number; panelsOnly: boolean }) => ({ x: move.panelsOnly ? move.direction * offset : 0, opacity: move.panelsOnly ? 0 : 1 }),
  }} transition={{ duration: reduced ? 0 : .32, ease: [.22, 1, .36, 1] }}>{children}</motion.div>
}
