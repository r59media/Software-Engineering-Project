import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signRescheduleToken, verifyRescheduleToken } from '../src/utils/signedUrl.ts'
import { buildStudioIcsFeed, buildGoogleCalendarTemplateUrl } from '../src/lib/googleCalendar.ts'
import { countRescheduleIdentityMatches } from '../src/lib/billingMath.ts'

test('signRescheduleToken / verifyRescheduleToken: valid, tampered bookingId, tampered token', async () => {
  const secret = 'test-signing-secret-123'
  const bookingId = 42
  const email = 'Client@Example.com'

  const token = await signRescheduleToken(bookingId, email, secret)
  assert.ok(token.length === 64, 'expected 64-char hex HMAC-SHA256 token')

  // Valid token (case-insensitive email)
  assert.equal(await verifyRescheduleToken(bookingId, 'client@example.com', token, secret), true)

  // Tampered bookingId
  assert.equal(await verifyRescheduleToken(43, email, token, secret), false)

  // Tampered token
  const tamperedToken = (token[0] === 'a' ? 'b' : 'a') + token.slice(1)
  assert.equal(await verifyRescheduleToken(bookingId, email, tamperedToken, secret), false)

  // Wrong secret
  assert.equal(await verifyRescheduleToken(bookingId, email, token, 'wrong-secret'), false)
})

test('buildStudioIcsFeed: includes r59mediatesting@gmail.com and valid VCALENDAR structure', () => {
  const ics = buildStudioIcsFeed(
    [
      {
        id: 101,
        date: '2026-11-20',
        start_time: '14:00',
        end_time: '16:00',
        client_name: 'Jane Doe',
        client_email: 'jane@example.com',
        package_name: 'Portrait Session',
        status: 'confirmed',
        location: 'Atlanta Studio'
      }
    ],
    [{ id: 1, date: '2026-11-25', reason: 'Thanksgiving' }],
    'America/New_York'
  )

  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'))
  assert.ok(ics.includes('r59mediatesting@gmail.com'))
  assert.ok(ics.includes('UID:booking-101@r59media'))
  assert.ok(ics.includes('UID:blocked-2026-11-25@r59media'))
})

test('buildGoogleCalendarTemplateUrl: includes r59mediatesting@gmail.com and booking details', () => {
  const rescheduleUrl = 'https://r59media.com/reschedule?bookingId=101&token=abc'
  const urlStr = buildGoogleCalendarTemplateUrl(
    {
      id: 101,
      date: '2026-11-20',
      start_time: '14:00',
      end_time: '16:00',
      client_name: 'Jane Doe',
      package_name: 'Portrait Session',
      location: 'Atlanta Studio'
    },
    rescheduleUrl
  )

  const parsed = new URL(urlStr)
  assert.equal(parsed.origin + parsed.pathname, 'https://calendar.google.com/calendar/render')
  assert.equal(parsed.searchParams.get('action'), 'TEMPLATE')
  assert.equal(parsed.searchParams.get('add'), 'r59mediatesting@gmail.com')
  assert.ok((parsed.searchParams.get('text') || '').includes('Portrait Session'))
  assert.ok((parsed.searchParams.get('details') || '').includes(rescheduleUrl))
  assert.ok(parsed.searchParams.get('dates'))
})

test('countRescheduleIdentityMatches: 0/3, 1/3 fail (< 2); 2/3 and 3/3 pass', () => {
  const booking = {
    client_name: 'Jane   Doe',
    client_email: 'Jane.Doe@Example.com',
    customer_phone: '+1 (404) 555-1234'
  }

  // 0/3 match
  const zeroMatch = countRescheduleIdentityMatches(booking, {
    name: 'John Smith',
    email: 'other@example.com',
    phone: '4045559999'
  })
  assert.equal(zeroMatch, 0)
  assert.ok(zeroMatch < 2)

  // 1/3 match (email only)
  const oneMatch = countRescheduleIdentityMatches(booking, {
    name: 'John Smith',
    email: ' jane.doe@example.com ',
    phone: '4045559999'
  })
  assert.equal(oneMatch, 1)
  assert.ok(oneMatch < 2)

  // 2/3 match (different name, matching email + phone)
  const twoMatch = countRescheduleIdentityMatches(booking, {
    name: 'Wrong Name',
    email: 'jane.doe@example.com',
    phone: '404-555-1234'
  })
  assert.equal(twoMatch, 2)

  // 3/3 match (whitespace-normalized name, case-insensitive email, formatted phone)
  const threeMatch = countRescheduleIdentityMatches(booking, {
    name: '  jane doe  ',
    email: 'JANE.DOE@example.com',
    phone: '14045551234'
  })
  assert.equal(threeMatch, 3)
})
