import type { HeroSlide } from '../types/hero'
import type { PhotoshootPhoto } from '../types/recentPhotoshoot'
import type { BookingService } from '../types/booking'

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
  coupon_code?: string
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
      signal,
    })
    if (!res.ok) return null
    const json = (await res.json()) as Record<string, unknown>
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
    return null
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
    let items = await fetchPortfolioSection('recent', signal)
    if (!items || items.length === 0) {
      const galleryItems = await fetchPortfolioSection('gallery', signal)
      if (galleryItems && galleryItems.length > 0) {
        items = galleryItems.filter(item => item.category?.toLowerCase() !== 'hero')
      }
    }
    const photos = (items ?? [])
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
    return photos.length > 0 ? photos : fallbackPhotos
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
    let items = await fetchPortfolioSection('gallery', signal)
    if (!items || items.length === 0) {
      const recentItems = await fetchPortfolioSection('recent', signal)
      if (recentItems && recentItems.length > 0) {
        items = recentItems.filter(item => item.category?.toLowerCase() !== 'hero')
      }
    }

    if (!items || items.length === 0) {
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

    return photos.length > 0 ? photos : mapFallback()
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
}

export async function fetchAboutData(signal?: AbortSignal): Promise<AboutData> {
  const [aboutRes, profileRes] = await Promise.allSettled([
    apiGet<PortfolioApiItem[]>('/portfolio?section=about&limit=10', signal),
    apiGet<PublicProfileData | { profile?: PublicProfileData }>('/profile', signal),
  ])

  let portrait: { src: string; alt: string } | null = null
  if (aboutRes.status === 'fulfilled' && Array.isArray(aboutRes.value) && aboutRes.value.length > 0) {
    const active = aboutRes.value.find(item => item.is_active !== 0) || aboutRes.value[0]
    const src = portfolioImageUrl(active) || resolveMediaUrl(active.media_key)
    if (src) {
      portrait = {
        src,
        alt: active.alt_text?.trim() || active.title?.trim() || 'Portrait of the photographer',
      }
    }
  }

  let profile: PublicProfileData | null = null
  if (profileRes.status === 'fulfilled' && profileRes.value) {
    const val = profileRes.value
    if ('profile' in val && val.profile && typeof val.profile === 'object') {
      profile = val.profile as PublicProfileData
    } else if (typeof val === 'object') {
      profile = val as PublicProfileData
    }
  }

  return { portrait, profile }
}

export async function fetchHeroSlides(fallbackSlides: readonly HeroSlide[], signal?: AbortSignal): Promise<readonly HeroSlide[]> {
  const items = await fetchPortfolio('hero', signal)
  const validItems = items
    .map(item => {
      const rawUrl = item.url || item.public_url || (item.media_key ? resolveMediaUrl(item.media_key) : '')
      return { item, rawUrl }
    })
    .filter(
      ({ rawUrl }) => typeof rawUrl === 'string' && (rawUrl.startsWith('https://') || rawUrl.startsWith('/'))
    )
  if (validItems.length === 0) return fallbackSlides
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

export async function fetchAvailableSlots(signal?: AbortSignal): Promise<ScheduleSlotItem[]> {
  const items = await apiGet<ScheduleSlotItem[]>('/schedule', signal)
  return Array.isArray(items) ? items : []
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

export async function submitCheckout(payload: CheckoutPayload): Promise<ApiResponse<{ booking_id?: number; payment_id?: string; order_id?: string }>> {
  try {
    const res = await fetch(`${API_BASE}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
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
