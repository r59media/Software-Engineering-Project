/**
 * R59 Media Admin — Photography & Portfolio API Service
 * 
 * Integration layer for photo library management and image uploads.
 * Connected to Cloudflare Workers /portfolio and /upload-url backend routes.
 */

(function () {
  'use strict';

  const photographyApi = {
    /**
     * Fetch portfolio images.
     * Established backend endpoint: GET /portfolio
     */
    async getGalleryImages({ limit = 50, offset = 0 } = {}) {
      const data = await window.R59.apiClient.get('/portfolio', { limit, offset });
      return (data && data.images) || [];
    },

    /**
     * Save an image metadata record to portfolio database.
     * Established backend endpoint: POST /portfolio
     */
    async saveImageRecord({ r2ObjectKey, category = 'All', altText = '', displayOrder = 0, isFeatured = false }) {
      return await window.R59.apiClient.post('/portfolio', {
        r2_object_key: r2ObjectKey,
        category,
        alt_text: altText,
        display_order: displayOrder,
        is_featured: isFeatured
      });
    },

    /**
     * Request an upload URL for a file.
     * Established backend endpoint: POST /upload-url
     */
    async getUploadUrl(filename, contentType) {
      return await window.R59.apiClient.post('/upload-url', {
        filename,
        contentType: contentType || 'image/webp'
      });
    },

    /**
     * Upload image binary directly to D1 media endpoint via uploadUrl,
     * then save image record.
     */
    async uploadImageFile(file, categoryOrOpts = 'All', title = '') {
      const opts = typeof categoryOrOpts === 'string'
        ? { category: categoryOrOpts, altText: title }
        : (categoryOrOpts || {});
      const { category = 'All', altText = '', displayOrder = 0, isFeatured = false } = opts;

      // 1. Get upload URL from backend
      const res = await this.getUploadUrl(file.name, file.type || 'image/webp');
      const uploadUrl = res.uploadUrl || res.data?.uploadUrl;
      const key = res.key || res.fileKey || res.data?.fileKey || res.data?.key;
      const publicUrl = res.publicUrl || res.data?.publicUrl;

      if (!uploadUrl) {
        throw new Error('No upload URL returned from server.');
      }

      // 2. Upload file directly to D1 media storage endpoint (/api/media/*)
      const uploadHeaders = {
        'Content-Type': file.type || 'image/webp',
        'X-Requested-With': 'XMLHttpRequest'
      };

      const authToken = window.R59?.apiClient?.getAuthToken?.();
      if (authToken && authToken !== 'cookie') {
        uploadHeaders['Authorization'] = `Bearer ${authToken}`;
      }

      // Resolve relative upload URL if apiClient has a base URL configured
      let targetUploadUrl = uploadUrl;
      if (uploadUrl.startsWith('/')) {
        const baseUrl = window.R59?.apiClient?.getBaseUrl?.() || '';
        if (baseUrl && (baseUrl.startsWith('http://') || baseUrl.startsWith('https://'))) {
          const originMatch = baseUrl.match(/^(https?:\/\/[^/]+)/);
          if (originMatch) {
            targetUploadUrl = originMatch[1] + uploadUrl;
          }
        }
      }

      const putRes = await fetch(targetUploadUrl, {
        method: 'PUT',
        headers: uploadHeaders,
        credentials: 'include',
        body: file
      });

      if (!putRes.ok) {
        let errMsg = `Upload failed with status ${putRes.status}: ${putRes.statusText}`;
        try {
          const errBody = await putRes.json();
          if (errBody?.error?.message) {
            errMsg = errBody.error.message;
          } else if (errBody?.message) {
            errMsg = errBody.message;
          }
        } catch {}
        throw new Error(errMsg);
      }

      // 3. Save portfolio database entry
      const saved = await this.saveImageRecord({
        r2ObjectKey: key,
        category,
        altText: altText || file.name.replace(/\.[^.]+$/, ''),
        displayOrder,
        isFeatured
      });

      const resolvedUrl = publicUrl || saved?.url || saved?.public_url || (key ? `/api/media/${String(key).replace(/^\/+/, '')}` : '');
      return {
        id: saved?.id,
        key,
        url: resolvedUrl,
        src: resolvedUrl,
        filename: file.name
      };
    },

    /**
     * Update an existing portfolio image metadata record.
     */
    async updateImage(imageId, data) {
      return await window.R59.apiClient.put(`/portfolio/${imageId}`, data);
    },

    /**
     * Delete an image.
     * Established backend endpoint: DELETE /portfolio/:id
     */
    async deleteImage(id) {
      return await window.R59.apiClient.delete(`/portfolio/${id}`);
    },

    /**
     * Reorder images.
     * Established backend endpoint: PUT /portfolio/order
     */
    async updateImageOrder(orderMappings) {
      return await window.R59.apiClient.put('/portfolio/order', { order: orderMappings });
    },

    /**
     * Fetch studio profile information (bio, contact, location).
     * Established backend endpoint: GET /admin/profile
     */
    async getProfile() {
      try {
        return await window.R59.apiClient.get('/admin/profile');
      } catch {
        return null;
      }
    },

    /**
     * Save studio profile information.
     * Established backend endpoint: PUT /admin/profile
     */
    async saveProfile(profileData) {
      return await window.R59.apiClient.put('/admin/profile', profileData);
    }
  };

  window.R59 = window.R59 || {};
  window.R59.photographyApi = photographyApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.photography = photographyApi;
})();
