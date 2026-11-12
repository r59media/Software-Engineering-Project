import { useEffect, useRef, useState } from 'react'
import type { BookingReviewDraft, BookingService } from '../../types/booking'
import { submitCheckout } from '../../api/client'
import { previewBookingDepositPercent } from '../../config/booking'

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

function loadSquareSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.Square) return Promise.resolve()

  const isProduction = import.meta.env.VITE_SQUARE_ENVIRONMENT === 'production'
  const scriptUrl = isProduction
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js'

  const existing = document.querySelector<HTMLScriptElement>('script[src*="squarecdn.com"]')
  if (existing) {
    if (window.Square) return Promise.resolve()
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load Square Web Payments SDK script.')), { once: true })
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

interface DepositCheckoutModalProps {
  draft: BookingReviewDraft
  service: BookingService | null
  onClose: () => void
  onSuccess?: (bookingId?: number) => void
  appId?: string
  locationId?: string
}

export function DepositCheckoutModal({
  draft,
  service,
  onClose,
  onSuccess,
  appId,
  locationId,
}: DepositCheckoutModalProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardLoading, setCardLoading] = useState(true)
  const [cardError, setCardError] = useState<string | null>(null)
  const [confirmedResult, setConfirmedResult] = useState<{
    bookingId?: number
    paymentId?: string
    orderId?: string
  } | null>(null)

  const modalRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<SquareCard | null>(null)

  const resolvedAppId =
    appId ||
    import.meta.env.VITE_SQUARE_APPLICATION_ID ||
    import.meta.env.VITE_SQUARE_APP_ID ||
    'sandbox-sq0idb-placeholder'
  const resolvedLocationId =
    locationId ||
    import.meta.env.VITE_SQUARE_LOCATION_ID ||
    'sandbox-location-placeholder'

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
        await loadSquareSdk()
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
  }, [resolvedAppId, resolvedLocationId, confirmedResult])

  const basePriceCents = service?.priceMinor ?? 0
  const depositCents = Math.round(basePriceCents * (previewBookingDepositPercent / 100))
  const depositFormatted =
    basePriceCents > 0
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: service?.currency || 'USD' }).format(
          depositCents / 100
        )
      : 'Custom quote'

  const handlePayDeposit = async () => {
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
          slot_id: 1,
          customer_name: `${draft.customerInfo.firstName} ${draft.customerInfo.lastName}`.trim(),
          customer_email: draft.customerInfo.email.trim(),
          customer_phone: draft.customerInfo.phone?.trim() || '',
          notes: draft.customerInfo.notes?.trim() || '',
          attendees: draft.people,
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
              <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700 }}>
                <span>Deposit Due Today</span>
                <span>{depositFormatted}</span>
              </div>
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
                disabled={busy || cardLoading || Boolean(cardError)}
                style={{
                  flex: 2,
                  padding: '12px',
                  borderRadius: '8px',
                  background: busy || cardLoading || Boolean(cardError) ? '#9ca3af' : '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: busy || cardLoading || Boolean(cardError) ? 'not-allowed' : 'pointer',
                }}
              >
                {busy
                  ? 'Processing Deposit…'
                  : cardLoading
                  ? 'Loading Card Form…'
                  : `Pay ${depositFormatted} Deposit`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
