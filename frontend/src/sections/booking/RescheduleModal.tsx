import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  submitRescheduleBooking,
  unlockRescheduleBooking,
  type RescheduleBookingData,
  type RescheduleResultData,
} from '../../api/client'
import type { RescheduleSlotOption } from '../../types/booking'
import { formatSlotTime, parseYMD } from './bookingUtils'
import { formatPhoneInput } from '../../utils/phone'

interface RescheduleModalProps {
  bookingId?: string | number
  token?: string
  onClose: () => void
}

function formatDateLabel(dateStr: string): string {
  try {
    const { year, month, day } = parseYMD(dateStr)
    const d = new Date(Date.UTC(year, month, day))
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d)
  } catch {
    return dateStr
  }
}

function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

function formatDeposit(booking: RescheduleBookingData): string {
  const currency = booking.currency || 'USD'
  let dollars: number | null = null
  if (typeof booking.deposit_cents === 'number' && Number.isFinite(booking.deposit_cents)) {
    dollars = booking.deposit_cents / 100
  } else if (typeof booking.deposit_amount === 'number' && Number.isFinite(booking.deposit_amount)) {
    dollars = booking.deposit_amount
  }
  if (dollars === null) return 'Paid'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(dollars)
}

export function RescheduleModal({ bookingId, token, onClose }: RescheduleModalProps) {
  const [verifyName, setVerifyName] = useState('')
  const [verifyEmail, setVerifyEmail] = useState('')
  const [verifyPhone, setVerifyPhone] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [unlockedBookingId, setUnlockedBookingId] = useState<string | number | undefined>(bookingId)
  const [unlockedToken, setUnlockedToken] = useState<string>(token || '')
  const [booking, setBooking] = useState<RescheduleBookingData | null>(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [rescheduledResult, setRescheduledResult] = useState<RescheduleResultData | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting && !verifying) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [submitting, verifying, onClose])

  const filledIdentityCount = [verifyName, verifyEmail, verifyPhone].filter(v => v.trim().length > 0).length

  const handleUnlockBooking = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (verifying) return
    if (filledIdentityCount < 2) {
      setVerifyError('Please enter at least 2 of the 3 details used when booking to unlock your reschedule calendar.')
      return
    }

    setVerifying(true)
    setVerifyError(null)
    const res = await unlockRescheduleBooking({
      bookingId,
      token,
      name: verifyName.trim(),
      email: verifyEmail.trim(),
      phone: verifyPhone.trim(),
    })

    if (res.status !== 'success' || !res.data?.booking) {
      setVerifyError(
        res.message || 'Unable to verify your booking details. Please double-check your information and try again.'
      )
      setVerifying(false)
      return
    }

    const unlocked = res.data
    setUnlockedBookingId(unlocked.bookingId ?? bookingId ?? unlocked.booking.booking_id)
    setUnlockedToken(unlocked.token ?? token ?? '')
    setBooking(unlocked.booking)
    const slots = Array.isArray(unlocked.booking.available_slots) ? unlocked.booking.available_slots : []
    if (slots.length > 0) {
      const sortedDates = Array.from(new Set(slots.map(s => s.date))).sort()
      setSelectedDate(sortedDates[0] || '')
    }
    setVerifying(false)
  }

  const slotsByDate = useMemo(() => {
    const map = new Map<string, RescheduleSlotOption[]>()
    const slots = Array.isArray(booking?.available_slots) ? booking.available_slots : []
    for (const slot of slots) {
      const list = map.get(slot.date) ?? []
      list.push(slot)
      map.set(slot.date, list)
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.start_time.localeCompare(b.start_time))
    }
    return map
  }, [booking])

  const availableDates = useMemo(() => Array.from(slotsByDate.keys()).sort(), [slotsByDate])
  const activeDate = availableDates.includes(selectedDate) ? selectedDate : (availableDates[0] || '')
  const slotsForDate = useMemo(() => slotsByDate.get(activeDate) ?? [], [slotsByDate, activeDate])

  const selectedSlot = useMemo(() => {
    if (!selectedSlotId || !booking?.available_slots) return null
    return booking.available_slots.find(s => s.id === selectedSlotId) ?? null
  }, [booking, selectedSlotId])

  const handleConfirmReschedule = async () => {
    const activeBookingId = unlockedBookingId ?? booking?.booking_id
    if (!selectedSlotId || submitting || activeBookingId === undefined || activeBookingId === '' || !unlockedToken) {
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    const res = await submitRescheduleBooking(activeBookingId, unlockedToken, selectedSlotId, {
      name: verifyName.trim() || undefined,
      email: verifyEmail.trim() || undefined,
      phone: verifyPhone.trim() || undefined,
    })
    if (res.status === 'success') {
      setRescheduledResult(res.data ?? { slot_id: selectedSlotId })
    } else {
      setSubmitError(res.message || 'Unable to reschedule your appointment. Please try another slot.')
    }
    setSubmitting(false)
  }

  const serviceName = booking?.service_name || booking?.service_title || 'Photography Session'
  const confirmedDate = rescheduledResult?.date || selectedSlot?.date || ''
  const confirmedStart = rescheduledResult?.start_time || selectedSlot?.start_time || ''
  const confirmedEnd = rescheduledResult?.end_time || selectedSlot?.end_time || ''

  return (
    <div
      className="reschedule-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => {
        if (e.target === e.currentTarget && !submitting && !verifying) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reschedule-modal-title"
        style={{
          width: 'min(100%, 560px)',
          background: '#ffffff',
          color: '#111827',
          borderRadius: '12px',
          padding: '28px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          position: 'relative',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={submitting || verifying}
          aria-label="Close reschedule modal"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'transparent',
            border: 'none',
            fontSize: '22px',
            cursor: submitting || verifying ? 'not-allowed' : 'pointer',
            lineHeight: 1,
            color: '#6b7280',
          }}
        >
          ×
        </button>

        {!booking ? (
          <form onSubmit={handleUnlockBooking} noValidate>
            <h3 id="reschedule-modal-title" style={{ fontSize: '22px', margin: '0 0 8px 0', fontWeight: 700 }}>
              Verify Your Booking
            </h3>
            <p style={{ margin: '0 0 18px 0', color: '#4b5563', fontSize: '14px', lineHeight: 1.5 }}>
              Enter at least 2 of the 3 details used when booking to unlock your reschedule calendar.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label
                  htmlFor="reschedule-verify-name"
                  style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}
                >
                  Full Name
                </label>
                <input
                  id="reschedule-verify-name"
                  type="text"
                  autoComplete="name"
                  value={verifyName}
                  disabled={verifying}
                  onChange={e => {
                    setVerifyName(e.target.value)
                    setVerifyError(null)
                  }}
                  placeholder="Jane Doe"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    background: '#ffffff',
                    color: '#111827',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="reschedule-verify-email"
                  style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}
                >
                  Email
                </label>
                <input
                  id="reschedule-verify-email"
                  type="email"
                  autoComplete="email"
                  value={verifyEmail}
                  disabled={verifying}
                  onChange={e => {
                    setVerifyEmail(e.target.value)
                    setVerifyError(null)
                  }}
                  placeholder="jane@example.com"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    background: '#ffffff',
                    color: '#111827',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="reschedule-verify-phone"
                  style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}
                >
                  Phone Number
                </label>
                <input
                  id="reschedule-verify-phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={14}
                  autoComplete="tel"
                  value={verifyPhone}
                  disabled={verifying}
                  onChange={e => {
                    setVerifyPhone(formatPhoneInput(e.target.value))
                    setVerifyError(null)
                  }}
                  placeholder="(212) 555-0148"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    background: '#ffffff',
                    color: '#111827',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            {verifyError && (
              <p role="alert" style={{ color: '#dc2626', fontSize: '14px', margin: '0 0 14px 0' }}>
                {verifyError}
              </p>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={verifying}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '8px',
                  background: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: verifying ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={verifying}
                style={{
                  flex: 2,
                  padding: '12px',
                  borderRadius: '8px',
                  background: verifying ? '#9ca3af' : '#111827',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: verifying ? 'not-allowed' : 'pointer',
                }}
              >
                {verifying ? 'Verifying…' : 'Unlock Booking'}
              </button>
            </div>
          </form>
        ) : rescheduledResult ? (
          <div>
            <div style={{ textAlign: 'center', marginBlock: '16px' }}>
              <div style={{ fontSize: '48px', marginBottom: '8px' }}>✓</div>
              <h3 id="reschedule-modal-title" style={{ fontSize: '24px', margin: '0 0 8px 0', fontWeight: 700 }}>
                Appointment Rescheduled!
              </h3>
              <p style={{ color: '#4b5563', margin: 0, fontSize: '15px' }}>
                Your booking #{booking.booking_id || unlockedBookingId} has been updated.
              </p>
            </div>

            <div
              style={{
                background: '#f9fafb',
                borderRadius: '8px',
                padding: '16px',
                margin: '16px 0',
                fontSize: '14px',
              }}
            >
              {booking.customer_name && (
                <p style={{ margin: '0 0 8px 0' }}>
                  <strong>Client:</strong> {booking.customer_name}
                </p>
              )}
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>Service:</strong> {serviceName}
              </p>
              <p style={{ margin: '0 0 8px 0' }}>
                <strong>New Appointment:</strong> {formatDateLabel(confirmedDate)} at {formatSlotTime(confirmedStart)}
                {confirmedEnd ? ` – ${formatSlotTime(confirmedEnd)}` : ''}
              </p>
              <p style={{ margin: 0 }}>
                <strong>Deposit Paid:</strong> {formatDeposit(booking)}
              </p>
            </div>

            <div
              style={{
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#065f46',
              }}
            >
              Any scheduled balance invoice has been automatically updated to your new session date and time.
            </div>

            {(rescheduledResult.google_calendar_url || rescheduledResult.ics_url) && (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {rescheduledResult.google_calendar_url && (
                  <a
                    href={rescheduledResult.google_calendar_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1,
                      minWidth: '160px',
                      textAlign: 'center',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: '#f3f4f6',
                      color: '#111827',
                      border: '1px solid #d1d5db',
                      fontWeight: 600,
                      fontSize: '13px',
                      textDecoration: 'none',
                    }}
                  >
                    Add to Google Calendar
                  </a>
                )}
                {rescheduledResult.ics_url && (
                  <a
                    href={rescheduledResult.ics_url}
                    download
                    style={{
                      flex: 1,
                      minWidth: '160px',
                      textAlign: 'center',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: '#f3f4f6',
                      color: '#111827',
                      border: '1px solid #d1d5db',
                      fontWeight: 600,
                      fontSize: '13px',
                      textDecoration: 'none',
                    }}
                  >
                    Download Calendar Invite (.ics)
                  </a>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                background: '#111827',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '15px',
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <div>
            <h3 id="reschedule-modal-title" style={{ fontSize: '22px', margin: '0 0 16px 0', fontWeight: 700 }}>
              Reschedule Your Appointment
            </h3>

            <div
              style={{
                background: '#f9fafb',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px',
                fontSize: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', gap: '12px' }}>
                <span style={{ color: '#4b5563' }}>Service</span>
                <strong>{serviceName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', gap: '12px' }}>
                <span style={{ color: '#4b5563' }}>Current Appointment</span>
                <span>
                  {formatDateLabel(booking.date)} ({formatSlotTime(booking.start_time)})
                </span>
              </div>
              {booking.customer_name && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', gap: '12px' }}>
                  <span style={{ color: '#4b5563' }}>Client</span>
                  <span>{booking.customer_name}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ color: '#4b5563' }}>Deposit Paid</span>
                <strong>{formatDeposit(booking)}</strong>
              </div>
            </div>

            {availableDates.length === 0 ? (
              <p style={{ fontSize: '14px', color: '#4b5563', margin: '0 0 20px 0' }}>
                There are no open timeslots available for self-service rescheduling right now. Please contact us directly to arrange a new time.
              </p>
            ) : (
              <>
                <div style={{ marginBottom: '16px' }}>
                  <label
                    htmlFor="reschedule-date-select"
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: '6px',
                    }}
                  >
                    Select New Date
                  </label>
                  <select
                    id="reschedule-date-select"
                    value={activeDate}
                    disabled={submitting}
                    onChange={e => {
                      setSelectedDate(e.target.value)
                      setSelectedSlotId(null)
                      setSubmitError(null)
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      background: '#ffffff',
                      color: '#111827',
                      fontSize: '14px',
                    }}
                  >
                    {availableDates.map(date => (
                      <option key={date} value={date}>
                        {formatDateLabel(date)}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: '8px',
                    }}
                  >
                    Select New Time Slot
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
                    {slotsForDate.map(slot => {
                      const isSelected = selectedSlotId === slot.id
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          disabled={submitting}
                          onClick={() => {
                            setSelectedSlotId(slot.id)
                            setSubmitError(null)
                          }}
                          style={{
                            padding: '10px 12px',
                            borderRadius: '8px',
                            border: isSelected ? '1px solid #111827' : '1px solid #d1d5db',
                            background: isSelected ? '#111827' : '#ffffff',
                            color: isSelected ? '#ffffff' : '#111827',
                            fontWeight: 600,
                            fontSize: '13px',
                            cursor: submitting ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {formatSlotTime(slot.start_time)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {booking.rescheduleFeeCents && booking.rescheduleFeeCents > 0 ? (
              <div
                role="note"
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fcd34d',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  marginBottom: '16px',
                  fontSize: '13px',
                  color: '#92400e',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '6px' }}>
                  Reschedule Fee Notice
                </div>
                {Array.isArray(booking.rescheduleFeeItems) && booking.rescheduleFeeItems.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                    {booking.rescheduleFeeItems.map((item, idx) => (
                      <div key={`${item.name}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                        <span>{item.name}</span>
                        <span>+{formatCents(item.amountCents, booking.currency || 'USD')}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontWeight: 600 }}>
                  +{formatCents(booking.rescheduleFeeCents, booking.currency || 'USD')} added to your remaining balance
                </div>
              </div>
            ) : null}

            {submitError && (
              <p role="alert" style={{ color: '#dc2626', fontSize: '14px', margin: '0 0 12px 0' }}>
                {submitError}
              </p>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '8px',
                  background: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReschedule}
                disabled={submitting || !selectedSlotId}
                style={{
                  flex: 2,
                  padding: '12px',
                  borderRadius: '8px',
                  background: submitting || !selectedSlotId ? '#9ca3af' : '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: submitting || !selectedSlotId ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Rescheduling…' : 'Confirm Reschedule'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
