/**
 * R59 Media Admin — Payments & Pricing API Service
 *
 * Integration layer for business pricing rules (base fee, per person, deposit %)
 * and promotional coupon codes.
 *
 * Every call rejects on an HTTP or network failure (the apiClient error carries
 * `message`, `status` and `isNetworkError`), so callers can mark an area failed
 * or show the server's message. Nothing is swallowed here.
 */

(function () {
  'use strict';

  /** The backend accepts only 'percent' | 'amount' (a legacy 'fixed' value maps to 'amount'). */
  function normalizeCouponType(type) {
    if (type === undefined || type === null || type === '') return undefined;
    return type === 'percent' ? 'percent' : 'amount';
  }

  function couponBody(payload = {}) {
    const body = { ...payload };
    const type = normalizeCouponType(body.type);
    if (type) body.type = type;
    else delete body.type;
    return body;
  }

  const paymentsApi = {
    /** GET /admin/pricing → { baseFee, perPerson, depositPercent } (top level or under `data`). */
    async getPricingSettings() {
      return await window.R59.apiClient.get('/admin/pricing');
    },

    /** PUT /admin/pricing with { baseFee ($), perPerson ($), depositPercent (%) }. */
    async updatePricingSettings(pricingData) {
      return await window.R59.apiClient.put('/admin/pricing', pricingData);
    },

    /** GET /admin/coupons → array of coupons. */
    async getCoupons() {
      const res = await window.R59.apiClient.get('/admin/coupons');
      const list = res?.coupons ?? res?.data;
      if (!Array.isArray(list)) throw new Error('The server sent an unexpected coupon list.');
      return list;
    },

    /** POST /admin/coupons → { id, coupon }. `type` is 'percent' | 'amount'; amount in dollars or %. */
    async createCoupon(couponPayload) {
      return await window.R59.apiClient.post('/admin/coupons', couponBody(couponPayload));
    },

    /** PUT /admin/coupons/:id (fields left out keep their stored values). */
    async updateCoupon(id, couponPayload) {
      return await window.R59.apiClient.put(`/admin/coupons/${encodeURIComponent(id)}`, couponBody(couponPayload));
    },

    /** DELETE /admin/coupons/:id */
    async deleteCoupon(id) {
      return await window.R59.apiClient.delete(`/admin/coupons/${encodeURIComponent(id)}`);
    }
  };

  window.R59 = window.R59 || {};
  window.R59.paymentsApi = paymentsApi;
  window.R59.api = window.R59.api || {};
  window.R59.api.payments = paymentsApi;
})();
