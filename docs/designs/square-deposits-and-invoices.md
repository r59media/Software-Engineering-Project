# Square Deposits & Balance Invoices

*   **Author:** Joel-J-Leiva
*   **Status:** Approved (revision 2, after Goldfish review + Stage 8)
*   **Date:** 2026-11-06

--------------------------------------------------------------------------------

## Overview

Online bookings take a deposit through Square. After the event, the
photographer adds any extra charges (for example overtime) and sends a Square
invoice for the rest from the admin site. When the client pays that invoice, the
admin site records the payment on the booking automatically.

Proposed solution in one paragraph:
- **Checkout:** charges a deposit percentage (the code default is 60%) and saves
  that percent on the booking.
- **Extra charges:** the admin site can add itemized charges to a booking.
- **Send invoice:** a button creates a Square invoice for the remaining balance
  and publishes it, and Square emails it.
- **Payments:** Square notifies the backend when the invoice is paid (webhook),
  and the admin site also re-checks with Square when a booking is opened. Either
  path records the payment, and each payment is recorded once.

Scope: the backend (`backend/src`, a Cloudflare Worker using the Hono framework
and a Cloudflare D1 SQLite database) and the admin site (`admin/`). The public
site (`frontend/`) is not changed.

**Terms used in this doc**
- **The photographer** is the person using the admin site.
- **The admin site** is the software.
- **Re-check** means asking Square for an invoice's current state and saving it.
  The button for it is labelled "Check status".
- **Open invoice** means one in any status listed as open in the status table
  below.

**Existing code this builds on (all in `backend/src/routes/admin.ts` unless noted)**
- `adminAuth`: the login check applied to every `/api/admin/*` route.
- `ensureSchemaReady`: the startup migration. It runs at the start of admin
  requests and of `POST /api/checkout`.
- `bookingTotalCents`: the booking's base price
  (`custom_price ?? price_at_booking ?? package price`).
- `computeTotals`: builds the money summary for a booking.
- `Booking_Payments`: the existing table of payments the photographer records by
  hand.
- `studioToday`: today's date in the studio time zone (`Admin_Settings.timezone`).

## Problem

1.  **Checkout charges 100%.** `checkout.ts` charges the full package price
    (after any coupon) and stores it in `Bookings.deposit_paid`. Nothing is left
    to collect later.
2.  **The deposit setting does nothing.** The admin site has a "Down payment (%)"
    setting (`depositPercent`, default 50), but checkout never reads it.
3.  **Extras cannot be billed through Square.** The photographer can raise the
    "Session price" and type in payments made elsewhere, but nothing talks to
    Square. The client gets no invoice, and the admin site never learns that a
    payment arrived.

## Goals

1.  Online checkout charges `depositPercent` of the price after coupon, and
    stores the amount charged and the percent on the booking. Changing the
    setting later does not change existing bookings.
2.  The booking dialog shows the percent, e.g. "Paid at booking (60% deposit,
    Square) $300.00".
3.  The photographer can add and remove itemized extra charges (description and
    amount). They add to the booking total and balance.
4.  **Send invoice** creates and publishes a Square invoice for the exact
    remaining balance, emailed by Square to the booking's client email. It is due
    in 7 days and payable by card (including Apple Pay and Google Pay) or bank
    transfer (ACH).
5.  The dialog shows the invoice's status, amount, due date and a link to it.
    **Cancel invoice** withdraws an unpaid invoice so it can be corrected and
    sent again.
6.  When the client pays, the payment is recorded on the booking exactly once,
    whether the webhook, the re-check, or both report it.
7.  A booking has at most one open invoice. A double click, a second tab, or a
    crash midway cannot produce two invoices or an invoice Square knows about
    that the admin site doesn't.
8.  While an invoice is open, nothing that changes the balance can be edited.
    Cancelling or deleting the booking withdraws the invoice in Square first,
    and the booking change is refused if that fails.

## Non-Goals

*   No change to the public site. When it gets a checkout screen, it will need to
    show the deposit (see Future Improvements).
*   No refunds through Square. Refunds stay in the Square dashboard, and
    cancelled bookings show "Refund owed" as today.
*   No partial payments or installment plans on invoices.
*   No automatic rewrite of the stored deposit setting. Per the owner's decision,
    existing databases keep their stored value (probably 50). The photographer
    sets 60% in the admin site after deploy (see Rollout).
*   Existing bookings are not changed. They keep their stored `deposit_paid`, and
    `deposit_percent` stays empty.
*   Manual bookings are not charged a deposit through Square, but they can get a
    balance invoice like any other booking.

## Open Questions

None. The earlier items are now decisions:
*   Due dates use the studio time zone (see Flow 2).
*   Checking that Invoices is enabled on the production Square account is a
    rollout step (see Rollout).

## Critical User Journeys (CUJs)

### CUJ 1: Client books online and pays the deposit

*   **Given**: Down payment is set to 60%. A "Portrait" package costs $500, with
    no coupon.
*   **When**: The client completes checkout.
*   **Then**:
    - Square charges $300.00.
    - The booking stores total $500, paid at booking $300 and deposit percent 60.
    - The booking dialog shows "Paid at booking (60% deposit, Square) $300.00"
      and "Balance due $200.00".
    - Later changing Down payment to 50% leaves this booking unchanged.

### CUJ 2: Photographer bills overtime and sends the invoice

*   **Given**: The booking from CUJ 1, after an event that ran an hour over.
*   **When**: The photographer adds the charge "Overtime – 1 hr" for $75, clicks
    **Send invoice for $275.00**, and confirms.
*   **Then**:
    - Square emails an invoice for $275.00 with two lines: "Portrait – session
      balance $200.00" and "Overtime – 1 hr $75.00", due in 7 days.
    - The dialog shows "Sent · $275.00 · due Nov 13" and a "View invoice" link.
    - Charges, Session price, Paid at booking, package and Record payment are
      locked, each with a note that says to cancel the invoice first.
    - **Edge case**: a second click, or Send from another tab, gets "This
      booking already has an open invoice." and no second invoice is created.
      If a charge was added in another tab after the dialog loaded, Send is
      refused with "The balance changed to $X. Review and send again."

### CUJ 3: Client pays the invoice

*   **Given**: The open $275 invoice.
*   **When**: The client pays it by card.
*   **Then**:
    - Square calls the webhook. The backend checks the signature, reads the
      invoice from Square, marks it Paid, and records one payment of $275.00
      (method Square, note "Square invoice #000123").
    - The balance is $0.
    - If the webhook was missed, opening the booking runs the re-check and
      records the same payment once.
    - Repeated webhooks never add a second payment.

### CUJ 4: Photographer corrects a mistake

*   **Given**: An open invoice was sent with the wrong overtime amount.
*   **When**: The photographer clicks **Cancel invoice**, fixes the charge, and
    sends again.
*   **Then**: Square cancels the first invoice, so its link stops working, and
    sends a new one. The first invoice stays in the history as "Cancelled".

### CUJ 5: Booking cancelled while an invoice is open

*   **Given**: A booking with an open invoice.
*   **When**: The photographer cancels or deletes the booking.
*   **Then**:
    - The backend cancels the Square invoice first, then the booking.
    - If Square refuses (the client just paid, or the payment is processing) or
      can't be reached, the booking is not changed and the dialog says why. This
      follows the owner's decision to block, not override.

