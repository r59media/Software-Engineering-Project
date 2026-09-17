# R59 Media - Photography Portfolio & Booking Platform

A modern, single-page photography portfolio for R59 Media, featuring integrated booking, Square payments, and high-performance image delivery.

## Architecture

* **Frontend:** (In Development) Client-side application handling UI, form validation, and in-browser JPG/HEIC to WebP conversion.
* **Backend:** Serverless TypeScript API built with Cloudflare Workers and Hono.
* **Database:** Cloudflare D1 (SQLite) for storing leads, schedules, bookings, and admin settings.
* **Storage & CDN:** Cloudflare R2 for raw image storage, fronted by an external CDN (e.g., ImageKit) for on-the-fly WebP optimization and delivery.
* **Payments:** Square Node SDK for secure checkout processing.

## Project Structure

* `/backend` - The Cloudflare Worker API.
* `/frontend` - The client-side application (coming soon).

---

## Backend Development

The backend is a lightweight Cloudflare Worker that provides the core API for the portfolio.

### Prerequisites
* Node.js (v22+)
* pnpm

### Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```

### Local Development

1. **Initialize / Reset the local D1 Database:**
   ```bash
   pnpm run db:reset
   ```
   *(Note: `db:reset` is destructive and will wipe local data. `db:init` is only needed if creating the remote D1 database for the first time).*

2. **Start the development server:**
   ```bash
   pnpm run dev
   ```
   The API will be available at `http://localhost:8787`.

### Environment Variables (`wrangler.toml` & Secrets)
To test integrations locally, create a `.dev.vars` file in the `backend/` directory with the following variables:
```env
SQUARE_ACCESS_TOKEN="your_square_sandbox_token"
SQUARE_ENVIRONMENT="sandbox"
SQUARE_LOCATION_ID="your_square_location_id"

# Required for R2 Pre-signed URLs
R2_ACCESS_KEY_ID="your_r2_access_key"
R2_SECRET_ACCESS_KEY="your_r2_secret_key"
CLOUDFLARE_ACCOUNT_ID="your_cloudflare_account_id"

# Admin auth token — required for upload, portfolio, and admin endpoints
ADMIN_SECRET="your_admin_secret_here"

# Comma-separated list of allowed frontend origins (CORS)
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:8787"
```