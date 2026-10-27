import type { ReactNode } from 'react'

interface ActionLinkProps {
  children: ReactNode
  href?: string
  className?: string
  onNavigate?: () => void
}

export function ActionLink({ children, href, className, onNavigate }: ActionLinkProps) {
  if (!href) {
    return <span role="link" aria-disabled="true" className={className} title="This section is not available yet">{children}</span>
  }
  return <a href={href} className={className} onClick={onNavigate}>{children}</a>
}
