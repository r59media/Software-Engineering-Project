/**
 * Outgoing email for the admin (password reset links).
 *
 * No provider is wired yet, so sending is OFF: isEmailConfigured() returns false and sendEmail()
 * returns { sent: false, reason: 'not_configured' }. The admin then hides "Forgot password?" and the
 * Settings dialog says reset emails aren't set up. Nothing else needs to change to turn it on.
 *
 * To plug in a provider later, edit only this file (and the Bindings type in index.ts):
 *
 *  - Resend (HTTPS API): add `RESEND_API_KEY?: string` and `EMAIL_FROM?: string` to Bindings, set them
 *    with `wrangler secret put RESEND_API_KEY` / `wrangler secret put EMAIL_FROM` (a sender on a domain
 *    verified in Resend). isEmailConfigured returns Boolean(env.RESEND_API_KEY && env.EMAIL_FROM), and
 *    sendEmail calls
 *      fetch('https://api.resend.com/emails', {
 *        method: 'POST',
 *        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
 *        body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text })
 *      })
 *    returning { sent: res.ok, reason: res.ok ? undefined : `http_${res.status}` }.
 *
 *  - Cloudflare Email Routing: add a `send_email` binding in wrangler.toml (for example
 *    `[[send_email]] name = "MAILER"`, with the recovery address verified as a destination), add
 *    `MAILER?: SendEmail` to Bindings, and build the message with EmailMessage from 'cloudflare:email'.
 *
 * Never log the message body: it carries the reset link.
 */
import type { Bindings } from './index'
import { stripHeaderNewlines } from './utils/validation.ts'

export type EmailMessageInput = { to: string; subject: string; text: string }
export type EmailResult = { sent: boolean; reason?: string }

export type BookingConfirmationEmailDetails = {
  bookingId: number | string
  clientName: string
  clientEmail: string
  customerPhone?: string
  packageName: string
  date: string
  startTime: string
  endTime?: string | null
  location?: string
  depositCents: number
  totalCents: number
  balanceCents: number
  rescheduleUrl: string
  icsUrl?: string
  googleCalendarUrl?: string
}

function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0
  return `$${(safe / 100).toFixed(2)}`
}

/** True when an email provider is configured and emails can be delivered. */
export function isEmailConfigured(env: Bindings): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM)
}

/** Sends one plain-text email. Never throws; the result says whether it was sent. */
export async function sendEmail(env: Bindings, message: EmailMessageInput): Promise<EmailResult> {
  if (!isEmailConfigured(env)) return { sent: false, reason: 'not_configured' }
  const cleanSubject = stripHeaderNewlines(message.subject).slice(0, 500)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: cleanSubject,
        text: message.text
      }),
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error('[email] Resend API returned non-OK status:', {
        status: res.status,
        body: errBody.slice(0, 300)
      })
    }
    return { sent: res.ok, reason: res.ok ? undefined : `http_${res.status}` }
  } catch (err) {
    console.error('[email] Resend request failed:', err instanceof Error ? err.message : String(err))
    return { sent: false, reason: 'network_error' }
  }
}

/** Sends booking confirmation to the client and a notification to the studio admin. Never throws. */
export async function sendBookingConfirmationEmail(
  env: Bindings,
  details: BookingConfirmationEmailDetails
): Promise<{ client: EmailResult; admin: EmailResult }> {
  const timeWindow = details.endTime ? `${details.startTime} - ${details.endTime}` : details.startTime
  const depositStr = formatCents(details.depositCents)
  const totalStr = formatCents(details.totalCents)
  const balanceStr = formatCents(details.balanceCents)

  const clientLines = [
    `Hi ${details.clientName || 'there'},`,
    '',
    `Your session with R59 Media is confirmed!`,
    '',
    `Booking Reference: #${details.bookingId}`,
    `Package: ${details.packageName}`,
    `Date: ${details.date}`,
    `Time: ${timeWindow}`,
    details.location ? `Location: ${details.location}` : '',
    `Total Price: ${totalStr}`,
    `Deposit Paid: ${depositStr}`,
    `Remaining Balance: ${balanceStr}`,
    '',
    details.rescheduleUrl ? `Need to reschedule? Use your personal link:\n${details.rescheduleUrl}` : '',
    details.icsUrl ? `Add to Calendar (.ics):\n${details.icsUrl}` : '',
    details.googleCalendarUrl ? `Add to Google Calendar:\n${details.googleCalendarUrl}` : '',
    '',
    'Thank you for choosing R59 Media!'
  ].filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))

  const clientResult = await sendEmail(env, {
    to: details.clientEmail,
    subject: `R59 Media Booking Confirmed — ${details.packageName} (${details.date})`,
    text: clientLines.join('\n')
  })

  const adminEmail = (env.ADMIN_EMAIL || '').trim()
  const adminLines = [
    `New R59 Media Booking Confirmed (#${details.bookingId})`,
    '',
    `Client: ${details.clientName} <${details.clientEmail}>`,
    details.customerPhone ? `Phone: ${details.customerPhone}` : '',
    `Package: ${details.packageName}`,
    `Date: ${details.date}`,
    `Time: ${timeWindow}`,
    details.location ? `Location: ${details.location}` : '',
    `Total: ${totalStr} | Deposit Paid: ${depositStr} | Balance Due: ${balanceStr}`,
    details.rescheduleUrl ? `Client Reschedule Link: ${details.rescheduleUrl}` : ''
  ].filter(Boolean)

  const adminResult = adminEmail
    ? await sendEmail(env, {
        to: adminEmail,
        subject: `New Booking #${details.bookingId}: ${details.clientName} — ${details.date} ${details.startTime}`,
        text: adminLines.join('\n')
      })
    : { sent: false, reason: 'no_admin_email' }

  return { client: clientResult, admin: adminResult }
}

/** Sends an operational alert email to ADMIN_EMAIL (e.g. cron failures). Never throws. */
export async function sendOperationalAlertEmail(
  env: Bindings,
  subject: string,
  details: string
): Promise<EmailResult> {
  const adminEmail = (env.ADMIN_EMAIL || '').trim()
  if (!adminEmail) return { sent: false, reason: 'no_admin_email' }
  return sendEmail(env, {
    to: adminEmail,
    subject,
    text: details
  })
}

/** Sends a new contact/lead notification to ADMIN_EMAIL when email is configured. Never throws. */
export async function sendNewLeadNotificationEmail(
  env: Bindings,
  lead: {
    id?: number | string
    name: string
    email: string
    phone?: string | null
    sessionType?: string | null
    message: string
  }
): Promise<EmailResult> {
  const adminEmail = (env.ADMIN_EMAIL || '').trim()
  if (!adminEmail) return { sent: false, reason: 'no_admin_email' }
  const lines = [
    `New R59 Media Inquiry${lead.id ? ` (#${lead.id})` : ''}`,
    '',
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    lead.phone ? `Phone: ${lead.phone}` : '',
    lead.sessionType ? `Session Type: ${lead.sessionType}` : '',
    '',
    'Message:',
    lead.message
  ].filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
  return sendEmail(env, {
    to: adminEmail,
    subject: `New Contact Inquiry: ${lead.name}${lead.sessionType ? ` (${lead.sessionType})` : ''}`,
    text: lines.join('\n')
  })
}
