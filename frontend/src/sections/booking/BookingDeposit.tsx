import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { motion } from 'motion/react'
import { useTicketMotion } from './useTicketMotion'
import { useTicketTilt } from './useTicketTilt'
import type {
  BookingCustomerInfo,
  BookingDateTimeSelection,
  BookingPhotoPermissions,
  BookingService,
  BookingStep,
  ConfirmedBookingSummary,
  SquareConfig,
} from '../../types/booking'
import {
  computeSessionPricing,
  fetchAddressDetails,
  fetchAddressSuggestions,
  submitCheckout,
  validateCoupon,
  type AddressSuggestion,
  type PricingData,
} from '../../api/client'
import { previewBookingDepositPercent } from '../../config/booking'
import { BookingProgressBar } from './BookingProgressBar'
import { BookingPanelMotion } from './BookingPanelMotion'
import {
  getOrCreateSquarePayments,
  loadSquareSdk,
  resolveSquareCredentials,
  type SquareCard,
} from './squareSdk'
import './BookingDeposit.css'

// eslint-disable-next-line react-refresh/only-export-components
export { warmSquarePaymentSdk } from './squareSdk'

function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 16)
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ')
}

function formatExpDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length >= 3) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`
  }
  return digits
}

const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
]

const SQUARE_ATTACH_TIMEOUT_MS = 12000

export interface BookingDepositProps {
  service: BookingService
  people: number
  pricing?: PricingData | null
  squareConfig?: SquareConfig | null
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
  squareConfig: squareConfigProp = null,
  dateTime,
  customerInfo,
  photoPermissions,
  selectedFeeIds = [],
  onEdit,
  onSuccess,
}: BookingDepositProps) {
  const { shared, transition } = useTicketMotion()
  const { tiltTicket, resetTilt } = useTicketTilt(8)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardLoading, setCardLoading] = useState(true)
  const [cardError, setCardError] = useState<string | null>(null)
  const [cardRetryKey, setCardRetryKey] = useState(0)
  const [isSandboxMode, setIsSandboxMode] = useState(false)

  // Location selection & structured address state
  const [locationMode, setLocationMode] = useState<'studio' | 'on_location'>('studio')
  const [street, setStreet] = useState('')
  const [apt, setApt] = useState('')
  const [city, setCity] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [verifiedAddress, setVerifiedAddress] = useState(false)
  const [googleMapsUrl, setGoogleMapsUrl] = useState<string | null>(null)
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1)
  const sessionTokenRef = useRef<string>(crypto.randomUUID())
  const suppressNextAutocompleteRef = useRef(false)
  const addressComboboxWrapRef = useRef<HTMLDivElement | null>(null)

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

  // Card input states for sandbox/local dev entry
  const [cardNum, setCardNum] = useState('')
  const [cardExp, setCardExp] = useState('')
  const [cardCvv, setCardCvv] = useState('')

  const cardRef = useRef<SquareCard | null>(null)
  const cardContainerRef = useRef<HTMLDivElement | null>(null)

  const squareConfig = squareConfigProp ?? pricing?.squareConfig ?? null
  const { rawAppId, rawLocationId, isSquareConfigured, isProductionSquare } =
    resolveSquareCredentials(squareConfig)

  const currency = pricing?.currency || service?.currency || 'USD'
  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(val)

  const isOnLocation = locationMode === 'on_location'
  const composedStreet = apt.trim() ? `${street.trim()}, ${apt.trim()}` : street.trim()
  const composedCityStateZip = [
    city.trim(),
    [stateCode.trim(), postalCode.trim()].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ')
  const composedEventLocation = [composedStreet, composedCityStateZip]
    .filter(Boolean)
    .join(', ')
  const resolvedEventLocation = isOnLocation
    ? composedEventLocation || 'On-Location (Address Pending)'
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
  const onLocationFees = isOnLocation
    ? breakdown.appliedFees.filter(fee => fee.trigger === 'on_location')
    : []
  const onLocationFeeDollars = onLocationFees.reduce(
    (sum, fee) => sum + fee.amountDollars,
    0,
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

  // Debounced address autocomplete for on-location sessions
  useEffect(() => {
    if (!isOnLocation) return
    if (suppressNextAutocompleteRef.current) {
      suppressNextAutocompleteRef.current = false
      return
    }
    const query = street.trim()
    if (query.length < 3) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSuggestionsLoading(true)
      void fetchAddressSuggestions(query, sessionTokenRef.current, controller.signal)
        .then(results => {
          if (controller.signal.aborted) return
          setAddressSuggestions(results)
          setSuggestionsOpen(results.length > 0)
          setActiveSuggestionIndex(-1)
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setAddressSuggestions([])
            setSuggestionsOpen(false)
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSuggestionsLoading(false)
          }
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [isOnLocation, street])

  // Close address suggestions dropdown on outside click
  useEffect(() => {
    if (!suggestionsOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (
        addressComboboxWrapRef.current &&
        !addressComboboxWrapRef.current.contains(event.target as Node)
      ) {
        setSuggestionsOpen(false)
        setActiveSuggestionIndex(-1)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [suggestionsOpen])

  // Initialize Square Card or Sandbox simulator
  useEffect(() => {
    let isMounted = true

    async function initPayment() {
      if (!isSquareConfigured) {
        setIsSandboxMode(true)
        setCardLoading(false)
        return
      }

      setIsSandboxMode(false)
      setCardLoading(true)
      setCardError(null)

      let timeoutId: number | null = null

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error('Payment form timed out while loading. Please retry.'))
          }, SQUARE_ATTACH_TIMEOUT_MS)
        })

        await Promise.race([
          (async () => {
            await loadSquareSdk(isProductionSquare)
            if (!isMounted) return

            const payments = getOrCreateSquarePayments(
              rawAppId,
              rawLocationId,
              isProductionSquare,
            )
            if (!payments) {
              throw new Error('Square Web Payments SDK is not available.')
            }

            const card = await payments.card()
            if (!isMounted) {
              await card.destroy()
              return
            }

            const container = cardContainerRef.current
            if (!container) {
              await card.destroy()
              throw new Error('Payment form container not found.')
            }

            await card.attach(container)
            if (!isMounted) {
              await card.destroy()
              return
            }
            cardRef.current = card
            setCardLoading(false)
          })(),
          timeoutPromise,
        ])
      } catch (err: unknown) {
        if (!isMounted) return
        setCardLoading(false)
        const msg =
          err instanceof Error
            ? err.message
            : 'Failed to initialize payment form.'
        setCardError(msg)
      } finally {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId)
        }
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
  }, [rawAppId, rawLocationId, isProductionSquare, isSquareConfigured, cardRetryKey])

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

  const handleSelectSuggestion = async (suggestion: AddressSuggestion) => {
    suppressNextAutocompleteRef.current = true
    setSuggestionsOpen(false)
    setActiveSuggestionIndex(-1)
    setError(null)

    if (suggestion.provider === 'google') {
      setStreet(suggestion.mainText || suggestion.label)
      const details = await fetchAddressDetails(
        suggestion.placeId,
        sessionTokenRef.current,
      )
      sessionTokenRef.current = crypto.randomUUID()
      if (details) {
        suppressNextAutocompleteRef.current = true
        setStreet(details.street || suggestion.mainText || '')
        setCity(details.city || '')
        setStateCode(details.state || '')
        setPostalCode(details.postalCode || '')
        setVerifiedAddress(Boolean(details.verified))
        setGoogleMapsUrl(details.googleMapsUrl || null)
        return
      }
    }

    const nextStreet = suggestion.street || suggestion.mainText || ''
    const nextCity = suggestion.city || ''
    const nextState = suggestion.state || ''
    const nextZip = suggestion.postalCode || ''
    const fallbackMapsQuery = [nextStreet, nextCity, nextState, nextZip]
      .filter(Boolean)
      .join(', ')

    setStreet(nextStreet)
    setCity(nextCity)
    setStateCode(nextState)
    setPostalCode(nextZip)
    setVerifiedAddress(Boolean(nextStreet && nextCity && nextState))
    setGoogleMapsUrl(
      suggestion.googleMapsUrl ||
        (fallbackMapsQuery
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackMapsQuery)}`
          : null),
    )
    sessionTokenRef.current = crypto.randomUUID()
  }

  const handleStreetKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestionsOpen || addressSuggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveSuggestionIndex(prev =>
        prev < addressSuggestions.length - 1 ? prev + 1 : 0,
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveSuggestionIndex(prev =>
        prev > 0 ? prev - 1 : addressSuggestions.length - 1,
      )
    } else if (e.key === 'Enter' && activeSuggestionIndex >= 0) {
      e.preventDefault()
      const selected = addressSuggestions[activeSuggestionIndex]
      if (selected) {
        void handleSelectSuggestion(selected)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setSuggestionsOpen(false)
      setActiveSuggestionIndex(-1)
    }
  }

  const handlePayDeposit = async () => {
    setError(null)

    if (isOnLocation) {
      if (!street.trim()) {
        setError('Please enter the street address for your on-location session.')
        return
      }
      if (!city.trim()) {
        setError('Please enter the city for your on-location session.')
        return
      }
      if (!stateCode.trim()) {
        setError('Please select the state for your on-location session.')
        return
      }
      if (!/^\d{5}(?:-\d{4})?$/.test(postalCode.trim())) {
        setError('Please enter a valid 5-digit or ZIP+4 postal code (e.g. 10001).')
        return
      }
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
        <h2 id="booking-title" className="booking-deposit__header-title">
          BOOK YOUR SESSION
        </h2>
        <p className="booking-deposit__header-sub">
          Review your session details before paying your deposit.
        </p>
      </header>

      <BookingProgressBar
        currentStep="deposit"
        onStepClick={step => {
          if (!busy) onEdit(step)
        }}
      />

      <div className="booking-deposit__subhead">
        <div className="booking-deposit__subhead-left">
          <h3 className="booking-deposit__subhead-title">
            Enter your Payment details
          </h3>
          <p className="booking-deposit__subhead-desc">
            Fill in your personal details to complete your booking.
          </p>
        </div>
        <button
          type="button"
          className="booking-deposit__back-link"
          onClick={() => onEdit('datetime')}
          disabled={busy}
        >
          ← Back to date &amp; time
        </button>
      </div>

      <div className="booking-deposit__layout">
        {/* Payment & Options Panel (Left) */}
        <div className="booking-deposit__left-col">
          <BookingPanelMotion className="booking-deposit__panel-wrap" entersRightward={false}>
            <section className="booking-deposit__panel" aria-label="Payment form">
              <div className="booking-deposit__panel-top-row">
                <h3 className="booking-deposit__panel-title">Payment &amp; Details</h3>
                <div className="booking-deposit__security-badge">
                  256-Bit SSL Encrypted · Powered by Square
                </div>
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
                      setAddressSuggestions([])
                      setSuggestionsOpen(false)
                      setSuggestionsLoading(false)
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
                  <div
                    className="booking-deposit__address-fields"
                    ref={addressComboboxWrapRef}
                  >
                    <div className="booking-deposit__address-field booking-deposit__address-combobox">
                      <label
                        htmlFor="deposit-street-input"
                        className="booking-deposit__field-label"
                      >
                        Street Address{' '}
                        <span style={{ color: 'var(--color-brand-red)' }}>*</span>
                      </label>
                      <input
                        id="deposit-street-input"
                        type="text"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={suggestionsOpen}
                        aria-controls="deposit-address-listbox"
                        aria-activedescendant={
                          activeSuggestionIndex >= 0
                            ? `deposit-address-option-${activeSuggestionIndex}`
                            : undefined
                        }
                        autoComplete="address-line1"
                        required
                        className="booking-deposit__location-input"
                        placeholder="Start typing street address (e.g. 350 5th Ave)"
                        value={street}
                        onChange={e => {
                          const nextStreet = e.target.value
                          setStreet(nextStreet)
                          setVerifiedAddress(false)
                          setGoogleMapsUrl(null)
                          if (nextStreet.trim().length < 3) {
                            setAddressSuggestions([])
                            setSuggestionsOpen(false)
                            setSuggestionsLoading(false)
                          }
                          setError(null)
                        }}
                        onFocus={() => {
                          if (addressSuggestions.length > 0 && !verifiedAddress) {
                            setSuggestionsOpen(true)
                          }
                        }}
                        onKeyDown={handleStreetKeyDown}
                        disabled={busy}
                      />
                      {suggestionsLoading && (
                        <span className="booking-deposit__address-hint">
                          Searching addresses…
                        </span>
                      )}
                      {suggestionsOpen && addressSuggestions.length > 0 && (
                        <ul
                          id="deposit-address-listbox"
                          role="listbox"
                          aria-label="Address suggestions"
                          className="booking-deposit__address-listbox"
                        >
                          {addressSuggestions.map((suggestion, idx) => (
                            <li
                              key={suggestion.id}
                              id={`deposit-address-option-${idx}`}
                              role="option"
                              aria-selected={idx === activeSuggestionIndex}
                              className={`booking-deposit__address-option${
                                idx === activeSuggestionIndex ? ' is-active' : ''
                              }`}
                              onMouseDown={e => {
                                e.preventDefault()
                                void handleSelectSuggestion(suggestion)
                              }}
                            >
                              <span className="booking-deposit__address-main">
                                {suggestion.mainText}
                              </span>
                              {suggestion.secondaryText && (
                                <span className="booking-deposit__address-sub">
                                  {suggestion.secondaryText}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="booking-deposit__address-field">
                      <label
                        htmlFor="deposit-apt-input"
                        className="booking-deposit__field-label"
                      >
                        Apt / Suite <span className="booking-deposit__optional">(optional)</span>
                      </label>
                      <input
                        id="deposit-apt-input"
                        type="text"
                        autoComplete="address-line2"
                        className="booking-deposit__location-input"
                        placeholder="Apt, Suite, Unit, Floor"
                        value={apt}
                        onChange={e => {
                          setApt(e.target.value)
                          setError(null)
                        }}
                        disabled={busy}
                      />
                    </div>

                    <div className="booking-deposit__address-row">
                      <div className="booking-deposit__address-field">
                        <label
                          htmlFor="deposit-city-input"
                          className="booking-deposit__field-label"
                        >
                          City <span style={{ color: 'var(--color-brand-red)' }}>*</span>
                        </label>
                        <input
                          id="deposit-city-input"
                          type="text"
                          autoComplete="address-level2"
                          required
                          className="booking-deposit__location-input"
                          placeholder="City"
                          value={city}
                          onChange={e => {
                            setCity(e.target.value)
                            setVerifiedAddress(false)
                            setGoogleMapsUrl(null)
                            setError(null)
                          }}
                          disabled={busy}
                        />
                      </div>

                      <div className="booking-deposit__address-field">
                        <label
                          htmlFor="deposit-state-select"
                          className="booking-deposit__field-label"
                        >
                          State <span style={{ color: 'var(--color-brand-red)' }}>*</span>
                        </label>
                        <select
                          id="deposit-state-select"
                          autoComplete="address-level1"
                          required
                          className="booking-deposit__location-input booking-deposit__location-select"
                          value={stateCode}
                          onChange={e => {
                            setStateCode(e.target.value)
                            setVerifiedAddress(false)
                            setGoogleMapsUrl(null)
                            setError(null)
                          }}
                          disabled={busy}
                        >
                          <option value="">State</option>
                          {US_STATES.map(s => (
                            <option key={s.code} value={s.code}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="booking-deposit__address-field">
                        <label
                          htmlFor="deposit-zip-input"
                          className="booking-deposit__field-label"
                        >
                          ZIP Code <span style={{ color: 'var(--color-brand-red)' }}>*</span>
                        </label>
                        <input
                          id="deposit-zip-input"
                          type="text"
                          inputMode="numeric"
                          autoComplete="postal-code"
                          maxLength={10}
                          required
                          className="booking-deposit__location-input"
                          placeholder="10001"
                          value={postalCode}
                          onChange={e => {
                            setPostalCode(e.target.value)
                            setVerifiedAddress(false)
                            setGoogleMapsUrl(null)
                            setError(null)
                          }}
                          disabled={busy}
                        />
                      </div>
                    </div>

                    {verifiedAddress && googleMapsUrl && (
                      <div className="booking-deposit__verified-row">
                        <span className="booking-deposit__verified-badge">
                          ✓ Verified Address
                        </span>
                        <a
                          href={googleMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="booking-deposit__maps-link"
                        >
                          Verified Address — View on Google Maps ↗
                        </a>
                      </div>
                    )}
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
                    onClick={() => setAgreementExpanded(true)}
                  >
                    Read Full Agreement
                  </button>
                </div>

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

              {/* Credit or Debit Card Section */}
              <div className="booking-deposit__payment-section">
                <span className="booking-deposit__payment-label">
                  Credit or Debit Card
                </span>

                <div className="booking-deposit__card-frame">
                  <div
                    ref={cardContainerRef}
                    id="card-container"
                    className="booking-deposit__card-container"
                  >
                    {!cardRef.current && (
                      <div className="booking-deposit__card-inputs-row">
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="cc-number"
                          className="booking-deposit__card-field booking-deposit__card-field--num"
                          placeholder="Card number"
                          value={cardNum}
                          onChange={e => setCardNum(formatCardNumber(e.target.value))}
                          maxLength={19}
                          disabled={busy}
                        />
                        <div className="booking-deposit__card-meta-wrap">
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="cc-exp"
                            className="booking-deposit__card-field booking-deposit__card-field--exp"
                            placeholder="MM/YY"
                            value={cardExp}
                            onChange={e => setCardExp(formatExpDate(e.target.value))}
                            maxLength={5}
                            disabled={busy}
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="cc-csc"
                            className="booking-deposit__card-field booking-deposit__card-field--cvv"
                            placeholder="CVV"
                            value={cardCvv}
                            onChange={e => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                            maxLength={4}
                            disabled={busy}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {cardLoading && isSquareConfigured && (
                  <p className="booking-deposit__loading-text">
                    Loading official Square secure card form…
                  </p>
                )}

                {cardError && (
                  <div className="booking-deposit__card-error-wrap">
                    <p className="booking-deposit__error" role="alert">
                      {cardError}
                    </p>
                    <button
                      type="button"
                      className="booking-deposit__retry-btn"
                      onClick={() => setCardRetryKey(k => k + 1)}
                    >
                      Retry Payment Form
                    </button>
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
            </section>
          </BookingPanelMotion>

          {/* Text block below left panel */}
          <div className="booking-deposit__notes-block">
            <span className="booking-deposit__notes-title">TEXT HERE</span>
            <p className="booking-deposit__notes-body">
              jola sjmpsiop sast pipum jomas jule, ojan oramn sip
            </p>
          </div>
        </div>

        {/* Order Summary Sidebar Ticket (Right) */}
        <div className="booking-deposit__right-col">
          <div
            className="booking-deposit__ticket-frame"
            onPointerMove={tiltTicket}
            onPointerLeave={resetTilt}
            onPointerCancel={resetTilt}
          >
            <motion.aside
              layoutId={shared ? 'booking-ticket' : undefined}
              transition={transition}
              className="booking-deposit__summary-ticket"
              aria-label="Session summary"
            >
              <div className="booking-deposit__summary-heading">
                <motion.div
                  className="booking-deposit__summary-title-wrap"
                  layout="position"
                  layoutId={shared ? 'booking-ticket-title' : undefined}
                  transition={transition}
                >
                  <span className="booking-deposit__summary-title-line">ORDER</span>
                  <span className="booking-deposit__summary-title-line">SUMMARY</span>
                </motion.div>
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
                <span className="booking-deposit__summary-service-name">{service.name}</span>
                <div className="booking-deposit__summary-details-bar">
                  <span className="booking-deposit__summary-sub">
                    {service.durationMinutes
                      ? `${service.durationMinutes} minutes`
                      : '60 minutes'}{' '}
                    · {people} {people === 1 ? 'person' : 'people'}
                  </span>
                  <span className="booking-deposit__summary-sub">
                    {service.photoCount ? `${service.photoCount} photos` : '5 photos'}
                  </span>
                </div>
              </div>

              <div className="booking-deposit__summary-item">
                <span className="booking-deposit__summary-label">Date &amp; Time</span>
                <div className="booking-deposit__summary-details-bar">
                  <span className="booking-deposit__summary-val">{dateFormatted}</span>
                  <span className="booking-deposit__summary-sub">
                    {dateTime.timeSlot} ·{' '}
                    {dateTime.timezone.replace(/^Eastern Time.*$/, 'ET') || 'ET'}
                  </span>
                </div>
              </div>

              <div className="booking-deposit__summary-item">
                <span className="booking-deposit__summary-label">Location</span>
                <div className="booking-deposit__summary-details-bar">
                  <span className="booking-deposit__summary-val">
                    {resolvedEventLocation}
                  </span>
                  <span className="booking-deposit__summary-sub">
                    {isOnLocation ? 'Client Location' : 'R59 Media Photography Studio'}
                  </span>
                </div>
              </div>

              <div className="booking-deposit__summary-item">
                <span className="booking-deposit__summary-label">Reserved For</span>
                <div className="booking-deposit__summary-details-bar">
                  <span className="booking-deposit__summary-val">{clientFullName}</span>
                  <span className="booking-deposit__summary-sub">
                    {customerInfo.email}
                  </span>
                  {customerInfo.phone && (
                    <span className="booking-deposit__summary-sub">
                      {customerInfo.phone}
                    </span>
                  )}
                </div>
              </div>

              <div className="booking-deposit__summary-item">
                <span className="booking-deposit__summary-label">
                  Photo Permissions
                </span>
                <div className="booking-deposit__permissions-pills">
                  <span className="booking-deposit__permission-pill">
                    {photoPermissions.websitePortfolio ? '✔ Portfolio: Yes' : '✕ Portfolio: No'}
                  </span>
                  <span className="booking-deposit__permission-pill">
                    {photoPermissions.socialMedia ? '✔ Social: Yes' : '✕ Social: No'}
                  </span>
                </div>
              </div>

              <div className="booking-deposit__pricing-card">
                {isOnLocation && onLocationFeeDollars > 0 && (
                  <div className="booking-deposit__pricing-row">
                    <span>On-Location Fee:</span>
                    <span>+{formatCurrency(onLocationFeeDollars)}</span>
                  </div>
                )}

                <div className="booking-deposit__pricing-row booking-deposit__pricing-row--total">
                  <span>Session Total:</span>
                  <span>{formatCurrency(finalTotalDollars)}</span>
                </div>

                {discountDollars > 0 && (
                  <div className="booking-deposit__pricing-row">
                    <span>Discount ({appliedCoupon?.code}):</span>
                    <span>-{formatCurrency(discountDollars)}</span>
                  </div>
                )}

                <div className="booking-deposit__pricing-row booking-deposit__pricing-row--due">
                  <span className="booking-deposit__due-badge">
                    {depositPercent}% DEPOSIT
                  </span>
                  <span style={{ fontSize: '18px', color: 'var(--color-brand-white)' }}>
                    {formatCurrency(depositDueDollars)}
                  </span>
                </div>

                <p className="booking-deposit__pricing-note">
                  Due today: {formatCurrency(depositDueDollars)}. Remaining balance (
                  {formatCurrency(balanceRemainingDollars)}) is paid within{' '}
                  {balanceDueDays} days after your session.
                </p>
              </div>
            </motion.aside>
          </div>

          <button
            type="button"
            className="booking-deposit__cta-btn"
            onClick={handlePayDeposit}
            disabled={busy}
          >
            {busy
              ? 'Processing Deposit…'
              : `Pay ${formatCurrency(depositDueDollars)} Deposit & Reserve`}
          </button>
        </div>
      </div>

      {/* Photography Services Agreement Modal Popup */}
      {agreementExpanded && (
        <div
          className="booking-deposit__modal-overlay"
          onClick={() => setAgreementExpanded(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="agreement-modal-title"
        >
          <div
            className="booking-deposit__modal-card"
            onClick={e => e.stopPropagation()}
          >
            <div className="booking-deposit__modal-header">
              <h4 id="agreement-modal-title" className="booking-deposit__modal-title">
                Photography Services Agreement (6 Clauses)
              </h4>
              <button
                type="button"
                className="booking-deposit__modal-close"
                onClick={() => setAgreementExpanded(false)}
                aria-label="Close agreement"
              >
                ×
              </button>
            </div>
            <div
              className="booking-deposit__modal-body"
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
          </div>
        </div>
      )}
    </div>
  )
}
