/**
 * R59 Media Admin — Modal Component
 * 
 * Accessible modal management with keyboard trap, focus restoration,
 * and Escape key support.
 */

export interface ModalOptions {
  isDanger?: boolean;
  cancelLabel?: string;
  onCancel?: (() => void) | null;
}

let modalAction: (() => void) | null = null;
let modalCancelAction: (() => void) | null = null;
let lastFocus: HTMLElement | null = null;

const $ = <T extends HTMLElement = HTMLElement>(s: string): T | null => document.querySelector<T>(s);

export function openModal(
  title: string,
  text: string,
  okLabel?: string,
  action?: (() => void) | null,
  options: ModalOptions = {}
): void {
  const modalEl = $('#modal');
  if (!modalEl) return;

  lastFocus = document.activeElement as HTMLElement | null;
  const titleEl = $('#modalTitle');
  if (titleEl) titleEl.textContent = title;

  const textEl = $('#modalText');
  if (textEl) textEl.textContent = text;

  const okBtn = $('#modalOk');
  if (okBtn) {
    okBtn.textContent = okLabel || 'Confirm';

    // Apply styling options (e.g. danger variant)
    if (options.isDanger) {
      okBtn.classList.add('btn-danger');
      okBtn.classList.remove('btn-primary');
    } else {
      okBtn.classList.remove('btn-danger');
      okBtn.classList.add('btn-primary');
    }
  }

  const cancelBtn = $('#modalCancel');
  if (cancelBtn) {
    cancelBtn.textContent = options.cancelLabel || 'Cancel';
    cancelBtn.focus();
  }

  modalAction = action || null;
  // Runs when the dialog is dismissed without confirming, so callers can roll back pending edits
  modalCancelAction = typeof options.onCancel === 'function' ? options.onCancel : null;
  modalEl.classList.add('open');
}

export function closeModal(): void {
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
  const cancelAction = modalCancelAction;
  modalCancelAction = null;
  if (lastFocus && typeof lastFocus.focus === 'function') {
    lastFocus.focus();
  }
  if (typeof cancelAction === 'function') cancelAction();
}

export function getActiveModal(): HTMLElement | null {
  if (!document.body.classList.contains('authenticated')) {
    const login = $('#login');
    if (login && (login.classList.contains('open') || window.getComputedStyle(login).display !== 'none')) {
      return login;
    }
  }
  // Ordered lowest to highest: the confirmation dialog sits above the booking forms
  const openModals = [
    $('#newBookingModal.open'),
    $('#bookingModal.open'),
    $('#modal.open')
  ].filter((el): el is HTMLElement => el !== null);
  return openModals[openModals.length - 1] || null;
}

export function initModalListeners(): void {
  const modalEl = $('#modal');
  if (!modalEl) return;

  $('#modalCancel')?.addEventListener('click', closeModal);
  modalEl.addEventListener('click', (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.id === 'modal') closeModal();
  });

  $('#modalOk')?.addEventListener('click', () => {
    const action = modalAction;
    modalCancelAction = null; // confirmed, so there is nothing to roll back
    closeModal();
    if (typeof action === 'function') {
      action();
    }
  });

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      const activeModal = getActiveModal();
      if (!activeModal) return;

      const focusableSelector =
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusables = Array.from(activeModal.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        el => el.offsetParent !== null && window.getComputedStyle(el).visibility !== 'hidden'
      );

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
        // Close only the confirmation, not the booking form underneath it
        e.stopImmediatePropagation();
        closeModal();
      }
    }
  });
}

export interface ModalModule {
  openModal: typeof openModal;
  closeModal: typeof closeModal;
  initModalListeners: typeof initModalListeners;
  getActiveModal?: typeof getActiveModal;
}

export const modal: ModalModule = {
  openModal,
  closeModal,
  initModalListeners,
  getActiveModal
};

declare global {
  interface Window {
    openModal?: typeof openModal;
    closeModal?: typeof closeModal;
  }
}

if (typeof window !== 'undefined') {
  window.R59 = window.R59 || {};
  window.R59.modal = modal;
  window.openModal = openModal;
  window.closeModal = closeModal;
}

export default modal;
