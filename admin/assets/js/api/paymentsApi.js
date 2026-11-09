/**
 * R59 Media Admin — Payments & Pricing API Service
 *
 * Integration layer for business pricing rules (base fee, per person, deposit %)
 * and promotional coupon codes.
 *
 * Note: Endpoints marked with [Pending Agreement] are proposed API contracts
 * for the backend developer to implement or map to Admin_Settings.
 */
import { apiClient } from './apiClient';
const getClient = () => {
    if (typeof window !== 'undefined' && window.R59?.apiClient) {
        return window.R59.apiClient;
    }
    return apiClient;
};
export const paymentsApi = {
    /**
     * Get global pricing configuration.
     * [Pending Agreement]: Proposed endpoint GET /admin/pricing
     */
    async getPricingSettings() {
        try {
            return await getClient().get('/admin/pricing');
        }
        catch {
            console.info('[paymentsApi] Backend /admin/pricing not yet mounted, using local state.');
            return null;
        }
    },
    /**
     * Save pricing configuration (baseFee, perPerson, depositPercent).
     * [Pending Agreement]: Proposed endpoint PUT /admin/pricing
     */
    async updatePricingSettings(pricingData) {
        return await getClient().put('/admin/pricing', pricingData);
    },
    /**
     * List all coupons.
     * [Pending Agreement]: Proposed endpoint GET /admin/coupons
     */
    async getCoupons() {
        try {
            const res = await getClient().get('/admin/coupons');
            return res?.coupons || [];
        }
        catch {
            console.info('[paymentsApi] Backend /admin/coupons not yet mounted, using local state.');
            return [];
        }
    },
    /**
     * Create a new coupon.
     * [Pending Agreement]: Proposed endpoint POST /admin/coupons
     */
    async createCoupon(couponPayload) {
        return await getClient().post('/admin/coupons', couponPayload);
    },
    /**
     * Update an existing coupon.
     * [Pending Agreement]: Proposed endpoint PUT /admin/coupons/:id
     */
    async updateCoupon(id, couponPayload) {
        return await getClient().put(`/admin/coupons/${id}`, couponPayload);
    },
    /**
     * Delete a coupon.
     * [Pending Agreement]: Proposed endpoint DELETE /admin/coupons/:id
     */
    async deleteCoupon(id) {
        return await getClient().delete(`/admin/coupons/${id}`);
    }
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.paymentsApi = paymentsApi;
    window.R59.api = window.R59.api || {};
    window.R59.api.payments = paymentsApi;
}
export default paymentsApi;
