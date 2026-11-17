import { previewBookingTimeSlots } from '../../config/booking'
import { useMemo } from 'react'
import './BookingTimeSlots.css'

export interface TimeSlotItem {
  id?: number
  time: string
  period: 'morning' | 'afternoon'
  available?: boolean
}

export interface BookingTimeSlotsProps {
  selectedDate: string
  selectedSlot?: string | null
  onSelectSlot: (slot: string, slotId?: number) => void
  slots?: readonly string[] | readonly TimeSlotItem[]
  durationMinutes?: number | null
  inquiryHref?: string
  onInquiryClick?: () => void
  showHeaderTitle?: boolean
}

function normalizeSlots(rawSlots?: readonly string[] | readonly TimeSlotItem[]): TimeSlotItem[] {
  if (!rawSlots || rawSlots.length === 0) {
    return [...previewBookingTimeSlots]
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
  durationMinutes = 60,
  inquiryHref = '#contact',
  onInquiryClick,
  showHeaderTitle = true,
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
      ? 'Custom duration'
      : durationMinutes >= 180
        ? `Up to ${durationMinutes / 60} hours`
        : `Up to ${durationMinutes} minutes`

  return (
    <section className="booking-time-slots" aria-label="Available appointment times">
      {showHeaderTitle && (
        <h4 className="booking-time-slots__title">Select a time</h4>
      )}

      <header className="booking-time-slots__header">
        <div className="booking-time-slots__date-text">{formatFriendlyDate(selectedDate)}</div>
        <div className="booking-time-slots__tz-text">Eastern Time (NY)</div>
      </header>

      <div className="booking-time-slots__groups">
        {/* Morning */}
        {morningSlots.length > 0 && (
          <div className="booking-time-slots__group">
            <div className="booking-time-slots__group-heading">In the morning:</div>
            <div className="booking-time-slots__grid" role="group" aria-label="Morning time slots">
              {morningSlots.map(slot => {
                const isSelected = selectedSlot === slot.time
                return (
                  <button
                    key={slot.id !== undefined ? `slot-${slot.id}` : slot.time}
                    type="button"
                    className={`booking-time-slot-btn ${isSelected ? 'booking-time-slot-btn--selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelectSlot(slot.time, slot.id)}
                  >
                    {slot.time}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Afternoon */}
        {afternoonSlots.length > 0 && (
          <div className="booking-time-slots__group">
            <div className="booking-time-slots__group-heading">In the afternoon:</div>
            <div className="booking-time-slots__grid" role="group" aria-label="Afternoon time slots">
              {afternoonSlots.map(slot => {
                const isSelected = selectedSlot === slot.time
                return (
                  <button
                    key={slot.id !== undefined ? `slot-${slot.id}` : slot.time}
                    type="button"
                    className={`booking-time-slot-btn ${isSelected ? 'booking-time-slot-btn--selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelectSlot(slot.time, slot.id)}
                  >
                    {slot.time}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {morningSlots.length === 0 && afternoonSlots.length === 0 && (
          <div className="booking-time-slots__empty">
            No appointment times available for this date.
          </div>
        )}
      </div>

      <footer className="booking-time-slots__footer">
        <div className="booking-time-slots__duration-note">{durationLabel}</div>
        <div className="booking-time-slots__info-note">Times shown are session start times.</div>
        <div className="booking-time-slots__inquiry-row">
          <div className="booking-time-slots__inquiry-heading">Can’t find a time that works?</div>
          {onInquiryClick ? (
            <button type="button" className="booking-time-slots__inquiry-btn" onClick={onInquiryClick}>
              Get in touch to discuss other availability.
            </button>
          ) : (
            <a href={inquiryHref} className="booking-time-slots__inquiry-link">
              Get in touch to discuss other availability.
            </a>
          )}
        </div>
      </footer>
    </section>
  )
}
