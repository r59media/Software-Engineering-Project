import type { ReactNode } from 'react'

interface ActionLinkProps {
  children: ReactNode
  href?: string
  className?: string
  onNavigate?: () => void
}

export function ActionLink({ children, href, className, onNavigate }: ActionLinkProps) {
  if (!href) {
    return <button type="button" className={className} disabled title="This section is not available yet">{children}</button>
  }
  return <a href={href} className={className} onClick={onNavigate}>{children}</a>
}
