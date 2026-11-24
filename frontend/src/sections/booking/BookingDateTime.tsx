import { BookingPanelMotion } from './BookingPanelMotion'
import { previewBookingTimeSlots } from '../../config/booking'
import calendarIcon from '../../assets/booking/calendar-days.svg'
import clockIcon from '../../assets/booking/clock-3.svg'
import chevronDown from '../../assets/booking/chevron-down.svg'
import { useEffect, useMemo, useState } from 'react'
import { fetchAvailableSlots } from '../../api/client'
import type { ScheduleSlotItem } from '../../api/client'
import type { BookingDateTimeProps, BookingDateTimeSelection } from '../../types/booking'
import {
  formatSlotTime,
  getEasternCurrentMinutes,
  getEasternToday,
  isPreviewSlotAvailable,
  isSlotAvailableForDuration,
} from './bookingUtils'
import { BookingDatePicker } from './BookingDatePicker'
import { BookingProgressBar } from './BookingProgressBar'
import { BookingSessionCard } from './BookingSessionCard'
import { BookingTimeSlots } from './BookingTimeSlots'
import type { TimeSlotItem } from './BookingTimeSlots'
import './BookingDateTime.css'

export function BookingDateTime({
  service,
  people,
  pricing = null,
  selection,
  onSelectDateTime,
  onBack,
  onContinue,
  inquiryHref = '#contact',
}: BookingDateTimeProps) {
  const easternToday = getEasternToday()
  const [scheduleSlots, setScheduleSlots] = useState<readonly ScheduleSlotItem[]>([])
  const [slotsLoadedFromApi, setSlotsLoadedFromApi] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>(selection?.date || easternToday)
  const [currentTimeSlot, setCurrentTimeSlot] = useState<string | null>(selection?.timeSlot || null)

  // Mobile modal states
  const [isDateModalOpen, setIsDateModalOpen] = useState(false)
  const [isTimeModalOpen, setIsTimeModalOpen] = useState(false)

  // Lock body scroll when mobile modal is open
  useEffect(() => {
    if (isDateModalOpen || isTimeModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isDateModalOpen, isTimeModalOpen])

  useEffect(() => {
    let active = true
    let controller: AbortController | null = null

    async function loadSlots() {
      controller?.abort()
      const current = new AbortController()
      controller = current
      try {
        const slots = await fetchAvailableSlots(current.signal, service.durationMinutes)
        if (!active || current.signal.aborted) return
        if (slots !== null) {
          setScheduleSlots(slots)
          setSlotsLoadedFromApi(true)
        }
      } catch {
        // Fall back gracefully only when API has not responded
      }
    }

    const onRevalidate = () => {
      if (document.visibilityState === 'visible') {
        void loadSlots()
      }
    }

    void loadSlots()
    window.addEventListener('focus', onRevalidate)
    document.addEventListener('visibilitychange', onRevalidate)
    return () => {
      active = false
      controller?.abort()
      window.removeEventListener('focus', onRevalidate)
      document.removeEventListener('visibilitychange', onRevalidate)
    }
  }, [])

  const [currentEasternMinutes, setCurrentEasternMinutes] = useState(() => getEasternCurrentMinutes())

  useEffect(() => {
    const updateTime = () => setCurrentEasternMinutes(getEasternCurrentMinutes())
    window.addEventListener('focus', updateTime)
    document.addEventListener('visibilitychange', updateTime)
    const timer = setInterval(updateTime, 60000)
    return () => {
      window.removeEventListener('focus', updateTime)
      document.removeEventListener('visibilitychange', updateTime)
      clearInterval(timer)
    }
  }, [])

  // Group slots by date for efficient lookup
  const slotsByDate = useMemo(() => {
    const map = new Map<string, ScheduleSlotItem[]>()
    for (const slot of scheduleSlots) {
      if (slot.date < easternToday) continue
      let list = map.get(slot.date)
      if (!list) {
        list = []
        map.set(slot.date, list)
      }
      list.push(slot)
    }
    return map
  }, [scheduleSlots, easternToday])

  const getValidSlotsForDate = (date: string): TimeSlotItem[] => {
    if (slotsLoadedFromApi) {
      const dayList = slotsByDate.get(date) || []
      const valid = dayList.filter(slot =>
        isSlotAvailableForDuration(slot, dayList, service.durationMinutes, easternToday, currentEasternMinutes)
      )
      return valid.map(slot => {
        const formatted = formatSlotTime(slot.start_time)
        const hour = parseInt(slot.start_time.split(':')[0], 10)
        return {
          id: slot.id,
          time: formatted,
          period: (hour < 12 ? 'morning' : 'afternoon') as 'morning' | 'afternoon',
          available: true,
        }
      })
    }

    return previewBookingTimeSlots
      .filter(p => isPreviewSlotAvailable(p.time, service.durationMinutes, date, easternToday, currentEasternMinutes))
      .map(p => ({
        time: p.time,
        period: p.period,
        available: true,
      }))
  }

  const availableDates = useMemo(() => {
    if (slotsLoadedFromApi) {
      const validDates: string[] = []
      const sortedDates = Array.from(slotsByDate.keys()).sort()
      for (const d of sortedDates) {
        const dayList = slotsByDate.get(d) || []
        const hasValidSlot = dayList.some(slot =>
          isSlotAvailableForDuration(slot, dayList, service.durationMinutes, easternToday, currentEasternMinutes)
        )
        if (hasValidSlot) {
          validDates.push(d)
        }
      }
      return validDates
    }

    const dates: string[] = []
    const [y, m, d] = easternToday.split('-').map(Number)
    for (let i = 0; i < 30; i++) {
      const day = new Date(Date.UTC(y, m - 1, d + i))
      const dateStr = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`
      const hasPreviewSlot = previewBookingTimeSlots.some(p =>
        isPreviewSlotAvailable(p.time, service.durationMinutes, dateStr, easternToday, currentEasternMinutes)
      )
      if (hasPreviewSlot) {
        dates.push(dateStr)
      }
    }
    return dates
  }, [slotsLoadedFromApi, slotsByDate, service.durationMinutes, easternToday, currentEasternMinutes])

  const currentDate =
    availableDates.length > 0 && !availableDates.includes(selectedDate)
      ? availableDates[0]
      : selectedDate

  const daySlots: TimeSlotItem[] = useMemo(() => {
    return getValidSlotsForDate(currentDate)
  }, [slotsLoadedFromApi, slotsByDate, currentDate, service.durationMinutes, easternToday, currentEasternMinutes])

  const resolveSlotId = (date: string, time: string | null): number | undefined => {
    if (!time || !scheduleSlots.length) return undefined
    const found = scheduleSlots.find(
      s => s.date === date && (formatSlotTime(s.start_time) === time || s.start_time === time) && s.is_booked === 0
    )
    return found?.id
  }

  // Ensure current time slot is valid within daySlots, syncing whenever date or service changes
  useEffect(() => {
    if (daySlots.length === 0) {
      if (currentTimeSlot !== null) {
        setCurrentTimeSlot(null)
      }
      return
    }
    const matching = daySlots.find(s => s.time === currentTimeSlot)
    if (!matching) {
      const firstValid = daySlots[0].time
      setCurrentTimeSlot(firstValid)
      const slotId = resolveSlotId(currentDate, firstValid)
      onSelectDateTime({
        date: currentDate,
        timeSlot: firstValid,
        timezone: 'Eastern Time (ET)',
        slotId,
      })
    }
  }, [daySlots, currentDate])

  const handleSelectDate = (date: string) => {
    setSelectedDate(date)
    const validSlotsForDate = getValidSlotsForDate(date)
    const currentMatching = validSlotsForDate.find(s => s.time === currentTimeSlot)
    const slot = currentMatching ? currentTimeSlot : (validSlotsForDate[0]?.time || null)
    setCurrentTimeSlot(slot)
    const slotId = slot ? resolveSlotId(date, slot) : undefined
    const nextSelection: BookingDateTimeSelection = {
      date,
      timeSlot: slot || '',
      timezone: 'Eastern Time (ET)',
      slotId,
    }
    onSelectDateTime(nextSelection)
  }

  const handleSelectSlot = (slot: string, explicitSlotId?: number) => {
    setCurrentTimeSlot(slot)
    const slotId = explicitSlotId ?? resolveSlotId(currentDate, slot)
    const nextSelection: BookingDateTimeSelection = {
      date: currentDate,
      timeSlot: slot,
      timezone: 'Eastern Time (ET)',
      slotId,
    }
    onSelectDateTime(nextSelection)
  }

  const liveSlotId = selection?.slotId ?? resolveSlotId(currentDate, currentTimeSlot)

  const liveSelection: BookingDateTimeSelection | null =
    selection
      ? { ...selection, slotId: selection.slotId ?? liveSlotId }
      : currentTimeSlot
      ? { date: currentDate, timeSlot: currentTimeSlot, timezone: 'Eastern Time (ET)', slotId: liveSlotId }
      : null

  const isContinueEnabled = Boolean(
    liveSelection &&
    liveSelection.date &&
    liveSelection.timeSlot &&
    daySlots.some(s => s.time === liveSelection.timeSlot)
  )

  const formatTriggerDate = (dateStr: string) => {
    try {
      const [y, m, d] = dateStr.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(date)
    } catch {
      return dateStr
    }
  }

  const handleContinue = () => {
    if (liveSelection) {
      onSelectDateTime(liveSelection)
    }
    onContinue()
  }

  return (
    <div className="booking-datetime">
      {/* Top Main Header */}
      <header className="booking-datetime__top-header">
        <div className="booking__title-group">
          <p className="booking__eyebrow">
            <span aria-hidden="true" />
            Booking
          </p>
          <h2 className="booking-datetime__main-title">BOOK YOUR SESSION</h2>
        </div>
        <p className="booking-datetime__subtitle">Choose a date and time that work for you.</p>
      </header>

      <BookingProgressBar
        currentStep="datetime"
        onStepClick={step => {
          if (step === 'services') onBack()
        }}
      />

      {/* Sub Header & Back link */}
      <div className="booking-datetime__subnav">
        <div className="booking-datetime__subnav-text">
          <h3 className="booking-datetime__subnav-title">Choose your date &amp; time</h3>
          <p className="booking-datetime__subnav-desc">
            Pick an available date, then choose a start time for your session.
          </p>
        </div>
        <button
          type="button"
          className="booking-datetime__back-link booking-datetime__back-link--desktop"
          onClick={onBack}
        >
          ← Back to services
        </button>
      </div>

      {/* Mobile Form Triggers */}
      <BookingPanelMotion className="booking-datetime__mobile-triggers" entersRightward={false}>
        <button
          type="button"
          className="booking-datetime__trigger-btn"
          onClick={() => setIsDateModalOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={isDateModalOpen}
        >
          <span className="booking-datetime__trigger-icon" aria-hidden="true">
            <img src={calendarIcon} alt="" />
          </span>
          <div className="booking-datetime__trigger-content">
            <span className="booking-datetime__trigger-label">Select a date</span>
            <span className="booking-datetime__trigger-value">{formatTriggerDate(currentDate)}</span>
          </div>
          <span className="booking-datetime__trigger-arrow" aria-hidden="true">
            <img src={chevronDown} alt="" />
          </span>
        </button>

        <button
          type="button"
          className="booking-datetime__trigger-btn"
          onClick={() => setIsTimeModalOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={isTimeModalOpen}
        >
          <span className="booking-datetime__trigger-icon" aria-hidden="true">
            <img src={clockIcon} alt="" />
          </span>
          <div className="booking-datetime__trigger-content">
            <span className="booking-datetime__trigger-label">Select a time</span>
            <span className="booking-datetime__trigger-value">
              {currentTimeSlot || 'Select a time'}
            </span>
          </div>
          <span className="booking-datetime__trigger-arrow" aria-hidden="true">
            <img src={chevronDown} alt="" />
          </span>
        </button>

        <div className="booking-datetime__mobile-subline">
          <span className="booking-datetime__mobile-tz">Eastern Time (NY)</span>
          <button
            type="button"
            className="booking-datetime__back-link booking-datetime__back-link--mobile"
            onClick={onBack}
          >
            ← Back to services
          </button>
        </div>
      </BookingPanelMotion>

      {/* 3-Column Desktop Grid with Exact Parallel Alignment */}
      <div className="booking-datetime__grid-layout">
        <BookingPanelMotion className="booking-datetime__col-date" entersRightward={false}>
          <BookingDatePicker
            selectedDate={currentDate}
            onSelectDate={handleSelectDate}
            availableDates={availableDates}
            minDate={easternToday}
          />
        </BookingPanelMotion>

        <BookingPanelMotion className="booking-datetime__col-time" entersRightward={false}>
          <BookingTimeSlots
            selectedDate={currentDate}
            selectedSlot={liveSelection?.timeSlot}
            onSelectSlot={handleSelectSlot}
            slots={daySlots}
            durationMinutes={service.durationMinutes}
            inquiryHref={inquiryHref}
          />
        </BookingPanelMotion>

        <div className="booking-datetime__col-ticket">
          <BookingSessionCard
            service={service}
            people={people}
            pricing={pricing}
            dateTime={liveSelection}
            continueText="Continue to your information →"
            onContinue={handleContinue}
            isContinueDisabled={!isContinueEnabled}
          />
        </div>
      </div>

      {/* Bottom Row across 3 Columns (Desktop Alignment) */}
      <div className="booking-datetime__bottom-row">
        <div className="booking-datetime__bottom-info">
          <div className="booking-datetime__bottom-title">Next: your information</div>
          <div className="booking-datetime__bottom-desc">
            Enter your contact details for this session.
          </div>
        </div>

        <div className="booking-datetime__bottom-action">
          <button
            type="button"
            className="booking-datetime__continue-btn"
            disabled={!isContinueEnabled}
            onClick={handleContinue}
          >
            Continue to your information →
          </button>
        </div>
      </div>

      {/* Mobile Modal 1: Date Picker Modal */}
      {isDateModalOpen && (
        <div
          className="booking-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Select a date"
          onClick={() => setIsDateModalOpen(false)}
        >
          <div
            className="booking-modal-card"
            onClick={e => e.stopPropagation()}
          >
            <div className="booking-modal-header">
              <h4 className="booking-modal-title">Select a date</h4>
              <button
                type="button"
                className="booking-modal-close"
                onClick={() => setIsDateModalOpen(false)}
                aria-label="Close date modal"
              >
                ✕
              </button>
            </div>

            <BookingDatePicker
              selectedDate={currentDate}
              onSelectDate={date => {
                handleSelectDate(date)
              }}
              availableDates={availableDates}
              minDate={easternToday}
              showHeaderTitle={false}
            />

            <div className="booking-modal-footer">
              <div className="booking-modal-date-info">
                <span className="booking-modal-date-text">{formatTriggerDate(currentDate)}</span>
                <span className="booking-modal-date-tag">Selected</span>
              </div>
              <button
                type="button"
                className="booking-modal-confirm-btn"
                onClick={() => setIsDateModalOpen(false)}
              >
                Confirm date →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Modal 2: Time Slots Modal */}
      {isTimeModalOpen && (
        <div
          className="booking-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Select a time"
          onClick={() => setIsTimeModalOpen(false)}
        >
          <div
            className="booking-modal-card"
            onClick={e => e.stopPropagation()}
          >
            <div className="booking-modal-header">
              <h4 className="booking-modal-title">Select a time</h4>
              <button
                type="button"
                className="booking-modal-close"
                onClick={() => setIsTimeModalOpen(false)}
                aria-label="Close time modal"
              >
                ✕
              </button>
            </div>

            <BookingTimeSlots
              selectedDate={currentDate}
              selectedSlot={liveSelection?.timeSlot}
              onSelectSlot={slot => {
                handleSelectSlot(slot)
              }}
              slots={daySlots}
              durationMinutes={service.durationMinutes}
              inquiryHref={inquiryHref}
              showHeaderTitle={false}
            />

            <div className="booking-modal-footer">
              <button
                type="button"
                className="booking-modal-confirm-btn"
                onClick={() => setIsTimeModalOpen(false)}
              >
                Confirm {currentTimeSlot || 'time'} →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
