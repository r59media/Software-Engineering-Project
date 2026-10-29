import type { HeroSlide } from './hero'

/** Static footer image using the shared image presentation fields. */
export type FooterSlide = HeroSlide
export type FooterSocialPlatform = 'Instagram' | 'Threads' | 'X'
export interface FooterSocialLink {
  platform: FooterSocialPlatform
  href?: string
}
