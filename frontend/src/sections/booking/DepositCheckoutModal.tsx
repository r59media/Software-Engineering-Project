import { useEffect, useRef, useState } from 'react'
import type { BookingReviewDraft, BookingService, SquareConfig } from '../../types/booking'
import { computeSessionPricing, submitCheckout, fetchPricing, validateCoupon, type PricingData } from '../../api/client'
import { fallbackBookingDepositPercent } from '../../config/booking'

declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => SquarePayments
    }
  }
}

interface TokenizeResult {
  status: string
  token?: string
  errors?: Array<{ message: string; type?: string; field?: string }>
}

interface SquareCard {
  attach: (selectorOrElement: string | HTMLElement) => Promise<void>
  tokenize: () => Promise<TokenizeResult>
  destroy: () => Promise<boolean>
}

interface SquarePayments {
  card: (options?: Record<string, unknown>) => Promise<SquareCard>
}

function loadSquareSdk(environment: 'sandbox' | 'production'): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.Square) return Promise.resolve()

  const scriptUrl = environment === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js'

  const existing = document.querySelector<HTMLScriptElement>('script[src*="squarecdn.com"]')
  if (existing) {
    if (existing.src === scriptUrl) {
      if (window.Square) return Promise.resolve()
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('Failed to load Square Web Payments SDK script.')), { once: true })
      })
    }
    existing.remove()
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

interface DepositCheckoutModalProps {
  draft: BookingReviewDraft
  service: BookingService | null
  onClose: () => void
  onSuccess?: (bookingId?: number) => void
  squareConfig?: SquareConfig | null
  appId?: string
  locationId?: string
}