## Technical Plan (Architecture)

### Components

```text
 Public checkout (UI unchanged)           Admin site (admin/)
          |                                   | add charge / send / cancel / open booking
          | POST /api/checkout                v
 +--------v----------+            +--------------------------------+
 | routes/checkout.ts|            | routes/admin.ts (adminAuth)    |
 | charges deposit % |            | charges + billing routes       |
 +--------+----------+            +---------------+----------------+
          |                                       |
          |       +-------------------------------v----------------+
          +------>| lib/squareBilling.ts                           |
          |       |  getSquare, ensureCustomer, sendBalanceInvoice,|
          |       |  cancelOpenInvoice, resolveStaleSends,         |
          |       |  fetchAndSyncInvoice, syncInvoice, loadBilling |
          |       +------+-----------------------------+-----------+
          |              |                             ^
          v              v                             |
   Square Payments   Square Customers/Orders/Invoices  |  invoice.* events
                                                       |
                         +-----------------------------+------+
                         | routes/squareWebhook.ts            |
                         | POST /api/square/webhook (public)  |
                         | lib/squareWebhookAuth.ts (HMAC)    |
                         +------------------------------------+
  lib/billingMath.ts: calculations with no side effects (totals, deposit,
  invoice lines, dates, status labels). Every module above uses it.
```

- `lib/billingMath.ts` gets `bookingTotalCents` and `computeTotals` moved out of
  `admin.ts`. This avoids an import cycle (`admin.ts` → `squareBilling.ts` →
  `admin.ts`), and it lets the money math be unit-tested.
- Square client setup moves out of `checkout.ts` into `getSquare`, because
  checkout, the billing routes and the webhook all need it now.

### Money and naming

- All money is stored in integer cents. New tables name their cents column
  `amount_cents`. The existing `Booking_Payments` table keeps its column name
  `amount`, which also holds cents.
- Request bodies take dollars as text (for example `"75"` or `"19.99"`) in a
  field named `amount`. That field must match `^\d{1,7}(\.\d{1,2})?$` and be
  between 1 and 100,000,000 cents once parsed.
- **Base** is `bookingTotalCents` (Session price).
- **Total** = base + sum of charges.
- **Paid** = `deposit_paid` + sum of `Booking_Payments`.
- **Balance** = max(0, total − paid).

In the admin site's booking object:

| Field | Meaning |
|---|---|
| `price` | Base, in dollars (Session price) |
| `baseCents` | Base, in cents |
| `chargesCents` | Sum of extra charges, in cents |
| `priceCents` | Total (base + charges), in cents |
| `depositCents` | Paid at booking, in cents |
| `depositPercent` | Percent charged at checkout, or null |

Square's constants keep Square's spelling (`CANCELED`, `invoice.canceled`). The
UI says "Cancelled".

### Data model (D1)

DDL is listed in full in Detailed Implementation #6. In summary:

*   **`Bookings`** gets one new column, `deposit_percent INTEGER` (NULL for
    older and manual bookings). It is added to the existing Bookings rebuild
    column list. Without that, the rebuild would silently stop running for
    older databases.
*   No Square customer id is stored. Each send looks the client up by email
    (Flow 2 step 4), so an edited email can never leave a stale record.
*   **`Booking_Charges`**: one row per extra charge, with `id`,
    `booking_id`, `description` and `amount_cents`.
*   **`Booking_Invoices`**: one row per send attempt, with
    `id AUTOINCREMENT`, `booking_id`, `attempt_key` (a random UUID), the Square
    ids, `invoice_number`, `version`, `amount_cents`, `status`, `public_url`,
    `due_date`, `created_at`, `updated_at`.
    - A partial unique index allows at most one open invoice per booking.
*   **`Booking_Payments`** gets `square_invoice_id TEXT` with a unique index, so
    each invoice can record at most one payment.

### Invoice statuses

This is the only status-to-label mapping. The backend computes the `label` and
the admin site displays it as is.

| Status | Open? | Label | Notes |
|---|---|---|---|
| `CREATING` | yes | Sending… | Our row while Flow 2 runs, until publish returns. Square ids may already be saved. |
| `DRAFT` | yes | Not sent | Only from Square's side (a draft made or left in the dashboard). Deleted, not cancelled. |
| `UNPAID` | yes | Sent, or **Overdue** once `due_date` < studio today | |
| `SCHEDULED` | yes | Scheduled | Not produced by this flow. Handled if set in the dashboard. |
| `PARTIALLY_PAID` | yes | Partly paid | Not produced by this flow (single BALANCE request) |
| `PAYMENT_PENDING` | yes | Payment processing | Bank transfer in progress. Cannot be cancelled. |
| `PAID` | no | Paid | Records the payment |
| `PARTIALLY_REFUNDED` | no | Paid, partly refunded | Records the collected amount. The refund itself is handled in the Square dashboard. |
| `REFUNDED` | no | Refunded in Square | Records the collected amount, as above |
| `CANCELED` | no | Cancelled | |
| `FAILED` | no | Failed | A new invoice can be sent |
| any other | no | The status text | Shown as is |

### Flow 1: Checkout charges the deposit (`POST /api/checkout`)

1.  After the coupon step, read `Admin_Settings.pricing`. `JSON.parse` is
    wrapped in try/catch. Take `percent = normalizeDepositPercent(depositPercent)`,
    which is a whole number from 1 to 100, with 60 if the value is missing or
    invalid.
2.  Work out the deposit:
    - `depositCents = min(total, max(100, round(total × percent / 100)))`.
      Square's minimum charge is $1.
    - If the deposit equals the total (100%, or a total under $1.00), store
      percent 100.
    - Totals are already at least $1 after a coupon. A $0 package is rejected
      today and stays rejected.
3.  The Square order line is "Portrait – 60% deposit", or just the package name
    at 100%. Charge and verify `depositCents`. If the booking insert fails,
    refund `depositCents`.
4.  Insert the booking with `price_at_booking = total`,
    `deposit_paid = depositCents` and `deposit_percent = percent`.
5.  Add `deposit_cents`, `deposit_percent`, `total_cents` and `balance_cents` to
    the success response. Existing fields stay the same.

If Square isn't configured, checkout keeps its current behaviour: a 500
`PAYMENT_FAILED` response, and the time slot is released.

### Flow 2: Send invoice (`POST /api/admin/bookings/:id/invoice`, body `{ expected_amount_cents }`)

Checks run in this order:
- 404 `NOT_FOUND`
- 409 `BOOKING_CANCELLED`
- 503 `SQUARE_NOT_CONFIGURED`
- 400 `INVALID_EMAIL`
- 400 `VALIDATION_FAILED` (a missing or non-integer `expected_amount_cents`)

Steps:

1.  **Clear stuck sends.** `resolveStaleSends(bookingId)` (see Flow 5).
2.  **Claim the booking.** Insert a `Booking_Invoices` row with status
    `CREATING`, a new `attempt_key = crypto.randomUUID()` and `amount_cents = 0`.
    - If the insert fails with a D1 error message containing
      `UNIQUE constraint failed`, an invoice is already open. Return 409
      `INVOICE_SENDING` if that row is `CREATING`, otherwise 409
      `INVOICE_OPEN`.
