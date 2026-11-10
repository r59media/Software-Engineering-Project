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

/** True when an email provider is configured and reset links can be delivered. */
export function isEmailConfigured(_env: Bindings): boolean {
  return false
}

/** Sends one plain-text email. Never throws; the result says whether it was sent. */
export async function sendEmail(env: Bindings, _message: EmailMessageInput): Promise<EmailResult> {
  if (!isEmailConfigured(env)) return { sent: false, reason: 'not_configured' }
  return { sent: false, reason: 'not_configured' }
}
