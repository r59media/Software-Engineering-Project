/**
 * R59 Media Admin — Form Validation Utilities
 * 
 * Centralized validation rules for forms across all admin views.
 */

(function () {
  'use strict';

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const formValidation = {
    isValidEmail(email) {
      return EMAIL_REGEX.test(String(email || '').trim());
    },

    isValidPhone(phone) {
      const digits = String(phone || '').replace(/\D/g, '');
      return digits.length >= 10;
    },

    cleanPhone(phone) {
      return String(phone || '').replace(/\D/g, '');
    },

    isValidPrice(val) {
      if (val === '' || val === null || val === undefined) return false;
      const num = Number(val);
      return !isNaN(num) && num >= 0;
    },

    isValidPercentage(val) {
      if (val === '' || val === null || val === undefined) return false;
      const num = Number(val);
      return !isNaN(num) && num >= 0 && num <= 100;
    },

    isValidISODate(dateStr) {
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    },

    isValidCouponCode(code) {
      return /^[A-Z0-9_-]+$/.test(String(code || '').trim().toUpperCase());
    },

    escapeHtml(str) {
      return String(str || '').replace(/[&<>"]/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;'
      }[c]));
    }
  };

  window.R59 = window.R59 || {};
  window.R59.formValidation = formValidation;
  window.esc = formValidation.escapeHtml;
})();