3.  **Compute the balance now.** Do this after the claim, so no edit can happen
    between computing it and billing it (all the locks check for this row).
    - Balance 0: delete the row and return 409 `NO_BALANCE`.
    - Balance ≠ `expected_amount_cents`: delete the row and return 409
      `BALANCE_CHANGED`, with `details: [{ balance_cents }]`.
    - Otherwise save `amount_cents`.
4.  **Customer** (`ensureCustomer`):
    - Normalize the booking email (trim, lowercase).
    - `customers.search` with `filter.emailAddress.exact`, and take a match only
      when its email equals the normalized email.
    - If there is no match, `customers.create` with the booking's name and
      email, idempotency key `<attempt_key>-customer`.
    - Nothing is stored. The next send searches again, so it always uses the
      booking's current email.
5.  **Order.** `orders.create` at the location, with `pricingOptions:
    { autoApplyTaxes: false }`, idempotency key `<attempt_key>-order`, and lines
    from `buildInvoiceLines`:
    - If balance ≥ the sum of charges: a line "<Package> – session balance"
      (or "Session balance" with no package) for balance − charges, left out
      when 0, then one line per charge.
    - Otherwise (earlier payments already covered part of the charges): one
      line "Remaining balance" for the balance.
    - The lines always add up to exactly the balance.
    - Save `square_order_id` immediately.
6.  **Create.** `invoices.create` with key `<attempt_key>-invoice`:
    - the order and the customer;
    - one payment request: `requestType BALANCE`, due date = studio today + 7
      days, `automaticPaymentSource NONE`, `tippingEnabled false`;
    - `deliveryMethod EMAIL`;
    - `acceptedPaymentMethods { card: true, bankAccount: true, squareGiftCard:
      false, buyNowPayLater: false, cashAppPay: false }`;
    - title "Balance for <Package> on <Mon D, YYYY>".

    Save `square_invoice_id` and `version` immediately. The status stays
    `CREATING`.
7.  **Publish.** `invoices.publish` with the saved version, key
    `<attempt_key>-publish`. Only now save Square's returned status, along with
    the version, invoice number, `public_url` and due date. Then return 200
    `{ invoice, totals }`. Square sends the email.

Because the row stays `CREATING` until publish returns, two things hold:
- Another tab's Cancel during a send gets 409 `INVOICE_SENDING` (Flow 4).
- A crash at any step leaves a `CREATING` row, which Flow 5 resolves.

**On failure** (any thrown error in steps 4–7):
- **No `square_invoice_id` yet:** delete the row and return 502 `SQUARE_ERROR`
  with Square's message.
- **`square_invoice_id` is saved:** call `invoices.get`.
  - If it is still `DRAFT`: `invoices.delete`, delete the row, return 502
    `SQUARE_ERROR`.
  - If it was published (any other status): run `syncInvoice` and return 200,
    because it was sent.
  - If `invoices.get` also fails: leave the row as is and return 502
    `SQUARE_ERROR` with the message "Square didn't confirm the invoice. Open the
    booking again in a minute to check." Flow 5 resolves it.

Workers don't retry requests on their own. Idempotency keys cover the SDK's
internal retries within one attempt. Each new attempt gets a new
`attempt_key`, so keys never repeat across attempts, databases or `db:reset`.

### Flow 3: Recording a payment (`syncInvoice`)

`syncInvoice(db, invoice)` takes an invoice read from Square, never from a
webhook body:

1.  Update the row:
    `UPDATE Booking_Invoices SET status, version, invoice_number, public_url,
    due_date, updated_at WHERE square_invoice_id = ? AND (version IS NULL OR
    version <= ?)`. An older read never overwrites a newer one. The public URL
    is refreshed on every update, because Square doesn't promise it stays the
    same.
2.  Independently of step 1, work out `collected` = the sum of
    `paymentRequests[].totalCompletedAmountMoney.amount`, converted from BigInt
    with `Number()`. If `collected > 0` and the status is `PAID`,
    `PARTIALLY_REFUNDED` or `REFUNDED`, insert into `Booking_Payments`:
    - `amount = collected` (cents), method `Square`;
    - `paid_on` = the date of `invoice.updatedAt` in the studio time zone;
    - note "Square invoice #<number>" (or "Square invoice" if there is no
      number);
    - `square_invoice_id`, with `ON CONFLICT(square_invoice_id) DO NOTHING`.

    This catches only duplicates, unlike `INSERT OR IGNORE`, which would also
    silently drop rows that break other constraints.

If the photographer marks an invoice "paid outside Square" in the Square
dashboard, it also becomes `PAID` and is recorded with method Square, with the
same note. That is accepted.

### Flow 4: Cancel invoice (`cancelOpenInvoice`)

Used by `POST /api/admin/bookings/:id/invoice/cancel` and by booking cancel and
delete.

1.  Run `resolveStaleSends` (Flow 5). Then find the booking's open row. If there
    is none, return null. The route answers 404 `NO_OPEN_INVOICE`. Booking
    cancel and delete carry on.
2.  If the row is still `CREATING`, a send is running: return 409
    `INVOICE_SENDING`. This applies with or without Square ids, and stale rows
    were already resolved in step 1.
3.  Otherwise call `invoices.get` and act on the fresh status:
    - `DRAFT`: `invoices.delete`, then set status `CANCELED`.
    - `UNPAID`, `SCHEDULED`, `PARTIALLY_PAID`: `invoices.cancel` with the fresh
      version, then sync.
    - Already `CANCELED` or `FAILED`: sync, and treat it as done.
    - `PAID`, refunded statuses: sync, then 409 `INVOICE_ALREADY_PAID`.
    - `PAYMENT_PENDING`: sync, then 409 `INVOICE_PAYMENT_PENDING`.
4.  A Square network error or 5xx gives 502 `SQUARE_ERROR`. Booking cancel and
    delete are then refused, which is the owner's decision.

### Flow 5: Stuck sends (`resolveStaleSends`)

This runs at the start of Send, in `GET /billing`, and inside Cancel. It
handles `CREATING` rows older than 2 minutes:
- No Square id: delete the row.
- With an id: `invoices.get`. If `DRAFT`, delete it in Square and delete the
  row. If anything else, sync. If Square can't be reached, leave the row and
  report `stale: true`.

This way a crash midway never blocks a booking for more than about 2 minutes,
and never loses an invoice that was already emailed.

### Flow 6: Webhook (`POST /api/square/webhook`, public)

1.  If `SQUARE_WEBHOOK_SIGNATURE_KEY` or `SQUARE_WEBHOOK_URL` is missing, return
    503.
2.  If `Content-Length` is over 65,536, return 413. Read `c.req.text()` once, and
    return 413 again if it is longer.
3.  Verify the `x-square-hmacsha256-signature` header: base64 of HMAC-SHA256
    over `SQUARE_WEBHOOK_URL + rawBody`, using Web Crypto and a constant-time
    compare. On failure, return 401.
    - The URL comes from config, because the URL a Worker sees can differ from
      the one registered in Square.
    - Replayed messages are harmless, because the handler re-reads Square and
      inserts the payment idempotently.
4.  Run `ensureSchemaReady`.
5.  Return 200 `{ received: true, ignored: true }` without calling Square when:
    - the JSON doesn't parse;
    - the type isn't `invoice.payment_made`, `invoice.updated` or
      `invoice.canceled`;
    - there is no invoice id (`data.object.invoice.id`, falling back to
      `data.id`);
    - the id isn't in `Booking_Invoices`.
