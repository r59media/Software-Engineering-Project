import { heroSlides } from './hero'
import type { FooterSlide, FooterSocialLink } from '../types/footer'

// Fixed local background; independent of the hero's published images.
export const footerBackground: FooterSlide = { ...heroSlides[0], id: 'footer-background' }

export const footerContent = {
  photographer: 'Kevin D Gonzalez',
  brand: 'R59 MEDIA',
  adminHref: '/admin/',
}

// Supply approved public profile URLs when available. Do not call authenticated admin APIs here.
export const footerSocialLinks: readonly FooterSocialLink[] = [
  { platform: 'Instagram' },
  { platform: 'Threads' },
  { platform: 'X' },
]
