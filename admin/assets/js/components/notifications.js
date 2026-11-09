/**
 * R59 Media Admin — Notifications Component
 *
 * Toast notifications for user feedback on actions, saves, and errors.
 */
let toastTimer = null;
export function toast(message, duration = 2200) {
    const toastEl = document.querySelector('#toast');
    if (!toastEl)
        return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    if (toastTimer !== null) {
        clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
        toastEl.classList.remove('show');
    }, duration);
}
export const notifications = {
    toast
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.notifications = notifications;
    window.toast = toast;
}
export default notifications;
