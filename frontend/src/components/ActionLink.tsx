import type { ReactNode } from 'react'

interface ActionLinkProps {
  children: ReactNode
  href?: string
  className?: string
  onNavigate?: () => void
  ariaCurrent?: 'location'
  pressKey?: string
  pressed?: boolean
}

export function ActionLink({ children, href, className, onNavigate, ariaCurrent, pressKey, pressed }: ActionLinkProps) {
  if (!href) {
    return <span role="link" aria-disabled="true" className={className} title="This section is not available yet">{children}</span>
  }
  return <a href={href} className={className} aria-current={ariaCurrent} data-press-key={pressKey} data-pressed={pressed || undefined} onClick={onNavigate}>{children}</a>
}
