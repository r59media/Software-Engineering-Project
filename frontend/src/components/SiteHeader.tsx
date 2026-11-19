import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { HeroDestinations } from '../types/hero'
import { footerSocialLinks } from '../config/footer'
import { usePublicProfile } from '../hooks/usePublicProfile'
import { ActionLink } from './ActionLink'
import instagram from '../assets/navigation/instagram.svg'
import threads from '../assets/navigation/threads.svg'
import x from '../assets/navigation/x.svg'
import closeIcon from '../assets/navigation/close.svg'
import menuIcon from '../assets/navigation/menu.svg'
import './SiteHeader.css'

const socialIcons: Record<string, string> = {
  instagram,
  threads,
  x,
  twitter: x,
}

function renderSocialIcon(platform: string) {
  const key = platform.trim().toLowerCase()
  if (key === 'facebook') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1v2.1H7.7v3h2.5V21h3.3Z" />
      </svg>
    )
  }
  if (key === 'pinterest') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12.2 3C7.4 3 4.5 6.3 4.5 9.8c0 1.6.9 3.6 2.3 4.2.2.1.4 0 .4-.2l.3-1.3c0-.1 0-.3-.1-.4-.5-.6-.9-1.5-.9-2.5 0-2.5 1.9-4.7 4.9-4.7 2.6 0 4.4 1.7 4.4 4.1 0 2.8-1.4 4.9-3.3 4.9-1 0-1.8-.9-1.6-2 .3-1.2.9-2.6.9-3.5 0-.8-.4-1.5-1.4-1.5-1.1 0-2 1.1-2 2.6 0 .9.3 1.6.3 1.6l-1.3 5.4c-.3 1.4 0 3.2 0 3.4 0 .1.2.2.3.1.1-.2 1.4-1.8 1.9-3.3l.7-2.6c.4.7 1.4 1.3 2.5 1.3 3.3 0 5.7-3 5.7-6.9C19.5 6 16.4 3 12.2 3Z" />
      </svg>
    )
  }
  const src = socialIcons[key] || instagram
  return <img src={src} alt="" />
}

function getSocialLinks(profileSocial: unknown): Array<{ platform: string; href: string }> {
  if (!profileSocial) return []
  if (Array.isArray(profileSocial)) {
    return profileSocial
      .map((item: unknown) => {
        if (!item || typeof item !== 'object') return null
        const p = 'platform' in item && typeof item.platform === 'string' ? item.platform.trim() : ''
        const h =
          'url' in item && typeof item.url === 'string'
            ? item.url.trim()
            : 'href' in item && typeof (item as { href?: unknown }).href === 'string'
            ? ((item as { href: string }).href).trim()
            : ''
        return p && h ? { platform: p, href: h } : null
      })
      .filter((x): x is { platform: string; href: string } => Boolean(x))
  }
  if (typeof profileSocial === 'object') {
    return Object.entries(profileSocial as Record<string, unknown>)
      .map(([platform, url]) => {
        const href = typeof url === 'string' ? url.trim() : ''
        return platform && href ? { platform, href } : null
      })
      .filter((x): x is { platform: string; href: string } => Boolean(x))
  }
  return []
}

export function SiteHeader({ destinations, homeHref = '#top' }: { destinations: HeroDestinations; homeHref?: string }) {
  const { profile, error } = usePublicProfile()
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
    const body = document.body
    const previousOverflow = body.style.overflow
    let restored = false
    unlock.current = () => {
      if (restored) return
      restored = true
      body.style.overflow = previousOverflow
    }
    body.style.overflow = 'hidden'
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

  const desktopLinks = [['About Me', destinations.about], ['Booking', destinations.booking],
    ['FAQ', destinations.faq], ['Get in touch', destinations.contact]] as const
  const mobileLinks = [['Home', homeHref, 'home'], ['About Me', destinations.about, 'about'],
    ['Portfolio', destinations.portfolio, 'portfolio'], ['Booking', destinations.booking, 'booking'],
    ['Get In Touch', destinations.contact, 'contact'], ['FAQ', destinations.faq, 'faq']] as const

  const resolvedSocials = useMemo(() => {
    if (!profile) {
      return error ? footerSocialLinks : []
    }
    return getSocialLinks(profile.social)
  }, [profile, error])

  return <>
    <header ref={header} className="site-header" data-hidden={hidden && !open} onFocusCapture={() => setHidden(false)}>
      <div className="site-header__bar">
        <ActionLink href={homeHref} className="site-header__brand" effect="brand-sweep"><img src={`${import.meta.env.BASE_URL}r59Media_logo.svg`} alt="R59 Media Home" width="81" height="50" /></ActionLink>
        <span className="site-header__divider" aria-hidden="true" />
        <nav className="site-header__desktop" aria-label="Main navigation">
          {desktopLinks.map(([label, href]) => <ActionLink key={label} href={href} className="site-header__link" effect="navigation-text">{label}</ActionLink>)}
          <ActionLink href={destinations.portfolio} className="action action--light site-header__cta" effect="portfolio-sweep">Go To Portfolio</ActionLink>
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
        <a href={homeHref} className="mobile-navigation__brand" aria-label="R59 Media Home" onClick={closeMenu} />
        <button ref={closeButton} type="button" className="mobile-navigation__close" aria-label="Close navigation menu" onClick={closeMenu}><img src={closeIcon} alt="" width="20" height="20" /></button>
        <nav aria-label="Mobile navigation" className="mobile-navigation__links">
          {mobileLinks.map(([label, href, key]) => <ActionLink key={key} href={href} className={`mobile-navigation__link mobile-navigation__link--${key}`} ariaCurrent={href && (key === 'home' ? currentSection === 'hero' : href === `#${currentSection}`) ? 'location' : undefined} pressKey={key} pressed={pressed === key} onNavigate={closeMenu}><span>{label}</span></ActionLink>)}
        </nav>
        <ActionLink href={destinations.booking} className="mobile-navigation__booking" pressKey="booking-cta" pressed={pressed === 'booking-cta'} onNavigate={closeMenu}><span>Book Your Session</span></ActionLink>
        {resolvedSocials.length > 0 && (
          <div className="mobile-navigation__connect">
            <h2>CONNECT</h2>
            <ul>{resolvedSocials.map(({ platform, href }) => (
                <li key={platform}>
                  {href && /^https:\/\//.test(href)
                    ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${platform} (opens in a new tab)`}>{renderSocialIcon(platform)}</a>
                    : <span role="link" aria-disabled="true" aria-label={`${platform} — link coming soon`} title="Link coming soon">{renderSocialIcon(platform)}</span>}
                </li>
            ))}</ul>
          </div>
        )}
        <div className="mobile-navigation__legal"><ActionLink href={`${import.meta.env.BASE_URL}terms-and-conditions`} onNavigate={closeMenu}>Terms and conditions</ActionLink><span aria-hidden="true">·</span><ActionLink href={`${import.meta.env.BASE_URL}privacy-policy`} onNavigate={closeMenu}>Privacy Policy</ActionLink></div>
      </div>
    </dialog>, document.body)}
  </>
}