6.  Otherwise `fetchAndSyncInvoice`. A Square 404 returns 200, and any other
    Square or D1 error returns 500 so Square retries. Success returns 200
    `{ received: true }`.

Global middleware in `index.ts` doesn't interfere:
- CORS acts only when an `Origin` header is present, and Square sends none.
- The media guard applies only to GET and HEAD on media paths.
- Nothing reads the body before the handler.

### Flow 7: Re-check (`GET /api/admin/bookings/:id/billing`)

1.  Run `resolveStaleSends`.
2.  For each open row with a Square id, run `fetchAndSyncInvoice` with request
    options `{ timeoutInSeconds: 5, maxRetries: 1 }`. Errors are caught and set
    `stale: true`.
3.  Return `{ charges, invoices, payments, totals, stale }`. The response
    includes payments, so the list and the totals always come from the same
    moment.

The dialog calls this when it opens and when **Check status** is clicked. The
button exists because the dialog may still be open while the client pays.

### Locks while an invoice is open

Each lock is a condition inside the write itself
(`... WHERE NOT EXISTS (SELECT 1 FROM Booking_Invoices WHERE booking_id = ? AND
status IN (<open>))`). There is no separate check before the write, so it
cannot race with Send. When `changes = 0` and the booking exists, the answer is
409 `INVOICE_OPEN`.

Locked:
- adding or removing a charge;
- recording or removing a manual payment;
- `PUT /bookings/:id` when the change alters the effective base, `deposit_paid`
  or `service_id`. The effective base is `bookingTotalCents` worked out before
  and after the change. Just resending the same price doesn't count as a change.

Not locked: name, email, phone, location, notes, attendees, date and time. An
edited email is used by the next invoice. The open invoice was already emailed.

A payment recorded from an invoice can be removed only when that invoice is no
longer `PAID`, for example after a refund in Square. While it is `PAID`, the
answer is 409 `SQUARE_INVOICE_PAYMENT`, because the next re-check would add it
back.

### Admin site changes (`admin/`), inside the booking dialog's Payments section

*   **Summary:**
    - "Paid at booking (60% deposit, Square)" when `depositPercent` is set.
    - A new "Extra charges" figure when there are charges above 0.
    - Total includes charges.
*   **Extra charges** list and add form (Description, Amount). Each change is
    saved right away and is not part of Save changes.
*   **Invoice** block: the current invoice (label, amount, due date, View invoice
    link) above a short history. It has three buttons:
    - **Send invoice for $X**;
    - **Check status**;
    - **Cancel invoice**.

    The state table is in Detailed Implementation #12.

### New configuration

| Variable | Where | Purpose |
|---|---|---|
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Worker secret (`wrangler secret put`), and `backend/.dev.vars` locally | Verifies that webhook calls come from Square |
| `SQUARE_WEBHOOK_URL` | `wrangler.toml [vars]`, and `.dev.vars` locally | The exact URL registered in Square |

The existing `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` and
`SQUARE_ENVIRONMENT` are reused. A personal access token already has the
Customers, Orders and Invoices permissions.

## Alternatives Considered

### Alternative A: Re-check only, no webhook
*   **Pros**: No dashboard setup and no public endpoint.
*   **Cons**: A paid invoice shows up only when someone opens that booking.
    Dashboard balances and KPIs stay wrong until then.
*   **Reason for Rejection**: Leaving the dashboard figures wrong for bookings
    nobody opens is not acceptable for money tracking. The owner also chose
    webhook plus re-check, and the re-check is kept as the fallback.

### Alternative B: Edit Session price instead of itemized charges
*   **Pros**: No new table.
*   **Cons**: The invoice shows one unexplained line, and there is no record of
    why the price changed.
*   **Reason for Rejection**: Clients dispute charges they can't see broken
    down, and the photographer loses the record. Itemized lines fix both.

### Alternative C: Square Payment Links instead of Invoices
*   **Pros**: One API call, and no customer record needed.
*   **Cons**: The backend would have to send the email, there is no due date or
    overdue state, and a link can be paid twice unless it is deleted.
*   **Reason for Rejection**: Invoices give Square's email, due dates and status
    tracking without extra code.

### Alternative D: One invoice at booking time with DEPOSIT and BALANCE requests
*   **Pros**: Square tracks both parts.
*   **Cons**: The public checkout would have to change from charging a card on
    the spot to sending an invoice. Overtime isn't known at booking, and
    published invoices can only be edited in limited ways.
*   **Reason for Rejection**: It changes the public site and doesn't allow extras
    after the event.

### Alternative E: Save the card and charge the balance automatically
*   **Pros**: The client doesn't need to do anything.
*   **Cons**: Needs card-on-file consent and a stored-card flow on the public
    site.
*   **Reason for Rejection**: It is out of scope. Charges the client hasn't
    reviewed also lead to chargebacks.

## Risks & Mitigations

| Risk | Impact | Mitigation / detection |
|---|---|---|
| Crash or timeout during Send | An invoice emailed but untracked, or a booking stuck | Square ids are saved after each step. Flow 5 resolves stuck rows after 2 minutes, and failure handling always checks Square before deleting anything. |
| Webhook misconfigured (wrong URL or key) | Every call gets 401, and payments appear only when the booking is opened | The re-check fallback. A rollout step sends a test event from the Square dashboard and checks for a 200. Failed deliveries show in Square's webhook event log. |
| Square unreachable | Can't send, cancel or re-check, and booking cancel is blocked (owner's decision) | A clear 502 message. The dialog still opens with stored data and a stale note. |
| Stored deposit stays 50% | Checkout charges 50% until the setting is changed | A rollout step: set 60% in the admin site, then confirm with `GET /api/admin/pricing`. |
| Concurrent edits while sending | Billed amount differs from the balance | The claim happens before the balance is computed, locks are part of each write, and `expected_amount_cents` is checked. |
| Refund done in Square | The admin site keeps showing paid | The status shows "Refunded in Square". Once it is no longer PAID, the photographer can remove the payment row. |
| Re-check volume | One Square call per open invoice each time a booking is opened | Usually zero or one call, with a 5-second timeout and one retry. |

## Non-Functional Requirements

*   **Security:**
    - The webhook is the only new public endpoint. It requires a valid HMAC and
      caps the body size.
    - It uses only the invoice id from the body. Amounts are always read from
      Square, and only invoices we created can produce payments.
    - All other routes sit behind `adminAuth`, and no card data is handled.
    - Square error text is passed on, but tokens are never included.
*   **Money correctness:** money is kept in integer cents throughout. Invoice
    lines add up to the balance. Payments are made idempotent by a unique index.
    Locks are part of the same write they protect.
*   **Rollout:**
    1. Deploy. Schema changes only add things, and `ensureSchemaReady` runs on
       the first admin or checkout request.
    2. Set the webhook variables.
    3. Register the webhook in Square and send a test event.
    4. Confirm Invoices is enabled on the production Square account.
    5. Set Down payment to 60% in the admin site.
*   **Rollback:**
    1. Cancel open invoices in Square first.
    2. Disable the webhook subscription. Otherwise it would get 404s and Square
       would keep retrying.
    3. Then revert the code.

    After a rollback:
    - Charges are ignored, so balances drop by the charges.
    - Invoice payments become removable.
    - The new columns and tables stay in place and go unused.

    Set Down payment to 100% to go back to charging in full without a deploy.

