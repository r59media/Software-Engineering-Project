// @ts-nocheck
/**
 * R59 Media Admin — Toasts
 *
 * toast(message, opts)
 *   opts: a number (duration in ms, back-compatible) or { type: 'success'|'error'|'info', duration }.
 * Success and info use #toast (role=status, polite). Errors use #toastAlert (role=alert) and stay
 * 5000 ms by default. Only call with type 'success' after the server returned 2xx.
 */
(function () {
    'use strict';
    const DEFAULT_DURATION = 2200;
    const ERROR_DURATION = 5000;
    const timers = new WeakMap();
    function hide(el) {
        if (!el)
            return;
        clearTimeout(timers.get(el));
        el.hidden = true;
        el.classList.remove('show');
    }
    function toast(message, opts) {
        let type = 'info';
        let duration;
        if (typeof opts === 'number') {
            duration = opts;
        }
        else if (opts && typeof opts === 'object') {
            type = opts.type || 'info';
            duration = opts.duration;
        }
        if (typeof duration !== 'number' || !(duration > 0)) {
            duration = type === 'error' ? ERROR_DURATION : DEFAULT_DURATION;
        }
        const statusEl = document.getElementById('toast');
        const alertEl = document.getElementById('toastAlert');
        const el = type === 'error' ? (alertEl || statusEl) : statusEl;
        if (!el)
            return;
        if (el !== statusEl)
            hide(statusEl);
        if (el !== alertEl)
            hide(alertEl);
        clearTimeout(timers.get(el));
        el.classList.toggle('toast--error', type === 'error');
        el.classList.toggle('toast--success', type === 'success');
        el.hidden = false;
        el.classList.add('show');
        // Set the text after the region is visible so screen readers announce it
        el.textContent = '';
        setTimeout(() => { el.textContent = String(message ?? ''); }, 30);
        timers.set(el, setTimeout(() => hide(el), duration));
    }
    window.R59 = window.R59 || {};
    window.R59.notifications = { toast };
    window.toast = toast;
})();
