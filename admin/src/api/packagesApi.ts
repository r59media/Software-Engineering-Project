// @ts-nocheck
/**
 * R59 Media Admin — Packages (Services) API Service
 *
 * Integration layer for photography package management (Cloudflare Workers /services routes).
 *
 * Units: the backend stores prices in cents. Callers pass `price` in DOLLARS; pass
 * `priceInCents` instead when a value is already in cents. `getPackages()` returns the
 * raw services (price in cents); app.js converts them to dollars for state.
 *
 * Every call rejects on an HTTP or network failure; nothing is swallowed here.
 */

(function () {
  'use strict';

  function toCents(data) {
    if (data.priceInCents !== undefined) return Math.round(Number(data.priceInCents) || 0);
    if (data.price !== undefined) return Math.round((Number(data.price) || 0) * 100);
    return undefined;
  }

  const activeFlag = v => (v ? 1 : 0);

  /** Number of outfits: '' or null means not set (sent as null). */
  const outfitsValue = v => (v === null || v === undefined || String(v).trim() === '' ? null : Number(v));

  const packagesApi = {
    /**
     * GET /services?all=true (includes inactive packages for the admin) → raw services, price in cents,
     * with duration_minutes, outfits (null when not set) and full_day (true for an "Entire day" package).
     */
    async getPackages() {
      const data = await window.R59.apiClient.get('/services?all=true');
      const list = data?.services ?? data?.data;
      if (!Array.isArray(list)) throw new Error('The server sent an unexpected package list.');
      return list;
    },

    /**
     * POST /services. `data`: { name, description, price ($) | priceInCents, duration_minutes, outfits, full_day, is_active }.
     * duration_minutes is the session length the admin entered (the server checks 15–1440 unless
     * full_day is true; the form sends 1440 then).
     * Resolves with the server response ({ id, data: { id, name, description, price (cents), … } }).
     */
    async createPackage(data = {}) {
      const name = String(data.name ?? data.title ?? '').trim();
      const payload = {
        name,
        title: name,
        description: data.description || '',
        price: toCents(data) ?? 0,
        duration_minutes: Number(data.duration_minutes ?? data.durationMinutes),
        outfits: outfitsValue(data.outfits),
        full_day: data.full_day === true || data.full_day === 1,
        is_active: data.is_active !== undefined
          ? activeFlag(data.is_active)
          : (data.isActive !== undefined ? activeFlag(data.isActive) : 1)
      };
      if (data.category !== undefined) payload.category = data.category;
      return await window.R59.apiClient.post('/services', payload);
    },

    /**
     * PUT /services/:id — partial: only the fields given are sent.
     * Settings save (app.js): { name, price ($), description } plus outfits, duration_minutes and
     * full_day when they changed. Availability toggle: { is_active }.
     */
    async updatePackage(id, data = {}) {
      const payload = {};
      const name = data.name ?? data.title;
      if (name !== undefined) {
        payload.name = name;
        payload.title = name;
      }
      if (data.description !== undefined) payload.description = data.description;
      const cents = toCents(data);
      if (cents !== undefined) payload.price = cents;
      const duration = data.duration_minutes ?? data.durationMinutes;
      if (duration !== undefined) payload.duration_minutes = Number(duration);
      if (data.outfits !== undefined) payload.outfits = outfitsValue(data.outfits);
      if (data.full_day !== undefined) payload.full_day = data.full_day === true || data.full_day === 1;
      if (data.category !== undefined) payload.category = data.category;
      if (data.is_active !== undefined) payload.is_active = activeFlag(data.is_active);
      else if (data.isActive !== undefined) payload.is_active = activeFlag(data.isActive);

      return await window.R59.apiClient.put(`/services/${encodeURIComponent(id)}`, payload);
    },

    /**
     * DELETE /services/:id. The server deletes the package, or deactivates it when bookings
     * or other records still point at it (it then answers 2xx with a "deactivated" message).
     */
    async deletePackage(id) {
      return await window.R59.apiClient.delete(`/services/${encodeURIComponent(id)}`);
    }
  };

  window.R59 = window.R59 || {};
  window.R59.packagesApi = packagesApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.packages = packagesApi;
})();
