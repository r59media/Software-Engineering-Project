# R59 Media Admin Dashboard Frontend

A clean, modular, and performant administration dashboard for **R59 Media**, designed for managing bookings, schedules, availability, photography packages, pricing, coupons, photo galleries, and business profile settings.

This codebase has been refactored from a monolithic prototype into maintainable CSS and JavaScript modules, with all fictional/sample data removed, robust empty states added, and a centralized API service integration layer prepared for connecting to the Cloudflare Workers / Hono backend.

---

## 📁 Directory Structure

```
admin/
├── index.html                   # Clean dashboard entry point
├── README.md                    # This documentation file
└── assets/
    ├── css/
    │   ├── main.css             # Brand tokens, dark/light theme, resets, typography, base utilities
    │   ├── layout.css           # Header topbar, drawer navigation, page grids, savebar
    │   ├── components.css       # Cards, modals, toast, status badges, empty states, login
    │   └── pages/
    │       ├── dashboard.css    # KPI grid, KPI cards, live preview bio
    │       ├── payments.css     # Base fee, per-person fee, deposit %, packages, coupon codes
    │       ├── photography.css  # Gallery tabs, category filters, image cards, upload drop zone
    │       └── schedule.css     # Calendar views (Day/Week/Month), availability, bookings list, blocked dates
    └── js/
        ├── app.js               # Application bootstrap, DOMContentLoaded init, save/discard lifecycle
        ├── navigation.js        # View routing (go()), mobile drawer controls, theme switching
        ├── state.js             # Explicit reactive application state (empty initial collections)
        ├── api/
        │   ├── apiClient.js     # Centralized fetch client with base URL, auth headers, and error handling
        │   ├── bookingsApi.js   # Bookings list, create, update, and cancellation endpoints
        │   ├── paymentsApi.js   # Pricing rules and coupon code services
        │   ├── packagesApi.js   # Photography packages / services CRUD
        │   ├── photographyApi.js# Portfolio gallery image records & presigned R2 upload service
        │   └── scheduleApi.js   # Timeslots, availability rules, and blocked dates services
        ├── components/
        │   ├── modal.js         # Accessible modal dialogs with focus trapping and Escape key
        │   ├── confirmation.js  # Confirmation dialogs for all destructive/irreversible actions
        │   ├── notifications.js # Toast notifications with customizable duration
        │   └── formValidation.js# Centralized validators for email, phone, currency, and dates
        └── pages/
            ├── dashboard.js     # Real-time KPI calculations, month navigation, overview calendar
            ├── payments.js      # Fee locks, package management, coupon CRUD
            ├── photography.js   # Gallery filters, file upload reader, bio, social links
            └── schedule.js      # Day/Week/Month calendar, booking availability, bookings list, blocked dates
```

---

## 🧹 Fictional Data Removal & Empty States

All hardcoded demonstration records, fabricated metrics, and placeholder datasets have been completely removed:

| Domain | Prior Fictional Data | Behavior After Cleanup |
|---|---|---|
| **Bookings** | 4 fake bookings (John Smith, Jane Doe, Marcus Vance, Elena Rostova) | Clean empty array `[]`. Tables, calendars, and timelines display clear empty states (`No bookings scheduled`). |
| **Revenue & KPIs** | Hardcoded/mock totals ($1,400 total revenue, fake deposits) | Computed dynamically from real bookings: displays `$0.00` total, `$0.00` monthly, and `0` bookings when empty. |
| **Packages** | 3 hardcoded packages (Family, Event, Headshot) | Dynamic collection `state.packages = []`. Shows an empty state with an `+ Add package` button. |
| **Coupons** | Hardcoded codes `WELCOME10` and `SAVE25` | Empty array `state.coupons = []`. Shows `No coupon codes yet.` with a fully functional form to create legitimate codes. |
| **Availability** | Hardcoded daily 9am–5pm slots | 7 days (Monday–Sunday) default to `Unavailable`. Admin can click `+ Add Timeframe` to define schedules. |
| **Blocked Dates** | Fake vacation/holiday dates (Oct 25, Dec 24) | Empty array `blockedDates = []`. Shows `No dates are currently blocked.` Form remains ready for input. |
| **Social Links** | Hardcoded Instagram, TikTok, and X URLs | Empty array `state.social = []`. Shows `No links yet.` Admin can add links dynamically. |
| **Biography & Profile** | Fabricated biography and phone number | Inputs are cleared to empty strings with intuitive placeholder hints. |
| **Photo Library** | Generated SVG placeholder image cards | Gallery collections initialized to `[]`. Drop zone and `+ Add image` tiles remain active for real uploads. |

---

## 🛡️ Destructive Actions & Confirmations

