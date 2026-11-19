import { AnimatePresence, LayoutGroup, motion, useIsPresent, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { forwardRef, useMemo, useState } from 'react'
import { previewBookingServices } from '../../config/booking'
import type {
  BookingCustomerInfo,
  BookingPhotoPermissions,
  BookingDateTimeSelection,
  BookingSectionProps,
  BookingStep,
  ServiceSelection,
} from '../../types/booking'
import { BookingServices } from './BookingServices'
import { BookingDateTime } from './BookingDateTime'
import { validateBookingInfo } from './bookingValidation'
import { BookingYourInfo } from './BookingYourInfo'
import { BookingSummary } from './BookingSummary'
import { BookingDeposit } from './BookingDeposit'
import type { ConfirmedBookingSummary } from '../../types/booking'
import './BookingSection.css'

export function BookingSection(props: BookingSectionProps) {
  return <LayoutGroup><BookingFlow {...props} /></LayoutGroup>
}

type StepMotion = { direction: -1 | 1; panelsOnly: boolean }

const BookingStagePanel = forwardRef<HTMLDivElement, { children: ReactNode; movement: StepMotion }>(
  function BookingStagePanel({ children, movement }, ref) {
    const reduced = useReducedMotion()
    const present = useIsPresent()
    const distance = reduced ? 0 : 64

    return (
      <motion.div
        ref={ref}
        className="booking-stage__panel"
        data-exiting={!present}
        inert={!present}
        custom={movement}
        initial={movement.panelsOnly ? 'enterPanels' : 'enter'}
        animate="center"
        exit="leave"
        variants={{
          enter: (move: StepMotion) => ({ x: -move.direction * distance, opacity: reduced ? 1 : 0 }),
          enterPanels: { x: 0, opacity: 1 },
          center: { x: 0, opacity: 1 },
          leave: (move: StepMotion) => ({ x: move.panelsOnly ? 0 : move.direction * distance, opacity: move.panelsOnly ? 1 : 0 }),
        }}
        transition={{ duration: reduced ? 0 : .32, ease: [.22, 1, .36, 1] }}
      >
        {children}
      </motion.div>
    )
  },
)

function BookingStage({ children, stage, movement }: { children: ReactNode; stage: string; movement: StepMotion }) {
  return (
    <div className="booking-stage">
      <AnimatePresence initial={false} mode="popLayout" custom={movement}>
        <BookingStagePanel key={stage} movement={movement}>{children}</BookingStagePanel>
      </AnimatePresence>
    </div>
  )
}

const STEP_ORDER: Record<BookingStep, number> = {
  services: 0,
  datetime: 1,
  info: 2,
  summary: 3,
  deposit: 4,
}

function BookingFlow({
  services = previewBookingServices,
  pricing = null,
  status = 'ready',
  onRetry,
  inquiryHref = '#contact',
  onProceedToDeposit,
  confirmedBooking = null,
  onResetBooking,
}: BookingSectionProps) {
  const [{ step, movement }, setStage] = useState<{ step: BookingStep; movement: StepMotion }>({ step: 'services', movement: { direction: -1, panelsOnly: false } })
  const setStep = (next: BookingStep) => setStage(previous => {
    const from = previous.step
    const panelsOnly = (from === 'datetime' && next === 'info') || (from === 'info' && next === 'datetime')
    const direction = panelsOnly ? (next === 'info' ? 1 : -1) : (STEP_ORDER[next] < STEP_ORDER[from] ? 1 : -1)
    return { step: next, movement: { direction, panelsOnly } }
  })
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [attendees, setAttendees] = useState(1)
  const [dateTime, setDateTime] = useState<BookingDateTimeSelection | null>(null)
  const [customerInfo, setCustomerInfo] = useState<BookingCustomerInfo | null>(null)
  const [photoPermissions, setPhotoPermissions] = useState<BookingPhotoPermissions>({ websitePortfolio: false, socialMedia: false })
  const [selectedFeeIds, setSelectedFeeIds] = useState<string[]>([])
  const [internalConfirmed, setInternalConfirmed] = useState<ConfirmedBookingSummary | null>(null)
  const activeConfirmed = confirmedBooking || internalConfirmed
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
  } else if ((step === 'summary' || step === 'deposit') && (!selectedServiceId || !dateTime || !customerInfo)) {
    effectiveStep = 'services'
  }

  const handleServicesContinue = (selection: ServiceSelection) => {
    if (selection.serviceId !== selectedServiceId || selection.people !== attendees) setDateTime(null)
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

  const handleInfoSubmit = (info: BookingCustomerInfo) => {
    if (!selectedService || !dateTime) return
    if (Object.keys(validateBookingInfo(info)).length) {
      setSubmitError('Please check your contact details before continuing.')
      return
    }
    setSubmitError(null)
    setCustomerInfo(info)
    setStep('summary')
    document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
  }

  // Render Step 1
  if (effectiveStep === 'services' || !selectedService) {
    return (
      <BookingStage movement={movement} stage="services"><BookingServices
        services={services}
        pricing={pricing}
        status={status}
        onRetry={onRetry}
        onContinue={handleServicesContinue}
        initialSelection={selectedService ? { serviceId: selectedService.id, people: attendees } : null}
        inquiryHref={inquiryHref}
      /></BookingStage>
    )
  }

  // Render Step 2
  if (effectiveStep === 'datetime') {
    return (
      <BookingStage movement={movement} stage={effectiveStep}><section id="booking" className="booking" aria-labelledby="booking-title">
        <div className="booking__inner">
          <BookingDateTime
            service={selectedService}
            people={attendees}
            pricing={pricing}
            selection={dateTime}
            onSelectDateTime={dt => setDateTime(dt)}
            onBack={() => setStep('services')}
            onContinue={handleDateTimeContinue}
            inquiryHref={inquiryHref}
          />
        </div>
      </section></BookingStage>
    )
  }

  // Render Step 3
  if (effectiveStep === 'info') {
    return (
      <BookingStage movement={movement} stage={effectiveStep}><section id="booking" className="booking" aria-labelledby="booking-title">
        <div className="booking__inner">
          <BookingYourInfo
            service={selectedService}
            people={attendees}
            pricing={pricing}
            dateTime={dateTime!}
            initialInfo={customerInfo}
            onDraftChange={setCustomerInfo}
            onSubmit={handleInfoSubmit}
            onBack={() => setStep('datetime')}
            error={submitError}
          />
        </div>
      </section></BookingStage>
    )
  }

  if (activeConfirmed && selectedService && dateTime && customerInfo) {
    const formattedDate = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${dateTime.date}T12:00:00Z`))
    const formatCurrency = (cents: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: selectedService.currency || 'USD' }).format(cents / 100)

    const handleBookAnother = () => {
      setInternalConfirmed(null)
      setStep('services')
      setDateTime(null)
      setSelectedServiceId(null)
      setSelectedFeeIds([])
      setAttendees(1)
      onResetBooking?.()
      document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
    }

    return (
      <BookingStage movement={movement} stage="confirmed">
        <section id="booking" className="booking" aria-labelledby="booking-title">
          <div className="booking__inner">
            <div className="booking-review">
              <header className="booking-review__header">
                <div className="booking__title-group">
                  <p className="booking__eyebrow">
                    <span aria-hidden="true" />
                    Confirmed
                  </p>
                  <h2 id="booking-title">
                    BOOKING CONFIRMED{activeConfirmed.bookingId ? ` #${activeConfirmed.bookingId}` : ''}
                  </h2>
                </div>
                <p className="booking-review__subtitle">Your deposit has been received and your session is reserved.</p>
              </header>

              <div className="booking-review__ticket-layout">
                <article className="booking-review__ticket" aria-label="Confirmed booking summary">
                  <header className="booking-review__ticket-heading">
                    <h3>CONFIRMED <em>SESSION</em></h3>
                    <img className="booking-review__logo" src={`${import.meta.env.BASE_URL}r59Media_logo.svg`} alt="R59 Media" width="121" height="75" />
                  </header>

                  <div className="booking-review__columns">
                    <section className="booking-review__block booking-review__service">
                      <div className="booking-review__block-heading">
                        <h4>{selectedService.name}</h4>
                      </div>
                      <p className="booking-review__detail-line">{attendees} {attendees === 1 ? 'person' : 'people'}</p>
                      {activeConfirmed.eventLocation && (
                        <p className="booking-review__detail-line" style={{ marginTop: '6px' }}>
                          Location: {activeConfirmed.eventLocation}
                        </p>
                      )}
                    </section>

                    <section className="booking-review__block booking-review__date">
                      <div className="booking-review__block-heading">
                        <h4>DATE &amp; TIME</h4>
                      </div>
                      <p className="booking-review__detail-line">{formattedDate}</p>
                      <p className="booking-review__detail-line" style={{ marginTop: '6px' }}>
                        {dateTime.timeSlot}{dateTime.timezone ? ` (${dateTime.timezone})` : ''}
                      </p>
                    </section>

                    <section className="booking-review__block booking-review__contact-block">
                      <div className="booking-review__block-heading">
                        <h4>CONTACT DETAILS</h4>
                      </div>
                      <dl className="booking-review__contact">
                        <div>
                          <dt>Name</dt>
                          <dd>{customerInfo.firstName} {customerInfo.lastName}</dd>
                        </div>
                        <div>
                          <dt>Email</dt>
                          <dd>{customerInfo.email}</dd>
                        </div>
                        {customerInfo.phone && (
                          <div>
                            <dt>Phone</dt>
                            <dd>{customerInfo.phone}</dd>
                          </div>
                        )}
                      </dl>
                    </section>
                  </div>

                  <div
                    style={{
                      marginTop: '24px',
                      padding: '16px 20px',
                      borderRadius: '8px',
                      background: 'var(--color-brand-black)',
                      color: 'var(--color-brand-white)',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                      gap: '12px 24px',
                    }}
                  >
                    <div>
                      <span style={{ display: 'block', fontSize: '12px', opacity: 0.8 }}>Session Total</span>
                      <strong style={{ fontSize: '20px' }}>{formatCurrency(activeConfirmed.totalCents)}</strong>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '12px', opacity: 0.8 }}>Deposit Paid</span>
                      <strong style={{ fontSize: '20px' }}>{formatCurrency(activeConfirmed.depositPaidCents)}</strong>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '12px', opacity: 0.8 }}>Remaining Balance Due</span>
                      <strong style={{ fontSize: '20px' }}>{formatCurrency(activeConfirmed.balanceDueCents)}</strong>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: '20px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    {activeConfirmed.googleCalendarUrl && (
                      <a
                        href={activeConfirmed.googleCalendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="booking-review__edit"
                        style={{ textAlign: 'left' }}
                      >
                        Add to Google Calendar
                      </a>
                    )}
                    {activeConfirmed.icsUrl && (
                      <a
                        href={activeConfirmed.icsUrl}
                        download
                        className="booking-review__edit"
                        style={{ textAlign: 'left' }}
                      >
                        Download .ics
                      </a>
                    )}
                    {activeConfirmed.rescheduleUrl && (
                      <a
                        href={activeConfirmed.rescheduleUrl}
                        className="booking-review__edit"
                        style={{ textAlign: 'left' }}
                      >
                        Reschedule / Manage Booking
                      </a>
                    )}
                    <button
                      type="button"
                      className="booking-review__button"
                      style={{ marginLeft: 'auto' }}
                      onClick={handleBookAnother}
                    >
                      Book another session
                    </button>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>
      </BookingStage>
    )
  }

  if (effectiveStep === 'deposit' && selectedService && dateTime && customerInfo) {
    return (
      <BookingStage movement={movement} stage="deposit">
        <section id="booking" className="booking" aria-labelledby="booking-title">
          <div className="booking__inner">
            <BookingDeposit
              service={selectedService}
              people={attendees}
              pricing={pricing}
              dateTime={dateTime}
              customerInfo={customerInfo}
              photoPermissions={photoPermissions}
              selectedFeeIds={selectedFeeIds}
              onBack={() => {
                setStep('summary')
                document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
              }}
              onEdit={nextStep => {
                setStep(nextStep)
                document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
              }}
              onSuccess={summary => {
                setInternalConfirmed(summary)
                document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
              }}
            />
          </div>
        </section>
      </BookingStage>
    )
  }

  return (
    <BookingStage movement={movement} stage="summary"><section id="booking" className="booking" aria-labelledby="booking-title">
      <div className="booking__inner">
        {dateTime && customerInfo && <BookingSummary
          service={selectedService}
          people={attendees}
          pricing={pricing}
          dateTime={dateTime}
          customerInfo={customerInfo}
          photoPermissions={photoPermissions}
          onPhotoPermissionsChange={setPhotoPermissions}
          selectedFeeIds={selectedFeeIds}
          onSelectedFeeIdsChange={setSelectedFeeIds}
          onEdit={nextStep => {
            setStep(nextStep)
            document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
          }}
          onProceedToDeposit={draft => {
            onProceedToDeposit?.(draft)
            setStep('deposit')
            document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
          }}
        />}
      </div>
    </section></BookingStage>
  )
}
