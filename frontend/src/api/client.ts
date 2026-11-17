import type { HeroSlide } from '../types/hero'
import type { PhotoshootPhoto } from '../types/recentPhotoshoot'
import type { BookingService, SquareConfig } from '../types/booking'

/** Which part of the site a portfolio photo is shown in (matches the admin "Photos" tabs). */
export type PortfolioSection = 'recent' | 'gallery' | 'about' | 'hero'

export interface PortfolioImageRecord {
  id: number
  section?: PortfolioSection
  category?: string
  title?: string | null
  media_key?: string
  url?: string
  public_url?: string
  is_featured?: number | boolean
  alt_text?: string | null
  display_order?: number
  is_active?: number
}

export type PortfolioApiItem = PortfolioImageRecord

export interface ServicePackageItem {
  id: number
  name?: string
  title: string
  description?: string | null
  price: number
  price_cents?: number
  duration_minutes?: number
  category?: string | null
  is_active?: number
}

export interface ScheduleSlotItem {
  id: number
  date: string
  start_time: string
  end_time: string
  is_booked: number
}

export interface ContactLeadPayload {
  name: string
  email: string
  phone?: string
  message: string
  session_type?: string
}

export interface CheckoutPayload {
  sourceId: string
  idempotencyKey: string
  service_id: number
  slot_id: number
  customer_name: string
  customer_email: string
  customer_phone?: string
  notes?: string
  attendees?: number
  coupon_code?: string
  photoPermissions?: {
    websitePortfolio?: boolean
    socialMedia?: boolean
  }
}

export interface ApiResponse<T = unknown> {
  status: 'success' | 'error'
  retryAfterSeconds?: number
  data?: T
  message?: string
  code?: string
  id?: number
  booking_id?: number
  payment_id?: string
  order_id?: string
}

const API_BASE = '/api'

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as Record<string, unknown>
    if (json.status === 'error') {
      return null
    }
    if (json.status === 'success' && json.data !== undefined) {
      return json.data as T
    }
    if (Array.isArray(json)) {
      return json as unknown as T
    }
    if (json.slots !== undefined) {
      return json.slots as T
    }
    if (json.images !== undefined) {
      return json.images as T
    }
    if (json.services !== undefined) {
      return json.services as T
    }
    if (json.data !== undefined) {
      return json.data as T
    }
    return json as unknown as T
  } catch {
    return null
  }
}

export async function fetchPortfolio(category?: string, signal?: AbortSignal): Promise<PortfolioApiItem[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : ''
  const items = await apiGet<PortfolioApiItem[]>(`/portfolio${query}`, signal)
  return Array.isArray(items) ? items : []
}

export async function fetchPortfolioSection(section: PortfolioSection, signal?: AbortSignal): Promise<PortfolioApiItem[] | null> {
  const items = await apiGet<PortfolioApiItem[]>(`/portfolio?section=${encodeURIComponent(section)}&limit=100`, signal)
  return Array.isArray(items) ? items : null
}

export function resolveMediaUrl(key?: string | null): string {
  if (!key) return ''
  if (key.startsWith('https://') || key.startsWith('http://') || key.startsWith('/') || key.startsWith('data:image/')) {
    return key
  }
  return `/api/media/${key.replace(/^\/+/, '')}`
}

function portfolioImageUrl(item: PortfolioImageRecord): string {
  const rawUrl = item.url || item.public_url || (item.media_key ? resolveMediaUrl(item.media_key) : '')
  return rawUrl.startsWith('https://') || rawUrl.startsWith('/') ? rawUrl : ''
}

/**
 * Photos for the "Most recent photoshoot" carousel, as managed in the admin panel.
 * Falls back to the bundled photos when the API is unreachable or has none yet,
 * so the section never renders empty in development.
 */
