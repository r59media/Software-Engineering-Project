# R59 Media — Photography Portfolio & Studio Management Platform

A high-performance, full-stack photography portfolio and studio management platform built for **R59 Media**. Features an interactive 3D camera lens aperture scroll transition, canvas image protection to deter casual downloading, a complete responsive client experience, and a modular administration dashboard powered by serverless Cloudflare Workers and Cloudflare D1.

🌐 **Live Deployment:** [https://software-engineering-project.r59mediatesting.workers.dev](https://software-engineering-project.r59mediatesting.workers.dev)

---

## 📸 Key Features & Architecture

```
                       ┌──────────────────────────────────────────────┐
                       │           Cloudflare Edge Network            │
                       │             (Cloudflare Workers)             │
                       └──────────────────────┬───────────────────────┘
                                              │
                     ┌────────────────────────┼────────────────────────┐
                     │                        │                        │
                     ▼                        ▼                        ▼
          ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
          │   Public Frontend    │ │   Admin Dashboard    │ │     Backend API      │
          │   (React 19, Vite,   │ │ (Modular Vanilla JS, │ │  (Hono, TypeScript,  │
          │    R3F, TypeScript)  │ │   CSS Design System) │ │  Edge Asset Server)  │
          └──────────┬───────────┘ └──────────┬───────────┘ └──────────┬───────────┘
                     │                        │                        │
                     └────────────────────────┼────────────────────────┘
                                              │
                                              ▼
                                 ┌─────────────────────────┐
                                 │   Cloudflare D1 (SQL)   │
                                 │  • Portfolio Images     │
                                 │  • Media Storage (512K) │
                                 │  • Bookings & Leads     │
                                 │  • Pricing & Coupons    │
                                 │  • Settings & Profile   │
                                 │  • Availability & Slots │
                                 └─────────────────────────┘
```

### 1. Public Portfolio Frontend (`/frontend`)
* **3D Lens Aperture Transition:** Interactive WebGL 3D camera lens rendered with Three.js and React Three Fiber (`@react-three/fiber`), dynamically opening its mechanical iris aperture as visitors scroll from the About section into the Most Recent Photoshoot.
* **Canvas Image Protection:** Images are protected from casual downloads and context-menu saves via `<ProtectedCanvasImage>`:
  * Rendered directly into HTML5 canvas contexts behind invisible DOM interaction shields (`.media-shield`).
  * Right-click context menus, image dragging, and casual direct hotlinking are deterred.
  * Media endpoints require legitimate application headers (`X-R59-Client: media-viewer`) or an active authenticated session to prevent casual downloading (while recognizing that no client-rendered web asset can offer a 100% bulletproof anti-scraping guarantee against automated headless browsers).
* **Dynamic Hero Showcase:** Responsive hero slider displaying curated automotive and portrait photography with support for remote updates and GPU-composited CSS transitions.
* **Photographer Story & About Me:** Live biography paragraphs and dynamic photographer portrait synchronized with admin profile settings.
* **Most Recent Photoshoot Strip:** Carousel highlighting recent lookbook frames with animated aperture transitions.
* **Selected Works & Portfolio Gallery (`#portfolio`):**
  * Dynamic category filter pills (`All`, `Portrait`, `Editorial`, `Commercial`, `Events`, `Weddings`, `Product`).
  * Responsive studio grid with hover metadata overlays and a 3D SD Card empty state (`MemoryCardScene`) when a category has no photos yet.
  * Full-screen modal lightbox (`<PhotoLightbox />`) with keyboard arrow navigation and responsive canvas rendering.
* **Online Booking & Rescheduling (`#booking`, `/reschedule`):**
  * Multi-step booking flow with duration-aware consecutive time-slot availability, Google Places / Photon address autocomplete, coupon codes, and tokenized Square deposit checkout.
  * Self-service client rescheduling (`/reschedule`) with `.ics` and Google Calendar links.
* **FAQ, Contact & Custom 3D 404:** Dedicated FAQ section/page (`/faq`), interactive multi-step Contact inquiry flow with Polaroid collage (`#contact`), legal pages (`/privacy-policy`, `/terms`), and an interactive 3D studio 404 page (`NotFoundScene`).
* **Performance & SEO:** Progressive below-the-fold `<DeferredSection>` hydration, isolated `vendor-three` / `vendor-motion` chunks, Brotli/Zstd compression, Early Hints, `robots.txt`, `sitemap.xml`, `llms.txt`, and Schema.org JSON-LD.
* **Live Two-Way Synchronization:** Automatic tab-focus and visibility revalidation — when images, biographies, or studio settings are updated in Admin, the public website refreshes automatically when switching back.
* **Interactive Studio Footer:** Live contact links (`mailto:`, `tel:`) and validated social links (Instagram, Threads, X, Facebook, Pinterest) powered by dynamic settings.

### 2. Admin Management Portal (`/admin`)
* **Analytics & KPI Dashboard:** Real-time revenue, booking counts, monthly projections, and visual calendar overview.
* **4-Tab Photography Management:**
  * **Most Recent** (`recent`): Manage the homepage recent photoshoot strip.
  * **Gallery** (`gallery`): Curate and organize the public Portfolio Gallery grid.
  * **Hero** (`hero`): Upload and set homepage hero background slides.
  * **About me** (`about`): Update photographer portrait and edit studio biography.
* **Automatic In-Browser WebP Conversion:**
  * High-fidelity studio quality set to **`0.92`** (`92%`) for zero visual loss.
  * Proportional max-dimension scaling capped at **2560px** on the longest edge.
  * Converts any browser-decodable format (`JPG`, `PNG`, `AVIF`, `GIF`, etc.) into clean `.webp` blobs prior to upload.
  * Applied automatically on both drag-and-drop batch uploads and individual card replacements.
* **Studio Profile & Settings:** Editable biography, location, travel availability, phone, email, and social platform URLs.
* **Packages & Pricing:** CRUD management for photography packages, hourly rates, base fees, per-person rates, and deposit percentages.
* **Coupons & Promotions:** Percentage-based or flat-rate coupon codes with active toggles.
* **Schedule & Calendar:** Weekly recurring timeframes, rolling 90-day slot generation, single-day availability adjustments, and multi-day vacation / blocked dates management.
* **Bookings & Inquiries:** Client tracking, atomic multi-slot booking & rescheduling, notes, and cancellation/deletion workflows with automatic multi-slot release and reimbursement warnings.

### 3. Serverless Backend & Zero-Maintenance Automation (`/backend`)
* **100% Cloudflare D1 (Zero R2):** All metadata, bookings, and images are stored entirely in Cloudflare D1 SQLite database (`r59_db`).
* **Chunked Binary Media Storage & Edge Caching:** Uploaded WebP images are sliced into 512 KB binary `BLOB` chunks inside `Media_Storage`, served via HMAC-signed URLs (`?w=640|1280`) and versioned `?v=` immutable edge caching for public media (`private, no-store` for inactive/auth-gated media).
* **Atomic Multi-Slot Scheduling & Rolling Cron:** Shared `scheduleSync.ts` engine enforces service durations, consecutive slot locking, buffer times, and a daily Cloudflare Cron (`0 6 * * *`) + lazy self-heal maintaining a rolling 90-day booking window.
* **Edge Asset & Worker Integration:** Uses Cloudflare Workers static asset bindings (`_headers` + bundled `/admin` CSS/JS with `?v=` hashes) to serve pre-compiled frontend and admin bundles with single-digit millisecond latency.
* **Automatic Seed & Asset Hash Synchronization:** `backend/scripts/sync-defaults.ts` maps pre-bundled static assets into `defaultPortfolioSeed.json`, automatically seeding missing sections on first run.
* **Square Payments Integration:** Tokenized Square checkout with PCI-DSS compliance (no raw credit card numbers touch the worker or database).
* **Enterprise Security Headers & CI/CD:** Configured with Content-Security-Policy (CSP), HSTS, Cross-Origin-Opener-Policy (COOP), Referrer-Policy, anti-framing protections, Dependabot patch automation, and `/api/health` deployment verification.

---

## 📁 Repository Structure

```text
├── admin/                         # Administration dashboard (TypeScript + Modular JS/CSS)
│   ├── index.html                 # Admin portal entry point (deferred Google GIS)
│   ├── src/                       # TypeScript sources compiled to assets/js/
│   └── assets/
│       ├── css/                   # Design system tokens, layout, and page styles
│       └── js/
│           ├── api/               # API clients (photography, bookings, packages, schedule, payments)
│           ├── pages/             # Page controllers (photography, dashboard, payments, schedule)
│           └── utils/             # Client-side WebP converter (0.92 quality, 2560px max)
│
├── backend/                       # Cloudflare Worker API & Edge Asset Server
│   ├── src/
│   │   ├── index.ts               # Worker entry point, static asset routing, media streaming, cron
│   │   ├── lib/                   # scheduleSync, edgeCache, signedUrl, and D1 helpers
│   │   ├── routes/                # Hono API routes (portfolio, admin, services, bookings, checkout, reschedule, schedule)
│   │   ├── defaultPortfolioSeed.json # Seed catalog for default Main Page images
│   │   └── types/                 # Worker environment and database types
│   ├── scripts/                   # sync-frontend.ts, sync-defaults.ts, sync-admin.ts, bundle-admin-workers.ts
│   ├── test/                      # Node test runner suite (auth, checkout, media, schedule, duration locking)
│   ├── schema.sql                 # Canonical SQLite schema for Cloudflare D1
│   └── wrangler.toml              # Cloudflare Worker configuration, Cron & D1 bindings
│
├── frontend/                      # Public client application (React 19 + TypeScript + Vite)
│   ├── public/                    # robots.txt, sitemap.xml, llms.txt, favicons, 3D .glb models
│   ├── src/
│   │   ├── api/                   # API client with fallback datasets and media resolvers
│   │   ├── components/            # ProtectedCanvasImage, SiteHeader, and shared layout components
│   │   ├── config/                # Default studio data, hero slides, and photoshoot lookbooks
│   │   ├── pages/                 # FAQ, Legal (Privacy/Terms), and 3D NotFound (404) pages
│   │   ├── sections/              # hero, about, transition, recent, portfolio, booking, contact, footer
│   │   ├── styles/                # Global tokens, media shields, and responsive CSS
│   │   └── App.tsx                # Progressive DeferredSection single-page composition
│
├── docs/                          # Client & Admin User Manuals (MD + PDF) and handoff guides
└── README.md                      # This documentation
```

---

## 🗄️ Database Schema (Cloudflare D1)

The application uses Cloudflare D1 SQLite database (`r59_db`). The primary tables include:

| Table | Description |
|---|---|
| `Portfolio_Images` | Stores image records with `media_key`, `section` (`recent`, `gallery`, `hero`, `about`), `category`, `title`, `alt_text`, `display_order`, and `is_featured`. |
| `Media_Storage` | Stores uploaded 512 KB binary image chunks (`file_key`, `chunk_index`, `data`, `content_type`). |
| `Admin_Settings` | Stores dynamic JSON configuration for studio `profile`, `pricing`, and seeded section flags. |
| `Services` | Photography packages, pricing in integer cents, duration, and active status. |
| `Bookings` | Client bookings, assigned slots, payment IDs, deposit records, and statuses. |
| `Coupons` | Promotional codes with percentage or fixed amount discounts. |
| `Schedule_Slots` | Individual booking slots by date and start/end time. |
| `Blocked_Dates` | Calendar dates blocked from bookings with custom reasons. |
| `Leads` | Customer contact inquiries and consultation requests. |
| `Login_Attempts` | Rate-limiting bucket, attempt count, and sliding window timestamps for failed admin logins. |
| `Revoked_Sessions` | Cryptographic signature blacklist of explicitly logged-out admin sessions with expiry timestamps. |

---

## 🛠️ Development & Local Setup

### Prerequisites
* [Node.js](https://nodejs.org/) (v22+)
* [pnpm](https://pnpm.io/) (`corepack enable pnpm` or `npm i -g pnpm`)
* [Cloudflare Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (bundled via project dev dependencies)

### 1. Install Dependencies
```bash
# Install root dependencies
pnpm install

# Install frontend dependencies
cd frontend && pnpm install

# Install backend dependencies
cd ../backend && pnpm install
```

### 2. Local Environment Variables
Create a `.dev.vars` file in the `backend/` directory:
```env
# Square Sandbox Credentials (for checkout testing)
SQUARE_ACCESS_TOKEN="your_square_sandbox_token"
SQUARE_ENVIRONMENT="sandbox"
SQUARE_LOCATION_ID="your_square_location_id"

# Admin Authentication
ADMIN_EMAIL="r59mediatesting@gmail.com"
ADMIN_SECRET="your_secure_admin_password_or_token"

# Session HMAC Signing Secret
# MUST be cryptographically strong, min 32 chars, and strictly distinct from ADMIN_SECRET.
# Generate via: openssl rand -base64 48
SESSION_SECRET="generate_a_cryptographically_random_secret_minimum_32_chars"

# CORS configuration
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:8787"
```

> [!IMPORTANT]
> **Secret Separation:** `SESSION_SECRET` signs admin session authentication cookies and must be generated using high-entropy randomness (e.g. `openssl rand -base64 48`). It must never reuse or derive from `ADMIN_SECRET` (the bootstrap administrative password).

### 3. Database Initialization & Local Reset

To create or reset your local Cloudflare D1 SQLite database:
```bash
cd backend
pnpm run db:reset
```

> [!WARNING]
> **Data Loss & Password Reset Notice:**
> `pnpm run db:reset` drops and recreates all tables using `backend/schema.sql`. This completely wipes local development data, bookings, payments, and any updated admin password hash stored in `Admin_Settings`, restoring the initial bootstrap password (`ADMIN_SECRET`).
>
> **NEVER run `schema.sql` or `pnpm run db:reset` against a production database.**

### 4. Start Local Development Servers

In one terminal, start the **backend Cloudflare Worker** (includes local D1 SQLite database):
```bash
cd backend
pnpm run dev
# Worker runs at http://localhost:8787
```

In a second terminal, start the **public frontend Vite development server**:
```bash
cd frontend
pnpm run dev
# Vite runs at http://localhost:5173 (proxies /api to http://localhost:8787)
```

To access the **Admin Dashboard** locally, open:
```
http://localhost:8787/admin/
```

---

## 🚀 Building & Production Deployment

The project features an automated single-command build pipeline that compiles the frontend, synchronizes default asset hashes, and bundles the admin dashboard into `backend/public/`:

```bash
# Run from repository root or backend directory:
pnpm --dir backend run build
```

This executes:
1. `build:admin`: Typechecks and compiles `admin/src/` TypeScript sources.
2. `sync-frontend`: Builds the React Vite application (`frontend/dist`), copies it to `backend/public`, and writes Cloudflare `_headers`.
3. `sync-defaults`: Hashes compiled assets and generates `defaultPortfolioSeed.json`.
4. `sync-admin`: Minifies `admin/` assets, bundles CSS/boot JS with content hashes (`?v=`), and writes `backend/public/admin`.
5. `bundle:admin-worker`: Bundles `authWorker.ts`, `webpEncoder.worker.ts`, and `.wasm` assets.

### Verification Commands
```bash
# Lint, typecheck & build frontend
pnpm --dir frontend run check

# Strict typecheck admin
pnpm --dir admin run typecheck

# Typecheck, build & test backend
pnpm --dir backend run typecheck
pnpm --dir backend run build
pnpm --dir backend test
```

---

## 📚 Documentation & Client Manuals

* **Client User Manual:** [`docs/USER_MANUAL_CLIENT.md`](docs/USER_MANUAL_CLIENT.md) ([PDF](docs/USER_MANUAL_CLIENT.pdf))
* **Admin User Manual:** [`docs/USER_MANUAL_ADMIN.md`](docs/USER_MANUAL_ADMIN.md) ([PDF](docs/USER_MANUAL_ADMIN.pdf))
* **Zero-Maintenance Handoff Guide:** [`docs/CLIENT_HANDOFF_ZERO_MAINTENANCE.md`](docs/CLIENT_HANDOFF_ZERO_MAINTENANCE.md)

### Deploy to Cloudflare Workers
```bash
cd backend
pnpm exec wrangler deploy
```

---

## 🛡️ Security & Privacy Architecture

* **Controlled Media Delivery:** Media assets in D1 `Media_Storage` cannot be accessed via direct directory browsing. Image endpoints require legitimate application headers (`X-R59-Client: media-viewer`) or an authenticated admin session (`r59_session` cookie) to deter casual downloading and automated scraping (without claiming bulletproof guarantees against full headless browser scrapers).
* **Zero Visual Loss Image Optimization:** Uploaded images are re-encoded client-side into WebP with `quality = 0.92`, stripping GPS coordinates and private EXIF metadata while maintaining studio fidelity.
* **PCI-DSS Square Tokenization:** Credit card details are tokenized securely on the client through Square Web Payments SDK. The backend only handles single-use payment nonces.
* **Secure Cookie Authentication:** Admin sessions utilize `HttpOnly`, `Secure`, `SameSite=Strict` cookies with cryptographic signature verification and database-backed session revocation.

---

## 📄 License

Proprietary © R59 Media. All rights reserved.
