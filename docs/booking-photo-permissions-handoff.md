# Booking photo permissions: backend and database pending work

## Frontend delivered

Summary now contains two independent, optional checkboxes, initially unchecked:
- `photoPermissions.websitePortfolio`: permission to feature photos of the customer from this session on the R59MEDIA website and portfolio.
- `photoPermissions.socialMedia`: permission to share photos of the customer from this session on R59MEDIA social media accounts.

Both may remain false without blocking booking. Choices remain in the in-memory booking flow when navigating back to edit details. Reloading or remounting the flow resets them to false. They are not saved in browser storage. Controls are disabled while the deposit callback is pending; choices survive callback errors.

The existing `onProceedToDeposit` callback receives these values in `BookingReviewDraft`, with `photoPermissionTextVersion` set to `2026-11-11-v1`. This is a frontend handoff only, not a persisted authorization record. No endpoint, backend, database, or payment integration was changed.

## Pending backend and database responsibilities

- Accept and validate the two independent choices through the booking/deposit integration. Missing or invalid permission must never imply authorization.
- Persist the choices against the correct booking and customer, including explicit non-authorization.
- Record trustworthy acceptance timing and the exact accepted wording/version; a client-provided version alone is not an authoritative record.
- Preserve choices through payment attempts, failures, retries, and booking confirmation without changing them implicitly.
- Make recorded permissions available to authorized staff reviewing or selecting photos for publication.
- Ensure publication decisions respect the separately authorized channels. Booking or payment completion alone does not authorize promotional use.
- Account for existing bookings without permission records; do not treat them as opted in.
- Support permission changes, withdrawal requests, and a traceable history; define handling of already published material.
- Define and support authorization for minors, guardians, and other identifiable participants. One customer's selection does not grant permission for everyone pictured.
- Finalize the approved release wording, applicable policy, and customer contact process before relying on this UI as a complete authorization workflow. Paid advertising, sale, and third-party licensing are excluded from the current choices.
- Determine the appropriate retention, access controls, and customer confirmation requirements for these records.

## Relevant frontend files

- `frontend/src/sections/booking/BookingSummary.tsx`
- `frontend/src/sections/booking/BookingSection.tsx`
- `frontend/src/types/booking.ts`
- `frontend/src/sections/booking/BookingSection.css`

No backend endpoint or database schema is prescribed by this handoff. Those decisions remain with the backend and database team.
