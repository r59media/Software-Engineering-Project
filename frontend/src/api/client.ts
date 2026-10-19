import type { HeroSlide } from '../types/hero'

export interface PortfolioApiItem {
  id: number
  category: string
  r2_object_key: string
  public_url: string
  alt_text?: string | null
  display_order?: number
  is_active?: number
}

export interface ServicePackageItem {
  id: number
  title: string
  description: string | null
  price: number
  duration_minutes: number
  category: string | null
  is_active: number
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

interface ApiResponse<T> {
  status: 'success' | 'error'
  data?: T
  message?: string
  code?: string
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
    const json = (await res.json()) as ApiResponse<T>
    return json.status === 'success' && json.data !== undefined ? json.data : null
  } catch {
    return null
  }
}

export async function fetchPortfolio(category?: string, signal?: AbortSignal): Promise<PortfolioApiItem[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : ''
  const items = await apiGet<PortfolioApiItem[]>(`/portfolio${query}`, signal)
  return Array.isArray(items) ? items : []
}

export async function fetchHeroSlides(fallbackSlides: readonly HeroSlide[], signal?: AbortSignal): Promise<readonly HeroSlide[]> {
  const items = await fetchPortfolio('hero', signal)
  const validItems = items.filter(
    item => typeof item.public_url === 'string' && (item.public_url.startsWith('https://') || item.public_url.startsWith('/'))
  )
  if (validItems.length === 0) return fallbackSlides
  return validItems.map((item, index) => ({
    id: `api-hero-${item.id ?? index}`,
    imageUrl: item.public_url,
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
  const res = await fetch(`${API_BASE}/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await res.json()) as ApiResponse<{ id?: number }>
}

export async function submitCheckout(payload: CheckoutPayload): Promise<ApiResponse<{ booking_id?: number; payment_id?: string }>> {
  const res = await fetch(`${API_BASE}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await res.json()) as ApiResponse<{ booking_id?: number; payment_id?: string }>
}
