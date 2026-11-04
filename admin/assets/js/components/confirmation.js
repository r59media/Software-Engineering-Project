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

  // Non-destructive changes (uploads, edits, saves) get the same dialog without the danger styling.
  // onCancel lets the caller roll back an edit the admin decided not to keep.
  function confirmChange(title, text, okLabel, action, onCancel, cancelLabel = 'Cancel') {
    window.R59.modal.openModal(title, text, okLabel, action, {
      isDanger: false,
      cancelLabel,
      onCancel
    });
  }

  const confirmation = {
    /**
     * Generic destructive action confirmation
     */
    confirmDanger,

    /**
     * Generic confirmation for any change that will be written to the live site
     */
    confirmChange,

    /**
     * Confirm uploading new photos to a section of the public site
     */
    confirmUploadImages(count, sectionLabel, onConfirm, onCancel) {
      const photos = `${count} photo${count === 1 ? '' : 's'}`;
      confirmChange(
        `Upload ${photos}?`,
        `${photos} will be converted to WebP and published to ${sectionLabel || 'this section'} right away.`,
        'Upload',
        onConfirm,
        onCancel
      );
    },

    /**
     * Confirm swapping a published photo for a new file
     */
    confirmReplaceImage(imageLabel, fileName, onConfirm, onCancel) {
      confirmChange(
        'Replace photo?',
        `“${imageLabel || 'This photo'}” will be replaced with ${fileName || 'the new file'} on the live site. The current file is deleted.`,
        'Replace',
        onConfirm,
        onCancel
      );
    },

    /**
     * Confirm moving a photo to a new position
     */
    confirmReorderImages(imageLabel, onConfirm, onCancel) {
      confirmChange(
        'Change photo order?',
        `Move “${imageLabel || 'this photo'}” to its new position on the live site?`,
        'Move photo',
        onConfirm,
        onCancel
      );
    },

    /**
     * Confirm saving a photo's caption or category
     */
    confirmSavePhotoDetails(imageLabel, onConfirm, onCancel) {
      confirmChange(
        'Save photo details?',
        `Update the details for “${imageLabel || 'this photo'}” on the live site?`,
        'Save',
        onConfirm,
        onCancel,
        'Undo edit'
      );
    },

    /**
     * Confirm publishing everything changed in the save bar (profile, pricing, availability)
     */
    confirmSaveChanges(onConfirm) {
      confirmChange(
        'Save changes?',
        'Your edits to the profile, pricing and availability will be published to the live site.',
        'Save changes',
        onConfirm
      );
    },

    /**
     * Confirm throwing away unsaved edits
     */
    confirmDiscardChanges(onConfirm) {
      confirmDanger(
        'Discard changes?',
        'All unsaved edits will be lost and the last saved version restored.',
        'Discard',
        onConfirm,
        'Keep editing'
      );
    },

    /**
     * Confirm creating or updating a coupon code
     */
    confirmSaveCoupon(couponCode, isEdit, onConfirm) {
      confirmChange(
        isEdit ? 'Update coupon?' : 'Add coupon?',
        isEdit
          ? `Changes to “${couponCode}” apply to all future checkouts.`
          : `“${couponCode}” will be usable at checkout right away.`,
        isEdit ? 'Update coupon' : 'Add coupon',
        onConfirm
      );
    },

    /**
     * Confirm creating or updating a photography package
     */
    confirmSavePackage(packageName, isNew, onConfirm) {
      confirmChange(
        isNew ? 'Add package?' : 'Save package?',
        isNew
          ? `“${packageName}” will be added to the packages clients can book.`
          : `Changes to “${packageName}” will show on the booking page right away.`,
        isNew ? 'Add package' : 'Save package',
        onConfirm
      );
    },

    /**
     * Confirm turning a package or coupon on or off
     */
    confirmToggleActive(kindLabel, name, willBeActive, onConfirm, onCancel) {
      confirmChange(
        `${willBeActive ? 'Activate' : 'Deactivate'} ${kindLabel}?`,
        willBeActive
          ? `“${name}” will be available to clients again.`
          : `“${name}” will no longer be available to clients.`,
        willBeActive ? 'Activate' : 'Deactivate',
        onConfirm,
        onCancel
      );
    },

    /**
     * Confirm blocking a calendar date
     */
    confirmBlockDate(dateFormatted, onConfirm) {
      confirmChange(
        'Block this date?',
        `Clients won't be able to book ${dateFormatted || 'this date'}.`,
        'Block date',
        onConfirm
      );
    },

    /**
     * Confirm creating or editing a booking
     */
    confirmSaveBooking(client, dateFormatted, isNew, onConfirm) {
      confirmChange(
        isNew ? 'Create booking?' : 'Save booking changes?',
        isNew
          ? `Book ${client}${dateFormatted ? ' on ' + dateFormatted : ''}? That time will no longer be open to clients.`
          : `Update ${client}'s booking${dateFormatted ? ' on ' + dateFormatted : ''}?`,
        isNew ? 'Create booking' : 'Save changes',
        onConfirm
      );
    },

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
