import type { BookingCustomerInfo } from '../../types/booking'
import { extractPhoneDigits } from '../../utils/phone'

export const bookingFieldLimits = { firstName: 99, lastName: 99, email: 254, phone: 25, notes: 2000 } as const
export type BookingFormErrors = Partial<Record<keyof BookingCustomerInfo, string>>

export function normalizeBookingInfo(data: BookingCustomerInfo): BookingCustomerInfo {
  return { firstName: data.firstName.trim(), lastName: data.lastName.trim(), email: data.email.trim(), phone: data.phone.trim(), notes: data.notes?.trim() || '' }
}

export function validateBookingInfo(data: BookingCustomerInfo): BookingFormErrors {
  const errors: BookingFormErrors = {}
  const clean = normalizeBookingInfo(data)
  for (const field of ['firstName', 'lastName', 'email', 'phone'] as const) {
    if (!clean[field]) errors[field] = `${{ firstName: 'First name', lastName: 'Last name', email: 'Email address', phone: 'Phone number' }[field]} is required.`
  }
  for (const field of Object.keys(bookingFieldLimits) as (keyof typeof bookingFieldLimits)[]) {
    if ((data[field] || '').length > bookingFieldLimits[field]) errors[field] = `Use ${bookingFieldLimits[field]} characters or fewer.`
  }
  for (const field of ['firstName', 'lastName', 'email', 'phone'] as const) {
    if (Array.from(data[field]).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) errors[field] = 'Remove unsupported control characters.'
  }
  if (clean.email && !errors.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) errors.email = 'Enter a valid email address, such as name@example.com.'
  if (clean.phone && !errors.phone && extractPhoneDigits(clean.phone).length !== 10) errors.phone = 'Enter a valid 10-digit phone number.'
  if (Array.from(data.notes || '').some(char => { const code = char.charCodeAt(0); return (code < 32 && ![9, 10, 13].includes(code)) || code === 127 })) errors.notes = 'Remove unsupported control characters.'
  return errors
}
