export interface BookingService {
  id: string
  name: string
  description: string
  bestFor: string
  image?: { url: string; alt: string }
  durationMinutes: number | null
  photoCount?: number
  outfits?: number
  priceMinor: number | null
  currency: string
  bookingMode: 'direct' | 'inquiry'
  additionalPeople?: { maxPeople?: number; includedPeople: number; extraPersonPriceMinor?: number }
}

export interface ServiceSelection {
  serviceId: string
  people: number
}

export interface BookingServicesProps {
  services?: readonly BookingService[]
  status?: 'ready' | 'loading' | 'error'
  onRetry?: () => void
  onContinue?: (selection: ServiceSelection) => void
  onSelectionChange?: (selection: ServiceSelection | null) => void
  inquiryHref?: string
}
