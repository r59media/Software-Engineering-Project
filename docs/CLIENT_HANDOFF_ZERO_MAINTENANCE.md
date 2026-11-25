# Zero-Maintenance Client Handoff Checklist

Use this checklist before handing the project over to the client so the website, booking calendar, payments, media delivery, emails, and security updates run unattended for years.

---

## 1. Google Cloud OAuth Consent Screen ("In Production")
- Create/transfer the OAuth client under a **client-owned Google Cloud project** (never a temporary or `.edu` developer account).
- Open **Google Cloud Console → APIs & Services → OAuth consent screen**.
- Confirm **Publishing status** is set to **In production** (not *Testing*).
- **Why:** In *Testing* mode, Google revokes `GOOGLE_CALENDAR_REFRESH_TOKEN` every **7 days**, silently breaking automatic Google Calendar sync.

## 2. Cloudflare Worker Production Environment, Auth & Webhook
- Open **Cloudflare Dashboard → Workers & Pages → `<worker>` → Settings → Variables and Secrets**.
- **Deploy Safety (`--keep-vars`):** Automated deployments run `wrangler deploy --minify --keep-vars`, and mutable production `[vars]` have been removed from `backend/wrangler.toml`. Production variables set in the Cloudflare Dashboard are never overwritten back to `sandbox` or developer testing emails. (Local dev values belong in `backend/.dev.vars`, which is gitignored.)
- **Database & Media Storage:** All application data and uploaded media are stored 100% in **Cloudflare D1 (`r59_db`, including `Media_Storage` chunks)**—no Cloudflare R2 bucket is required.
- **Admin Authentication:** Admin login uses **Google Sign-In** (restricted to `ADMIN_EMAIL`) and HMAC-signed `HttpOnly` session cookies (no legacy password hash).
- Verify all required Variables and Secrets are populated in Cloudflare:
  - **Auth & Signing:**
    - `ADMIN_EMAIL` (authorized studio Google account email)
    - `SESSION_SECRET` (random secret **>= 32 characters**)
    - `MEDIA_SIGNING_SECRET` (random secret **>= 32 characters** for signed media URLs)
    - `GOOGLE_CLIENT_ID` (Google OAuth 2.0 Client ID for Admin Sign-In & Calendar)
    - `GOOGLE_CLIENT_SECRET` (Google OAuth 2.0 Client Secret)
    - `GOOGLE_CALENDAR_REFRESH_TOKEN` (from the **In production** client Google Cloud project)
    - `GOOGLE_CALENDAR_ID` (target studio calendar ID, e.g., `primary` or studio email)
  - **Payments (Square):**
    - `SQUARE_ENVIRONMENT` = **`production`**
    - `SQUARE_APPLICATION_ID`
    - `SQUARE_ACCESS_TOKEN`
    - `SQUARE_LOCATION_ID`
    - `SQUARE_WEBHOOK_URL` = `https://<your-domain>/api/square/webhook` (must match the exact HTTPS URL registered in the Square Developer Dashboard)
    - `SQUARE_WEBHOOK_SIGNATURE_KEY` (from the Square Developer Dashboard webhook subscription)
  - **Email (Resend):**
    - `RESEND_API_KEY`
    - `EMAIL_FROM` (verified sender address on the client's Resend domain)
  - **Optional Enhancements:**
    - `TURNSTILE_SECRET_KEY` (2-minute Cloudflare Turnstile activation — create a Turnstile widget in Cloudflare Dashboard, add the Secret Key to Worker secrets, and spam/bot protection activates on contact/booking endpoints)
    - `PUBLIC_ORIGIN` (optional canonical `https://<your-domain>` origin override for generated links and `.ics` calendar URLs)

## 3. Account, Token & Domain Ownership Transfer
Ensure all recurring accounts, billing, and **non-expiring API tokens** belong to the **client's own permanent email address** (never a student `.edu` email that expires after graduation):
- [ ] **Cloudflare** account, Worker, D1 (`r59_db`) ownership, and a non-expiring `CLOUDFLARE_API_TOKEN` (with `Workers Scripts:Edit` and `D1:Edit` permissions so remote D1 migrations succeed) stored in GitHub Secrets alongside `CLOUDFLARE_ACCOUNT_ID`
- [ ] **Custom Domain Registrar** with **auto-renewal** and valid payment method enabled
- [ ] **Square** merchant, developer application, and production access tokens
- [ ] **Resend** domain DNS verification (`SPF`/`DKIM`) and API key (also add `RESEND_API_KEY` and `ADMIN_EMAIL` / `EMAIL_FROM` to GitHub Actions Secrets/Variables so CI/healthcheck failure alerts email the client)
- [ ] **Google Cloud** project ownership (OAuth consent screen **In production**)
- [ ] **GitHub** repository admin ownership (with Dependabot & Actions enabled)

## 4. Required `PRODUCTION_URL` & Monitoring (Auto-Rollback + 60-Day Cron Caveat)
- In GitHub: **Settings → Secrets and variables → Actions → Variables**.
- Add `PRODUCTION_URL` set to the live site origin (e.g., `https://your-client-domain.com`) and `ADMIN_EMAIL` (for failure alert emails).
- **Pre-Migration Backup & Auto-Rollback:** Every deploy exports a pre-migration D1 SQL backup artifact (`30-day` retention), runs `apply-remote-d1-migrations.mjs` (failing closed on permission errors), deploys with `--keep-vars`, and smoke-checks `/api/health`, `/`, and `/admin/`. If any check fails 3 times, the workflow automatically runs `wrangler rollback --yes` and alerts via Resend.
- **GitHub Actions 60-Day Inactivity Cron Caveat:** GitHub automatically disables scheduled workflows (`cron`) in repositories with zero commit activity for 60 consecutive days. To guarantee continuous uptime monitoring even if no code changes occur for months:
  - Set up a free external monitor (such as **UptimeRobot** or **Cloudflare Health Checks**) pinging `GET https://<your-domain>/api/health` every 5 minutes and alerting the client email on downtime.
  - Keep Dependabot active (weekly patch PRs keep repository activity fresh) or run a monthly keepalive commit/workflow re-enable if needed.

## 5. How Hands-Free Operation Works
- **90-Day Rolling Booking Calendar:** A daily Cloudflare Cron Trigger (`0 6 * * *`) runs `runDailyMaintenance` to generate `Schedule_Slots` 90 days ahead from the Admin Panel's `weekly_availability` settings and purge past unbooked slots, expired sessions, and old login attempts (while preserving all booked appointments). `GET /api/schedule` and `GET /api/bookings/...` (including `/api/bookings/:id/reschedule` and `/api/bookings/:id/calendar.ics`) also lazily self-heal once per day if a cron run was missed.
- **Patch-Only Dependabot Auto-Deploy:** `.github/dependabot.yml` applies cooldowns, splits `patch` and `minor` groups, and ignores breaking major updates across all 4 ecosystems. Only `semver-patch` updates that pass `pnpm audit --prod --audit-level=high`, lint, typecheck, build, and tests auto-merge and deploy safely via `.github/workflows/deploy.yml`.
