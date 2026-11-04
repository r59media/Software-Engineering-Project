# Graph Report - Software Eng Project  (2026-11-04)

## Corpus Check
- 126 files · ~59,259 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 36 file(s) not represented in the graph (top: .css 15, (none) 13, .ttf 5)

## Summary
- 786 nodes · 1809 edges · 23 communities (22 shown, 1 thin omitted)
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 262 edges (avg confidence: 0.9)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Public Portfolio & Protected Lightbox
- Hero Branding & Site Shell
- Portfolio Image & Media API
- Admin Schedule & Booking Calendar
- Frontend Dependencies & Tooling
- Cloudflare Worker & Session Auth
- Admin Photography Management Portal
- Photographer About & Studio Gear
- 3D Camera Lens Scroll Transition
- Asset Conversion & Sync Scripts
- Backend Dependencies & Framework
- Admin Payments & Coupon Management
- D1 SQLite Database Schema
- Frontend App TypeScript Config
- Booking & Schedule Administration API
- Backend Worker TypeScript Config
- GitHub Actions Auto-Sync Workflow
- Vite Node Tooling TypeScript Config
- Platform Architecture & Lead Inquiries
- Admin Dashboard & Revenue Metrics
- Admin App Initialization & State
- Admin Action Confirmation Dialogs
- Admin Drawer Navigation & Theming

## God Nodes (most connected - your core abstractions)
1. `adminRouter` - 34 edges
2. `react` - 24 edges
3. `ProtectedCanvasImage()` - 22 edges
4. `R59 Media Admin Dashboard Entry Point HTML` - 22 edges
5. `initScheduleListeners()` - 22 edges
6. `portfolioRouter` - 20 edges
7. `RecentPhotoshoot()` - 19 edges
8. `compilerOptions` - 18 edges
9. `Admin Directory Structure & Modular Layout` - 18 edges
10. `renderCalendar()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Overview Month Bookings Manager Widget` --semantically_similar_to--> `renderBookings()`  [INFERRED] [semantically similar]
  admin/index.html → admin/assets/js/pages/schedule.js
- `Overview Monthly Calendar Display` --semantically_similar_to--> `renderCalendar()`  [INFERRED] [semantically similar]
  admin/index.html → admin/assets/js/pages/schedule.js
- `Kevin D Gonzalez Official Portrait Headshot Image` --references--> `about`  [EXTRACTED]
  frontend/src/assets/aboutMeImages/kevin'sPortrait.webp → backend/scripts/sync-defaults.mjs
- `deleteCoupon()` --shares_data_with--> `adminRouter`  [INFERRED]
  admin/assets/js/api/paymentsApi.js → backend/src/routes/admin.ts
- `updateCoupon()` --shares_data_with--> `adminRouter`  [INFERRED]
  admin/assets/js/api/paymentsApi.js → backend/src/routes/admin.ts

## Import Cycles
- 2-file cycle: `backend/src/index.ts -> backend/src/routes/checkout.ts -> backend/src/index.ts`
- 2-file cycle: `backend/src/index.ts -> backend/src/routes/admin.ts -> backend/src/index.ts`
- 2-file cycle: `backend/src/index.ts -> backend/src/routes/portfolio.ts -> backend/src/index.ts`
- 3-file cycle: `backend/src/index.ts -> backend/src/routes/checkout.ts -> backend/src/routes/admin.ts -> backend/src/index.ts`

