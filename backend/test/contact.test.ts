import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeText,
  VALID_SESSION_TYPES,
  getIdempotencyResult,
  recordIdempotencyResult
} from '../src/routes/contact.ts'

test('sanitizeText strips dangerous control characters and preserves ordinary newlines', () => {
  const dirty = 'Hello\x00\x08World\r\nLine 2\tTab\x1FEnd'
  const clean = sanitizeText(dirty)
  assert.equal(clean, 'HelloWorld\r\nLine 2\tTabEnd')
  assert.ok(!clean.includes('\x00'))
  assert.ok(!clean.includes('\x1F'))
  assert.ok(clean.includes('\r\n'))
  assert.ok(clean.includes('\t'))
})

test('VALID_SESSION_TYPES includes all catalog packages and legacy tiers', () => {
  const expectedTiers = [
    'Portrait',
    'Grad Pics',
    'Branding Pics',
    'Event',
    'Business package',
    'Brand',
    'Creative',
    'Other'
  ]
  for (const tier of expectedTiers) {
    assert.ok(VALID_SESSION_TYPES.includes(tier), `Missing session type: ${tier}`)
  }
})

test('Idempotency cache records and retrieves recent write results', () => {
  const key = 'test-idemp-' + Math.random().toString(36).substring(2)
  assert.equal(getIdempotencyResult(key), null)

  recordIdempotencyResult(key, 999)
  assert.equal(getIdempotencyResult(key), 999)
})

test('Phone regex and digit bounds match 7 to 15 digits in 7 to 25 characters', () => {
  const PHONE_CHARS_REGEX = /^[\d+()\s-]{7,25}$/

  const validPhones = [
    '+1 (212) 555-0148',
    '555-0199',
    '+44 20 7946 0991',
    '(800) 555-1212',
    '1234567'
  ]

  for (const phone of validPhones) {
    assert.ok(PHONE_CHARS_REGEX.test(phone), `Should pass chars check: ${phone}`)
    const digits = (phone.match(/\d/g) || []).length
    assert.ok(digits >= 7 && digits <= 15, `Should pass digit count: ${phone}`)
  }

  const invalidPhones = [
    '12345',              // too few digits / too short
    'call me maybe',      // letters
    '+1 (212) 555-01480000000000' // too many characters / digits
  ]

  for (const phone of invalidPhones) {
    const charsPass = PHONE_CHARS_REGEX.test(phone)
    const digits = (phone.match(/\d/g) || []).length
    const passes = charsPass && digits >= 7 && digits <= 15
    assert.ok(!passes, `Should fail validation: ${phone}`)
  }
})
