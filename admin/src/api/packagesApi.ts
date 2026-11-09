/**
 * R59 Media Admin — Packages (Services) API Service
 * 
 * Integration layer for photography package management.
 * Connected to Cloudflare Workers /services backend routes.
 */

import { apiClient, ApiClient } from './apiClient';

export interface AdditionalPeopleRule {
  allowed?: boolean;
  max?: number;
  pricePerPerson?: number;
  price_per_person?: number;
  [key: string]: any;
}

export interface PackageItem {
  id: string;
  name: string;
  title: string;
  description: string;
  bestFor: string;
  best_for: string;
  photoCount: number | null;
  photo_count: number | null;
  outfits: number | null;
  price: number | null;
  priceMinor: number | null;
  durationMinutes: number | null;
  duration_minutes: number | null;
  bookingMode: 'direct' | 'inquiry' | string;
  booking_mode: 'direct' | 'inquiry' | string;
  additionalPeople: AdditionalPeopleRule | any | null;
  additional_people: AdditionalPeopleRule | any | null;
  active: boolean;
  is_active: number;
  category?: string;
  [key: string]: any;
}

export interface PackageInput {
  name?: string;
  title?: string;
  description?: string;
  bestFor?: string;
  best_for?: string;
  photoCount?: number | string | null;
  photo_count?: number | string | null;
  outfits?: number | string | null;
  price?: number | string | null;
  priceMinor?: number | string | null;
  priceInCents?: number | string | null;
  customPrice?: boolean;
  isCustomPrice?: boolean;
  durationMinutes?: number | string | null;
  duration_minutes?: number | string | null;
  bookingMode?: string;
  booking_mode?: string;
  additionalPeople?: AdditionalPeopleRule | string | any | null;
  additional_people?: AdditionalPeopleRule | string | any | null;
  category?: string;
  active?: boolean;
  isActive?: boolean;
  is_active?: number | boolean;
  [key: string]: any;
}

export interface PackagesApiResponse {
  services?: any[];
  [key: string]: any;
}

export interface PackagesApi {
  getPackages(): Promise<PackageItem[]>;
  createPackage(data?: PackageInput): Promise<any>;
  updatePackage(id: string | number, data?: PackageInput): Promise<any>;
  deletePackage(id: string | number): Promise<any>;
}

const getClient = (): ApiClient => {
  if (typeof window !== 'undefined' && window.R59?.apiClient) {
    return window.R59.apiClient as ApiClient;
  }
  return apiClient;
};

export const packagesApi: PackagesApi = {
  /**
   * Fetch all photography packages/services (including inactive ones for admin).
   * Established backend endpoint: GET /services?all=true
   */
  async getPackages(): Promise<PackageItem[]> {
    const data = await getClient().get<PackagesApiResponse>('/services?all=true');
    const rawServices: any[] = (data && data.services) || [];

    const normalized: PackageItem[] = rawServices.map((s: any) => {
      const rawPriceMinor = s.priceMinor !== undefined ? s.priceMinor : s.price;
      const priceMinor = (rawPriceMinor === null || s.price === null) ? null : Number(rawPriceMinor);
      const price = (s.price !== null && priceMinor !== null) ? (priceMinor / 100) : null;

      const rawAdd = s.additional_people !== undefined ? s.additional_people : s.additionalPeople;
      let additionalPeople: any = null;
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
      value: function (callback: (s: PackageItem, idx: number, arr: PackageItem[]) => any, thisArg?: any) {
        return Array.prototype.map.call(this, (s: PackageItem, idx: number, arr: PackageItem[]) => {
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
  async createPackage(data: PackageInput = {}): Promise<any> {
    const resolvedName = data.name ?? data.title ?? 'New Package';
    const bookingMode = data.bookingMode ?? data.booking_mode ?? 'direct';

    const isCustomPrice = data.customPrice === true || data.isCustomPrice === true || data.price === null || data.priceMinor === null;
    let resolvedPrice: number | null = null;
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

    const payload: Record<string, any> = {
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

    return await getClient().post('/services', payload);
  },

  /**
   * Update an existing package.
   * Established backend endpoint: PUT /services/:id
   */
  async updatePackage(id: string | number, data: PackageInput = {}): Promise<any> {
    const payload: Record<string, any> = {};
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

    return await getClient().put(`/services/${id}`, payload);
  },

  /**
   * Remove / deactivate a package.
   */
  async deletePackage(id: string | number): Promise<any> {
    try {
      return await getClient().delete(`/services/${id}`);
    } catch {
      // Fallback to setting is_active = 0
      return await getClient().put(`/services/${id}`, { is_active: 0 });
    }
  }
};

if (typeof window !== 'undefined') {
  window.R59 = window.R59 || {} as any;
  window.R59.packagesApi = packagesApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.packages = packagesApi;
}

export default packagesApi;
