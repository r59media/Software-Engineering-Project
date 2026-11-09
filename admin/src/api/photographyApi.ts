/**
 * R59 Media Admin — Photography & Portfolio API Service
 *
 * Integration layer for photo library management and image uploads.
 * Uploads go to D1 media storage (/api/media/*); each photo is then
 * recorded in /portfolio with the site section it belongs to.
 */

import { apiClient, ApiClient } from './apiClient';

export interface GalleryImage {
  id: string | number;
  media_key?: string;
  mediaKey?: string;
  key?: string;
  section?: string;
  category?: string;
  title?: string;
  alt_text?: string;
  altText?: string;
  display_order?: number;
  displayOrder?: number;
  is_featured?: boolean | number;
  isFeatured?: boolean;
  url?: string;
  public_url?: string;
  publicUrl?: string;
  src?: string;
  filename?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

export interface GetGalleryImagesOptions {
  section?: string;
}

export interface UploadUrlResponse {
  uploadUrl?: string;
  url?: string;
  fileKey?: string;
  key?: string;
  publicUrl?: string;
  [key: string]: any;
}

export interface SaveImageRecordOptions {
  mediaKey: string;
  section?: string;
  category?: string;
  title?: string;
  altText?: string;
  displayOrder?: number;
  isFeatured?: boolean;
}

export interface ImageUploadOptions {
  section?: string;
  category?: string;
  title?: string;
  altText?: string;
  displayOrder?: number;
  isFeatured?: boolean;
  [key: string]: any;
}

export interface ImageOrderMapping {
  id: string | number;
  display_order?: number;
  displayOrder?: number;
  [key: string]: any;
}

export interface StudioProfile {
  bio?: string;
  phone?: string;
  email?: string;
  location?: string;
  social?: Array<{ platform: string; url: string }>;
  [key: string]: any;
}

export interface PhotographyApi {
  resolveApiUrl(path: string): string;
  getGalleryImages(options?: GetGalleryImagesOptions): Promise<GalleryImage[]>;
  getUploadUrl(filename: string, contentType?: string, fileSize?: number): Promise<UploadUrlResponse>;
  uploadMedia(file: File): Promise<{ key: string; url: string }>;
  saveImageRecord(options: SaveImageRecordOptions): Promise<any>;
  uploadImageFile(file: File, categoryOrOpts?: string | ImageUploadOptions, legacyTitle?: string): Promise<GalleryImage>;
  replaceImageFile(imageId: string | number, file: File): Promise<GalleryImage>;
  updateImage(imageId: string | number, data: Partial<GalleryImage> | any): Promise<any>;
  deleteImage(id: string | number): Promise<any>;
  updateImageOrder(orderMappings: ImageOrderMapping[] | any[]): Promise<any>;
  getProfile(): Promise<StudioProfile | null>;
  saveProfile(profileData: StudioProfile): Promise<any>;
}

const getClient = (): ApiClient => {
  if (typeof window !== 'undefined' && window.R59?.apiClient) {
    return window.R59.apiClient as ApiClient;
  }
  return apiClient;
};

// Backend caps a single page of /portfolio at 100 rows
const PAGE_SIZE = 100;

// Responses mirror their payload at the top level and under `data`; accept either
function unwrap(res: any): any {
  if (res && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
    return { ...res.data, ...res };
  }
  return res || {};
}

/**
 * Point same-server paths like /api/media/... at the API host, so images
 * still load when the admin is opened from a different local dev server.
 */
export function resolveApiUrl(path: string): string {
  if (!path || !path.startsWith('/')) return path || '';
  const baseUrl = getClient()?.getBaseUrl?.() || '';
  const originMatch = baseUrl.match(/^(https?:\/\/[^/]+)/);
  return originMatch ? originMatch[1] + path : path;
}

export function mediaUrlForKey(key: string): string {
  return key ? `/api/media/${String(key).replace(/^\/+/, '')}` : '';
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message || body?.message || '';
  } catch {
    return '';
  }
}