## Future Improvements

*   A public `GET /api/checkout/terms` returning `depositPercent`, for when the
    public site gets a checkout screen.
*   Refunds through Square.
*   A scheduled Worker that runs the re-check on all open invoices daily.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Conventions:
- Error body: `{ error: { code, message, details } }`.
- IDs are checked with `isValidId`.
- Every money-changing response returns fresh `totals`.
- Admin routes are relative to `/api/admin`.
- New lib files use only TypeScript that can be stripped without changing
  behaviour (no `enum`, `namespace` or parameter properties), so Node can run
  the tests directly.

### Response shapes

```jsonc
// charge
{ "id": 7, "booking_id": 12, "description": "Overtime – 1 hr", "amount_cents": 7500, "amount": 75, "created_at": "2026-11-06 18:02:11" }
// invoice (from toInvoiceJSON)
{ "id": 3, "booking_id": 12, "square_invoice_id": "inv:0-ChB...", "invoice_number": "000123",
  "status": "UNPAID", "label": "Sent", "is_open": true, "amount_cents": 27500, "amount": 275,
  "due_date": "2026-11-13", "public_url": "https://squareup.com/pay-invoice/...", "created_at": "...", "updated_at": "..." }
// totals (computeTotals): every *_cents key has a dollar twin without the suffix
{ "base_cents": 50000, "charges_cents": 7500, "total_cents": 57500, "paid_at_booking_cents": 30000,
  "payments_total_cents": 0, "paid_cents": 30000, "balance_cents": 27500, "overpaid_cents": 0,
  "base": 500, "charges": 75, "total": 575, "paid_at_booking": 300, "payments_total": 0, "paid": 300, "balance": 275, "overpaid": 0 }
// GET /bookings/:id/billing
{ "charges": [/* oldest first */], "invoices": [/* newest first, all statuses */], "payments": [/* same as GET /payments */],
  "totals": {}, "stale": false }
```

`toPayment` adds `square_invoice_id` (or null) and `removable` (false while the
linked invoice is PAID).

### Error codes

| Code | HTTP | When |
|---|---|---|
| `NOT_FOUND` | 404 | Booking, charge or payment missing |
| `VALIDATION_FAILED` | 400 | Bad input. `details[].field` names the field. This is the existing code. |
| `INVALID_EMAIL` | 400 | The booking has no valid client email (Send) |
| `BOOKING_CANCELLED` | 409 | The booking is cancelled (existing code) |
| `INVOICE_OPEN` | 409 | A lock is in effect, or another invoice is open |
| `INVOICE_SENDING` | 409 | A send is in progress (fresh `CREATING`) |
| `NO_BALANCE` | 409 | The balance is $0 |
| `BALANCE_CHANGED` | 409 | `expected_amount_cents` ≠ balance. `details: [{ balance_cents }]`. |
| `NO_OPEN_INVOICE` | 404 | Cancel with nothing open |
| `INVOICE_ALREADY_PAID` | 409 | Cancel refused because it is paid or refunded |
| `INVOICE_PAYMENT_PENDING` | 409 | Cancel refused because a bank transfer is processing |
| `SQUARE_INVOICE_PAYMENT` | 409 | Removing a payment whose invoice is still PAID |
| `SQUARE_NOT_CONFIGURED` | 503 | Token or location missing. Message: "Square isn't set up on the server." |
| `SQUARE_ERROR` | 502 | A Square call failed. Message: Square's `errors[0].detail`, or a generic message. |

### Phases (each phase ends buildable and passing)

1.  **Math.** Files #1, #2, #8.
    Gate: `typecheck` and `test` pass.
2.  **Schema, totals and checkout.** Files #6 (migration, totals, GET
    /bookings), #7, #5, plus `getSquare` and `squareErrorMessage` from #3
    (created now, because checkout uses them).
    Gate: `typecheck`, then `db:reset` twice. A manual booking still loads, with
    the same totals as before.
3.  **Square service, routes and webhook.** Files #3, #4, the rest of #6, #9,
    #10, plus the stateful tests in #8.
    Gate: `typecheck`, `test`, and the local smoke curl checks.
4.  **Admin UI.** Files #11–#16, then `sync-admin`.
    Gate: the local UI smoke test.
5.  **Docs and sandbox.** Files #17 and #18, then the sandbox end-to-end run.

### Target Files to Create/Modify

#### 1. `backend/src/lib/billingMath.ts` (Create)

*   **Scope:** No side effects and no imports.
*   **Constants:**
    - `DEFAULT_DEPOSIT_PERCENT = 60`
    - `SQUARE_MIN_CHARGE_CENTS = 100`
    - `INVOICE_DUE_DAYS = 7`
    - `STALE_SEND_MS = 120000`
    - `OPEN_INVOICE_STATUSES` (the status table)
    - `PAID_LIKE_STATUSES = ['PAID','PARTIALLY_REFUNDED','REFUNDED']`
    - `MAX_CHARGE_CENTS = 100000000`
    - `DESCRIPTION_MAX = 120`
*   **Functions:**
    - `isOpenInvoiceStatus(s)`
    - `normalizeDepositPercent(v)`: accepts a finite number, or a string
      matching `^\d+(\.\d+)?$`. Rounds, then clamps to 1–100. Anything else
      gives 60.
    - `depositFor(totalCents, percent): { cents, percent }`: implements Flow 1
      step 2.
    - `bookingTotalCents(row)`: moved from `admin.ts`, unchanged.
    - `computeTotals(row, paymentsTotalCents, chargesCents = 0)`: moved, and
      adds the base and charges keys.
    - `buildInvoiceLines({ balanceCents, packageName, charges })`: implements
      Flow 2 step 5.
    - `addDaysISO(iso, n)`
    - `dateInTimeZone(tz, at = new Date())`: `Intl` with `en-CA`. Falls back to
      `America/New_York` (the existing `DEFAULT_TIMEZONE`), then to UTC.
    - `invoiceStatusLabel(status, dueDate, today)`: the status table.

#### 2. `backend/src/lib/squareWebhookAuth.ts` (Create)

*   `verifySquareSignature({ body, signature, key, url }): Promise<boolean>`
    - Web Crypto HMAC-SHA256, base64.
    - Compares in constant time, using `timingSafeEqual` from
      `middleware/auth.ts`.
    - Returns false on any empty input.

#### 3. `backend/src/lib/squareBilling.ts` (Create)

*   **Classes:**
    - `BillingError(code, httpStatus, message, details = [])`
    - `SquareNotConfiguredError`
*   **`getSquare(env)`:** the lazy `import('square')` and client, moved from
    checkout. Returns `{ client, locationId }`.
*   **`squareErrorMessage(err)`:** duck-typed, returning
    `Array.isArray(err?.errors) ? err.errors[0]?.detail : …`. It doesn't use
    `instanceof`, because the SDK is imported lazily.
*   **`isSquareNotFound(err)`:** true when `err.statusCode === 404`.
*   **`getStudioTimeZone(db)`:** reads `Admin_Settings.timezone` (default
    `America/New_York`). `admin.ts`'s `studioToday` is rewritten to use this
    plus `dateInTimeZone`, and `addOneDay` uses `addDaysISO`.