## Hyperedges (group relationships)
- **Admin Authentication & Session Lifecycle Flow** — admin_index_login, admin_assets_js_app_initauth, admin_assets_js_api_apiclient_login, admin_assets_js_api_apiclient_verifysession, admin_assets_js_api_apiclient_logout, backend_src_routes_admin_adminrouter, backend_src_middleware_auth_adminauth [EXTRACTED 1.00]
- **Booking, Scheduling & Square Checkout Engine** — backend_src_routes_checkout_checkoutrouter, backend_src_routes_schedule_schedulerouter, backend_src_routes_services_servicesrouter, backend_schema_bookings, backend_schema_schedule_slots, backend_schema_services, backend_schema_coupons, backend_schema_blocked_dates [EXTRACTED 1.00]
- **Booking Creation, Pricing Computation & Scheduling Flow** — admin_index_modal_new_booking, admin_assets_js_pages_schedule_computebookingprice, admin_assets_js_pages_schedule_createbooking, admin_assets_js_api_bookingsapi_createbooking, backend_src_routes_admin_adminrouter, backend_src_routes_schedule_schedulerouter [EXTRACTED 1.00]
- **D1 Chunked Media Storage & Streaming Pipeline** — readme_chunked_d1_media_storage, backend_schema_media_storage, backend_schema_portfolio_images, backend_src_index_app, backend_src_routes_upload_uploadrouter, backend_src_routes_portfolio_portfoliorouter, backend_src_routes_portfolio_deletestoredmedia [EXTRACTED 1.00]
- **Edge Security & Anti-Scraping Gatekeeper** — readme_anti_scraping_canvas_protection, readme_edge_security_headers_gatekeeper, backend_src_index_app, backend_src_middleware_auth_adminauth, backend_src_middleware_auth_verifysessiontoken, backend_src_routes_admin_isloginratelimited, backend_src_routes_checkout_checkcheckoutratelimit [EXTRACTED 1.00]
- **Hero Landing Automotive Showcase Visual Media Set** — frontend_src_assets_heroimages_heroimg1, frontend_src_assets_heroimages_heroimg2, frontend_src_assets_heroimages_heroimg3, frontend_src_assets_heroimages_heroimg4, frontend_src_config_hero_heroslides [EXTRACTED 1.00]
- **Anti-Scraping Canvas Media Protection Flow** — frontend_readme_protected_canvas_images, frontend_src_components_protectedcanvasimage_protectedcanvasimage, frontend_src_components_protectedcanvasimage_fetchandcachebitmap, backend_src_index_app, backend_src_index_media_content_types [EXTRACTED 1.00]
- **Photo Client-Side WebP Conversion & Upload Pipeline** — admin_index_view_images, admin_assets_js_pages_photography_handlefiles, admin_assets_js_utils_webpconverter_converttowebp, admin_assets_js_api_photographyapi_uploadimagefile, admin_assets_js_api_photographyapi_saveimagerecord, backend_src_routes_upload_uploadrouter, backend_src_routes_portfolio_portfoliorouter [EXTRACTED 1.00]
- **Recent Photoshoot Interactive Carousel Photo Series** — frontend_src_assets_mrphshimages_mrphsh_img01, frontend_src_assets_mrphshimages_mrphsh_img02, frontend_src_assets_mrphshimages_mrphsh_img03, frontend_src_assets_mrphshimages_mrphsh_img04, frontend_src_assets_mrphshimages_mrphsh_img05, frontend_src_assets_mrphshimages_mrphsh_img06, frontend_src_assets_mrphshimages_mrphsh_img07, frontend_src_assets_mrphshimages_mrphsh_img08, frontend_src_assets_mrphshimages_mrphsh_img09, frontend_src_config_recentphotoshoot_recentphotos [EXTRACTED 1.00]
- **Site Footer Social Media and Navigation Iconography Suite** — frontend_src_assets_footer_admin, frontend_src_assets_footer_back_to_top, frontend_src_assets_footer_camera_logo, frontend_src_assets_footer_divider, frontend_src_assets_footer_instagram, frontend_src_assets_footer_threads, frontend_src_assets_footer_x, frontend_src_sections_footer_sitefooter_sitefooter [EXTRACTED 1.00]
- **3D Camera Lens Aperture Scroll Transition Pipeline** — frontend_readme_lens_scroll_transition, frontend_src_sections_transition_abouttorecent_abouttorecent, frontend_src_sections_about_lensscene_lensscene, frontend_src_sections_recent_recentphotoshoot_recentphotoshoot [INFERRED 0.95]
- **Live Tab-Focus Data Revalidation Pipeline** — frontend_readme_tab_focus_sync, frontend_src_app_app, frontend_src_sections_about_useaboutdata_useaboutdata, frontend_src_sections_recent_recentphotoshoot_recentphotoshoot, frontend_src_sections_portfolio_portfoliogallery_portfoliogallery, backend_src_routes_portfolio_portfoliorouter [INFERRED 0.95]

