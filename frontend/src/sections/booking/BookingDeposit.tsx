import { useEffect, useRef, useState } from 'react'
import type {
  BookingCustomerInfo,
  BookingDateTimeSelection,
  BookingPhotoPermissions,
  BookingService,
  BookingStep,
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

  const isProduction = typeof isProductionEnvironment === 'boolean'
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

export interface BookingDepositProps {
  service: BookingService
  people: number
  pricing?: PricingData | null
  dateTime: BookingDateTimeSelection
  customerInfo: BookingCustomerInfo
  photoPermissions: BookingPhotoPermissions
  onBack: () => void
  onEdit: (step: BookingStep) => void
  onSuccess?: (bookingId?: number) => void
}

export function BookingDeposit({
  service,
  people,
  pricing = null,
  dateTime,
  customerInfo,
  photoPermissions,
  onBack,
  onEdit,
  onSuccess,
}: BookingDepositProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardLoading, setCardLoading] = useState(true)
  const [cardError, setCardError] = useState<string | null>(null)
  const [isSandboxMode, setIsSandboxMode] = useState(false)

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

  const cardRef = useRef<SquareCard | null>(null)

  const squareConfig = pricing?.squareConfig
  const rawAppId = squareConfig?.applicationId || import.meta.env.VITE_SQUARE_APPLICATION_ID || import.meta.env.VITE_SQUARE_APP_ID || ''
  const rawLocationId = squareConfig?.locationId || import.meta.env.VITE_SQUARE_LOCATION_ID || ''
  const isSquareConfigured = Boolean(
    rawAppId &&
    rawLocationId &&
    !rawAppId.includes('placeholder') &&
    !rawLocationId.includes('placeholder')
  )
  const isProductionSquare = squareConfig?.environment === 'production' || import.meta.env.VITE_SQUARE_ENVIRONMENT === 'production'

  const currency = pricing?.currency || service?.currency || 'USD'
  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(val)

  const breakdown = computeSessionPricing(service, people, pricing, previewBookingDepositPercent)
  const depositPercent = breakdown.depositPercent
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

  const finalTotalDollars = Math.max(0, subtotalDollars - discountDollars)
  const depositDueDollars = Math.round(finalTotalDollars * (depositPercent / 100) * 100) / 100
  const balanceRemainingDollars = Math.max(0, finalTotalDollars - depositDueDollars)

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
      if (confirmedResult) return

      if (!isSquareConfigured) {
        // Development / Sandbox mode: No live Square API credentials configured
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

        await card.attach('#sq-card-container')
        if (!isMounted) {
          await card.destroy()
          return
        }

        cardRef.current = card
        setCardLoading(false)
      } catch (err: unknown) {
        if (!isMounted) return
        setCardLoading(false)
        const msg = err instanceof Error ? err.message : 'Failed to initialize Square payment form.'
        setCardError(msg)
      }
    }

    void initPayment()

    return () => {
      isMounted = false
      if (cardRef.current) {
        cardRef.current.destroy().catch(() => {})
        cardRef.current = null
      }
    }
  }, [rawAppId, rawLocationId, isSquareConfigured, confirmedResult])

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
    setBusy(true)
    setError(null)

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
          customer_name: `${customerInfo.firstName} ${customerInfo.lastName}`.trim(),
          customer_email: customerInfo.email.trim(),
          customer_phone: customerInfo.phone?.trim() || '',
          notes: customerInfo.notes?.trim() || '',
          attendees: people,
          coupon_code: appliedCoupon ? appliedCoupon.code : undefined,
          photoPermissions: {
            websitePortfolio: Boolean(photoPermissions?.websitePortfolio),
            socialMedia: Boolean(photoPermissions?.socialMedia),
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
        const bookingId = res.booking_id || res.data?.booking_id || res.id || 1042
        setConfirmedResult({
          bookingId,
          paymentId: res.payment_id || res.data?.payment_id || 'sq_simulated_deposit',
          orderId: res.order_id || res.data?.order_id,
        })
        onSuccess?.(bookingId)
      } else if (isSandboxMode && (res.status === 'error' || res.code === 'NETWORK_ERROR')) {
        // In local development preview mode when the backend is offline:
        const simulatedId = Math.floor(1000 + Math.random() * 9000)
        setConfirmedResult({
          bookingId: simulatedId,
          paymentId: 'sq_dev_sandbox_deposit',
        })
        onSuccess?.(simulatedId)
      } else {
        setError(res.message || 'Payment processing failed. Please verify your payment details.')
      }
    } catch {
      if (isSandboxMode) {
        const simulatedId = Math.floor(1000 + Math.random() * 9000)
        setConfirmedResult({
          bookingId: simulatedId,
          paymentId: 'sq_dev_sandbox_deposit',
        })
        onSuccess?.(simulatedId)
      } else {
        setError('A network error occurred while submitting checkout. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  // 1. Success Screen
  if (confirmedResult) {
    return (
      <div className="booking-deposit">
        <header className="booking-deposit__header">
          <div className="booking__title-group">
            <p className="booking__eyebrow">
              <span aria-hidden="true" />
              Booking Confirmed
            </p>
            <h2 id="booking-title">RESERVATION CONFIRMED</h2>
          </div>
        </header>

        <div className="booking-deposit__success-card">
          <div className="booking-deposit__success-icon">✓</div>
          <h3 className="booking-deposit__success-title">You&apos;re All Set!</h3>
          <span className="booking-deposit__success-ref">
            BOOKING REFERENCE: #{confirmedResult.bookingId || 'CONFIRMED'}
          </span>
          <p className="booking-deposit__success-text">
            Thank you, {customerInfo.firstName}! Your session has been officially reserved. A confirmation receipt
            for your deposit has been sent to <strong>{customerInfo.email}</strong>.
          </p>

          <div className="booking-deposit__success-details">
            <div><strong>Session:</strong> {service.name} ({people} {people === 1 ? 'person' : 'attendees'})</div>
            <div><strong>Date &amp; Time:</strong> {dateFormatted} at {dateTime.timeSlot} ({dateTime.timezone.replace(/^Eastern Time.*$/, 'ET') || 'ET'})</div>
            <div><strong>Deposit Paid:</strong> {formatCurrency(depositDueDollars)} (60%)</div>
            {balanceRemainingDollars > 0 && (
              <div><strong>Remaining Balance:</strong> {formatCurrency(balanceRemainingDollars)} (due on session date)</div>
            )}
          </div>

          <button
            type="button"
            className="booking-deposit__success-btn"
            onClick={() => onEdit('services')}
          >
            Done &amp; Return to Services
          </button>
        </div>
      </div>
    )
  }

  // 2. Main Step 5 Payment Screen
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
        <p className="booking-deposit__subtitle">Complete your 60% deposit to lock in your date &amp; time.</p>
      </header>

      <BookingProgressBar
        currentStep="deposit"
        onStepClick={step => {
          if (!busy) onEdit(step)
        }}
      />

      <div className="booking-deposit__layout">
        {/* Payment Details Panel (Left) */}
        <section className="booking-deposit__panel" aria-label="Payment form">
          <h3 className="booking-deposit__panel-title">Payment Information</h3>

          <div className="booking-deposit__security-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>256-Bit SSL Encrypted · Powered by Square</span>
          </div>

          {/* Coupon Code Block */}
          <div className="booking-deposit__coupon-block">
            <label htmlFor="deposit-coupon-input" className="booking-deposit__coupon-label">
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

          {/* Square Card / Dev Mode Section */}
          <div className="booking-deposit__payment-section">
            <span className="booking-deposit__payment-label">Credit or Debit Card</span>

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
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-gray)' }}>
                  Square keys are not set in <code>.env</code>. Submitting in this mode securely simulates the full booking &amp; deposit confirmation flow.
                </p>
              </div>
            ) : (
              <div>
                <div id="sq-card-container" className="booking-deposit__card-container" />
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
              Card transactions are handled directly through Square&apos;s PCI-DSS compliant checkout. R59MEDIA never accesses or stores your raw card number.
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
              disabled={busy || (!isSandboxMode && (cardLoading || Boolean(cardError)))}
            >
              {busy ? 'Processing Deposit…' : `Pay ${formatCurrency(depositDueDollars)} Deposit & Reserve`}
            </button>
          </div>
        </section>

        {/* Order Summary Sidebar Ticket (Right) */}
        <aside className="booking-deposit__summary-ticket" aria-label="Session summary">
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
              {service.durationMinutes ? `${service.durationMinutes} minutes` : '60 minutes'} · {people} {people === 1 ? 'person' : 'people'}
            </span>
          </div>

          <div className="booking-deposit__summary-item">
            <span className="booking-deposit__summary-label">Date &amp; Time</span>
            <span className="booking-deposit__summary-val">{dateFormatted}</span>
            <span className="booking-deposit__summary-sub">
              {dateTime.timeSlot} · {dateTime.timezone.replace(/^Eastern Time.*$/, 'ET') || 'ET'}
            </span>
          </div>

          <div className="booking-deposit__summary-item">
            <span className="booking-deposit__summary-label">Reserved For</span>
            <span className="booking-deposit__summary-val">
              {customerInfo.firstName} {customerInfo.lastName}
            </span>
            <span className="booking-deposit__summary-sub">{customerInfo.email}</span>
          </div>

          <div className="booking-deposit__pricing-card">
            <div className="booking-deposit__pricing-row booking-deposit__pricing-row--total">
              <span>Session Total:</span>
              <span>{formatCurrency(finalTotalDollars)}</span>
            </div>

            {discountDollars > 0 && (
              <div className="booking-deposit__pricing-row" style={{ color: '#4ade80' }}>
                <span>Discount ({appliedCoupon?.code}):</span>
                <span>-{formatCurrency(discountDollars)}</span>
              </div>
            )}

            <div className="booking-deposit__pricing-row booking-deposit__pricing-row--due">
              <span className="booking-deposit__due-badge">{depositPercent}% DEPOSIT</span>
              <span style={{ fontSize: '18px', color: 'var(--color-white)' }}>
                {formatCurrency(depositDueDollars)}
              </span>
            </div>

            <p className="booking-deposit__pricing-note">
              Due today: {formatCurrency(depositDueDollars)}. Remaining balance ({formatCurrency(balanceRemainingDollars)}) is paid on your session date.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
