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
     * Request a presigned R2 upload URL for a file.
     * Established backend endpoint: POST /upload-url
     */
    async getUploadUrl(filename, contentType) {
      return await window.R59.apiClient.post('/upload-url', {
        filename,
        contentType
      });
    },

    /**
     * Upload image binary directly to R2 bucket via presigned URL,
     * then save image record.
     */
    async uploadImageFile(file, categoryOrOpts = 'All', title = '') {
      const opts = typeof categoryOrOpts === 'string'
        ? { category: categoryOrOpts, altText: title }
        : (categoryOrOpts || {});
      const { category = 'All', altText = '', displayOrder = 0, isFeatured = false } = opts;

      // 1. Get presigned upload URL from backend
      const { uploadUrl, key, publicUrl } = await this.getUploadUrl(file.name, file.type);

      // 2. Upload file directly to R2
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });

      // 3. Save portfolio database entry
      const saved = await this.saveImageRecord({
        r2ObjectKey: key,
        category,
        altText: altText || file.name.replace(/\.[^.]+$/, ''),
        displayOrder,
        isFeatured
      });

      return {
        id: saved?.id,
        key,
        url: publicUrl || '',
        src: publicUrl || '',
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
