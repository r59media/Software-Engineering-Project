import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'
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

// Tracks the previously rendered step across BookingStage remounts so the yellow
// highlight can glide from the previous chevron arrow into the newly active one.
let lastRenderedStepIndex: number | null = null

interface ProgressStepItemProps {
  step: StepDef
  index: number
  currentIndex: number
  prevIndex: number
  progress: MotionValue<number>
  reducedMotion: boolean
  onStepClick?: (step: BookingStep) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>, stepId: BookingStep, isNavigable: boolean) => void
}

function ProgressStepItem({
  step,
  index,
  currentIndex,
  prevIndex,
  progress,
  reducedMotion,
  onStepClick,
  onKeyDown,
}: ProgressStepItemProps) {
  const start = index * 0.13
  const end = start + 0.44
  const opacity = useTransform(progress, [start, end], [0, 1], { clamp: true })
  const x = useTransform(progress, [start, end], [-28, 0], { clamp: true })

  const isCurrent = index === currentIndex
  const isCompleted = index < currentIndex
  const isNavigable = isCompleted && Boolean(onStepClick)

  const hasTransition = !reducedMotion && prevIndex !== currentIndex
  const goingForward = currentIndex > prevIndex
  const minIdx = Math.min(prevIndex, currentIndex)
  const maxIdx = Math.max(prevIndex, currentIndex)
  const isLeaving = hasTransition && index === prevIndex
  const isPassingThrough = hasTransition && index > minIdx && index < maxIdx

  let modifier = 'booking-progress__item--upcoming'
  if (isCurrent) modifier = 'booking-progress__item--current'
  else if (isCompleted) modifier = 'booking-progress__item--completed'

  return (
    <motion.li
      className={`booking-progress__item ${modifier} ${isNavigable ? 'booking-progress__item--clickable' : ''}`}
      style={reducedMotion ? undefined : { opacity, x }}
      aria-current={isCurrent ? 'step' : undefined}
      role={isNavigable ? 'button' : undefined}
      tabIndex={isNavigable ? 0 : undefined}
      onClick={isNavigable ? () => onStepClick?.(step.id) : undefined}
      onKeyDown={isNavigable ? e => onKeyDown(e, step.id, isNavigable) : undefined}
      aria-label={
        isCurrent
          ? `Step ${step.number}: ${step.label} (Current Step)`
          : isCompleted
            ? `Step ${step.number}: ${step.label} (Completed, click to return)`
            : `Step ${step.number}: ${step.label}`
      }
    >
      {isCurrent && (
        <motion.span
          className="booking-progress__fill"
          aria-hidden="true"
          initial={hasTransition ? { x: goingForward ? '-104%' : '104%' } : false}
          animate={{ x: '0%' }}
          transition={
            hasTransition
              ? {
                  duration: 0.36,
                  delay: 0.08 + Math.max(0, Math.abs(currentIndex - prevIndex) - 1) * 0.08,
                  ease: [0.22, 1, 0.36, 1],
                }
              : { duration: 0 }
          }
        />
      )}
      {isLeaving && (
        <motion.span
          className="booking-progress__fill"
          aria-hidden="true"
          initial={{ x: '0%' }}
          animate={{ x: goingForward ? '104%' : '-104%' }}
          transition={{ duration: 0.28, delay: 0.04, ease: [0.4, 0, 0.2, 1] }}
        />
      )}
      {isPassingThrough && (
        <motion.span
          className="booking-progress__fill"
          aria-hidden="true"
          initial={{ x: goingForward ? '-104%' : '104%' }}
          animate={{ x: goingForward ? '104%' : '-104%' }}
          transition={{
            duration: 0.26,
            delay: 0.04 + Math.abs(index - prevIndex) * 0.08,
            ease: 'linear',
          }}
        />
      )}
      <span className="booking-progress__indicator" aria-hidden="true">
        {isCompleted ? '✓' : step.number}
      </span>
      <span className="booking-progress__label">{step.label}</span>
    </motion.li>
  )
}

export function BookingProgressBar({ currentStep, onStepClick }: BookingProgressBarProps) {
  const currentIndex = STEPS.findIndex(s => s.id === currentStep)
  const [prevIndex] = useState(() => lastRenderedStepIndex ?? currentIndex)
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: navRef,
    offset: ['start 0.82', 'start 0.42'],
  })

  useEffect(() => {
    lastRenderedStepIndex = currentIndex
  }, [currentIndex])

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
    <nav ref={navRef} className="booking-progress" aria-label="Booking progress">
      <ol ref={listRef} className="booking-progress__list">
        {STEPS.map((step, index) => (
          <ProgressStepItem
            key={step.id}
            step={step}
            index={index}
            currentIndex={currentIndex}
            prevIndex={prevIndex}
            progress={scrollYProgress}
            reducedMotion={Boolean(prefersReducedMotion)}
            onStepClick={onStepClick}
            onKeyDown={handleKeyDown}
          />
        ))}
      </ol>
    </nav>
  )
}
