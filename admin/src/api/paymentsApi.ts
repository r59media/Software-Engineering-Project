/**
 * R59 Media Admin — Payments & Pricing API Service
 * 
 * Integration layer for business pricing rules (base fee, per person, deposit %)
 * and promotional coupon codes.
 * 
 * Note: Endpoints marked with [Pending Agreement] are proposed API contracts
 * for the backend developer to implement or map to Admin_Settings.
 */

import { apiClient, ApiClient } from './apiClient';

export interface PricingSettings {
  baseFee?: number;
  base_fee?: number;
  perPerson?: number;
  per_person?: number;
  depositPercent?: number;
  deposit_percent?: number;
  [key: string]: any;
}

export interface Coupon {
  id?: string | number;
  code: string;
  discountType?: 'percent' | 'fixed' | string;
  discount_type?: 'percent' | 'fixed' | string;
  discountValue?: number;
  discount_value?: number;
  expiryDate?: string | null;
  expiry_date?: string | null;
  active?: boolean;
  is_active?: boolean | number;
  usageCount?: number;
  usage_count?: number;
  maxUsage?: number | null;
  max_usage?: number | null;
  [key: string]: any;
}

export interface CouponPayload {
  code: string;
  discountType?: string;
  discount_type?: string;
  discountValue?: number;
  discount_value?: number;
  expiryDate?: string | null;
  expiry_date?: string | null;
  active?: boolean;
  is_active?: boolean | number;
  maxUsage?: number | null;
  max_usage?: number | null;
  [key: string]: any;
}

export interface CouponsApiResponse {
  coupons?: Coupon[];
  [key: string]: any;
}

export interface PaymentsApi {
  getPricingSettings(): Promise<PricingSettings | null>;
  updatePricingSettings(pricingData: PricingSettings): Promise<any>;
  getCoupons(): Promise<Coupon[]>;
  createCoupon(couponPayload: CouponPayload): Promise<any>;
  updateCoupon(id: string | number, couponPayload: Partial<CouponPayload>): Promise<any>;
  deleteCoupon(id: string | number): Promise<any>;
}

const getClient = (): ApiClient => {
  if (typeof window !== 'undefined' && window.R59?.apiClient) {
    return window.R59.apiClient as ApiClient;
  }
  return apiClient;
};

export const paymentsApi: PaymentsApi = {
  /**
   * Get global pricing configuration.
   * [Pending Agreement]: Proposed endpoint GET /admin/pricing
   */
  async getPricingSettings(): Promise<PricingSettings | null> {
    try {
      return await getClient().get<PricingSettings>('/admin/pricing');
    } catch {
      console.info('[paymentsApi] Backend /admin/pricing not yet mounted, using local state.');
      return null;
    }
  },

  /**
   * Save pricing configuration (baseFee, perPerson, depositPercent).
   * [Pending Agreement]: Proposed endpoint PUT /admin/pricing
   */
  async updatePricingSettings(pricingData: PricingSettings): Promise<any> {
    return await getClient().put('/admin/pricing', pricingData);
  },

  /**
   * List all coupons.
   * [Pending Agreement]: Proposed endpoint GET /admin/coupons
   */
  async getCoupons(): Promise<Coupon[]> {
    try {
      const res = await getClient().get<CouponsApiResponse>('/admin/coupons');
      return res?.coupons || [];
    } catch {
      console.info('[paymentsApi] Backend /admin/coupons not yet mounted, using local state.');
      return [];
    }
  },

  /**
   * Create a new coupon.
   * [Pending Agreement]: Proposed endpoint POST /admin/coupons
   */
  async createCoupon(couponPayload: CouponPayload): Promise<any> {
    return await getClient().post('/admin/coupons', couponPayload);
  },

  /**
   * Update an existing coupon.
   * [Pending Agreement]: Proposed endpoint PUT /admin/coupons/:id
   */
  async updateCoupon(id: string | number, couponPayload: Partial<CouponPayload>): Promise<any> {
    return await getClient().put(`/admin/coupons/${id}`, couponPayload);
  },

  /**
   * Delete a coupon.
   * [Pending Agreement]: Proposed endpoint DELETE /admin/coupons/:id
   */
  async deleteCoupon(id: string | number): Promise<any> {
    return await getClient().delete(`/admin/coupons/${id}`);
  }
};

if (typeof window !== 'undefined') {
  window.R59 = window.R59 || {} as any;
  window.R59.paymentsApi = paymentsApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.payments = paymentsApi;
}

export default paymentsApi;
