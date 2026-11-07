/**
 * R59 Media Admin — Schedule API Service
 *
 * Weekly availability (a setting, saved through the unsaved bar) and blocked dates (records)
 * against the Worker's /admin/availability and /admin/blocked-dates routes. Every function
 * rejects on an HTTP or network failure so the caller can mark the area failed or report it.
 */

(function () {
  'use strict';

  const client = () => window.R59.apiClient;

  const scheduleApi = {
    /** Weekly availability: GET /admin/availability → [{ day, available, timeframes }] */
    async getWeeklyAvailability() {
      const res = await client().get('/admin/availability');
      if (res && Array.isArray(res.availability)) return res.availability;
      if (res && Array.isArray(res.data)) return res.data;
      return null;
    },

    /** Replace the weekly availability: PUT /admin/availability */
    async saveWeeklyAvailability(availability) {
      return client().put('/admin/availability', { availability });
    },

    /** Blocked dates: GET /admin/blocked-dates → [{ id, date, dateStr, reason }] */
    async getBlockedDates() {
      const res = await client().get('/admin/blocked-dates');
      if (res && Array.isArray(res.blockedDates)) return res.blockedDates;
      if (res && Array.isArray(res.data)) return res.data;
      return null;
    },

    /** Block a date: POST /admin/blocked-dates → { id, date, dateStr, reason } */
    async addBlockedDate({ date, reason }) {
      return client().post('/admin/blocked-dates', { date, reason });
    },

    /** Unblock a date: DELETE /admin/blocked-dates/:id */
    async removeBlockedDate(id) {
      return client().delete(`/admin/blocked-dates/${encodeURIComponent(id)}`);
    }
  };

  window.R59 = window.R59 || {};
  window.R59.scheduleApi = scheduleApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.schedule = scheduleApi;
})();
