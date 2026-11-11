import { useSyncExternalStore } from 'react'
import { useReducedMotion } from 'motion/react'

const query = '(min-width: 768px)'
const subscribe = (callback: () => void) => {
  const media = window.matchMedia(query)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
export function useTicketMotion() {
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
  const reduced = useReducedMotion()
  return { shared: desktop && !reduced, reduced, transition: { duration: reduced ? 0 : .5, ease: [.22, 1, .36, 1] as [number, number, number, number] } }
}