## Communities (23 total, 1 thin omitted)

### Community 0 - "Public Portfolio & Protected Lightbox"
Cohesion: 0.06
Nodes (63): cancelBooking(), createBooking(), deleteBooking(), getBookings(), updateBooking(), createPackage(), deletePackage(), getPackages() (+55 more)

### Community 1 - "Hero Branding & Site Shell"
Cohesion: 0.08
Nodes (54): hero, heroAssets, Public Frontend HTML5 Entry Document, Vite Module Entry Script (/src/main.tsx), React Application Mount Root (#root), Adaptive Dark/Light Favicon Link Tags, R59 Media Dark Mode Favicon PNG, R59 Media Dark Mode Favicon WebP (+46 more)

### Community 2 - "Portfolio Image & Media API"
Cohesion: 0.06
Nodes (47): deleteImage(), getGalleryImages(), getUploadUrl(), mediaUrlForKey(), readErrorMessage(), replaceImageFile(), resolveApiUrl(), saveImageRecord() (+39 more)

### Community 3 - "Admin Schedule & Booking Calendar"
Cohesion: 0.08
Nodes (47): getPricingSettings(), updatePricingSettings(), Extended Admin Settings & Management Endpoints, Admin_Settings, Bindings, DEFAULT_PROFILE, MEDIA_CONTENT_TYPES, adminAuth() (+39 more)

### Community 4 - "Frontend Dependencies & Tooling"
Cohesion: 0.06
Nodes (39): clearAuthToken(), getAuthToken(), getBaseUrl(), login(), logout(), request(), setAuthToken(), verifySession() (+31 more)

### Community 5 - "Cloudflare Worker & Session Auth"
Cohesion: 0.10
Nodes (52): addBlockedDate(), applyNbCoupon(), bookingCardHTML(), bookingsGroupedHTML(), buildMonthGridHTML(), cancelTimeframe(), closeBookingEditor(), closeNewBooking() (+44 more)

### Community 6 - "Admin Photography Management Portal"
Cohesion: 0.12
Nodes (43): gallery, galleryPhotosData, recent, recentPhotosData, react-dom@19.2.8, fetchRecentPhotos(), Recent Photoshoot 01: Studio Portrait in Black Blazer & White Top, Recent Photoshoot 02: Studio Portrait with Glasses & Patterned Blouse (+35 more)

### Community 7 - "Photographer About & Studio Gear"
Cohesion: 0.07
Nodes (44): dependencies, react@19.2.8, @react-three/fiber@^9.8.2, three@^0.186.1, devDependencies, eslint@10.10.0, @eslint/js@10.0.1, eslint-plugin-react-hooks@7.1.1 (+36 more)

### Community 8 - "3D Camera Lens Scroll Transition"
Cohesion: 0.15
Nodes (34): getProfile(), saveProfile(), applyMove(), commitImages(), convertForUpload(), deletePhoto(), describeError(), ensureImageBuckets() (+26 more)

### Community 9 - "Asset Conversion & Sync Scripts"
Cohesion: 0.11
Nodes (20): 3D Camera Lens Scroll Transition Specification, aboutLens, blobUrlCache, AboutLens(), LensBoundary, LensFallback(), LensScene, LensModel() (+12 more)

### Community 10 - "Backend Dependencies & Framework"
Cohesion: 0.17
Nodes (29): PublicProfileData, About Me 128GB CompactFlash Memory Card Decoration Graphic, About Me 1TB High-Capacity Memory Card Decoration Graphic, About Me 32GB Memory Card Decoration Graphic, About Me Textured Paper Background Graphic, About Me Portrait Decorative Frame Graphic, About Me Large Professional Camera Lens Graphic, Canon EOS-90D DSLR Camera Body with Lens Graphic (+21 more)

### Community 11 - "Admin Payments & Coupon Management"
Cohesion: 0.09
Nodes (23): about, backendDir, __dirname, __filename, frontendDir, galleryCategories, getSha256(), hashMap (+15 more)

### Community 12 - "D1 SQLite Database Schema"
Cohesion: 0.13
Nodes (24): createCoupon(), deleteCoupon(), getCoupons(), updateCoupon(), addPackage(), commitCoupon(), initPaymentsListeners(), applyCouponActive() (+16 more)

### Community 13 - "Frontend App TypeScript Config"
Cohesion: 0.08
Nodes (28): dependencies, hono@4.13.13, square@45.1.0, description, devDependencies, @cloudflare/workers-types@4.20260702.1, typescript@5.9.3, wrangler@4.151.1 (+20 more)

### Community 14 - "Booking & Schedule Administration API"
Cohesion: 0.18
Nodes (23): confirmBlockDate(), confirmCancelBooking(), confirmChange(), confirmClearCancelled(), confirmDanger(), confirmDiscardChanges(), confirmRemoveBlockedDate(), confirmRemoveBooking() (+15 more)

### Community 15 - "Backend Worker TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+11 more)

### Community 16 - "GitHub Actions Auto-Sync Workflow"
Cohesion: 0.11
Nodes (17): compilerOptions, allowJs, allowSyntheticDefaultImports, checkJs, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+9 more)

