// @ts-nocheck
/**
 * R59 Media Admin — Confirmation Dialogs
 * 
 * Centralized confirmation triggers for destructive and live-site actions.
 * Record actions (coupons, packages, bookings, blocked dates, photos) are written to the server as
 * soon as they are confirmed. Settings edits (profile, social links, pricing, availability, package
 * text) wait for "Review & save"; the review dialog (reviewChanges.js) replaces a save confirm.
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
          ? `Changes to “${couponCode}” will be saved right away.`
          : `“${couponCode}” will be saved right away.`,
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
          ? `“${packageName}” will be saved right away.`
          : `Changes to “${packageName}” will be saved right away.`,
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
    confirmRemoveBooking(booking, onConfirm, paymentsNote = '') {
      const client = booking.customer || 'this customer';
      const date = booking.dateFormatted || booking.date || '';
      confirmDanger(
        'Remove cancelled booking?',
        `This removes ${client}'s cancelled booking${date ? ' on ' + date : ''} from the schedule.${paymentsNote ? ' ' + paymentsNote : ''} This action cannot be undone.`,
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
      // Everything paid so far (paid at booking + recorded payments) becomes the refund owed
      const st = window.R59.state;
      const refundCents = st && st.balanceOf
        ? st.balanceOf({ ...booking, status: 'Cancelled' }).refundOwedCents
        : Math.round((Number(booking.deposit) || 0) * 100);
      const paidStr = st && st.formatCents ? st.formatCents(refundCents) : `$${(refundCents / 100).toFixed(2)}`;
      if (refundCents <= 0) {
        confirmDanger(
          'Cancel Booking?',
          `Are you sure you want to cancel ${client}'s booking${date ? ' on ' + date : ''}? Nothing has been paid on it yet.`,
          'Cancel Booking',
          () => onConfirm(false),
          'Keep Booking'
        );
        return;
      }

      let checkbox = null;
      confirmDanger(
        'Cancel Booking?',
        `Are you sure you want to cancel ${client}'s booking${date ? ' on ' + date : ''}? ${paidStr} has been paid so far; any manual payments will be marked for reimbursement.`,
        'Cancel Booking',
        () => onConfirm(checkbox ? checkbox.checked : true),
        'Keep Booking'
      );

      const modalTextEl = document.getElementById('modalText');
      if (modalTextEl) {
        const wrap = document.createElement('div');
        wrap.style.marginTop = '12px';
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'flex-start';
        label.style.gap = '8px';
        label.style.cursor = 'pointer';
        label.style.fontSize = '0.9em';

        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.style.marginTop = '3px';

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(`Refund card deposit (${paidStr}) via Square (uncheck to keep deposit if client cancelled)`));
        wrap.appendChild(label);
        modalTextEl.appendChild(wrap);
      }
    },

    /**
     * Confirm clearing multiple cancelled bookings (paymentsNote names the recorded payments deleted with them)
     */
    confirmClearCancelled(count, scopeLabel, onConfirm, paymentsNote = '') {
      confirmDanger(
        'Clear cancelled bookings?',
        `This permanently removes ${count} cancelled booking${count > 1 ? 's' : ''}${scopeLabel ? ' ' + scopeLabel : ''} from the schedule.${paymentsNote ? ' ' + paymentsNote : ''} This cannot be undone.`,
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
        `Remove the ${label} link? It comes off the site when you save your changes.`,
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
     * Confirm removing one recorded payment from a booking (label e.g. "$50.00 Zelle payment on Nov 3, 2026")
     */
    confirmRemovePayment(label, onConfirm, cancelled = false) {
      confirmDanger(
        'Remove payment?',
        cancelled
          ? `This removes the ${label || 'selected payment'} from this cancelled booking. The refund owed goes down by that amount.`
          : `This removes the ${label || 'selected payment'} from this booking. The balance due goes up by that amount.`,
        'Remove payment',
        onConfirm,
        'Keep'
      );
    },

    /**
     * Confirm sending the balance invoice through Square (amountText e.g. "$120.00")
     */
    confirmSendInvoice(amountText, email, onConfirm) {
      confirmChange(
        'Send invoice?',
        `Square will email a ${amountText} invoice to ${email || 'the client'}, due in 7 days.`,
        'Send invoice',
        onConfirm
      );
    },

    /**
     * Confirm cancelling the open Square invoice
     */
    confirmCancelInvoice(onConfirm) {
      confirmDanger(
        'Cancel this invoice?',
        "The client's invoice link will stop working.",
        'Cancel invoice',
        onConfirm,
        'Keep invoice'
      );
    },

    /**
     * Confirm recording a payment that is larger than the balance due (balanceText e.g. "$120.00")
     */
    confirmOverBalance(balanceText, onConfirm) {
      confirmChange(
        'Record more than the balance?',
        `This is more than the ${balanceText} balance due. Record anyway?`,
        'Record anyway',
        onConfirm
      );
    },

    /**
     * Confirm deleting a contact enquiry
     */
    confirmRemoveLead(name, onConfirm) {
      confirmDanger(
        'Delete enquiry?',
        `This permanently deletes the enquiry from ${name || 'this sender'}. This cannot be undone.`,
        'Delete',
        onConfirm,
        'Keep'
      );
    },

    /**
     * Confirm hiding or showing one photo on the public site
     */
    confirmTogglePhoto(imageLabel, willShow, onConfirm) {
      const label = imageLabel || 'this photo';
      confirmChange(
        willShow ? 'Show photo on site?' : 'Hide photo from site?',
        willShow
          ? `“${label}” will appear on the site again right away.`
          : `“${label}” will be hidden from the site right away. It stays here in the Photo library.`,
        willShow ? 'Show on site' : 'Hide from site',
        onConfirm
      );
    },

    /**
     * Confirm hiding the last visible photo of a section (the site then falls back to its built-in photos)
     */
    confirmHideLastPhoto(sectionLabel, onConfirm) {
      confirmChange(
        'Hide the last photo?',
        `This is the last photo shown in ${sectionLabel || 'this section'}. The site will show its built-in photos for this section until you show or add one.`,
        'Hide from site',
        onConfirm
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
