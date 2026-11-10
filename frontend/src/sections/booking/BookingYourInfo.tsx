import { useState } from 'react'
import type { FormEvent } from 'react'
import type { BookingCustomerInfo, BookingYourInfoProps } from '../../types/booking'
import { BookingProgressBar } from './BookingProgressBar'
import { BookingSessionCard } from './BookingSessionCard'
import './BookingYourInfo.css'

interface FormErrors {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
}

export function BookingYourInfo({
  service,
  people,
  dateTime,
  initialInfo,
  onSubmit,
  onBack,
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

  const [errors, setErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const validate = (data: BookingCustomerInfo): FormErrors => {
    const errs: FormErrors = {}
    if (!data.firstName.trim()) {
      errs.firstName = 'First name is required.'
    }
    if (!data.lastName.trim()) {
      errs.lastName = 'Last name is required.'
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!data.email.trim()) {
      errs.email = 'Email address is required.'
    } else if (!emailRegex.test(data.email.trim())) {
      errs.email = 'Please enter a valid email address.'
    }
    const digitsOnly = data.phone.replace(/\D/g, '')
    if (!data.phone.trim()) {
      errs.phone = 'Phone number is required.'
    } else if (digitsOnly.length < 7) {
      errs.phone = 'Please enter a valid phone number.'
    }
    return errs
  }

  const handleChange = (field: keyof BookingCustomerInfo, value: string) => {
    const next = { ...formData, [field]: value }
    setFormData(next)
    if (touched[field]) {
      const currentErrs = validate(next)
      setErrors(prev => ({ ...prev, [field]: currentErrs[field as keyof FormErrors] }))
    }
  }

  const handleBlur = (field: keyof BookingCustomerInfo) => {
    setTouched(prev => ({ ...prev, [field]: true }))
    const currentErrs = validate(formData)
    setErrors(prev => ({ ...prev, [field]: currentErrs[field as keyof FormErrors] }))
  }

  const isFormComplete = Boolean(
    formData.firstName.trim() &&
      formData.lastName.trim() &&
      formData.email.trim() &&
      formData.phone.trim() &&
      Object.keys(validate(formData)).length === 0
  )

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault()
    setTouched({ firstName: true, lastName: true, email: true, phone: true })
    const errs = validate(formData)
    setErrors(errs)

    if (Object.keys(errs).length > 0) {
      const firstKey = Object.keys(errs)[0]
      const el = document.getElementById(`field-${firstKey}`)
      el?.focus()
      return
    }

    void onSubmit(formData)
  }

  return (
    <div className="booking-your-info">
      {/* Top Header */}
      <header className="booking-your-info__top-header">
        <h2 className="booking-your-info__main-title">BOOK YOUR SESSION</h2>
        <p className="booking-your-info__subtitle">Share your details to book your session.</p>
      </header>

      <BookingProgressBar
        currentStep="info"
        onStepClick={step => {
          if (step === 'services' || step === 'datetime') {
            onBack()
          }
        }}
      />

      {/* Sub Nav & Back Link */}
      <div className="booking-your-info__subnav">
        <div className="booking-your-info__subnav-text">
          <h3 className="booking-your-info__subnav-title">Choose your date &amp; time</h3>
          <p className="booking-your-info__subnav-desc">
            Pick an available date, then choose a start time for your session.
          </p>
        </div>
        <button
          type="button"
          className="booking-your-info__back-link"
          onClick={onBack}
        >
          ← Back to date &amp; time
        </button>
      </div>

      {error && (
        <div className="booking-your-info__error-banner" role="alert">
          <p>{error}</p>
        </div>
      )}

      {/* 2-Column Grid */}
      <div className="booking-your-info__grid">
        <div className="booking-your-info__form-col">
          <div className="booking-your-info__card">
            <div className="booking-your-info__card-header">
              <h4 className="booking-your-info__card-title">Contact details</h4>
              <span className="booking-your-info__required-notice">
                <span className="booking-your-info__star">*</span> Required fields
              </span>
            </div>

            <form
              id="booking-info-form"
              className="booking-your-info__form"
              onSubmit={handleSubmit}
              noValidate
            >
              {/* Row 1: First and Last Name */}
              <div className="booking-your-info__row">
                <div className="booking-your-info__field">
                  <label htmlFor="field-firstName" className="booking-your-info__label">
                    First name <span className="booking-your-info__star">*</span>
                  </label>
                  <input
                    id="field-firstName"
                    name="firstName"
                    type="text"
                    autoComplete="given-name"
                    placeholder="Alex"
                    className={`booking-your-info__input ${errors.firstName ? 'booking-your-info__input--error' : ''}`}
                    value={formData.firstName}
                    onChange={e => handleChange('firstName', e.target.value)}
                    onBlur={() => handleBlur('firstName')}
                    aria-required="true"
                    disabled={isSubmitting}
                  />
                  {errors.firstName && (
                    <span className="booking-your-info__field-err">{errors.firstName}</span>
                  )}
                </div>

                <div className="booking-your-info__field">
                  <label htmlFor="field-lastName" className="booking-your-info__label">
                    Last name <span className="booking-your-info__star">*</span>
                  </label>
                  <input
                    id="field-lastName"
                    name="lastName"
                    type="text"
                    autoComplete="family-name"
                    placeholder="Morgan"
                    className={`booking-your-info__input ${errors.lastName ? 'booking-your-info__input--error' : ''}`}
                    value={formData.lastName}
                    onChange={e => handleChange('lastName', e.target.value)}
                    onBlur={() => handleBlur('lastName')}
                    aria-required="true"
                    disabled={isSubmitting}
                  />
                  {errors.lastName && (
                    <span className="booking-your-info__field-err">{errors.lastName}</span>
                  )}
                </div>
              </div>

              {/* Row 2: Email and Phone */}
              <div className="booking-your-info__row">
                <div className="booking-your-info__field">
                  <label htmlFor="field-email" className="booking-your-info__label">
                    Email address <span className="booking-your-info__star">*</span>
                  </label>
                  <input
                    id="field-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="alex.morgan@example.com"
                    className={`booking-your-info__input ${errors.email ? 'booking-your-info__input--error' : ''}`}
                    value={formData.email}
                    onChange={e => handleChange('email', e.target.value)}
                    onBlur={() => handleBlur('email')}
                    aria-required="true"
                    disabled={isSubmitting}
                  />
                  {errors.email && (
                    <span className="booking-your-info__field-err">{errors.email}</span>
                  )}
                </div>

                <div className="booking-your-info__field">
                  <label htmlFor="field-phone" className="booking-your-info__label">
                    Phone number <span className="booking-your-info__star">*</span>
                  </label>
                  <input
                    id="field-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+1 (212) 555-0148"
                    className={`booking-your-info__input ${errors.phone ? 'booking-your-info__input--error' : ''}`}
                    value={formData.phone}
                    onChange={e => handleChange('phone', e.target.value)}
                    onBlur={() => handleBlur('phone')}
                    aria-required="true"
                    disabled={isSubmitting}
                  />
                  {errors.phone && (
                    <span className="booking-your-info__field-err">{errors.phone}</span>
                  )}
                </div>
              </div>

              {/* Row 3: Anything we should know? */}
              <div className="booking-your-info__field booking-your-info__field--full">
                <label htmlFor="field-notes" className="booking-your-info__label">
                  Anything we should know? (optional)
                </label>
                <textarea
                  id="field-notes"
                  name="notes"
                  rows={3}
                  className="booking-your-info__textarea"
                  placeholder="Share any ideas, preferences, or accessibility needs for your session."
                  value={formData.notes || ''}
                  onChange={e => handleChange('notes', e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              <div className="booking-your-info__note">
                A little detail helps us make your session feel like you. Your details will only be used
                to contact you about your booking.
              </div>
            </form>
          </div>

          <div className="booking-your-info__next-section">
            <h5 className="booking-your-info__next-title">Next: secure your session</h5>
            <p className="booking-your-info__next-desc">Review your total and pay your deposit.</p>
          </div>

          {/* Mobile Only Submit Area */}
          <div className="booking-your-info__mobile-submit">
            <button
              type="button"
              className="booking-your-info__mobile-btn"
              disabled={!isFormComplete || isSubmitting}
              onClick={() => handleSubmit()}
            >
              {isSubmitting ? 'Submitting...' : 'Continue to deposit →'}
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
            continueText={isSubmitting ? 'Submitting...' : 'Continue to summary'}
            onContinue={() => handleSubmit()}
            isContinueDisabled={!isFormComplete || isSubmitting}
          />
        </div>
      </div>
    </div>
  )
}
