/**
 * R59 Media Admin — Packages (Services) API Service
 * 
 * Integration layer for photography package management.
 * Connected to Cloudflare Workers /services backend routes.
 */

(function () {
  'use strict';

  const packagesApi = {
    /**
     * Fetch all photography packages/services (including inactive ones for admin).
     * Established backend endpoint: GET /services?all=true
     */
    async getPackages() {
      const data = await window.R59.apiClient.get('/services?all=true');
      // Backend returns { services: [{ id, name, description, price (cents), duration_minutes, ... }] }
      return (data && data.services) || [];
    },

    /**
     * Create a new photography package.
     * Established backend endpoint: POST /services
     * Note: Backend stores price in cents.
     */
    async createPackage(data = {}) {
      const resolvedName = data.name ?? data.title ?? 'New Package';
      const resolvedDuration = data.duration_minutes ?? data.durationMinutes ?? 60;
      const resolvedActive = data.is_active !== undefined ? (data.is_active ? 1 : 0) : (data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1);
      const isCentsPayload = data.priceInCents !== undefined || data.duration_minutes !== undefined || data.is_active !== undefined || data.title !== undefined;
      const resolvedPrice = data.priceInCents !== undefined
        ? Math.round(Number(data.priceInCents) || 0)
        : (isCentsPayload ? Math.round(Number(data.price) || 0) : Math.round((Number(data.price) || 0) * 100));

      const payload = {
        name: resolvedName,
        title: resolvedName,
        description: data.description || '',
        price: resolvedPrice,
        duration_minutes: Number(resolvedDuration) || 60,
        category: data.category || 'General',
        is_active: resolvedActive
      };
      return await window.R59.apiClient.post('/services', payload);
    },

    /**
     * Update an existing package.
     * Established backend endpoint: PUT /services/:id
     */
    async updatePackage(id, data = {}) {
      const payload = {};
      const resolvedName = data.name ?? data.title;
      if (resolvedName !== undefined) {
        payload.name = resolvedName;
        payload.title = resolvedName;
      }
      if (data.description !== undefined) payload.description = data.description;
      if (data.price !== undefined || data.priceInCents !== undefined) {
        const isCentsPayload = data.priceInCents !== undefined || data.duration_minutes !== undefined || data.is_active !== undefined || data.title !== undefined;
        payload.price = data.priceInCents !== undefined
          ? Math.round(Number(data.priceInCents) || 0)
          : (isCentsPayload ? Math.round(Number(data.price) || 0) : Math.round((Number(data.price) || 0) * 100));
      }
      const resolvedDuration = data.duration_minutes ?? data.durationMinutes;
      if (resolvedDuration !== undefined) payload.duration_minutes = Number(resolvedDuration) || 60;
      if (data.category !== undefined) payload.category = data.category;
      if (data.is_active !== undefined) {
        payload.is_active = data.is_active ? 1 : 0;
      } else if (data.isActive !== undefined) {
        payload.is_active = data.isActive ? 1 : 0;
      }

      return await window.R59.apiClient.put(`/services/${id}`, payload);
    },

    /**
     * Remove / deactivate a package.
     */
    async deletePackage(id) {
      try {
        return await window.R59.apiClient.delete(`/services/${id}`);
      } catch (err) {
        // Fallback to setting is_active = 0
        return await window.R59.apiClient.put(`/services/${id}`, { is_active: 0 });
      }
    }
  };

  window.R59 = window.R59 || {};
  window.R59.packagesApi = packagesApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.packages = packagesApi;
})();
