# R59 Media admin

## Overview

The `admin/` folder is the R59 Media administration UI. It is vanilla JavaScript, modules hang off `window.R59`, and the Worker serves it at `/admin/`. There is no framework and no build step for this folder.

The screens are login, Overview, Site copy, Photo library, Payment, Schedule, and Enquiries, plus dialogs (booking, payments, Settings, confirmation, review) and toasts. The login card also holds Forgot password and the "Choose a new password" form for reset links. The visual design is the Proof Sheet: a light paper theme, a dark theme, film-strip frames, and an inline SVG logo whose circle is `#ff2222`.

The UI edits bookings (including payments recorded against them), weekly availability, blocked dates, packages, pricing, coupons, gallery photos (including hiding a photo from the site), contact enquiries (read and delete), the admin password and recovery email, and the studio profile (biography, contact, location, travel, social links). Settings go through a Review & save bar. Record changes are sent immediately and applied in the page only after the server confirms them. A failed load is marked on that area and is not written back.

Profile reads used by the public site are fixed in `backend/src/` so a saved profile is what the site renders. This folder does not change public booking, checkout, or contact pages, and it does not make pricing or availability drive the public site.

## Directory structure

Paths are relative to `admin/`.

- `assets/css/components.css` — Shared styles for frames, buttons, fields, record rows, tabs, chips, empty states, dialogs, toasts, and the login card.
- `assets/css/layout.css` — Header row, Menu panel, page wrapper, and the save bar.
- `assets/css/main.css` — Base styles and typography.
- `assets/css/pages/dashboard.css` — Overview view, including the four-frame KPI strip (`.frames.k4`).
- `assets/css/pages/leads.css` — Enquiries view.
- `assets/css/pages/payments.css` — Payment view (fees, packages, coupons).
- `assets/css/pages/photography.css` — Site copy and Photo library views.
- `assets/css/pages/schedule.css` — Schedule view and the calendar frame shared with Overview.
- `assets/css/paper.css` — Paper texture as one `data:` URI background.
- `assets/css/tokens.css` — Tokens for colour, type, spacing, and motion in both themes.
- `assets/fonts/inter-300.woff2` — Subset Inter 300 (lead and login intro text).
- `assets/fonts/inter-400.woff2` — Subset Inter 400 (body). Preloaded.
- `assets/fonts/inter-700.woff2` — Subset Inter 700 (bold body and caps labels).
- `assets/fonts/inter-license.txt` — Inter licence.
- `assets/fonts/jost-500-italic.woff2` — Subset Jost 500 italic (emphasis).
- `assets/fonts/jost-700.woff2` — Subset Jost 700 (headings and figures). Preloaded.
- `assets/fonts/jost-license.txt` — Jost licence.
- `assets/js/api/apiClient.js` — Fetch client. Errors carry `message`, `status`, and `isNetworkError`. A 401 dispatches `r59:unauthorized`.
- `assets/js/api/bookingsApi.js` — Booking list, booking record writes, and booking payments (`getPayments`, `addPayment`, `removePayment`).
- `assets/js/api/packagesApi.js` — Package list, create, update, and delete.
- `assets/js/api/paymentsApi.js` — Pricing settings and coupons.
- `assets/js/api/photographyApi.js` — Profile, gallery records (admin list including hidden photos), upload, photo replace, and hide/show (`setImageActive`).
- `assets/js/api/scheduleApi.js` — Weekly availability and blocked dates.
- `assets/js/app.js` — Startup, per-area load, gated script loading, Review & save, Discard, login and logout.
- `assets/js/components/confirmation.js` — Confirmation dialog before a destructive record action.
- `assets/js/components/formValidation.js` — Native constraint checks, custom validity, and field messages.
- `assets/js/components/headerFold.js` — Measures the header row and folds items into the Menu.
- `assets/js/components/modal.js` — Modal dialogs and the focus trap. Open state is the class `open`.
- `assets/js/components/passwordReset.js` — Login card: Forgot password and the `#reset=` link form (`R59.passwordReset`). Public, because it runs before sign-in.
- `assets/js/components/settings.js` — Settings dialog: Change password and Recovery email (`R59.account`).
- `assets/js/components/notifications.js` — Toasts. `toast(message, opts)` takes a duration in milliseconds, or `{ type, duration }`.
- `assets/js/components/reviewChanges.js` — Settings diff and the review dialog.
- `assets/js/navigation.js` — View routing (`data-go`, `data-anchor`, `data-tab`), Menu, and the theme button.
- `assets/js/pages/dashboard.js` — Overview: KPIs (including Balance due), month navigation, calendar, read-only bio preview.
- `assets/js/pages/leads.js` — Enquiries: contact-form messages, newest first, with Load more and Delete (`R59.leads`).
- `assets/js/pages/payments.js` — Pricing, packages, and coupons.
- `assets/js/pages/photography.js` — Site copy (including the social link rows and the required-once-saved contact and location fields) and the photo library.
- `assets/js/pages/schedule.js` — Day, week, and month calendars, availability, bookings (with the Payments section of the edit dialog), and blocked dates.
- `assets/js/state.js` — `current` and `saved` settings, record collections, load status, diff recomputation, and booking money helpers (`balanceOf`, `formatCents`, `PAYMENT_METHODS`, `NO_PACKAGE`).
- `assets/js/theme-init.js` — Sets theme attributes before first paint. Loaded blocking from `head`.
- `assets/js/utils/webpConverter.js` — Converts uploaded images to WebP. Served only after sign-in.
- `index.html` — Login card (sign in, forgot password, choose a new password), header, six views, booking dialogs, Settings dialog, save bar, review dialog, confirmation modal, toasts, SVG sprite, and script tags.

Stylesheet order in `head`: `tokens.css`, `paper.css`, `main.css`, `layout.css`, `components.css`, then `pages/dashboard.css`, `pages/payments.css`, `pages/photography.css`, `pages/schedule.css`, `pages/leads.css`.

Script order: `theme-init.js` in `head`. At the end of `body`: `state.js`, `api/apiClient.js`, `components/notifications.js`, `components/modal.js`, `components/formValidation.js`, `components/reviewChanges.js`, `components/confirmation.js`, `components/headerFold.js`, `components/settings.js`, `components/passwordReset.js`, `navigation.js`, `app.js`. `app.js` then loads the gated API modules and page scripts.

## Design system

`tokens.css` holds the mockup tokens (`--yellow`, `--red`, `--ink`, `--paper`, `--frame`, `--film`, spacing `--s1` through `--s7`, radius, focus, and `--t`). Page CSS uses those properties. Motion is colour and opacity only, `var(--t)` (150 ms), and it respects `prefers-reduced-motion`.

The light theme is paper. The dark theme is `#111` with a static radial glow. `paper.css` paints one covering texture, about 900 px wide, encoded at 60 KB or less before base64.