export const photographyApi: PhotographyApi = {
  resolveApiUrl,

  /**
   * Fetch every portfolio image, optionally limited to one site section.
   * Pages through results so large libraries are not silently truncated.
   */
  async getGalleryImages({ section }: GetGalleryImagesOptions = {}): Promise<GalleryImage[]> {
    const all: GalleryImage[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const data = await getClient().get<any>('/portfolio', { limit: PAGE_SIZE, offset, section });
      const page: GalleryImage[] = (data && (data.images || data.data)) || [];
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return all;
  },

  /**
   * Ask the backend where to store a file.
   * Established backend endpoint: POST /upload-url
   */
  async getUploadUrl(filename: string, contentType?: string, fileSize?: number): Promise<UploadUrlResponse> {
    return unwrap(await getClient().post('/upload-url', {
      filename,
      contentType: contentType || 'image/webp',
      fileSize
    }));
  },

  /**
   * Store the image bytes only (no portfolio record yet).
   * Returns the storage key that a portfolio record can point at.
   */
  async uploadMedia(file: File): Promise<{ key: string; url: string }> {
    const contentType = file.type || 'image/webp';
    const target = await this.getUploadUrl(file.name, contentType, file.size);
    const key = target.fileKey || target.key;
    if (!target.uploadUrl || !key) {
      throw new Error('The server did not return an upload location.');
    }

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'X-Requested-With': 'XMLHttpRequest'
    };
    const authToken = getClient()?.getAuthToken?.();
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
      if (putRes.status === 401 && typeof window !== 'undefined') {
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
  async saveImageRecord({
    mediaKey,
    section = 'gallery',
    category = 'All',
    title = '',
    altText = '',
    displayOrder,
    isFeatured = false
  }: SaveImageRecordOptions): Promise<any> {
    return unwrap(await getClient().post('/portfolio', {
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
  async uploadImageFile(
    file: File,
    categoryOrOpts: string | ImageUploadOptions = {},
    legacyTitle: string = ''
  ): Promise<GalleryImage> {
    const opts: ImageUploadOptions = typeof categoryOrOpts === 'string'
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
  async replaceImageFile(imageId: string | number, file: File): Promise<GalleryImage> {
    const media = await this.uploadMedia(file);
    const saved = unwrap(await getClient().put(`/portfolio/${imageId}`, { media_key: media.key }));
    const url = resolveApiUrl(saved.url || saved.public_url || media.url);
    return { ...saved, id: imageId, key: media.key, url, src: url };
  },

  /**
   * Update an existing portfolio image metadata record.
   */
  async updateImage(imageId: string | number, data: Partial<GalleryImage> | any): Promise<any> {
    return await getClient().put(`/portfolio/${imageId}`, data);
  },

  /**
   * Delete an image record and its stored file.
   * Established backend endpoint: DELETE /portfolio/:id
   */
  async deleteImage(id: string | number): Promise<any> {
    return await getClient().delete(`/portfolio/${id}`);
  },

  /**
   * Reorder images.
   * Established backend endpoint: PUT /portfolio/order
   */
  async updateImageOrder(orderMappings: ImageOrderMapping[] | any[]): Promise<any> {
    return await getClient().put('/portfolio/order', { order: orderMappings });
  },

  /**
   * Fetch studio profile information (bio, contact, location).
   * Established backend endpoint: GET /admin/profile
   */
  async getProfile(): Promise<StudioProfile | null> {
    try {
      return await getClient().get<StudioProfile>('/admin/profile');
    } catch {
      return null;
    }
  },

  /**
   * Save studio profile information.
   * Established backend endpoint: PUT /admin/profile
   */
  async saveProfile(profileData: StudioProfile): Promise<any> {
    return await getClient().put('/admin/profile', profileData);
  }
};

if (typeof window !== 'undefined') {
  window.R59 = window.R59 || {} as any;
  window.R59.photographyApi = photographyApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.photography = photographyApi;
}

export default photographyApi;
