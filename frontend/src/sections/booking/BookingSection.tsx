import { AnimatePresence, LayoutGroup, motion, useIsPresent, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { forwardRef, useEffect, useMemo, useState } from 'react'
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
import './BookingSection.css'

const STORAGE_KEY = 'r59_booking_session'

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

function BookingFlow({
  services = previewBookingServices,
  status = 'ready',
  onRetry,
  inquiryHref = '#contact',
  onProceedToDeposit,
}: BookingSectionProps) {
  const [{ step, movement }, setStage] = useState<{ step: BookingStep; movement: StepMotion }>({ step: 'services', movement: { direction: -1, panelsOnly: false } })
  const setStep = (next: BookingStep) => setStage(previous => {
    const from = previous.step
    const panelsOnly = (from === 'datetime' && next === 'info') || (from === 'info' && next === 'datetime')
    const direction = panelsOnly ? (next === 'info' ? 1 : -1) : (from === 'summary' ? 1 : -1)
    return { step: next, movement: { direction, panelsOnly } }
  })
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [attendees, setAttendees] = useState(1)
  const [dateTime, setDateTime] = useState<BookingDateTimeSelection | null>(null)
  const [customerInfo, setCustomerInfo] = useState<BookingCustomerInfo | null>(null)
  const [photoPermissions, setPhotoPermissions] = useState<BookingPhotoPermissions>({ websitePortfolio: false, socialMedia: false })
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

  return (
    <BookingStage movement={movement} stage="summary"><section id="booking" className="booking" aria-labelledby="booking-title">
      <div className="booking__inner">
        {dateTime && customerInfo && <BookingSummary
          service={selectedService}
          people={attendees}
          dateTime={dateTime}
          customerInfo={customerInfo}
          photoPermissions={photoPermissions}
          onPhotoPermissionsChange={setPhotoPermissions}
          onEdit={nextStep => {
            setStep(nextStep)
            document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
          }}
          onProceedToDeposit={onProceedToDeposit}
        />}
      </div>
    </section></BookingStage>
  )
}
