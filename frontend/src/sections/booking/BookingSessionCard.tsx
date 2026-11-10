import { previewBookingDepositPercent } from '../../config/booking'
import type { BookingSessionCardProps } from '../../types/booking'
import './BookingSessionCard.css'

export function BookingSessionCard({
  service,
  people,
  dateTime,
  continueText,
  onContinue,
  isContinueDisabled = false,
}: BookingSessionCardProps) {
  const extra = service.additionalPeople
  const extraPeople = extra ? Math.max(0, people - extra.includedPeople) : 0
  const extraCostMinor = extra ? extraPeople * (extra.extraPersonPriceMinor ?? 0) : 0
  const isCustomPrice = service.priceMinor === null
  const totalMinor = isCustomPrice ? null : (service.priceMinor ?? 0) + extraCostMinor

  const formatCurrency = (minor: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: service.currency || 'USD',
      maximumFractionDigits: 0,
    }).format(minor / 100)

  const formattedPrice = totalMinor !== null ? formatCurrency(totalMinor) : 'Custom'

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

  return (
    <div className="booking-session-wrapper">
      <aside className="booking-session-card" aria-label="Your session ticket">
        <div className="booking-session-card__body">
          <h3 className="booking-session-card__title">
            <span className="booking-session-card__title-your">YOUR</span>
            <span className="booking-session-card__title-session"> SESSION</span>
          </h3>

          <div className="booking-session-card__service-name">{service.name}</div>

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
          <div className="booking-session-card__datetime-block">
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
          </div>

          <div className="booking-session-card__section-label">SESSION PRICE</div>
          <div className="booking-session-card__price-block">
            <div className="booking-session-card__price-amount">{formattedPrice}</div>
            <div className="booking-session-card__price-note">
              {previewBookingDepositPercent}% deposit to reserve
            </div>
          </div>
        </div>

        {/* Sawtooth / zigzag receipt cut */}
        <div className="booking-session-card__sawtooth" aria-hidden="true" />
      </aside>

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
