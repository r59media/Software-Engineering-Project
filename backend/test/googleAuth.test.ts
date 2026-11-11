import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyGoogleIdToken, createSessionToken } from '../src/middleware/auth.ts'

const VALID_SECRET = 'a'.repeat(32)
const AUTHORIZED_EMAIL = 'r59mediatesting@gmail.com'

// Helper to generate a test RSA key pair and signed Google ID token
async function generateTestGoogleIdToken(claims: Record<string, unknown>, kid = 'test-kid-1') {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['sign', 'verify']
  )

  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const mockJwk = {
    kty: jwk.kty!,
    alg: 'RS256',
    use: 'sig',
    kid,
    n: jwk.n!,
    e: jwk.e!
  }

  const header = { alg: 'RS256', kid, typ: 'JWT' }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`)

  const sigBytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, signedData)
  const sigB64 = Buffer.from(sigBytes).toString('base64url')

  const token = `${headerB64}.${payloadB64}.${sigB64}`
  return { token, mockJwk, privateKey: pair.privateKey }
}

test('verifyGoogleIdToken validates claims, signatures, and single authorized email', async () => {
  const nowSec = Math.floor(Date.now() / 1000)

  // 1. Valid token for authorized email
  const validClaims = {
    iss: 'https://accounts.google.com',
    aud: 'test-client-id.apps.googleusercontent.com',
    exp: nowSec + 3600,
    email: AUTHORIZED_EMAIL,
    email_verified: true
  }
  const { token: validToken, mockJwk } = await generateTestGoogleIdToken(validClaims)

  const verified = await verifyGoogleIdToken(
    validToken,
    'test-client-id.apps.googleusercontent.com',
    AUTHORIZED_EMAIL,
    { mockKeys: [mockJwk] }
  )
  assert.equal(verified.success, true)
  if (verified.success) {
    assert.equal(verified.email, AUTHORIZED_EMAIL)
  }

  // 2. Reject expired token
  const expiredClaims = { ...validClaims, exp: nowSec - 100 }
  const { token: expiredToken, mockJwk: expJwk } = await generateTestGoogleIdToken(expiredClaims)
  const expRes = await verifyGoogleIdToken(
    expiredToken,
    'test-client-id.apps.googleusercontent.com',
    AUTHORIZED_EMAIL,
    { mockKeys: [expJwk] }
  )
  assert.equal(expRes.success, false)
  if (!expRes.success) {
    assert.match(expRes.error, /expired/i)
  }

  // 3. Reject unverified email
  const unverifiedClaims = { ...validClaims, email_verified: false }
  const { token: unverifiedToken, mockJwk: unvJwk } = await generateTestGoogleIdToken(unverifiedClaims)
  const unvRes = await verifyGoogleIdToken(
    unverifiedToken,
    'test-client-id.apps.googleusercontent.com',
    AUTHORIZED_EMAIL,
    { mockKeys: [unvJwk] }
  )
  assert.equal(unvRes.success, false)
  if (!unvRes.success) {
    assert.match(unvRes.error, /not verified/i)
  }

  // 4. Reject client ID / audience mismatch
  const audRes = await verifyGoogleIdToken(
    validToken,
    'different-client-id',
    AUTHORIZED_EMAIL,
    { mockKeys: [mockJwk] }
  )
  assert.equal(audRes.success, false)
  if (!audRes.success) {
    assert.match(audRes.error, /audience mismatch/i)
  }

  // 5. Reject unauthorized email
  const otherClaims = { ...validClaims, email: 'attacker@gmail.com' }
  const { token: otherToken, mockJwk: otherJwk } = await generateTestGoogleIdToken(otherClaims)
  const otherRes = await verifyGoogleIdToken(
    otherToken,
    'test-client-id.apps.googleusercontent.com',
    AUTHORIZED_EMAIL,
    { mockKeys: [otherJwk] }
  )
  assert.equal(otherRes.success, false)
  if (!otherRes.success) {
    assert.match(otherRes.error, /unauthorized email/i)
  }

  // 6. Reject invalid signature (tampered payload)
  const tamperedPayloadB64 = Buffer.from(JSON.stringify({ ...validClaims, email: 'hacked@gmail.com' })).toString('base64url')
  const [hB64, , sB64] = validToken.split('.')
  const tamperedToken = `${hB64}.${tamperedPayloadB64}.${sB64}`
  const sigRes = await verifyGoogleIdToken(
    tamperedToken,
    'test-client-id.apps.googleusercontent.com',
    AUTHORIZED_EMAIL,
    { mockKeys: [mockJwk] }
  )
  assert.equal(sigRes.success, false)
  if (!sigRes.success) {
    assert.match(sigRes.error, /invalid.*signature/i)
  }

  // 7. Reject invalid issuer
  const badIssClaims = { ...validClaims, iss: 'https://malicious-issuer.com' }
  const { token: badIssToken, mockJwk: badIssJwk } = await generateTestGoogleIdToken(badIssClaims)
  const badIssRes = await verifyGoogleIdToken(
    badIssToken,
    'test-client-id.apps.googleusercontent.com',
    AUTHORIZED_EMAIL,
    { mockKeys: [badIssJwk] }
  )
  assert.equal(badIssRes.success, false)
  if (!badIssRes.success) {
    assert.match(badIssRes.error, /invalid issuer/i)
  }

  // 8. Session token creation supports flexible argument order
  const tok1 = await createSessionToken(VALID_SECRET, AUTHORIZED_EMAIL)
  const tok2 = await createSessionToken(AUTHORIZED_EMAIL, VALID_SECRET)
  assert.ok(tok1.includes('.'))
  assert.ok(tok2.includes('.'))

  // 9. Case-insensitive and trimmed email matching
  const caseClaims = { ...validClaims, email: '  R59MediaTesting@Gmail.Com  ' }
  const { token: caseToken, mockJwk: caseJwk } = await generateTestGoogleIdToken(caseClaims)
  const caseRes = await verifyGoogleIdToken(
    caseToken,
    'test-client-id.apps.googleusercontent.com',
    AUTHORIZED_EMAIL,
    { mockKeys: [caseJwk] }
  )
  assert.equal(caseRes.success, true)

  // 10. Malformed tokens
  const malformed1 = await verifyGoogleIdToken('not-a-jwt')
  assert.equal(malformed1.success, false)
  assert.match(malformed1.error, /malformed/i)

  const malformed2 = await verifyGoogleIdToken('')
  assert.equal(malformed2.success, false)
  assert.match(malformed2.error, /missing/i)

  // 11. Key not found in JWKS
  const unknownKidToken = (await generateTestGoogleIdToken(validClaims, 'unknown-kid')).token
  const noKeyRes = await verifyGoogleIdToken(
    unknownKidToken,
    'test-client-id.apps.googleusercontent.com',
    AUTHORIZED_EMAIL,
    { mockKeys: [mockJwk] }
  )
  assert.equal(noKeyRes.success, false)
  assert.match(noKeyRes.error, /no matching public key/i)
})