export async function fetchRecentPhotos(fallbackPhotos: readonly PhotoshootPhoto[], signal?: AbortSignal): Promise<readonly PhotoshootPhoto[]> {
  try {
    const items = await fetchPortfolioSection('recent', signal)
    if (items === null) {
      return fallbackPhotos
    }
    const photos = items
      .map(item => ({ item, imageUrl: portfolioImageUrl(item) }))
      .filter(({ imageUrl }) => imageUrl)
      .map(({ item, imageUrl }) => ({
        id: `api-recent-${item.id}`,
        imageUrl,
        alt: item.alt_text?.trim() || item.title?.trim() || 'R59 Media recent photoshoot',
        // Carousel slots are portrait and crop with object-fit, so a nominal size is enough
        width: 720,
        height: 1020,
      }))
    return photos
  } catch {
    return fallbackPhotos
  }
}

export type RecentPhoto = PhotoshootPhoto

export interface GalleryPhoto extends RecentPhoto {
  src: string
  category: string
  title?: string
}

export async function fetchGalleryPhotos(fallbackPhotos: readonly PhotoshootPhoto[], signal?: AbortSignal): Promise<GalleryPhoto[]> {
  const fallbackCategories = ['Portrait', 'Editorial', 'Commercial', 'Events']
  const mapFallback = (): GalleryPhoto[] =>
    fallbackPhotos.map((photo, index) => ({
      ...photo,
      src: photo.imageUrl,
      category: fallbackCategories[index % fallbackCategories.length],
      title: photo.alt.replace(/\.$/, ''),
    }))

  try {
    const items = await fetchPortfolioSection('gallery', signal)
    if (items === null) {
      return mapFallback()
    }

    const photos: GalleryPhoto[] = items
      .map(item => {
        const src = portfolioImageUrl(item) || resolveMediaUrl(item.media_key)
        return {
          id: String(item.id),
          src,
          imageUrl: src,
          alt: item.alt_text?.trim() || item.title?.trim() || `${item.category || 'Portfolio'} photograph`,
          title: item.title?.trim() || item.alt_text?.trim() || '',
          category: item.category && item.category !== 'All' ? item.category : 'Portrait',
          width: 720,
          height: 1020,
        }
      })
      .filter(photo => Boolean(photo.src))

    return photos
  } catch {
    return mapFallback()
  }
}

export interface PublicProfileData {
  bio?: string
  email?: string
  phone?: string
  location?: string
  travel?: boolean | string
  social?: Record<string, string> | Array<{ platform: string; url: string }>
}

export interface AboutData {
  portrait: { src: string; alt: string } | null
  profile: PublicProfileData | null
  portraitError?: boolean
  profileError?: boolean
}

export async function fetchAboutData(signal?: AbortSignal): Promise<AboutData> {
  const [aboutRes, profileRes] = await Promise.allSettled([
    apiGet<PortfolioApiItem[]>('/portfolio?section=about&limit=10', signal),
    apiGet<PublicProfileData | { profile?: PublicProfileData }>('/profile', signal),
  ])

  let portrait: { src: string; alt: string } | null = null
  let portraitError = false
  if (aboutRes.status === 'fulfilled' && aboutRes.value !== null) {
    if (Array.isArray(aboutRes.value) && aboutRes.value.length > 0) {
      const active = aboutRes.value.find(item => item.is_active !== 0) || aboutRes.value[0]
      const src = portfolioImageUrl(active) || resolveMediaUrl(active.media_key)
      if (src) {
        portrait = {
          src,
          alt: active.alt_text?.trim() || active.title?.trim() || 'Portrait of the photographer',
        }
      }
    } else {
      portrait = null
    }
  } else {
    portraitError = true
  }

  let profile: PublicProfileData | null = null
  let profileError = false
  if (profileRes.status === 'fulfilled' && profileRes.value !== null) {
    const val = profileRes.value
    if ('profile' in val && val.profile && typeof val.profile === 'object') {
      profile = val.profile as PublicProfileData
    } else if (typeof val === 'object') {
      profile = val as PublicProfileData
    }
  } else {
    profileError = true
  }

  return { portrait, profile, portraitError, profileError }
}

