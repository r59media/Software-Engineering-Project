import type { ReactNode } from 'react'
import { AnimatedActionLink } from './AnimatedActionLink'

export interface ActionLinkProps {
  effect?: 'light-sweep' | 'red-text' | 'red-sweep' | 'portfolio-sweep' | 'brand-sweep' | 'navigation-text'
  children: ReactNode
  href?: string
  className?: string
  onNavigate?: () => void
  ariaCurrent?: 'location'
  pressKey?: string
  pressed?: boolean
}

export function ActionLink({ children, href, className, onNavigate, ariaCurrent, pressKey, pressed, effect }: ActionLinkProps) {
  if (effect) {
    return <AnimatedActionLink {...{ children, href, className, onNavigate, ariaCurrent, pressKey, pressed, effect }} />
  }
  if (!href) {
    return <span role="link" aria-disabled="true" className={className} title="This section is not available yet">{children}</span>
  }
  return <a href={href} className={className} aria-current={ariaCurrent} data-press-key={pressKey} data-pressed={pressed || undefined} onClick={onNavigate}>{children}</a>
}
