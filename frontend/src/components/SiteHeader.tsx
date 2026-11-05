import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HeroDestinations } from '../types/hero'
import { footerSocialLinks } from '../config/footer'
import { ActionLink } from './ActionLink'
import instagram from '../assets/navigation/instagram.svg'
import threads from '../assets/navigation/threads.svg'
import x from '../assets/navigation/x.svg'
import closeIcon from '../assets/navigation/close.svg'
import menuIcon from '../assets/navigation/menu.svg'
import './SiteHeader.css'

const socialIcons = { Instagram: instagram, Threads: threads, X: x }

export function SiteHeader({ destinations }: { destinations: HeroDestinations }) {
  const header = useRef<HTMLElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const unlock = useRef<() => void>(() => {})
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [currentSection, setCurrentSection] = useState<string | null>(null)
  const [pressed, setPressed] = useState<string | null>(null)
  const closeMenu = () => {
    setPressed(null)
    unlock.current()
    dialog.current?.close()
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    let previous = window.scrollY
    let accumulated = 0
    const onScroll = () => {
      // Modal scroll locks must not be interpreted as scrolling back to the top.
      if (document.body.style.position === 'fixed' || open) return
      const current = Math.max(0, window.scrollY)
      const delta = current - previous
      previous = current
      if (current < 80) { accumulated = 0; setHidden(false); return }
      if (header.current?.contains(document.activeElement) && document.activeElement?.matches(':focus-visible')) return
      if (Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0
      accumulated += delta
      if (Math.abs(accumulated) >= 16) { setHidden(accumulated > 0); accumulated = 0 }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !dialog.current) return
    const node = dialog.current
    const y = window.scrollY
    const body = document.body
    const saved = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow }
    let restored = false
    unlock.current = () => {
      if (restored) return
      restored = true
      Object.assign(body.style, saved)
      window.scrollTo({ top: y, behavior: 'instant' })
    }
    Object.assign(body.style, { position: 'fixed', top: `-${y}px`, width: '100%', overflow: 'hidden' })
    node.showModal()
    closeButton.current?.focus({ preventScroll: true })
    const desktop = matchMedia('(min-width: 851px)')
    const onResize = () => { if (desktop.matches) { unlock.current(); node.close(); setOpen(false) } }
    desktop.addEventListener('change', onResize)
    return () => { desktop.removeEventListener('change', onResize); unlock.current(); if (node.open) node.close() }
  }, [open])

  const openMenu = () => {
    setPressed(null)
    const sections = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    const section = sections.map(element => element.closest('section, footer')).find(Boolean)
    setCurrentSection(section?.id || null)
    setHidden(false)
    setOpen(true)
  }

  const desktopLinks = [['About Me', destinations.about], ['Portfolio', destinations.portfolio],
    ['FAQ', destinations.faq], ['Get in touch', destinations.contact]] as const
  const mobileLinks = [['Home', '#top', 'home'], ['About Me', destinations.about, 'about'],
    ['Portfolio', destinations.portfolio, 'portfolio'], ['Booking', destinations.booking, 'booking'],
    ['Get In Touch', destinations.contact, 'contact'], ['FAQ', destinations.faq, 'faq']] as const

  return <>
    <header ref={header} className="site-header" data-hidden={hidden && !open} onFocusCapture={() => setHidden(false)}>
      <div className="site-header__bar">
        <a href="#top" className="site-header__brand" aria-label="R59 Media Home"><img src={`${import.meta.env.BASE_URL}r59Media_logo.svg`} alt="" width="81" height="50" /></a>
        <span className="site-header__divider" aria-hidden="true" />
        <nav className="site-header__desktop" aria-label="Main navigation">
          {desktopLinks.map(([label, href]) => <ActionLink key={label} href={href} className="site-header__link">{label}</ActionLink>)}
          <ActionLink href={destinations.portfolio} className="action action--light site-header__cta">Go To Portfolio</ActionLink>
        </nav>
      </div>
      <button ref={trigger} className="site-header__toggle" type="button" aria-label="Open navigation menu" aria-haspopup="dialog" aria-expanded={open} aria-controls="mobile-navigation" onClick={openMenu}>
        <img src={menuIcon} alt="" width="24" height="24" />
      </button>
    </header>
    {createPortal(<dialog ref={dialog} id="mobile-navigation" className="mobile-navigation" aria-label="Navigation menu"
      onCancel={event => { event.preventDefault(); closeMenu() }} onClick={event => { if (event.target === event.currentTarget) closeMenu() }}>
      <div className="mobile-navigation__panel"
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return
          const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-press-key]')
          setPressed(link?.dataset.pressKey || null)
        }}
        onPointerUp={() => setPressed(null)} onPointerCancel={() => setPressed(null)}
        onLostPointerCapture={() => setPressed(null)} onPointerLeave={() => setPressed(null)}
        onPointerOut={event => {
          const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-press-key]')
          if (link && !(event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) setPressed(null)
        }}>
        <button type="button" className="mobile-navigation__dismiss" aria-label="Dismiss navigation menu" tabIndex={-1} onClick={closeMenu} />
        <div className="mobile-navigation__red" aria-hidden="true" />
        <div className="mobile-navigation__yellow" aria-hidden="true" />
        <a href="#top" className="mobile-navigation__brand" aria-label="R59 Media Home" onClick={closeMenu} />
        <button ref={closeButton} type="button" className="mobile-navigation__close" aria-label="Close navigation menu" onClick={closeMenu}><img src={closeIcon} alt="" width="20" height="20" /></button>
        <nav aria-label="Mobile navigation" className="mobile-navigation__links">
          {mobileLinks.map(([label, href, key]) => <ActionLink key={key} href={href} className={`mobile-navigation__link mobile-navigation__link--${key}`} ariaCurrent={href && (key === 'home' ? currentSection === 'hero' : href === `#${currentSection}`) ? 'location' : undefined} pressKey={key} pressed={pressed === key} onNavigate={closeMenu}><span>{label}</span></ActionLink>)}
        </nav>
        <ActionLink href={destinations.booking} className="mobile-navigation__booking" pressKey="booking-cta" pressed={pressed === 'booking-cta'} onNavigate={closeMenu}><span>Book Your Session</span></ActionLink>
        <div className="mobile-navigation__connect">
          <h2>CONNECT</h2>
          <ul>{footerSocialLinks.map(({ platform, href }) => <li key={platform}>
            {href && /^https:\/\//.test(href)
              ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${platform} (opens in a new tab)`}><img src={socialIcons[platform]} alt="" /></a>
              : <span role="link" aria-disabled="true" aria-label={`${platform} — link coming soon`} title="Link coming soon"><img src={socialIcons[platform]} alt="" /></span>}
          </li>)}</ul>
        </div>
        <div className="mobile-navigation__legal"><ActionLink>Terms and conditions</ActionLink><span aria-hidden="true">·</span><ActionLink>Privacy Policy</ActionLink></div>
      </div>
    </dialog>, document.body)}
  </>
}
