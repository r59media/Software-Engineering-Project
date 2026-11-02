import type { HeroSlide } from '../types/hero'
import type { PhotoshootPhoto } from '../types/recentPhotoshoot'

/** Which part of the site a portfolio photo is shown in (matches the admin "Photos" tabs). */
export type PortfolioSection = 'recent' | 'gallery' | 'about' | 'hero'

export interface PortfolioApiItem {
  id: number
  section?: PortfolioSection
  category?: string
  title?: string | null
  r2_object_key?: string
  url?: string
  public_url?: string
  is_featured?: number | boolean
  alt_text?: string | null
  display_order?: number
  is_active?: number
}

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

function portfolioImageUrl(item: PortfolioApiItem): string {
  const rawUrl = item.url || item.public_url || (item.r2_object_key ? '/api/media/' + item.r2_object_key.replace(/^\/+/, '') : '')
  return rawUrl.startsWith('https://') || rawUrl.startsWith('/') ? rawUrl : ''
}

/**
 * Photos for the "Most recent photoshoot" carousel, as managed in the admin panel.
 * Falls back to the bundled photos when the API is unreachable or has none yet,
 * so the section never renders empty in development.
 */
export async function fetchRecentPhotos(fallbackPhotos: readonly PhotoshootPhoto[], signal?: AbortSignal): Promise<readonly PhotoshootPhoto[]> {
  const items = await fetchPortfolioSection('recent', signal)
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
}

export async function fetchHeroSlides(fallbackSlides: readonly HeroSlide[], signal?: AbortSignal): Promise<readonly HeroSlide[]> {
  const items = await fetchPortfolio('hero', signal)
  const validItems = items
    .map(item => {
      const rawUrl = item.url || item.public_url || (item.r2_object_key ? '/api/media/' + item.r2_object_key.replace(/^\/+/, '') : '')
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

export async function fetchServices(signal?: AbortSignal): Promise<ServicePackageItem[]> {
  const items = await apiGet<ServicePackageItem[]>('/services', signal)
  return Array.isArray(items) ? items : []
}

export async function fetchAvailableSlots(signal?: AbortSignal): Promise<ScheduleSlotItem[]> {
  const items = await apiGet<ScheduleSlotItem[]>('/schedule', signal)
  return Array.isArray(items) ? items : []
}

export async function submitContactLead(payload: ContactLeadPayload): Promise<ApiResponse<{ id?: number }>> {
  try {
    const res = await fetch(`${API_BASE}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    return (await res.json()) as ApiResponse<{ id?: number }>
  } catch {
    return {
      status: 'error',
      code: 'NETWORK_ERROR',
      message: 'Unable to complete request. Please try again.',
    }
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
