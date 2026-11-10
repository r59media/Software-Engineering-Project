// @ts-nocheck
/**
 * R59 Media Admin — Forgot password and reset links (R59.passwordReset)
 *
 * Public: runs on the login card before sign-in, so it is not a gated page script.
 *   Sign in       #loginForm  (app.js owns the submit)
 *   Forgot        #forgotForm POST /api/admin/forgot-password; always shows the same answer.
 *                 "Forgot password?" (#forgotOpen) shows only when
 *                 GET /api/admin/password-reset/available says { available: true }.
 *   Reset         #resetForm  from a /admin/#reset=<token> link; POST /api/admin/reset-password.
 * The token is read from the fragment once, removed from the address bar straight away
 * (history.replaceState) and kept only in this closure: never in storage, the URL or logs.
 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const R = () => window.R59;
  const withPeriod = s => {
    const t = String(s || '').trim();
    return !t ? '' : (/[.!?]$/.test(t) ? t : `${t}.`);
  };

  const PW_MIN = 8;
  const PW_MAX = 128;
  const EMAIL_MAX = 254;
  const EMAIL_RULE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  const TOKEN_RULE = /^[0-9a-f]{64}$/;
  const SENT_MESSAGE = 'If that address is the recovery email, a reset link has been sent.';
  const INVALID_TOKEN_MESSAGE = 'This reset link is invalid or has expired. Request a new one.';
  const UPDATED_MESSAGE = 'Password updated. Sign in with your new password.';

  const FORMS = { signin: '#loginForm', forgot: '#forgotForm', reset: '#resetForm' };
  const TITLES = { signin: 'loginTitle', forgot: 'forgotTitle', reset: 'resetTitle' };

  let mode = 'signin';
  let resetToken = '';
  let busy = false;
  const serverErrors = new WeakMap();

  /* ---------- Small helpers ---------- */

  function setText(sel, message) {
    const el = $(sel);
    if (el) el.textContent = message || '';
  }

  function setNotice(sel, message) {
    const el = $(sel);
    if (!el) return;
    const span = el.querySelector('span');
    if (span) span.textContent = message || '';
    el.hidden = !message;
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

  const errorOf = err => (err && err.data && err.data.error) || null;

  /* ---------- Modes ---------- */

  function setMode(next) {
    mode = next;
    Object.entries(FORMS).forEach(([key, sel]) => {
      const form = $(sel);
      if (form) form.hidden = key !== next;
    });
    $('#login')?.setAttribute('aria-labelledby', TITLES[next]);
  }

  /** Back to the Sign in form (also called by app.js showLogin). notice: a success line to show. */
  function showSignIn({ notice = '' } = {}) {
    if (mode !== 'signin') {
      // Blur first so a field's blur check can't leave a message behind in the hidden form
      const active = document.activeElement;
      const open = $(FORMS[mode]);
      if (active && open && open.contains(active) && typeof active.blur === 'function') active.blur();
    }
    setMode('signin');
    clearInputs(['#fpEmail', '#rpNew', '#rpConfirm']);
    setText('#forgotError', '');
    setNotice('#forgotNotice', '');
    setText('#resetError', '');
    setResetInvalid(false);
    setNotice('#loginNotice', notice);
  }

  function setResetInvalid(invalid) {
    ['#resetForm .field', '#resetSave', '#resetHint'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.hidden = invalid; });
    });
  }

  function openForgot() {
    setText('#loginError', '');
    setNotice('#loginNotice', '');
    setMode('forgot');
    const typed = ($('#lu')?.value || '').trim();
    const email = $('#fpEmail');
    if (email && !email.value && typed) email.value = typed;
    email?.focus();
  }

  /* ---------- Availability ---------- */

  async function checkAvailability() {
    const btn = $('#forgotOpen');
    if (!btn) return;
    try {
      const data = await R().apiClient.request('/admin/password-reset/available', { suppressUnauthorized: true });
      btn.hidden = !(data && data.available === true);
    } catch {
      btn.hidden = true;
    }
  }

  /* ---------- Forgot password ---------- */

  async function submitForgot() {
    if (busy) return;
    const fv = R().formValidation;
    const input = $('#fpEmail');
    const btn = $('#forgotSend');
    setText('#forgotError', '');
    setNotice('#forgotNotice', '');
    serverErrors.delete(input);
    if (fv ? !fv.validate(input) : !EMAIL_RULE.test(input.value.trim())) {
      input.focus();
      return;
    }

    busy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      const data = await R().apiClient.request('/admin/forgot-password', {
        method: 'POST',
        body: { email: input.value.trim() },
        suppressUnauthorized: true
      });
      setNotice('#forgotNotice', (data && data.message) || SENT_MESSAGE);
    } catch (err) {
      setText('#forgotError', withPeriod(err && err.message) || "Couldn't send the reset link. Try again.");
    } finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Send reset link'; }
    }
  }

  /* ---------- Reset from a link ---------- */

  /** Reads #reset=<token> once at startup. Returns true when the reset form took over the login card. */
  function startFromLink() {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#reset=')) return false;
    const token = hash.slice('#reset='.length).toLowerCase();
    // Out of the address bar and history entry now; the token lives only in this closure
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      window.location.hash = '';
    }

    R().app?.setWorkspaceAuthenticated?.(false);
    $('#login')?.classList.add('open');
    setMode('reset');
    setText('#resetError', '');
    if (TOKEN_RULE.test(token)) {
      resetToken = token;
      setResetInvalid(false);
      setTimeout(() => $('#rpNew')?.focus(), 50);
    } else {
      resetToken = '';
      showInvalidToken(INVALID_TOKEN_MESSAGE);
    }
    return true;
  }

  function showInvalidToken(message) {
    resetToken = '';
    clearInputs(['#rpNew', '#rpConfirm']);
    setResetInvalid(true);
    setText('#resetError', message || INVALID_TOKEN_MESSAGE);
    setTimeout(() => $('#resetTitle')?.focus(), 50);
  }

  async function submitReset() {
    if (busy) return;
    const fv = R().formValidation;
    const next = $('#rpNew');
    const confirm = $('#rpConfirm');
    const btn = $('#resetSave');
    setText('#resetError', '');
    [next, confirm].forEach(input => serverErrors.delete(input));
    const results = [next, confirm].map(input => (fv ? fv.validate(input) : true));
    const firstInvalid = [next, confirm][results.indexOf(false)];
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    if (!resetToken) {
      showInvalidToken(INVALID_TOKEN_MESSAGE);
      return;
    }

    busy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
    try {
      await R().apiClient.request('/admin/reset-password', {
        method: 'POST',
        body: { token: resetToken, newPassword: next.value },
        suppressUnauthorized: true
      });
      resetToken = '';
      showSignIn({ notice: UPDATED_MESSAGE });
      const user = $('#lu');
      if (user && !user.value) user.focus();
      else $('#lp')?.focus();
    } catch (err) {
      const apiError = errorOf(err);
      const detail = apiError && Array.isArray(apiError.details) ? apiError.details[0] : null;
      if (err && err.status === 400 && apiError && apiError.code === 'INVALID_RESET_TOKEN') {
        showInvalidToken(withPeriod(apiError.message) || INVALID_TOKEN_MESSAGE);
      } else if (err && err.status === 400 && detail && detail.field === 'newPassword') {
        showFieldError(next, withPeriod(detail.message || err.message));
      } else {
        setText('#resetError', withPeriod(err && err.message) || "Couldn't update the password. Try again.");
      }
    } finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Update password'; }
    }
  }

  function backToSignIn() {
    const fromReset = mode === 'reset';
    resetToken = '';
    showSignIn();
    if (fromReset) {
      // The reset form replaced the startup session check: run it now (it shows Sign in, or the app)
      R().app?.checkSession?.();
    } else {
      $('#lu')?.focus();
    }
  }

  /* ---------- Init ---------- */

  function initValidation() {
    const fv = R().formValidation;
    const email = $('#fpEmail');
    const next = $('#rpNew');
    const confirm = $('#rpConfirm');
    if (!fv || !email || !next || !confirm) return;

    [email, next, confirm].forEach(input => {
      input.addEventListener('input', () => serverErrors.delete(input));
    });
    fv.bind(email, withServerError(email, {
      message: v => (String(v).trim() === '' ? 'Enter your recovery email.' : 'Enter an email like name@example.com.'),
      validate: v => {
        const t = String(v).trim();
        return t !== '' && t.length <= EMAIL_MAX && EMAIL_RULE.test(t);
      },
      attrs: { required: true }
    }));
    // Passwords are never trimmed
    fv.bind(next, withServerError(next, {
      message: v => (v.length < PW_MIN ? `Use at least ${PW_MIN} characters.` : `Use at most ${PW_MAX} characters.`),
      validate: v => v.length >= PW_MIN && v.length <= PW_MAX,
      attrs: { required: true }
    }));
    fv.bind(confirm, withServerError(confirm, {
      message: v => (v === '' ? 'Enter the new password again.' : "The passwords don't match."),
      validate: v => v !== '' && v === next.value,
      attrs: { required: true }
    }));
    next.addEventListener('input', () => fv.revalidate(confirm));
  }

  function init() {
    initValidation();
    $('#forgotOpen')?.addEventListener('click', openForgot);
    $('#forgotForm')?.addEventListener('submit', e => {
      e.preventDefault();
      submitForgot();
    });
    $('#resetForm')?.addEventListener('submit', e => {
      e.preventDefault();
      submitReset();
    });
    document.querySelectorAll('#login [data-signin]').forEach(btn => btn.addEventListener('click', backToSignIn));
    // A new sign-in attempt replaces the "Password updated" line
    $('#loginForm')?.addEventListener('submit', () => setNotice('#loginNotice', ''));
    checkAvailability();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.R59 = window.R59 || {};
  window.R59.passwordReset = { startFromLink, showSignIn, checkAvailability };
})();
