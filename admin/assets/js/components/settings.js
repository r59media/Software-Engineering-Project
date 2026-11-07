/**
 * R59 Media Admin — Settings dialog (R59.account)
 *
 * #settingsModal has two record-action sections, neither part of Review & save:
 *   Change password — PUT /api/admin/password (closes the dialog on success).
 *   Recovery email  — GET /api/admin/account, PUT /api/admin/recovery-email (immediate, pessimistic:
 *                     the shown address changes only after the server confirms).
 * Both need the current password, use suppressUnauthorized (a wrong password is an inline field
 * error, not a sign-out) and never trim passwords. Every field is cleared when the dialog closes.
 * Public file: it holds no data and only talks to signed-in endpoints when the dialog is opened.
 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const R = () => window.R59;
  const toast = (msg, opts) => window.R59.notifications?.toast?.(msg, opts);
  const withPeriod = s => {
    const t = String(s || '').trim();
    return !t ? '' : (/[.!?]$/.test(t) ? t : `${t}.`);
  };

  const PW_MIN = 8;
  const PW_MAX = 128;
  const EMAIL_MAX = 254;
  const EMAIL_RULE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  const EMAIL_MESSAGE = 'Enter an email like name@example.com.';
  const WRONG_PASSWORD = 'Current password is incorrect.';

  const PW_INPUTS = ['#pwCurrent', '#pwNew', '#pwConfirm'];
  const REC_INPUTS = ['#recEmail', '#recPassword'];
  const PW_FIELDS = { currentPassword: '#pwCurrent', newPassword: '#pwNew' };
  const REC_FIELDS = { email: '#recEmail', currentPassword: '#recPassword' };

  let opener = null;
  let passwordBusy = false;
  let recoveryBusy = false;
  let loadSeq = 0;
  const recovery = { status: 'idle', email: '', configured: false };
  // A server message shown on a field until that field is edited again
  const serverErrors = new WeakMap();

  const modalEl = () => $('#settingsModal');
  const isOpen = () => Boolean(modalEl()?.classList.contains('open'));

  /* ---------- Shared field helpers ---------- */

  /** Wraps a client rule so a server message on that field wins until the field is edited. */
  function withServerError(input, rule) {
    return {
      attrs: rule.attrs,
      validate: v => !serverErrors.has(input) && rule.validate(v),
      message: v => serverErrors.get(input) || (typeof rule.message === 'function' ? rule.message(v) : rule.message)
    };
  }

  function showFieldError(input, message) {
    if (!input) return;
    serverErrors.set(input, message);
    R().formValidation?.validate?.(input);
    input.focus();
  }

  function clearInputs(selectors) {
    selectors.forEach(sel => {
      const input = $(sel);
      if (!input) return;
      input.value = '';
      serverErrors.delete(input);
      input.setCustomValidity('');
      input.removeAttribute('aria-invalid');
      const err = document.getElementById(`${input.id}-error`);
      if (err) {
        const span = err.querySelector('span');
        if (span) span.textContent = '';
        err.hidden = true;
      }
      const describedBy = (input.getAttribute('aria-describedby') || '')
        .split(/\s+/).filter(id => id && id !== `${input.id}-error`);
      if (describedBy.length) input.setAttribute('aria-describedby', describedBy.join(' '));
      else input.removeAttribute('aria-describedby');
    });
  }

  function setText(sel, message) {
    const el = $(sel);
    if (el) el.textContent = message || '';
  }

  /** First detail of an API error: { field, code, message } or null. */
  const detailOf = err => (err && err.data && err.data.error && Array.isArray(err.data.error.details)
    ? err.data.error.details[0] || null
    : null);

  function sessionEnded(err) {
    window.dispatchEvent(new CustomEvent('r59:unauthorized', { detail: { message: err && err.message } }));
  }

  /* ---------- Validation ---------- */

  function initValidation() {
    const fv = R().formValidation;
    const current = $('#pwCurrent');
    const next = $('#pwNew');
    const confirm = $('#pwConfirm');
    const recEmail = $('#recEmail');
    const recPassword = $('#recPassword');
    if (!fv || !current || !next || !confirm || !recEmail || !recPassword) return;

    // Registered before bind() so a server message is gone when formValidation re-checks on input
    [current, next, confirm, recEmail, recPassword].forEach(input => {
      input.addEventListener('input', () => serverErrors.delete(input));
    });

    // Passwords are never trimmed
    fv.bind(current, withServerError(current, {
      message: 'Enter your current password.',
      validate: v => v !== '',
      attrs: { required: true }
    }));
    fv.bind(next, withServerError(next, {
      message: v => {
        if (v.length < PW_MIN) return `Use at least ${PW_MIN} characters.`;
        if (v.length > PW_MAX) return `Use at most ${PW_MAX} characters.`;
        return 'Choose a password different from the current one.';
      },
      validate: v => v.length >= PW_MIN && v.length <= PW_MAX && v !== current.value,
      attrs: { required: true }
    }));
    fv.bind(confirm, withServerError(confirm, {
      message: v => (v === '' ? 'Enter the new password again.' : "The passwords don't match."),
      validate: v => v !== '' && v === next.value,
      attrs: { required: true }
    }));
    current.addEventListener('input', () => fv.revalidate(next));
    next.addEventListener('input', () => fv.revalidate(confirm));

    // Empty is allowed on blur (Remove doesn't use this field); Save checks for empty itself
    fv.bind(recEmail, withServerError(recEmail, {
      message: v => (String(v).trim().length > EMAIL_MAX ? 'Use at most 254 characters.' : EMAIL_MESSAGE),
      validate: v => {
        const t = String(v).trim();
        return t === '' || (t.length <= EMAIL_MAX && EMAIL_RULE.test(t));
      }
    }));
    fv.bind(recPassword, withServerError(recPassword, {
      message: 'Enter your current password.',
      validate: v => v !== '',
      attrs: { required: true }
    }));
  }

  /* ---------- Recovery email: render and load ---------- */

  function renderRecovery() {
    const current = $('#recoveryCurrent');
    const loading = recovery.status === 'loading';
    const failed = recovery.status === 'failed';
    const loaded = recovery.status === 'loaded';
    if (current) {
      let text = 'Loading…';
      if (failed) text = "Couldn't load";
      else if (loaded) text = recovery.email || 'Not set';
      current.textContent = text;
      current.classList.toggle('is-empty', !(loaded && recovery.email));
    }
    const retry = $('#recoveryRetry');
    if (retry) {
      retry.hidden = !failed;
      retry.disabled = false;
    }
    const note = $('#recoveryNote');
    if (note) note.hidden = !(loaded && !recovery.configured);

    const remove = $('#recRemove');
    if (remove) {
      remove.hidden = !(loaded && recovery.email);
      remove.disabled = recoveryBusy;
      if (!recoveryBusy) remove.textContent = 'Remove';
    }
    const save = $('#recSave');
    if (save) {
      save.disabled = recoveryBusy || !loaded;
      if (!recoveryBusy) save.textContent = 'Save email';
    }
    const recEmail = $('#recEmail');
    if (recEmail) {
      const label = $('label[for="recEmail"]');
      if (label) label.textContent = loaded && recovery.email ? 'New recovery email' : 'Recovery email';
    }
  }

  async function loadRecovery() {
    const seq = ++loadSeq;
    recovery.status = 'loading';
    setText('#recoveryLoadError', '');
    renderRecovery();
    try {
      const data = await R().apiClient.request('/admin/account', { suppressUnauthorized: true });
      if (seq !== loadSeq) return;
      recovery.email = typeof data?.recovery_email === 'string' ? data.recovery_email : '';
      recovery.configured = data?.email_configured === true;
      recovery.status = 'loaded';
    } catch (err) {
      if (seq !== loadSeq) return;
      if (err && err.status === 401) {
        sessionEnded(err);
        return;
      }
      recovery.status = 'failed';
      if (isOpen()) {
        setText('#recoveryLoadError', withPeriod(err && err.message) || "Couldn't load the recovery email. Try again.");
      }
    }
    renderRecovery();
  }

  /* ---------- Change password ---------- */

  function setPasswordBusy(busy) {
    passwordBusy = busy;
    const btn = $('#pwSave');
    if (btn) {
      btn.disabled = busy;
      btn.textContent = busy ? 'Updating…' : 'Update password';
    }
  }

  async function submitPassword() {
    if (passwordBusy) return;
    const fv = R().formValidation;
    const [current, next, confirm] = PW_INPUTS.map(sel => $(sel));
    setText('#pwError', '');

    // A new attempt re-checks the client rules only
    [current, next, confirm].forEach(input => serverErrors.delete(input));
    const results = [current, next, confirm].map(input => (fv ? fv.validate(input) : true));
    const firstInvalid = [current, next, confirm][results.indexOf(false)];
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setPasswordBusy(true);
    try {
      await R().apiClient.request('/admin/password', {
        method: 'PUT',
        body: { currentPassword: current.value, newPassword: next.value },
        suppressUnauthorized: true
      });
      if (isOpen()) closeSettings();
      toast('Password updated.', { type: 'success' });
    } catch (err) {
      const status = err && err.status;
      const detail = detailOf(err);
      const message = withPeriod(err && err.message) || "Couldn't update the password. Try again.";
      if (status === 401) {
        if (detail && detail.code === 'INVALID_CREDENTIALS') {
          if (isOpen()) showFieldError(current, WRONG_PASSWORD);
        } else {
          sessionEnded(err); // the login screen opens (and closes this dialog)
        }
      } else if (isOpen()) {
        const fieldSel = status === 400 && detail ? PW_FIELDS[detail.field] : null;
        if (fieldSel) showFieldError($(fieldSel), message);
        else setText('#pwError', message);
      }
    } finally {
      setPasswordBusy(false);
    }
  }

  /* ---------- Recovery email: save and remove (record actions) ---------- */

  function setRecoveryBusy(busy, removing = false) {
    recoveryBusy = busy;
    renderRecovery();
    const btn = $(removing ? '#recRemove' : '#recSave');
    if (busy && btn) btn.textContent = removing ? 'Removing…' : 'Saving…';
  }

  async function sendRecovery(email) {
    const recPassword = $('#recPassword');
    const removing = email === '';
    setRecoveryBusy(true, removing);
    try {
      const data = await R().apiClient.request('/admin/recovery-email', {
        method: 'PUT',
        body: { email, currentPassword: recPassword.value },
        suppressUnauthorized: true
      });
      recovery.email = typeof data?.recovery_email === 'string' ? data.recovery_email : email.toLowerCase();
      recovery.status = 'loaded';
      if (isOpen()) {
        const focusTarget = $('#recEmail');
        clearInputs(REC_INPUTS);
        renderRecovery();
        focusTarget?.focus();
      }
      toast(removing ? 'Recovery email removed.' : 'Recovery email saved.', { type: 'success' });
    } catch (err) {
      const status = err && err.status;
      const detail = detailOf(err);
      const message = withPeriod(err && err.message)
        || (removing ? "Couldn't remove the recovery email. Try again." : "Couldn't save the recovery email. Try again.");
      if (status === 401) {
        if (detail && detail.code === 'INVALID_CREDENTIALS') {
          if (isOpen()) showFieldError(recPassword, WRONG_PASSWORD);
        } else {
          sessionEnded(err);
        }
      } else {
        const fieldSel = status === 400 && detail ? REC_FIELDS[detail.field] : null;
        if (isOpen() && fieldSel) {
          showFieldError($(fieldSel), message);
        } else {
          if (isOpen()) setText('#recError', message);
          toast(message, { type: 'error' });
        }
      }
    } finally {
      setRecoveryBusy(false);
    }
  }

  function submitRecovery() {
    if (recoveryBusy || recovery.status !== 'loaded') return;
    const fv = R().formValidation;
    const recEmail = $('#recEmail');
    const recPassword = $('#recPassword');
    setText('#recError', '');
    [recEmail, recPassword].forEach(input => serverErrors.delete(input));

    const email = recEmail.value.trim();
    let emailOk = fv ? fv.validate(recEmail) : true;
    if (emailOk && email === '') {
      serverErrors.set(recEmail, 'Enter the recovery email address.');
      if (fv) fv.validate(recEmail);
      emailOk = false;
    } else if (emailOk && email.toLowerCase() === recovery.email) {
      serverErrors.set(recEmail, 'That is already your recovery email.');
      if (fv) fv.validate(recEmail);
      emailOk = false;
    }
    const passwordOk = fv ? fv.validate(recPassword) : recPassword.value !== '';
    if (!emailOk) { recEmail.focus(); return; }
    if (!passwordOk) { recPassword.focus(); return; }
    sendRecovery(email);
  }

  function removeRecovery() {
    if (recoveryBusy || recovery.status !== 'loaded' || !recovery.email) return;
    const fv = R().formValidation;
    const recPassword = $('#recPassword');
    setText('#recError', '');
    serverErrors.delete(recPassword);
    // Remove ignores the email field: drop a Save-only message ("Enter the recovery email address.")
    const recEmail = $('#recEmail');
    if (recEmail && serverErrors.has(recEmail)) {
      serverErrors.delete(recEmail);
      if (fv) fv.validate(recEmail);
    }
    if (fv ? !fv.validate(recPassword) : recPassword.value === '') {
      recPassword.focus();
      return;
    }
    R().confirmation?.confirmDanger
      ? R().confirmation.confirmDanger(
        'Remove recovery email?',
        `${recovery.email} will no longer be used to reset your password. Any reset link already sent stops working.`,
        'Remove',
        () => sendRecovery('')
      )
      : sendRecovery('');
  }

  /* ---------- Open / close ---------- */

  function closeMenuPanel() {
    const menuPanel = $('#menuPanel');
    if (menuPanel && !menuPanel.hidden) {
      menuPanel.hidden = true;
      $('#menuBtn')?.setAttribute('aria-expanded', 'false');
    }
  }

  function clearAll() {
    clearInputs(PW_INPUTS);
    clearInputs(REC_INPUTS);
    setText('#pwError', '');
    setText('#recError', '');
    setText('#recoveryLoadError', '');
  }

  function openSettings(from) {
    const el = modalEl();
    if (!el) return;
    const source = from || document.activeElement;
    // An opener inside the Menu panel is hidden once the panel closes: return focus to Menu instead
    opener = source && $('#menuPanel')?.contains(source) ? $('#menuBtn') : source;
    closeMenuPanel();
    clearAll();
    const user = $('#pwUser');
    if (user) user.value = $('#lu')?.value.trim() || '';
    el.classList.add('open');
    $('#pwCurrent')?.focus();
    loadRecovery();
  }

  function closeSettings({ restoreFocus = true } = {}) {
    const el = modalEl();
    if (!el) return;
    // Move focus out first: blurring a field runs its validation, which must happen before the
    // form is cleared, or a stale "Enter the new password again." stays in the closed dialog
    const active = document.activeElement;
    if (active && el.contains(active) && typeof active.blur === 'function') active.blur();
    el.classList.remove('open');
    loadSeq++; // a load still in flight must not write into the closed dialog
    recovery.status = 'idle';
    const back = opener;
    opener = null;
    if (restoreFocus && back && typeof back.focus === 'function' && back.isConnected && back.offsetParent !== null) {
      back.focus();
    }
    clearAll(); // passwords must not linger in the page (also resets the field errors)
    renderRecovery();
  }

  function init() {
    initValidation();
    renderRecovery();

    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-settings]');
      if (!btn) return;
      e.preventDefault();
      openSettings(btn);
    });

    $('#passwordForm')?.addEventListener('submit', e => {
      e.preventDefault();
      submitPassword();
    });
    $('#recoveryForm')?.addEventListener('submit', e => {
      e.preventDefault();
      submitRecovery();
    });
    $('#recRemove')?.addEventListener('click', removeRecovery);
    $('#recoveryRetry')?.addEventListener('click', loadRecovery);
    $('#settingsClose')?.addEventListener('click', () => closeSettings());
    modalEl()?.addEventListener('click', e => {
      if (e.target.id === 'settingsModal') closeSettings();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  window.R59 = window.R59 || {};
  window.R59.account = { openSettings, closeSettings };
})();