export async function fetchHeroSlides(fallbackSlides: readonly HeroSlide[], signal?: AbortSignal): Promise<readonly HeroSlide[]> {
  try {
    const items = await apiGet<PortfolioApiItem[]>(`/portfolio?category=hero`, signal)
    if (items === null) {
      return fallbackSlides
    }
    const validItems = items
      .map(item => {
        const rawUrl = item.url || item.public_url || (item.media_key ? resolveMediaUrl(item.media_key) : '')
        return { item, rawUrl }
      })
      .filter(
        ({ rawUrl }) => typeof rawUrl === 'string' && (rawUrl.startsWith('https://') || rawUrl.startsWith('/'))
      )
    return validItems.map(({ item, rawUrl }, index) => ({
      id: `api-hero-${item.id ?? index}`,
      imageUrl: rawUrl,
      alt: item.alt_text?.trim() || 'R59 Media featured photography',
      width: 1440,
      height: 528,
      objectPosition: '50% 50%',
      mobileObjectPosition: '50% 50%',
      hasEmbeddedOverlay: false,
    }))
  } catch {
    return fallbackSlides
  }
}

export async function fetchBookingServices(signal?: AbortSignal): Promise<readonly BookingService[]> {
  const data = await apiGet<BookingService[] | { services?: BookingService[] }>('/services', signal)
  if (Array.isArray(data)) {
    return data
  }
  if (data && typeof data === 'object' && 'services' in data && Array.isArray(data.services)) {
    return data.services
  }
  return []
}

export async function fetchServices(signal?: AbortSignal): Promise<ServicePackageItem[]> {
  const items = await apiGet<ServicePackageItem[]>('/services', signal)
  return Array.isArray(items) ? items : []
}

export async function fetchAvailableSlots(signal?: AbortSignal): Promise<ScheduleSlotItem[] | null> {
  const items = await apiGet<ScheduleSlotItem[]>('/schedule', signal)
  return Array.isArray(items) ? items : null
}

export async function submitContactLead(payload: ContactLeadPayload): Promise<ApiResponse<{ id?: number }>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(`${API_BASE}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
    })
    const retry = Number(res.headers.get('Retry-After'))
    if (res.status === 429) return { status: 'error', code: 'TOO_MANY_REQUESTS', retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : 60, message: 'Too many requests. Please wait before trying again. Your details are still here.' }
    const body = await res.json() as Record<string, unknown>
    if (!res.ok || body.status !== 'success') return {
      status: 'error',
      code: res.status === 400 || res.status === 422 ? 'VALIDATION_FAILED' : 'REQUEST_FAILED',
      message: res.status === 400 || res.status === 422 ? 'Your details could not be accepted. Please check the fields and try again.' : 'We couldn’t send your request. Your details are still here. Please try again.',
    }
    return { status: 'success', id: typeof body.id === 'number' ? body.id : undefined }
  } catch {
    return { status: 'error', code: 'NETWORK_ERROR', message: 'The request could not be confirmed. Your details are still here. Please check your connection before retrying.' }
  } finally {
    clearTimeout(timeout)
  }
}

export async function submitCheckout(
  payload: CheckoutPayload,
  options?: { credentials?: RequestCredentials; signal?: AbortSignal }
): Promise<ApiResponse<{ booking_id?: number; payment_id?: string; order_id?: string }>> {
  try {
    const res = await fetch(`${API_BASE}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      credentials: options?.credentials ?? 'omit',
      signal: options?.signal,
    })
    return (await res.json()) as ApiResponse<{ booking_id?: number; payment_id?: string; order_id?: string }>
  } catch {
    return {
      status: 'error',
      code: 'NETWORK_ERROR',
      message: 'Unable to complete request. Please try again.',
    }
  }
}

export interface PricingData {
  depositPercent: number
  baseFee: number
  perPerson: number
  currency: string
  squareConfig?: SquareConfig | null
}

export interface SessionPricingBreakdown {
  subtotalMinor: number | null
  baseFeeMinor: number
  extraPeopleFeeMinor: number
  depositPercent: number
  depositMinor: number | null
}

/**
 * Shared pricing math aligned 1:1 with backend POST /api/checkout.
 */
