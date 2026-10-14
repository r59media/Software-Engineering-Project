/**
 * R59 Media Admin — Notifications Component
 * 
 * Toast notifications for user feedback on actions, saves, and errors.
 */

(function () {
  'use strict';

  let toastTimer = null;

  function toast(message, duration = 2200) {
    const toastEl = document.querySelector('#toast');
    if (!toastEl) return;

    toastEl.textContent = message;
    toastEl.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, duration);
  }

  window.R59 = window.R59 || {};
  window.R59.notifications = { toast };
  window.toast = toast;
})();
