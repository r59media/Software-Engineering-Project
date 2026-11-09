/**
 * R59 Media Admin — Notifications Component
 * 
 * Toast notifications for user feedback on actions, saves, and errors.
 */

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string, duration: number = 2200): void {
  const toastEl = document.querySelector<HTMLElement>('#toast');
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.classList.add('show');

  if (toastTimer !== null) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, duration);
}

export interface NotificationsModule {
  toast: typeof toast;
}

export const notifications: NotificationsModule = {
  toast
};

declare global {
  interface Window {
    toast?: typeof toast;
  }
}

if (typeof window !== 'undefined') {
  window.R59 = window.R59 || {};
  window.R59.notifications = notifications;
  window.toast = toast;
}

export default notifications;