Fonts are subset WOFF2 files, not a Google Fonts stylesheet: Jost 700 and Jost 500 italic for `h1`, `h2`, `h3`, figures, and emphasis; Inter 400 and Inter 700 for body text and caps labels; Inter 300 for the `.lead` text under each page title and the login intro (`.login .hint`), as the main site uses `--font-weight-light` for lead text. Headings and controls do not use 300. Jost 700 and Inter 400 are preloaded; Inter 300 is not (it loads with `font-display: swap`). Licence text sits next to the font files.

On `<html>`, `data-theme` is `light`, `dark`, or absent when the choice is System. `data-theme-effective` is `light` or `dark`. One theme button (`#themeToggle`) cycles System, then Light, then Dark. The default is System. The value is stored in `localStorage` under `r59_theme` as `system`, `light`, or `dark`.

`theme-init.js` runs before paint because the Content Security Policy forbids inline scripts. It is a blocking script in `head` and sets `data-theme` and `data-theme-effective` before the first paint.

Shared pieces are a `.wrap` page, `.sheet-head` titles, `.roll` sections, `.strip` film strips with `.frame` slots, `.kpi` figures, `.btn` / `.btn--primary` / `.btn--danger`, `.field` inputs, `.rows` of records, `.tabbar` photo tabs, `.empty` states, `.dialog` panels, and `.toast`. The review dialog is the native `<dialog id="review">`.

## Header and navigation

The header is one 56 px row (`#top` / `#topRow`): logo, nav groups, save status, Open portfolio, theme, Settings (`#settingsTop`, gear icon), Log out, and Menu. Nav groups are `#navOverview`, `#ddPersonal`, `#ddBusiness`, and `#ddImages`.

The save status (`#status`) is a fixed 1.25 rem icon, not text. `state.js` sets `data-state` (and keeps the `saved` class): `saved` is a check in muted ink, `dirty` a filled yellow dot, `saving` a muted ring that fades in and out (static under reduced motion), and `error` a red alert icon after a Review & save that stopped on a failure (`R59.state.setSaveFailed`; cleared by the next save or when nothing is unsaved). The words ("All changes saved", "3 unsaved changes, 1 needs a fix", "Saving changes…", "Save failed: 3 unsaved changes") are the element's `title` and the sr-only `#statusText` (`role="status"`, `aria-live="polite"`), which is only rewritten when the words change. It is not a button; the save bar is the way to Review & save.

Settings is an icon button (`aria-label` and `title` "Settings", the `#i-settings` sprite symbol). Items that do not fit are marked `.folded`. The same actions are copied into `#menuPanel`. Fold order is nav groups from right to left, Overview last, then Open portfolio, Settings, and Log out (all `.act-fold`, class `f2`), then tighter gaps (`f3`). The status icon never folds. The Menu's Account group holds Open portfolio, Settings, and Log out; its Settings copy closes the Menu and opens the dialog. Fit runs on a requestAnimationFrame-debounced ResizeObserver, on `document.fonts.ready`, and once before first paint with the row set to `overflow: hidden`. At 360 px the row still fits the logo, the status icon, the theme button, and Menu. The check widths are 360, 375, 768, 1024, 1440, and 1920, in both themes: `documentElement.scrollWidth` stays within `innerWidth`.

The Menu button uses `aria-expanded` and `aria-controls`. Escape closes the panel and returns focus. The panel closes when navigation happens.

Every nav item is a `button` with `data-go` and, where needed, `data-anchor` or `data-tab`. `navigation.js` handles them. After switching views, `go()` dispatches `r59:view` on `document` with `detail.view`; the Enquiries view loads the first time it opens. Day, Week, and Month stay inside Schedule and do not change the view.

| Header group | Items (`data-go`, then anchor or tab) |
|---|---|
| Overview | `overview` |
| Personal / Contact Information | `text`: `card-bio` (Biography), `card-contact` (Contact info), `card-location` (Location), `card-social` (Social media links) |
| Business Management | `payment` (Payment), `schedule` (Schedule), `leads` (Enquiries) |
| Images | `images`: `main` (Most Recent), `gallery` (Gallery), `hero` (Hero), `about` (About me) |

Open portfolio (`#openPortfolio`) goes to `/` with `target="_blank"` and `rel="noopener"`.

## Save model

`state.js` keeps `current` and `saved` for settings only. Record collections live on `current` only. Discard does not touch them.

### Settings (Review & save bar)

These fields use the bar:

- Profile: `bio`, `email`, `phone`, `location` (input id `city`), `travel`, `social`
- Pricing: `baseFee`, `perPerson`, `depositPercent`
- Availability: 7 days, each with its timeframes
- Each package that already has a server id: `name`, `price`, `description`, `outfits` (Number of outfits), `duration_minutes` and `full_day` (Session length)

Session length is one field group, `[ hours ] h : [ minutes ] min` plus an "Entire day" checkbox on the same line (it wraps below on a narrow frame). The ids are `pkg-<id>-duration-h` (0–24, accessible name "Session length hours"), `pkg-<id>-duration-m` (0–59, "Session length minutes") and `pkg-<id>-fullday`; in the Add package form they are `#pkgNewDurationH`, `#pkgNewDurationM` and `#pkgNewFullDay`. The fields show the stored length split into hours and minutes and are empty for a new package. `duration_minutes` in state is hours × 60 + minutes (an empty field counts as 0; `''` when both are empty). Ticking "Entire day" sets `full_day`, disables both fields (`disabled` plus `aria-disabled`, dashed and muted), skips their checks, and keeps what was typed, so unticking brings it back. In the new-booking dialog an "Entire day" package does not prefill the end time; the admin enters the times.

Social links (`#card-social`) are free-form rows, one per saved link: a Platform text input (`social-platform-<_id>`, required, at most 40 characters), an Address URL input (`social-url-<_id>`, required, `https://` only), and Remove. "+ Add link" (`#socialAdd`) appends an empty row and focuses its Platform input. With no rows, the card reads "No social links yet." Any platform name is allowed, and the same platform can appear more than once. A row whose platform (case-insensitive) is not one of `R59.state.PLATFORMS` (Instagram, Threads, X, Facebook, Pinterest, the platforms the footer has an icon for) shows "Saved, but the site footer doesn't show an icon for this platform yet."

Each row has a client-side `_id` from `R59.state.newSocialId()`, assigned when the profile loads or a row is added. The review diff keys rows by it and the field ids use it. It stays in the `saved` baseline, and it is stripped from the profile payload before it is sent. A row with both fields blank is not a change, is dropped on save, and is removed from the list after a successful save. Remove takes a row out of the current settings (it goes live on Review & save); a row with something typed in it asks first with `confirmRemoveSocial`, and a blank row is removed without asking.

The bar (`#savebar`) is hidden when nothing is unsaved. `#changeCount` is the number of diff rows. `#save` reads "Review & save". `#discard` is Discard. `#changeNote` reads "· N needs a fix" or "· ready to review".

