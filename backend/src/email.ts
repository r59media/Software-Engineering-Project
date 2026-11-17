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
        subject: message.subject,
        text: message.text
      })
    })
    return { sent: res.ok, reason: res.ok ? undefined : `http_${res.status}` }
  } catch {
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

  const adminEmail = (env.ADMIN_EMAIL || 'r59mediatesting@gmail.com').trim()
  const adminLines = [
    `New R59 Media Booking Confirmed (#${details.bookingId})`,
    '',
    `Client: ${details.clientName} <${details.clientEmail}>`,
    details.customerPhone ? `Phone: ${details.customerPhone}` : '',
    `Package: ${details.packageName}`,
    `Date: ${details.date}`,
    `Time: ${timeWindow}`,
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
