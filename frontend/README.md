# R59 Media — Public Frontend

Client-side application built with **React 19**, **TypeScript**, and **Vite**. Features high-performance WebGL animations, 3D camera lens aperture transitions, Pinterest-style canvas anti-scraping protections, dynamic portfolio galleries, and live revalidation with the Cloudflare D1 backend.

---

## 🛠️ Commands

Run these commands from the `frontend/` directory (or use `pnpm --dir frontend <cmd>` from the root):

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install all client dependencies. |
| `pnpm dev` | Start the local Vite development server with API proxying to `http://localhost:8787`. |
| `pnpm typecheck` | Run TypeScript checking (`tsc -b`). |
| `pnpm lint` | Run ESLint across all TypeScript and TSX files. |
| `pnpm build` | Check TypeScript and compile the optimized production bundle to `dist/`. |
| `pnpm check` | Run lint, TypeScript checking, and the production build in sequence. |
| `pnpm preview` | Preview the compiled production build locally. |

---

## 📁 Source Directory Structure

```text
public/                    # Static public files & favicons
src/
  api/
    client.ts              # Fetch client connecting to Cloudflare Worker & D1 APIs
  assets/                  # Bundled photography, fonts, 3D models (.glb), and icons
  components/
    ProtectedCanvasImage.tsx # Canvas-based protected image renderer with .media-shield
    SiteHeader.tsx         # Responsive studio header with navigation links
  config/                  # Fallback studio presentation data, hero slides, and lookbooks
  sections/
    hero/                  # Fullscreen automotive & portrait hero slider
    about/                 # Photographer biography, 3D lens model, portrait artwork
    transition/            # AboutToRecent 3D lens iris aperture scroll transition
    recent/                # Most Recent Photoshoot carousel & full-screen PhotoLightbox
    portfolio/             # Selected Works & Portfolio Gallery (#portfolio) with filters
    footer/                # Live studio footer with contact & social links
  styles/
    tokens.css             # Typography, colors, shadows, and design tokens
    global.css             # Global layout, responsive resets, and media shields
  types/                   # Shared TypeScript contracts and domain models
  App.tsx                  # Main single-page application composition
  main.tsx                 # Application bootstrap & React 19 root
```

---

## ✨ Features & Architecture

### 1. 3D Camera Lens Scroll Transition (`sections/transition/AboutToRecent.tsx`)
* Powered by Three.js and `@react-three/fiber`.
* Renders a photorealistic 3D camera lens model (`.glb`).
* As the user scrolls past the About section, the lens iris aperture blades mechanically expand and reveal the Most Recent Photoshoot section through a dynamic circular clip-path.

### 2. Protected Canvas Images (`components/ProtectedCanvasImage.tsx`)
* Prevents image scraping, drag-and-drop extraction, and direct right-click saving.
* Images are drawn onto HTML5 `<canvas>` elements placed behind an invisible DOM interaction shield (`.media-shield`).
* Requests are dispatched with custom `X-R59-Client: media-viewer` headers.

### 3. Selected Works & Portfolio Gallery (`sections/portfolio/`)
* Category filters: `All`, `Portrait`, `Editorial`, `Commercial`, `Events`, `Weddings`, `Product`.
* Interactive cards with metadata badges and hover effects.
* Modal lightbox (`PhotoLightbox.tsx`) supporting keyboard navigation (ArrowLeft, ArrowRight, Escape).

### 4. Live Tab-Focus Synchronization
* Uses `window` `'focus'` and `document` `'visibilitychange'` event listeners across `Hero`, `About`, `Recent`, and `Portfolio` hooks.
* Automatically updates images and biography in real-time when changes are saved in the Admin Dashboard.
