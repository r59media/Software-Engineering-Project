import { Hono, type Context } from 'hono'
import type { Bindings } from '../index.ts'
import { getTrustedClientIp } from '../middleware/auth.ts'

const MAX_ADDRESS_IPS = 1000
const ADDRESS_WINDOW_MS = 60 * 1000
const MAX_ADDRESS_REQUESTS = 30
const addressRateMap = new Map<string, { count: number; resetAt: number }>()

const PLACE_ID_REGEX = /^[A-Za-z0-9_-]{4,200}$/
const PHOTON_USER_AGENT = 'R59MediaBookingVerifier/1.0'

const US_STATE_CODES: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'puerto rico': 'PR',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY'
}

const VALID_US_STATE_CODES = new Set(Object.values(US_STATE_CODES))

export function normalizeUsStateCode(rawState: unknown): string {
  const trimmed = typeof rawState === 'string' ? rawState.trim() : ''
  if (!trimmed) return ''
  const upper = trimmed.toUpperCase()
  if (VALID_US_STATE_CODES.has(upper)) return upper
  const mapped = US_STATE_CODES[trimmed.toLowerCase()]
  return mapped || trimmed
}

export function buildGoogleMapsSearchUrl(formattedAddress: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formattedAddress)}`
}

export function resetAddressRateLimit(): void {
  addressRateMap.clear()
}

export function checkAddressRateLimit(ip: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  for (const [k, v] of addressRateMap.entries()) {
    if (now > v.resetAt) addressRateMap.delete(k)
  }

  const entry = addressRateMap.get(ip)
  if (!entry || now > entry.resetAt) {
    if (addressRateMap.size >= MAX_ADDRESS_IPS) {
      const oldest = addressRateMap.keys().next().value
      if (oldest) addressRateMap.delete(oldest)
    }
    addressRateMap.set(ip, { count: 1, resetAt: now + ADDRESS_WINDOW_MS })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  if (entry.count >= MAX_ADDRESS_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    return { allowed: false, retryAfterSeconds }
  }

  entry.count++
  return { allowed: true, retryAfterSeconds: 0 }
}

function enforceAddressRateLimit(c: Context<{ Bindings: Bindings }>): Response | null {
  c.header('Cache-Control', 'no-store')
  const ip = getTrustedClientIp(c)
  const rate = checkAddressRateLimit(ip)
  if (!rate.allowed) {
    c.header('Retry-After', String(rate.retryAfterSeconds))
    return c.json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many address lookup requests. Please wait a minute and try again.'
      }
    }, 429)
  }
  return null
}

async function fetchGoogleAutocomplete(
  apiKey: string,
  input: string,
  sessionToken: string
) {
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey
    },
    body: JSON.stringify({
      input,
      includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
      ...(sessionToken ? { sessionToken } : {})
    })
  })

  if (!res.ok) {
    throw new Error(`Google Places autocomplete failed with status ${res.status}`)
  }

  const json = await res.json() as {
    suggestions?: Array<{
      placePrediction?: {
        place?: string
        placeId?: string
        text?: { text?: string }
        structuredFormat?: {
          mainText?: { text?: string }
          secondaryText?: { text?: string }
        }
      }
    }>
  }

  const predictions = Array.isArray(json?.suggestions) ? json.suggestions : []
  return predictions
    .map((item) => {
      const pred = item?.placePrediction
      if (!pred) return null
      const placeId = String(
        pred.placeId || (typeof pred.place === 'string' ? pred.place.replace(/^places\//, '') : '')
      ).trim()
      if (!placeId) return null
      const mainText = String(pred.structuredFormat?.mainText?.text || pred.text?.text || '').trim()
      const secondaryText = String(pred.structuredFormat?.secondaryText?.text || '').trim()
      const label = String(pred.text?.text || [mainText, secondaryText].filter(Boolean).join(', ')).trim()
      return {
        id: placeId,
        placeId,
        label,
        mainText,
        secondaryText,
        provider: 'google' as const
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
}

async function fetchPhotonAutocomplete(query: string) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en&bbox=-125.0,24.3,-66.9,49.4`
  const res = await fetch(url, {
    headers: {
      'User-Agent': PHOTON_USER_AGENT
    }
  })

  if (!res.ok) {
    throw new Error(`Photon autocomplete failed with status ${res.status}`)
  }

  const json = await res.json() as {
    features?: Array<{
      properties?: {
        osm_id?: string | number
        osm_type?: string
        housenumber?: string
        street?: string
        name?: string
        city?: string
        town?: string
        village?: string
        locality?: string
        state?: string
        postcode?: string
      }
    }>
  }

  const features = Array.isArray(json?.features) ? json.features : []
  return features
    .map((feature, index) => {
      const props = feature?.properties
      if (!props) return null
      const streetLine = [props.housenumber, props.street].filter(Boolean).join(' ').trim()
      const street = streetLine || String(props.name || '').trim()
      const city = String(props.city || props.town || props.village || props.locality || '').trim()
      const state = normalizeUsStateCode(props.state)
      const postcode = String(props.postcode || '').trim()
      const stateZip = [state, postcode].filter(Boolean).join(' ')
      const formattedAddress = [street, city, stateZip].filter(Boolean).join(', ')
      if (!formattedAddress) return null

      const id = `osm:${props.osm_type || 'N'}:${props.osm_id ?? index}`
      return {
        id,
        label: formattedAddress,
        mainText: street || city || formattedAddress,
        secondaryText: [city, stateZip].filter(Boolean).join(', '),
        street,
        city,
        state,
        postcode,
        postalCode: postcode,
        formattedAddress,
        googleMapsUrl: buildGoogleMapsSearchUrl(formattedAddress),
        provider: 'osm' as const
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
}

export const addressRouter = new Hono<{ Bindings: Bindings }>()

addressRouter.get('/', async (c) => {
  const limited = enforceAddressRateLimit(c)
  if (limited) return limited

  const q = String(c.req.query('q') || '').trim()
  const sessionToken = String(c.req.query('sessionToken') || '').trim()

  if (q.length < 3 || q.length > 160) {
    return c.json({ suggestions: [], status: 'success', data: [] })
  }

  const googleApiKey = String(c.env?.GOOGLE_MAPS_API_KEY || '').trim()

  try {
    if (googleApiKey) {
      try {
        const suggestions = await fetchGoogleAutocomplete(googleApiKey, q, sessionToken)
        return c.json({ suggestions, status: 'success', data: suggestions })
      } catch (googleErr) {
        console.warn('[address] Google Places autocomplete failed, falling back to Photon:', googleErr)
      }
    }

    const suggestions = await fetchPhotonAutocomplete(q)
    return c.json({ suggestions, status: 'success', data: suggestions })
  } catch (err) {
    console.warn('[address] Autocomplete lookup failed:', err)
    return c.json({ suggestions: [], status: 'success', data: [] })
  }
})

addressRouter.get('/details', async (c) => {
  const limited = enforceAddressRateLimit(c)
  if (limited) return limited

  const placeId = String(c.req.query('placeId') || '').trim()
  const sessionToken = String(c.req.query('sessionToken') || '').trim()

  if (!PLACE_ID_REGEX.test(placeId)) {
    return c.json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'A valid placeId is required.'
      }
    }, 400)
  }

  const googleApiKey = String(c.env?.GOOGLE_MAPS_API_KEY || '').trim()
  if (!googleApiKey) {
    return c.json({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Google Places API key is not configured.'
      }
    }, 503)
  }

  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${
    sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : ''
  }`

  try {
    const res = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': 'formattedAddress,addressComponents,googleMapsUri'
      }
    })

    if (!res.ok) {
      return c.json({
        error: {
          code: 'UPSTREAM_ERROR',
          message: 'Failed to fetch verified place details.'
        }
      }, 502)
    }

    const data = await res.json() as {
      formattedAddress?: string
      googleMapsUri?: string
      addressComponents?: Array<{
        longText?: string
        shortText?: string
        types?: string[]
      }>
    }

    const components = Array.isArray(data?.addressComponents) ? data.addressComponents : []
    const findComponent = (typesToMatch: string[]) =>
      components.find((comp) => Array.isArray(comp.types) && typesToMatch.some((t) => comp.types!.includes(t)))

    const streetNumber = String(findComponent(['street_number'])?.shortText || findComponent(['street_number'])?.longText || '').trim()
    const route = String(findComponent(['route'])?.shortText || findComponent(['route'])?.longText || '').trim()
    const subpremise = String(findComponent(['subpremise'])?.shortText || findComponent(['subpremise'])?.longText || '').trim()
    const baseStreet = [streetNumber, route].filter(Boolean).join(' ').trim()
    const street = baseStreet ? (subpremise ? `${baseStreet} #${subpremise}` : baseStreet) : ''

    const cityComp = findComponent(['locality', 'sublocality', 'postal_town', 'administrative_area_level_2'])
    const city = String(cityComp?.longText || cityComp?.shortText || '').trim()

    const stateComp = findComponent(['administrative_area_level_1'])
    const state = normalizeUsStateCode(stateComp?.shortText || stateComp?.longText || '')

    const postalComp = findComponent(['postal_code'])
    const postalCode = String(postalComp?.shortText || postalComp?.longText || '').trim()

    const formattedAddress = String(
      data?.formattedAddress || [street, city, [state, postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    ).trim()
    const googleMapsUrl = String(data?.googleMapsUri || buildGoogleMapsSearchUrl(formattedAddress)).trim()

    return c.json({
      street,
      city,
      state,
      postalCode,
      formattedAddress,
      googleMapsUrl,
      verified: true,
      status: 'success'
    })
  } catch (err) {
    console.warn('[address] Place details lookup failed:', err)
    return c.json({
      error: {
        code: 'UPSTREAM_ERROR',
        message: 'Failed to fetch verified place details.'
      }
    }, 502)
  }
})
