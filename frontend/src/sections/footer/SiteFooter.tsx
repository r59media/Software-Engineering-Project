import { useMemo } from 'react'
import { footerContent, footerBackground, footerSocialLinks } from '../../config/footer'
import { heroDestinations } from '../../config/hero'
import { ActionLink } from '../../components/ActionLink'
import type { HeroDestinations } from '../../types/hero'
import type { FooterSlide, FooterSocialLink } from '../../types/footer'
import adminIcon from '../../assets/footer/admin.svg'
import cameraLogo from '../../assets/footer/camera-logo.svg'
import divider from '../../assets/footer/divider.svg'
import upArrow from '../../assets/footer/back-to-top.svg'
import instagram from '../../assets/footer/instagram.svg'
import threads from '../../assets/footer/threads.svg'
import x from '../../assets/footer/x.svg'
import { FooterBackground } from './FooterBackground'
import { usePublicProfile } from '../about/useAboutData'
import './SiteFooter.css'

function publicSocialUrl(href?: string) {
  if (!href) return
  try {
    const url = new URL(href)
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href
  } catch {
    /* Keep unconfigured or invalid links disabled. */
  }
}

function extractSocialUrl(profileSocial: unknown, platform: string): string | undefined {
  if (!profileSocial) return undefined
  if (Array.isArray(profileSocial)) {
    const item = profileSocial.find(
      (s: unknown) =>
        s &&
        typeof s === 'object' &&
        'platform' in s &&
        typeof s.platform === 'string' &&
        s.platform.trim().toLowerCase() === platform.toLowerCase()
    )
    if (item && typeof item === 'object') {
      const url = 'url' in item ? item.url : 'href' in item ? item.href : undefined
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url
    }
  } else if (typeof profileSocial === 'object') {
    const rec = profileSocial as Record<string, unknown>
    const matchKey = Object.keys(rec).find(k => k.toLowerCase() === platform.toLowerCase())
    if (matchKey && typeof rec[matchKey] === 'string' && /^https?:\/\//i.test(rec[matchKey] as string)) {
      return rec[matchKey] as string
    }
  }
  return undefined
}

const facebookIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
)

const pinterestIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z" />
  </svg>
)

function renderSocialIcon(platform: string) {
  if (platform === 'Instagram') return <img src={instagram} alt="" />
  if (platform === 'Threads') return <img src={threads} alt="" />
  if (platform === 'X') return <img src={x} alt="" />
  if (platform === 'Facebook') return facebookIcon
  if (platform === 'Pinterest') return pinterestIcon
  return null
}

interface SiteFooterProps {
  background?: FooterSlide
  destinations?: HeroDestinations
  socialLinks?: readonly FooterSocialLink[]
}

export function SiteFooter({
  background = footerBackground,
  destinations = heroDestinations,
  socialLinks = footerSocialLinks,
}: SiteFooterProps) {
  const { profile } = usePublicProfile()

  const liveEmail = profile?.email?.trim() || footerContent.email
  const livePhone = profile?.phone?.trim() || footerContent.phone

  const links = [
    ['About Me', destinations.about],
    ['Portfolio', destinations.portfolio],
    ['Booking', destinations.booking],
    ['FAQ', destinations.faq],
    ['Get In Touch', destinations.contact],
  ] as const

  const resolvedSocials = useMemo(() => {
    const standardPlatforms = ['Instagram', 'Threads', 'X', 'Facebook', 'Pinterest']

    return standardPlatforms
      .map(name => {
        const staticLink = socialLinks.find(s => s.platform.toLowerCase() === name.toLowerCase())
        const remoteUrl = extractSocialUrl(profile?.social, name)
        const href = remoteUrl || staticLink?.href
        return { platform: name, href }
      })
      .filter(item => {
        if (['Instagram', 'Threads', 'X'].includes(item.platform)) return true
        return Boolean(item.href)
      })
  }, [profile?.social, socialLinks])

  return (
    <footer id="footer" className="site-footer" aria-label="R59 Media footer">
      <FooterBackground slide={background} />
      <div className="site-footer__utility" data-footer-part="utility-links">
        <a
          href={footerContent.adminHref}
          className="site-footer__admin"
          aria-label="Admin sign in"
          title="Admin sign in"
        >
          <img src={adminIcon} alt="" width="44" height="37" />
        </a>
        <a href="#top" className="site-footer__top" aria-label="Back to top" title="Back to top">
          <img src={upArrow} alt="" width="59.4292" height="59.4292" />
        </a>
      </div>
      <div className="site-footer__content">
        <a
          href="#top"
          className="site-footer__brand"
          aria-label="R59 Media home"
          data-footer-part="logo"
        >
          <span className="site-footer__logo-camera" data-footer-motion="logo-camera">
            <img src={cameraLogo} alt="" width="110" height="96" />
          </span>
          <span className="site-footer__logo-divider" data-footer-motion="logo-divider" />
        </a>
        <p className="site-footer__name">{footerContent.photographer}</p>
        <img className="site-footer__rule" src={divider} alt="" width="712.003" height="1" />
        <nav
          aria-labelledby="footer-explore"
          className="site-footer__explore"
          data-footer-part="explore"
        >
          <h2 id="footer-explore">EXPLORE</h2>
          <div className="site-footer__links">
            {links.map(([label, href]) => (
              <ActionLink key={label} href={href} className="site-footer__link">
                {label}
              </ActionLink>
            ))}
          </div>
        </nav>
        <div className="site-footer__connect" data-footer-part="connect">
          <h2 id="footer-connect">CONNECT</h2>
          <div className="site-footer__contact" data-footer-part="contact">
            <div className="site-footer__contact-links">
              {liveEmail && (
                <a
                  href={`mailto:${liveEmail}`}
                  className="site-footer__contact-link"
                  aria-label={`Email ${liveEmail}`}
                >
                  {liveEmail}
                </a>
              )}
              {liveEmail && livePhone && (
                <span className="site-footer__contact-sep" aria-hidden="true">
                  ·
                </span>
              )}
              {livePhone && (
                <a
                  href={`tel:${livePhone.replace(/[^\d+]/g, '')}`}
                  className="site-footer__contact-link"
                  aria-label={`Call ${livePhone}`}
                >
                  {livePhone}
                </a>
              )}
            </div>
          </div>
          <ul className="site-footer__social" aria-labelledby="footer-connect">
            {resolvedSocials.map(({ platform, href }) => {
              const url = publicSocialUrl(href)
              const icon = renderSocialIcon(platform)
              return (
                <li key={platform}>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${platform} (opens in a new tab)`}
                    >
                      {icon}
                    </a>
                  ) : (
                    <span
                      role="link"
                      aria-disabled="true"
                      aria-label={`${platform} — link coming soon`}
                      title="Link coming soon"
                    >
                      {icon}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        <img className="site-footer__rule" src={divider} alt="" width="712.003" height="1" />
        <p className="site-footer__copyright">
          © {new Date().getFullYear()} {footerContent.brand}
        </p>
      </div>
    </footer>
  )
}
