# Zero-Maintenance Client Handoff Checklist

Use this checklist before handing the project over to the client so the website, booking calendar, payments, emails, and security updates run unattended for years.

---

## 1. Google Cloud OAuth Consent Screen ("In Production")
- Open **Google Cloud Console → APIs & Services → OAuth consent screen**.
- Confirm **Publishing status** is set to **In production** (not *Testing*).
- **Why:** In *Testing* mode, Google revokes `GOOGLE_CALENDAR_REFRESH_TOKEN` every **7 days**, silently breaking automatic Google Calendar sync.

## 2. Cloudflare Worker Production Environment & Webhook
- Open **Cloudflare Dashboard → Workers & Pages → `<worker>` → Settings → Variables and Secrets** (and `backend/wrangler.toml` defaults).
- Verify `SQUARE_ENVIRONMENT` is set to **`production`** (default in `wrangler.toml` is `sandbox`).
- Verify `SQUARE_WEBHOOK_URL` is set to the live HTTPS webhook endpoint (e.g. `https://<your-domain>/api/webhooks/square`) and matches the webhook configured in the **Square Developer Dashboard** along with `SQUARE_WEBHOOK_SIGNATURE_KEY`.
- Verify all required secrets are populated (`SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_PASSWORD_HASH` / JWT signing secrets, `GOOGLE_CALENDAR_*` if used).

## 3. Account & Domain Ownership Transfer
Ensure all recurring accounts and billing belong to the **client's own permanent email address** (never a student `.edu` email that expires after graduation):
- [ ] **Cloudflare** account & Worker/D1/R2 ownership
- [ ] **Custom Domain Registrar** with **auto-renewal** and valid payment method enabled
- [ ] **Square** merchant & developer application ownership
- [ ] **Resend** domain DNS verification (`SPF`/`DKIM`) and API key ownership
- [ ] **GitHub** repository admin ownership (and Dependabot/Actions enabled)

## 4. Optional `PRODUCTION_URL` GitHub Variable (Auto-Rollback Check)
- In GitHub: **Settings → Secrets and variables → Actions → Variables**.
- Add `PRODUCTION_URL` set to the live site origin (e.g. `https://your-client-domain.com`).
- **Why:** After every deploy, GitHub Actions curls `${PRODUCTION_URL}/api/health` (falling back to Wrangler's deployment URL if unset). If the health check fails 3 times, the workflow automatically runs `wrangler rollback --yes` to restore the previous working Worker.

## 5. How Hands-Free Operation Works
- **90-Day Rolling Booking Calendar:** A daily Cloudflare Cron Trigger (`0 6 * * *`) runs `runDailyMaintenance` to generate `Schedule_Slots` 90 days ahead from the Admin Panel's `weekly_availability` settings and purge past unbooked slots, expired sessions, and old login attempts (while preserving all booked appointments). `GET /api/schedule` and `GET /api/reschedule` also lazily self-heal once per day if a cron run was missed.
- **Patch-Only Dependabot Auto-Deploy:** `.github/dependabot.yml` applies cooldowns and ignores breaking major/0.x updates. Only `semver-patch` updates (bug & security patches) auto-merge and chain directly into `.github/workflows/deploy.yml` with post-deploy `/api/health` verification.