export function computeSessionPricing(
  service: Pick<BookingService, 'priceMinor' | 'additionalPeople'> | null | undefined,
  attendees: number,
  pricing?: Pick<PricingData, 'depositPercent' | 'baseFee' | 'perPerson'> | null,
  fallbackDepositPercent = 60
): SessionPricingBreakdown {
  const depositPercent = typeof pricing?.depositPercent === 'number' && Number.isFinite(pricing.depositPercent)
    ? pricing.depositPercent
    : fallbackDepositPercent

  if (!service || service.priceMinor === null || service.priceMinor === undefined) {
    return {
      subtotalMinor: null,
      baseFeeMinor: 0,
      extraPeopleFeeMinor: 0,
      depositPercent,
      depositMinor: null,
    }
  }

  const extra = service.additionalPeople
  const includedPeople = extra?.includedPeople ?? 1
  const additionalPeople = Math.max(0, attendees - includedPeople)
  const baseFeeMinor = Math.round((Number(pricing?.baseFee) || 0) * 100)
  const adminPerPersonMinor = Math.round((Number(pricing?.perPerson) || 0) * 100)
  const ratePerPersonMinor = adminPerPersonMinor > 0 ? adminPerPersonMinor : (extra?.extraPersonPriceMinor ?? 0)
  const extraPeopleFeeMinor = ratePerPersonMinor * additionalPeople
  const subtotalMinor = service.priceMinor + baseFeeMinor + extraPeopleFeeMinor
  const depositMinor = Math.round(subtotalMinor * (depositPercent / 100))

  return {
    subtotalMinor,
    baseFeeMinor,
    extraPeopleFeeMinor,
    depositPercent,
    depositMinor,
  }
}

function parseSquareConfig(raw: unknown): SquareConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Record<string, unknown>
  const applicationId = typeof candidate.applicationId === 'string' ? candidate.applicationId.trim() : ''
  const locationId = typeof candidate.locationId === 'string' ? candidate.locationId.trim() : ''
  const environment =
    candidate.environment === 'production'
      ? 'production'
      : candidate.environment === 'sandbox'
        ? 'sandbox'
        : null
  if (!applicationId || !locationId || !environment) return null
  return { applicationId, locationId, environment }
}

export async function fetchPricing(signal?: AbortSignal): Promise<PricingData | null> {
  try {
    const data = await apiGet<PricingData | { pricing?: PricingData; data?: PricingData; squareConfig?: unknown }>('/pricing', signal)
    if (!data) return null
    const root = data as Record<string, unknown>
    let pricingObj: PricingData | null = null
    if ('depositPercent' in data && typeof data.depositPercent === 'number') {
      pricingObj = data as PricingData
    } else if ('pricing' in data && data.pricing && typeof data.pricing.depositPercent === 'number') {
      pricingObj = data.pricing
    } else if ('data' in data && data.data && typeof data.data.depositPercent === 'number') {
      pricingObj = data.data
    }
    if (!pricingObj) return null
    const squareConfig = parseSquareConfig(pricingObj.squareConfig ?? root.squareConfig)
    return {
      ...pricingObj,
      squareConfig,
    }
  } catch {
    return null
  }
}

export interface CouponValidationResult {
  valid: boolean
  type?: 'percent' | 'fixed'
  amount?: number
  message?: string
}

export async function validateCoupon(code: string, signal?: AbortSignal): Promise<CouponValidationResult> {
  try {
    const res = await fetch(`${API_BASE}/coupons/validate?code=${encodeURIComponent(code)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal,
    })
    let data: Record<string, unknown> = {}
    try {
      const json = (await res.json()) as Record<string, unknown>
      data = (json.data !== undefined ? json.data : json) as Record<string, unknown>
    } catch {
      // ignore JSON parse error
    }
    if (!res.ok && !('valid' in data)) {
      return {
        valid: false,
        message: typeof data.message === 'string' ? data.message : 'Invalid coupon code.',
      }
    }
    return {
      valid: Boolean(data.valid),
      type: (data.type as 'percent' | 'fixed') || undefined,
      amount: typeof data.amount === 'number' ? data.amount : undefined,
      message: typeof data.message === 'string' ? data.message : undefined,
    }
  } catch {
    return {
      valid: false,
      message: 'Unable to validate coupon. Please check your network connection.',
    }
  }
}

