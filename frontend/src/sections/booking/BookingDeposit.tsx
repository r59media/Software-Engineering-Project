import { useEffect, useRef, useState } from 'react'
import type {
  BookingCustomerInfo,
  BookingDateTimeSelection,
  BookingPhotoPermissions,
  BookingService,
  BookingStep,
  ConfirmedBookingSummary,
} from '../../types/booking'
import {
  computeSessionPricing,
  submitCheckout,
  validateCoupon,
  type PricingData,
} from '../../api/client'
import { previewBookingDepositPercent } from '../../config/booking'
import { BookingProgressBar } from './BookingProgressBar'
import './BookingDeposit.css'

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

function loadSquareSdk(isProductionEnvironment?: boolean): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.Square) return Promise.resolve()

  const isProduction =
    typeof isProductionEnvironment === 'boolean'
      ? isProductionEnvironment
      : import.meta.env.VITE_SQUARE_ENVIRONMENT === 'production'
  const scriptUrl = isProduction
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js'

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

export interface BookingDepositProps {
  service: BookingService
  people: number
  pricing?: PricingData | null
  dateTime: BookingDateTimeSelection
  customerInfo: BookingCustomerInfo
  photoPermissions: BookingPhotoPermissions
  selectedFeeIds?: string[]
  onBack: () => void
  onEdit: (step: BookingStep) => void
  onSuccess?: (summary: ConfirmedBookingSummary) => void
}

