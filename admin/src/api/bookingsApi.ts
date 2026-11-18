// @ts-nocheck
/**
 * R59 Media Admin — Bookings API Service
 *
 * Booking retrieval, creation, updates, cancellation and deletion against the Worker's
 * /admin/bookings routes. Every function rejects on an HTTP or network failure
 * (err.message = server message, err.status, err.isNetworkError) so callers can report it.
 */

(function () {
  'use strict';

  const PAGE_SIZE = 100; // the backend caps one page at 100 rows
  const MAX_PAGES = 50;

  const client = () => window.R59.apiClient;

  const bookingsApi = {
    /**
     * One page of bookings: GET /admin/bookings?limit=&offset=
     * Resolves the raw response ({ bookings, limit, offset, data }).
     */
    async getBookings({ limit = PAGE_SIZE, offset = 0 } = {}) {
      return client().get('/admin/bookings', { limit, offset });
    },

    /**
     * Every booking, paging through GET /admin/bookings 100 at a time until a page comes back
     * with fewer than 100 rows (at most 50 pages). Resolves an array of raw booking rows.
     */
    async getAllBookings() {
      const all = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await bookingsApi.getBookings({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
        const rows = res && (Array.isArray(res.bookings) ? res.bookings : res.data);
        if (!Array.isArray(rows)) throw new Error('The server sent an unexpected booking list.');
        all.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }
      return all;
    },

    /** Create a manual booking: POST /admin/bookings → { id, data: { id, slot_id } } */
    async createBooking(bookingPayload) {
      return client().post('/admin/bookings', bookingPayload);
    },

    /** Update a booking: PUT /admin/bookings/:id */
    async updateBooking(id, bookingPayload) {
      return client().put(`/admin/bookings/${encodeURIComponent(id)}`, bookingPayload);
    },

    /** Cancel a booking and release its slot: PATCH /admin/bookings/:id/cancel */
    async cancelBooking(id) {
      return client().patch(`/admin/bookings/${encodeURIComponent(id)}/cancel`, { refund: true });
    },

    /** Permanently delete a booking: DELETE /admin/bookings/:id */
    async deleteBooking(id) {
      return client().delete(`/admin/bookings/${encodeURIComponent(id)}`);
    },

    /**
     * Payments recorded on a booking: GET /admin/bookings/:id/payments
     * Resolves { payments: [{ id, amount_cents, amount, method, paid_on, note, created_at }], totals }.
     */
    async getPayments(bookingId) {
      return client().get(`/admin/bookings/${encodeURIComponent(bookingId)}/payments`);
    },

    /**
     * Record a payment: POST /admin/bookings/:id/payments
     * `amount` is the dollar string the admin typed (already checked against /^\d{1,7}(\.\d{1,2})?$/).
     * Resolves { payment, totals }. A cancelled booking answers 409.
     */
    async addPayment(bookingId, { amount, method, paid_on, note } = {}) {
      return client().post(`/admin/bookings/${encodeURIComponent(bookingId)}/payments`, { amount, method, paid_on, note });
    },

    /** Remove one recorded payment: DELETE /admin/bookings/:id/payments/:paymentId → { totals } */
    async removePayment(bookingId, paymentId) {
      return client().delete(`/admin/bookings/${encodeURIComponent(bookingId)}/payments/${encodeURIComponent(paymentId)}`);
    },

    /** Charges, totals and invoice state for a booking (re-checks a sending/open invoice with Square): GET /admin/bookings/:id/billing */
    async getBilling(bookingId) {
      return client().get(`/admin/bookings/${encodeURIComponent(bookingId)}/billing`);
    },

    /**
     * Add an extra charge: POST /admin/bookings/:id/charges
     * `amount` is the dollar string the admin typed (already checked against /^\d{1,7}(\.\d{1,2})?$/).
     */
    async addCharge(bookingId, { description, amount } = {}) {
      return client().post(`/admin/bookings/${encodeURIComponent(bookingId)}/charges`, { description, amount });
    },

    /** Remove one extra charge: DELETE /admin/bookings/:id/charges/:chargeId */
    async removeCharge(bookingId, chargeId) {
      return client().delete(`/admin/bookings/${encodeURIComponent(bookingId)}/charges/${encodeURIComponent(chargeId)}`);
    },

    /**
     * Send the balance invoice through Square: POST /admin/bookings/:id/invoice
     * `expectedCents` is the balance the admin saw; the server rejects the send if it no longer matches.
     */
    async sendInvoice(bookingId, expectedCents) {
      return client().post(`/admin/bookings/${encodeURIComponent(bookingId)}/invoice`, { expected_amount_cents: expectedCents });
    },

    /** Cancel the open invoice: POST /admin/bookings/:id/invoice/cancel */
    async cancelInvoice(bookingId) {
      return client().post(`/admin/bookings/${encodeURIComponent(bookingId)}/invoice/cancel`, {});
    },

    /**
     * Push the balance checkout to a Square Terminal device: POST /admin/bookings/:id/terminal-checkout
     */
    async sendTerminalCheckout(bookingId, expectedAmountCents, deviceId) {
      const payload = { expected_amount_cents: expectedAmountCents };
      if (deviceId) payload.device_id = deviceId;
      return client().post(`/admin/bookings/${encodeURIComponent(bookingId)}/terminal-checkout`, payload);
    },

    /**
     * Fetch Google Calendar / ICS live feed configuration: GET /admin/calendar-feed
     */
    async fetchCalendarFeedConfig() {
      return client().get('/admin/calendar-feed');
    },

    /**
     * Trigger real-time Google Calendar backfill sync: POST /admin/calendar-sync
     */
    async syncAllToGoogleCalendar() {
      return client().post('/admin/calendar-sync', {});
    }
  };

  window.R59 = window.R59 || {};
  window.R59.bookingsApi = bookingsApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.bookings = bookingsApi;
})();
