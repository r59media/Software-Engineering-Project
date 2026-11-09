/**
 * R59 Media Admin — Schedule & Availability API Service
 *
 * Integration layer for schedule slots, weekly availability, and blocked dates.
 * Connected to Cloudflare Workers /schedule and /admin/schedule backend routes.
 */
import { apiClient } from './apiClient';
const getClient = () => {
    if (typeof window !== 'undefined' && window.R59?.apiClient) {
        return window.R59.apiClient;
    }
    return apiClient;
};
export const scheduleApi = {
    /**
     * Fetch available schedule slots.
     * Established backend endpoint: GET /schedule
     */
    async getSlots({ limit = 100, offset = 0 } = {}) {
        const data = await getClient().get('/schedule', { limit, offset });
        return (data && data.slots) || [];
    },
    /**
     * Create a new available timeslot.
     * Established backend endpoint: POST /admin/schedule
     */
    async createSlot({ date, startTime, endTime }) {
        return await getClient().post('/admin/schedule', {
            date,
            start_time: startTime,
            end_time: endTime
        });
    },
    /**
     * Delete an unbooked timeslot.
     * Established backend endpoint: DELETE /admin/schedule/:id
     */
    async deleteSlot(id) {
        return await getClient().delete(`/admin/schedule/${id}`);
    },
    /**
     * Fetch weekly recurring availability rules.
     * [Pending Agreement]: Proposed endpoint GET /admin/availability
     */
    async getWeeklyAvailability() {
        try {
            const res = await getClient().get('/admin/availability');
            return res?.availability || null;
        }
        catch {
            return null;
        }
    },
    /**
     * Save weekly recurring availability rules.
     * [Pending Agreement]: Proposed endpoint PUT /admin/availability
     */
    async saveWeeklyAvailability(availability) {
        return await getClient().put('/admin/availability', { availability });
    },
    /**
     * Fetch blocked calendar dates.
     * [Pending Agreement]: Proposed endpoint GET /admin/blocked-dates
     */
    async getBlockedDates() {
        try {
            const res = await getClient().get('/admin/blocked-dates');
            return res?.blockedDates || [];
        }
        catch {
            return [];
        }
    },
    /**
     * Add a blocked calendar date.
     * [Pending Agreement]: Proposed endpoint POST /admin/blocked-dates
     */
    async addBlockedDate({ date, reason }) {
        return await getClient().post('/admin/blocked-dates', { date, reason });
    },
    /**
     * Remove a blocked date.
     * [Pending Agreement]: Proposed endpoint DELETE /admin/blocked-dates/:id
     */
    async removeBlockedDate(id) {
        return await getClient().delete(`/admin/blocked-dates/${id}`);
    }
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.scheduleApi = scheduleApi;
    window.R59.api = window.R59.api || {};
    window.R59.api.schedule = scheduleApi;
}
export default scheduleApi;
