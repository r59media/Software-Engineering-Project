export interface HeroSlide {
  id: string
  imageUrl: string
  alt: string
  width?: number
  height?: number
  objectPosition?: string
  mobileObjectPosition?: string
  /** Set false for unprocessed uploads that need the design's dark overlay. */
  hasEmbeddedOverlay?: boolean
}

/** Supply destinations when their sections exist; absent targets render disabled. */
export interface HeroDestinations {
  about?: string
  portfolio?: string
  booking?: string
  faq?: string
  contact?: string
  explore?: string
  discover?: string
}
