import heroImage1 from '../assets/heroImages/heroImg1.webp'
import heroImage2 from '../assets/heroImages/heroImg2.webp'
import heroImage3 from '../assets/heroImages/heroImg3.webp'
import heroImage4 from '../assets/heroImages/heroImg4.webp'
import type { HeroDestinations, HeroSlide } from '../types/hero'

// Local presentation data -- The application can replace this with published API data
export const heroSlides: readonly HeroSlide[] = [
  { id: 'hero-1', imageUrl: heroImage1, alt: '', width: 1440, height: 528, objectPosition: '50% 50%', mobileObjectPosition: '68% 50%', hasEmbeddedOverlay: true },
  { id: 'hero-2', imageUrl: heroImage2, alt: '', width: 1440, height: 528, objectPosition: '50% 50%', mobileObjectPosition: '50% 50%', hasEmbeddedOverlay: true },
  { id: 'hero-3', imageUrl: heroImage3, alt: '', width: 1440, height: 528, objectPosition: '50% 50%', mobileObjectPosition: '50% 50%', hasEmbeddedOverlay: true },
  { id: 'hero-4', imageUrl: heroImage4, alt: '', width: 1440, height: 528, objectPosition: '50% 50%', mobileObjectPosition: '50% 50%', hasEmbeddedOverlay: true },
]

export const heroDestinations: HeroDestinations = {}
