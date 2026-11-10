import { useMemo } from 'react'
import './BookingTimeSlots.css'

export interface TimeSlotItem {
  time: string
  period: 'morning' | 'afternoon'
  available?: boolean
}

export interface BookingTimeSlotsProps {
  selectedDate: string
  selectedSlot?: string | null
  onSelectSlot: (slot: string) => void
  slots?: readonly string[] | readonly TimeSlotItem[]
  durationMinutes?: number | null
  inquiryHref?: string
  onInquiryClick?: () => void
}

const DEFAULT_SLOTS: readonly TimeSlotItem[] = [
  { time: '10:00 AM', period: 'morning', available: true },
  { time: '11:30 AM', period: 'morning', available: true },
  { time: '1:00 PM', period: 'afternoon', available: true },
  { time: '2:30 PM', period: 'afternoon', available: true },
  { time: '4:00 PM', period: 'afternoon', available: true },
  { time: '5:30 PM', period: 'afternoon', available: true },
]

function normalizeSlots(rawSlots?: readonly string[] | readonly TimeSlotItem[]): TimeSlotItem[] {
  if (!rawSlots || rawSlots.length === 0) {
    return [...DEFAULT_SLOTS]
  }

  return rawSlots.map(item => {
    if (typeof item === 'object' && item !== null && 'period' in item) {
      return item as TimeSlotItem
    }

    const timeStr = String(item).trim()
    const isPM = timeStr.toUpperCase().includes('PM')
    const match = timeStr.match(/^(\d{1,2}):?(\d{2})?/)
    let hour = match ? parseInt(match[1], 10) : 12

    if (isPM && hour < 12) hour += 12
    if (!isPM && hour === 12) hour = 0

    const period: 'morning' | 'afternoon' = hour < 12 ? 'morning' : 'afternoon'

    return {
      time: timeStr,
      period,
      available: true,
    }
  })
}

export function BookingTimeSlots({
  selectedDate,
  selectedSlot,
  onSelectSlot,
  slots,
  durationMinutes,
  inquiryHref = '#contact',
  onInquiryClick,
}: BookingTimeSlotsProps) {
  const normalized = useMemo(() => normalizeSlots(slots), [slots])

  const morningSlots = normalized.filter(s => s.period === 'morning' && s.available !== false)
  const afternoonSlots = normalized.filter(s => s.period === 'afternoon' && s.available !== false)

  const formatFriendlyDate = (dateStr: string) => {
    try {
      const [y, m, d] = dateStr.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(date)
    } catch {
      return dateStr
    }
  }

  const durationLabel =
    durationMinutes === null || durationMinutes === undefined
      ? 'Custom duration tailored to you'
      : durationMinutes >= 180
        ? `~${durationMinutes / 60} hours per session`
        : `~${durationMinutes} minutes per session`

  return (
    <section className="booking-time-slots" aria-label="Available appointment times">
      <header className="booking-time-slots__header">
        <div className="booking-time-slots__title-row">
          <h4 className="booking-time-slots__title">Select a Time Slot</h4>
          <span className="booking-time-slots__tz-badge" title="All times in Eastern Time">
            🕒 Eastern Time (ET)
          </span>
        </div>
        <p className="booking-time-slots__date-badge">
          Date: <strong>{formatFriendlyDate(selectedDate)}</strong> · {durationLabel}
        </p>
      </header>

      <div className="booking-time-slots__groups">
        {/* Morning Slots */}
        <div className="booking-time-slots__group">
          <h5 className="booking-time-slots__group-heading">Morning</h5>
          {morningSlots.length > 0 ? (
            <div className="booking-time-slots__grid" role="group" aria-label="Morning time slots">
              {morningSlots.map(slot => {
                const isSelected = selectedSlot === slot.time
                return (
                  <button
                    key={slot.time}
                    type="button"
                    className={`booking-time-slot-btn ${isSelected ? 'booking-time-slot-btn--selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelectSlot(slot.time)}
                  >
                    <span className="booking-time-slot-btn__time">{slot.time}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="booking-time-slots__empty-note">No morning slots available for this date.</p>
          )}
        </div>

        {/* Afternoon Slots */}
        <div className="booking-time-slots__group">
          <h5 className="booking-time-slots__group-heading">Afternoon</h5>
          {afternoonSlots.length > 0 ? (
            <div className="booking-time-slots__grid" role="group" aria-label="Afternoon time slots">
              {afternoonSlots.map(slot => {
                const isSelected = selectedSlot === slot.time
                return (
                  <button
                    key={slot.time}
                    type="button"
                    className={`booking-time-slot-btn ${isSelected ? 'booking-time-slot-btn--selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelectSlot(slot.time)}
                  >
                    <span className="booking-time-slot-btn__time">{slot.time}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="booking-time-slots__empty-note">No afternoon slots available for this date.</p>
          )}
        </div>
      </div>

      <footer className="booking-time-slots__footer">
        <p className="booking-time-slots__help">
          Need a time not listed or an on-location weekend shoot?{' '}
          {onInquiryClick ? (
            <button type="button" className="booking-time-slots__inquiry-btn" onClick={onInquiryClick}>
              Request custom availability →
            </button>
          ) : (
            <a href={inquiryHref} className="booking-time-slots__inquiry-link">
              Request custom availability →
            </a>
          )}
        </p>
      </footer>
    </section>
  )
}
