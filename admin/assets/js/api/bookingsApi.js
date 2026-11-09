/**
 * R59 Media Admin — Bookings API Service
 *
 * Integration layer for booking retrieval, creation, updates, and cancellations.
 * Connected to Cloudflare Workers /admin/bookings backend route.
 */
import { apiClient } from './apiClient';
const getClient = () => {
    if (typeof window !== 'undefined' && window.R59?.apiClient) {
        return window.R59.apiClient;
    }
    return apiClient;
};
export const bookingsApi = {
    /**
     * Retrieve list of bookings from backend.
     * Established backend endpoint: GET /admin/bookings?limit=&offset=
     */
    async getBookings({ limit = 50, offset = 0 } = {}) {
        const data = await getClient().get('/admin/bookings', { limit, offset });
        return data;
    },
    /**
     * Create a new booking.
     * Note: Pending backend endpoint agreement for manual admin booking creation.
     */
    async createBooking(bookingPayload) {
        return await getClient().post('/admin/bookings', bookingPayload);
    },
    /**
     * Update an existing booking.
     * Note: Pending backend endpoint agreement.
     */
    async updateBooking(id, bookingPayload) {
        return await getClient().put(`/admin/bookings/${id}`, bookingPayload);
    },
    /**
     * Cancel an existing booking.
     * Note: Pending backend endpoint agreement.
     */
    async cancelBooking(id) {
        return await getClient().patch(`/admin/bookings/${id}/cancel`, {});
    },
    /**
     * Permanently delete a cancelled booking record.
     * Note: Pending backend endpoint agreement.
     */
    async deleteBooking(id) {
        return await getClient().delete(`/admin/bookings/${id}`);
    }
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.bookingsApi = bookingsApi;
    window.R59.api = window.R59.api || {};
    window.R59.api.bookings = bookingsApi;
}
export default bookingsApi;
