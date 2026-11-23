import type { PricingData } from '../../api/client'

declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => SquarePayments
    }
  }
}

export interface TokenizeResult {
  status: string
  token?: string
  errors?: Array<{ message: string; type?: string; field?: string }>
}

export interface SquareCard {
  attach: (selectorOrElement: string | HTMLElement) => Promise<void>
  tokenize: () => Promise<TokenizeResult>
  destroy: () => Promise<boolean>
}

export interface SquarePayments {
  card: (options?: Record<string, unknown>) => Promise<SquareCard>
}

const cachedSquarePayments = new Map<string, SquarePayments>()

export function resolveSquareCredentials(squareConfig?: PricingData['squareConfig'] | null) {
  const rawAppId =
    squareConfig?.applicationId ||
    import.meta.env.VITE_SQUARE_APPLICATION_ID ||
    import.meta.env.VITE_SQUARE_APP_ID ||
    ''
  const rawLocationId =
    squareConfig?.locationId || import.meta.env.VITE_SQUARE_LOCATION_ID || ''
  const isSquareConfigured = Boolean(
    rawAppId &&
      rawLocationId &&
      !rawAppId.includes('placeholder') &&
      !rawLocationId.includes('placeholder'),
  )
  const isProductionSquare =
    squareConfig?.environment === 'production' ||
    import.meta.env.VITE_SQUARE_ENVIRONMENT === 'production'

  return { rawAppId, rawLocationId, isSquareConfigured, isProductionSquare }
}

function getSquareCdnOrigin(isProductionEnvironment: boolean): string {
  return isProductionEnvironment
    ? 'https://web.squarecdn.com'
    : 'https://sandbox.web.squarecdn.com'
}

function ensureHeadLink(rel: string, href: string, asType?: string) {
  if (typeof document === 'undefined') return
  const existing = document.head.querySelector(`link[rel="${rel}"][href="${href}"]`)
  if (existing) return
  const link = document.createElement('link')
  link.rel = rel
  link.href = href
  if (asType) link.as = asType
  link.crossOrigin = 'anonymous'
  document.head.appendChild(link)
}

export function getOrCreateSquarePayments(
  appId: string,
  locationId: string,
  isProduction: boolean,
): SquarePayments | null {
  if (typeof window === 'undefined' || !window.Square) return null
  const cacheKey = `${appId}:${locationId}:${isProduction ? 'prod' : 'sandbox'}`
  const cached = cachedSquarePayments.get(cacheKey)
  if (cached) return cached
  const instance = window.Square.payments(appId, locationId)
  cachedSquarePayments.set(cacheKey, instance)
  return instance
}

export function loadSquareSdk(isProductionEnvironment?: boolean): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.Square) return Promise.resolve()

  const isProduction =
    typeof isProductionEnvironment === 'boolean'
      ? isProductionEnvironment
      : import.meta.env.VITE_SQUARE_ENVIRONMENT === 'production'
  const scriptUrl = `${getSquareCdnOrigin(isProduction)}/v1/square.js`

  const existing = document.querySelector<HTMLScriptElement>('script[src*="squarecdn.com"]')
  if (existing) {
    if (window.Square) return Promise.resolve()
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Square Web Payments SDK script.')),
        { once: true }
      )
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = scriptUrl
    script.type = 'text/javascript'
    script.async = true
    script.crossOrigin = 'anonymous'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Square Web Payments SDK script.'))
    document.head.appendChild(script)
  })
}

export function warmSquarePaymentSdk(squareConfig?: PricingData['squareConfig'] | null): void {
  if (typeof window === 'undefined') return
  const { rawAppId, rawLocationId, isSquareConfigured, isProductionSquare } =
    resolveSquareCredentials(squareConfig)
  if (!isSquareConfigured) return

  const cdnOrigin = getSquareCdnOrigin(isProductionSquare)
  ensureHeadLink('preconnect', cdnOrigin)
  ensureHeadLink('preconnect', 'https://pci-connect.squareup.com')
  ensureHeadLink('preload', `${cdnOrigin}/v1/square.js`, 'script')

  void loadSquareSdk(isProductionSquare)
    .then(() => {
      getOrCreateSquarePayments(rawAppId, rawLocationId, isProductionSquare)
    })
    .catch(() => {
      // Warmup is best-effort; Step 5 handles and surfaces load errors with retry.
    })
}
