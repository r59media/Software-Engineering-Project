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
  pricing?: PricingData | null
  selectedFeeIds?: string[]
  onClose: () => void
  onSuccess?: (bookingId?: number) => void
  squareConfig?: SquareConfig | null
  appId?: string
  locationId?: string
}

export function DepositCheckoutModal({
  draft,
  service,
  pricing: initialPricing = null,
  selectedFeeIds: propSelectedFeeIds,
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
  const [pricing, setPricing] = useState<PricingData | null>(initialPricing)
  const [eventLocation, setEventLocation] = useState('')
  const [agreementExpanded, setAgreementExpanded] = useState(false)
  const [agreementSignatureName, setAgreementSignatureName] = useState('')
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
    rescheduleToken?: string
    rescheduleUrl?: string
    icsUrl?: string
    googleCalendarUrl?: string
  } | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

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
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
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
  const effectiveSelectedFeeIds = draft.selectedFeeIds ?? propSelectedFeeIds ?? []
  const breakdown = computeSessionPricing(service, attendees, pricing, fallbackBookingDepositPercent, {
    sessionDate: draft.dateTime.date,
    photoPermissions: draft.photoPermissions,
    selectedFeeIds: effectiveSelectedFeeIds,
  })
  const depositPercent = breakdown.depositPercent
  const baseFeeDollars = breakdown.baseFeeMinor / 100
  const attendeeFeeDollars = breakdown.extraPeopleFeeMinor / 100
  const subtotalDollars = (breakdown.subtotalMinor ?? 0) / 100

  const policy = pricing?.policy ?? {
    balanceDueDaysAfterEvent: 7,
    lateCancellationDays: 7,
    requireSignature: true,
  }
  const requireSignature = policy.requireSignature !== false
  const balanceDueDays = policy.balanceDueDaysAfterEvent
  const lateCancellationDays = policy.lateCancellationDays
  const clientFullName = `${draft.customerInfo.firstName} ${draft.customerInfo.lastName}`.trim() || 'Client'

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
  const estimatedRemainingDollars = Math.max(0, Math.round((estimatedTotalDollars - estimatedDepositDollars) * 100) / 100)

  const depositFormatted =
    subtotalDollars > 0
      ? formatCurrency(estimatedDepositDollars)
      : 'Custom quote'
  const totalFormatted =
    subtotalDollars > 0
      ? formatCurrency(estimatedTotalDollars)
      : 'Custom quote'
  const remainingFormatted =
    subtotalDollars > 0
      ? formatCurrency(estimatedRemainingDollars)
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

    if (requireSignature && !agreementSignatureName.trim()) {
      setError('Please enter your Full Legal Name to sign the Photography Services Agreement.')
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
          selectedFeeIds: effectiveSelectedFeeIds.length > 0 ? effectiveSelectedFeeIds : undefined,
          eventLocation: eventLocation.trim() || undefined,
          agreementSignatureName: agreementSignatureName.trim() || undefined,
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
          rescheduleToken: res.reschedule_token || res.data?.reschedule_token,
          rescheduleUrl: res.reschedule_url || res.data?.reschedule_url,
          icsUrl: res.ics_url || res.data?.ics_url,
          googleCalendarUrl: res.google_calendar_url || res.data?.google_calendar_url,
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

            {confirmedResult.rescheduleUrl && (
              <div
                style={{
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '14px',
                  margin: '0 0 16px 0',
                  fontSize: '13px',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '6px', color: '#111827' }}>
                  Manage / Reschedule Link
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    readOnly
                    aria-label="Manage or reschedule link"
                    value={
                      confirmedResult.rescheduleUrl.startsWith('/')
                        ? `${window.location.origin}${confirmedResult.rescheduleUrl}`
                        : confirmedResult.rescheduleUrl
                    }
                    onClick={e => e.currentTarget.select()}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      background: '#ffffff',
                      color: '#374151',
                      fontSize: '12px',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const rawUrl = confirmedResult.rescheduleUrl || ''
                      const fullUrl = rawUrl.startsWith('/') ? `${window.location.origin}${rawUrl}` : rawUrl
                      void navigator.clipboard?.writeText(fullUrl).then(() => {
                        setCopiedLink(true)
                        if (copyTimerRef.current !== null) {
                          window.clearTimeout(copyTimerRef.current)
                        }
                        copyTimerRef.current = window.setTimeout(() => {
                          setCopiedLink(false)
                          copyTimerRef.current = null
                        }, 2500)
                      })
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: copiedLink ? '#15803d' : '#1f2937',
                      color: '#ffffff',
                      border: 'none',
                      fontWeight: 600,
                      fontSize: '12px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {copiedLink ? 'Copied!' : 'Copy Reschedule Link'}
                  </button>
                </div>
              </div>
            )}

            {(confirmedResult.googleCalendarUrl || confirmedResult.icsUrl) && (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {confirmedResult.googleCalendarUrl && (
                  <a
                    href={confirmedResult.googleCalendarUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1,
                      minWidth: '160px',
                      textAlign: 'center',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: '#f3f4f6',
                      color: '#111827',
                      border: '1px solid #d1d5db',
                      fontWeight: 600,
                      fontSize: '13px',
                      textDecoration: 'none',
                    }}
                  >
                    Add to Google Calendar
                  </a>
                )}
                {confirmedResult.icsUrl && (
                  <a
                    href={confirmedResult.icsUrl}
                    download
                    style={{
                      flex: 1,
                      minWidth: '160px',
                      textAlign: 'center',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: '#f3f4f6',
                      color: '#111827',
                      border: '1px solid #d1d5db',
                      fontWeight: 600,
                      fontSize: '13px',
                      textDecoration: 'none',
                    }}
                  >
                    Download Calendar Invite (.ics)
                  </a>
                )}
              </div>
            )}

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
              {breakdown.appliedFees.map(fee => (
                <div key={fee.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                  <span style={{ color: '#6b7280' }}>{fee.name}</span>
                  <span>{formatCurrency(fee.amountDollars)}</span>
                </div>
              ))}
              {discountDollars > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px', color: '#15803d' }}>
                  <span>Discount ({appliedCoupon?.code})</span>
                  <span>-{formatCurrency(discountDollars)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#4b5563' }}>Estimated Total</span>
                <strong>{totalFormatted}</strong>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700 }}>
                <span>{depositPercent}% Non-Refundable Retainer Due Today</span>
                <span>{depositFormatted}</span>
              </div>
              {subtotalDollars > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '13px', color: '#4b5563' }}>
                  <span>Remaining Balance (due {balanceDueDays} days after event)</span>
                  <span>{remainingFormatted}</span>
                </div>
              )}
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#6b7280', fontStyle: 'italic' }}>
                * Estimated breakdown; final charge is calculated by the server.
              </p>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="event-location-input"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: '6px',
                }}
              >
                Event / Session Location <span style={{ fontWeight: 400, color: '#6b7280' }}>(Optional)</span>
              </label>
              <input
                id="event-location-input"
                type="text"
                placeholder="Studio, venue name, or street address"
                value={eventLocation}
                onChange={e => setEventLocation(e.target.value)}
                disabled={busy}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  fontSize: '14px',
                }}
              />
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

            <div
              style={{
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '16px',
                background: '#f9fafb',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>
                  Photography Services Agreement (6 Clauses)
                </span>
                <button
                  type="button"
                  onClick={() => setAgreementExpanded(prev => !prev)}
                  aria-expanded={agreementExpanded}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#dc2626',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: '4px 0',
                  }}
                >
                  {agreementExpanded ? 'Hide Agreement' : 'Read Full Agreement'}
                </button>
              </div>
              {agreementExpanded && (
                <div
                  style={{
                    marginTop: '10px',
                    maxHeight: '220px',
                    overflowY: 'auto',
                    padding: '12px',
                    background: '#ffffff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    fontSize: '12px',
                    lineHeight: 1.55,
                    color: '#374151',
                  }}
                >
                  <p style={{ margin: '0 0 8px 0' }}>
                    <strong>1. Event Details &amp; Binding Reservation.</strong> This Photography Services Agreement
                    (&ldquo;Agreement&rdquo;) is entered into between R59 Media (&ldquo;Photographer&rdquo;) and{' '}
                    <strong>{clientFullName}</strong> (&ldquo;Client&rdquo;) for{' '}
                    <strong>{service?.name || draft.serviceId}</strong> on{' '}
                    <strong>{draft.dateTime.date}</strong> ({draft.dateTime.timeSlot}) at{' '}
                    <strong>{eventLocation.trim() || 'Location to be confirmed'}</strong>. Payment of the
                    Non-Refundable Retainer reserves the Photographer&rsquo;s exclusive availability for this session
                    and creates a binding reservation.
                  </p>
                  <p style={{ margin: '0 0 8px 0' }}>
                    <strong>2. Payment Terms.</strong> Total session investment is <strong>{totalFormatted}</strong>.
                    A <strong>{depositPercent}% Non-Refundable Retainer</strong> ({depositFormatted}) is due upon
                    booking. The remaining final balance ({remainingFormatted}) is due no later than{' '}
                    <strong>{balanceDueDays} days</strong> after the event date.{' '}
                    <em>Discount Voidance:</em> Any promotional, bundle, or coupon discount applied to this booking is
                    contingent upon timely payment; if the final balance is not received by the deadline, any
                    discounts are voided and the full standard rate applies. <em>Late Payments:</em> Overdue balances
                    may accrue late fees and final edited images or gallery delivery will be withheld until paid in
                    full.
                  </p>
                  <p style={{ margin: '0 0 8px 0' }}>
                    <strong>3. Client Cancellation, Vendor Changes &amp; Liquidated Damages.</strong> Because the
                    Photographer turns away other bookings for the reserved date, the {depositPercent}% retainer is
                    retained as liquidated damages and not a penalty if the Client cancels. Cancellations or
                    reschedule requests made within <strong>{lateCancellationDays} days</strong> of the scheduled
                    session (&ldquo;Late Cancellation&rdquo;) forfeit the retainer and may require a new retainer or
                    late-cancellation fee to rebook. If Photographer cannot perform due to unforeseen circumstances,
                    a qualified associate may be substituted or unearned fees refunded.
                  </p>
                  <p style={{ margin: '0 0 8px 0' }}>
                    <strong>4. Copyright, Ownership &amp; Usage License.</strong> R59 Media retains full copyright and
                    ownership of all photographs and raw files created under this Agreement. Upon full payment,
                    Client is granted a personal, non-commercial, non-transferable license to print and share the
                    delivered final images. Commercial use, resale, or third-party licensing requires prior written
                    consent.
                  </p>
                  <p style={{ margin: '0 0 8px 0' }}>
                    <strong>5. Model Release &amp; Portfolio Usage / Privacy Fee.</strong> Client&rsquo;s current
                    sharing selections are Portfolio:{' '}
                    <strong>{draft.photoPermissions.websitePortfolio ? 'Allowed' : 'Declined'}</strong>, Social
                    Media: <strong>{draft.photoPermissions.socialMedia ? 'Allowed' : 'Declined'}</strong>. Where
                    granted, Client authorizes R59 Media to display selected images for portfolio, website, and social
                    media promotion. If Client declines all public portfolio and social media usage, a Privacy Request
                    Fee (when enabled) applies to cover private delivery and non-promotional archiving.
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>6. Limitation of Liability, Force Majeure &amp; Venue Constraints.</strong> Photographer&rsquo;s
                    total liability for any claim arising out of this Agreement is limited to the total amount
                    actually paid by Client. Neither party is liable for failure to perform due to Force Majeure
                    (including severe weather, illness, acts of God, or government restrictions), in which case the
                    parties will reschedule to a mutually available date. Client is responsible for obtaining any
                    required venue permissions, permits, and entry fees, and Photographer is not responsible for
                    compromised coverage caused by venue restrictions.
                  </p>
                </div>
              )}

              {requireSignature && (
                <div style={{ marginTop: '12px' }}>
                  <label
                    htmlFor="agreement-signature-input"
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#111827',
                      marginBottom: '6px',
                    }}
                  >
                    Typed Electronic Signature (Full Legal Name) <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    id="agreement-signature-input"
                    type="text"
                    required
                    placeholder={`Type your full legal name (e.g. ${clientFullName})`}
                    value={agreementSignatureName}
                    onChange={e => setAgreementSignatureName(e.target.value)}
                    disabled={busy}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      fontSize: '14px',
                      fontFamily: 'Georgia, serif',
                      fontStyle: 'italic',
                    }}
                  />
                  <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#6b7280' }}>
                    By typing your full legal name and paying the {depositPercent}% retainer, you electronically sign
                    and agree to all 6 clauses of the Photography Services Agreement.
                  </p>
                </div>
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
                disabled={busy || cardLoading || Boolean(cardError) || !slotId || (requireSignature && !agreementSignatureName.trim())}
                style={{
                  flex: 2,
                  padding: '12px',
                  borderRadius: '8px',
                  background:
                    busy || cardLoading || Boolean(cardError) || !slotId || (requireSignature && !agreementSignatureName.trim())
                      ? '#9ca3af'
                      : '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor:
                    busy || cardLoading || Boolean(cardError) || !slotId || (requireSignature && !agreementSignatureName.trim())
                      ? 'not-allowed'
                      : 'pointer',
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
