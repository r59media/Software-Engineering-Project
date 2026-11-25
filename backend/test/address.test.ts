import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import type { Bindings } from '../src/index.ts'
import { addressRouter, resetAddressRateLimit } from '../src/routes/address.ts'
import { stripControlChars, sanitizeCheckoutIdentityAndLocation } from '../src/routes/checkout.ts'

const app = new Hono<{ Bindings: Bindings }>()
app.route('/api/address-autocomplete', addressRouter)

function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ success: true })
        }),
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true })
      })
    } as unknown as D1Database,
    ...overrides
  }
}

test('GET /api/address-autocomplete returns empty suggestions for short query (q=ab) with Cache-Control: no-store', async () => {
  resetAddressRateLimit()
  const res = await app.request(
    'http://localhost/api/address-autocomplete?q=ab',
    { headers: { 'cf-connecting-ip': '203.0.113.10' } },
    makeEnv()
  )
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  assert.equal(res.headers.get('Set-Cookie'), null)
  const json = await res.json() as any
  assert.deepEqual(json.suggestions, [])
  assert.deepEqual(json.data, [])
  assert.equal(json.status, 'success')
})

test('GET /api/address-autocomplete falls back to Photon and normalizes US state names and googleMapsUrl', async () => {
  resetAddressRateLimit()
  const originalFetch = globalThis.fetch
  let capturedUrl = ''
  let capturedUserAgent = ''

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input)
    const headers = new Headers(init?.headers)
    capturedUserAgent = headers.get('User-Agent') || ''
    return new Response(JSON.stringify({
      features: [
        {
          properties: {
            osm_type: 'W',
            osm_id: 101,
            housenumber: '123',
            street: 'Congress Ave',
            city: 'Austin',
            state: 'Texas',
            postcode: '78701'
          }
        },
        {
          properties: {
            osm_type: 'N',
            osm_id: 202,
            name: 'Central Park',
            town: 'New York',
            state: 'New York',
            postcode: '10024'
          }
        }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  try {
    const res = await app.request(
      'http://localhost/api/address-autocomplete?q=123+Congress+Ave',
      { headers: { 'cf-connecting-ip': '203.0.113.11' } },
      makeEnv()
    )
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('Cache-Control'), 'no-store')
    assert.ok(capturedUrl.startsWith('https://photon.komoot.io/api/?q='))
    assert.ok(capturedUrl.includes('bbox=-125.0,24.3,-66.9,49.4'))
    assert.equal(capturedUserAgent, 'R59MediaBookingVerifier/1.0')

    const json = await res.json() as any
    assert.equal(json.suggestions.length, 2)
    assert.equal(json.suggestions[0].provider, 'osm')
    assert.equal(json.suggestions[0].state, 'TX')
    assert.equal(json.suggestions[0].postcode, '78701')
    assert.equal(json.suggestions[0].formattedAddress, '123 Congress Ave, Austin, TX 78701')
    assert.equal(
      json.suggestions[0].googleMapsUrl,
      'https://www.google.com/maps/search/?api=1&query=123%20Congress%20Ave%2C%20Austin%2C%20TX%2078701'
    )
    assert.equal(json.suggestions[1].state, 'NY')
    assert.equal(json.suggestions[1].mainText, 'Central Park')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('GET /api/address-autocomplete and /details use Google Places when GOOGLE_MAPS_API_KEY is set', async () => {
  resetAddressRateLimit()
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; method: string; headers: Headers; body: string | null }> = []

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || 'GET'
    const headers = new Headers(init?.headers)
    const body = typeof init?.body === 'string' ? init.body : null
    calls.push({ url, method, headers, body })

    if (url.includes('places:autocomplete')) {
      return new Response(JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: 'ChIJ_test_place_1',
              text: { text: '1600 Amphitheatre Pkwy, Mountain View, CA, USA' },
              structuredFormat: {
                mainText: { text: '1600 Amphitheatre Pkwy' },
                secondaryText: { text: 'Mountain View, CA, USA' }
              }
            }
          }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({
      formattedAddress: '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA',
      googleMapsUri: 'https://maps.google.com/?cid=12345',
      addressComponents: [
        { shortText: '1600', types: ['street_number'] },
        { shortText: 'Amphitheatre Pkwy', types: ['route'] },
        { longText: 'Mountain View', types: ['locality'] },
        { shortText: 'CA', types: ['administrative_area_level_1'] },
        { shortText: '94043', types: ['postal_code'] }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  try {
    const env = makeEnv({ GOOGLE_MAPS_API_KEY: 'test-google-key' })

    const autoRes = await app.request(
      'http://localhost/api/address-autocomplete?q=1600+Amphitheatre&sessionToken=sess-abc',
      { headers: { 'cf-connecting-ip': '203.0.113.12' } },
      env
    )
    assert.equal(autoRes.status, 200)
    assert.equal(autoRes.headers.get('Cache-Control'), 'no-store')
    const autoJson = await autoRes.json() as any
    assert.deepEqual(autoJson.suggestions, [
      {
        id: 'ChIJ_test_place_1',
        placeId: 'ChIJ_test_place_1',
        label: '1600 Amphitheatre Pkwy, Mountain View, CA, USA',
        mainText: '1600 Amphitheatre Pkwy',
        secondaryText: 'Mountain View, CA, USA',
        provider: 'google'
      }
    ])

    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].headers.get('X-Goog-Api-Key'), 'test-google-key')
    assert.deepEqual(JSON.parse(calls[0].body || '{}'), {
      input: '1600 Amphitheatre',
      includedRegionCodes: ['us'],
      includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
      sessionToken: 'sess-abc'
    })

    const detailsRes = await app.request(
      'http://localhost/api/address-autocomplete/details?placeId=ChIJ_test_place_1&sessionToken=sess-abc',
      { headers: { 'cf-connecting-ip': '203.0.113.12' } },
      env
    )
    assert.equal(detailsRes.status, 200)
    assert.equal(detailsRes.headers.get('Cache-Control'), 'no-store')
    const detailsJson = await detailsRes.json() as any
    assert.equal(detailsJson.street, '1600 Amphitheatre Pkwy')
    assert.equal(detailsJson.city, 'Mountain View')
    assert.equal(detailsJson.state, 'CA')
    assert.equal(detailsJson.postalCode, '94043')
    assert.equal(detailsJson.formattedAddress, '1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA')
    assert.equal(detailsJson.googleMapsUrl, 'https://maps.google.com/?cid=12345')
    assert.equal(detailsJson.verified, true)

    assert.equal(calls[1].method, 'GET')
    assert.equal(calls[1].headers.get('X-Goog-Api-Key'), 'test-google-key')
    assert.equal(calls[1].headers.get('X-Goog-FieldMask'), 'formattedAddress,addressComponents,googleMapsUri')

    const badPlaceRes = await app.request(
      'http://localhost/api/address-autocomplete/details?placeId=bad!id',
      { headers: { 'cf-connecting-ip': '203.0.113.12' } },
      env
    )
    assert.equal(badPlaceRes.status, 400)
    assert.equal(badPlaceRes.headers.get('Cache-Control'), 'no-store')

    const noKeyRes = await app.request(
      'http://localhost/api/address-autocomplete/details?placeId=ChIJ_test_place_1',
      { headers: { 'cf-connecting-ip': '203.0.113.12' } },
      makeEnv()
    )
    assert.equal(noKeyRes.status, 503)
    assert.equal(noKeyRes.headers.get('Cache-Control'), 'no-store')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('GET /api/address-autocomplete enforces 30 requests / 60s rate limit with 429 and Retry-After', async () => {
  resetAddressRateLimit()
  const env = makeEnv()

  for (let i = 0; i < 30; i++) {
    const res = await app.request(
      'http://localhost/api/address-autocomplete?q=ab',
      { headers: { 'cf-connecting-ip': '203.0.113.99' } },
      env
    )
    assert.equal(res.status, 200)
  }

  const blocked = await app.request(
    'http://localhost/api/address-autocomplete?q=ab',
    { headers: { 'cf-connecting-ip': '203.0.113.99' } },
    env
  )
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('Retry-After')) >= 1)
  assert.equal(blocked.headers.get('Cache-Control'), 'no-store')
})

test('checkout.ts forces R59 Media Studio in studio mode and strips CR/LF/control chars', () => {
  assert.equal(stripControlChars('  Hello\r\nWorld\x00\x1F\x7F  '), 'HelloWorld')

  const studioSanitized = sanitizeCheckoutIdentityAndLocation({
    locationMode: 'studio',
    eventLocation: '999 Tampered Ave\r\nBcc: attacker@evil.com\x00',
    clientName: 'Jane\r\nDoe\x07',
    agreementSignatureName: 'Jane\nDoe\x1F'
  })
  assert.equal(studioSanitized.locationMode, 'studio')
  assert.equal(studioSanitized.eventLocation, 'R59 Media Studio')
  assert.equal(studioSanitized.clientName, 'JaneDoe')
  assert.equal(studioSanitized.agreementSignatureName, 'JaneDoe')

  const omittedModeSanitized = sanitizeCheckoutIdentityAndLocation({
    eventLocation: '999 Tampered Ave',
    clientName: 'Jane Doe',
    agreementSignatureName: 'Jane Doe'
  })
  assert.equal(omittedModeSanitized.locationMode, 'studio')
  assert.equal(omittedModeSanitized.eventLocation, 'R59 Media Studio')

  const onLocSanitized = sanitizeCheckoutIdentityAndLocation({
    locationMode: 'on_location',
    eventLocation: '123 Main St\r\nAustin, TX\x00',
    clientName: 'John\x1B Smith',
    agreementSignatureName: 'John\rSmith'
  })
  assert.equal(onLocSanitized.locationMode, 'on_location')
  assert.equal(onLocSanitized.eventLocation, '123 Main StAustin, TX')
  assert.equal(onLocSanitized.clientName, 'John Smith')
  assert.equal(onLocSanitized.agreementSignatureName, 'JohnSmith')
})
