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
      errs.phone = 'Please enter a valid phone number (at least 7 digits).'
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setTouched({ firstName: true, lastName: true, email: true, phone: true })
    const errs = validate(formData)
    setErrors(errs)

    if (Object.keys(errs).length > 0) {
      // Focus first error field
      const firstKey = Object.keys(errs)[0]
      const el = document.getElementById(`field-${firstKey}`)
      el?.focus()
      return
    }

    void onSubmit(formData)
  }

  return (
    <div className="booking-your-info">
      <BookingProgressBar
        currentStep="info"
        onStepClick={step => {
          if (step === 'services' || step === 'datetime') {
            onBack()
          }
        }}
      />

      <div className="booking-your-info__layout">
        <div className="booking-your-info__main">
          <header className="booking-your-info__header">
            <h3 className="booking-your-info__title">Your Information</h3>
            <p className="booking-your-info__desc">
              Please provide your contact details so we can confirm your session and coordinate logistics.
            </p>
          </header>

          {error && (
            <div className="booking-your-info__error-banner" role="alert">
              <span>⚠️</span>
              <p>{error}</p>
            </div>
          )}

          <form className="booking-your-info__form" onSubmit={handleSubmit} noValidate>
            <div className="booking-your-info__row">
              <div className="booking-your-info__field">
                <label htmlFor="field-firstName" className="booking-your-info__label">
                  First Name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="field-firstName"
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  className={`booking-your-info__input ${errors.firstName ? 'booking-your-info__input--error' : ''}`}
                  value={formData.firstName}
                  onChange={e => handleChange('firstName', e.target.value)}
                  onBlur={() => handleBlur('firstName')}
                  aria-required="true"
                  aria-invalid={Boolean(errors.firstName)}
                  aria-describedby={errors.firstName ? 'firstName-err' : undefined}
                  disabled={isSubmitting}
                />
                {errors.firstName && (
                  <p id="firstName-err" className="booking-your-info__field-err" role="alert">
                    {errors.firstName}
                  </p>
                )}
              </div>

              <div className="booking-your-info__field">
                <label htmlFor="field-lastName" className="booking-your-info__label">
                  Last Name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="field-lastName"
                  name="lastName"
                  type="text"
                  autoComplete="family-name"
                  className={`booking-your-info__input ${errors.lastName ? 'booking-your-info__input--error' : ''}`}
                  value={formData.lastName}
                  onChange={e => handleChange('lastName', e.target.value)}
                  onBlur={() => handleBlur('lastName')}
                  aria-required="true"
                  aria-invalid={Boolean(errors.lastName)}
                  aria-describedby={errors.lastName ? 'lastName-err' : undefined}
                  disabled={isSubmitting}
                />
                {errors.lastName && (
                  <p id="lastName-err" className="booking-your-info__field-err" role="alert">
                    {errors.lastName}
                  </p>
                )}
              </div>
            </div>

            <div className="booking-your-info__row">
              <div className="booking-your-info__field">
                <label htmlFor="field-email" className="booking-your-info__label">
                  Email Address <span aria-hidden="true">*</span>
                </label>
                <input
                  id="field-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  className={`booking-your-info__input ${errors.email ? 'booking-your-info__input--error' : ''}`}
                  value={formData.email}
                  onChange={e => handleChange('email', e.target.value)}
                  onBlur={() => handleBlur('email')}
                  aria-required="true"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'email-err' : undefined}
                  disabled={isSubmitting}
                />
                {errors.email && (
                  <p id="email-err" className="booking-your-info__field-err" role="alert">
                    {errors.email}
                  </p>
                )}
              </div>

              <div className="booking-your-info__field">
                <label htmlFor="field-phone" className="booking-your-info__label">
                  Phone Number <span aria-hidden="true">*</span>
                </label>
                <input
                  id="field-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  className={`booking-your-info__input ${errors.phone ? 'booking-your-info__input--error' : ''}`}
                  value={formData.phone}
                  onChange={e => handleChange('phone', e.target.value)}
                  onBlur={() => handleBlur('phone')}
                  aria-required="true"
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? 'phone-err' : undefined}
                  disabled={isSubmitting}
                  placeholder="(555) 000-0000"
                />
                {errors.phone && (
                  <p id="phone-err" className="booking-your-info__field-err" role="alert">
                    {errors.phone}
                  </p>
                )}
              </div>
            </div>

            <div className="booking-your-info__field">
              <label htmlFor="field-notes" className="booking-your-info__label">
                Session Notes &amp; Special Requests <span className="booking-your-info__optional">(Optional)</span>
              </label>
              <textarea
                id="field-notes"
                name="notes"
                rows={4}
                className="booking-your-info__textarea"
                value={formData.notes || ''}
                onChange={e => handleChange('notes', e.target.value)}
                disabled={isSubmitting}
                placeholder="Tell us about your creative vision, preferred locations, wardrobe ideas, or any questions you have..."
              />
            </div>

            <div className="booking-your-info__privacy">
              <span className="booking-your-info__privacy-icon" aria-hidden="true">
                🔒
              </span>
              <p>
                <strong>Privacy Reassurance:</strong> Your information is confidential and will only be used
                for booking confirmation and photoshoot coordination. We never share or sell personal information.
              </p>
            </div>

            <div className="booking-your-info__actions">
              <button
                type="button"
                className="booking-your-info__btn booking-your-info__btn--back"
                onClick={onBack}
                disabled={isSubmitting}
              >
                ← Back to date &amp; time
              </button>
              <button
                type="submit"
                className="booking-your-info__btn booking-your-info__btn--submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Confirming booking...' : 'Continue to summary →'}
              </button>
            </div>
          </form>
        </div>

        <div className="booking-your-info__sidebar">
          <div className="booking-your-info__sticky-wrapper">
            <BookingSessionCard
              service={service}
              people={people}
              dateTime={dateTime}
              onEditDateTime={onBack}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
