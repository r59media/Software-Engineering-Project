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
      const rawServices = (data && data.services) || [];

      const normalized = rawServices.map(s => {
        const rawPriceMinor = s.priceMinor !== undefined ? s.priceMinor : s.price;
        const priceMinor = (rawPriceMinor === null || s.price === null) ? null : Number(rawPriceMinor);
        const price = (s.price !== null && priceMinor !== null) ? (priceMinor / 100) : null;

        const rawAdd = s.additional_people !== undefined ? s.additional_people : s.additionalPeople;
        let additionalPeople = null;
        if (rawAdd) {
          if (typeof rawAdd === 'string') {
            try {
              additionalPeople = JSON.parse(rawAdd);
            } catch {
              additionalPeople = null;
            }
          } else if (typeof rawAdd === 'object') {
            additionalPeople = rawAdd;
          }
        }

        const active = s.is_active !== undefined
          ? (s.is_active !== 0 && s.is_active !== false)
          : (s.isActive !== undefined ? Boolean(s.isActive) : true);

        return {
          id: String(s.id),
          name: s.name || s.title || '',
          title: s.title || s.name || '',
          description: s.description || '',
          bestFor: s.best_for || s.bestFor || '',
          best_for: s.best_for || s.bestFor || '',
          photoCount: s.photo_count ?? s.photoCount ?? null,
          photo_count: s.photo_count ?? s.photoCount ?? null,
          outfits: s.outfits ?? null,
          price: price,
          priceMinor: priceMinor,
          durationMinutes: s.duration_minutes ?? s.durationMinutes ?? null,
          duration_minutes: s.duration_minutes ?? s.durationMinutes ?? null,
          bookingMode: s.booking_mode || s.bookingMode || 'direct',
          booking_mode: s.booking_mode || s.bookingMode || 'direct',
          additionalPeople: additionalPeople,
          additional_people: additionalPeople,
          active: active,
          is_active: active ? 1 : 0
        };
      });

      // Define custom map hook so legacy app.js mapping retains enriched fields & normalized price
      Object.defineProperty(normalized, 'map', {
        value: function (callback, thisArg) {
          return Array.prototype.map.call(this, (s, idx, arr) => {
            const mapped = callback.call(thisArg, s, idx, arr);
            return {
              ...s,
              ...mapped,
              price: s.price,
              priceMinor: s.priceMinor,
              bestFor: s.bestFor,
              best_for: s.bestFor,
              photoCount: s.photoCount,
              photo_count: s.photoCount,
              outfits: s.outfits,
              bookingMode: s.bookingMode,
              booking_mode: s.bookingMode,
              additionalPeople: s.additionalPeople,
              additional_people: s.additionalPeople,
              durationMinutes: s.durationMinutes,
              duration_minutes: s.durationMinutes ?? mapped.duration_minutes
            };
          });
        },
        configurable: true,
        writable: true
      });

      return normalized;
    },

    /**
     * Create a new photography package.
     * Established backend endpoint: POST /services
     * Note: Backend stores price in cents.
     */
    async createPackage(data = {}) {
      const resolvedName = data.name ?? data.title ?? 'New Package';
      const bookingMode = data.bookingMode ?? data.booking_mode ?? 'direct';

      const isCustomPrice = data.customPrice === true || data.isCustomPrice === true || data.price === null || data.priceMinor === null;
      let resolvedPrice = null;
      if (!isCustomPrice && data.price !== undefined && data.price !== '' && data.price !== null) {
        if (data.priceInCents !== undefined) {
          resolvedPrice = Math.round(Number(data.priceInCents) || 0);
        } else if (data.priceMinor !== undefined) {
          resolvedPrice = Math.round(Number(data.priceMinor) || 0);
        } else {
          resolvedPrice = Math.round((Number(data.price) || 0) * 100);
        }
      }

      const rawDuration = data.durationMinutes ?? data.duration_minutes;
      const durationMinutes = rawDuration !== undefined && rawDuration !== null && rawDuration !== ''
        ? Number(rawDuration)
        : (bookingMode === 'inquiry' ? null : 60);

      const rawPhotoCount = data.photoCount ?? data.photo_count;
      const photoCount = rawPhotoCount !== undefined && rawPhotoCount !== null && rawPhotoCount !== ''
        ? Number(rawPhotoCount)
        : null;

      const rawOutfits = data.outfits;
      const outfits = rawOutfits !== undefined && rawOutfits !== null && rawOutfits !== ''
        ? Number(rawOutfits)
        : null;

      const rawAdditionalPeople = data.additionalPeople ?? data.additional_people;
      const additionalPeople = rawAdditionalPeople
        ? (typeof rawAdditionalPeople === 'object' ? JSON.stringify(rawAdditionalPeople) : String(rawAdditionalPeople))
        : null;

      const resolvedActive = data.is_active !== undefined
        ? (data.is_active ? 1 : 0)
        : (data.active !== undefined
          ? (data.active ? 1 : 0)
          : (data.isActive !== undefined ? (data.isActive ? 1 : 0) : 1));

      const payload = {
        name: resolvedName,
        title: resolvedName,
        description: data.description || '',
        best_for: data.bestFor ?? data.best_for ?? '',
        photo_count: photoCount,
        outfits: outfits,
        duration_minutes: durationMinutes,
        booking_mode: bookingMode,
        additional_people: additionalPeople,
        category: data.category || 'General',
        is_active: resolvedActive,
        price: resolvedPrice
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
      if (data.bestFor !== undefined || data.best_for !== undefined) {
        payload.best_for = data.bestFor ?? data.best_for ?? '';
      }
      if (data.photoCount !== undefined || data.photo_count !== undefined) {
        const rawPhotoCount = data.photoCount ?? data.photo_count;
        payload.photo_count = rawPhotoCount !== null && rawPhotoCount !== '' && rawPhotoCount !== undefined
          ? Number(rawPhotoCount)
          : null;
      }
      if (data.outfits !== undefined) {
        payload.outfits = data.outfits !== null && data.outfits !== '' ? Number(data.outfits) : null;
      }
      if (data.durationMinutes !== undefined || data.duration_minutes !== undefined) {
        const rawDuration = data.durationMinutes ?? data.duration_minutes;
        payload.duration_minutes = rawDuration !== null && rawDuration !== '' && rawDuration !== undefined
          ? Number(rawDuration)
          : null;
      }
      if (data.bookingMode !== undefined || data.booking_mode !== undefined) {
        payload.booking_mode = data.bookingMode ?? data.booking_mode;
      }
      if (data.additionalPeople !== undefined || data.additional_people !== undefined) {
        const rawAdditionalPeople = data.additionalPeople ?? data.additional_people;
        payload.additional_people = rawAdditionalPeople
          ? (typeof rawAdditionalPeople === 'object' ? JSON.stringify(rawAdditionalPeople) : String(rawAdditionalPeople))
          : null;
      }
      if (data.category !== undefined) payload.category = data.category;
      if (data.is_active !== undefined) {
        payload.is_active = data.is_active ? 1 : 0;
      } else if (data.active !== undefined) {
        payload.is_active = data.active ? 1 : 0;
      } else if (data.isActive !== undefined) {
        payload.is_active = data.isActive ? 1 : 0;
      }

      const isCustomPrice = data.customPrice === true || data.isCustomPrice === true || data.price === null || data.priceMinor === null;
      if (isCustomPrice) {
        payload.price = null;
      } else if (data.price !== undefined && data.price !== '') {
        if (data.priceInCents !== undefined) {
          payload.price = Math.round(Number(data.priceInCents) || 0);
        } else if (data.priceMinor !== undefined) {
          payload.price = Math.round(Number(data.priceMinor) || 0);
        } else {
          payload.price = Math.round((Number(data.price) || 0) * 100);
        }
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
