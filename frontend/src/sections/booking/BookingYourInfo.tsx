import { BookingPanelMotion } from './BookingPanelMotion'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { BookingCustomerInfo, BookingYourInfoProps } from '../../types/booking'
import { BookingProgressBar } from './BookingProgressBar'
import { BookingSessionCard } from './BookingSessionCard'
import { FormField, FormHeader } from '../../components/FormField'
import '../../components/FormField.css'
import './BookingYourInfo.css'

import { bookingFieldLimits, normalizeBookingInfo, validateBookingInfo } from './bookingValidation'
import type { BookingFormErrors } from './bookingValidation'

export function BookingYourInfo({
  service,
  people,
  dateTime,
  initialInfo,
  onSubmit,
  onBack,
  onDraftChange,
  isSubmitting = false,
  error = null,
}: BookingYourInfoProps) {
  const [formData, setFormData] = useState<BookingCustomerInfo>({
    firstName: initialInfo?.firstName || '',
    lastName: initialInfo?.lastName || '',
    email: initialInfo?.email || '',
    phone: initialInfo?.phone || '',
    notes: initialInfo?.notes || '',
  })

  const [errors, setErrors] = useState<BookingFormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const validate = validateBookingInfo
  const submitLock = useRef(false)
  const [localSubmitting, setLocalSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const busy = isSubmitting || localSubmitting

  const handleChange = (field: keyof BookingCustomerInfo, value: string) => {
    const next = { ...formData, [field]: value }
    setFormData(next)
    onDraftChange?.(next)
    setLocalError(null)
    if (touched[field]) {
      const currentErrs = validate(next)
      setErrors(prev => ({ ...prev, [field]: currentErrs[field as keyof BookingFormErrors] }))
    }
  }

  const handleBlur = (field: keyof BookingCustomerInfo) => {
    setTouched(prev => ({ ...prev, [field]: true }))
    const currentErrs = validate(formData)
    setErrors(prev => ({ ...prev, [field]: currentErrs[field as keyof BookingFormErrors] }))
  }

  const isFormComplete = Boolean(
    formData.firstName.trim() &&
      formData.lastName.trim() &&
      formData.email.trim() &&
      formData.phone.trim() &&
      Object.keys(validate(formData)).length === 0
  )

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (submitLock.current || busy) return
    setTouched({ firstName: true, lastName: true, email: true, phone: true, notes: true })
    const errs = validate(formData)
    setErrors(errs)

    if (Object.keys(errs).length > 0) {
      const firstKey = Object.keys(errs)[0]
      const el = document.getElementById(`field-${firstKey}`)
      el?.focus()
      return
    }

    submitLock.current = true
    setLocalSubmitting(true)
    setLocalError(null)
    try {
      await onSubmit(normalizeBookingInfo(formData))
    } catch {
      setLocalError('We couldn’t send your details. Your entries are still here. Please try again.')
    } finally {
      submitLock.current = false
      setLocalSubmitting(false)
    }
  }

  return (
    <div className="booking-your-info">
      {/* Top Header */}
      <header className="booking-your-info__top-header">
        <div className="booking__title-group">
          <p className="booking__eyebrow">
            <span aria-hidden="true" />
            Booking
          </p>
          <h2 className="booking-your-info__main-title">BOOK YOUR SESSION</h2>
        </div>
        <p className="booking-your-info__subtitle">Share your details to book your session.</p>
      </header>

      <BookingProgressBar
        currentStep="info"
        onStepClick={step => {
          if (step === 'services' || step === 'datetime') {
            if (!busy) onBack()
          }
        }}
      />

      {/* Sub Nav & Back Link */}
      <div className="booking-your-info__subnav">
        <div className="booking-your-info__subnav-text">
          <h3 className="booking-your-info__subnav-title">Enter your details</h3>
          <p className="booking-your-info__subnav-desc">Fill in your personal details to complete your booking.</p>
        </div>
        <button
          type="button"
          className="booking-your-info__back-link"
          onClick={() => { if (!busy) onBack() }}
          disabled={busy}
        >
          ← Back to date &amp; time
        </button>
      </div>

      {(error || localError) && (
        <div className="booking-your-info__error-banner" role="alert">
          <p>{localError || error}</p>
        </div>
      )}

      {/* 2-Column Grid */}
      <div className="booking-your-info__grid">
        <div className="booking-your-info__form-col">
          <BookingPanelMotion className="booking-your-info__card r59-form r59-form--light" entersRightward>
            <FormHeader
              title="Contact details"
              as="h4"
              titleClassName="booking-your-info__card-title"
              className="booking-your-info__card-header"
            />

            <form
              id="booking-info-form"
              className="booking-your-info__form"
              onSubmit={handleSubmit}
              noValidate
              aria-busy={busy}
            >
              {/* Row 1: First and Last Name */}
              <div className="booking-your-info__row booking-your-info__row--names">
                <FormField
                  htmlFor="field-firstName"
                  label="First name"
                  required
                  error={errors.firstName}
                  errorId="field-firstName-error"
                >
                  <input
                    id="field-firstName"
                    name="firstName"
                    required
                    maxLength={bookingFieldLimits.firstName}
                    type="text"
                    autoComplete="given-name"
                    placeholder="Alex"
                    className={`r59-form__control ${errors.firstName ? 'r59-form__control--error' : ''}`}
                    value={formData.firstName}
                    onChange={e => handleChange('firstName', e.target.value)}
                    onBlur={() => handleBlur('firstName')}
                    aria-invalid={Boolean(errors.firstName)}
                    aria-describedby={errors.firstName ? 'field-firstName-error' : undefined}
                    aria-required="true"
                    disabled={busy}
                  />
                </FormField>

                <FormField
                  htmlFor="field-lastName"
                  label="Last name"
                  required
                  error={errors.lastName}
                  errorId="field-lastName-error"
                >
                  <input
                    id="field-lastName"
                    name="lastName"
                    required
                    maxLength={bookingFieldLimits.lastName}
                    type="text"
                    autoComplete="family-name"
                    placeholder="Morgan"
                    className={`r59-form__control ${errors.lastName ? 'r59-form__control--error' : ''}`}
                    value={formData.lastName}
                    onChange={e => handleChange('lastName', e.target.value)}
                    onBlur={() => handleBlur('lastName')}
                    aria-invalid={Boolean(errors.lastName)}
                    aria-describedby={errors.lastName ? 'field-lastName-error' : undefined}
                    aria-required="true"
                    disabled={busy}
                  />
                </FormField>
              </div>

              {/* Row 2: Email and Phone */}
              <div className="booking-your-info__row">
                <FormField
                  htmlFor="field-email"
                  label="Email address"
                  required
                  error={errors.email}
                  errorId="field-email-error"
                >
                  <input
                    id="field-email"
                    name="email"
                    required
                    maxLength={bookingFieldLimits.email}
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? 'field-email-error' : undefined}
                    placeholder="alex.morgan@example.com"
                    className={`r59-form__control ${errors.email ? 'r59-form__control--error' : ''}`}
                    value={formData.email}
                    onChange={e => handleChange('email', e.target.value)}
                    onBlur={() => handleBlur('email')}
                    aria-required="true"
                    disabled={busy}
                  />
                </FormField>

                <FormField
                  htmlFor="field-phone"
                  label="Phone number"
                  required
                  error={errors.phone}
                  errorId="field-phone-error"
                >
                  <input
                    id="field-phone"
                    name="phone"
                    required
                    maxLength={bookingFieldLimits.phone}
                    type="tel"
                    autoComplete="tel"
                    placeholder="+1 (212) 555-0148"
                    className={`r59-form__control ${errors.phone ? 'r59-form__control--error' : ''}`}
                    value={formData.phone}
                    onChange={e => handleChange('phone', e.target.value)}
                    onBlur={() => handleBlur('phone')}
                    aria-invalid={Boolean(errors.phone)}
                    aria-describedby={errors.phone ? 'field-phone-error' : undefined}
                    aria-required="true"
                    disabled={busy}
                  />
                </FormField>
              </div>

              {/* Row 3: Anything we should know? */}
              <FormField
                htmlFor="field-notes"
                label="Anything we should know?"
                optional
                fullWidth
                className="booking-your-info__field--full"
                error={errors.notes}
                errorId="field-notes-error"
              >
                <textarea
                  id="field-notes"
                  name="notes"
                  maxLength={bookingFieldLimits.notes}
                  onBlur={() => handleBlur('notes')}
                  aria-invalid={Boolean(errors.notes)}
                  aria-describedby={errors.notes ? 'field-notes-error' : undefined}
                  rows={3}
                  className="r59-form__textarea"
                  placeholder="Share any ideas, preferences, or accessibility needs for your session."
                  value={formData.notes || ''}
                  onChange={e => handleChange('notes', e.target.value)}
                  disabled={busy}
                />
              </FormField>

              <div className="booking-your-info__note">
                A little detail helps us make your session feel like you.
              </div>
              <div className="booking-your-info__note booking-your-info__privacy">
                Your details will only be used to contact you about your booking.
              </div>
            </form>
          </BookingPanelMotion>

          <div className="booking-your-info__next-section">
            <h5 className="booking-your-info__next-title">Next: secure your session</h5>
            <p className="booking-your-info__next-desc">Review your session and contact details.</p>
          </div>

          {/* Mobile Only Submit Area */}
          <div className="booking-your-info__mobile-submit">
            <button
              type="button"
              className="booking-your-info__mobile-btn"
              disabled={!isFormComplete || busy}
              onClick={() => handleSubmit()}
            >
              {busy ? 'Submitting...' : 'Continue to summary →'}
            </button>
            {!isFormComplete && (
              <span className="booking-your-info__mobile-hint">
                Complete the required fields to continue
              </span>
            )}
          </div>
        </div>

        {/* Right Desktop Ticket */}
        <div className="booking-your-info__ticket-col">
          <BookingSessionCard
            service={service}
            people={people}
            dateTime={dateTime}
            hideDateHighlight
            continueText={busy ? 'Submitting...' : 'Continue to summary'}
            onContinue={() => handleSubmit()}
            isContinueDisabled={!isFormComplete || busy}
          />
        </div>
      </div>
    </div>
  )
}
