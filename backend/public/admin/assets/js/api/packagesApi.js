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
     * Fetch all active photography packages/services.
     * Established backend endpoint: GET /services
     */
    async getPackages() {
      const data = await window.R59.apiClient.get('/services');
      // Backend returns { services: [{ id, name, description, price (cents), duration_minutes, ... }] }
      return (data && data.services) || [];
    },

    /**
     * Create a new photography package.
     * Established backend endpoint: POST /services
     * Note: Backend stores price in cents.
     */
    async createPackage({ name, description, price, durationMinutes = 60 }) {
      const payload = {
        name,
        description: description || '',
        price: Math.round(Number(price) * 100), // convert dollars to cents
        duration_minutes: Number(durationMinutes)
      };
      return await window.R59.apiClient.post('/services', payload);
    },

    /**
     * Update an existing package.
     * Established backend endpoint: PUT /services/:id
     */
    async updatePackage(id, { name, description, price, durationMinutes, isActive = true }) {
      const payload = {};
      if (name !== undefined) payload.name = name;
      if (description !== undefined) payload.description = description;
      if (price !== undefined) payload.price = Math.round(Number(price) * 100);
      if (durationMinutes !== undefined) payload.duration_minutes = Number(durationMinutes);
      if (isActive !== undefined) payload.is_active = isActive ? 1 : 0;

      return await window.R59.apiClient.put(`/services/${id}`, payload);
    },

    /**
     * Remove / deactivate a package.
     * Note: Pending backend endpoint agreement (deactivation via PUT /services/:id or DELETE).
     */
    async deletePackage(id) {
      // Backend currently supports deactivating via PUT or pending DELETE route
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
})();
