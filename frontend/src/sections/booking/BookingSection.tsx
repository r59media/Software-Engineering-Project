import { useEffect, useMemo, useRef, useState } from 'react'
import { previewBookingServices } from '../../config/booking'
import { submitContactLead } from '../../api/client'
import type {
  BookingCustomerInfo,
  BookingDateTimeSelection,
  BookingSectionProps,
  BookingStep,
  ServiceSelection,
} from '../../types/booking'
import { BookingServices } from './BookingServices'
import { BookingDateTime } from './BookingDateTime'
import { validateBookingInfo } from './bookingValidation'
import { BookingYourInfo } from './BookingYourInfo'
import { BookingProgressBar } from './BookingProgressBar'
import { BookingSessionCard } from './BookingSessionCard'
import './BookingSection.css'

const STORAGE_KEY = 'r59_booking_session'

export function BookingSection({
  services = previewBookingServices,
  status = 'ready',
  onRetry,
  inquiryHref = '#contact',
}: BookingSectionProps) {
  const [step, setStep] = useState<BookingStep>('services')
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [attendees, setAttendees] = useState(1)
  const [dateTime, setDateTime] = useState<BookingDateTimeSelection | null>(null)
  const [customerInfo, setCustomerInfo] = useState<BookingCustomerInfo | null>(null)
  const requestLock = useRef(false)
  const retryAfter = useRef(0)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Find the selected service
  const selectedService = useMemo(() => {
    if (!services || services.length === 0) return null
    if (selectedServiceId) {
      const found = services.find(s => s.id === selectedServiceId)
      if (found) return found
    }
    return null
  }, [services, selectedServiceId])

  // Derive effectiveStep during render to avoid setState in effect
  let effectiveStep: BookingStep = step
  if (step === 'datetime' && !selectedServiceId) {
    effectiveStep = 'services'
  } else if (step === 'info' && (!selectedServiceId || !dateTime)) {
    effectiveStep = selectedServiceId ? 'datetime' : 'services'
  } else if (step === 'summary' && (!selectedServiceId || !dateTime || !customerInfo)) {
    effectiveStep = 'services'
  }

  useEffect(() => {
    try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* Storage may be unavailable. */ }
  }, [])

  const handleServicesContinue = (selection: ServiceSelection) => {
    setSelectedServiceId(selection.serviceId)
    setAttendees(selection.people)
    setStep('datetime')
    document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleDateTimeContinue = () => {
    if (dateTime) {
      setStep('info')
      document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleInfoSubmit = async (info: BookingCustomerInfo) => {
    if (requestLock.current || !selectedService || !dateTime) return
    if (Date.now() < retryAfter.current) {
      setSubmitError('Too many requests. Please wait a minute before trying again.')
      return
    }
    if (Object.keys(validateBookingInfo(info)).length) {
      setSubmitError('Please check your contact details before continuing.')
      return
    }
    requestLock.current = true
    setIsSubmitting(true)
    setSubmitError(null)
    setCustomerInfo(info)

    try {
      const messageBody = [
        `Booking request for ${selectedService.name}`,
        `Date: ${dateTime.date}`,
        `Time Slot: ${dateTime.timeSlot} (${dateTime.timezone || 'ET'})`,
        `Attendees: ${attendees}`,
        info.notes ? `Client Notes: ${info.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      const result = await submitContactLead({
        name: `${info.firstName} ${info.lastName}`.trim(),
        email: info.email,
        phone: info.phone,
        session_type: ['Portrait', 'Brand', 'Creative', 'Event'].includes(selectedService.name) ? selectedService.name : 'Other',
        message: messageBody,
      })

      if (result.status === 'success') {
        setStep('summary')
        document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
      } else {
        if (result.code === 'TOO_MANY_REQUESTS') retryAfter.current = Date.now() + (result.retryAfterSeconds ?? 60) * 1000
        setSubmitError(result.message || 'Unable to send your request. Your details have been kept. Please try again.')
      }
    } catch {
      setSubmitError('An unexpected error occurred while submitting your booking. Please try again.')
    } finally {
      requestLock.current = false
      setIsSubmitting(false)
    }
  }

  const handleReset = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    setStep('services')
    setSelectedServiceId(null)
    setAttendees(1)
    setDateTime(null)
    setCustomerInfo(null)
    setSubmitError(null)
    document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
  }

  // Render Step 1
  if (effectiveStep === 'services' || !selectedService) {
    return (
      <BookingServices
        services={services}
        status={status}
        onRetry={onRetry}
        onContinue={handleServicesContinue}
        initialSelection={selectedService ? { serviceId: selectedService.id, people: attendees } : null}
        inquiryHref={inquiryHref}
      />
    )
  }

  // Render Step 2
  if (effectiveStep === 'datetime') {
    return (
      <section id="booking" className="booking" aria-labelledby="booking-title">
        <div className="booking__inner">
          <BookingDateTime
            service={selectedService}
            people={attendees}
            selection={dateTime}
            onSelectDateTime={dt => setDateTime(dt)}
            onBack={() => setStep('services')}
            onContinue={handleDateTimeContinue}
            inquiryHref={inquiryHref}
          />
        </div>
      </section>
    )
  }

  // Render Step 3
  if (effectiveStep === 'info') {
    return (
      <section id="booking" className="booking" aria-labelledby="booking-title">
        <div className="booking__inner">
          <BookingYourInfo
            service={selectedService}
            people={attendees}
            dateTime={dateTime!}
            initialInfo={customerInfo}
            onDraftChange={setCustomerInfo}
            onSubmit={handleInfoSubmit}
            onBack={() => setStep('datetime')}
            isSubmitting={isSubmitting}
            error={submitError}
          />
        </div>
      </section>
    )
  }

  // Render Step 4 (Summary / Confirmation)
  return (
    <section id="booking" className="booking" aria-labelledby="booking-title">
      <div className="booking__inner">
        <BookingProgressBar currentStep="summary" />

        <div className="booking-summary">
          <div className="booking-summary__main">
            <header className="booking-summary__header">
              <span className="booking-summary__badge-success" aria-hidden="true">
                ✓
              </span>
              <h3 id="booking-title" className="booking-summary__title">
                Booking Request Received!
              </h3>
              <p className="booking-summary__subtitle">
                Thank you, <strong>{customerInfo?.firstName}</strong>! Your session request for the{' '}
                <strong>{selectedService.name}</strong> has been received.
              </p>
            </header>

            <div className="booking-summary__card">
              <h4 className="booking-summary__card-title">What Happens Next?</h4>
              <ol className="booking-summary__steps-list">
                <li className="booking-summary__step-item">
                  <span className="booking-summary__step-num">1</span>
                  <div className="booking-summary__step-content">
                    <strong>Schedule Review &amp; Confirmation</strong>
                    <p>
                      We will review your requested date (<strong>{dateTime?.date}</strong> at{' '}
                      <strong>{dateTime?.timeSlot}</strong>) and email your confirmation within 24 hours.
                    </p>
                  </div>
                </li>
                <li className="booking-summary__step-item">
                  <span className="booking-summary__step-num">2</span>
                  <div className="booking-summary__step-content">
                    <strong>Deposit Invoice</strong>
                    <p>
                      You will receive a secure Square invoice link sent to <strong>{customerInfo?.email}</strong> to
                      secure your slot.
                    </p>
                  </div>
                </li>
                <li className="booking-summary__step-item">
                  <span className="booking-summary__step-num">3</span>
                  <div className="booking-summary__step-content">
                    <strong>Photoshoot Preparation Guide</strong>
                    <p>
                      We’ll share our tailored wardrobe styling advice, location guides, and day-of checklist so you
                      feel completely prepared.
                    </p>
                  </div>
                </li>
              </ol>
            </div>

            {customerInfo && (
              <div className="booking-summary__details-card">
                <h4 className="booking-summary__card-title">Submitted Client Details</h4>
                <dl className="booking-summary__dl">
                  <div>
                    <dt>Client Name</dt>
                    <dd>
                      {customerInfo.firstName} {customerInfo.lastName}
                    </dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{customerInfo.email}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{customerInfo.phone}</dd>
                  </div>
                  {customerInfo.notes && (
                    <div className="booking-summary__dl-full">
                      <dt>Special Notes</dt>
                      <dd>{customerInfo.notes}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            <div className="booking-summary__actions">
              <button
                type="button"
                className="booking-summary__btn booking-summary__btn--primary"
                onClick={handleReset}
              >
                Book Another Session
              </button>
              <a href="#hero" className="booking-summary__btn booking-summary__btn--secondary">
                Back to Top ↑
              </a>
            </div>
          </div>

          <div className="booking-summary__sidebar">
            <BookingSessionCard
              service={selectedService}
              people={attendees}
              dateTime={dateTime}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
