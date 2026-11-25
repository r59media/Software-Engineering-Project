<div class="cover-page">
  <div class="cover-badge">R59 MEDIA · SOFTWARE ENGINEERING CAPSTONE</div>
  <h1 class="cover-title">Administrator User Manual</h1>
  <p class="cover-subtitle">Operational Guide: Bookings, Availability, Media Library, & E-Commerce Management</p>
  <div class="cover-divider"></div>
  <div class="cover-meta">
    <p><strong>Platform:</strong> R59 Media Admin Dashboard (/admin)</p>
    <p><strong>System Version:</strong> 2.0 (Production Release)</p>
    <p><strong>Target Audience:</strong> Photographer, Studio Administrators, & Maintainers</p>
    <p><strong>Date:</strong> November 2026</p>
    <p><strong>Status:</strong> Verified & Production-Deployed</p>
  </div>
</div>

<div class="page-break"></div>

# Table of Contents

1. [Executive Summary & System Architecture](#1-executive-summary--system-architecture)
2. [Admin Authentication & Security](#2-admin-authentication--security)
3. [Dashboard & Key Performance Indicators (KPIs)](#3-dashboard--key-performance-indicators-kpis)
4. [Schedule, Availability & Calendar Operations](#4-schedule-availability--calendar-operations)
   - 4.1 Weekly Availability Rules
   - 4.2 Timeframe Management
   - 4.3 Blocking Dates & Holidays
   - 4.4 Automated 90-Day Rolling Calendar & Cron Engine
   - 4.5 Google Calendar Synchronization
5. [Booking & Client Management](#5-booking--client-management)
   - 5.1 Inspecting Active Appointments
   - 5.2 Deposit Tracking & Balance Collection (Square)
   - 5.3 Administrative Rescheduling & Cancellations
   - 5.4 Safety Confirmations & Destructive Action Protections
6. [Services, Packages & Pricing Catalog](#6-services-packages--pricing-catalog)
   - 6.1 Creating & Editing Packages
   - 6.2 Setting Deposit Percentages & Duration
   - 6.3 Managing Promotional Coupon Codes
7. [Photography & Media Library Management](#7-photography--media-library-management)
   - 7.1 Automatic Client-Side WebP Compression
   - 7.2 Managing Hero Slides (Carousel Reel)
   - 7.3 Managing Most Recent Photoshoot
   - 7.4 Curating the Portfolio Gallery (Portraits, Events, Editorial)
   - 7.5 Reordering Images & Alt-Text Metadata
8. [Lead Inquiries & Customer Communications](#8-lead-inquiries--customer-communications)
9. [Studio Profile & FAQ Settings](#9-studio-profile--faq-settings)
10. [Maintenance, Health Checks & System Longevity](#10-maintenance-health-checks--system-longevity)

---

<div class="page-break"></div>

# 1. Executive Summary & System Architecture

The **R59 Media Admin Dashboard** is a standalone, high-performance administrative application engineered to give the photographer complete operational control over bookings, scheduling availability, financial rules, and media curation without requiring database management or technical intervention.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      R59 MEDIA ADMIN CONTROL PLANE                     │
├─────────────────────┬───────────────────────────┬──────────────────────┤
│  Business Hub       │    Scheduling Engine      │   Media & Creative   │
│  • KPI Tracking     │    • Weekly Rules Matrix  │   • In-Browser WebP  │
│  • Square Deposits  │    • Blackout Date Locks  │   • Live Hero Reel   │
│  • Client CRM Cards │    • Google Cal Sync      │   • 3D Reel Assets   │
│  • Discount Codes   │    • 90-Day Rolling Slots │   • Metadata Editor  │
└─────────────────────┴───────────────────────────┴──────────────────────┘
```

### Core Architecture Highlights
* **Decoupled Security:** The Admin Dashboard (`/admin`) is isolated from public frontend routes and protected by **Google Sign-In** (restricted to the configured `ADMIN_EMAIL`) and HMAC-signed `HttpOnly` session cookies (`SESSION_SECRET`).
* **Edge-Native Backend:** Powered by Cloudflare Workers and Cloudflare D1 (distributed SQL database), ensuring sub-50ms administrative response times worldwide.
* **Direct-to-D1 Media Uploads:** Photos uploaded in the admin panel are converted to modern WebP in the browser and stored directly in **Cloudflare D1 (`Media_Storage`)**, served through HMAC-signed URLs (`MEDIA_SIGNING_SECRET`) with zero external bucket dependencies.

---

# 2. Admin Authentication & Security

### 2.1 Accessing the Portal
1. Open any modern desktop or mobile browser and navigate to:
   ```text
   https://<your-domain>/admin
   ```
   *(Local development environment: `http://localhost:5173/admin` or `http://localhost:8787/admin`).*
2. If unauthenticated, the portal displays a dedicated, branded administrative login screen.

### 2.2 Logging In
1. Click **Sign in with Google** and select the authorized studio Google account matching `ADMIN_EMAIL`.
2. Upon verification of the Google ID token, the server issues a secure, HMAC-signed `HttpOnly` session cookie (`SESSION_SECRET`).
3. **Session Lifetime:** To protect business records, administrative sessions automatically expire after their configured lifetime and can be revoked immediately using the **Log Out** button in the sidebar drawer.

---

<div class="page-break"></div>

# 3. Dashboard & Key Performance Indicators (KPIs)

Upon logging in, the administrator is presented with the **Executive Dashboard Overview**, providing an instant pulse of studio operations.

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  TOTAL BOOKINGS  │  │   MONTHLY SESSIONS│  │  DEPOSITS PAID   │  │ OUTSTANDING BAL. │
│        24        │  │        6         │  │    $1,850.00     │  │    $3,200.00     │
└──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘
```

### Key Metrics Tracked
* **Total Confirmed Bookings:** Lifetime count of all active, non-cancelled client reservations.
* **Monthly Active Sessions:** Number of shoots scheduled for the currently selected calendar month.
* **Confirmed Revenue / Deposits Collected:** Aggregated deposit funds successfully captured via Square.
* **Upcoming Shoot Agenda:** Chronological timeline of upcoming appointments scheduled over the next 7 to 14 days with quick-dial client contact buttons.

---

# 4. Schedule, Availability & Calendar Operations

The scheduling module allows the photographer to define exactly when clients can book, ensuring complete control over work-life balance and zero double-bookings.

### 4.1 Weekly Availability Rules
Navigate to **Schedule → Weekly Availability**:
1. The matrix displays the 7 days of the week (**Monday through Sunday**).
2. For each day, toggle the state between **Available** and **Unavailable**.
3. Define active studio working hours (e.g., `09:00 AM – 06:00 PM`).
4. Click **Save Changes** in the bottom confirmation bar to apply.

### 4.2 Timeframe Management & Buffer Times
* **Slot Duration:** Default session booking increments (e.g., 60 minutes or 90 minutes).
* **Buffer Times:** Automatically enforce a 30-minute to 60-minute buffer window between appointments to allow for studio resets, lighting adjustments, and client changeovers.

### 4.3 Blocking Dates & Holidays (Blackout Dates)
To block entire days for vacations, commercial travel, or private events:
1. Navigate to **Schedule → Blocked Dates**.
2. Click **+ Block Date**.
3. Select the calendar date from the datepicker.
4. Add an optional administrative reference note (e.g., *"On-Location Shoot in Miami"* or *"Studio Maintenance"*).
5. Click **Block Date**. That date immediately disappears from the client-facing booking calendar.

### 4.4 Automated 90-Day Rolling Calendar & Cron Engine
* **Hands-Free Operation:** A daily Cloudflare Cron Trigger (`0 6 * * *`) automatically generates client appointment slots 90 days into the future based on your weekly rules.
* **Self-Healing Mechanism:** If an unbooked slot passes, the system purges it from the database while preserving all booked records. If the cron trigger is interrupted, the system automatically self-heals when a visitor views the schedule.

### 4.5 Google Calendar Synchronization
The platform features two-way collision prevention with Google Calendar:
* Any appointment created on the website automatically syncs to Kevin's Google Calendar with client details and shoot notes.
* Any personal event added to Google Calendar automatically blocks that timeslot on the public website, preventing client bookings during personal commitments.

---

<div class="page-break"></div>

# 5. Booking & Client Management

The **Bookings** tab serves as the central CRM for client communication and shoot logistics.

### 5.1 Inspecting Active Appointments
The bookings table lists all appointments with complete logistical data:

| Client Name | Service | Date & Time | Location | Deposit Status | Total Balance | Actions |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| **Sarah Jenkins** | Studio Portraiture | Nov 28 · 10:00 AM | Main Studio | Paid ($75.00) | $250.00 | View · Reschedule |
| **David Miller** | Event Coverage | Dec 04 · 02:00 PM | Grand Hotel | Paid ($150.00) | $500.00 | View · Reschedule |

Clicking any booking opens the **Client Intake Card**:
* Contact email and phone number.
* Client creative notes, outfit ideas, and intended usage.
* Unique Booking ID (`BK-XXXXXX`) and cryptographic rescheduling token.

### 5.2 Deposit Tracking & Balance Collection
* **Deposit Captured:** Verified via Square Webhooks. The transaction ID and payment timestamp are linked directly to the booking.
* **Remaining Balance:** Displays the remaining balance due on the day of the photoshoot. The administrator can mark the balance as *Settled* once the final payment is collected.

### 5.3 Administrative Rescheduling & Cancellations
If a client contacts the studio requesting a date change:
1. Open the booking record and click **Reschedule**.
2. Select a new date and time slot from the administrative calendar.
3. Click **Confirm Reschedule**. The system updates the database, updates Google Calendar, and sends an automated notification email to the client with the revised `.ics` invite.

### 5.4 Safety Confirmations & Destructive Action Protections
To prevent accidental data loss, every destructive action triggers an explicit confirmation dialog:
* **Cancel Booking:** Asks for confirmation and displays policy reminders regarding deposits.
* **Purge Records:** Purging past cancelled bookings requires typing confirmation or explicit verification.

---

<div class="page-break"></div>

# 6. Services, Packages & Pricing Catalog

The **Payments & Packages** module controls what clients see in the booking catalog and how much they are charged.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SERVICES & PACKAGES EDITOR                      │
├─────────────────────┬───────────────────┬──────────────┬───────────────┤
│ Package Name        │ Base Investment   │ Duration     │ Deposit Rate  │
├─────────────────────┼───────────────────┼──────────────┼───────────────┤
│ Studio Portraiture  │ $250.00           │ 60 minutes   │ 30% ($75.00)  │
│ On-Location Session │ $350.00           │ 90 minutes   │ 30% ($105.00) │
│ Private Event       │ $600.00           │ 180 minutes  │ 30% ($180.00) │
│ Commercial Editorial│ Custom Quote      │ Variable     │ Custom        │
└─────────────────────┴───────────────────┴──────────────┴───────────────┘
```

### 6.1 Creating & Editing Packages
1. Navigate to **Payments → Packages**.
2. Click **+ Add Package** (or click the edit pencil on an existing package).
3. Configure the package fields:
   * **Package Name & Subtitle:** Displayed on the website cards.
   * **Base Investment ($):** Starting price for the session.
   * **Duration (Minutes):** Duration blocked on the calendar.
   * **Deliverables List:** Comma-separated or bulleted items (e.g., *"15 Retouched High-Res Images, Online Gallery"*).
   * **Active / Hidden Toggle:** Temporarily hide a service without deleting it.
4. Click **Save Package**. Changes reflect immediately on the live website.

### 6.2 Managing Promotional Coupon Codes
To run seasonal promotions or offer partner discounts:
1. Navigate to **Payments → Coupon Codes**.
2. Click **+ Create Coupon**.
3. Input the promotional code (e.g., `SUMMER20` or `VIPCLIENT`).
4. Set the discount type: **Percentage (%)** or **Fixed Amount ($)**.
5. Set an optional expiration date.
6. Click **Save Coupon**. Clients can apply this code during checkout to receive an instant discount on their deposit.

---

<div class="page-break"></div>

# 7. Photography & Media Library Management

The **Photography** tab manages the visual portfolio, hero reels, and editorial session photos across the entire site.

### 7.1 Automatic Client-Side WebP Compression
When uploading photos straight from professional mirrorless cameras (often 20MB–50MB JPEGs or TIFFs), the Admin Dashboard employs an integrated **WebP In-Browser Worker**:
* Automatically resizes imagery to optimal web dimensions (nominal 1440px / 2048px).
* Compresses images into ultra-efficient WebP format **before** network transmission.
* Eliminates server load, prevents upload timeouts, and maintains 100/100 Lighthouse performance.

### 7.2 Managing Hero Slides (Carousel Reel)
1. Select the **Hero** tab.
2. The current active slides appear in presentation order.
3. **Upload New Slide:** Drag and drop an image into the drop zone.
4. Set the **Slide Title** and accessible **Alt Text** (essential for SEO and screen readers).
5. Use the grab handles to **Drag and Drop to Reorder**. The top 5 active slides form the homepage carousel.

### 7.3 Managing Most Recent Photoshoot
1. Select the **Recent Photoshoot** tab.
2. Upload the featured image set from Kevin's latest session.
3. These images populate the circular aperture zoom transition triggered by the 3D camera lens.

### 7.4 Curating the Portfolio Gallery
1. Filter by category: **Portraits**, **Events**, or **Editorial**.
2. Upload new photographic works or mark specific images as **Featured** (`is_featured = 1`) to highlight them on the main stage.
3. To delete an image, click the trash icon and confirm deletion. The system deletes the database record and frees storage in **Cloudflare D1 (`Media_Storage`)**.

---

<div class="page-break"></div>

# 8. Lead Inquiries & Customer Communications

Clients who submit requests via the contact form are cataloged in the **Inquiries** tab:
* **Contact Details:** Name, email, and phone number.
* **Project Type:** Target date, proposed shooting location, and budget range.
* **Creative Vision:** Detailed message submitted by the prospective client.
* **Status Badges:** Mark inquiries as *New*, *Contacted*, or *Archived*.
* **Direct Reply:** One-click `mailto:` shortcut pre-populates an email response with the client's booking inquiry details.

---

# 9. Studio Profile & FAQ Settings

### 9.1 Studio Profile & Social Links
* **Biography:** Update the photographer bio displayed in the *About Me* section.
* **Contact Information:** Update the primary studio email and business telephone number.
* **Social Media Handles:** Manage links for Instagram, Threads, and Twitter/X displayed in the website footer and mobile drawer.

### 9.2 FAQ Accordion Management
To update common client questions without touching code:
1. Navigate to **Settings → FAQ**.
2. Add, reorder, or edit questions and answers regarding turnaround times, wardrobe recommendations, and print rights.
3. Changes deploy instantly to both the homepage FAQ section and the standalone `/faq` route.

---

<div class="page-break"></div>

# 10. Maintenance, Health Checks & System Longevity

To ensure the platform operates hands-free for years without administrative intervention, follow these maintenance best practices:

### 10.1 Google Cloud OAuth "In Production" Status
> **CRITICAL CONFIGURATION:**
> Ensure the OAuth client lives in a **client-owned Google Cloud project** and open **Google Cloud Console → APIs & Services → OAuth consent screen**.
> Confirm the publishing status is set to **In Production** (not *Testing*).
> When set to *Testing*, Google automatically revokes `GOOGLE_CALENDAR_REFRESH_TOKEN` every **7 days**, which would disconnect automatic Google Calendar sync. Setting it to *In Production* ensures permanent, unattended synchronization.

### 10.2 Cloudflare Variables, Secrets & Square Webhook Verification
* **Deploy Safety (`--keep-vars`):** Automated deployments use `wrangler deploy --minify --keep-vars` with mutable `[vars]` omitted from `backend/wrangler.toml`, ensuring production values in the Cloudflare Dashboard are never overwritten.
* **Required Auth & Signing Secrets:** Confirm `SESSION_SECRET` (`>= 32` chars), `MEDIA_SIGNING_SECRET` (`>= 32` chars), `ADMIN_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, `RESEND_API_KEY`, and `EMAIL_FROM` are set under non-expiring client accounts.
* **Square Production Credentials:** In Cloudflare Dashboard, ensure `SQUARE_ENVIRONMENT` is set to `production` alongside `SQUARE_APPLICATION_ID`, `SQUARE_ACCESS_TOKEN`, and `SQUARE_LOCATION_ID`.
* **Square Webhook:** Confirm `SQUARE_WEBHOOK_URL` matches `https://<your-domain>/api/square/webhook` and `SQUARE_WEBHOOK_SIGNATURE_KEY` matches the Square Developer Dashboard signing key.
* **Optional Protections & Overrides:** Set `TURNSTILE_SECRET_KEY` (2-minute Cloudflare Turnstile widget setup) for bot protection on contact/booking endpoints, and optional `PUBLIC_ORIGIN` if you need an explicit canonical origin for links and `.ics` calendar URLs (`/api/bookings/:id/calendar.ics`).

### 10.3 Automated Backups, Rollback Safety Net & Uptime Monitoring
* Every deployment via GitHub Actions exports a pre-migration D1 SQL backup artifact (`30-day` retention), runs remote D1 migrations (failing closed on permission errors), deploys with `--keep-vars`, and smoke-checks `/api/health`, `/`, and `/admin/` 3 times. If any check fails, the deployment script automatically runs:
```bash
wrangler rollback --yes
```
and sends a Resend alert email (when `RESEND_API_KEY` and `ADMIN_EMAIL` are set). This guarantees that an unexpected error will never leave the live site or admin panel in an inoperable state.
* **GitHub Actions 60-Day Inactivity Caveat:** GitHub pauses scheduled `cron` workflows after 60 days without commits. Pair weekly Dependabot runs with a free external monitor (such as **UptimeRobot** or **Cloudflare Health Checks**) pinging `GET https://<your-domain>/api/health` every 5 minutes so downtime alerts always trigger immediately.

---

<div style="text-align: center; margin-top: 60px; color: #888888; font-size: 9pt;">
  <p>© 2026 Kevin D Gonzalez · R59 Media. All Rights Reserved.</p>
  <p>Software Engineering Project Documentation · Production Version 2.0</p>
</div>
