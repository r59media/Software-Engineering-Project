# R59 Media — Frontend & Full-Stack Engineering Handoff (2026-11-18)

This document summarizes all updates implemented on **2026-11-18** across `frontend/`, `admin/`, and `backend/` (commits `3b50864a` → `fcaeb4f0`, plus verified working-tree updates in `index.html`, `ProtectedCanvasImage.tsx`, and `Hero.tsx`) so another engineer or AI assistant working on the frontend has complete context on wiring, API contracts, performance constraints, and browser/OS behavior.

---

## 1. Core Architectural Constraints (Do Not Break)
- **Package Manager**: Always use `pnpm` (`pnpm --dir frontend run check`, `pnpm --dir admin run typecheck`, `pnpm --dir backend run build`, `pnpm --dir backend test`).
- **Zero-Cookie Architecture**: `Set-Cookie` is forbidden. All frontend `fetch()` calls use `credentials: 'omit'` (`frontend/src/api/client.ts`). Admin auth uses Google Sign-In ID tokens exchanged for Bearer tokens stored in `sessionStorage` / memory.
- **Cloudflare Workers + D1 Hosting**:
  - `backend/` serves the Hono API (`/api/*`), bundled `admin/` (`/admin/*`), and built `frontend/dist` (`backend/public/` via `pnpm --dir backend run sync-frontend`).
  - `wrangler.toml` uses an explicit `run_worker_first` array so hashed `.js`, `.css`, `.woff2`, and `.glb` files are served directly by Cloudflare Assets with `Cache-Control: public, max-age=31536000, immutable` (`backend/scripts/sync-frontend.ts`), while `/`, `/index.html`, `/reschedule*`, `/faq*`, `/api/*`, `/admin/*`, `/assets/*.webp`, and `/models/*` pass through the Worker for CSP/hotlink security checks.

---

## 2. Frontend ↔ Backend API Wiring & Data Contracts

### A. Booking & Post-Checkout Confirmation Flow
- **Confirmed Session View (`frontend/src/types/booking.ts`, `DepositCheckoutModal.tsx`, `App.tsx`, `BookingSection.tsx`)**:
  - Added `ConfirmedBookingSummary` interface (`bookingId`, `totalCents`, `depositPaidCents`, `balanceDueCents`, `eventLocation`, `rescheduleUrl`, `icsUrl`, `googleCalendarUrl`).
  - `DepositCheckoutModal` passes this summary via `onSuccess(summary)` to `App.tsx` on checkout completion.
  - When `confirmedBooking` is set and the modal closes ("Done"), `BookingSection` replaces the pre-payment Step 4 (`YOUR SESSION — Continue to deposit ->`) with a **Confirmed Session Summary** card (booking `#`, service, date/time, location, contact details, payment breakdown, calendar/reschedule links, and a **Book another session** reset button).
- **Booking Address Propagation (`backend/src/routes/checkout.ts`, `googleCalendar.ts`, `email.ts`, `admin.ts`)**:
  - `checkout.ts` now passes `location: eventLocation` into `calendarBooking` (Google Calendar API push, Google Calendar template URL, `.ics` feed) and `sendBookingConfirmationEmail` (both client and admin emails).
  - `GET /api/admin/bookings` coalesces `COALESCE(NULLIF(b.event_location, ''), b.location) AS location` and `PUT/PATCH /api/admin/bookings/:id` syncs `event_location`.
- **Square Grace-Period Final Reminder (`backend/src/lib/squareBilling.ts`)**:
  - Balance invoices (`requestType: 'BALANCE'`) now include `reminders: [{ relativeScheduledDays: 0, message: '...' }]` so Square emails a final reminder on `dueDate` (the last day of `balanceDueDaysAfterEvent`).

### B. Availability, Collision Prevention & Rescheduling
- **Weekly Availability Rules (`backend/src/routes/schedule.ts`)**:
  - **Fixed bug**: Previously, if all 7 days in Admin → **Booking Availability** were marked `UNAVAILABLE` (`available: false`), `isSlotInWeeklyAvailability` treated `!hasActiveRules` as "unconfigured" and returned all seed slots. Now only an empty array `[]` defaults to open; a populated `weeklyAvailability` array with all days `available: false` returns `[]` (**0 slots**).
  - Both `GET /api/schedule` (new bookings) and `loadAvailableSlots` in `backend/src/routes/reschedule.ts` (rescheduling) share this exact filter plus `Blocked_Dates` and `is_booked = 0`.
- **Double-Booking Prevention (`checkout.ts`, `reschedule.ts`, `admin.ts`)**:
  - Atomic conditional SQL lock: `UPDATE Schedule_Slots SET is_booked = 1 WHERE id = ? AND is_booked = 0 AND date NOT IN (SELECT date FROM Blocked_Dates)`.
  - D1 partial unique index: `idx_bookings_active_slot ON Bookings(slot_id) WHERE status != 'cancelled'`.