export function DepositCheckoutModal({
  draft,
  service,
  onClose,
  onSuccess,
  squareConfig,
  appId,
  locationId,
}: DepositCheckoutModalProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardLoading, setCardLoading] = useState(true)
  const [cardError, setCardError] = useState<string | null>(null)
  const [pricing, setPricing] = useState<PricingData | null>(null)
  const [couponCodeInput, setCouponCodeInput] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string
    type?: 'percent' | 'fixed'
    amount?: number
  } | null>(null)
  const [confirmedResult, setConfirmedResult] = useState<{
    bookingId?: number
    paymentId?: string
    orderId?: string
  } | null>(null)

  const modalRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<SquareCard | null>(null)

  const resolvedSquareConfig = pricing?.squareConfig ?? squareConfig ?? null
  const resolvedAppId =
    resolvedSquareConfig?.applicationId ||
    appId ||
    import.meta.env.VITE_SQUARE_APPLICATION_ID ||
    import.meta.env.VITE_SQUARE_APP_ID ||
    'sandbox-sq0idb-placeholder'
  const resolvedLocationId =
    resolvedSquareConfig?.locationId ||
    locationId ||
    import.meta.env.VITE_SQUARE_LOCATION_ID ||
    'sandbox-location-placeholder'
  const resolvedEnvironment: 'sandbox' | 'production' =
    resolvedSquareConfig?.environment ||
    (import.meta.env.VITE_SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox')

  useEffect(() => {
    let active = true
    void fetchPricing().then(p => {
      if (active && p) setPricing(p)
    }).catch(() => {})
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose])

  useEffect(() => {
    let isMounted = true

    async function initCard() {
      if (confirmedResult) return
      setCardLoading(true)
      setCardError(null)

      try {
        await loadSquareSdk(resolvedEnvironment)
        if (!isMounted) return

        if (!window.Square) {
          throw new Error('Square Web Payments SDK is not available.')
        }

        const payments = window.Square.payments(resolvedAppId, resolvedLocationId)
        const card = await payments.card()
        if (!isMounted) {
          await card.destroy()
          return
        }

        await card.attach('#card-container')
        if (!isMounted) {
          await card.destroy()
          return
        }

        cardRef.current = card
        setCardLoading(false)
      } catch (err: unknown) {
        if (!isMounted) return
        setCardLoading(false)
        const msg = err instanceof Error ? err.message : 'Failed to initialize payment form.'
        setCardError(msg)
      }
    }

    initCard()

    return () => {
      isMounted = false
      if (cardRef.current) {
        cardRef.current.destroy().catch(() => {})
        cardRef.current = null
      }
    }
  }, [resolvedAppId, resolvedLocationId, resolvedEnvironment, confirmedResult])

  const slotId = draft.dateTime?.slotId ?? draft.slotId ?? draft.slot_id

  const currency = pricing?.currency || service?.currency || 'USD'
  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(val)

  const attendees = draft.people || 1
  const breakdown = computeSessionPricing(service, attendees, pricing, fallbackBookingDepositPercent)
  const depositPercent = breakdown.depositPercent
  const baseFeeDollars = breakdown.baseFeeMinor / 100
  const attendeeFeeDollars = breakdown.extraPeopleFeeMinor / 100
  const subtotalDollars = (breakdown.subtotalMinor ?? 0) / 100

  let discountDollars = 0
  if (appliedCoupon && subtotalDollars > 0) {
    if (appliedCoupon.type === 'percent') {
      const pct = Math.min(100, Math.max(0, appliedCoupon.amount ?? 0))
      discountDollars = subtotalDollars * (pct / 100)
    } else {
      const amt = Math.max(0, appliedCoupon.amount ?? 0)
      discountDollars = Math.min(amt, subtotalDollars)
    }
  }

  const estimatedTotalDollars = Math.max(0, subtotalDollars - discountDollars)
  const estimatedDepositDollars = Math.round(estimatedTotalDollars * (depositPercent / 100) * 100) / 100

  const depositFormatted =
    subtotalDollars > 0
      ? formatCurrency(estimatedDepositDollars)
      : 'Custom quote'

  const handleApplyCoupon = async () => {
    const code = couponCodeInput.trim()
    if (!code) return
    setCouponLoading(true)
    setCouponError(null)
    try {
      const res = await validateCoupon(code)
      if (res.valid) {
        setAppliedCoupon({
          code: code.toUpperCase(),
          type: res.type,
          amount: res.amount,
        })
        setCouponError(null)
      } else {
        setAppliedCoupon(null)
        setCouponError(res.message || 'Invalid or expired coupon code.')
      }
    } catch {
      setCouponError('Unable to validate coupon code.')
    } finally {
      setCouponLoading(false)
    }
  }

  const handlePayDeposit = async () => {
    if (!slotId) {
      setError('Please select an available appointment time slot to continue.')
      return
    }

    if (!cardRef.current) {
      setError('Payment card form is not ready yet. Please wait a moment and try again.')
      return
    }

    setBusy(true)
    setError(null)

    try {
      const result = await cardRef.current.tokenize()
      if (result.status !== 'OK' || !result.token) {
        const errorMsg =
          result.errors && result.errors.length > 0
            ? result.errors.map(e => e.message).join(' ')
            : 'Payment card tokenization failed. Please verify your card details.'
        setError(errorMsg)
        setBusy(false)
        return
      }

      const sourceId = result.token

      const res = await submitCheckout(
        {
          sourceId,
          idempotencyKey: crypto.randomUUID(),
          service_id: Number(draft.serviceId) || (service ? Number(service.id) : 1),
          slot_id: Number(slotId),
          customer_name: `${draft.customerInfo.firstName} ${draft.customerInfo.lastName}`.trim(),
          customer_email: draft.customerInfo.email.trim(),
          customer_phone: draft.customerInfo.phone?.trim() || '',
          notes: draft.customerInfo.notes?.trim() || '',
          attendees: draft.people,
          coupon_code: appliedCoupon ? appliedCoupon.code : undefined,
          photoPermissions: {
            websitePortfolio: Boolean(draft.photoPermissions?.websitePortfolio),
            socialMedia: Boolean(draft.photoPermissions?.socialMedia),
          },
        },
        { credentials: 'omit' }
      )

      if (res.status === 'success' || res.booking_id || (res.data && res.data.booking_id)) {
        if (cardRef.current) {
          try {
            await cardRef.current.destroy()
          } catch {
            // ignore
          }
          cardRef.current = null
        }
        const bookingId = res.booking_id || res.data?.booking_id || res.id
        setConfirmedResult({
          bookingId,
          paymentId: res.payment_id || res.data?.payment_id,
          orderId: res.order_id || res.data?.order_id,
        })
        onSuccess?.(bookingId)
      } else {
        setError(res.message || 'Payment processing failed. Please verify your payment details.')
      }
    } catch {
      setError('A network error occurred while submitting checkout. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="deposit-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-modal-title"
        style={{
          width: 'min(100%, 560px)',
          background: '#ffffff',
          color: '#111827',
          borderRadius: '12px',
          padding: '28px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          position: 'relative',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close deposit modal"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'transparent',
            border: 'none',
            fontSize: '22px',
            cursor: 'pointer',
            lineHeight: 1,
            color: '#6b7280',
          }}
        >
          ×
        </button>

        {confirmedResult ? (
          <div>
            <div style={{ textAlign: 'center', marginBlock: '16px' }}>
              <div style={{ fontSize: '48px', marginBottom: '8px' }}>✓</div>
              <h3 id="deposit-modal-title" style={{ fontSize: '24px', margin: '0 0 8px 0', fontWeight: 700 }}>
                Deposit Confirmed!
              </h3>
              <p style={{ color: '#4b5563', margin: 0, fontSize: '15px' }}>
                Your booking #{confirmedResult.bookingId || 'Confirmed'} is secured.
              </p>
            </div>

            <div
              style={{
                background: '#f9fafb',
                borderRadius: '8px',
                padding: '16px',
                margin: '16px 0',
                fontSize: '14px',
              }}
            >
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>Client:</strong> {draft.customerInfo.firstName} {draft.customerInfo.lastName}
              </p>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>Service:</strong> {service?.name || draft.serviceId}
              </p>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>Appointment:</strong> {draft.dateTime.date} at {draft.dateTime.timeSlot}
              </p>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>Deposit Paid:</strong> {depositFormatted}
              </p>
              <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '12px 0' }} />
              <p style={{ margin: '0 0 4px 0', fontWeight: 600 }}>Photo Sharing Consent Acknowledgment:</p>
              <p style={{ margin: 0, color: '#374151' }}>
                Website &amp; Portfolio:{' '}
                <strong>{draft.photoPermissions.websitePortfolio ? 'Granted (Yes)' : 'Declined (No)'}</strong>
              </p>
              <p style={{ margin: 0, color: '#374151' }}>
                Social Media:{' '}
                <strong>{draft.photoPermissions.socialMedia ? 'Granted (Yes)' : 'Declined (No)'}</strong>
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                background: '#111827',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '15px',
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <div>
            <h3 id="deposit-modal-title" style={{ fontSize: '22px', margin: '0 0 16px 0', fontWeight: 700 }}>
              Confirm Deposit &amp; Reserve Session
            </h3>

            <div
              style={{
                background: '#f9fafb',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px',
                fontSize: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#4b5563' }}>Package</span>
                <strong>{service?.name || draft.serviceId}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#4b5563' }}>Date &amp; Time</span>
                <span>
                  {draft.dateTime.date} ({draft.dateTime.timeSlot})
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#4b5563' }}>Client</span>
                <span>
                  {draft.customerInfo.firstName} {draft.customerInfo.lastName}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#4b5563' }}>Attendees</span>
                <span>
                  {draft.people} {draft.people === 1 ? 'person' : 'people'}
                </span>
              </div>
              {baseFeeDollars > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                  <span style={{ color: '#6b7280' }}>Base Fee</span>
                  <span>{formatCurrency(baseFeeDollars)}</span>
                </div>
              )}
              {attendeeFeeDollars > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                  <span style={{ color: '#6b7280' }}>Attendees Fee</span>
                  <span>{formatCurrency(attendeeFeeDollars)}</span>
                </div>
              )}
              {discountDollars > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#15803d' }}>
                  <span>Discount ({appliedCoupon?.code})</span>
                  <span>-{formatCurrency(discountDollars)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#4b5563' }}>Estimated Total</span>
                <strong>{subtotalDollars > 0 ? formatCurrency(estimatedTotalDollars) : 'Custom quote'}</strong>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700 }}>
                <span>Estimated Deposit Due Today ({depositPercent}%)</span>
                <span>{depositFormatted}</span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#6b7280', fontStyle: 'italic' }}>
                * Estimated breakdown; final charge is calculated by the server.
              </p>
            </div>

            <div
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '16px',
                fontSize: '13px',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>📸 Photo Sharing Compliance Preference:</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: draft.photoPermissions.websitePortfolio ? 'rgba(34, 197, 94, 0.15)' : '#f3f4f6',
                    color: draft.photoPermissions.websitePortfolio ? '#15803d' : '#6b7280',
                    border: draft.photoPermissions.websitePortfolio
                      ? '1px solid rgba(34, 197, 94, 0.3)'
                      : '1px solid #d1d5db',
                  }}
                >
                  {draft.photoPermissions.websitePortfolio ? '✓ Portfolio: Allowed' : '✕ Portfolio: Declined'}
                </span>
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: draft.photoPermissions.socialMedia ? 'rgba(34, 197, 94, 0.15)' : '#f3f4f6',
                    color: draft.photoPermissions.socialMedia ? '#15803d' : '#6b7280',
                    border: draft.photoPermissions.socialMedia
                      ? '1px solid rgba(34, 197, 94, 0.3)'
                      : '1px solid #d1d5db',
                  }}
                >
                  {draft.photoPermissions.socialMedia ? '✓ Social: Allowed' : '✕ Social: Declined'}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="coupon-code-input"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: '6px',
                }}
              >
                Coupon Code
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  id="coupon-code-input"
                  type="text"
                  placeholder="Enter coupon code"
                  value={couponCodeInput}
                  onChange={e => {
                    setCouponCodeInput(e.target.value)
                    setCouponError(null)
                  }}
                  disabled={busy || couponLoading}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #d1d5db',
                    fontSize: '14px',
                    textTransform: 'uppercase',
                  }}
                />
                <button
                  type="button"
                  onClick={handleApplyCoupon}
                  disabled={busy || couponLoading || !couponCodeInput.trim()}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    background: busy || couponLoading || !couponCodeInput.trim() ? '#9ca3af' : '#1f2937',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: busy || couponLoading || !couponCodeInput.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {couponLoading ? 'Checking…' : 'Apply'}
                </button>
              </div>
              {appliedCoupon && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '8px',
                    padding: '6px 10px',
                    background: '#ecfdf5',
                    borderRadius: '6px',
                    color: '#065f46',
                    fontSize: '13px',
                  }}
                >
                  <span>
                    ✓ Coupon <strong>{appliedCoupon.code}</strong> applied (
                    {appliedCoupon.type === 'percent'
                      ? `${appliedCoupon.amount}% off`
                      : `${formatCurrency(appliedCoupon.amount ?? 0)} off`}
                    )
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAppliedCoupon(null)
                      setCouponCodeInput('')
                    }}
                    disabled={busy}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#065f46',
                      cursor: 'pointer',
                      fontSize: '12px',
                      textDecoration: 'underline',
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
              {couponError && (
                <p role="alert" style={{ color: '#dc2626', fontSize: '13px', margin: '6px 0 0 0' }}>
                  {couponError}
                </p>
              )}
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="card-container"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: '8px',
                }}
              >
                Card Information
              </label>
              <div
                id="card-container"
                style={{
                  minHeight: '88px',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid #d1d5db',
                  background: '#ffffff',
                }}
              />
              {cardLoading && (
                <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#6b7280' }}>
                  Loading secure payment form…
                </p>
              )}
            </div>

            {!slotId && (
              <p role="alert" style={{ color: '#dc2626', fontSize: '14px', margin: '0 0 12px 0' }}>
                Please select an available appointment time slot to continue.
              </p>
            )}

            {(cardError || error) && (
              <p role="alert" style={{ color: '#dc2626', fontSize: '14px', margin: '0 0 12px 0' }}>
                {cardError || error}
              </p>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '8px',
                  background: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handlePayDeposit}
                disabled={busy || cardLoading || Boolean(cardError) || !slotId}
                style={{
                  flex: 2,
                  padding: '12px',
                  borderRadius: '8px',
                  background: busy || cardLoading || Boolean(cardError) || !slotId ? '#9ca3af' : '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: busy || cardLoading || Boolean(cardError) || !slotId ? 'not-allowed' : 'pointer',
                }}
              >
                {busy
                  ? 'Processing Deposit…'
                  : cardLoading
                  ? 'Loading Card Form…'
                  : !slotId
                  ? 'Select a Slot to Continue'
                  : `Pay ${depositFormatted} Deposit`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
