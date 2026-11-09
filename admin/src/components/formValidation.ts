// @ts-nocheck
/**
 * R59 Media Admin — Form Validation
 *
 * Predicates shared by every view, plus inline field validation built on native constraint
 * validation (`setCustomValidity`). A bound field validates on blur, then live while invalid,
 * sets `aria-invalid`, and shows its message in `#<id>-error` (a `.field__error`).
 */

(function () {
  'use strict';

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const isEmpty = v => v === null || v === undefined || String(v).trim() === '';

  const formValidation = {
    isValidEmail(email) {
      return EMAIL_REGEX.test(String(email || '').trim());
    },

    isValidPhone(phone) {
      const digits = String(phone || '').replace(/\D/g, '');
      return digits.length >= 10;
    },

    cleanPhone(phone) {
      return String(phone || '').replace(/\D/g, '');
    },

    isValidPrice(val) {
      if (isEmpty(val)) return false;
      const num = Number(val);
      return !isNaN(num) && num >= 0;
    },

    isValidPercentage(val) {
      if (isEmpty(val)) return false;
      const num = Number(val);
      return Number.isInteger(num) && num >= 1 && num <= 100;
    },

    isValidISODate(dateStr) {
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
      const [y, m, d] = dateStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
    },

    isValidCouponCode(code) {
      return /^[A-Z0-9_-]+$/.test(String(code || '').trim().toUpperCase());
    },

    /** https-only: the public footer drops any link that is not https */
    isValidUrl(url) {
      if (!url) return false;
      try {
        const parsed = new URL(String(url).trim());
        return parsed.protocol === 'https:' && parsed.hostname.includes('.');
      } catch {
        return false;
      }
    },

    escapeHtml(str) {
      return String(str ?? '').replace(/[&<>'"`]/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '`': '&#96;'
      }[c]));
    }
  };

  const fv = formValidation;

  /* ---------- Session length (hours + minutes, or Entire day) ---------- */
  const SESSION_LENGTH_MESSAGE = 'Enter a session length of at least 15 minutes (up to 24 h).';
  const SESSION_MINUTES_MESSAGE = 'Minutes must be from 0 to 59.';

  /** Total minutes from the hours and minutes fields (an empty field counts as 0); '' when both are empty. */
  function sessionMinutes(hours, minutes) {
    if (isEmpty(hours) && isEmpty(minutes)) return '';
    const h = isEmpty(hours) ? 0 : Number(String(hours).trim());
    const m = isEmpty(minutes) ? 0 : Number(String(minutes).trim());
    return h * 60 + m;
  }

  const isSessionLength = total => isWholeInRange(total, 15, 1440);

  /* ---------- Rules (messages from the design doc "Validation rules" table) ---------- */
  const rules = {
    email: {
      message: 'Enter an email like name@example.com.',
      validate: v => isEmpty(v) || fv.isValidEmail(v),
      attrs: { inputMode: 'email' }
    },
    phone: {
      message: 'Enter a phone number with at least 10 digits.',
      validate: v => isEmpty(v) || fv.isValidPhone(v),
      attrs: { inputMode: 'tel' }
    },
    bio: {
      message: 'Keep the biography under 1,200 characters.',
      validate: v => String(v ?? '').length <= 1200
    },
    socialPlatform: {
      message: 'Enter the platform name.',
      validate: v => !isEmpty(v) && String(v).trim().length <= 40,
      attrs: { required: true }
    },
    socialUrl: {
      message: 'Enter the full address starting with https://',
      validate: v => fv.isValidUrl(v),
      attrs: { required: true, inputMode: 'url' }
    },
    money: {
      message: 'Enter an amount of 0 or more.',
      validate: v => fv.isValidPrice(v),
      attrs: { required: true, min: '0' }
    },
    percent: {
      message: 'Enter a whole number from 1 to 100',
      validate: v => fv.isValidPercentage(v),
      attrs: { required: true, min: '1', max: '100' }
    },
    packageName: {
      message: 'Give the package a name.',
      validate: v => !isEmpty(v),
      attrs: { required: true }
    },
    packagePrice: {
      message: 'Enter a price of 0 or more.',
      validate: v => fv.isValidPrice(v),
      attrs: { required: true, min: '0' }
    },
    packageOutfits: {
      message: 'Enter a whole number of outfits from 0 to 50, or leave it empty.',
      validate: v => isEmpty(v) || isWholeInRange(v, 0, 50),
      attrs: { min: '0', max: '50' }
    },
    /** Value-level check of a stored total (the review fallback when the fields are not rendered). */
    packageDuration: {
      message: SESSION_LENGTH_MESSAGE,
      validate: v => isSessionLength(v)
    }
  };

  /**
   * Rules for one Session length group: the hours field carries the total-length message, the
   * minutes field its own 0–59 message. With "Entire day" ticked both pass (the fields are disabled).
   */
  function sessionLengthRules(hoursEl, minutesEl, fullDayEl) {
    const off = () => Boolean(fullDayEl && fullDayEl.checked);
    const minutesOk = v => isEmpty(v) || isWholeInRange(v, 0, 59);
    return {
      hours: {
        message: SESSION_LENGTH_MESSAGE,
        // a bad minutes value is reported on the minutes field only
        validate: v => off() || !minutesOk(minutesEl ? minutesEl.value : '') ||
          ((isEmpty(v) || isWholeInRange(v, 0, 24)) && isSessionLength(sessionMinutes(v, minutesEl ? minutesEl.value : ''))),
        attrs: { inputMode: 'numeric', min: '0', max: '24' }
      },
      minutes: {
        message: SESSION_MINUTES_MESSAGE,
        validate: v => off() || minutesOk(v),
        attrs: { inputMode: 'numeric', min: '0', max: '59' }
      }
    };
  }

  function isWholeInRange(v, min, max) {
    if (isEmpty(v)) return false;
    const n = Number(String(v).trim());
    return Number.isInteger(n) && n >= min && n <= max;
  }

  /* ---------- Required once saved ---------- */
  const KEEP_SAVED_MESSAGE = "This can't be empty once it has been saved. Enter a new value instead.";

  /**
   * A field that already has a saved value can be changed but not emptied. `savedValue` is the
   * value in the saved snapshot; when it is empty the field keeps `baseRule` (or no rule) only.
   * Call again whenever the saved snapshot changes (after load, after a save).
   */
  function keepSavedRule(baseRule, savedValue) {
    const base = resolveRule(baseRule);
    const locked = !isEmpty(savedValue);
    return {
      locked,
      attrs: base?.attrs,
      validate: v => !(locked && isEmpty(v)) && (!base || base.validate(v)),
      message: v => (locked && isEmpty(v) ? KEEP_SAVED_MESSAGE : (base?.message || 'Check this field.'))
    };
  }

  function bindKeepSaved(input, baseRule, savedValue) {
    if (!input) return;
    const rule = keepSavedRule(baseRule, savedValue);
    input.required = rule.locked;
    bind(input, rule);
    // keep a message that is already on screen in step with the new rule
    if (input.getAttribute('aria-invalid') === 'true') validate(input);
  }

  /* ---------- Inline field validation ---------- */
  const bound = new WeakMap();      // input -> rule
  const lastValid = new WeakMap();  // input -> boolean

  const resolveRule = rule => (typeof rule === 'string' ? rules[rule] : rule);

  function errorElFor(input) {
    if (!input.id) return null;
    const errId = `${input.id}-error`;
    let el = document.getElementById(errId);
    if (el) return el;
    el = document.createElement('p');
    el.className = 'field__error';
    el.id = errId;
    el.hidden = true;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-alert');
    svg.appendChild(use);
    el.appendChild(svg);
    el.appendChild(document.createElement('span'));
    const anchor = input.closest('.field__control') || input;
    anchor.insertAdjacentElement('afterend', el);
    return el;
  }

  function setDescribedBy(input, id, on) {
    const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const has = ids.includes(id);
    if (on && !has) ids.push(id);
    if (!on && has) ids.splice(ids.indexOf(id), 1);
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
    else input.removeAttribute('aria-describedby');
  }

  /** Updates custom validity silently; returns the message ('' when valid). */
  function applyValidity(input) {
    const rule = bound.get(input);
    input.setCustomValidity('');
    if (rule && !rule.validate(input.value)) {
      const message = typeof rule.message === 'function' ? rule.message(input.value) : rule.message;
      input.setCustomValidity(message);
      return message;
    }
    return input.checkValidity() ? '' : (input.validationMessage || 'Check this field.');
  }

  function showError(input, message) {
    const el = errorElFor(input);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    if (!el) return;
    const span = el.querySelector('span');
    if (span) span.textContent = message;
    else el.textContent = message;
    el.hidden = !message;
    setDescribedBy(input, el.id, Boolean(message));
  }

  function noteValidity(input, valid) {
    if (lastValid.get(input) !== valid) {
      lastValid.set(input, valid);
      window.R59.state?.recompute?.();
    }
  }

  /** Validates now and shows or clears the message. Returns true when valid. */
  function validate(input) {
    if (!input) return true;
    const message = applyValidity(input);
    showError(input, message);
    noteValidity(input, !message);
    return !message;
  }

  /** Binds a rule (name or { message, validate }) to an input. Safe to call more than once. */
  function bind(input, ruleArg) {
    const rule = resolveRule(ruleArg);
    if (!input || !rule) return;
    const firstBind = !bound.has(input);
    bound.set(input, rule);

    const attrs = rule.attrs || {};
    if (attrs.inputMode && !input.getAttribute('inputmode')) input.setAttribute('inputmode', attrs.inputMode);
    if (attrs.required) input.required = true;
    if (attrs.min !== undefined && input.type === 'number' && !input.hasAttribute('min')) input.min = attrs.min;
    if (attrs.max !== undefined && input.type === 'number' && !input.hasAttribute('max')) input.max = attrs.max;

    lastValid.set(input, !applyValidity(input));

    if (!firstBind) return;
    input.addEventListener('blur', () => validate(input));
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') {
        validate(input);
      } else {
        noteValidity(input, !applyValidity(input));
      }
    });
  }

  /**
   * Re-checks a field whose rule depends on another field: shows or clears the message when one is
   * already on screen, otherwise updates its validity silently (as a bound field does on input).
   */
  function revalidate(input) {
    if (!input) return true;
    if (input.getAttribute('aria-invalid') === 'true') return validate(input);
    const message = applyValidity(input);
    noteValidity(input, !message);
    return !message;
  }

  formValidation.rules = rules;
  formValidation.bind = bind;
  formValidation.validate = validate;
  formValidation.revalidate = revalidate;
  formValidation.sessionMinutes = sessionMinutes;
  formValidation.isSessionLength = isSessionLength;
  formValidation.sessionLengthRules = sessionLengthRules;
  formValidation.SESSION_LENGTH_MESSAGE = SESSION_LENGTH_MESSAGE;
  formValidation.SESSION_MINUTES_MESSAGE = SESSION_MINUTES_MESSAGE;
  formValidation.keepSavedRule = keepSavedRule;
  formValidation.bindKeepSaved = bindKeepSaved;
  formValidation.KEEP_SAVED_MESSAGE = KEEP_SAVED_MESSAGE;

  window.R59 = window.R59 || {};
  window.R59.formValidation = formValidation;
  window.esc = formValidation.escapeHtml;
})();
