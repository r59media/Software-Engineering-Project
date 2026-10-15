/**
 * R59 Media Admin — Bookings API Service
 * 
 * Integration layer for booking retrieval, creation, updates, and cancellations.
 * Connected to Cloudflare Workers /admin/bookings backend route.
 */

(function () {
  'use strict';

  const client = window.R59?.apiClient;

  const bookingsApi = {
    /**
     * Retrieve list of bookings from backend.
     * Established backend endpoint: GET /admin/bookings?limit=&offset=
     */
    async getBookings({ limit = 50, offset = 0 } = {}) {
      const data = await window.R59.apiClient.get('/admin/bookings', { limit, offset });
      return data;
    },

    /**
     * Create a new booking.
     * Note: Pending backend endpoint agreement for manual admin booking creation.
     */
    async createBooking(bookingPayload) {
      return await window.R59.apiClient.post('/admin/bookings', bookingPayload);
    },

    /**
     * Update an existing booking.
     * Note: Pending backend endpoint agreement.
     */
    async updateBooking(id, bookingPayload) {
      return await window.R59.apiClient.put(`/admin/bookings/${id}`, bookingPayload);
    },

    /**
     * Cancel an existing booking.
     * Note: Pending backend endpoint agreement.
     */
    async cancelBooking(id) {
      return await window.R59.apiClient.patch(`/admin/bookings/${id}/cancel`, {});
    },

    /**
     * Permanently delete a cancelled booking record.
     * Note: Pending backend endpoint agreement.
     */
    async deleteBooking(id) {
      return await window.R59.apiClient.delete(`/admin/bookings/${id}`);
    }
  };

  window.R59 = window.R59 || {};
  window.R59.bookingsApi = bookingsApi;
})();
