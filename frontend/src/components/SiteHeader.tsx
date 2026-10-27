import { useEffect, useRef } from 'react'
import type { HeroDestinations } from '../types/hero'
import { ActionLink } from './ActionLink'
import './SiteHeader.css'

export function SiteHeader({ destinations }: { destinations: HeroDestinations }) {
  const menu = useRef<HTMLDetailsElement>(null)
  const closeMenu = () => { if (menu.current) menu.current.open = false }
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) {
        closeMenu()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        closeMenu()
        menu.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])
  const links = [
    ['About Me', destinations.about], ['Portfolio', destinations.portfolio],
    ['Booking', destinations.booking], ['FAQ', destinations.faq],
    ['Get In Touch', destinations.contact],
  ] as const
  const navigation = <>
    {links.map(([label, href]) => <ActionLink key={label} href={href} className="site-header__link" onNavigate={closeMenu}>{label}</ActionLink>)}
    <ActionLink href={destinations.booking} className="action action--light site-header__booking" onNavigate={closeMenu}>Book Your Session</ActionLink>
  </>
  return <header className="site-header">
    <div className="site-header__bar">
      <a href="#hero" className="site-header__brand" aria-label="R59 Media Home"><img src={`${import.meta.env.BASE_URL}r59Media_logo.svg`} alt="R59 Media" width="81" height="50" /></a>
      <span className="site-header__divider" aria-hidden="true" />
      <nav className="site-header__desktop" aria-label="Main navigation">{navigation}</nav>
      <details className="site-header__mobile site-header__menu" ref={menu}>
        <summary aria-label="Toggle navigation menu"><span className="site-header__menu-icon" aria-hidden="true"><span /><span /><span /></span><span>Menu</span></summary>
        <nav className="site-header__mobile-links" aria-label="Mobile navigation">{navigation}</nav>
      </details>
    </div>
  </header>
}