- **Rescheduling (`frontend/src/sections/booking/RescheduleModal.tsx`, `backend/src/routes/reschedule.ts`)**:
  - **Fixed SQL 500 error**: Removed non-existent `Services.title` column (`s.title AS service_title` → `s.name AS service_name`) across all `Bookings` queries in `reschedule.ts` so `POST /api/bookings/reschedule/unlock` and `GET /api/bookings/:id/reschedule` work for both tokenized links and direct `/reschedule` 2-of-3 identity lookup (`Full Name`, `Email`, `Phone Number`).
  - Added reschedule links in `BookingServices.tsx` and `SiteFooter.tsx` (`${import.meta.env.BASE_URL}reschedule`).

### C. Standardized Phone Input (`(XXX) XXX-XXXX`)
- `frontend/src/utils/phone.ts` exports `formatPhoneInput` and `extractPhoneDigits` (strips non-digits, removes leading `1` on 11-digit pastes, caps at 10 digits, formats `(XXX) XXX-XXXX`).
- Applied to `BookingYourInfo.tsx`, `RescheduleModal.tsx`, `ContactSection.tsx`, `bookingValidation.ts` (10-digit validation), and Admin (`admin/src/components/formValidation.ts`, `schedule.ts`, `index.html`).

---

## 3. Performance, Edge Caching & Responsive Image Variants

### A. Cloudflare Free Plan Edge Caching (`backend/src/lib/edgeCache.ts`)
- Public read `GET` endpoints (`/api/portfolio`, `/api/services`, `/api/pricing`, `/api/profile`) now return `Cache-Control: public, max-age=30, s-maxage=300, stale-while-revalidate=600` and are cached via `caches.default` keyed by `Admin_Settings.public_cache_version` (excluding preview/admin requests).
- Any Admin mutation (portfolio, services, pricing, profile, media) calls `bumpPublicContentVersion(db)` to invalidate across all Cloudflare POPs immediately.
- `/api/media/*` verifies HMAC signatures and hotlink/`Sec-Fetch` headers **first** (0 DB cost), then checks `caches.default` using a canonical cache key with `sig` and `exp` stripped (`stripAuthParams: true`).

### B. Quality-Guaranteed Image Variants (`640px`, `1280px`, Original)
- **Backend (`signedUrl.ts`, `index.ts`, `admin.ts`, `portfolio.ts`)**:
  - Added optional `w=640|1280` parameter (HMAC-signed when using signed URLs, or passed on `/api/media/*` with `X-R59-Client: media-viewer`).
  - Looks up `${storageKey}__w${w}` in `Media_Storage` and falls back seamlessly to the original `storageKey` if no variant exists yet.
  - `PUT /api/admin/media/*?variant=640|1280` stores variants; deleting a photo removes its variants too.
- **Admin (`admin/src/api/photographyApi.ts`, `photography.ts`, `index.html`)**:
  - Uploads auto-generate `1280px` and `640px` WebP variants at identical quality (`quality: 92`, C-Wasm `method: 6`, `use_sharp_yuv: 1`).
  - Added **Generate sizes** button in Admin → Images toolbar (`generateMissingImageVariants`).
- **Frontend (`ProtectedCanvasImage.tsx`)**:
  - Measures `getBoundingClientRect().width * window.devicePixelRatio` and picks `640` (`<=640px`), `1280` (`<=1280px`), or original (`>1280px` or `forceOriginal`), appending `?w=` only for `/api/media/` URLs. `ResizeObserver` automatically upgrades if the container grows.

### C. Bundle Splitting, Request Dedupe & FOUC Prevention
- **`frontend/vite.config.ts`**: Separated `vendor-react` from `vendor-three` (`~995 KB`) and excluded `vendor-three` from `<link rel="modulepreload">` in `dist/index.html`.
- **`frontend/src/App.tsx`**: Lazy-loaded `DepositCheckoutModal` and `RescheduleModal` via `React.lazy`.
- **`frontend/src/sections/about/useAboutData.ts`**: Added in-flight promise deduplication + 60s TTL cache (invalidated on `portfolio-updated` event), collapsing 8 duplicate mount requests to 2.
- **`frontend/index.html`**: Added inline `<style>html,body{background:#111;color:#f0f0f0;margin:0}</style>` to prevent cold-load white FOUC, keeping font preloads (`jost-700.woff2`, `inter-400.woff2`) and removing mismatched `as="fetch"` preloads.
- **`ProtectedCanvasImage.tsx` & `Hero.tsx`**: Added `600px` `IntersectionObserver` lazy-gating for offscreen images; first Hero slide uses `loading="eager"`, `fetchPriority="high"`, and `placeholderColor="#141414"` (default is `'transparent'` for light sections).

