import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { BookingProgressBarProps, BookingStep } from '../../types/booking'
import './BookingProgressBar.css'

interface StepDef {
  id: BookingStep
  label: string
  number: number
}

const STEPS: readonly StepDef[] = [
  { id: 'services', label: 'Service', number: 1 },
  { id: 'datetime', label: 'Date and Time', number: 2 },
  { id: 'info', label: 'Your information', number: 3 },
  { id: 'summary', label: 'Summary', number: 4 },
  { id: 'deposit', label: 'Deposit', number: 5 },
]

export function BookingProgressBar({ currentStep, onStepClick }: BookingProgressBarProps) {
  const currentIndex = STEPS.findIndex(s => s.id === currentStep)
  const listRef = useRef<HTMLOListElement>(null)

  // Auto-scroll on mobile to keep current step centered
  useEffect(() => {
    if (!listRef.current) return
    const activeItem = listRef.current.querySelector<HTMLElement>('[aria-current="step"]')
    if (activeItem) {
      const containerWidth = listRef.current.offsetWidth
      const itemOffset = activeItem.offsetLeft
      const itemWidth = activeItem.offsetWidth
      listRef.current.scrollTo({
        left: itemOffset - containerWidth / 2 + itemWidth / 2,
        behavior: 'smooth',
      })
    }
  }, [currentStep])

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>, stepId: BookingStep, isNavigable: boolean) => {
    if (!isNavigable) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onStepClick?.(stepId)
    }
  }

  return (
    <nav className="booking-progress" aria-label="Booking progress">
      <ol ref={listRef} className="booking-progress__list">
        {STEPS.map((step, index) => {
          const isCurrent = index === currentIndex
          const isCompleted = index < currentIndex
          const isNavigable = isCompleted && Boolean(onStepClick)

          let modifier = 'booking-progress__item--upcoming'
          if (isCurrent) modifier = 'booking-progress__item--current'
          else if (isCompleted) modifier = 'booking-progress__item--completed'

          return (
            <li
              key={step.id}
              className={`booking-progress__item ${modifier} ${isNavigable ? 'booking-progress__item--clickable' : ''}`}
              aria-current={isCurrent ? 'step' : undefined}
              role={isNavigable ? 'button' : undefined}
              tabIndex={isNavigable ? 0 : undefined}
              onClick={isNavigable ? () => onStepClick?.(step.id) : undefined}
              onKeyDown={isNavigable ? e => handleKeyDown(e, step.id, isNavigable) : undefined}
              aria-label={
                isCurrent
                  ? `Step ${step.number}: ${step.label} (Current Step)`
                  : isCompleted
                    ? `Step ${step.number}: ${step.label} (Completed, click to return)`
                    : `Step ${step.number}: ${step.label}`
              }
            >
              <span className="booking-progress__indicator" aria-hidden="true">
                {isCompleted ? '✓' : step.number}
              </span>
              <span className="booking-progress__label">{step.label}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