### Community 17 - "Vite Node Tooling TypeScript Config"
Cohesion: 0.11
Nodes (17): jobs, sync, name, on, push, permissions, contents, branches (+9 more)

### Community 18 - "Platform Architecture & Lead Inquiries"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 19 - "Admin Dashboard & Revenue Metrics"
Cohesion: 0.33
Nodes (11): bookingYM(), initDashboardListeners(), money(), moveOverviewMonth(), refreshOverview(), renderOverview(), Revenue & Booking KPI Metrics Grid, Overview Month Bookings Manager Widget (+3 more)

### Community 20 - "Admin App Initialization & State"
Cohesion: 0.39
Nodes (8): bitmapToWebPBlob(), convertToWebP(), decodeHeicToBlob(), decodeToBitmap(), extractLargestEmbeddedJpeg(), isSupportedImageFile(), loadHeic2Any(), Photo Upload Drop Zone & WebP Conversion Inputs

### Community 21 - "Admin Action Confirmation Dialogs"
Cohesion: 0.40
Nodes (4): allowBuilds, esbuild, workerd, packages

## Knowledge Gaps
- **5 isolated node(s):** `Adaptive Dark/Light Favicon Link Tags`, `3D Mechanical Iris Aperture Scroll Transition`, `Two-Way Tab Focus & Visibility Synchronization`, `Design Tokens & Accessibility Preservation`, `Local Development & No-Build Deployment Guide`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 172 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `portfolioRouter` connect `Portfolio Image & Media API` to `Public Portfolio & Protected Lightbox`, `Admin Schedule & Booking Calendar`, `Admin Photography Management Portal`?**
  _High betweenness centrality (0.199) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `adminRouter` (e.g. with `login()` and `logout()`) actually correct?**
  _`adminRouter` has 19 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Adaptive Dark/Light Favicon Link Tags`, `3D Mechanical Iris Aperture Scroll Transition`, `Two-Way Tab Focus & Visibility Synchronization` to the rest of the system?**
  _5 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Public Portfolio & Protected Lightbox` be split into smaller, more focused modules?**
  _Cohesion score 0.05921325051759834 - nodes in this community are weakly interconnected._
- **Why does `adminRouter` connect `Public Portfolio & Protected Lightbox` to `3D Camera Lens Scroll Transition`, `Admin Schedule & Booking Calendar`, `Frontend Dependencies & Tooling`, `D1 SQLite Database Schema`?**
  _High betweenness centrality (0.181) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `ProtectedCanvasImage()` (e.g. with `app` and `RecentPhotoshoot()`) actually correct?**
  _`ProtectedCanvasImage()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `Hero Branding & Site Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.08205128205128205 - nodes in this community are weakly interconnected._