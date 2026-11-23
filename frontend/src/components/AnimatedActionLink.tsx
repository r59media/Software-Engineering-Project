import { useState } from 'react'
import type { ActionLinkProps } from './ActionLink'
import './AnimatedActionLink.css'

// Shared CTA effects; links retain their existing destinations and disabled state.
export function AnimatedActionLink({ children, href, className, onNavigate, ariaCurrent, pressKey, pressed, effect }: ActionLinkProps) {
  const [hovered, setHovered] = useState(false)
  const [held, setHeld] = useState(false)
  const active = Boolean(href) && (hovered || (held && effect !== 'brand-sweep'))
  const sharedProps = {
    role: href ? undefined : ('link' as const),
    tabIndex: href ? undefined : -1,
    'aria-disabled': href ? undefined : true,
    title: href ? undefined : 'This section is not available yet',
    className: `${className ?? ''} animated-action animated-action--${effect}`,
    'aria-current': ariaCurrent,
    'data-press-key': pressKey,
    'data-pressed': (Boolean(href) && (held || pressed)) || undefined,
    'data-held': held ? 'true' : undefined,
    'data-active': active || undefined,
    onClick: href ? onNavigate : undefined,
    onPointerEnter: () => {
      if (href && window.matchMedia('(hover: hover) and (pointer: fine)').matches) setHovered(true)
    },
    onPointerLeave: () => {
      setHovered(false)
      setHeld(false)
    },
    onPointerDown: () => {
      if (href) setHeld(true)
    },
    onPointerUp: () => setHeld(false),
    onPointerCancel: () => setHeld(false),
    onBlur: () => {
      setHeld(false)
      setHovered(false)
    },
  }

  const content = (
    <>
      {effect !== 'red-text' && effect !== 'navigation-text' && (
        <span aria-hidden="true" className="animated-action__fill" />
      )}
      <span className="animated-action__label">
        {effect === 'navigation-text' && <span className="animated-action__width" aria-hidden="true">{children}</span>}
        <span>{children}</span>
      </span>
    </>
  )

  return href ? (
    <a href={href} {...sharedProps}>{content}</a>
  ) : (
    <span {...sharedProps}>{content}</span>
  )
}