`reviewChanges.diff(saved, current)` builds the rows after normalising: strings are trimmed, `''`, `null`, and `undefined` count as equal, and numbers are compared as numbers. Only areas whose load status is `loaded` are included. A row is invalid when that field exists and `checkValidity()` is false.

| Area | Key | Row label | Shown as |
|---|---|---|---|
| Profile | bio | Biography | "Edited" plus the first 80 characters of the new text |
| Profile | email, phone, location, travel | Contact info · Email (and the other labels) | old → new; empty is "(empty)" |
| Profile | social, by row `_id` | Social link · <platform> | old URL → new URL (prefixed with the platform when the platform changed), or added, or removed |
| Pricing | baseFee, perPerson, depositPercent | Pricing · Base fee | formatted with `$` or `%` |
| Availability | one row per day | Availability · Monday | old → new list, for example "9:00–12:00, 13:00–17:00 · weekly", or Unavailable |
| Packages | name, price, description, outfits per server id; duration_minutes + full_day as one row | Package "<saved name>" · Price (also · Outfits, · Session length) | old → new; outfits as "3 outfits"; session length as "45 min", "2 h" or "1 h 30 min", or "Entire day" (for example "1 h 30 min → Entire day") |

Each row is `{ area, key, label, oldText, newText, invalid, message, fieldId, view }`. Invalid rows show the message and a Fix button. For a social row, `fieldId` is the row's first invalid input (Platform, then Address). `#reviewConfirm` stays disabled while any row is invalid. Fix closes the dialog, calls `R59.navigation.go(view, { anchor: fieldId })`, scrolls to that control, and focuses it. If the anchor is not itself a field, focus goes to the first input, textarea, or select inside it.

Confirm freezes each changed area's payload, disables the bar and the dialog, and sends changed areas one after another, in this order: pricing, availability, profile, then packages (one PUT per changed package). The calls are `paymentsApi.updatePricingSettings({ baseFee, perPerson, depositPercent })`, `scheduleApi.saveWeeklyAvailability(availabilityArray)`, `photographyApi.saveProfile({ bio, email, phone, location, travel, social })` with `social` as `[{ platform, url }]` (no `_id`, blank rows dropped), and `packagesApi.updatePackage(id, { name, price, description, outfits, duration_minutes, full_day })` with price in dollars. `outfits` (`null` when empty), `duration_minutes` and `full_day` are sent only when they changed, so an older stored length outside 15–1440 does not block a name or price edit. With "Entire day" ticked, a length that is not valid is replaced by the saved one (so it is not sent). The Session length row's Fix goes to `pkg-<id>-duration-h`. After each 2xx, that area's `saved` copy becomes the frozen payload, not the live `current` values, so typing during the save stays unsaved. On failure or 401 the sequence stops. The error toast names the failed area and the server message. Later areas stay dirty. On 401 the login screen opens and in-memory edits are kept. After the next login, reload does not overwrite dirty areas. A success toast is shown only after a 2xx.

Discard copies `saved` settings back into `current`. It does not change coupons, bookings, blocked dates, photos, package active flags, or packages that were created or deleted as records.

### Records (immediate, after the server confirms)

Coupons (add, edit, delete, active), packages (add from the Add package form, delete, active toggle), bookings (create, edit, cancel, delete, clear cancelled), booking payments (record, remove), extra charges (add, remove), the Square invoice (send, cancel), blocked dates (add, remove), photos (upload, replace, remove, reorder, caption, alt, hide/show on site), enquiries (delete), the admin password, and the recovery email save on their own.

The write disables the control that started it, waits for the server, and on 2xx inserts, updates, or removes the row using the server id. There are no temporary ids and no optimistic list changes. On failure, an error toast shows the server message and the list stays as it was. A 401 does not also show that action toast; the login screen opens. The control is enabled again when the request settles.

Package active sends only `{ is_active }`. Deleting a package removes it from `current` and from saved settings. New packages are POSTed from the Add package form with name, price, description, Number of outfits (`#pkgNewOutfits`, optional) and Session length (`#pkgNewDurationH` / `#pkgNewDurationM`, or `#pkgNewFullDay`); there is no default length. It sends `full_day`, and `duration_minutes` 1440 when "Entire day" is ticked. There is no per-card "Save package" button and no `pkg_` draft ids. Record writes do not call `markDirty()`.

Destructive record actions open the confirmation dialog first and name the record: remove booking (client and date, plus "This also deletes N recorded payments ($x)." when it has any), remove payment (amount, method, date), record a payment larger than the balance due, remove an extra charge (description and amount), send an invoice (amount and client email), cancel an invoice, delete enquiry (sender), hide or show a photo (title; hiding the last visible photo of a section warns that the site falls back to its built-in photos), cancel booking (status change; everything paid so far, at booking and in recorded payments, is marked for reimbursement), clear cancelled bookings (count, plus "This also deletes N recorded payments ($x)." summed over them when they have any), remove package (name), remove coupon (code), remove timeframe (hours and weekday), remove blocked date (date), remove social link (platform), remove photo (title), remove recovery email (address). Cancelling the dialog leaves the record unchanged. The dialog closes before the request runs.

### Load status and Retry

Each area is `loading`, `loaded`, or `failed`. The areas are `profile`, `pricing`, `availability`, `packages`, `coupons`, `bookings`, `blockedDates`, and `images`. Every `get*` API function throws on HTTP or network failure. A failed area shows an inline error with the server message and a Retry button (`data-retry` on the area name). Its fields are read-only, and that area is not sent on save. Retry calls `reloadArea`. A network error on the startup session check shows Retry and does not log the user out.

## Booking payments

Money is integer cents in the database and in the admin logic; it is turned into dollars only when shown (`R59.state.formatCents`, for example "$1,234.50").

