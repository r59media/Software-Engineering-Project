import type { BookingService } from '../types/booking'

export const previewBookingServices: readonly BookingService[] = [
  { id: 'preview-portrait', name: 'Portrait', description: 'Individual headshots and portraits that feel like you.', bestFor: 'LinkedIn, resumes & personal branding', durationMinutes: 60, photoCount: 5, outfits: 1, priceMinor: 6000, currency: 'USD', bookingMode: 'direct', additionalPeople: { includedPeople: 1 } },
  { id: 'preview-graduation', name: 'Grad Pics', description: 'Celebrate your achievement with photos made for you.', bestFor: 'Graduation announcements & keepsakes', durationMinutes: 120, photoCount: 10, outfits: 2, priceMinor: 15000, currency: 'USD', bookingMode: 'direct', additionalPeople: { includedPeople: 1 } },
  { id: 'preview-branding', name: 'Branding Pics', description: 'A focused session to bring your personal brand to life.', bestFor: 'Creators & entrepreneurs', durationMinutes: 120, photoCount: 15, priceMinor: 23000, currency: 'USD', bookingMode: 'direct' },
  { id: 'preview-event', name: 'Event', description: 'Capture the people, details and moments that matter.', bestFor: 'Celebrations & special occasions', durationMinutes: 300, photoCount: 300, priceMinor: 70000, currency: 'USD', bookingMode: 'direct' },
  { id: 'preview-business', name: 'Business package', description: 'Photography tailored to your team, business and goals.', bestFor: 'Teams & business content', durationMinutes: null, priceMinor: null, currency: 'USD', bookingMode: 'inquiry' },
]
