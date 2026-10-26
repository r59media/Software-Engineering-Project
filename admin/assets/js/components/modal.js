/**
 * R59 Media Admin — Modal Component
 * 
 * Accessible modal management with keyboard trap, focus restoration,
 * and Escape key support.
 */

(function () {
  'use strict';

  let modalAction = null;
  let lastFocus = null;

  function $(s) { return document.querySelector(s); }

  function openModal(title, text, okLabel, action, options = {}) {
    const modalEl = $('#modal');
    if (!modalEl) return;

    lastFocus = document.activeElement;
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;

    const okBtn = $('#modalOk');
    okBtn.textContent = okLabel || 'Confirm';
    
    // Apply styling options (e.g. danger variant)
    if (options.isDanger) {
      okBtn.classList.add('btn-danger');
      okBtn.classList.remove('btn-primary');
    } else {
      okBtn.classList.remove('btn-danger');
      okBtn.classList.add('btn-primary');
    }

    const cancelBtn = $('#modalCancel');
    cancelBtn.textContent = options.cancelLabel || 'Cancel';

    modalAction = action;
    modalEl.classList.add('open');
    cancelBtn.focus();
  }

  function closeModal() {
    const modalEl = $('#modal');
    if (!modalEl) return;
    modalEl.classList.remove('open');
    
    // Reset buttons to default
    const okBtn = $('#modalOk');
    if (okBtn) {
      okBtn.classList.remove('btn-danger');
      okBtn.classList.add('btn-primary');
    }
    const cancelBtn = $('#modalCancel');
    if (cancelBtn) cancelBtn.textContent = 'Cancel';

    modalAction = null;
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    }
  }

  function getActiveModal() {
    if (!document.body.classList.contains('authenticated')) {
      const login = $('#login');
      if (login && (login.classList.contains('open') || window.getComputedStyle(login).display !== 'none')) {
        return login;
      }
    }
    const openModals = [
      $('#modal.open'),
      $('#newBookingModal.open'),
      $('#bookingModal.open')
    ].filter(Boolean);
    return openModals[openModals.length - 1] || null;
  }

  function initModalListeners() {
    const modalEl = $('#modal');
    if (!modalEl) return;

    $('#modalCancel')?.addEventListener('click', closeModal);
    modalEl.addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeModal();
    });

    $('#modalOk')?.addEventListener('click', () => {
      const action = modalAction;
      closeModal();
      if (typeof action === 'function') {
        action();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const activeModal = getActiveModal();
        if (!activeModal) return;

        const focusableSelector = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(activeModal.querySelectorAll(focusableSelector))
          .filter(el => el.offsetParent !== null && window.getComputedStyle(el).visibility !== 'hidden');

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstEl || !activeModal.contains(document.activeElement)) {
            e.preventDefault();
            lastEl.focus();
          }
        } else {
          if (document.activeElement === lastEl || !activeModal.contains(document.activeElement)) {
            e.preventDefault();
            firstEl.focus();
          }
        }
      } else if (e.key === 'Escape') {
        if (modalEl.classList.contains('open')) {
          closeModal();
        }
      }
    });
  }

  window.R59 = window.R59 || {};
  window.R59.modal = {
    openModal,
    closeModal,
    initModalListeners
  };

  // Expose globally for existing inline handlers compatibility
  window.openModal = openModal;
  window.closeModal = closeModal;
})();
