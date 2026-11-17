// @ts-nocheck
/**
 * R59 Media Admin — Review changes
 *
 * diff(saved, current) turns two settings snapshots (state.js shape) into review rows:
 *   { area, key, label, oldText, newText, invalid, message, fieldId, view, kind }
 * Only areas present in BOTH snapshots are compared (state.js leaves out areas that did not load).
 * kind: 'change' (old → new), 'edited' (biography), 'added' / 'removed' (social links).
 * Social links are free-form rows keyed by their client-side `_id` (state.js newSocialId);
 * a row with both fields blank is ignored here and dropped on save.
 *
 * open(rows, onConfirm) fills the native <dialog id="review"> and shows it.
 */

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const EMPTY = '(empty)';

  /* ---------- Normalisation ---------- */
  function norm(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    if (typeof v === 'boolean') return v ? 'true' : '';
    return String(v).trim();
  }

  const sameText = (a, b) => norm(a) === norm(b);

  function sameNumber(a, b) {
    const x = norm(a);
    const y = norm(b);
    if (x === '' || y === '') return x === y;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isNaN(nx) || Number.isNaN(ny)) return x === y;
    return nx === ny;
  }

  function fmtMoney(v) {
    const t = norm(v);
    if (t === '') return EMPTY;
    const n = Number(t);
    if (Number.isNaN(n)) return t;
    const hasCents = Math.round(n * 100) % 100 !== 0;
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 })}`;
  }

  function fmtPercent(v) {
    const t = norm(v);
    if (t === '') return EMPTY;
    const n = Number(t);
    return Number.isNaN(n) ? t : `${n}%`;
  }

  const fmtText = v => norm(v) || EMPTY;

  function fmtOutfits(v) {
    const t = norm(v);
    if (t === '') return EMPTY;
    const n = Number(t);
    return Number.isNaN(n) ? t : `${n} outfit${n === 1 ? '' : 's'}`;
  }

  function fmtPhotoCount(v) {
    const t = norm(v);
    if (t === '') return EMPTY;
    const n = Number(t);
    return Number.isNaN(n) ? t : `${n} photo${n === 1 ? '' : 's'}`;
  }

  const fmtBookingMode = v => (norm(v) === 'inquiry' ? 'Inquiry only' : 'Direct booking');

  function sameJsonText(a, b) {
    const sa = norm(a);
    const sb = norm(b);
    if (sa === sb) return true;
    try {
      const pa = JSON.parse(sa || 'null');
      const pb = JSON.parse(sb || 'null');
      if (pa && pb && typeof pa === 'object' && typeof pb === 'object') {
        const sortKeys = obj => Object.keys(obj).sort().reduce((acc, k) => {
          acc[k] = obj[k];
          return acc;
        }, {});
        return JSON.stringify(sortKeys(pa)) === JSON.stringify(sortKeys(pb));
      }
    } catch { /* fall through */ }
    return false;
  }

  /** Minutes as "45 min", "2 h" or "1 h 30 min". */
  function fmtDuration(v) {
    const t = norm(v);
    if (t === '') return EMPTY;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return t;
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    if (!h) return `${m} min`;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  /** One side of a package's Session length row: "Entire day", "Custom (Inquiry)", or the length as fmtDuration. */
  const isFullDay = pkg => Boolean(pkg) && pkg.full_day === true;
  const isCustomInquirySession = pkg => !isFullDay(pkg) && norm(pkg?.booking_mode) === 'inquiry' && norm(pkg?.duration_minutes) === '';
  const sessionText = pkg => (isFullDay(pkg) ? 'Entire day' : (isCustomInquirySession(pkg) ? 'Custom (Inquiry)' : fmtDuration(pkg && pkg.duration_minutes)));

  function sameSession(o, n) {
    if (isFullDay(o) !== isFullDay(n)) return false;
    return isFullDay(n) || sameNumber(o.duration_minutes, n.duration_minutes);
  }

  function excerpt(v, max = 80) {
    const t = norm(v).replace(/\s+/g, ' ');
    return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
  }

  /* ---------- Availability ---------- */
  function fmtTime(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(norm(t));
    if (!m) return norm(t);
    return `${Number(m[1])}:${m[2]}`;
  }

  const repeatLabel = r => (norm(r) === 'none' ? 'does not repeat' : 'weekly');

  function dayText(day) {
    const tfs = (day && day.available && Array.isArray(day.timeframes)) ? day.timeframes.slice() : [];
    if (!tfs.length) return 'Unavailable';
    tfs.sort((a, b) => norm(a.start).localeCompare(norm(b.start)) || norm(a.end).localeCompare(norm(b.end)));
    const repeats = new Set(tfs.map(tf => repeatLabel(tf.repeat)));
    if (repeats.size === 1) {
      return `${tfs.map(tf => `${fmtTime(tf.start)}–${fmtTime(tf.end)}`).join(', ')} · ${[...repeats][0]}`;
    }
    return tfs.map(tf => `${fmtTime(tf.start)}–${fmtTime(tf.end)} · ${repeatLabel(tf.repeat)}`).join(', ');
  }

  /* ---------- Social ---------- */
  /** Rows keyed by `_id` (in list order); rows with both fields blank are left out. */
  function socialMap(list) {
    const map = new Map();
    (Array.isArray(list) ? list : []).forEach((s, i) => {
      const platform = norm(s && s.platform);
      const url = norm(s && s.url);
      if (!platform && !url) return;
      const key = norm(s && s._id) || `row-${i}`;
      if (!map.has(key)) map.set(key, { platform, url });
    });
    return map;
  }

  /** Text for one side of a social row: the URL, prefixed with the platform when it changed. */
  function socialText(link, otherLink) {
    if (!link) return EMPTY;
    const url = link.url || EMPTY;
    return otherLink && otherLink.platform !== link.platform ? `${link.platform || EMPTY} · ${url}` : url;
  }

  /* ---------- Validity ---------- */
  function fieldValidity(fieldId, ruleName, value) {
    const el = fieldId ? document.getElementById(fieldId) : null;
    if (el && el.matches('input, select, textarea') && typeof el.checkValidity === 'function' && !el.checkValidity()) {
      // A rule message (custom validity) is always current; the on-screen error can be stale
      if (el.validity && el.validity.customError && el.validationMessage) {
        return { invalid: true, message: el.validationMessage };
      }
      const errText = document.querySelector(`#${CSS.escape(fieldId)}-error span`)?.textContent?.trim();
      return { invalid: true, message: errText || el.validationMessage || 'Check this field.' };
    }
    // Fallback for fields that are not bound, read-only or not rendered: check the value itself
    const rule = ruleName && window.R59.formValidation?.rules?.[ruleName];
    if (rule && !rule.validate(value)) return { invalid: true, message: rule.message };
    return { invalid: false, message: '' };
  }

  /**
   * Session length validity: Entire day is always valid; otherwise the rendered hours field
   * (pkg-<id>-duration-h) and minutes field (pkg-<id>-duration-m) are asked, and the stored total
   * is checked when they are not rendered. Fix goes to the hours field.
   */
  function sessionValidity(id, pkg) {
    if (isFullDay(pkg) || isCustomInquirySession(pkg)) return { invalid: false, message: '' };
    const hoursId = `pkg-${id}-duration-h`;
    const hours = fieldValidity(hoursId, null, null);
    if (hours.invalid) return hours;
    const minutes = fieldValidity(`pkg-${id}-duration-m`, null, null);
    if (minutes.invalid) return minutes;
    if (document.getElementById(hoursId)) return { invalid: false, message: '' };
    return fieldValidity(null, 'packageDuration', pkg.duration_minutes);
  }

  function makeRow(base, ruleName, value) {
    const v = fieldValidity(base.fieldId, ruleName, value);
    return Object.assign({ kind: 'change', invalid: v.invalid, message: v.message }, base);
  }

  /* ---------- Diff ---------- */
  function diff(saved, current) {
    const s = saved || {};
    const c = current || {};
    const rows = [];

    // Profile
    if (s.profile && c.profile) {
      const sp = s.profile;
      const cp = c.profile;
      if (!sameText(sp.bio, cp.bio)) {
        rows.push(makeRow({
          area: 'profile', key: 'bio', label: 'Biography', kind: 'edited',
          oldText: excerpt(sp.bio), newText: excerpt(cp.bio) || EMPTY,
          fieldId: 'bio', view: 'text'
        }, 'bio', cp.bio));
      }
      [
        ['email', 'Contact info · Email', 'email', 'email'],
        ['phone', 'Contact info · Phone', 'phone', 'phone'],
        ['location', 'Location · City / service area', 'city', null],
        ['travel', 'Location · Travel note', 'travel', null]
      ].forEach(([key, label, fieldId, rule]) => {
        if (sameText(sp[key], cp[key])) return;
        rows.push(makeRow({
          area: 'profile', key, label,
          oldText: fmtText(sp[key]), newText: fmtText(cp[key]),
          fieldId, view: 'text'
        }, rule, cp[key]));
      });

      const before = socialMap(sp.social);
      const after = socialMap(cp.social);
      const keys = [...new Set([...before.keys(), ...after.keys()])];
      keys.forEach(key => {
        const o = before.get(key);
        const n = after.get(key);
        if (o && n && o.url === n.url && o.platform === n.platform) return;
        const kind = !o ? 'added' : (!n ? 'removed' : 'change');
        const platformId = `social-platform-${key}`;
        const urlId = `social-url-${key}`;
        const base = {
          area: 'profile', key: `social.${key}`, kind,
          label: `Social link · ${(n && n.platform) || (o && o.platform) || 'New link'}`,
          oldText: socialText(o, n),
          newText: n ? socialText(n, o) : '(removed)',
          view: 'text'
        };
        if (!n) {
          rows.push(makeRow(Object.assign({ fieldId: 'card-social' }, base), null, ''));
          return;
        }
        // Fix goes to the first invalid input of the row: platform, then address
        const platformCheck = fieldValidity(platformId, 'socialPlatform', n.platform);
        const fieldId = platformCheck.invalid ? platformId : urlId;
        rows.push(platformCheck.invalid
          ? Object.assign({ kind: 'change', fieldId, invalid: true, message: platformCheck.message }, base)
          : makeRow(Object.assign({ fieldId }, base), 'socialUrl', n.url));
      });
    }

    // Pricing
    if (s.pricing && c.pricing) {
      [
        ['baseFee', 'Pricing · Base fee', fmtMoney, 'money'],
        ['perPerson', 'Pricing · Per-person price', fmtMoney, 'money'],
        ['depositPercent', 'Pricing · Down payment', fmtPercent, 'percent']
      ].forEach(([key, label, fmt, rule]) => {
        if (sameNumber(s.pricing[key], c.pricing[key])) return;
        rows.push(makeRow({
          area: 'pricing', key, label,
          oldText: fmt(s.pricing[key]), newText: fmt(c.pricing[key]),
          fieldId: key, view: 'payment'
        }, rule, c.pricing[key]));
      });

      // Dynamic Fee Rules
      const TRIGGER_LABELS = {
        days_before_max: r => `Days ≤ ${norm(r.daysBefore) || '?'}`,
        privacy_declined: () => 'Privacy declined',
        weekend: () => 'Weekend',
        always: () => 'Every booking',
        client_selectable: () => 'Optional add-on'
      };
      const fmtFeeAmount = r => {
        const amt = Number(r.amount);
        if (norm(r.amount) === '' || !Number.isFinite(amt)) return EMPTY;
        if (r.amountType === 'percent_of_subtotal') return `${amt}%`;
        if (r.amountType === 'per_person_cents') return `${fmtMoney(amt / 100)}/person`;
        return fmtMoney(amt / 100);
      };
      const feeRuleSummary = r => {
        if (!r) return EMPTY;
        const trig = (TRIGGER_LABELS[r.trigger] || (() => norm(r.trigger) || 'Rule'))(r);
        const status = r.active !== false ? 'Active' : 'Inactive';
        return `${norm(r.name) || 'Unnamed'} · ${trig} · ${fmtFeeAmount(r)} · ${status}`;
      };
      const sameFeeRule = (o, n) => (
        sameText(o.name, n.name) &&
        norm(o.trigger) === norm(n.trigger) &&
        (norm(o.trigger) !== 'days_before_max' || sameNumber(o.daysBefore, n.daysBefore)) &&
        norm(o.amountType) === norm(n.amountType) &&
        sameNumber(o.amount, n.amount) &&
        Boolean(o.active !== false) === Boolean(n.active !== false)
      );
      const feeRuleValidity = (id, r) => {
        if (!norm(r.name)) return { invalid: true, message: 'Enter a fee rule name.', fieldId: `fee-rule-${id}-name` };
        if (r.trigger === 'days_before_max') {
          const d = Number(r.daysBefore);
          if (norm(r.daysBefore) === '' || !Number.isInteger(d) || d < 0) {
            return { invalid: true, message: 'Enter a whole number of days (0 or more).', fieldId: `fee-rule-${id}-daysBefore` };
          }
        }
        const amt = Number(r.amount);
        if (norm(r.amount) === '' || !Number.isFinite(amt) || amt < 0 || (r.amountType === 'percent_of_subtotal' && amt > 100)) {
          return {
            invalid: true,
            message: r.amountType === 'percent_of_subtotal' ? 'Enter a percentage from 0 to 100.' : 'Enter an amount of 0 or more.',
            fieldId: `fee-rule-${id}-amount`
          };
        }
        return { invalid: false, message: '', fieldId: `fee-rule-${id}-name` };
      };
      const toRuleMap = list => {
        const m = new Map();
        (Array.isArray(list) ? list : []).forEach((r, i) => {
          const id = norm(r && r.id) || `row-${i}`;
          if (!m.has(id)) m.set(id, r);
        });
        return m;
      };
      const sRules = toRuleMap(s.pricing.feeRules);
      const cRules = toRuleMap(c.pricing.feeRules);
      [...new Set([...sRules.keys(), ...cRules.keys()])].forEach(id => {
        const o = sRules.get(id);
        const n = cRules.get(id);
        if (o && n && sameFeeRule(o, n)) return;
        const kind = !o ? 'added' : (!n ? 'removed' : 'change');
        const label = `Fee rule · ${norm(n?.name) || norm(o?.name) || 'New rule'}`;
        if (!n) {
          rows.push({
            area: 'pricing', key: `feeRules.${id}`, kind, label,
            oldText: feeRuleSummary(o), newText: '(removed)',
            invalid: false, message: '', fieldId: 'card-fee-rules', view: 'payment'
          });
          return;
        }
        const v = feeRuleValidity(id, n);
        rows.push({
          area: 'pricing', key: `feeRules.${id}`, kind, label,
          oldText: feeRuleSummary(o), newText: feeRuleSummary(n),
          invalid: v.invalid, message: v.message, fieldId: v.fieldId, view: 'payment'
        });
      });

      // Contract & Policy Deadlines
      const sp = s.pricing.policy || {};
      const cp = c.pricing.policy || {};
      const fmtDays = v => {
        const t = norm(v);
        if (t === '') return EMPTY;
        const n = Number(t);
        return Number.isNaN(n) ? t : `${n} day${n === 1 ? '' : 's'}`;
      };
      const wholeDaysCheck = v => {
        const t = norm(v);
        const n = Number(t);
        return t !== '' && Number.isInteger(n) && n >= 0;
      };
      [
        ['balanceDueDaysAfterEvent', 'Policy · Balance due after event', 'balanceDueDaysAfterEvent'],
        ['rescheduleCutoffDays', 'Policy · Reschedule cutoff', 'rescheduleCutoffDays']
      ].forEach(([key, label, fieldId]) => {
        if (sameNumber(sp[key], cp[key])) return;
        const valid = wholeDaysCheck(cp[key]);
        rows.push({
          area: 'pricing', key: `policy.${key}`, kind: 'change', label,
          oldText: fmtDays(sp[key]), newText: fmtDays(cp[key]),
          invalid: !valid,
          message: valid ? '' : 'Enter a whole number of days (0 or more).',
          fieldId, view: 'payment'
        });
      });
      const oldSig = sp.requireSignature !== false;
      const newSig = cp.requireSignature !== false;
      if (oldSig !== newSig) {
        rows.push({
          area: 'pricing', key: 'policy.requireSignature', kind: 'change',
          label: 'Policy · Require agreement signature',
          oldText: oldSig ? 'Required' : 'Not required',
          newText: newSig ? 'Required' : 'Not required',
          invalid: false, message: '',
          fieldId: 'requireAgreementSignature', view: 'payment'
        });
      }
    }

    // Availability, one row per day
    if (Array.isArray(s.availability) && Array.isArray(c.availability)) {
      const byDay = list => new Map(list.map(d => [norm(d && d.day), d]));
      const sd = byDay(s.availability);
      const cd = byDay(c.availability);
      const order = window.R59.state?.DAYS_OF_WEEK || [];
      const days = [...new Set([...order, ...sd.keys(), ...cd.keys()])].filter(d => sd.has(d) || cd.has(d));
      days.forEach(day => {
        const oldText = dayText(sd.get(day));
        const newText = dayText(cd.get(day));
        if (oldText === newText) return;
        rows.push(makeRow({
          area: 'availability', key: `availability.${day}`, label: `Availability · ${day}`,
          oldText, newText, fieldId: 'card-availability', view: 'schedule'
        }, null, null));
      });
    }

    // Packages, per server id present in both snapshots
    if (s.packages && c.packages) {
      Object.keys(c.packages).forEach(id => {
        const o = s.packages[id];
        const n = c.packages[id];
        if (!o || !n) return;
        const name = norm(o.name) || 'Untitled';
        [
          ['name', 'Name', fmtText, sameText, 'packageName'],
          ['price', 'Price', fmtMoney, sameNumber, 'packagePrice'],
          ['best_for', 'Best for', fmtText, sameText, null, 'best_for'],
          ['booking_mode', 'Booking mode', fmtBookingMode, sameText, null, 'booking_mode'],
          ['photo_count', 'Photo count', fmtPhotoCount, sameNumber, 'packagePhotoCount', 'photo_count'],
          ['description', 'Description', fmtText, sameText, null],
          ['outfits', 'Outfits', fmtOutfits, sameNumber, 'packageOutfits', 'outfits'],
          ['image_url', 'Package image', fmtText, sameText, null, 'image_url'],
          ['additional_people', 'Additional people', fmtText, sameJsonText, 'packageAdditionalPeople', 'additional_people']
        ].forEach(([key, title, fmt, same, rule, fieldKey]) => {
          if (same(o[key], n[key])) return;
          const fieldId = `pkg-${id}-${fieldKey || key}`;
          const isInquiryCustomPrice = key === 'price' && norm(n.booking_mode) === 'inquiry' && norm(n.price) === '';
          const oldText = key === 'description'
            ? (excerpt(o[key]) || EMPTY)
            : (key === 'price' && norm(o.booking_mode) === 'inquiry' && norm(o.price) === '' ? 'Custom pricing' : fmt(o[key]));
          const newText = key === 'description'
            ? (excerpt(n[key]) || EMPTY)
            : (isInquiryCustomPrice ? 'Custom pricing' : fmt(n[key]));
          rows.push(makeRow({
            area: `package:${id}`, key, label: `Package “${name}” · ${title}`,
            oldText,
            newText,
            fieldId, view: 'payment'
          }, isInquiryCustomPrice ? null : rule, n[key]));
        });
        // Session length and Entire day are one row ("1 h 30 min → Entire day")
        if (!sameSession(o, n)) {
          const v = sessionValidity(id, n);
          rows.push({
            kind: 'change', invalid: v.invalid, message: v.message,
            area: `package:${id}`, key: 'session', label: `Package “${name}” · Session length`,
            oldText: sessionText(o), newText: sessionText(n),
            fieldId: `pkg-${id}-duration-h`, view: 'payment'
          });
        }
      });
    }

    return rows;
  }

  /* ---------- Dialog ---------- */
  let confirmHandler = null;
  let busy = false;
  let opener = null;
  let wired = false;

  const $id = id => document.getElementById(id);

  function svgIcon(href, attrs) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ico');
    Object.entries(attrs || { 'aria-hidden': 'true' }).forEach(([k, v]) => svg.setAttribute(k, v));
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', href);
    svg.appendChild(use);
    return svg;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderRow(row, index) {
    const li = el('li', row.invalid ? 'change invalid' : 'change');
    li.appendChild(el('span', 'where caps', row.label));
    const body = el('div');
    const d = el('span', 'diff');

    if (row.kind === 'edited') {
      d.appendChild(el('ins', '', 'Edited'));
      d.appendChild(el('span', 'sub', row.newText));
    } else {
      d.appendChild(el('del', '', row.oldText));
      d.appendChild(svgIcon('#i-arrow', { role: 'img', 'aria-label': 'changes to' }));
      d.appendChild(el('ins', '', row.newText));
    }
    body.appendChild(d);

    if (row.invalid) {
      const fix = el('div', 'fix');
      const errId = `review-err-${index}`;
      const err = el('p', 'field__error');
      err.id = errId;
      err.appendChild(svgIcon('#i-alert'));
      err.appendChild(el('span', '', row.message));
      fix.appendChild(err);

      const btn = el('button', 'btn btn--sm', 'Fix');
      btn.type = 'button';
      btn.setAttribute('aria-describedby', errId);
      btn.appendChild(el('span', 'sr-only', ` ${row.label}`));
      btn.addEventListener('click', () => {
        close({ restoreFocus: false });
        window.R59.navigation?.go?.(row.view, { anchor: row.fieldId });
      });
      fix.appendChild(btn);
      body.appendChild(fix);
    }

    li.appendChild(body);
    return li;
  }

  function wire() {
    const dlg = $id('review');
    if (!dlg || wired) return;
    wired = true;
    dlg.addEventListener('click', e => {
      if (e.target.closest('[data-close]') && !busy) close();
    });
    dlg.addEventListener('cancel', e => {
      if (busy) e.preventDefault(); // keep the dialog while a save is in flight
    });
    dlg.addEventListener('close', () => {
      if (opener && opener.isConnected && typeof opener.focus === 'function' && !document.querySelector('.login.open')) {
        opener.focus();
      }
      opener = null;
    });
    $id('reviewConfirm')?.addEventListener('click', async () => {
      if (busy || typeof confirmHandler !== 'function') return;
      const handler = confirmHandler;
      try {
        await handler();
      } finally {
        close();
      }
    });
  }

  function open(rows, onConfirm) {
    const dlg = $id('review');
    const list = $id('reviewList');
    if (!dlg || !list) return;
    wire();

    const items = Array.isArray(rows) ? rows : [];
    const count = items.length;
    const invalid = items.filter(r => r.invalid).length;

    list.replaceChildren(...items.map(renderRow));

    const confirmBtn = $id('reviewConfirm');
    if (confirmBtn) {
      confirmBtn.textContent = `Save ${count} change${count === 1 ? '' : 's'}`;
      confirmBtn.disabled = invalid > 0;
      if (invalid > 0) confirmBtn.setAttribute('aria-describedby', 'reviewHint');
      else confirmBtn.removeAttribute('aria-describedby');
    }
    const hint = $id('reviewHint');
    if (hint) {
      hint.textContent = invalid > 0
        ? `Fix ${invalid} issue${invalid === 1 ? '' : 's'} to save.`
        : 'All changes are ready to publish.';
    }

    confirmHandler = invalid > 0 ? null : onConfirm;
    opener = document.activeElement;
    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    }
  }

  function close({ restoreFocus = true } = {}) {
    const dlg = $id('review');
    if (!restoreFocus) opener = null;
    confirmHandler = null;
    setBusy(false);
    if (dlg && dlg.open) {
      if (typeof dlg.close === 'function') dlg.close();
      else dlg.removeAttribute('open');
    }
  }

  /** While busy the dialog can't be dismissed and its buttons are disabled. */
  function setBusy(on) {
    busy = Boolean(on);
    const dlg = $id('review');
    if (!dlg) return;
    const confirmBtn = $id('reviewConfirm');
    if (confirmBtn && busy) confirmBtn.disabled = true;
    dlg.querySelectorAll('[data-close]').forEach(b => { b.disabled = busy; });
  }

  const isOpen = () => Boolean($id('review')?.open);

  window.R59 = window.R59 || {};
  window.R59.reviewChanges = { diff, open, close, setBusy, isOpen };
})();
