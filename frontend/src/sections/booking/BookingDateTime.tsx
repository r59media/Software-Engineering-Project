import { useEffect, useMemo, useState } from 'react'
import { fetchAvailableSlots } from '../../api/client'
import type { ScheduleSlotItem } from '../../api/client'
import type { BookingDateTimeProps, BookingDateTimeSelection } from '../../types/booking'
import { formatSlotTime, getEasternToday } from './bookingUtils'
import { BookingDatePicker } from './BookingDatePicker'
import { BookingProgressBar } from './BookingProgressBar'
import { BookingSessionCard } from './BookingSessionCard'
import { BookingTimeSlots } from './BookingTimeSlots'
import type { TimeSlotItem } from './BookingTimeSlots'
import './BookingDateTime.css'

export function BookingDateTime({
  service,
  people,
  selection,
  onSelectDateTime,
  onBack,
  onContinue,
  inquiryHref = '#contact',
}: BookingDateTimeProps) {
  const easternToday = getEasternToday()
  const [scheduleSlots, setScheduleSlots] = useState<readonly ScheduleSlotItem[]>([])
  const [selectedDate, setSelectedDate] = useState<string>(selection?.date || easternToday)
  const [currentTimeSlot, setCurrentTimeSlot] = useState<string | null>(selection?.timeSlot || null)

  // Fetch available slots from backend
  useEffect(() => {
    let active = true
    const controller = new AbortController()

    async function loadSlots() {
      try {
        const slots = await fetchAvailableSlots(controller.signal)
        if (!active) return
        if (slots && slots.length > 0) {
          setScheduleSlots(slots)
        }
      } catch {
        // Fall back gracefully to generated slots
      }
    }

    void loadSlots()
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  // Available dates list
  const availableDates = useMemo(() => {
    const unbookedSlots = scheduleSlots.filter(s => s.is_booked === 0 && s.date >= easternToday)
    if (unbookedSlots.length > 0) {
      const dates = Array.from(new Set(unbookedSlots.map(s => s.date))).sort()
      return dates
    }
    // Fallback: next 30 days are available
    const dates: string[] = []
    const [y, m, d] = easternToday.split('-').map(Number)
    for (let i = 0; i < 30; i++) {
      const day = new Date(Date.UTC(y, m - 1, d + i))
      dates.push(
        `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`
      )
    }
    return dates
  }, [scheduleSlots, easternToday])

  // Derive currentDate safely without setState in effect
  const currentDate =
    availableDates.length > 0 && !availableDates.includes(selectedDate)
      ? availableDates[0]
      : selectedDate

  // Slots for the currently selected date
  const daySlots: TimeSlotItem[] = useMemo(() => {
    const matched = scheduleSlots.filter(s => s.date === currentDate && s.is_booked === 0)
    if (matched.length > 0) {
      return matched.map(slot => {
        const formatted = formatSlotTime(slot.start_time)
        const hour = parseInt(slot.start_time.split(':')[0], 10)
        return {
          time: formatted,
          period: hour < 12 ? 'morning' : 'afternoon',
          available: true,
        }
      })
    }

    // Fallback slots
    return [
      { time: '10:00 AM', period: 'morning', available: true },
      { time: '11:30 AM', period: 'morning', available: true },
      { time: '1:00 PM', period: 'afternoon', available: true },
      { time: '2:30 PM', period: 'afternoon', available: true },
      { time: '4:00 PM', period: 'afternoon', available: true },
      { time: '5:30 PM', period: 'afternoon', available: true },
    ]
  }, [scheduleSlots, currentDate])

  const handleSelectDate = (date: string) => {
    setSelectedDate(date)
    if (currentTimeSlot) {
      const nextSelection: BookingDateTimeSelection = {
        date,
        timeSlot: currentTimeSlot,
        timezone: 'Eastern Time (ET)',
      }
      onSelectDateTime(nextSelection)
    }
  }

  const handleSelectSlot = (slot: string) => {
    setCurrentTimeSlot(slot)
    const nextSelection: BookingDateTimeSelection = {
      date: currentDate,
      timeSlot: slot,
      timezone: 'Eastern Time (ET)',
    }
    onSelectDateTime(nextSelection)
  }

  const liveSelection =
    selection ||
    (currentTimeSlot
      ? { date: currentDate, timeSlot: currentTimeSlot, timezone: 'Eastern Time (ET)' }
      : null)
  const isContinueEnabled = Boolean(liveSelection && liveSelection.date && liveSelection.timeSlot)

  return (
    <div className="booking-datetime">
      <BookingProgressBar
        currentStep="datetime"
        onStepClick={step => {
          if (step === 'services') onBack()
        }}
      />

      <div className="booking-datetime__layout">
        <div className="booking-datetime__main">
          <header className="booking-datetime__header">
            <h3 className="booking-datetime__title">Select Date &amp; Time</h3>
            <p className="booking-datetime__desc">
              Choose an available date and start time for your {service.name}.
            </p>
          </header>

          <div className="booking-datetime__pickers">
            <BookingDatePicker
              selectedDate={currentDate}
              onSelectDate={handleSelectDate}
              availableDates={availableDates}
              minDate={easternToday}
            />

            <BookingTimeSlots
              selectedDate={currentDate}
              selectedSlot={liveSelection?.timeSlot}
              onSelectSlot={handleSelectSlot}
              slots={daySlots}
              durationMinutes={service.durationMinutes}
              inquiryHref={inquiryHref}
            />
          </div>

          <div className="booking-datetime__actions">
            <button type="button" className="booking-datetime__btn booking-datetime__btn--back" onClick={onBack}>
              ← Back to services
            </button>
            <button
              type="button"
              className="booking-datetime__btn booking-datetime__btn--continue"
              disabled={!isContinueEnabled}
              onClick={onContinue}
            >
              Continue to your info →
            </button>
          </div>
        </div>

        <div className="booking-datetime__sidebar">
          <div className="booking-datetime__sticky-wrapper">
            <BookingSessionCard
              service={service}
              people={people}
              dateTime={liveSelection}
              onEditService={onBack}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
