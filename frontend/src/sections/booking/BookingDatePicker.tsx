import { useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { addDaysToYMD, formatYMD, getEasternToday, parseYMD } from './bookingUtils'
import './BookingDatePicker.css'

export interface BookingDatePickerProps {
  selectedDate?: string | null
  onSelectDate: (date: string) => void
  availableDates?: readonly string[]
  minDate?: string
}

const WEEKDAYS = [
  { short: 'Sun', full: 'Sunday' },
  { short: 'Mon', full: 'Monday' },
  { short: 'Tue', full: 'Tuesday' },
  { short: 'Wed', full: 'Wednesday' },
  { short: 'Thu', full: 'Thursday' },
  { short: 'Fri', full: 'Friday' },
  { short: 'Sat', full: 'Saturday' },
]

export function BookingDatePicker({
  selectedDate,
  onSelectDate,
  availableDates,
  minDate: explicitMinDate,
}: BookingDatePickerProps) {
  const minDate = explicitMinDate || getEasternToday()
  const today = getEasternToday()
  const initialDate = selectedDate || minDate
  const initialParsed = parseYMD(initialDate)

  const [currentYear, setCurrentYear] = useState(initialParsed.year)
  const [currentMonth, setCurrentMonth] = useState(initialParsed.month)
  const [focusedDate, setFocusedDate] = useState(initialDate)

  // Adjust state during render when prop changes (official React pattern)
  const [prevSelectedDate, setPrevSelectedDate] = useState(selectedDate)
  if (selectedDate !== prevSelectedDate) {
    setPrevSelectedDate(selectedDate)
    if (selectedDate) {
      setFocusedDate(selectedDate)
      const { year, month } = parseYMD(selectedDate)
      setCurrentYear(year)
      setCurrentMonth(month)
    }
  }

  const gridId = useId()
  const gridRef = useRef<HTMLTableElement>(null)

  const availableSet = useMemo(() => {
    if (!availableDates || availableDates.length === 0) return null
    return new Set(availableDates)
  }, [availableDates])

  const monthName = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(currentYear, currentMonth, 1))

  // Can we navigate to the previous month?
  const minParsed = parseYMD(minDate)
  const isPrevDisabled =
    currentYear < minParsed.year || (currentYear === minParsed.year && currentMonth <= minParsed.month)

  const handlePrevMonth = () => {
    if (isPrevDisabled) return
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear(y => y - 1)
    } else {
      setCurrentMonth(m => m - 1)
    }
  }

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear(y => y + 1)
    } else {
      setCurrentMonth(m => m + 1)
    }
  }

  // Days matrix for the current month
  const calendarWeeks = useMemo(() => {
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay()
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()

    const weeks: Array<Array<{ dateStr: string; dayNumber: number; isCurrentMonth: boolean }>> = []
    let currentWeek: Array<{ dateStr: string; dayNumber: number; isCurrentMonth: boolean }> = []

    // Previous month padding
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate()
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const day = prevMonthDays - i
      const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1
      const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear
      currentWeek.push({
        dateStr: formatYMD(prevYear, prevMonth, day),
        dayNumber: day,
        isCurrentMonth: false,
      })
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      currentWeek.push({
        dateStr: formatYMD(currentYear, currentMonth, day),
        dayNumber: day,
        isCurrentMonth: true,
      })
      if (currentWeek.length === 7) {
        weeks.push(currentWeek)
        currentWeek = []
      }
    }

    // Next month padding
    if (currentWeek.length > 0) {
      let nextDay = 1
      const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1
      const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear
      while (currentWeek.length < 7) {
        currentWeek.push({
          dateStr: formatYMD(nextYear, nextMonth, nextDay++),
          dayNumber: nextDay - 1,
          isCurrentMonth: false,
        })
      }
      weeks.push(currentWeek)
    }

    return weeks
  }, [currentYear, currentMonth])

  // Move roving focus
  const moveFocus = (targetDate: string) => {
    setFocusedDate(targetDate)
    const { year, month } = parseYMD(targetDate)
    if (year !== currentYear || month !== currentMonth) {
      setCurrentYear(year)
      setCurrentMonth(month)
    }
    // Focus the cell button once rendered
    setTimeout(() => {
      const btn = gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${targetDate}"]`)
      btn?.focus()
    }, 0)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
    let handled = false

    switch (e.key) {
      case 'ArrowLeft':
        moveFocus(addDaysToYMD(focusedDate, -1))
        handled = true
        break
      case 'ArrowRight':
        moveFocus(addDaysToYMD(focusedDate, 1))
        handled = true
        break
      case 'ArrowUp':
        moveFocus(addDaysToYMD(focusedDate, -7))
        handled = true
        break
      case 'ArrowDown':
        moveFocus(addDaysToYMD(focusedDate, 7))
        handled = true
        break
      case 'Home':
        moveFocus(formatYMD(currentYear, currentMonth, 1))
        handled = true
        break
      case 'End':
        moveFocus(formatYMD(currentYear, currentMonth, daysInMonth))
        handled = true
        break
      case 'PageUp':
        handlePrevMonth()
        handled = true
        break
      case 'PageDown':
        handleNextMonth()
        handled = true
        break
      default:
        break
    }

    if (handled) {
      e.preventDefault()
    }
  }

  return (
    <div className="booking-date-picker">
      <header className="booking-date-picker__header">
        <h3 id={`${gridId}-title`} className="booking-date-picker__month-title">
          {monthName}
        </h3>
        <div className="booking-date-picker__nav">
          <button
            type="button"
            className="booking-date-picker__nav-btn"
            onClick={handlePrevMonth}
            disabled={isPrevDisabled}
            aria-label="Previous month"
          >
            ←
          </button>
          <button
            type="button"
            className="booking-date-picker__nav-btn"
            onClick={handleNextMonth}
            aria-label="Next month"
          >
            →
          </button>
        </div>
      </header>

      <table
        ref={gridRef}
        role="grid"
        aria-labelledby={`${gridId}-title`}
        className="booking-date-picker__grid"
        onKeyDown={handleKeyDown}
      >
        <thead>
          <tr role="row">
            {WEEKDAYS.map(w => (
              <th key={w.short} role="columnheader" aria-label={w.full} className="booking-date-picker__weekday">
                {w.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendarWeeks.map((week, weekIdx) => (
            <tr key={`week-${weekIdx}`} role="row">
              {week.map(cell => {
                const isPast = cell.dateStr < minDate
                const isAvailable = availableSet ? availableSet.has(cell.dateStr) : !isPast
                const isSelected = selectedDate === cell.dateStr
                const isFocused = focusedDate === cell.dateStr
                const isToday = cell.dateStr === today

                const dateObj = new Date(parseYMD(cell.dateStr).year, parseYMD(cell.dateStr).month, cell.dayNumber)
                const accessibleLabel = new Intl.DateTimeFormat('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                }).format(dateObj)

                const classNames = [
                  'booking-date-picker__day-btn',
                  cell.isCurrentMonth ? '' : 'booking-date-picker__day-btn--outside',
                  isToday ? 'booking-date-picker__day-btn--today' : '',
                  isSelected ? 'booking-date-picker__day-btn--selected' : '',
                  !isAvailable ? 'booking-date-picker__day-btn--disabled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <td key={cell.dateStr} role="gridcell" className="booking-date-picker__cell">
                    <button
                      type="button"
                      data-date={cell.dateStr}
                      className={classNames}
                      disabled={!isAvailable}
                      tabIndex={isFocused ? 0 : -1}
                      aria-selected={isSelected}
                      aria-label={`${accessibleLabel}${isToday ? ', Today' : ''}${isSelected ? ', Selected' : ''}${!isAvailable ? ', Unavailable' : ''}`}
                      onClick={() => {
                        if (isAvailable) {
                          setFocusedDate(cell.dateStr)
                          onSelectDate(cell.dateStr)
                        }
                      }}
                    >
                      <span className="booking-date-picker__day-number">{cell.dayNumber}</span>
                      {isAvailable && !isSelected && <span className="booking-date-picker__dot" aria-hidden="true" />}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
