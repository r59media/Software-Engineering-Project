import type { PointerEvent } from 'react'

export function useTicketTilt(maxAngle = 8) {
  const tiltTicket = ({ currentTarget, pointerType, clientX, clientY }: PointerEvent<HTMLElement>) => {
    if (
      pointerType !== 'mouse' ||
      !window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches
    ) {
      return
    }

    const { left, top, width, height } = currentTarget.getBoundingClientRect()
    if (!width || !height) return
    const x = Math.max(-1, Math.min(1, ((clientX - left) / width) * 2 - 1))
    const y = Math.max(-1, Math.min(1, ((clientY - top) / height) * 2 - 1))
    const angle = Math.min(maxAngle, Math.hypot(x, y) * maxAngle)
    currentTarget.style.setProperty('--ticket-rotation', angle ? `${-y} ${x} 0 ${angle}deg` : 'none')
  }

  const resetTilt = ({ currentTarget }: PointerEvent<HTMLElement>) => {
    currentTarget.style.removeProperty('--ticket-rotation')
  }

  return { tiltTicket, resetTilt }
}
