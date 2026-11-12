import { useRef, useState } from 'react'
import { previewBookingDepositPercent } from '../../config/booking'
import type { BookingPhotoPermissions, BookingCustomerInfo, BookingDateTimeSelection, BookingReviewDraft, BookingService } from '../../types/booking'
import { BookingProgressBar } from './BookingProgressBar'
import './BookingSection.css'

interface BookingSummaryProps {
  service: BookingService
  people: number
  dateTime: BookingDateTimeSelection
  photoPermissions: BookingPhotoPermissions
  onPhotoPermissionsChange: (permissions: BookingPhotoPermissions) => void
  customerInfo: BookingCustomerInfo
  onEdit: (step: 'services' | 'datetime' | 'info') => void
  onProceedToDeposit?: (draft: BookingReviewDraft) => void | Promise<void>
}

export function BookingSummary({ service, people, dateTime, customerInfo, photoPermissions, onPhotoPermissionsChange, onEdit, onProceedToDeposit }: BookingSummaryProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const date = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateTime.date}T12:00:00Z`))
  const price = service.priceMinor === null ? 'Custom pricing' : new Intl.NumberFormat('en-US', { style: 'currency', currency: service.currency }).format(service.priceMinor / 100)
  const proceed = async () => {
    if (lock.current || !onProceedToDeposit) return
    lock.current = true
    setBusy(true)
    setError(null)
    try { await onProceedToDeposit({ serviceId: service.id, people, dateTime, customerInfo, photoPermissions: { ...photoPermissions }, photoPermissionTextVersion: '2026-11-11-v1', slotId: dateTime.slotId, slot_id: dateTime.slotId }) }
    catch { setError('We couldn’t continue to the deposit. Your details are still here. Please try again.') }
    finally { lock.current = false; setBusy(false) }
  }

  return <div className="booking-review">
    <header className="booking-review__header"><h2 id="booking-title">BOOK YOUR SESSION</h2><p>Review your details before continuing to your deposit.</p></header>
    <BookingProgressBar currentStep="summary" onStepClick={step => { if (!busy && (step === 'services' || step === 'datetime' || step === 'info')) onEdit(step) }} />
    <div className="booking-review__intro"><div><h3>Everything look right?</h3><p>Check your session and contact details below.</p></div><button className="booking-review__edit" disabled={busy} onClick={() => onEdit('info')}>← Back to your information</button></div>
    <div className="booking-review__ticket-layout">
    <article className="booking-review__ticket" aria-label="Your session review" aria-busy={busy}>
      <header className="booking-review__ticket-heading">
        <h3>YOUR <em>SESSION</em></h3>
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
      <footer className="booking-review__footer">
        <div className="booking-review__price"><span>SESSION BASE PRICE</span><strong>{price}</strong><div><b>{previewBookingDepositPercent}% deposit to reserve</b><p>Review your final total and payment details at the deposit step.</p></div></div>
      </footer>
    </article>
    <button className="booking-review__button" disabled={busy || !onProceedToDeposit} onClick={() => void proceed()}>{busy ? 'Continuing…' : 'Continue to deposit →'}</button>
    </div>
    {error && <p className="booking-review__error" role="alert">{error}</p>}
  </div>
}
