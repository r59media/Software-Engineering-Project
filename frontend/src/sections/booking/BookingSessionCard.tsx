import type { BookingSessionCardProps } from '../../types/booking'
import './BookingSessionCard.css'

export function BookingSessionCard({
  service,
  people,
  dateTime,
  onEditService,
  onEditDateTime,
}: BookingSessionCardProps) {
  const extra = service.additionalPeople
  const extraPeople = extra ? Math.max(0, people - extra.includedPeople) : 0
  const extraCostMinor = extra ? extraPeople * (extra.extraPersonPriceMinor ?? 0) : 0
  const isCustomPrice = service.priceMinor === null
  const totalMinor = isCustomPrice ? null : (service.priceMinor ?? 0) + extraCostMinor
  const depositMinor = totalMinor !== null ? Math.round(totalMinor * 0.5) : null

  const formatCurrency = (minor: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: service.currency || 'USD',
      maximumFractionDigits: 0,
    }).format(minor / 100)

  const formattedPrice = totalMinor !== null ? formatCurrency(totalMinor) : 'Custom pricing'
  const formattedDeposit = depositMinor !== null ? formatCurrency(depositMinor) : null

  const durationText =
    service.durationMinutes === null
      ? 'Scope tailored to you'
      : service.durationMinutes >= 180
        ? `${service.durationMinutes / 60} hours`
        : `${service.durationMinutes} min`

  const formatDate = (dateStr: string) => {
    try {
      const [y, m, d] = dateStr.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(date)
    } catch {
      return dateStr
    }
  }

  return (
    <aside className="booking-session-card" aria-label="Session summary ticket">
      <div className="booking-session-card__body">
        <header className="booking-session-card__header">
          <span className="booking-session-card__badge">SESSION TICKET</span>
          <span className="booking-session-card__id">#R59-{service.id.toUpperCase()}</span>
        </header>

        <div className="booking-session-card__service-info">
          <div className="booking-session-card__service-title-row">
            <h4 className="booking-session-card__service-name">{service.name}</h4>
            {onEditService && (
              <button
                type="button"
                className="booking-session-card__change-btn"
                onClick={onEditService}
                aria-label={`Change service from ${service.name}`}
              >
                Change
              </button>
            )}
          </div>
          {service.bestFor && <p className="booking-session-card__best-for">Best for: {service.bestFor}</p>}
        </div>

        <dl className="booking-session-card__meta">
          <div className="booking-session-card__meta-item">
            <dt>Duration</dt>
            <dd>{durationText}</dd>
          </div>
          <div className="booking-session-card__meta-item">
            <dt>Attendees</dt>
            <dd>{people === 1 ? '1 person' : `${people} people`}</dd>
          </div>
          {Boolean(service.photoCount) && (
            <div className="booking-session-card__meta-item">
              <dt>Deliverables</dt>
              <dd>{service.photoCount} edited photos</dd>
            </div>
          )}
          {Boolean(service.outfits) && (
            <div className="booking-session-card__meta-item">
              <dt>Wardrobe</dt>
              <dd>
                {service.outfits} outfit{service.outfits === 1 ? '' : 's'}
              </dd>
            </div>
          )}
        </dl>

        <div className="booking-session-card__perforation" aria-hidden="true">
          <div className="booking-session-card__hole booking-session-card__hole--left" />
          <div className="booking-session-card__dashes" />
          <div className="booking-session-card__hole booking-session-card__hole--right" />
        </div>

        <section className="booking-session-card__datetime" aria-label="Selected date and time">
          <div className="booking-session-card__datetime-header">
            <span className="booking-session-card__datetime-label">APPOINTMENT</span>
            {dateTime && onEditDateTime && (
              <button
                type="button"
                className="booking-session-card__change-btn"
                onClick={onEditDateTime}
                aria-label="Change appointment date or time"
              >
                Change
              </button>
            )}
          </div>
          {dateTime ? (
            <div className="booking-session-card__datetime-val">
              <span className="booking-session-card__datetime-icon" aria-hidden="true">
                📅
              </span>
              <div className="booking-session-card__datetime-text">
                <strong>{formatDate(dateTime.date)}</strong>
                <span>
                  {dateTime.timeSlot} ({dateTime.timezone || 'ET'})
                </span>
              </div>
            </div>
          ) : (
            <div className="booking-session-card__datetime-val booking-session-card__datetime-val--pending">
              <span className="booking-session-card__datetime-icon" aria-hidden="true">
                ⏱
              </span>
              <span>Select date &amp; time</span>
            </div>
          )}
        </section>

        <footer className="booking-session-card__pricing">
          <div className="booking-session-card__price-row">
            <span className="booking-session-card__price-label">Estimated Total</span>
            <strong className="booking-session-card__price">{formattedPrice}</strong>
          </div>
          {extraPeople > 0 && extra?.extraPersonPriceMinor && (
            <p className="booking-session-card__extra-note">
              Includes +{extraPeople} additional {extraPeople === 1 ? 'person' : 'people'} (
              +{formatCurrency(extraCostMinor)})
            </p>
          )}
          <div className="booking-session-card__deposit-notice">
            <span className="booking-session-card__deposit-tag">DEPOSIT POLICY</span>
            <p>
              {formattedDeposit
                ? `A 50% deposit (${formattedDeposit}) is due upon booking to secure your slot. The remainder is due on session day.`
                : 'Deposit and payment terms are detailed in your customized proposal.'}
            </p>
          </div>
        </footer>
      </div>
      <div className="booking-session-card__sawtooth" aria-hidden="true" />
    </aside>
  )
}