*   **Loaders:**
    - `loadBookingTotals(db, id)`: moved from `admin.ts`, and also sums
      `Booking_Charges`.
    - `loadBilling(db, id)`: D1 only.
    - `toInvoiceJSON(row, today)`
    - `toChargeJSON(row)`
*   **Flow functions:**
    - `ensureCustomer`, `sendBalanceInvoice(db, env, bookingId,
      expectedCents)`: Flow 2.
    - `cancelOpenInvoice(db, env, bookingId)`: Flow 4. Returns
      `{ invoice | null }` or throws `BillingError`.
    - `resolveStaleSends(db, env, bookingId)`: Flow 5. Returns
      `{ stale: boolean }`.
    - `fetchAndSyncInvoice(db, env, squareInvoiceId, requestOptions?)`
    - `syncInvoice(db, invoice, timeZone)`: Flow 3. Reads both camelCase and
      snake_case field names.
*   **Lock helper:** the `OPEN_INVOICE_EXISTS_SQL` snippet used by every lock.

#### 4. `backend/src/routes/squareWebhook.ts` (Create)

*   A Hono router with `POST /` implementing Flow 6. Logs use
    `console.warn`/`console.error` with the event id only, never the body.

#### 5. `backend/src/routes/checkout.ts` (Modify)

*   Flow 1. Use `getSquare`, so the inline client setup is removed. Charge,
    verify and refund `depositCents`.
*   The insert adds `deposit_percent`. Replace the "full price" comment at line
    296.
*   Add the new response fields, both at the top level and under `data`.

#### 6. `backend/src/routes/admin.ts` (Modify)

*   **Migration.** Add `ALTER TABLE Bookings ADD COLUMN deposit_percent
    INTEGER` to `alterStatements`. Add `deposit_percent` to:
    - `BOOKINGS_REBUILD_COLUMNS`;
    - the `Bookings_new` CREATE;
    - both column lists of the INSERT…SELECT.

    Then, after the existing `Booking_Payments` CREATE, run in this order:
    ```sql
    ALTER TABLE Booking_Payments ADD COLUMN square_invoice_id TEXT;   -- errors ignored (already exists)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_square_invoice ON Booking_Payments(square_invoice_id);
    CREATE TABLE IF NOT EXISTS Booking_Charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 120),
      amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_booking_charges_booking ON Booking_Charges(booking_id);
    CREATE TABLE IF NOT EXISTS Booking_Invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      attempt_key TEXT NOT NULL UNIQUE,
      square_invoice_id TEXT UNIQUE,
      square_order_id TEXT,
      invoice_number TEXT,
      version INTEGER,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      public_url TEXT,
      due_date TEXT,                       -- YYYY-MM-DD
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_open ON Booking_Invoices(booking_id)
      WHERE status IN ('CREATING','DRAFT','UNPAID','SCHEDULED','PARTIALLY_PAID','PAYMENT_PENDING');
    ```
    - No REFERENCES clauses, for the same reason as `Booking_Payments`: rows
      must never block a Bookings rebuild.
    - `schemaInitialized = true` only after `Booking_Payments`, both new tables
      and all three new indexes exist. The payments column is confirmed with
      `PRAGMA table_info`.
*   **Totals.** Import `bookingTotalCents` and `computeTotals` from
    billingMath, and delete the local copies. Update both callers of
    `computeTotals` (line 1157, now in `loadBookingTotals`, and line 1840).
*   **`GET /bookings`:**
    - Add a `Booking_Charges` sum subquery.
    - Return `base_cents`, `charges_cents` and `deposit_percent`.
    - `total_cents` becomes base + charges.
    - `price` and `totalPrice` stay the base, in dollars. That is today's
      value, so nothing that reads them changes.
*   **`PUT /bookings/:id`.** Order: validation, then 404, then (only if the
    status becomes cancelled) `cancelOpenInvoice` with any `BillingError`
    mapped to its code, then the guarded UPDATE.
    - Work out `beforeBase` and `afterBase` with `bookingTotalCents` (using the
      joined package price).
    - If base, `deposit_paid` or `service_id` changes, the UPDATE carries
      `AND NOT EXISTS (open)`. If `changes = 0`, return 409 `INVOICE_OPEN`.
      This is the lock; there is no separate check.
    - A cancel that also changes the price works, because the invoice was
      withdrawn first.
*   **`PATCH /bookings/:id/cancel` and `DELETE /bookings/:id`:** call
    `cancelOpenInvoice` first. The delete batch also removes the booking's
    `Booking_Charges` and `Booking_Invoices` rows.
*   **Payments:**
    - `POST` adds `AND NOT EXISTS (open)` to its conditional insert, then tells
      the cases apart: 404, then 409 `BOOKING_CANCELLED`, then 409
      `INVOICE_OPEN`.
    - `DELETE` does the same lock, and returns 409 `SQUARE_INVOICE_PAYMENT` when
      the linked invoice is PAID.
    - `GET` selects `square_invoice_id`, and `toPayment` exposes it plus
      `removable`.
*   **New routes** (with `Cache-Control: no-store`):
    - `GET /bookings/:id/billing`: Flow 7.
    - `POST /bookings/:id/charges`, body `{ description, amount }`:
      - Validate: the description is trimmed and must be 1–120 characters; the
        amount uses the money rule.
      - Then 404, then `BOOKING_CANCELLED`, then the atomic insert (409
        `INVOICE_OPEN`).
      - Returns 201 `{ charge, totals }`.
    - `DELETE /bookings/:id/charges/:chargeId`: atomic delete with the lock.
      Returns 404 or 409, or 200 `{ totals }`.
    - `POST /bookings/:id/invoice`: `sendBalanceInvoice`. Returns 200
      `{ invoice, totals }`.
    - `POST /bookings/:id/invoice/cancel`: `cancelOpenInvoice`. If it returns
      null, 404 `NO_OPEN_INVOICE`. Otherwise 200 `{ invoice, totals }`.
