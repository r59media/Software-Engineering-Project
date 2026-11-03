# R59 Media — Photography Portfolio & Studio Management Platform

A high-performance, full-stack photography portfolio and studio management platform built for **R59 Media**. Features an interactive 3D camera lens aperture scroll transition, Pinterest-style anti-scraping and canvas image protection, a complete responsive client experience, and a modular administration dashboard powered by serverless Cloudflare Workers and Cloudflare D1.

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
* **Pinterest-Style Anti-Scraping Protection:** Images are protected from casual downloads, scraping bots, and right-click inspectors via `<ProtectedCanvasImage>`:
  * Rendered directly into HTML5 canvas contexts behind invisible DOM interaction shields (`.media-shield`).
  * Right-click context menus, image dragging, and hotlinking are prevented.
  * Media endpoints are protected with strict `X-R59-Client: media-viewer` headers and origin validation.
* **Dynamic Hero Showcase:** Responsive hero slider displaying curated automotive and portrait photography with support for remote updates.
* **Photographer Story & About Me:** Live biography paragraphs and dynamic photographer portrait synchronized with admin profile settings.
* **Most Recent Photoshoot Strip:** Carousel highlighting recent lookbook frames with animated aperture transitions.
* **Selected Works & Portfolio Gallery (`#portfolio`):**
  * Dynamic category filter pills (`All`, `Portrait`, `Editorial`, `Commercial`, `Events`, `Weddings`, `Product`).
  * Responsive studio grid with hover metadata overlays.
  * Full-screen modal lightbox (`<PhotoLightbox />`) with keyboard arrow navigation and responsive canvas rendering.
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
* **Schedule & Calendar:** Weekly recurring timeframes, single-day availability adjustments, and blocked dates management.
* **Bookings & Inquiries:** Client tracking, appointment scheduling, notes, and cancellation workflows with reimbursement warnings.

### 3. Serverless Backend & Storage (`/backend`)
* **100% Cloudflare D1 (Zero R2):** All metadata, bookings, and images are stored entirely in Cloudflare D1 SQLite database (`r59_db`).
* **Chunked Binary Media Storage:** Uploaded WebP images are sliced into 512 KB binary `BLOB` chunks and stored directly inside the `Media_Storage` table.
* **Edge Asset & Worker Integration:** Uses Cloudflare Workers static asset bindings to serve pre-compiled frontend and admin bundles with single-digit millisecond latency.
* **Automatic Seed & Asset Hash Synchronization:** `backend/scripts/sync-defaults.mjs` maps pre-bundled static assets into `defaultPortfolioSeed.json`, automatically seeding missing sections on first run.
* **Square Payments Integration:** Tokenized Square checkout with PCI-DSS compliance (no raw credit card numbers touch the worker or database).
* **Enterprise Security Headers:** Configured with Content-Security-Policy (CSP), HSTS, Cross-Origin-Opener-Policy (COOP), Referrer-Policy, and anti-framing protections.

---

## 📁 Repository Structure

```text
├── admin/                         # Administration dashboard (Vanilla JS/CSS)
│   ├── index.html                 # Admin portal entry point
│   ├── assets/
│   │   ├── css/                   # Design system tokens, layout, and page styles
│   │   └── js/
│   │       ├── api/               # API clients (photography, bookings, packages, schedule, payments)
│   │       ├── pages/             # Page controllers (photography, dashboard, payments, schedule)
│   │       └── utils/             # Client-side WebP converter (0.92 quality, 2560px max)
│
├── backend/                       # Cloudflare Worker API & Edge Asset Server
│   ├── src/
│   │   ├── index.ts               # Worker entry point, static asset routing, media streaming
│   │   ├── routes/                # Hono API routes (portfolio, admin, services, bookings, etc.)
│   │   ├── defaultPortfolioSeed.json # Seed catalog for 24 default Main Page images
│   │   └── types/                 # Worker environment and database types
│   ├── scripts/
│   │   └── sync-defaults.mjs      # Syncs frontend Vite assets into defaultPortfolioSeed.json
│   ├── schema.sql                 # Canonical SQLite schema for Cloudflare D1
│   └── wrangler.toml              # Cloudflare Worker configuration & D1 bindings
│
├── frontend/                      # Public client application (React 19 + TypeScript + Vite)
│   ├── src/
│   │   ├── api/                   # API client with fallback datasets and media resolvers
│   │   ├── components/            # ProtectedCanvasImage and shared layout components
│   │   ├── config/                # Default studio data, hero slides, and photoshoot lookbooks
│   │   ├── sections/
│   │   │   ├── header/            # Responsive navigation header
│   │   │   ├── hero/              # Fullscreen hero carousel
│   │   │   ├── about/             # Photographer biography, 3D lens model, portrait
│   │   │   ├── transition/        # AboutToRecent 3D iris aperture scroll transition
│   │   │   ├── recent/            # Most Recent Photoshoot carousel & PhotoLightbox
│   │   │   ├── portfolio/         # Selected Works & Portfolio Gallery (#portfolio)
│   │   │   └── footer/            # Live studio footer with contact & social links
│   │   ├── styles/                # Global tokens, media shields, and responsive CSS
│   │   └── App.tsx                # Main single-page application composition
│
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

# CORS configuration
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:8787"
```

### 3. Start Local Development Servers

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
1. `sync-frontend`: Builds the React Vite application (`frontend/dist`) and copies it to `backend/public`.
2. `sync-defaults`: Hashes compiled assets and generates `defaultPortfolioSeed.json`.
3. `sync-admin`: Copies and minifies `admin/` assets with esbuild into `backend/public/admin`.

### Verification Commands
```bash
# Typecheck backend
pnpm --dir backend run typecheck

# Lint & typecheck frontend
pnpm --dir frontend run check
```

### Deploy to Cloudflare Workers
```bash
cd backend
pnpm exec wrangler deploy
```

---

## 🛡️ Security & Privacy Architecture

* **No Direct File Exposure:** Media assets in D1 `Media_Storage` cannot be accessed via directory browsing or scraped without legitimate application headers (`X-R59-Client: media-viewer`) or an authenticated admin session (`r59_session` cookie).
* **Zero Visual Loss Image Optimization:** Uploaded images are re-encoded client-side into WebP with `quality = 0.92`, stripping GPS coordinates and private EXIF metadata while maintaining studio fidelity.
* **PCI-DSS Square Tokenization:** Credit card details are tokenized securely on the client through Square Web Payments SDK. The backend only handles single-use payment nonces.
* **Secure Cookie Authentication:** Admin sessions utilize `HttpOnly`, `Secure`, `SameSite=Strict` cookies with cryptographic signature verification and database-backed session revocation.

---

## 📄 License

Proprietary © R59 Media. All rights reserved.
