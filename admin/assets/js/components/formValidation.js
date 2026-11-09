/**
 * R59 Media Admin — Form Validation Utilities
 *
 * Centralized validation rules for forms across all admin views.
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(email) {
    return EMAIL_REGEX.test(String(email || '').trim());
}
export function isValidPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length >= 10;
}
export function cleanPhone(phone) {
    return String(phone || '').replace(/\D/g, '');
}
export function isValidPrice(val) {
    if (val === '' || val === null || val === undefined)
        return false;
    const num = Number(val);
    return !isNaN(num) && num >= 0;
}
export function isValidPercentage(val) {
    if (val === '' || val === null || val === undefined)
        return false;
    const num = Number(val);
    return !isNaN(num) && num >= 0 && num <= 100;
}
export function isValidISODate(dateStr) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr))
        return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
export function isValidCouponCode(code) {
    return /^[A-Z0-9_-]+$/.test(String(code || '').trim().toUpperCase());
}
export function isValidUrl(url) {
    if (!url || typeof url !== 'string')
        return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    }
    catch {
        return false;
    }
}
export function escapeHtml(str) {
    const entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;'
    };
    return String(str || '').replace(/[&<>'"`]/g, c => entityMap[c] || c);
}
export const formValidation = {
    isValidEmail,
    isValidPhone,
    cleanPhone,
    isValidPrice,
    isValidPercentage,
    isValidISODate,
    isValidCouponCode,
    isValidUrl,
    escapeHtml
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.formValidation = formValidation;
    window.esc = escapeHtml;
}
export default formValidation;
