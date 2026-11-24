import { useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useTicketMotion } from './useTicketMotion'
import { useTicketTilt } from './useTicketTilt'
import { computeSessionPricing, type PricingData } from '../../api/client'
import { previewBookingDepositPercent } from '../../config/booking'
import type { BookingPhotoPermissions, BookingCustomerInfo, BookingDateTimeSelection, BookingReviewDraft, BookingService } from '../../types/booking'
import { BookingProgressBar } from './BookingProgressBar'
import './BookingSection.css'

interface BookingSummaryProps {
  service: BookingService
  people: number
  pricing?: PricingData | null
  dateTime: BookingDateTimeSelection
  photoPermissions: BookingPhotoPermissions
  onPhotoPermissionsChange: (permissions: BookingPhotoPermissions) => void
  selectedFeeIds?: string[]
  onSelectedFeeIdsChange?: (ids: string[]) => void
  customerInfo: BookingCustomerInfo
  onEdit: (step: 'services' | 'datetime' | 'info') => void
  onProceedToDeposit?: (draft: BookingReviewDraft) => void | Promise<void>
}

export function BookingSummary({
  service,
  people,
  pricing = null,
  dateTime,
  customerInfo,
  photoPermissions,
  onPhotoPermissionsChange,
  selectedFeeIds = [],
  onSelectedFeeIdsChange,
  onEdit,
  onProceedToDeposit,
}: BookingSummaryProps) {
  const { shared, transition } = useTicketMotion()
  const { tiltTicket, resetTilt } = useTicketTilt(6)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const date = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateTime.date}T12:00:00Z`))
  const breakdown = computeSessionPricing(service, people, pricing, previewBookingDepositPercent, {
    sessionDate: dateTime.date,
    photoPermissions,
    selectedFeeIds,
  })
  const formatCurrency = (minor: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: service.currency }).format(minor / 100)
  const price = breakdown.subtotalMinor === null ? 'Custom pricing' : formatCurrency(breakdown.subtotalMinor)
  const depositPrice = breakdown.depositMinor !== null
    ? formatCurrency(breakdown.depositMinor)
    : null
  const balancePrice = breakdown.subtotalMinor !== null && breakdown.depositMinor !== null
    ? formatCurrency(breakdown.subtotalMinor - breakdown.depositMinor)
    : null
  const optionalAddOns = (pricing?.feeRules ?? []).filter(
    rule => rule.active !== false && String(rule.trigger).toLowerCase() === 'client_selectable'
  )
  const toggleAddOn = (ruleId: string, checked: boolean) => {
    if (!onSelectedFeeIdsChange) return
    if (checked) {
      onSelectedFeeIdsChange(selectedFeeIds.includes(ruleId) ? selectedFeeIds : [...selectedFeeIds, ruleId])
    } else {
      onSelectedFeeIdsChange(selectedFeeIds.filter(id => id !== ruleId))
    }
  }
  const proceed = async () => {
    if (lock.current || !onProceedToDeposit) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      await onProceedToDeposit({
        serviceId: service.id,
        people,
        dateTime,
        customerInfo,
        photoPermissions: { ...photoPermissions },
        photoPermissionTextVersion: '2026-11-11-v1',
        selectedFeeIds: [...selectedFeeIds],
        slotId: dateTime.slotId,
        slot_id: dateTime.slotId,
      })
    }
    catch { setError('We couldn’t continue to the deposit. Your details are still here. Please try again.') }
    finally { lock.current = false; setBusy(false) }
  }

  return <div className="booking-review">
    <header className="booking-review__header">
      <div className="booking__title-group">
        <p className="booking__eyebrow">
          <span aria-hidden="true" />
          Booking
        </p>
        <h2 id="booking-title">BOOK YOUR SESSION</h2>
      </div>
      <p className="booking-review__subtitle">Review your details before continuing to your deposit.</p>
    </header>
    <BookingProgressBar currentStep="summary" onStepClick={step => { if (!busy && (step === 'services' || step === 'datetime' || step === 'info')) onEdit(step) }} />
    <div className="booking-review__intro"><div><h3>Everything look right?</h3><p>Check your session and contact details below.</p></div><button className="booking-review__edit" disabled={busy} onClick={() => onEdit('info')}>← Back to your information</button></div>
    <div className="booking-review__ticket-layout">
      <div
        className="booking-review__ticket-frame"
        onPointerMove={tiltTicket}
        onPointerLeave={resetTilt}
        onPointerCancel={resetTilt}
      >
        <motion.article
          layoutId={shared ? 'booking-ticket' : undefined}
          transition={transition}
          className="booking-review__ticket"
          aria-label="Your session review"
          aria-busy={busy}
        >
          <header className="booking-review__ticket-heading">
        <motion.h3 layout="position" layoutId={shared ? 'booking-ticket-title' : undefined} transition={transition}>
          YOUR SESSION <em>SUMMARY</em>
        </motion.h3>
        <img className="booking-review__logo" src={`${import.meta.env.BASE_URL}r59Media_logo.svg`} alt="R59 Media" width="121" height="75" />
      </header>
      <div className="booking-review__columns">
        <section className="booking-review__block booking-review__service">
          <div className="booking-review__block-heading"><h4>{service.name}</h4><button className="booking-review__edit" disabled={busy} onClick={() => onEdit('services')}>Edit service</button></div>
          <div className="booking-review__detail-line">
            <p>{service.durationMinutes === null ? 'Custom scope' : `${service.durationMinutes} minutes`} · {people} {people === 1 ? 'person' : 'people'}</p>
            {(Boolean(service.photoCount) || Boolean(service.outfits)) && <p>{[service.photoCount ? `${service.photoCount} photos` : '', service.outfits ? `${service.outfits} ${service.outfits === 1 ? 'outfit' : 'outfits'}` : ''].filter(Boolean).join(' · ')}</p>}
          </div>
        </section>
        <section className="booking-review__block booking-review__date">
          <div className="booking-review__block-heading"><h4>Date and time</h4><button className="booking-review__edit" disabled={busy} onClick={() => onEdit('datetime')}>Edit date &amp; time</button></div>
          <div className="booking-review__detail-line"><strong>{date}</strong><p>{dateTime.timeSlot} · {dateTime.timezone.replace(/^Eastern Time.*$/, 'ET') || 'ET'}</p></div>
        </section>
        <section className="booking-review__block booking-review__contact-block">
          <div className="booking-review__block-heading"><h4>Contact details</h4><button className="booking-review__edit" disabled={busy} onClick={() => onEdit('info')}>Edit contact</button></div>
          <dl className="booking-review__contact booking-review__detail-line"><div><dt>Name</dt><dd>{customerInfo.firstName} {customerInfo.lastName}</dd></div><div><dt>Email address</dt><dd>{customerInfo.email}</dd></div><div><dt>Phone number</dt><dd>{customerInfo.phone}</dd></div></dl>
        </section>
        {customerInfo.notes && <section className="booking-review__block booking-review__notes"><div className="booking-review__block-heading"><h4>Your notes</h4><button className="booking-review__edit" disabled={busy} onClick={() => onEdit('info')}>Edit notes</button></div><p className="booking-review__detail-line">{customerInfo.notes}</p></section>}
      </div>
      <fieldset className="booking-review__permissions" disabled={busy} aria-describedby="photo-permissions-help">
        <legend>Photo sharing permission <span>— Optional</span></legend>
        <p id="photo-permissions-help">Choose where R59MEDIA may share photos of you from this session. Leaving these unchecked will not affect your booking.</p>
        <label><input type="checkbox" checked={photoPermissions.websitePortfolio} onChange={event => onPhotoPermissionsChange({ ...photoPermissions, websitePortfolio: event.target.checked })} /><span>I allow R59MEDIA to feature photos of me from this session on its website and portfolio.</span></label>
        <label><input type="checkbox" checked={photoPermissions.socialMedia} onChange={event => onPhotoPermissionsChange({ ...photoPermissions, socialMedia: event.target.checked })} /><span>I allow R59MEDIA to share photos of me from this session on its social media accounts.</span></label>
        <p>These permissions do not include paid advertising, sale, or licensing to third parties.</p>
      </fieldset>
      {optionalAddOns.length > 0 && (
        <fieldset className="booking-review__permissions" disabled={busy}>
          <legend>Optional session add-ons <span>— Optional</span></legend>
          {optionalAddOns.map(rule => {
            const checked = selectedFeeIds.includes(rule.id)
            const feeLabel = rule.amountType === 'percent'
              ? `+${rule.amount}%`
              : `+${formatCurrency(rule.amountMinor !== undefined ? rule.amountMinor : Math.round(rule.amount * 100))}`
            return (
              <label key={rule.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={event => toggleAddOn(rule.id, event.target.checked)}
                />
                <span>
                  <strong>{rule.name}</strong> ({feeLabel})
                  {rule.description ? ` — ${rule.description}` : ''}
                </span>
              </label>
            )
          })}
        </fieldset>
      )}
      {breakdown.subtotalMinor !== null && (breakdown.baseFeeMinor > 0 || breakdown.extraPeopleFeeMinor > 0 || breakdown.appliedFees.length > 0) && (
        <div className="booking-review__permissions" style={{ paddingBottom: '4px' }} aria-label="Itemized price breakdown">
          <p style={{ fontWeight: 700, marginBottom: '6px' }}>Itemized Summary</p>
          <div style={{ display: 'grid', gap: '4px', fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span>{service.name}</span>
              <span>{formatCurrency(service.priceMinor ?? 0)}</span>
            </div>
            {breakdown.baseFeeMinor > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <span>Base booking fee</span>
                <span>{formatCurrency(breakdown.baseFeeMinor)}</span>
              </div>
            )}
            {breakdown.extraPeopleFeeMinor > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <span>Additional attendees</span>
                <span>{formatCurrency(breakdown.extraPeopleFeeMinor)}</span>
              </div>
            )}
            {breakdown.appliedFees.map(fee => (
              <div key={fee.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <span>{fee.name}</span>
                <span>{formatCurrency(fee.amountMinor)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <footer className="booking-review__footer">
        <div className="booking-review__price">
          <span className="booking-review__total-label">SESSION TOTAL</span>
          <strong>{price}</strong>
          <div className="booking-review__deposit-block">
            <div className="booking-review__deposit-badge-row">
              <span className="booking-review__deposit-badge">{breakdown.depositPercent}% DEPOSIT</span>
              {depositPrice && <span className="booking-review__deposit-due">Due today: <b>{depositPrice}</b></span>}
            </div>
            <p className="booking-review__deposit-note">
              {balancePrice
                ? `Remaining balance (${balancePrice}) paid on session date.`
                : 'Review your final total and payment details at the deposit step.'}
            </p>
          </div>
        </div>
      </footer>
      </motion.article>
      <button className="booking-review__button" disabled={busy || !onProceedToDeposit} onClick={() => void proceed()}>{busy ? 'Continuing…' : 'Continue to deposit →'}</button>
      </div>
    </div>
    {error && <p className="booking-review__error" role="alert">{error}</p>}
  </div>
}