Every destructive or irreversible action prompts the administrator with a confirmation modal before proceeding, clearly naming the affected record:
- **Remove Booking**: Identifies client name and appointment date.
- **Cancel Booking**: Confirms status change and warns about down payment reimbursement.
- **Clear Cancelled Bookings**: Displays exact count of cancelled records being purged.
- **Remove Package**: Identifies the package name being permanently deleted.
- **Remove Coupon**: Identifies the coupon code being removed.
- **Remove Timeframe**: Identifies the timeframe hours and day of week.
- **Remove Blocked Date**: Identifies the calendar date being unblocked.
- **Remove Social Link**: Identifies the platform link being deleted.
- **Remove Photo**: Identifies the photo title being deleted.

Canceling any confirmation leaves the record completely unchanged.

---

## 🔌 Backend Integration Guide

The frontend communicates through `window.R59.apiClient` and domain-specific API service modules under `admin/assets/js/api/`.

### 1. Configuration
By default, the API client connects to `http://localhost:8787/api` (the Cloudflare Workers default port) or `/api` in production. You can configure this dynamically before loading the scripts:

```html
<script>
  window.APP_CONFIG = {
    apiBaseUrl: 'https://api.r59media.com/api', // or http://localhost:8787/api
    adminSecret: 'YOUR_ADMIN_SECRET_KEY'        // injected for Authorization: Bearer <secret>
  };
</script>
```

Alternatively, `localStorage.setItem('r59_api_url', 'http://localhost:8787/api')` and `localStorage.setItem('r59_admin_token', '<secret>')` are automatically read by the API client.

### 2. Established Cloudflare Workers Backend Endpoints

The following endpoints match the existing backend implementation in `backend/src/routes/`:

- **Bookings**:
  - `GET /api/admin/bookings?limit=50&offset=0` — Requires `Authorization: Bearer <ADMIN_SECRET>`
- **Schedule Timeslots**:
  - `GET /api/schedule` — Public available timeslots
  - `POST /api/admin/schedule` — Create slot (`{ date: "YYYY-MM-DD", start_time: "HH:MM", end_time: "HH:MM" }`)
  - `DELETE /api/admin/schedule/:id` — Delete unbooked slot
- **Photography Packages / Services**:
  - `GET /api/services` — Public list of active services
  - `POST /api/services` — Create service (`{ name, description, price, duration_minutes }`, price in cents)
  - `PUT /api/services/:id` — Update service
- **Portfolio Images & Uploads**:
  - `GET /api/portfolio` — List portfolio images
  - `POST /api/portfolio` — Save image metadata (`{ r2_object_key, category, alt_text, display_order, is_featured }`)
  - `POST /api/upload-url` — Request presigned Cloudflare R2 upload URL (`{ filename, contentType }`)
- **System**:
  - `GET /api/health` — Database and worker healthcheck

### 3. Additional Admin Endpoints (Now Implemented on Backend!)

- `GET/PUT /api/admin/pricing` — Base line fee, per-person fee, and deposit percentage stored in `Admin_Settings`
- `GET/POST/PUT/DELETE /api/admin/coupons` — Promotional coupon management via `Coupons` table
- `GET/PUT /api/admin/availability` — Recurring weekly availability timeframes in `Admin_Settings`
- `GET/POST/DELETE /api/admin/blocked-dates` — Blocked calendar dates via `Blocked_Dates` table
- `GET/PUT /api/admin/profile` — Studio biography, contact email, phone, location, and social links in `Admin_Settings`
- `POST /api/admin/login` — Verifies administrator token / password

---

## 🚀 Running the Admin Frontend Locally

No build step, node modules, or bundler are required to run the admin frontend.

### Option 1: Python Built-in Server (Recommended)
From the repository root:
```bash
python -m http.server 8000
```
Then navigate to: [http://localhost:8000/admin/](http://localhost:8000/admin/)

### Option 2: Node.js / npx serve
```bash
npx serve .
```
Then open the displayed port and navigate to `/admin/`.

### Option 3: Direct File Opening
Double-click `admin/index.html` or open it directly in Google Chrome, Microsoft Edge, Firefox, or Safari:
```
file:///path/to/Software-Engineering-Project/admin/index.html
```
All scripts use modular object scoping (`window.R59`) and are completely compatible with the `file:///` protocol without CORS blocks on local script execution.

---

## 🎨 Design & Accessibility Preservation

- **100% Visual Consistency**: Exact dark/light themes, custom CSS variables (`--yellow: #FFCC22`, `--panel: #1a1a1a`), typography (`Poppins`, `Space Grotesk`), card layouts, and responsive breakpoints are preserved.
- **Calendar Controls**: Day, Week, and Month buttons stay within the Schedule section without triggering page navigation.
- **Responsive Layout**: Two-column desktop schedule layout gracefully collapses for tablet and mobile viewports.
- **Main Menu / Overview**: KPI card positioning, monthly revenue navigation, and year-to-date counters remain intact in their designated locations.
