import type { PointerEvent } from 'react'
import { motion } from 'motion/react'
import { useTicketMotion } from './useTicketMotion'
import { computeSessionPricing } from '../../api/client'
import { previewBookingDepositPercent } from '../../config/booking'
import type { BookingSessionCardProps } from '../../types/booking'
import './BookingSessionCard.css'

export function BookingSessionCard({
  service,
  people,
  pricing,
  dateTime,
  customerInfo,
  continueText,
  onContinue,
  isContinueDisabled = false,
  hideDateHighlight = false,
}: BookingSessionCardProps) {
  const { shared, reduced, transition } = useTicketMotion()
  const breakdown = computeSessionPricing(service, people, pricing, previewBookingDepositPercent)
  const totalMinor = breakdown.subtotalMinor

  const formatCurrency = (minor: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: service.currency || 'USD',
      maximumFractionDigits: 0,
    }).format(minor / 100)

  const formattedPrice = totalMinor !== null ? formatCurrency(totalMinor) : 'Custom'
  const depositFormatted = breakdown.depositMinor !== null ? formatCurrency(breakdown.depositMinor) : null

  const durationText =
    service.durationMinutes === null
      ? 'Custom scope'
      : service.durationMinutes >= 180
        ? `${service.durationMinutes / 60} hours`
        : `${service.durationMinutes} minutes`

  const formatTicketDate = (dateStr: string) => {
    try {
      const [y, m, d] = dateStr.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(date)
    } catch {
      return dateStr
    }
  }

  const tiltTicket = ({ currentTarget, pointerType, clientX, clientY }: PointerEvent<HTMLDivElement>) => {
    if (pointerType !== 'mouse' || !window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches) return

    const { left, top, width, height } = currentTarget.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, (clientX - left) / width * 2 - 1))
    const y = Math.max(-1, Math.min(1, (clientY - top) / height * 2 - 1))
    const angle = Math.min(8, Math.hypot(x, y) * 8)
    currentTarget.style.setProperty('--ticket-rotation', angle ? `${-y} ${x} 0 ${angle}deg` : 'none')
  }

  const resetTilt = ({ currentTarget }: PointerEvent<HTMLDivElement>) => {
    currentTarget.style.removeProperty('--ticket-rotation')
  }

  return (
    <div className="booking-session-wrapper">
      <div className="booking-session-card-frame" onPointerMove={tiltTicket} onPointerLeave={resetTilt} onPointerCancel={resetTilt}>
        <motion.aside layoutId={shared ? 'booking-ticket' : undefined} transition={transition} className="booking-session-card" aria-label="Your session ticket">
          <div className="booking-session-card__body">
            <motion.h3 layout="position" layoutId={shared ? 'booking-ticket-title' : undefined} transition={transition} className="booking-session-card__title">
              <span className="booking-session-card__title-your">YOUR</span>
              <span className="booking-session-card__title-session"> SESSION</span>
            </motion.h3>

            <div className="booking-session-card__service-name">
              <span className="booking-session-card__service-mark" aria-hidden="true" />
              <span>{service.name}</span>
            </div>

            <div className="booking-session-card__specs">
              <div className="booking-session-card__spec-line">
                {durationText} · {people === 1 ? '1 person' : `${people} people`}
              </div>
              {(Boolean(service.photoCount) || Boolean(service.outfits)) && (
                <div className="booking-session-card__spec-line">
                  {service.photoCount ? `${service.photoCount} photos` : ''}
                  {service.photoCount && service.outfits ? ' · ' : ''}
                  {service.outfits ? `${service.outfits} outfit${service.outfits === 1 ? '' : 's'}` : ''}
                </div>
              )}
            </div>

            <div className="booking-session-card__section-label">DATE &amp; TIME</div>
            <motion.div layout layoutId={shared ? 'booking-ticket-date' : undefined} transition={transition} className="booking-session-card__datetime-block" data-highlight={!hideDateHighlight}>
              <motion.span aria-hidden="true" className="booking-session-card__date-highlight"
                initial={hideDateHighlight ? { x: '0%' } : false}
                animate={{ x: hideDateHighlight ? '-105%' : '0%' }} transition={transition} />
              <motion.span
                aria-hidden="true"
                className="booking-session-card__date-bar"
                initial={hideDateHighlight ? { scaleY: 0, opacity: 0 } : false}
                animate={{ scaleY: hideDateHighlight ? 1 : 0, opacity: hideDateHighlight ? 1 : 0 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : hideDateHighlight
                      ? { duration: 0.26, delay: 0.36, ease: [0.22, 1, 0.36, 1] }
                      : { duration: 0.14, delay: 0, ease: [0.22, 1, 0.36, 1] }
                }
              />
              {dateTime ? (
                <>
                  <div className="booking-session-card__date-val">{formatTicketDate(dateTime.date)}</div>
                  <div className="booking-session-card__time-val">
                    {dateTime.timeSlot} · {dateTime.timezone ? dateTime.timezone.replace('Eastern Time (ET)', 'ET').replace('Eastern Time (NY)', 'ET') : 'ET'}
                  </div>
                </>
              ) : (
                <div className="booking-session-card__pending-text">Select a date &amp; time</div>
              )}
            </motion.div>

            {customerInfo && (customerInfo.firstName || customerInfo.lastName) && (
              <motion.div
                layout
                layoutId={shared ? 'booking-ticket-reserved' : undefined}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={transition}
                className="booking-session-card__reserved-block"
              >
                <div className="booking-session-card__section-label">RESERVED FOR</div>
                <div className="booking-session-card__reserved-content">
                  <div className="booking-session-card__reserved-name">
                    {customerInfo.firstName} {customerInfo.lastName}
                  </div>
                  {customerInfo.email && (
                    <div className="booking-session-card__reserved-sub">{customerInfo.email}</div>
                  )}
                </div>
              </motion.div>
            )}

            <div className="booking-session-card__price-section">
              <div className="booking-session-card__section-label">SESSION PRICE</div>
              <div className="booking-session-card__price-block">
                <motion.div layout="position" layoutId={shared ? 'booking-ticket-price' : undefined} transition={transition} className="booking-session-card__price-amount">{formattedPrice}</motion.div>
                <div className="booking-session-card__price-note">
                  <span className="booking-session-card__deposit-badge">{breakdown.depositPercent}% DEPOSIT</span>
                  <span className="booking-session-card__deposit-due">
                    {depositFormatted ? `${depositFormatted} due today` : 'Due to reserve'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Sawtooth / zigzag receipt cut */}
          <div className="booking-session-card__sawtooth" aria-hidden="true" />
        </motion.aside>
      </div>

      {/* Mobile-only CTA rendered under the ticket */}
      {continueText && onContinue && (
        <button
          type="button"
          className="booking-session-card__continue-btn booking-session-card__continue-btn--mobile"
          disabled={isContinueDisabled}
          onClick={onContinue}
        >
          {continueText}
        </button>
      )}
    </div>
  )
}