*   **Pricing:**
    - `handleGetPricing`'s fallback becomes `DEFAULT_DEPOSIT_PERCENT`.
    - `handleUpdatePricing` uses `normalizeDepositPercent`. This changes
      today's behaviour: an out-of-range value used to fall back to 50
      (`admin.ts:1910-1912`), and now it is clamped to 1–100. A saved 0 becomes
      1, and an invalid value becomes 60.
    - The stored row is not rewritten (owner's decision).

#### 7. `backend/schema.sql` (Modify)

*   Add `DROP TABLE IF EXISTS Booking_Charges; DROP TABLE IF EXISTS
    Booking_Invoices;` before the Bookings drop.
*   Add the Bookings `deposit_percent` column, the `Booking_Payments.square_invoice_id`
    column, the two new tables and all three new indexes, using the same DDL as
    #6.
*   Seed `"depositPercent":60`. This affects fresh databases only.

#### 8. `backend/test/billingMath.test.ts`, `backend/test/billingDb.test.ts` (Create); `backend/package.json` (Modify)

*   **`package.json`:**
    - Add the script `"test": "node --test test/*.test.ts"`. Node expands the
      glob itself, including on Windows.
    - Change `engines.node` to `">=22.18.0"`, the first version that strips
      types without a flag.
    - Tests import `../src/lib/*.ts` with the extension. `tsconfig` includes
      only `src/`, so the tests aren't typechecked. That is accepted.
*   **`billingMath.test.ts`:**
    - `normalizeDepositPercent`:
      - `'60'` → 60, `59.6` → 60, `0` → 1, `150` → 100;
      - `''`, `null`, `undefined`, `'abc'`, `[]` → 60.
    - `depositFor`:
      - 50000 at 60 → {30000, 60};
      - 33333 at 60 → 20000;
      - 120 at 60 → {100, 60};
      - 80 at 60 → {80, 100};
      - 50000 at 100 → {50000, 100}.
    - `buildInvoiceLines`: the CUJ 2 lines; balance < charges gives one line;
      zero session remainder drops that line; a table loop checks that the sum
      always equals the balance.
    - `computeTotals`: with and without charges, overpaid, the dollar twins.
    - `invoiceStatusLabel`: every row of the table, plus UNPAID before and after
      the due date.
    - `addDaysISO` across a month and a year boundary; `dateInTimeZone` with a
      fixed instant and an invalid zone.
    - `verifySquareSignature`: a good signature computed with `node:crypto`; a
      tampered body; the wrong URL; an empty signature.
*   **`billingDb.test.ts`:** uses a 40-line D1 stand-in over `node:sqlite`
    (`prepare`/`bind`/`first`/`all`/`run`/`batch`). It loads the existing
    `BOOKING_PAYMENTS_TABLE_SQL` first, then the DDL from #6. To make that
    possible, these DDL strings move to an exported `lib/billingSchema.ts`,
    which `admin.ts` imports.
    - `syncInvoice` run twice on a PAID invoice gives 1 payment row.
    - An older version doesn't overwrite a newer status.
    - A REFUNDED invoice with collected > 0 records the payment.
    - A second `CREATING` insert for the same booking fails with
      `UNIQUE constraint failed`.
    - The atomic charge insert is refused while an invoice is open and allowed
      after it is cancelled.

#### 9. `backend/src/index.ts` (Modify)

*   Add `SQUARE_WEBHOOK_SIGNATURE_KEY?` and `SQUARE_WEBHOOK_URL?` to `Bindings`.
*   Add `app.route('/api/square/webhook', squareWebhookRouter)` beside the other
    routes.

#### 10. `backend/wrangler.toml` (Modify)

*   Add `SQUARE_WEBHOOK_URL = ""` under `[vars]`, with a comment to set it to
    `https://<deployed-domain>/api/square/webhook`. Empty means the webhook
    returns 503.
*   The signature key is set with `wrangler secret put`.

#### 11. `admin/index.html` (Modify)

*   Inside `#paySection`, after `#payForm` and before `</section>`, add:
    - **Charges:** an "Extra charges" heading, `#chargeList`, and `#chargeForm`
      (`role="group"`) with:
      - `#chargeDesc` (text, maxlength 120, required) and its error element;
      - `#chargeAmount` (decimal text, required) and its error element;
      - `#chargeAdd`;
      - `#chargeLockedNote` (hidden).
    - **Invoice:** an "Invoice" heading, `#invoiceBox` (`aria-live="polite"`),
      and the buttons `#invoiceSend`, `#invoiceCheck` and `#invoiceCancel`.
*   Add `#payLockedNote` and `#bkLockedNote` notes, both hidden.
*   Update the section hint.
*   Set `#depositPercent` `min="1"`.

#### 12. `admin/assets/js/pages/schedule.js` (Modify)

*   **Loading:** `openPayments` calls `refreshBilling()`, which replaces the
    separate `loadPayments` call on open.
    - It calls `GET /billing` with the existing `payToken`/booking-id guard.
    - It sets `billing = { charges, invoices, stale }` and `payList =
      payments`.
    - It calls `applyBillingTotals(b, totals)`, which sets:
      - `baseCents`, `chargesCents`;
      - `priceCents = total_cents`;
      - `depositCents = paid_at_booking_cents`;
      - `paymentsTotal = payments_total_cents`;
      - `paymentsCount = payments.length`.

      Then it runs `refreshBookingViews()`.

    `loadPayments` stays for Retry and for after removing a payment. Every
    charge, invoice and payment response goes through `applyBillingTotals`.
*   **`saveBookingEdit`:** line 1463 becomes `target.baseCents = round(price *
    100); target.priceCents = target.baseCents + (target.chargesCents || 0)`.
*   **Summary:** `renderPaySummary` shows the percent label and the Extra charges
    figure.
*   **`renderCharges()`:**
    - Rows show the description, the amount, and a Remove button
      (`data-remove-charge`).
    - Empty state: "No extra charges."
    - `addCharge()` reuses `PAY_AMOUNT_RE`, `payRules.amount` and
      `clearPayError`, with a new rule for the description (1–120 characters
      after trimming).
    - Pressing Enter in `#chargeForm` adds the charge.
    - Remove asks `confirmDanger('Remove this charge?', '<desc> <amount> will
      come off the balance.', 'Remove charge', go)`.
*   **`renderInvoice()`:** the state table below. Due dates are formatted from
    `YYYY-MM-DD` as a local date with `Intl.DateTimeFormat('en-US', { month:
    'short', day: 'numeric' })`. The link uses `target="_blank" rel="noopener
    noreferrer"`. The history shows the 5 most recent invoices other than the
    current one, as "label · amount · date".
*   **Button state:**
    - While a request is running, the button that started it is disabled and
      reads "Sending…", "Cancelling…" or "Checking…".
    - The valid-email check reuses `formValidation`'s email rule.
*   **Sending:**
    - `sendInvoice()` asks `confirmSendInvoice(fmt(balance), email)`, then POSTs
      `{ expected_amount_cents: balanceCents }`.
    - On `BALANCE_CHANGED` it runs `refreshBilling()` and shows a toast: "The
      balance changed to $X. Review and send again."
    - `cancelInvoice()` asks `confirmCancelInvoice()`. `#invoiceCheck` runs
      `refreshBilling()`.
*   **Error toasts:** show the server's `message`, the same as the existing
    payment code.
*   **`payRowHTML`:** if `p.square_invoice_id` is set, show "via Square
    invoice". The Remove button appears only when `p.removable`.
*   **Locks:** when an invoice is open, disable `#bkPrice`, `#bkDeposit`,
    `#bkPackage`, the charge form and the payment form, and show the locked
    notes: "An invoice is out for this booking. Cancel it to change amounts."
*   **Down payment fallback:** in `getDepositRate` (line 1492), change the
    fallback from 50 to 60 and clamp the result to 1–100.

**Invoice block states:**

| State | Box shows | Send | Check status | Cancel |
|---|---|---|---|---|
| Loading | skeleton (`loadingHTML(2)`) | disabled | hidden | hidden |
| Load error | error with a Retry button | disabled | hidden | hidden |
| No invoices | "No invoice sent yet." | enabled if balance > 0, not cancelled, and email valid. Otherwise disabled with a hint (e.g. "Add a client email to send an invoice.") | hidden | hidden |
| CREATING | "Sending…" | disabled | shown | hidden |
| Open (DRAFT/UNPAID/Overdue/SCHEDULED/PARTIALLY_PAID) | label · amount · due date · View invoice link | disabled | shown | shown |
| PAYMENT_PENDING | label · amount | disabled | shown | hidden |
| Latest is closed (PAID/CANCELED/FAILED/refunded) | label · amount, then history | as in "No invoices" | shown | hidden |
| `stale: true` | an extra note: "Couldn't reach Square. Showing the last saved status." | unchanged | shown | unchanged |

#### 13. `admin/assets/js/app.js` and `admin/assets/js/state.js` (Modify)

*   `mapBooking` adds:
    - `baseCents = base_cents ?? round(price × 100)`;
    - `chargesCents = charges_cents ?? 0`;
    - `depositPercent = deposit_percent ?? null`.

    `priceCents` stays `total_cents` first.
*   Change the 50 defaults to 60: `app.js:308` and the literal at
    `state.js:49`.

#### 14. `admin/assets/js/components/formValidation.js` and `admin/assets/js/pages/payments.js` (Modify)

*   `formValidation`: the percent rule and `isValidPercentage` become 1–100,
    with the message "Enter a whole number from 1 to 100" (lines 35–38,
    122–126).
*   `payments.js`: `pricingIsInvalid` (line 180) rejects a deposit percent below
    1. The deposit example (line 172) uses a fallback of 60.

#### 15. `admin/assets/js/api/bookingsApi.js` and `admin/assets/js/components/confirmation.js` (Modify)

*   **`bookingsApi.js`:** add the following, in the same style as `addPayment`:
    - `getBilling(id)`
    - `addCharge(id, { description, amount })`
    - `removeCharge(id, chargeId)`
    - `sendInvoice(id, expectedCents)`
    - `cancelInvoice(id)`
*   **`confirmation.js`:**
    - `confirmSendInvoice(amountText, email, onConfirm)` (confirmChange):
      title "Send invoice?", text "Square will email a <amount> invoice to
      <email>, due in 7 days.", button "Send invoice".
    - `confirmCancelInvoice(onConfirm)` (confirmDanger): title "Cancel this
      invoice?", text "The client's invoice link will stop working.", button
      "Cancel invoice", keep label "Keep invoice".

#### 16. `admin/assets/css/pages/schedule.css` (Modify)

*   Rules for `#chargeList`, `#invoiceBox` and the invoice history, reusing the
    existing `.pay__row`, `.tag` and `.refund-note` styles and the tokens from
    `tokens.css`. No new colour values.

#### 17. `backend/public/admin/**` (Regenerate)

*   `pnpm --dir backend run sync-admin` after #11–#16. This copies the files,
    minifies the JS and CSS, and skips `.md` files. Not edited by hand.

#### 18. `admin/README.md`, `README.md` (Modify)

*   **`admin/README.md`:**
    - Rewrite the totals paragraph (line 155). Checkout stores the deposit, and
      total = base + charges.
    - Document the new dialog blocks, the status table, the locks, the 7 new or
      changed routes, and the error codes.
*   **`README.md`:**
    - Add the env vars.
    - Add "Square webhook setup": in the Developer dashboard, go to Webhooks,
      add the subscription URL, select `invoice.payment_made`,
      `invoice.updated` and `invoice.canceled`, copy the signature key, then run
      `wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY` and set
      `SQUARE_WEBHOOK_URL`.
    - Add the rollout and rollback checklists from the NFRs.

### Verification Plan

*   **Typecheck:** `pnpm --dir backend run typecheck` exits 0.
*   **Unit and DB tests:** `pnpm --dir backend test` reports all passing.
*   **Build:** `pnpm --dir backend run sync-admin` exits 0. The command
    `git diff --no-index --stat admin/index.html backend/public/admin/index.html`
    shows only minification differences, and every changed JS/CSS file in
    `admin/` exists in `backend/public/admin/`.
*   **Local smoke**:
    - **Setup:** `pnpm --dir backend run db:reset`, run it a second time (it
      must also succeed), then `pnpm --dir backend run dev`. Log in at
      `http://localhost:8787/admin/`.
    - In the admin site:
      1. Create a manual booking: Portrait, client email, price $500, paid at
         booking $300.
      2. Add the charge "Overtime – 1 hr" $75. Expected: Total $575, Balance
         $275.
      3. Click Save changes. Expected: Total stays $575, which checks the fix at
         `schedule.js:1463`.
      4. Remove the charge. Expected: Balance $200.
      5. Click Send invoice. Expected: toast "Square isn't set up on the
         server." (503).
    - Lock check without Square: insert an open invoice row by hand with
      `wrangler d1 execute r59_db --local --command "INSERT INTO
      Booking_Invoices (booking_id, attempt_key, status, amount_cents) VALUES
      (1,'test-key','UNPAID',20000)"`, then reopen the booking. Expected: the
      price, deposit and charge fields are locked, and adding a charge or
      payment through the API returns 409 `INVOICE_OPEN`. The CREATING
      placeholder checks are covered by the unit tests in `billingDb.test.ts`.
    - Invoice-payment removal: insert `Booking_Invoices` status `PAID` with
      `square_invoice_id 'inv-test'`, and `Booking_Payments` with
      `square_invoice_id 'inv-test'`. Expected: DELETE returns 409
      `SQUARE_INVOICE_PAYMENT`, and the UI shows no Remove button.
    - Webhook, without the variables set:
      `curl -i -X POST localhost:8787/api/square/webhook -d '{}'` returns 503.
      With dummy values in `.dev.vars` and the server restarted: the same
      request returns 401.
*   **Square sandbox** (needs the owner's sandbox `SQUARE_ACCESS_TOKEN` and
    `SQUARE_LOCATION_ID`):
    - **Setup:** expose the local Worker with `cloudflared tunnel --url
      http://localhost:8787`, or use a deployed preview. Set
      `SQUARE_WEBHOOK_URL` to exactly `<tunnel>/api/square/webhook`, and
      register that URL in the sandbox webhooks.
    - **CUJ 1:** call `POST /api/checkout` with the sandbox nonce
      `cnon:card-nonce-ok`. Expected: the Square payment is 60% of the price,
      and `Bookings.deposit_paid` and `deposit_percent` match. Change the
      percent to 50 and confirm the booking is unchanged.
    - **CUJ 2:** add the charge and send. Expected: the sandbox invoice's lines
      add up to the balance and its due date is +7 days. A second click returns
      409. Change a charge in another tab, then send from the first tab.
      Expected: 409 `BALANCE_CHANGED`.
    - **CUJ 3:** pay from the sandbox `public_url`. Expected: one payment row.
      Use Resend in Square's webhook event log twice. Expected: `SELECT COUNT(*)
      FROM Booking_Payments WHERE square_invoice_id = ?` is still 1.
    - **CUJ 4:** cancel and resend. Expected: the old invoice shows CANCELED in
      Square and "Cancelled" in the history.
    - **CUJ 5:** cancel a booking that has an open invoice. Expected: the
      invoice is CANCELED in Square, then the booking is cancelled.
    - **Email change:** edit the client email, then send. Expected: Square
      emails the invoice to the new address.
*   **Security and audit:** `security-review`, plus `pnpm audit` in `backend/`.
*   **Design check:** `npx impeccable detect admin/` (the Impeccable CLI used in
    this project's workflow) on the changed dialog.
*   **Rollout check:** after deploy, `GET /api/admin/pricing` shows the stored
    percent. Set it to 60 in the admin site, then send a test event from the
    Square dashboard. Expected: 200.

--------------------------------------------------------------------------------

*Drafted with EGM*
