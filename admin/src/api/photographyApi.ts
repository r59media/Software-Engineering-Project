// @ts-nocheck
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
  const MAX_PAGES = 50; // safety stop: 5,000 photos

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

  async function getImageWidth(file) {
    if (typeof file?.width === 'number' && file.width > 0) {
      return file.width;
    }
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      if (typeof bitmap.close === 'function') bitmap.close();
      return width;
    }
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width || 0;
        URL.revokeObjectURL(url);
        resolve(w);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to decode image dimensions'));
      };
      img.src = url;
    });
  }

  async function putMediaBytes(endpoint, file, fallbackPath) {
    const contentType = file.type || 'image/webp';
    const headers = {
      'Content-Type': contentType,
      'X-Requested-With': 'XMLHttpRequest'
    };
    const api = client();
    if (api?.request) {
      await api.request(endpoint, {
        method: 'PUT',
        headers,
        body: file
      });
      return;
    }

    const authToken = api?.getAuthToken?.();
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    let putRes;
    try {
      putRes = await fetch(resolveApiUrl(fallbackPath || endpoint), {
        method: 'PUT',
        headers,
        credentials: 'omit',
        body: file
      });
    } catch (cause) {
      const netErr = new Error("Can't reach the server. Check your connection and try again.");
      netErr.isNetworkError = true;
      netErr.originalError = cause;
      throw netErr;
    }

    if (!putRes.ok) {
      const message = await readErrorMessage(putRes);
      if (putRes.status === 401) {
        window.dispatchEvent(new CustomEvent('r59:unauthorized', {
          detail: { message: message || 'Session expired. Please sign in again.' }
        }));
      }
      const httpErr = new Error(message || `Upload failed (${putRes.status} ${putRes.statusText})`);
      httpErr.status = putRes.status;
      httpErr.isHttpError = true;
      throw httpErr;
    }
  }

  async function uploadImageVariants(key, sourceFile) {
    const converter = window.R59?.webpConverter;
    if (!converter || typeof converter.convertToWebP !== 'function') {
      return { uploaded: 0, skipped: 2 };
    }

    const originalWidth = await getImageWidth(sourceFile);
    let uploaded = 0;
    let skipped = 0;

    for (const targetWidth of [1280, 640]) {
      if (!(originalWidth > targetWidth)) {
        skipped++;
        continue;
      }
      const variantRes = await converter.convertToWebP(sourceFile, {
        maxDimension: targetWidth,
        quality: 0.92,
        method: 6,
        use_sharp_yuv: 1
      });
      const variantFile = variantRes.file;
      const endpoint = `/admin/media/${key}?variant=${targetWidth}`;
      await putMediaBytes(endpoint, variantFile, `/api${endpoint}`);
      uploaded++;
    }

    return { uploaded, skipped };
  }

  const photographyApi = {
    resolveApiUrl,

    /**
     * Fetch every portfolio image, optionally limited to one site section.
     * Uses the admin-only list, which also returns photos hidden from the site (is_active 0/1).
     * Pages through results so large libraries are not silently truncated.
     * Rejects on HTTP or network failure (no empty-list fallback).
     */
    async getGalleryImages({ section } = {}) {
      const all = [];
      for (let offset = 0; offset < PAGE_SIZE * MAX_PAGES; offset += PAGE_SIZE) {
        const data = await client().get('/admin/portfolio', { limit: PAGE_SIZE, offset, section });
        const page = data && (data.images || data.data);
        if (!Array.isArray(page)) {
          throw new Error('The server sent an unexpected photo list.');
        }
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

      await putMediaBytes(target.uploadUrl, file);

      try {
        await uploadImageVariants(key, file);
      } catch (variantErr) {
        console.warn(`[Photography API] Failed to generate/upload variants for ${key}:`, variantErr);
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
     * Hide a photo from the public site (active = false) or show it again (active = true).
     * The record and its file stay in the library either way.
     */
    async setImageActive(imageId, active) {
      return await client().put(`/portfolio/${imageId}`, { is_active: Boolean(active) });
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
     * Rejects on HTTP or network failure so the caller can mark the profile as not loaded
     * (and never save over it).
     */
    async getProfile() {
      const res = await client().get('/admin/profile');
      if (!res || typeof res !== 'object') {
        throw new Error('The server sent no profile.');
      }
      return res;
    },

    /**
     * Save studio profile information.
     * Established backend endpoint: PUT /admin/profile
     */
    async saveProfile(profileData) {
      return await client().put('/admin/profile', profileData);
    },

    /**
     * Re-optimize existing D1 Gallery Media:
     * a. Fetches existing portfolio items.
     * b. Sequentially streams each image from /api/media/:file_key.
     * c. Runs through webpConverter.ts (C-Wasm method 6, quality 92, use_sharp_yuv 1).
     * d. Uploads new chunks into D1 Media_Storage, updating the record and purging old chunks.
     *
     * @param {(progress: { current: number; total: number; item: any; status: string }) => void} [progressCallback]
     * @returns {Promise<{ total: number; optimized: number; failed: number; results: any[] }>}
     */
    async reoptimizeGalleryMedia(progressCallback) {
      // a. Fetches existing portfolio items
      const allItems = await this.getGalleryImages();
      const items = (allItems || []).filter(it => it && (it.media_key || it.key));
      const total = items.length;
      const results = [];
      let optimized = 0;
      let failed = 0;

      const converter = window.R59?.webpConverter;
      if (!converter || typeof converter.convertToWebP !== 'function') {
        throw new Error('WebP Converter engine is not available.');
      }

      let index = 0;
      for (const item of items) {
        index++;
        const rawKey = item.media_key || item.key || '';
        const fileKey = String(rawKey).replace(/^\/+/, '').replace(/^api\/media\//, '');
        const filename = fileKey.split('/').pop() || `gallery-${item.id || index}.webp`;
        const statusMsg = `Optimizing ${index}/${total}: ${item.title || filename}...`;

        if (typeof progressCallback === 'function') {
          if (progressCallback.length > 1) {
            progressCallback(index, total, statusMsg, item);
          } else {
            progressCallback({ current: index, total, status: statusMsg, item });
          }
        }

        try {
          // b. Sequentially streams each image from /api/media/:file_key
          let streamUrl = resolveApiUrl(`/api/media/${fileKey}`);
          let res = await fetch(streamUrl, { credentials: 'omit' });
          if (!res.ok && (item.url || item.public_url)) {
            streamUrl = resolveApiUrl(item.url || item.public_url);
            res = await fetch(streamUrl, { credentials: 'omit' });
          }

          if (!res.ok) {
            throw new Error(`Failed to stream media: HTTP ${res.status} ${res.statusText}`);
          }

          const blob = await res.blob();
          const fileToConvert = blob instanceof File
            ? blob
            : new File([blob], filename, { type: blob.type || 'image/webp' });

          // c. Runs through webpConverter.ts (C-Wasm method 6, quality 92, use_sharp_yuv 1)
          const convertRes = await converter.convertToWebP(fileToConvert, {
            quality: 0.92,
            maxDimension: 2560,
            method: 6,
            use_sharp_yuv: 1
          });
          const optimizedFile = convertRes.file;

          // d. Uploads new chunks into D1 Media_Storage, updating the record and purging old chunks
          const updated = await this.replaceImageFile(item.id, optimizedFile);
          optimized++;
          results.push({ item, success: true, updated });
        } catch (err) {
          console.warn(`[Re-optimizer] Failed to re-optimize image ${item.id} (${fileKey}):`, err);
          failed++;
          results.push({ item, success: false, error: err });
        }
      }

      const finishMsg = `Finished: ${optimized} optimized, ${failed} failed.`;
      if (typeof progressCallback === 'function') {
        if (progressCallback.length > 1) {
          progressCallback(total, total, finishMsg, null);
        } else {
          progressCallback({ current: total, total, status: finishMsg, item: null });
        }
      }

      return { total, optimized, failed, results };
    },

    /**
     * Backfill missing 640px and 1280px WebP variants for all active portfolio images.
     * Fetches each original from /api/media/:key using an admin media-token,
     * generates variants where width > target at quality 92, and uploads via PUT /admin/media/:key?variant=...
     *
     * @param {(progress: { current: number; total: number; item: any; status: string }) => void} [onProgress]
     * @returns {Promise<{ total: number; generated: number; skipped: number; failed: number; results: any[] }>}
     */
    async generateMissingImageVariants(onProgress) {
      const converter = window.R59?.webpConverter;
      if (!converter || typeof converter.convertToWebP !== 'function') {
        throw new Error('WebP Converter engine is not available.');
      }

      const allItems = await this.getGalleryImages();
      const items = (allItems || []).filter(it => {
        if (!it) return false;
        const v = it.is_active;
        const isActive = !(v === 0 || v === false || v === '0');
        if (!isActive) return false;
        const rawKey = String(it.media_key || it.key || '').replace(/^\/+/, '').replace(/^api\/media\//, '');
        return Boolean(rawKey) && !rawKey.startsWith('assets/');
      });

      const total = items.length;
      const results = [];
      let generated = 0;
      let skipped = 0;
      let failed = 0;

      const emitProgress = (current, status, item) => {
        if (typeof onProgress !== 'function') return;
        if (onProgress.length > 1) {
          onProgress(current, total, status, item);
        } else {
          onProgress({ current, total, status, item });
        }
      };

      let index = 0;
      for (const item of items) {
        index++;
        const rawKey = item.media_key || item.key || '';
        const fileKey = String(rawKey).replace(/^\/+/, '').replace(/^api\/media\//, '');
        const filename = fileKey.split('/').pop() || `image-${item.id || index}.webp`;
        emitProgress(index, `Sizes ${index}/${total}: ${item.title || filename}...`, item);

        try {
          let signedUrl = '';
          try {
            const tokenRes = await client().post('/admin/media-token', { file_key: fileKey });
            signedUrl = tokenRes?.url || '';
          } catch {
            signedUrl = '';
          }

          const streamUrl = resolveApiUrl(signedUrl || `/api/media/${fileKey}`);
          const res = await fetch(streamUrl, { credentials: 'omit' });
          if (!res.ok) {
            throw new Error(`Failed to fetch media: HTTP ${res.status} ${res.statusText}`);
          }

          const blob = await res.blob();
          const sourceFile = blob instanceof File
            ? blob
            : new File([blob], filename, { type: blob.type || 'image/webp' });

          const variantRes = await uploadImageVariants(fileKey, sourceFile);
          if (variantRes.uploaded > 0) {
            generated += variantRes.uploaded;
          } else {
            skipped++;
          }
          results.push({ item, success: true, ...variantRes });
        } catch (err) {
          console.warn(`[Image Variants] Failed for image ${item.id} (${fileKey}):`, err);
          failed++;
          results.push({ item, success: false, error: err });
        }
      }

      emitProgress(total, `Finished: ${generated} variants generated, ${skipped} skipped, ${failed} failed.`, null);
      return { total, generated, skipped, failed, results };
    }
  };

  window.R59 = window.R59 || {};
  window.R59.photographyApi = photographyApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.photography = photographyApi;
})();
