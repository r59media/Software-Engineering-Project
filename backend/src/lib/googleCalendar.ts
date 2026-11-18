import type { Bindings } from '../index'
import { addDaysISO, DEFAULT_TIMEZONE, localDateTimeToRFC3339 } from './billingMath.ts'

export interface CalendarBookingInput {
  id: number | string
  date: string
  start_time: string
  end_time?: string | null
  client_name?: string | null
  client_email?: string | null
  customer_phone?: string | null
  package_name?: string | null
  service_name?: string | null
  status?: string | null
  notes?: string | null
  location?: string | null
  attendees?: number | null
  timeZone?: string | null
}

export interface CalendarBlockedDateInput {
  id?: number | string
  date: string
  reason?: string | null
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/** Folds an ICS line at 75 octets per RFC 5545 section 3.1. */
function foldIcsLine(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  let idx = 0
  parts.push(line.slice(0, 75))
  idx = 75
  while (idx < line.length) {
    parts.push(' ' + line.slice(idx, idx + 74))
    idx += 74
  }
  return parts.join('\r\n')
}

function rfc3339ToIcsUtc(rfc3339: string): string {
  return rfc3339.replace(/[-:]/g, '')
}

function formatUtcStamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
}

function resolveStartEndRfc3339(
  booking: Pick<CalendarBookingInput, 'date' | 'start_time' | 'end_time'>,
  timeZone: string
): { startRfc3339: string; endRfc3339: string } | null {
  const tz = (timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE
  const startRfc3339 = localDateTimeToRFC3339(booking.date, booking.start_time, tz)
  if (!startRfc3339) return null

  let endRfc3339 = booking.end_time ? localDateTimeToRFC3339(booking.date, booking.end_time, tz) : null
  if (!endRfc3339 || new Date(endRfc3339).getTime() <= new Date(startRfc3339).getTime()) {
    endRfc3339 = new Date(new Date(startRfc3339).getTime() + 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  }
  return { startRfc3339, endRfc3339 }
}

function buildBookingSummary(booking: CalendarBookingInput): string {
  const pkg = (booking.package_name || booking.service_name || 'Photography Session').trim()
  const client = (booking.client_name || '').trim()
  return client ? `R59 Media: ${pkg} - ${client}` : `R59 Media: ${pkg}`
}

function buildBookingDescription(booking: CalendarBookingInput, rescheduleUrl?: string): string {
  const pkg = (booking.package_name || booking.service_name || 'Photography Session').trim()
  const lines = [
    `Booking #${booking.id}`,
    `Package: ${pkg}`,
    booking.client_name ? `Client: ${booking.client_name}` : '',
    booking.client_email ? `Email: ${booking.client_email}` : '',
    booking.customer_phone ? `Phone: ${booking.customer_phone}` : '',
    booking.attendees ? `Attendees: ${booking.attendees}` : '',
    booking.status ? `Status: ${booking.status}` : '',
    booking.notes ? `Notes: ${booking.notes}` : '',
    rescheduleUrl ? `Reschedule: ${rescheduleUrl}` : ''
  ].filter(Boolean)
  return lines.join('\n')
}

function buildBookingVEventLines(
  booking: CalendarBookingInput,
  timeZone: string,
  dtStamp: string,
  rescheduleUrl?: string
): string[] {
  const times = resolveStartEndRfc3339(booking, timeZone)
  if (!times) return []

  const statusUpper = String(booking.status || '').trim().toLowerCase() === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'
  const lines = [
    'BEGIN:VEVENT',
    `UID:booking-${booking.id}@r59media`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${rfc3339ToIcsUtc(times.startRfc3339)}`,
    `DTEND:${rfc3339ToIcsUtc(times.endRfc3339)}`,
    foldIcsLine(`SUMMARY:${escapeIcsText(buildBookingSummary(booking))}`),
    foldIcsLine(`DESCRIPTION:${escapeIcsText(buildBookingDescription(booking, rescheduleUrl))}`),
    `STATUS:${statusUpper}`
  ]
  if (booking.location) {
    lines.push(foldIcsLine(`LOCATION:${escapeIcsText(booking.location)}`))
  }
  if (rescheduleUrl) {
    lines.push(foldIcsLine(`URL:${rescheduleUrl}`))
  }
  lines.push('END:VEVENT')
  return lines
}

/** Builds an RFC 5545 VCALENDAR feed of active studio bookings and blocked dates. */
export function buildStudioIcsFeed(
  bookings: CalendarBookingInput[],
  blockedDates: CalendarBlockedDateInput[],
  timeZone: string = DEFAULT_TIMEZONE
): string {
  const tz = (timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE
  const dtStamp = formatUtcStamp()

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//R59 Media//Booking Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:R59 Media Bookings (r59mediatesting@gmail.com)',
    `X-WR-TIMEZONE:${tz}`
  ]

  for (const booking of bookings || []) {
    const eventLines = buildBookingVEventLines(booking, tz, dtStamp)
    if (eventLines.length > 0) {
      lines.push(...eventLines)
    }
  }

  for (const blocked of blockedDates || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(blocked.date || '').trim())) continue
    const dateIso = blocked.date.trim()
    const nextDay = addDaysISO(dateIso, 1)
    const startCompact = dateIso.replace(/-/g, '')
    const endCompact = nextDay.replace(/-/g, '')
    const reason = (blocked.reason || '').trim()
    const summary = reason ? `Studio Blocked: ${reason}` : 'Studio Blocked'

    lines.push(
      'BEGIN:VEVENT',
      `UID:blocked-${dateIso}@r59media`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART;VALUE=DATE:${startCompact}`,
      `DTEND;VALUE=DATE:${endCompact}`,
      foldIcsLine(`SUMMARY:${escapeIcsText(summary)}`),
      'TRANSP:OPAQUE',
      'END:VEVENT'
    )
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** Builds an RFC 5545 VCALENDAR file for a single booking. */
export function buildBookingIcs(
  booking: CalendarBookingInput,
  rescheduleUrl: string,
  timeZone: string = DEFAULT_TIMEZONE
): string {
  const tz = (timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE
  const dtStamp = formatUtcStamp()
  const eventLines = buildBookingVEventLines(booking, tz, dtStamp, rescheduleUrl)

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//R59 Media//Booking Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-TIMEZONE:${tz}`,
    ...eventLines,
    'END:VCALENDAR'
  ]
  return lines.join('\r\n') + '\r\n'
}

/** Builds a Google Calendar "Add Event" template URL pre-filled with booking details. */
export function buildGoogleCalendarTemplateUrl(
  booking: CalendarBookingInput,
  rescheduleUrl: string,
  targetEmail: string = 'r59mediatesting@gmail.com'
): string {
  const tz = (booking.timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE
  const times = resolveStartEndRfc3339(booking, tz)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: buildBookingSummary(booking),
    details: buildBookingDescription(booking, rescheduleUrl),
    ctz: tz
  })
  if (times) {
    params.set('dates', `${rfc3339ToIcsUtc(times.startRfc3339)}/${rfc3339ToIcsUtc(times.endRfc3339)}`)
  }
  if (booking.location) {
    params.set('location', booking.location)
  }
  if (targetEmail) {
    params.set('add', targetEmail)
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

async function fetchGoogleCalendarAccessToken(
  env: Bindings
): Promise<{ token: string } | { token: null; reason: string }> {
  const refreshToken = (env.GOOGLE_CALENDAR_REFRESH_TOKEN || '').trim()
  const clientId = (env.GOOGLE_CLIENT_ID || '').trim()
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim()
  if (!refreshToken || !clientId || !clientSecret) {
    return { token: null, reason: 'not_configured' }
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })
  if (!res.ok) {
    return { token: null, reason: `oauth_${res.status}` }
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) {
    return { token: null, reason: 'oauth_missing_token' }
  }
  return { token: json.access_token }
}

/**
 * Syncs a booking to Google Calendar via the Calendar v3 API using OAuth2 refresh token.
 * Safely no-ops if Google Calendar credentials are not configured. Never throws.
 */
export async function syncBookingToGoogleCalendarApi(
  env: Bindings,
  booking: CalendarBookingInput,
  action: 'upsert' | 'delete' = 'upsert'
): Promise<{ synced: boolean; reason?: string }> {
  try {
    const auth = await fetchGoogleCalendarAccessToken(env)
    if (auth.token === null) {
      return { synced: false, reason: auth.reason }
    }
    const accessToken = auth.token

    const calendarId = (env.GOOGLE_CALENDAR_ID || 'r59mediatesting@gmail.com').trim()
    // Google Calendar event IDs must use lowercase base32hex characters [a-v0-9]
    const eventId = `r59booking${String(booking.id).replace(/[^0-9a-v]/g, '')}`
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`

    if (action === 'delete') {
      const delRes = await fetch(`${baseUrl}/${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      if (delRes.ok || delRes.status === 404 || delRes.status === 410) {
        return { synced: true }
      }
      return { synced: false, reason: `http_${delRes.status}` }
    }

    const tz = (booking.timeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE
    const times = resolveStartEndRfc3339(booking, tz)
    if (!times) {
      return { synced: false, reason: 'invalid_datetime' }
    }

    const payload: Record<string, unknown> = {
      id: eventId,
      summary: buildBookingSummary(booking),
      description: buildBookingDescription(booking),
      start: { dateTime: times.startRfc3339, timeZone: tz },
      end: { dateTime: times.endRfc3339, timeZone: tz },
      status: String(booking.status || '').trim().toLowerCase() === 'cancelled' ? 'cancelled' : 'confirmed'
    }
    if (booking.location) {
      payload.location = booking.location
    }

    const putRes = await fetch(`${baseUrl}/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (putRes.ok) {
      return { synced: true }
    }

    if (putRes.status === 404) {
      const postRes = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      return { synced: postRes.ok, reason: postRes.ok ? undefined : `http_${postRes.status}` }
    }

    return { synced: false, reason: `http_${putRes.status}` }
  } catch {
    return { synced: false, reason: 'sync_error' }
  }
}