export function BookingDeposit({
  service,
  people,
  pricing = null,
  dateTime,
  customerInfo,
  photoPermissions,
  selectedFeeIds = [],
  onBack,
  onEdit,
  onSuccess,
}: BookingDepositProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardLoading, setCardLoading] = useState(true)
  const [cardError, setCardError] = useState<string | null>(null)
  const [isSandboxMode, setIsSandboxMode] = useState(false)

  // Location selection
  const [locationMode, setLocationMode] = useState<'studio' | 'on_location'>('studio')
  const [eventLocation, setEventLocation] = useState('')

  // Agreement & electronic signature
  const [agreementExpanded, setAgreementExpanded] = useState(false)
  const [agreementSignatureName, setAgreementSignatureName] = useState('')

  // Coupon state
  const [couponCodeInput, setCouponCodeInput] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string
    type?: 'percent' | 'fixed'
    amount?: number
  } | null>(null)

  const cardRef = useRef<SquareCard | null>(null)

  const squareConfig = pricing?.squareConfig
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
      !rawLocationId.includes('placeholder')
  )
  const isProductionSquare =
    squareConfig?.environment === 'production' ||
    import.meta.env.VITE_SQUARE_ENVIRONMENT === 'production'

  const currency = pricing?.currency || service?.currency || 'USD'
  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(val)

  const isOnLocation = locationMode === 'on_location'
  const resolvedEventLocation = isOnLocation
    ? eventLocation.trim()
    : 'R59 Media Studio'

  const breakdown = computeSessionPricing(
    service,
    people,
    pricing,
    previewBookingDepositPercent,
    {
      sessionDate: dateTime.date,
      photoPermissions,
      selectedFeeIds,
      isOnLocation,
    }
  )
  const depositPercent = breakdown.depositPercent
  const subtotalDollars = (breakdown.subtotalMinor ?? 0) / 100

  const policy = pricing?.policy ?? {
    balanceDueDaysAfterEvent: 7,
    lateCancellationDays: 7,
    requireSignature: true,
  }
  const requireSignature = policy.requireSignature !== false
  const balanceDueDays = policy.balanceDueDaysAfterEvent
  const lateCancellationDays = policy.lateCancellationDays
  const clientFullName =
    `${customerInfo.firstName} ${customerInfo.lastName}`.trim() || 'Client'

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

  const finalTotalDollars = Math.max(0, subtotalDollars - discountDollars)
  const depositDueDollars =
    Math.round(finalTotalDollars * (depositPercent / 100) * 100) / 100
  const balanceRemainingDollars = Math.max(
    0,
    Math.round((finalTotalDollars - depositDueDollars) * 100) / 100
  )

  const dateFormatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateTime.date}T12:00:00Z`))

  // Initialize Square Card or Sandbox simulator
  useEffect(() => {
    let isMounted = true

    async function initPayment() {
      if (!isSquareConfigured) {
        setIsSandboxMode(true)
        setCardLoading(false)
        return
      }

      setCardLoading(true)
      setCardError(null)

      try {
        await loadSquareSdk(isProductionSquare)
        if (!isMounted) return

        if (!window.Square) {
          throw new Error('Square Web Payments SDK is not available.')
        }

        const payments = window.Square.payments(rawAppId, rawLocationId)
        const card = await payments.card()
        if (!isMounted) {
          await card.destroy()
          return
        }

        const container = document.getElementById('sq-card-container')
        if (container) {
          await card.attach('#sq-card-container')
          if (!isMounted) {
            await card.destroy()
            return
          }
          cardRef.current = card
          setCardLoading(false)
        } else {
          setCardError('Payment form container not found.')
        }
      } catch (err: unknown) {
        if (!isMounted) return
        setCardLoading(false)
        const msg =
          err instanceof Error
            ? err.message
            : 'Failed to initialize payment form.'
        setCardError(msg)
      }
    }

    initPayment()

    return () => {
      isMounted = false
      if (cardRef.current) {
        cardRef.current.destroy().catch(() => {})
        cardRef.current = null
      }
    }
  }, [rawAppId, rawLocationId, isProductionSquare, isSquareConfigured])

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
    setError(null)

    if (isOnLocation && !eventLocation.trim()) {
      setError(
        'Please enter the venue name and street address for your on-location session.'
      )
      return
    }

    if (requireSignature && !agreementSignatureName.trim()) {
      setError(
        'Please type your full legal name to electronically sign the Photography Services Agreement.'
      )
      return
    }

    setBusy(true)

    try {
      let sourceId = 'cnon:card-nonce-ok'

      if (!isSandboxMode && cardRef.current) {
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
        sourceId = result.token
      }

      const slotId = dateTime.slotId ? Number(dateTime.slotId) : 1

      const res = await submitCheckout(
        {
          sourceId,
          idempotencyKey: crypto.randomUUID(),
          service_id: Number(service.id) || 1,
          slot_id: slotId,
          customer_name: clientFullName,
          customer_email: customerInfo.email.trim(),
          customer_phone: customerInfo.phone?.trim() || '',
          notes: customerInfo.notes?.trim() || '',
          attendees: people,
          coupon_code: appliedCoupon ? appliedCoupon.code : undefined,
          selectedFeeIds:
            selectedFeeIds.length > 0 ? selectedFeeIds : undefined,
          locationMode,
          eventLocation: resolvedEventLocation,
          agreementSignatureName: agreementSignatureName.trim() || undefined,
          photoPermissions: {
            websitePortfolio: Boolean(photoPermissions?.websitePortfolio),
            socialMedia: Boolean(photoPermissions?.socialMedia),
          },
        },
        { credentials: 'omit' }
      )

      if (
        res.status === 'success' ||
        res.booking_id ||
        (res.data && res.data.booking_id)
      ) {
        if (cardRef.current) {
          try {
            await cardRef.current.destroy()
          } catch {
            // ignore
          }
          cardRef.current = null
        }
        const bookingId =
          Number(res.booking_id || res.data?.booking_id || res.id) || 1042
        const rescheduleUrl = res.reschedule_url || res.data?.reschedule_url
        const icsUrl = res.ics_url || res.data?.ics_url
        const googleCalendarUrl =
          res.google_calendar_url || res.data?.google_calendar_url

        const confirmedSummary: ConfirmedBookingSummary = {
          bookingId,
          totalCents: Math.round(finalTotalDollars * 100),
          depositPaidCents: Math.round(depositDueDollars * 100),
          balanceDueCents: Math.round(balanceRemainingDollars * 100),
          eventLocation: resolvedEventLocation,
          rescheduleUrl,
          icsUrl,
          googleCalendarUrl,
        }

        onSuccess?.(confirmedSummary)
      } else if (
        isSandboxMode &&
        (res.status === 'error' || res.code === 'NETWORK_ERROR')
      ) {
        // In local development preview mode when the backend is offline:
        const simulatedId = Math.floor(1000 + Math.random() * 9000)
        const confirmedSummary: ConfirmedBookingSummary = {
          bookingId: simulatedId,
          totalCents: Math.round(finalTotalDollars * 100),
          depositPaidCents: Math.round(depositDueDollars * 100),
          balanceDueCents: Math.round(balanceRemainingDollars * 100),
          eventLocation: resolvedEventLocation,
          rescheduleUrl: `${window.location.origin}/reschedule?booking=${simulatedId}&token=demo`,
        }
        onSuccess?.(confirmedSummary)
      } else {
        setError(
          res.message ||
            'Payment processing failed. Please verify your payment details.'
        )
      }
    } catch {
      if (isSandboxMode) {
        const simulatedId = Math.floor(1000 + Math.random() * 9000)
        const confirmedSummary: ConfirmedBookingSummary = {
          bookingId: simulatedId,
          totalCents: Math.round(finalTotalDollars * 100),
          depositPaidCents: Math.round(depositDueDollars * 100),
          balanceDueCents: Math.round(balanceRemainingDollars * 100),
          eventLocation: resolvedEventLocation,
          rescheduleUrl: `${window.location.origin}/reschedule?booking=${simulatedId}&token=demo`,
        }
        onSuccess?.(confirmedSummary)
      } else {
        setError(
          'A network error occurred while submitting checkout. Please try again.'
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="booking-deposit">
      <header className="booking-deposit__header">
        <div className="booking__title-group">
          <p className="booking__eyebrow">
            <span aria-hidden="true" />
            Booking
          </p>
          <h2 id="booking-title">SECURE YOUR DEPOSIT</h2>
        </div>
        <p className="booking-deposit__subtitle">
          Complete your {depositPercent}% deposit to lock in your date &amp;
          time.
        </p>
      </header>

      <BookingProgressBar
        currentStep="deposit"
        onStepClick={step => {
          if (!busy) onEdit(step)
        }}
      />

      <div className="booking-deposit__layout">
        {/* Payment & Options Panel (Left) */}
        <section className="booking-deposit__panel" aria-label="Payment form">
          <h3 className="booking-deposit__panel-title">Payment &amp; Details</h3>

          <div className="booking-deposit__security-badge">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>256-Bit SSL Encrypted · Powered by Square</span>
          </div>

          {/* Location Mode Selector */}
          <div className="booking-deposit__location-group">
            <label className="booking-deposit__location-label">
              Session Location <span style={{ color: 'var(--color-brand-red)' }}>*</span>
            </label>
            <div
              className="booking-deposit__location-options"
              role="group"
              aria-label="Session Location"
            >
              <button
                type="button"
                className="booking-deposit__location-btn"
                aria-pressed={locationMode === 'studio'}
                disabled={busy}
                onClick={() => {
                  setLocationMode('studio')
                  setError(null)
                }}
              >
                At R59 Media Studio
              </button>
              <button
                type="button"
                className="booking-deposit__location-btn"
                aria-pressed={locationMode === 'on_location'}
                disabled={busy}
                onClick={() => {
                  setLocationMode('on_location')
                  setError(null)
                }}
              >
                On-Location / Custom Address
              </button>
            </div>
            {locationMode === 'on_location' && (
              <div className="booking-deposit__location-input-wrap">
                <label
                  htmlFor="deposit-location-input"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    marginBottom: '6px',
                    color: 'var(--color-brand-black)',
                  }}
                >
                  Venue / Street Address{' '}
                  <span style={{ color: 'var(--color-brand-red)' }}>*</span>
                </label>
                <input
                  id="deposit-location-input"
                  type="text"
                  required
                  className="booking-deposit__location-input"
                  placeholder="Enter venue name and street address"
                  value={eventLocation}
                  onChange={e => {
                    setEventLocation(e.target.value)
                    setError(null)
                  }}
                  disabled={busy}
                />
              </div>
            )}
          </div>

          {/* Coupon Code Block */}
          <div className="booking-deposit__coupon-block">
            <label
              htmlFor="deposit-coupon-input"
              className="booking-deposit__coupon-label"
            >
              Have a promotional or discount code?
            </label>
            <div className="booking-deposit__coupon-row">
              <input
                id="deposit-coupon-input"
                type="text"
                className="booking-deposit__coupon-input"
                placeholder="ENTER COUPON CODE"
                value={couponCodeInput}
                onChange={e => {
                  setCouponCodeInput(e.target.value)
                  setCouponError(null)
                }}
                disabled={busy || couponLoading}
              />
              <button
                type="button"
                className="booking-deposit__coupon-btn"
                onClick={handleApplyCoupon}
                disabled={busy || couponLoading || !couponCodeInput.trim()}
              >
                {couponLoading ? 'Checking…' : 'Apply'}
              </button>
            </div>

            {appliedCoupon && (
              <div className="booking-deposit__coupon-success">
                <span>
                  ✓ Coupon <strong>{appliedCoupon.code}</strong> applied (
                  {appliedCoupon.type === 'percent'
                    ? `${appliedCoupon.amount}% off`
                    : `${formatCurrency(appliedCoupon.amount ?? 0)} off`}
                  )
                </span>
                <button
                  type="button"
                  className="booking-deposit__coupon-remove"
                  onClick={() => {
                    setAppliedCoupon(null)
                    setCouponCodeInput('')
                  }}
                  disabled={busy}
                >
                  Remove
                </button>
              </div>
            )}

            {couponError && (
              <p className="booking-deposit__coupon-error" role="alert">
                {couponError}
              </p>
            )}
          </div>

          {/* Photography Services Agreement (6 Clauses) */}
          <div className="booking-deposit__agreement-block">
            <div className="booking-deposit__agreement-header">
              <span className="booking-deposit__agreement-title">
                Photography Services Agreement (6 Clauses)
              </span>
              <button
                type="button"
                className="booking-deposit__agreement-toggle"
                onClick={() => setAgreementExpanded(prev => !prev)}
                aria-expanded={agreementExpanded}
              >
                {agreementExpanded ? 'Hide Agreement' : 'Read Full Agreement'}
              </button>
            </div>

            {agreementExpanded && (
              <div
                className="booking-deposit__agreement-body"
                tabIndex={0}
                role="region"
                aria-label="Photography Services Agreement full text"
              >
                <p>
                  <strong>1. Event Details &amp; Binding Reservation.</strong> This
                  Photography Services Agreement (&ldquo;Agreement&rdquo;) is entered
                  into between R59 Media (&ldquo;Photographer&rdquo;) and{' '}
                  <strong>{clientFullName}</strong> (&ldquo;Client&rdquo;) for{' '}
                  <strong>{service?.name || 'Photography Session'}</strong> on{' '}
                  <strong>{dateFormatted}</strong> ({dateTime.timeSlot}) at{' '}
                  <strong>{resolvedEventLocation}</strong>. Payment of the
                  Non-Refundable Retainer reserves the Photographer&rsquo;s exclusive
                  availability for this session and creates a binding reservation.
                </p>
                <p>
                  <strong>2. Payment Terms.</strong> Total session investment is{' '}
                  <strong>{formatCurrency(finalTotalDollars)}</strong>. A{' '}
                  <strong>{depositPercent}% Non-Refundable Retainer</strong> (
                  {formatCurrency(depositDueDollars)}) is due upon booking. The
                  remaining final balance ({formatCurrency(balanceRemainingDollars)})
                  is due no later than <strong>{balanceDueDays} days</strong> after
                  the event date. <em>Discount Voidance:</em> Any promotional,
                  bundle, or coupon discount applied to this booking is contingent
                  upon timely payment; if the final balance is not received by the
                  deadline, any discounts are voided and the full standard rate
                  applies. <em>Late Payments:</em> Overdue balances may accrue late
                  fees and final edited images or gallery delivery will be withheld
                  until paid in full.
                </p>
                <p>
                  <strong>
                    3. Client Cancellation, Vendor Changes &amp; Liquidated Damages.
                  </strong>{' '}
                  Because the Photographer turns away other bookings for the reserved
                  date, the {depositPercent}% retainer is retained as liquidated
                  damages and not a penalty if the Client cancels. Cancellations or
                  reschedule requests made within{' '}
                  <strong>{lateCancellationDays} days</strong> of the scheduled
                  session (&ldquo;Late Cancellation&rdquo;) forfeit the retainer and
                  may require a new retainer or late-cancellation fee to rebook. If
                  Photographer cannot perform due to unforeseen circumstances, a
                  qualified associate may be substituted or unearned fees refunded.
                </p>
                <p>
                  <strong>4. Copyright, Ownership &amp; Usage License.</strong> R59
                  Media retains full copyright and ownership of all photographs and
                  raw files created under this Agreement. Upon full payment, Client is
                  granted a personal, non-commercial, non-transferable license to print
                  and share the delivered final images. Commercial use, resale, or
                  third-party licensing requires prior written consent.
                </p>
                <p>
                  <strong>
                    5. Model Release &amp; Portfolio Usage / Privacy Fee.
                  </strong>{' '}
                  Client&rsquo;s current sharing selections are Portfolio:{' '}
                  <strong>
                    {photoPermissions.websitePortfolio ? 'Allowed' : 'Declined'}
                  </strong>
                  , Social Media:{' '}
                  <strong>
                    {photoPermissions.socialMedia ? 'Allowed' : 'Declined'}
                  </strong>
                  . Where granted, Client authorizes R59 Media to display selected
                  images for portfolio, website, and social media promotion. If
                  Client declines all public portfolio and social media usage, a
                  Privacy Request Fee applies to cover private delivery and
                  non-promotional archiving.
                </p>
                <p>
                  <strong>
                    6. Limitation of Liability, Force Majeure &amp; Venue Constraints.
                  </strong>{' '}
                  Photographer&rsquo;s total liability for any claim arising out of
                  this Agreement is limited to the total amount actually paid by
                  Client. Neither party is liable for failure to perform due to
                  Force Majeure (including severe weather, illness, acts of God, or
                  government restrictions), in which case the parties will reschedule
                  to a mutually available date. Client is responsible for obtaining
                  any required venue permissions, permits, and entry fees.
                </p>
              </div>
            )}

            {requireSignature && (
              <div className="booking-deposit__signature-wrap">
                <label
                  htmlFor="agreement-signature-input"
                  className="booking-deposit__signature-label"
                >
                  Typed Electronic Signature (Full Legal Name){' '}
                  <span style={{ color: 'var(--color-brand-red)' }}>*</span>
                </label>
                <input
                  id="agreement-signature-input"
                  type="text"
                  required
                  className="booking-deposit__signature-input"
                  placeholder={`Type your full legal name (e.g. ${clientFullName})`}
                  value={agreementSignatureName}
                  onChange={e => {
                    setAgreementSignatureName(e.target.value)
                    setError(null)
                  }}
                  disabled={busy}
                />
                <p className="booking-deposit__signature-note">
                  By typing your full legal name and paying the {depositPercent}%
                  retainer, you electronically sign and agree to all 6 clauses of
                  the Photography Services Agreement.
                </p>
              </div>
            )}
          </div>

          {/* Square Card / Dev Mode Section */}
          <div className="booking-deposit__payment-section">
            <span className="booking-deposit__payment-label">
              Credit or Debit Card
            </span>

            {isSandboxMode ? (
              <div className="booking-deposit__test-card-box">
                <span className="booking-deposit__test-badge">
                  Test Sandbox Mode
                </span>
                <div className="booking-deposit__test-inputs-row">
                  <input
                    type="text"
                    className="booking-deposit__test-input"
                    defaultValue="•••• •••• •••• 4242"
                    aria-label="Card Number"
                    disabled
                  />
                  <input
                    type="text"
                    className="booking-deposit__test-input"
                    defaultValue="12 / 28"
                    aria-label="Expiration Date"
                    disabled
                  />
                  <input
                    type="text"
                    className="booking-deposit__test-input"
                    defaultValue="CVC"
                    aria-label="CVC"
                    disabled
                  />
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: '12px',
                    color: 'var(--color-gray)',
                  }}
                >
                  Square keys are not set in <code>.env</code>. Submitting in this
                  mode securely simulates the full booking &amp; deposit confirmation
                  flow.
                </p>
              </div>
            ) : (
              <div>
                <div
                  id="sq-card-container"
                  className="booking-deposit__card-container"
                />
                {cardLoading && (
                  <p className="booking-deposit__loading-text">
                    Loading official Square secure card form…
                  </p>
                )}
                {cardError && (
                  <p className="booking-deposit__error" role="alert">
                    {cardError}
                  </p>
                )}
              </div>
            )}

            <p className="booking-deposit__compliance-note">
              Card transactions are handled directly through Square&apos;s
              PCI-DSS compliant checkout. R59MEDIA never accesses or stores your
              raw card number.
            </p>

            {error && (
              <p className="booking-deposit__error" role="alert">
                {error}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="booking-deposit__actions">
            <button
              type="button"
              className="booking-deposit__back-btn"
              onClick={onBack}
              disabled={busy}
            >
              ← Back to summary
            </button>
            <button
              type="button"
              className="booking-deposit__submit-btn"
              onClick={handlePayDeposit}
              disabled={
                busy || (!isSandboxMode && (cardLoading || Boolean(cardError)))
              }
            >
              {busy
                ? 'Processing Deposit…'
                : `Pay ${formatCurrency(depositDueDollars)} Deposit & Reserve`}
            </button>
          </div>
        </section>

        {/* Order Summary Sidebar Ticket (Right) */}
        <aside
          className="booking-deposit__summary-ticket"
          aria-label="Session summary"
        >
          <div className="booking-deposit__summary-heading">
            <h3>ORDER SUMMARY</h3>
            <img
              className="booking-deposit__summary-logo"
              src={`${import.meta.env.BASE_URL}r59Media_logo.svg`}
              alt="R59 Media"
              width="72"
              height="45"
            />
          </div>

          <div className="booking-deposit__summary-item">
            <span className="booking-deposit__summary-label">Session</span>
            <span className="booking-deposit__summary-val">{service.name}</span>
            <span className="booking-deposit__summary-sub">
              {service.durationMinutes
                ? `${service.durationMinutes} minutes`
                : '60 minutes'}{' '}
              · {people} {people === 1 ? 'person' : 'people'}
            </span>
          </div>

          <div className="booking-deposit__summary-item">
            <span className="booking-deposit__summary-label">Date &amp; Time</span>
            <span className="booking-deposit__summary-val">{dateFormatted}</span>
            <span className="booking-deposit__summary-sub">
              {dateTime.timeSlot} ·{' '}
              {dateTime.timezone.replace(/^Eastern Time.*$/, 'ET') || 'ET'}
            </span>
          </div>

          <div className="booking-deposit__summary-item">
            <span className="booking-deposit__summary-label">Location</span>
            <span className="booking-deposit__summary-val">
              {resolvedEventLocation}
            </span>
            <span className="booking-deposit__summary-sub">
              {isOnLocation ? 'Client Location' : 'R59 Media Photography Studio'}
            </span>
          </div>

          <div className="booking-deposit__summary-item">
            <span className="booking-deposit__summary-label">Reserved For</span>
            <span className="booking-deposit__summary-val">{clientFullName}</span>
            <span className="booking-deposit__summary-sub">
              {customerInfo.email}
              {customerInfo.phone ? ` · ${customerInfo.phone}` : ''}
            </span>
          </div>

          <div className="booking-deposit__summary-item">
            <span className="booking-deposit__summary-label">
              Photo Permissions
            </span>
            <div
              style={{
                display: 'flex',
                gap: '6px',
                marginTop: '4px',
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: photoPermissions.websitePortfolio
                    ? 'rgba(34, 197, 94, 0.15)'
                    : '#f3f4f6',
                  color: photoPermissions.websitePortfolio
                    ? '#15803d'
                    : '#6b7280',
                }}
              >
                {photoPermissions.websitePortfolio
                  ? '✓ Portfolio: Yes'
                  : '✕ Portfolio: No'}
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '999px',
                  background: photoPermissions.socialMedia
                    ? 'rgba(34, 197, 94, 0.15)'
                    : '#f3f4f6',
                  color: photoPermissions.socialMedia ? '#15803d' : '#6b7280',
                }}
              >
                {photoPermissions.socialMedia
                  ? '✓ Social: Yes'
                  : '✕ Social: No'}
              </span>
            </div>
          </div>

          <div className="booking-deposit__pricing-card">
            <div className="booking-deposit__pricing-row booking-deposit__pricing-row--total">
              <span>Session Total:</span>
              <span>{formatCurrency(finalTotalDollars)}</span>
            </div>

            {discountDollars > 0 && (
              <div
                className="booking-deposit__pricing-row"
                style={{ color: '#4ade80' }}
              >
                <span>Discount ({appliedCoupon?.code}):</span>
                <span>-{formatCurrency(discountDollars)}</span>
              </div>
            )}

            <div className="booking-deposit__pricing-row booking-deposit__pricing-row--due">
              <span className="booking-deposit__due-badge">
                {depositPercent}% DEPOSIT
              </span>
              <span style={{ fontSize: '18px', color: 'var(--color-white)' }}>
                {formatCurrency(depositDueDollars)}
              </span>
            </div>

            <p className="booking-deposit__pricing-note">
              Due today: {formatCurrency(depositDueDollars)}. Remaining balance (
              {formatCurrency(balanceRemainingDollars)}) is paid within{' '}
              {balanceDueDays} days after your session.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
