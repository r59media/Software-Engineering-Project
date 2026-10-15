/**
 * R59 Media Admin — Payments & Pricing API Service
 * 
 * Integration layer for business pricing rules (base fee, per person, deposit %)
 * and promotional coupon codes.
 * 
 * Note: Endpoints marked with [Pending Agreement] are proposed API contracts
 * for the backend developer to implement or map to Admin_Settings.
 */

(function () {
  'use strict';

  const paymentsApi = {
    /**
     * Get global pricing configuration.
     * [Pending Agreement]: Proposed endpoint GET /admin/pricing
     */
    async getPricingSettings() {
      try {
        return await window.R59.apiClient.get('/admin/pricing');
      } catch (err) {
        console.info('[paymentsApi] Backend /admin/pricing not yet mounted, using local state.');
        return null;
      }
    },

    /**
     * Save pricing configuration (baseFee, perPerson, depositPercent).
     * [Pending Agreement]: Proposed endpoint PUT /admin/pricing
     */
    async updatePricingSettings(pricingData) {
      return await window.R59.apiClient.put('/admin/pricing', pricingData);
    },

    /**
     * List all coupons.
     * [Pending Agreement]: Proposed endpoint GET /admin/coupons
     */
    async getCoupons() {
      try {
        const res = await window.R59.apiClient.get('/admin/coupons');
        return res?.coupons || [];
      } catch (err) {
        console.info('[paymentsApi] Backend /admin/coupons not yet mounted, using local state.');
        return [];
      }
    },

    /**
     * Create a new coupon.
     * [Pending Agreement]: Proposed endpoint POST /admin/coupons
     */
    async createCoupon(couponPayload) {
      return await window.R59.apiClient.post('/admin/coupons', couponPayload);
    },

    /**
     * Update an existing coupon.
     * [Pending Agreement]: Proposed endpoint PUT /admin/coupons/:id
     */
    async updateCoupon(id, couponPayload) {
      return await window.R59.apiClient.put(`/admin/coupons/${id}`, couponPayload);
    },

    /**
     * Delete a coupon.
     * [Pending Agreement]: Proposed endpoint DELETE /admin/coupons/:id
     */
    async deleteCoupon(id) {
      return await window.R59.apiClient.delete(`/admin/coupons/${id}`);
    }
  };

  window.R59 = window.R59 || {};
  window.R59.paymentsApi = paymentsApi;
})();
