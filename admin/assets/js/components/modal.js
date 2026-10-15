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
      if (e.key === 'Escape') {
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