---

## 4. Safari/WebKit Isolation, iPad Responsiveness & 3D Lens Optimization

### A. Strictly Scoped Browser/Device Flags (`frontend/src/utils/browserEnv.ts`)
- Called in `main.tsx` before mount:
  - `isWebKit`: Safari on macOS + all iOS/iPadOS browsers → sets `<html data-engine="webkit">`.
  - `isIPad`: iPad / `MacIntel` with `maxTouchPoints > 1` → sets `<html data-device="ipad">`.
  - **Desktop Chrome, Brave, and Firefox do not receive these attributes.**
- **Safari/WebKit Optimizations**:
  - `ProtectedCanvasImage.tsx`: Calls `ImageBitmap.close()` on cache eviction; on WebKit, releases offscreen `<canvas>` backing stores (`rootMargin: '900px'`) and repaints on re-entry.
  - `About.css`: Moves triple `drop-shadow` off `<canvas>` onto a static `::before` layer under `html[data-engine="webkit"]`.
  - `RecentPhotoshoot.css`: Scopes `url(#recent-gooey)` filter strictly to `.recent__dot--current`.
  - `Hero.tsx` & `RecentPhotoshoot.tsx`: Pauses 1.8s slideshow intervals when scrolled offscreen; `RecentPhotoshoot.tsx` ignores synthesized tap-hover (`isIPad || hover: none`).

### B. iPad & Mobile Layout Fixes
- `SiteHeader.css` (`851px–1080px`), `About.css` (`768px–1180px`), `RecentPhotoshoot.css` (`768px–1024px`), `BookingServices.css` (`768px–1180px`), `ContactSection.css` (`768px–1120px`), `FaqPage.css` (`100svh` with `100vh` fallback).
- `global.css`: Restored `@media (max-width: 850px) { .site-intro { padding-top: 5rem; } }` for the mobile header space and added `overflow-x: clip` to `html, body`.
- `AboutToRecent.tsx`: Treats `isIPad && clientWidth <= 1180` as touch viewport on address-bar height resize so the sticky transition doesn't jump.

### C. 60/120fps 3D Lens & Hinge-Preserving Meshopt Compression
- **Hinge-Preserving Meshopt Compression (`lens-desktop.glb` 1.23 MB → 277.7 KB, `lens-mobile.glb` 698 KB → 211.9 KB, `r59-memory-card.glb` 383 KB → 96.3 KB)**:
  - **Critical invariant**: `gltf-transform meshopt` (`KHR_mesh_quantization`) shifts node `translation`/`scale` away from the iris blade hinge pins. Each `IrisBlade_01`–`08` node now stores its original hinge coordinate in `node.extras.irisHinge: [hx, hy, hz]`.
  - `LensScene.tsx` registers `MeshoptDecoder`, keeps `frameloop="demand"` (per-canvas `RoomEnvironment` PMREM via `Reflect.set`), orbits each blade around `(hx, hy)` using rigid-body 2D rotation, and skips `invalidate()` when aperture delta `< 0.0004`.
- **Zero-Reflow Transition (`AboutToRecent.tsx`)**:
  - Removed per-frame `syncViewportHeight()` from `tick()` (kept only on resize), deduplicated `visibility`/`inert`/`dataset.progress` DOM writes, and switched `overlay.style.transform` to `translate3d` + `scale3d`.

---

## 5. Admin Fixes Summary
- **Bookings Scroll Trap Fixed (`admin/assets/css/pages/dashboard.css`, `schedule.css`)**: Changed `overscroll-behavior: contain` → `auto` on `#ovBookingsList` and `.bk-list`.
- **Optional Square Refund on Cancel (`admin/src/components/confirmation.ts`, `bookingsApi.ts`, `schedule.ts`, `backend/src/routes/admin.ts`)**: `PATCH /api/admin/bookings/:id/cancel` refunds the remaining Square deposit via `client.refunds.refundPayment` when `{ refund: true }` (controlled by a checked-by-default checkbox in Admin's cancel modal). Clients cannot self-cancel.
- **Google Calendar Real-Time Sync (`backend/src/routes/admin.ts`, `admin/src/pages/schedule.ts`)**: Fixed `Services.title` SQL error, wired Admin create/edit/cancel/delete to `syncBookingToGoogleCalendarApi`, and added `POST /api/admin/calendar-sync` backfill on **Sync Google Calendar**.

---

## 6. Verification Status (All Passing)
- `pnpm --dir frontend run check` (`eslint`, `tsc -b`, `vite build`): **PASS**
- `pnpm --dir admin run typecheck`: **PASS**
- `pnpm --dir backend run typecheck && pnpm --dir backend run build`: **PASS**
- `pnpm --dir backend test`: **80/80 PASS**
