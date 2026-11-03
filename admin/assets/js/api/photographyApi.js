/**
 * R59 Media Admin — Photography & Portfolio API Service
 *
 * Integration layer for photo library management and image uploads.
 * Uploads go to D1 media storage (/api/media/*); each photo is then
 * recorded in /portfolio with the site section it belongs to.
 */

(function () {
  'use strict';

  const client = () => window.R59.apiClient;

  // Backend caps a single page of /portfolio at 100 rows
  const PAGE_SIZE = 100;

  // Responses mirror their payload at the top level and under `data`; accept either
  function unwrap(res) {
    if (res && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
      return { ...res.data, ...res };
    }
    return res || {};
  }

  /**
   * Point same-server paths like /api/media/... at the API host, so images
   * still load when the admin is opened from a different local dev server.
   */
  function resolveApiUrl(path) {
    if (!path || !path.startsWith('/')) return path || '';
    const baseUrl = client()?.getBaseUrl?.() || '';
    const originMatch = baseUrl.match(/^(https?:\/\/[^/]+)/);
    return originMatch ? originMatch[1] + path : path;
  }

  function mediaUrlForKey(key) {
    return key ? `/api/media/${String(key).replace(/^\/+/, '')}` : '';
  }

  async function readErrorMessage(response) {
    try {
      const body = await response.json();
      return body?.error?.message || body?.message || '';
    } catch {
      return '';
    }
  }

  const photographyApi = {
    resolveApiUrl,

    /**
     * Fetch every portfolio image, optionally limited to one site section.
     * Pages through results so large libraries are not silently truncated.
     */
    async getGalleryImages({ section } = {}) {
      const all = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const data = await client().get('/portfolio', { limit: PAGE_SIZE, offset, section });
        const page = (data && (data.images || data.data)) || [];
        all.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      return all;
    },

    /**
     * Ask the backend where to store a file.
     * Established backend endpoint: POST /upload-url
     */
    async getUploadUrl(filename, contentType, fileSize) {
      return unwrap(await client().post('/upload-url', {
        filename,
        contentType: contentType || 'image/webp',
        fileSize
      }));
    },

    /**
     * Store the image bytes only (no portfolio record yet).
     * Returns the storage key that a portfolio record can point at.
     */
    async uploadMedia(file) {
      const contentType = file.type || 'image/webp';
      const target = await this.getUploadUrl(file.name, contentType, file.size);
      const key = target.fileKey || target.key;
      if (!target.uploadUrl || !key) {
        throw new Error('The server did not return an upload location.');
      }

      const headers = {
        'Content-Type': contentType,
        'X-Requested-With': 'XMLHttpRequest'
      };
      const authToken = client()?.getAuthToken?.();
      if (authToken && authToken !== 'cookie') {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const putRes = await fetch(resolveApiUrl(target.uploadUrl), {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: file
      });

      if (!putRes.ok) {
        const message = await readErrorMessage(putRes);
        if (putRes.status === 401) {
          window.dispatchEvent(new CustomEvent('r59:unauthorized', {
            detail: { message: message || 'Session expired. Please sign in again.' }
          }));
        }
        throw new Error(message || `Upload failed (${putRes.status} ${putRes.statusText})`);
      }

      return { key, url: target.publicUrl || mediaUrlForKey(key) };
    },

    /**
     * Save an image metadata record to the portfolio database.
     * Established backend endpoint: POST /portfolio
     * Leaving displayOrder undefined appends the photo to the end of its section.
     */
    async saveImageRecord({ mediaKey, section = 'gallery', category = 'All', title = '', altText = '', displayOrder, isFeatured = false }) {
      return unwrap(await client().post('/portfolio', {
        media_key: mediaKey,
        section,
        category,
        title,
        alt_text: altText,
        display_order: displayOrder,
        is_featured: isFeatured
      }));
    },

    /**
     * Upload a file and register it in one step.
     * Accepts either an options object or the legacy (file, category, title) form.
     */
    async uploadImageFile(file, categoryOrOpts = {}, legacyTitle = '') {
      const opts = typeof categoryOrOpts === 'string'
        ? { category: categoryOrOpts, title: legacyTitle, altText: legacyTitle }
        : (categoryOrOpts || {});
      const baseName = file.name.replace(/\.[^.]+$/, '');

      const media = await this.uploadMedia(file);
      const saved = await this.saveImageRecord({
        mediaKey: media.key,
        section: opts.section || 'gallery',
        category: opts.category || 'All',
        title: opts.title || baseName,
        altText: opts.altText || baseName,
        displayOrder: opts.displayOrder,
        isFeatured: Boolean(opts.isFeatured)
      });

      const url = resolveApiUrl(saved.url || saved.public_url || media.url);
      return { ...saved, id: saved.id, key: media.key, url, src: url, filename: file.name };
    },

    /**
     * Swap the file behind an existing photo while keeping its id, position and captions.
     * The backend removes the old stored file once the swap succeeds.
     */
    async replaceImageFile(imageId, file) {
      const media = await this.uploadMedia(file);
      const saved = unwrap(await client().put(`/portfolio/${imageId}`, { media_key: media.key }));
      const url = resolveApiUrl(saved.url || saved.public_url || media.url);
      return { ...saved, id: imageId, key: media.key, url, src: url };
    },

    /**
     * Update an existing portfolio image metadata record.
     */
    async updateImage(imageId, data) {
      return await client().put(`/portfolio/${imageId}`, data);
    },

    /**
     * Delete an image record and its stored file.
     * Established backend endpoint: DELETE /portfolio/:id
     */
    async deleteImage(id) {
      return await client().delete(`/portfolio/${id}`);
    },

    /**
     * Reorder images.
     * Established backend endpoint: PUT /portfolio/order
     */
    async updateImageOrder(orderMappings) {
      return await client().put('/portfolio/order', { order: orderMappings });
    },

    /**
     * Fetch studio profile information (bio, contact, location).
     * Established backend endpoint: GET /admin/profile
     */
    async getProfile() {
      try {
        return await client().get('/admin/profile');
      } catch {
        return null;
      }
    },

    /**
     * Save studio profile information.
     * Established backend endpoint: PUT /admin/profile
     */
    async saveProfile(profileData) {
      return await client().put('/admin/profile', profileData);
    }
  };

  window.R59 = window.R59 || {};
  window.R59.photographyApi = photographyApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.photography = photographyApi;
})();