For one booking, **Base** is the Session price (`custom_price`, else `price_at_booking`, else the package price). **Total** is base plus the sum of its extra charges (`Booking_Charges.amount_cents`). **Paid at booking** is `Bookings.deposit_paid`. Online checkout charges only a deposit: `depositPercent` from the pricing settings (a whole number from 1 to 100; 60 when it is missing or invalid) of the price after the coupon, at least $1.00 (Square's minimum) and never more than that price. Checkout stores the price after the coupon in `price_at_booking`, the amount charged in `deposit_paid`, and the percent in `Bookings.deposit_percent` (100 when the deposit equals the price). Older and manual bookings have `deposit_percent` `NULL`. A booking with `square_payment_id` shows "(online, Square)". **Paid** is paid at booking plus the sum of `Booking_Payments.amount`. **Balance due** is `max(0, total - paid)`. The server works these out in `computeTotals` (`backend/src/lib/billingMath.ts`) and returns them as `totals`; in the admin, `R59.state.balanceOf(b)` is the only place they are worked out. It returns `{ totalCents, depositCents, paymentsCents, paidCents, balanceCents, overpaidCents, refundOwedCents, cancelled }`, with `totalCents` taken from `priceCents` (base plus charges). A cancelled booking has no balance; what was paid on it is shown as "Refund owed $x", or "Nothing paid". Refunds are not modelled.

`mapBooking` (app.js) keeps `priceCents` (total, from `total_cents`), `baseCents` (from `base_cents`), `chargesCents` (from `charges_cents`, 0 when missing), `depositCents`, `depositPercent` (from `deposit_percent`, or `null`), `paymentsTotal` (cents), `paymentsCount`, `squarePaymentId`, and `packageId` (`null` for no package) on each booking, next to the existing dollar `price` (the base) and `deposit`.

- **Booking rows** (Schedule list and Overview "Manage Bookings"): Total, Paid, and Balance due / "Paid in full" / Overpaid / Refund owed.
- **Overview KPIs:** Total Revenue's sub-label is "Collected $x" (paid on non-cancelled bookings). A fourth frame, **Balance due** (`#kpiBalanceDue`, `#kpiBalanceSub`), sums `balanceCents` over non-cancelled bookings, with "N bookings with a balance" or "Nothing outstanding".
- **Edit booking dialog, Payments** (`#paySection`): a summary (`#paySummary`) built from the saved booking (not unsaved dialog edits), the recorded payments (`#payList`, loaded when the dialog opens: loading, list, or an error with Retry), and a Record payment form: Amount (`#payAmount`, required), Method (`#payMethod`, required, no preselected value: Cash, Card, Square, Zelle, Venmo, Cash App, Other), Date (`#payDate`, required, empty), Note (`#payNote`, optional, up to 500 characters).
- Recording and removing are record actions: the button is disabled, the server answers, then the booking's `paymentsTotal` is set from the server totals (`payments_total_cents`) and its `paymentsCount` goes up or down by one locally (`totals` carries no count; the count comes from the server when bookings load), and the summary, rows and KPIs re-render. A payment larger than the balance due asks first. Method Square on a booking paid online shows a note (`#payMethodWarn`) that the online payment is already counted.
- A cancelled booking can't take payments (the form is disabled with "Cancelled bookings can't take payments."; the server answers 409). Removing payments still works.
- A payment recorded from a Square invoice has `square_invoice_id` set and shows "via Square invoice". Its Remove button appears only when `removable` is true (see Locks below).
- Deleting a booking first cancels its open invoice in Square (if any), then deletes its payments, extra charges, invoice rows and the booking in one database batch.

### Extra charges

The Payments section has an "Extra charges" list (`#chargeList`) and an add form (`#chargeForm`): Description (`#chargeDesc`, required, 1 to 120 characters after trimming) and Amount (`#chargeAmount`, required, dollars as text matching `^\d{1,7}(\.\d{1,2})?$`, $0.01 to $1,000,000.00), and Add (`#chargeAdd`). Each row shows the description, the amount, and Remove, which asks first. The empty state is "No extra charges." Adding and removing are record actions, saved right away and not part of Save changes. A cancelled booking can't take charges (409 `BOOKING_CANCELLED`). The summary shows an "Extra charges" figure when there are charges above 0, and Total includes them. When `depositPercent` is set, the paid-at-booking line reads "Paid at booking (60% deposit, Square)" with that booking's percent.

### Invoice

Below the charges, the "Invoice" block (`#invoiceBox`, `aria-live="polite"`) shows the current invoice (label, amount, due date, and a View invoice link that opens Square's page in a new tab) above a short history of up to 5 earlier invoices ("label · amount · date"). It has three buttons:

- **Send invoice for $X** (`#invoiceSend`) asks first ("Send invoice?" / "Square will email a $X invoice to <email>, due in 7 days."), then sends `{ expected_amount_cents }` set to the balance shown. Square emails the client an invoice for the balance, due 7 days after the studio's today, payable by card or bank transfer. It is enabled only when the balance is above 0, the booking is not cancelled, the client email is valid, and no invoice is open. If the balance changed meanwhile, the server answers `BALANCE_CHANGED`, the block reloads, and a toast says "The balance changed to $X. Review and send again."
- **Check status** (`#invoiceCheck`) reloads `GET /billing`, which asks Square for the current status of any open invoice. The block also loads this way when the dialog opens. When Square can't be reached, the block notes "Couldn't reach Square. Showing the last saved status."
- **Cancel invoice** (`#invoiceCancel`) asks first ("Cancel this invoice?" / "The client's invoice link will stop working.", keep label "Keep invoice"), then cancels it in Square. It is shown only while the invoice is open and can be cancelled.

The invoice lines add up to exactly the balance: "<Package> – session balance" (or "Session balance") for the balance minus the charges, then one line per charge; when earlier payments already covered part of the charges, a single "Remaining balance" line. When the client pays, Square's webhook (or the next Check status) records a `Booking_Payments` row with method Square and the note "Square invoice #<number>". The setup is in the root `README.md`, "Square webhook setup".

### Invoice statuses

The server computes each invoice's `label`; the admin shows it as is. Open statuses lock the booking's amounts (see below).

| Square status | Open | Label |
|---|---|---|
| `CREATING` | yes | Sending… |
| `DRAFT` | yes | Not sent |
| `UNPAID` | yes | Sent, or Overdue once the due date is before the studio's today |
| `SCHEDULED` | yes | Scheduled |
| `PARTIALLY_PAID` | yes | Partly paid |
| `PAYMENT_PENDING` | yes | Payment processing (can't be cancelled) |
| `PAID` | no | Paid |
| `PARTIALLY_REFUNDED` | no | Paid, partly refunded |
| `REFUNDED` | no | Refunded in Square |
| `CANCELED` | no | Cancelled |
| `FAILED` | no | Failed (a new invoice can be sent) |
| any other | no | The status text as is |

`CREATING` is the server's own row while a send runs. A `CREATING` row older than 2 minutes is resolved on the next Send, Check status, or Cancel, so a failed send never blocks a booking for long. `PAID`, `PARTIALLY_REFUNDED` and `REFUNDED` record the amount collected; refunds themselves are made in the Square dashboard.

### Locks while an invoice is open

Each lock is a condition inside the database write itself, so it can't race with a send. A refused write answers 409 `INVOICE_OPEN` ("An invoice is out for this booking. Cancel it to change amounts.").

Locked while an invoice is open:

- adding or removing an extra charge;
- recording or removing a manual payment;
- `PUT /bookings/:id` when it changes the effective base (Session price before and after the edit), `deposit_paid`, or the package. Sending the same price again is not a change.

Not locked: client name, email, phone, location, notes, attendees, date and time. An edited email is used by the next invoice; the open one was already emailed.

Cancelling a booking (the Cancel action, or `PUT` with status cancelled) and deleting a booking first cancel the open invoice in Square. If Square refuses (the invoice is paid, a bank transfer is processing, or Square can't be reached), the booking is left unchanged and the error is shown.

A payment recorded from a Square invoice can't be removed while that invoice is `PAID` (409 `SQUARE_INVOICE_PAYMENT`), because the next status check would add it back. Refund it in Square first; once the invoice is no longer `PAID`, the payment can be removed.

## No package

A booking can have no package: `Bookings.service_id` is `NULL` and it shows as "No package". In New booking, the package option "No package (custom price)" (value `none`) shows a required Custom price (`#nbCustomPrice`, empty by default); the total is that price, and base and per-person fees are not added. The edit dialog's package select has "No package". The request sends `packageId: 'none'`. Bookings that an older version attached to the first package keep that package until it is changed.

Older databases have `service_id INTEGER NOT NULL`. `ensureSchemaReady` rebuilds the Bookings table once (see `backend/src/routes/admin.ts`). Until that has run, creating a no-package booking, or switching an existing booking to "No package" (`PUT`), answers 503 `SCHEMA_PENDING` "The database update for bookings without a package hasn't run yet. Try again in a minute."

The partial unique index `idx_bookings_active_slot` keeps `WHERE status != 'cancelled'` (exact case) rather than `LOWER(status)`: checkout and the admin always write lower-case statuses (`POST` and `PUT` accept only pending, confirmed or cancelled and store them lower-cased), so only a legacy mixed-case row could slip past it.

## Enquiries

Business Management, Enquiries (`data-go="leads"`, `#view-leads`, `pages/leads.js`) lists contact-form messages (`Leads`), newest first, 50 at a time with Load more (`#leadsMore`, keyset paging with `before_id`). The list loads the first time the view opens, not at startup, and has its own error and Retry. `R59.leads.reset()` runs on the login screen so the next open reloads.

Every value is put in the page with DOM APIs (`textContent`, `a.href`), never as HTML. The email is a `mailto:` link only when it matches `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$` (address passed through `encodeURIComponent`); the phone is a `tel:` link only with 7 to 15 digits (href is digits and a leading `+` only). Otherwise they are plain text. The message keeps its line breaks (`white-space: pre-line`). `created_at` is read as UTC. Delete asks first and removes the row after the server confirms. The view is otherwise read-only.

## Settings

Settings (`[data-settings]`: `#settingsTop` in the header row, and a copy in the Menu's Account group that also closes the Menu) opens `#settingsModal` (`R59.account.openSettings` / `closeSettings`, in `components/settings.js`). It has two sections and a Close button (`#settingsClose`); Escape, the backdrop, and `showLogin` close it. Closing clears every field and message (focus leaves the dialog before the fields are cleared, so a blur check can't leave a message behind). Neither section is part of Review & save.

### Change password

Fields are Current password (`#pwCurrent`, `autocomplete="current-password"`), New password (`#pwNew`) and Confirm new password (`#pwConfirm`), both `autocomplete="new-password"`. All are `type="password"`, empty, and never trimmed.

"Update password" sends `PUT /api/admin/password` with `suppressUnauthorized`. Success closes the dialog with "Password updated." and the session stays signed in. A 401 with `INVALID_CREDENTIALS` shows "Current password is incorrect." on the current field; any other 401 opens the login screen. 400 and 429 messages show inline. Five wrong attempts lock sign-in for a minute. Other signed-in devices stay signed in (known limitation).

### Recovery email

"Used to reset your password if you forget it." Opening the dialog loads `GET /api/admin/account`. Saved address (`#recoveryCurrent`) shows the stored address, "Not set", "Loading…", or "Couldn't load" with the server message and Retry (`#recoveryRetry`); Save is disabled until it has loaded. When `email_configured` is false, a note (`#recoveryNote`) says "Password reset emails aren't set up yet. Your recovery email is saved and will be used once email sending is configured."

Fields are the address (`#recEmail`, `type="email"`, empty, at most 254 characters, trimmed, `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`) and Current password (`#recPassword`, required for Save and for Remove, never trimmed). This is a record action: "Save email" (`#recSave`) and Remove (`#recRemove`, shown only when an address is saved; it asks first) disable while the request runs, the saved address changes only after the server answers, and a toast reports the result ("Recovery email saved." / "Recovery email removed." or the server message; a field error shows on the field instead). After success the fields are cleared and the dialog stays open. A 401 with `INVALID_CREDENTIALS` shows "Current password is incorrect." on `#recPassword`; any other 401 opens the login screen. Changing or removing the address also cancels a reset link sent to the old one.

## Password reset

Sending is off until an email provider is added (see "Turning on reset emails"). The whole flow is built and stays hidden until then.

- **Forgot password?** (`#forgotOpen`, a text button on the Sign in form) shows only when `GET /api/admin/password-reset/available` returns `{ available: true }`, which needs email sending configured and a recovery email saved. It switches the card to `#forgotForm`: Recovery email (`#fpEmail`, same rule as above) and "Send reset link". The answer is always "If that address is the recovery email, a reset link has been sent.", so the form never tells anyone which address is set. "Back to sign in" returns to the Sign in form.
- **Reset link.** The email links to `/admin/#reset=<token>`. The token is in the fragment, so browsers don't send it to the server or put it in request logs or `Referer`. On load, `R59.passwordReset.startFromLink()` (called by `app.js` in place of the session check) reads the token, removes the fragment from the address bar straight away with `history.replaceState`, and keeps the token only in memory (never in `localStorage`, the URL, or logs; a reload needs the link again). The card shows "Choose a new password" (`#resetForm`): New password (`#rpNew`, 8 to 128 characters, never trimmed) and Confirm new password (`#rpConfirm`). "Update password" sends `POST /api/admin/reset-password`. Success shows the Sign in form with "Password updated. Sign in with your new password." (`#loginNotice`). `INVALID_RESET_TOKEN` (and a token that isn't 64 hex characters) hides the fields and shows "This reset link is invalid or has expired. Request a new one." "Back to sign in" then runs the normal session check.
- A link works once and for 30 minutes. A new request replaces the previous link. Other signed-in devices stay signed in after a reset (known limitation, as with Change password).

### Turning on reset emails

Everything to change is in `backend/src/email.ts`: `isEmailConfigured(env)` returns `false` and `sendEmail(env, { to, subject, text })` returns `{ sent: false, reason: 'not_configured' }`. Its header comment describes both options: Resend over `fetch` (add `RESEND_API_KEY` and `EMAIL_FROM` secrets with `wrangler secret put` and to the `Bindings` type in `backend/src/index.ts`), or a Cloudflare `send_email` binding. Once `isEmailConfigured` returns `true` and a recovery email is saved, "Forgot password?" appears and the Settings note goes away; the admin UI needs no change.

## Hidden photos

The Photo library reads `GET /api/admin/portfolio`, which includes hidden photos (`is_active = 0`); each item has `active`. Most Recent, Gallery and Hero frames have "Hide from site" / "Show on site" (record action, `PUT /api/portfolio/:id { is_active }`). A hidden frame is muted and shows a "Hidden from site" badge. Hiding the last visible photo of a section asks first, because the site then shows its built-in photos for that section. Reorder includes hidden photos. About has no hide control. The public `GET /api/portfolio` still returns active photos only.

## Validation

Checks are native constraint validation (`type`, `required`, `min`, `max`, `maxlength`, `pattern`) plus `setCustomValidity` in `formValidation.js`. A field is checked on blur, then on each input while it is invalid. The input gets `aria-invalid`, and the message goes in `#<id>-error`. A review row is invalid when that field's `checkValidity()` is false. `isValidUrl` accepts only `https://` URLs.

Required once saved: `formValidation.bindKeepSaved(input, baseRule, savedValue)` wraps the field's format rule. When the value in the `saved` snapshot is not empty, the field gets `required` and an empty value fails with the message below; when it is empty, the field stays optional. `photography.js` re-applies it after the profile loads, after Discard, and after a successful profile save (`R59.photography.onProfileSaved`).

| Field | Rule | Message |
|---|---|---|
| Email | Optional until saved; valid email | "Enter an email like name@example.com." |
| Phone | Optional until saved; at least 10 digits | "Enter a phone number with at least 10 digits." |
| Email, phone, location (`#city`), travel note | Required once the saved value is not empty | "This can't be empty once it has been saved. Enter a new value instead." |
| Bio | Optional; at most 1200 characters | "Keep the biography under 1,200 characters." |
| Social platform | Required; at most 40 characters | "Enter the platform name." |
| Social address | Required; `https://` URL | "Enter the full address starting with https://" |
| Base fee, per-person | Required; number ≥ 0 | "Enter an amount of 0 or more." |
| Deposit % | Required; whole number 1–100 | "Enter a whole number from 1 to 100" |
| Package name | Required | "Give the package a name." |
| Package price | Required; ≥ 0 | "Enter a price of 0 or more." |
| Number of outfits | Optional; whole number 0–50 | "Enter a whole number of outfits from 0 to 50, or leave it empty." |
| Session length (hours + minutes) | Unless "Entire day" is ticked: hours × 60 + minutes is 15–1440 (hours 0–24; an empty field counts as 0); shown on the hours field | "Enter a session length of at least 15 minutes (up to 24 h)." |
| Session length minutes | Unless "Entire day" is ticked: empty or a whole number 0–59 | "Minutes must be from 0 to 59." |
| Coupon code | Required; `A-Z`, `0-9`, `_`, `-`; unique | Messages in `pages/payments.js` |
| Coupon amount | Percent 1–100, or a fixed amount > 0 | Messages in `pages/payments.js` |
| Timeframe end | End after start | "End time must be after start time." |
| Booking end | Required on create; end after start | "Add an end time." / "End time must be after start time." |
| Custom price (no package) | Required when "No package (custom price)" is chosen; amount of 0 or more, up to 2 decimals | "Enter a price of 0 or more." |
| Payment amount | Required; `^\d{1,7}(\.\d{1,2})?$`, $0.01 to $1,000,000.00 | "Enter an amount like 150 or 19.99." |
| Payment method | Required; one of the seven methods | "Choose a payment method." |
| Payment date | Required; a real date from 2000-01-01 to tomorrow | "Enter the date the payment was made." |
| Payment note | Optional; at most 500 characters | |
| Current password (Change password, Recovery email) | Required | "Enter your current password." / "Current password is incorrect." (from the server) |
| New password | 8 to 128 characters; different from the current one | "Use at least 8 characters." / "Use at most 128 characters." / "Choose a password different from the current one." |
| Confirm new password | Required; matches New password | "Enter the new password again." / "The passwords don't match." |
| Recovery email | Required to save; at most 254 characters; strict email rule; not the address already saved | "Enter the recovery email address." / "Enter an email like name@example.com." / "That is already your recovery email." |
| Forgot password email | Required; strict email rule | "Enter your recovery email." / "Enter an email like name@example.com." |
| Reset: new password | 8 to 128 characters | "Use at least 8 characters." / "Use at most 128 characters." |
| Reset: confirm | Required; matches | "Enter the new password again." / "The passwords don't match." |

## About photo

The public site shows one About photo. The slot is the first active record with `section='about'`, ordered by `display_order` ascending, then `id` ascending. The Photo library and the Overview About preview use the same rule, so a hidden About record is never treated as the slot.

Zero records: the control is "Add photo" and uses the existing upload flow with `section='about'`. One or more records: the control is "Replace photo" and uses `photography.replaceAt` and `photographyApi.replaceImageFile`. The file picker accepts one file. Reorder is disabled for About. The control stays disabled while the upload is in flight. The About list is fetched again after the upload finishes. Any extra legacy or hidden records are labelled "Not shown on site" and can be removed with the existing Remove action.

If the portfolio metadata write fails after the file bytes have been uploaded, those bytes remain stored. No admin endpoint deletes them.

## View on site link map

"View on site" links use `target="_blank"` and `rel="noopener"`. The visible text is followed by an sr-only "(opens in a new tab)".

| Control | URL |
|---|---|
| Biography | `/#about` |
| Contact info | `/#footer` |
| Social links | `/#footer` |
| Location | No link. Location is not shown on the site. |
| Most Recent | `/#recent-photoshoot` |
| Gallery | `/#portfolio` |
| Hero | `/#hero` |
| About photo | `/#about` |

Open portfolio in the header goes to `/` with the same target and `rel`.

## Security notes

Content Security Policy `script-src 'self'` forbids inline scripts, `on*` handlers, and `javascript:` URLs. Theme setup and other behaviour live in script files. `style-src 'unsafe-inline'` and `img-src data:` are allowed. `style` attributes are allowed; classes are the normal way to style elements.

The Worker serves `pages/*`, `utils/webpConverter.js`, and the domain API files only when the user is signed in. Login-side code (`components/passwordReset.js`) is public for that reason; it holds no data. Any new page file must be added to `GATED_ADMIN_SCRIPTS` in `app.js`, or `app.js` will not load it. A new public component needs its own `<script>` tag in `index.html`.

Media protection redirects `.webp`, `.png`, and `.jpg` requests that have neither the `X-R59-Client` header nor a session cookie. The login screen has no cookie, and a CSS background cannot send that header. SVG and fonts are not covered by that rule. The paper texture is a `data:` URI in `paper.css` for that reason.

The session is an HttpOnly cookie. `POST /api/admin/login` takes the email (`#lu`) and password (`#lp`). The startup check calls `GET /api/admin/verify`. `localStorage` key `r59_admin_session_hint` is only a hint: it skips that startup check when this browser has never signed in. It is not a credential.

Every `/admin/*` response is `no-store`, so fonts and the texture are downloaded on each load and are kept small.

## Backend endpoints used

Calls go to `/api` on the same origin. With `wrangler dev` that host is `http://localhost:8787`.

Bookings:

- `GET /api/admin/bookings` — paged with `limit=100` and `offset`. Paging stops when a page returns fewer than 100 rows, and it stops after 50 pages. `bookingsApi.getAllBookings()` returns the raw rows. Each row also has `payments_total` (cents), `payments_count`, `base_cents` (Session price), `charges_cents` (sum of extra charges), `total_cents` (base plus charges) and `deposit_percent` (`null` for older and manual bookings); `package` is "No package" and `packageId` is `null` for a booking without a package.
- `POST /api/admin/bookings` — `packageId` empty, `'none'` or `'custom'` stores no package and then needs a custom price (`custom_price` in cents); `status` defaults to confirmed and otherwise must be pending, confirmed or cancelled (400); 503 `SCHEMA_PENDING` while the table update hasn't run.
- `PUT /api/admin/bookings/:id` — `packageId: 'none'` clears the package (503 `SCHEMA_PENDING` while the table update hasn't run); an unknown package id is 400; `status` must be pending, confirmed or cancelled. 409 `INVOICE_OPEN` when an invoice is open and the edit changes the effective base, `deposit_paid` or the package. Changing the status to cancelled first cancels the open invoice in Square; if that is refused, nothing is changed.
- `PATCH /api/admin/bookings/:id/cancel` — cancels the open invoice in Square first (if any), then sets the status to cancelled and frees the slot. A Square refusal (`INVOICE_ALREADY_PAID`, `INVOICE_PAYMENT_PENDING`, `INVOICE_SENDING`, `SQUARE_ERROR`) leaves the booking unchanged.
- `DELETE /api/admin/bookings/:id` — cancels the open invoice in Square first (if any), then deletes the booking's payments, extra charges, invoice rows and the booking in one batch. Refused in the same way as cancel.
- `GET /api/admin/bookings/:id/payments` — `{ payments: [{ id, booking_id, amount_cents, amount, method, paid_on, note, created_at, square_invoice_id, removable }], totals }`. `square_invoice_id` is `null` for a manual payment; `removable` is false while the linked invoice is `PAID`.
- `POST /api/admin/bookings/:id/payments` — `{ amount, method, paid_on, note }` with `amount` in dollars as typed; 201 `{ payment, totals }`; 409 `BOOKING_CANCELLED` on a cancelled booking; 409 `INVOICE_OPEN` while an invoice is open.
- `DELETE /api/admin/bookings/:id/payments/:paymentId` — `{ totals }`; 409 `INVOICE_OPEN` while an invoice is open; 409 `SQUARE_INVOICE_PAYMENT` while the payment's Square invoice is `PAID`.

Billing (extra charges and the Square balance invoice; every response that changes money returns fresh `totals`):

- `GET /api/admin/bookings/:id/billing` — first resolves stuck sends and asks Square for the current state of each open invoice (5 second timeout, one retry), then returns `{ charges, invoices, payments, totals, stale }`. `charges` are oldest first, `invoices` newest first (all statuses), `payments` as in `GET /payments`. `stale` is true when Square couldn't be reached and the saved status is shown.
- `POST /api/admin/bookings/:id/charges` — `{ description, amount }`: description 1 to 120 characters after trimming, `amount` in dollars as text (`^\d{1,7}(\.\d{1,2})?$`, $0.01 to $1,000,000.00). 201 `{ charge, totals }`, where `charge` is `{ id, booking_id, description, amount_cents, amount, created_at }`. 409 `BOOKING_CANCELLED` or `INVOICE_OPEN`.
- `DELETE /api/admin/bookings/:id/charges/:chargeId` — `{ totals }`; 404 when the charge isn't on this booking; 409 `INVOICE_OPEN`.
- `POST /api/admin/bookings/:id/invoice` — `{ expected_amount_cents }` (a whole number of cents, the balance the admin showed). Checks run in this order: 404 `NOT_FOUND`, 409 `BOOKING_CANCELLED`, 503 `SQUARE_NOT_CONFIGURED`, 400 `INVALID_EMAIL`, 400 `VALIDATION_FAILED`. Then it claims the booking (409 `INVOICE_SENDING` or `INVOICE_OPEN` if another invoice is open), re-reads the balance (409 `NO_BALANCE`, or 409 `BALANCE_CHANGED` with `details: [{ balance_cents }]`), and creates and publishes the Square invoice. 200 `{ invoice, totals }`. A Square failure is 502 `SQUARE_ERROR`; if Square may have sent it but didn't confirm, the message is "Square didn't confirm the invoice. Open the booking again in a minute to check."
- `POST /api/admin/bookings/:id/invoice/cancel` — cancels the open invoice in Square (a draft is deleted instead). 200 `{ invoice, totals }`; 404 `NO_OPEN_INVOICE`; 409 `INVOICE_SENDING`, `INVOICE_ALREADY_PAID` or `INVOICE_PAYMENT_PENDING`; 502 `SQUARE_ERROR`.

An `invoice` is `{ id, booking_id, square_invoice_id, invoice_number, status, label, is_open, amount_cents, amount, due_date, public_url, created_at, updated_at }`.

`totals` is `{ base_cents, charges_cents, total_cents, paid_at_booking_cents, payments_total_cents, paid_cents, balance_cents, overpaid_cents }` plus the same values in dollars without the `_cents` suffix. Total is base plus charges. The payments and billing routes and the leads list send `Cache-Control: no-store`.

Error codes for the booking, payment and billing routes. The body is `{ error: { code, message, details } }`, and the admin shows `message` in the toast.

| Code | HTTP | When |
|---|---|---|
| `NOT_FOUND` | 404 | Booking, charge or payment missing |
| `VALIDATION_FAILED` | 400 | Bad input; `details[].field` names the field |
| `INVALID_EMAIL` | 400 | Send: the booking has no valid client email |
| `BOOKING_CANCELLED` | 409 | The booking is cancelled |
| `INVOICE_OPEN` | 409 | A lock is in effect, or another invoice is open |
| `INVOICE_SENDING` | 409 | A send is in progress (a `CREATING` row under 2 minutes old) |
| `NO_BALANCE` | 409 | Send: the balance is $0 |
| `BALANCE_CHANGED` | 409 | Send: `expected_amount_cents` is not the balance; `details: [{ balance_cents }]` |
| `NO_OPEN_INVOICE` | 404 | Cancel invoice with nothing open |
| `INVOICE_ALREADY_PAID` | 409 | Cancel refused: the invoice is paid or refunded |
| `INVOICE_PAYMENT_PENDING` | 409 | Cancel refused: a bank transfer is processing |
| `SQUARE_INVOICE_PAYMENT` | 409 | Removing a payment whose Square invoice is still `PAID` |
| `SQUARE_NOT_CONFIGURED` | 503 | Square token or location missing: "Square isn't set up on the server." |
| `SQUARE_ERROR` | 502 | A Square call failed; the message is Square's error detail or a generic one |

Enquiries:

- `GET /api/admin/leads` — `limit` (default 50) and optional `before_id`; `{ leads, has_more, next_before_id }`, newest first (`created_at`, then `id`). The admin sends the id of the last enquiry it still shows as `before_id`; if that row was deleted meanwhile, the server continues with `id < before_id` (ids grow with insertion). When deletes empty the list and more exist, the first page is fetched again.
- `DELETE /api/admin/leads/:id`

Schedule settings:

- `GET /api/admin/availability` — weekly availability stored in `Admin_Settings`
- `PUT /api/admin/availability` — `scheduleApi.saveWeeklyAvailability`
- `GET /api/admin/blocked-dates` — `Blocked_Dates`
- `POST /api/admin/blocked-dates`
- `DELETE /api/admin/blocked-dates/:id`

Packages and services. `getPackages()` returns price in cents. `updatePackage` is called with price in dollars.

- `GET /api/services?all=true` — all services, including inactive ones (signed in)
- `POST /api/services` — create `{ name, description, price, duration_minutes, outfits, full_day }`, price in cents. `full_day` is a boolean or 0/1 (false when left out). When it is false, `duration_minutes` must be a whole number 15–1440 (the server uses 60 only when it is left out); when it is true, the length is not checked and 1440 is stored. `outfits` is a whole number 0–50 or `null`.
- `PUT /api/services/:id` — partial update of a service (also used for the active toggle with `{ is_active }`). A field that is left out keeps its stored value, `full_day` included; `duration_minutes` and `outfits` are checked as on POST when sent. When the package is (or becomes) full day, the stored length is kept unless a valid 15–1440 one is sent.

Both `GET` lists include `outfits` (`null` when not set), `duration_minutes` and `full_day` (a boolean, `false` when not set). `Services.outfits` is a nullable `INTEGER` column and `Services.full_day` is `INTEGER DEFAULT 0`; `ensureSchemaReady` adds both to older databases. The public `GET` can run before any admin route, so on a "no such column" error it runs `ensureSchemaReady` and retries, then falls back to a query without `full_day`, then to one without `outfits` and `full_day`.
- `DELETE /api/services/:id` — delete; a package with bookings is deactivated instead

Pricing and coupons:

- `GET /api/admin/pricing` — base fee, per-person fee, and deposit percentage in `Admin_Settings`
- `PUT /api/admin/pricing` — `paymentsApi.updatePricingSettings`
- `GET /api/admin/coupons`
- `POST /api/admin/coupons`
- `PUT /api/admin/coupons/:id`
- `DELETE /api/admin/coupons/:id`

Portfolio:

- `GET /api/admin/portfolio` — image records for the admin, including hidden ones (`is_active` 0/1); same parameters and shape as the public list (both routes use `listPortfolio` in `backend/src/routes/portfolio.ts`, the admin one with `includeInactive`)
- `GET /api/portfolio` — public image records (active only)
- `POST /api/portfolio` — metadata `{ media_key, category, alt_text, display_order, is_featured }`
- `PUT /api/portfolio/:id` — swap the file (`media_key`), edit title and alt text, or hide/show (`{ is_active }`)
- `PUT /api/portfolio/order` — reorder
- `DELETE /api/portfolio/:id` — remove a photo and its stored file
- `POST /api/upload-url` — `{ filename, contentType }`, returns a key
- `PUT /api/media/<key>` — upload the WebP bytes

Profile. The admin save calls `photographyApi.saveProfile`.

- `GET /api/admin/profile`
- `PUT /api/admin/profile` — biography, email, phone, location, travel, and social links in `Admin_Settings`

The admin profile response never contains placeholder defaults: a stored string (including `''`) is returned as stored, and a missing or `null` field is `''`. Social is the stored array, or `[]` when the key is missing.

Public reads, which the site uses after a reload:

- `GET /api/profile`
- `GET /api/portfolio/profile`

Both include `data` set to the profile object on success and in the error path. Public social is `[]` when the key is missing, and any other missing or `null` field is `''` (no placeholder text).

Session and health:

- `POST /api/admin/login`
- `GET /api/admin/verify`
- `POST /api/admin/logout`
- `PUT /api/admin/password` — `{ currentPassword, newPassword }`; the new password is 8 to 128 characters
- `GET /api/admin/account` — `{ recovery_email, email_configured }` (`recovery_email` is `''` when not set); `Cache-Control: no-store`
- `PUT /api/admin/recovery-email` — `{ email, currentPassword }`, `email` `''` removes it. The current password is checked like `PUT /password` (same stored hash, same rate limiter; wrong is 401 with `details[0].code` `INVALID_CREDENTIALS`). The address must match the strict rule and be at most 254 characters; it is stored trimmed and lower-cased in `Admin_Settings` `recovery_email`. Answers `{ recovery_email }`. Changing or removing it deletes any pending reset link.

Public password reset (registered before `adminAuth`, like `/login`; all `no-store`; bodies go through `hasForbiddenPaymentFields`, so a digits-only 13 to 19 character password is refused there as it is elsewhere):

- `GET /api/admin/password-reset/available` — `{ available }`: email configured and a recovery email saved. Nothing else.
- `POST /api/admin/forgot-password` — `{ email }`. Every request counts against the login rate limiter (5 a minute per IP, shared with sign-in). Always 200 `{ status: 'success', message: 'If that address is the recovery email, a reset link has been sent.' }`. Only when email is configured and the lower-cased address matches the stored one (`timingSafeEqual`): 32 random bytes become a hex token, its SHA-256 hash is stored in `Admin_Settings` `password_reset` as `{ token_hash, expires_at, used }` (30 minutes; replaces any earlier one), and the email with the link is sent.
- `POST /api/admin/reset-password` — `{ token, newPassword }`. Rate-limited (a bad token counts as a failed attempt). The new password is 8 to 128 characters (400 otherwise). The token's SHA-256 is compared with `timingSafeEqual`, then expiry and `used` are checked. Success writes the new PBKDF2 hash to `admin_password_hash` and deletes `password_reset` in one batch (single use). Otherwise 400 `{ error: { code: 'INVALID_RESET_TOKEN', message: 'This reset link is invalid or has expired. Request a new one.' } }`.
- `GET /api/health` — database and worker health

## Running locally

Create `backend/.dev.vars` (gitignored) with at least `ADMIN_EMAIL`, `ADMIN_SECRET` and `SESSION_SECRET`; Square sandbox keys are only needed for checkout and invoices, and `SQUARE_WEBHOOK_SIGNATURE_KEY` and `SQUARE_WEBHOOK_URL` only for the Square webhook (without them it answers 503, and Check status still works). Then run `pnpm --dir backend run dev` (local D1; reset it with `pnpm --dir backend run db:reset`) and open `http://localhost:8787/admin/`.

The copy the Worker serves from `backend/public/admin` is generated by `pnpm --dir backend run sync-admin`. Do not edit that copy by hand. The sync copies files, does not delete stale files, and skips `.md`. On push to `main`, CI regenerates that copy and commits it.

## Empty fields policy

Inputs have no example placeholder text and no prefilled values. The exception is New booking attendees, which starts at 1. Fields stay empty until real data is entered and saved. The admin does not write placeholder or default values the user did not type, and it does not send a settings area that failed to load or that the user did not change.
