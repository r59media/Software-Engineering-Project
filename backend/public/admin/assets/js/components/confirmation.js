/**
 * R59 Media Admin — Confirmation Dialogs
 * 
 * Centralized confirmation triggers for all destructive/irreversible actions.
 * Ensures the target record is clearly identified, cancellation keeps data unchanged,
 * and confirmation calls the appropriate delete/action handler.
 */

(function () {
  'use strict';

  function confirmDanger(title, text, okLabel, action, cancelLabel = 'Keep') {
    window.R59.modal.openModal(title, text, okLabel, action, {
      isDanger: true,
      cancelLabel
    });
  }

  const confirmation = {
    /**
     * Generic destructive action confirmation
     */
    confirmDanger,

    /**
     * Confirm removal of a cancelled booking
     */
    confirmRemoveBooking(booking, onConfirm) {
      const client = booking.customer || 'this customer';
      const date = booking.dateFormatted || booking.date || '';
      confirmDanger(
        'Remove cancelled booking?',
        `This removes ${client}'s cancelled booking${date ? ' on ' + date : ''} from the schedule. This action cannot be undone.`,
        'Remove',
        onConfirm,
        'Cancel'
      );
    },

    /**
     * Confirm cancellation of an active booking
     */
    confirmCancelBooking(booking, onConfirm) {
      const client = booking.customer || 'this customer';
      const date = booking.dateFormatted || booking.date || '';
      const depositStr = booking.deposit ? `$${Number(booking.deposit).toFixed(2)}` : '$0.00';
      confirmDanger(
        'Cancel Booking?',
        `Are you sure you want to cancel ${client}'s booking${date ? ' on ' + date : ''}? Their down payment of ${depositStr} will be marked for reimbursement.`,
        'Cancel Booking',
        onConfirm,
        'Keep Booking'
      );
    },

    /**
     * Confirm clearing multiple cancelled bookings
     */
    confirmClearCancelled(count, scopeLabel, onConfirm) {
      confirmDanger(
        'Clear cancelled bookings?',
        `This permanently removes ${count} cancelled booking${count > 1 ? 's' : ''}${scopeLabel ? ' ' + scopeLabel : ''} from the schedule. This cannot be undone.`,
        'Clear cancelled',
        onConfirm,
        'Cancel'
      );
    },

    /**
     * Confirm removal of a photography package
     */
    confirmRemovePackage(packageName, onConfirm) {
      const name = packageName || 'this package';
      confirmDanger(
        'Delete package?',
        `Are you sure you want to permanently delete “${name}”? This action cannot be undone.`,
        'Delete package',
        onConfirm,
        'Cancel'
      );
    },

    /**
     * Confirm removal of a coupon code
     */
    confirmRemoveCoupon(couponCode, onConfirm) {
      const code = couponCode || 'this coupon';
      confirmDanger(
        'Remove coupon?',
        `Are you sure you want to permanently remove coupon “${code}”?`,
        'Remove coupon',
        onConfirm,
        'Cancel'
      );
    },

    /**
     * Confirm removal of an availability timeframe
     */
    confirmRemoveTimeframe(timeframeLabel, day, onConfirm) {
      confirmDanger(
        'Remove availability timeframe?',
        `Remove ${timeframeLabel || 'this timeframe'} from ${day}?`,
        'Remove',
        onConfirm,
        'Cancel'
      );
    },

    /**
     * Confirm unblocking a calendar date
     */
    confirmRemoveBlockedDate(dateFormatted, onConfirm) {
      confirmDanger(
        'Remove blocked date?',
        `Are you sure you want to unblock ${dateFormatted || 'this date'}?`,
        'Unblock date',
        onConfirm,
        'Cancel'
      );
    },

    /**
     * Confirm removal of a social media link
     */
    confirmRemoveSocial(platform, onConfirm) {
      const label = platform || 'social link';
      confirmDanger(
        'Remove social link?',
        `Are you sure you want to remove the ${label} link? This action cannot be undone.`,
        'Remove',
        onConfirm,
        'Cancel'
      );
    },

    /**
     * Confirm removal of an image from photo library
     */
    confirmRemoveImage(imageLabel, onConfirm) {
      const label = imageLabel || 'this image';
      confirmDanger(
        'Remove image?',
        `“${label}” will be removed from this section.`,
        'Remove',
        onConfirm,
        'Cancel'
      );
    },

    /**
     * Confirm log out when unsaved changes exist
     */
    confirmLogout(hasDirtyChanges, onConfirm) {
      window.R59.modal.openModal(
        'Log out?',
        hasDirtyChanges
          ? 'You have unsaved changes that will be lost.'
          : 'You will need to sign in again to edit the site.',
        'Log out',
        onConfirm,
        { isDanger: false, cancelLabel: 'Cancel' }
      );
    }
  };

  window.R59 = window.R59 || {};
  window.R59.confirmation = confirmation;
  window.confirmDanger = confirmDanger;
})();
