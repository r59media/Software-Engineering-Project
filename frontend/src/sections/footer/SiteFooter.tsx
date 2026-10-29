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
import './SiteFooter.css'

const socialIcons = { Instagram: instagram, Threads: threads, X: x }

function publicSocialUrl(href?: string) {
  if (!href) return
  try {
    const url = new URL(href)
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href
  } catch { /* Keep unconfigured or invalid links disabled. */ }
}

interface SiteFooterProps {
  background?: FooterSlide
  destinations?: HeroDestinations
  socialLinks?: readonly FooterSocialLink[]
}

/** Static footer; background changes are made in configuration, not the admin. */
export function SiteFooter({ background = footerBackground, destinations = heroDestinations,
  socialLinks = footerSocialLinks }: SiteFooterProps) {
  const links = [ ['About Me', destinations.about], ['Portfolio', destinations.portfolio],
    ['Booking', destinations.booking], ['FAQ', destinations.faq], ['Get In Touch', destinations.contact] ] as const
  return <footer id="footer" className="site-footer" aria-label="R59 Media footer">
    <FooterBackground slide={background} />
    <div className="site-footer__utility" data-footer-part="utility-links">
      <a href={footerContent.adminHref} className="site-footer__admin" aria-label="Admin sign in" title="Admin sign in">
        <img src={adminIcon} alt="" width="44" height="37" />
      </a>
      <a href="#top" className="site-footer__top" aria-label="Back to top" title="Back to top">
        <img src={upArrow} alt="" width="59.4292" height="59.4292" />
      </a>
    </div>
    <div className="site-footer__content">
      <a href="#top" className="site-footer__brand" aria-label="R59 Media home" data-footer-part="logo">
        <span className="site-footer__logo-camera" data-footer-motion="logo-camera"><img src={cameraLogo} alt="" width="110" height="96" /></span>
        <span className="site-footer__logo-divider" data-footer-motion="logo-divider" />
      </a>
      <p className="site-footer__name">{footerContent.photographer}</p>
      <img className="site-footer__rule" src={divider} alt="" width="712.003" height="1" />
      <nav aria-labelledby="footer-explore" className="site-footer__explore" data-footer-part="explore">
        <h2 id="footer-explore">EXPLORE</h2>
        <div className="site-footer__links">{links.map(([label, href]) =>
          <ActionLink key={label} href={href} className="site-footer__link">{label}</ActionLink>)}</div>
      </nav>
      <div className="site-footer__connect" data-footer-part="connect">
        <h2 id="footer-connect">CONNECT</h2>
        <ul className="site-footer__social" aria-labelledby="footer-connect">
          {socialLinks.map(({ platform, href }) => {
            const url = publicSocialUrl(href)
            const icon = <img src={socialIcons[platform]} alt="" />
            return <li key={platform}>{url
              ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${platform} (opens in a new tab)`}>{icon}</a>
              : <span role="link" aria-disabled="true" aria-label={`${platform} — link coming soon`} title="Link coming soon">{icon}</span>}</li>
          })}
        </ul>
      </div>
      <img className="site-footer__rule" src={divider} alt="" width="712.003" height="1" />
      <p className="site-footer__copyright">© {new Date().getFullYear()} {footerContent.brand}</p>
    </div>
  </footer>
}
