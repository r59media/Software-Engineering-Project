// @ts-nocheck
/**
 * R59 Media Admin — Payment page (pricing, photography packages, coupon codes)
 *
 * Settings (go through the save bar; this page only edits state and calls markDirty):
 *   pricing.baseFee / perPerson / depositPercent, and name / price / description / outfits /
 *   session length (duration_minutes, entered as hours + minutes) / Entire day (full_day) of every
 *   package that has a server id. Field ids: baseFee, perPerson, depositPercent, pkg-<id>-name,
 *   pkg-<id>-price, pkg-<id>-description, pkg-<id>-outfits, pkg-<id>-duration-h,
 *   pkg-<id>-duration-m, pkg-<id>-fullday.
 * Records (sent as soon as the admin confirms; pessimistic, never markDirty):
 *   package create / delete / availability toggle, coupon create / update / delete / toggle.
 *
 * Render hooks app.js calls: renderPricing, renderPackages, renderCoupons, resetCouponForm.
 */

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const R = () => window.R59 || {};
  const esc = s => {
    const fn = R().formValidation?.escapeHtml;
    if (fn) return fn(s);
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  const st = () => R().state;
  const cur = () => st().getState();
  const loadStatus = area => st().getLoadStatus?.(area) || 'loaded';
  const isLoaded = area => loadStatus(area) === 'loaded';
  const sameId = (a, b) => String(a) === String(b);
  const toast = (msg, opts) => window.toast?.(msg, opts);
  const AREA_LABELS = { pricing: 'pricing', packages: 'packages', coupons: 'coupons' };

  /** Error toast with the server message; a 401 is handled by the login screen instead. */
  function failToast(prefix, err) {
    if (err && err.status === 401) return;
    const reason = String((err && err.message) || '').trim();
    toast(reason ? `${prefix} ${reason}` : prefix, { type: 'error' });
  }

  function formatCurrency(val) {
    const num = parseFloat(val);
    return isNaN(num) ? '$0.00' : `$${num.toFixed(2)}`;
  }

  function money(n) {
    const v = Number(n || 0);
    return '$' + v.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  const pad2 = n => String(n).padStart(2, '0');

  /* ---------- Shared blocks ---------- */

  function loadErrorHtml(area) {
    const label = AREA_LABELS[area] || area;
    const msg = st().getLoadError?.(area) || '';
    return `<div class="load-error" role="alert">
      <svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg>
      <p><strong>Couldn't load ${esc(label)}.</strong> <span>${esc(msg)}</span></p>
      <button class="btn btn--sm" type="button" data-retry="${esc(area)}">Retry</button>
    </div>`;
  }

  const skelHtml = (label) =>
    `<div class="skel" role="status" aria-label="${esc(label)}"><i></i><i></i><i></i><i></i></div>`;

  /** Frame numbers run 01, 02, … through the whole Payment view, in DOM order. */
  function numberFrames() {
    const view = $('#view-payment');
    if (!view) return;
    let n = 0;
    view.querySelectorAll('.roll').forEach(roll => {
      const first = n + 1;
      roll.querySelectorAll('.slot > .edge').forEach(edge => {
        n += 1;
        const no = edge.querySelector('[data-frame-no]');
        const code = edge.querySelector('[data-frame-code]');
        if (no) no.textContent = `Frame ${pad2(n)}`;
        if (code) code.textContent = `${pad2(n)}A`;
      });
      const label = roll.querySelector('[data-frames-label]');
      if (label && n >= first) {
        label.textContent = n === first ? `Frame ${pad2(first)}` : `Frames ${pad2(first)}–${pad2(n)}`;
      }
    });
  }

  /* ---------- Pricing (settings) ---------- */

  const PRICE_FIELDS = {
    baseFee: { input: '#baseFee', display: '#baseFeeDisplay', rule: 'money', label: 'Edit price' },
    perPerson: { input: '#perPerson', display: '#perPersonDisplay', rule: 'money', label: 'Edit price' },
    depositPercent: {
      input: '#depositPercent',
      display: '#depositDisplay',
      rule: 'percent',
      fmt: v => `${isNaN(parseFloat(v)) ? 0 : parseFloat(v)}%`,
      label: 'Edit percentage'
    }
  };

  const priceBtn = key => document.querySelector(`.price-edit-btn[data-price-key="${key}"]`);

  function setPriceLocked(key, locked) {
    const f = PRICE_FIELDS[key];
    const input = f && $(f.input);
    if (!input) return;
    input.readOnly = locked;
    const btn = priceBtn(key);
    if (btn) {
      const text = btn.querySelector('.price-edit-text') || btn;
      text.textContent = locked ? f.label : 'Cancel';
      btn.setAttribute('aria-pressed', String(!locked));
    }
  }

  function showPriceFigure(key, value) {
    const f = PRICE_FIELDS[key];
    const el = f && $(f.display);
    if (el) el.textContent = (f.fmt || formatCurrency)(value);
  }

  function renderPricing() {
    const status = loadStatus('pricing');
    const notice = $('#pricingNotice');
    if (notice) notice.innerHTML = status === 'failed' ? loadErrorHtml('pricing') : '';

    const pricing = cur().pricing || {};
    const saved = st().getSaved?.().pricing || {};
    Object.entries(PRICE_FIELDS).forEach(([key, f]) => {
      const input = $(f.input);
      const btn = priceBtn(key);
      const usable = status === 'loaded';
      if (input) {
        input.disabled = !usable;
        input.value = usable ? (pricing[key] ?? '') : '';
      }
      if (btn) btn.disabled = !usable;
      const figure = $(f.display);
      if (figure) {
        if (usable) showPriceFigure(key, pricing[key] ?? 0);
        else figure.textContent = '—';
        figure.classList.toggle('is-pending', !usable);
      }
      // A field with an unsaved edit stays open; everything else is locked.
      const edited = usable && String(pricing[key] ?? '') !== String(saved[key] ?? '');
      setPriceLocked(key, !edited);
      // re-check an edited field, and clear a stale error after Discard / save
      if (input && usable && (edited || input.getAttribute('aria-invalid') === 'true')) {
        R().formValidation?.validate?.(input);
      } else if (input && !usable) {
        input.removeAttribute('aria-invalid');
        const errEl = document.getElementById(`${input.id}-error`);
        if (errEl) errEl.hidden = true;
      }
    });
    updateDepositExample();
  }

  function updateDepositExample() {
    const el = $('#depositExample');
    if (!el) return;
    if (!isLoaded('pricing')) {
      el.textContent = "The share of a booking's total that is collected upfront.";
      return;
    }
    const parsed = parseFloat(cur().pricing?.depositPercent);
    const pct = isNaN(parsed) ? 60 : parsed;
    if (pct < 1 || pct > 100) {
      el.textContent = 'Enter a whole number from 1 to 100 (e.g. 60%).';
    } else {
      const exampleDown = Math.round(500 * pct / 100);
      el.textContent = `The share of a booking's total collected upfront. Example: on a $500 booking, the down payment is ${money(exampleDown)}.`;
    }
  }

  function pricingIsInvalid() {
    const pricing = cur().pricing || {};
    return Object.keys(PRICE_FIELDS).some(k => {
      const v = pricing[k];
      return v === '' || isNaN(parseFloat(v)) || parseFloat(v) < 0 || (k === 'depositPercent' && (parseFloat(v) < 1 || parseFloat(v) > 100));
    });
  }

  function initPricingListeners() {
    const fv = R().formValidation;
    Object.entries(PRICE_FIELDS).forEach(([key, f]) => {
      const input = $(f.input);
      const btn = priceBtn(key);
      if (!input) return;
      fv?.bind?.(input, fv.rules?.[f.rule]);

      btn?.addEventListener('click', () => {
        if (!isLoaded('pricing')) return;
        if (input.readOnly) {
          setPriceLocked(key, false);
          input.focus();
          input.select?.();
          return;
        }
        // Cancel: back to the saved amount
        const savedVal = st().getSaved().pricing?.[key] ?? '';
        cur().pricing[key] = savedVal;
        input.value = savedVal;
        showPriceFigure(key, savedVal);
        setPriceLocked(key, true);
        fv?.validate?.(input);
        updateDepositExample();
        st().markDirty();
      });

      input.addEventListener('input', () => {
        if (input.readOnly || !isLoaded('pricing')) return;
        cur().pricing[key] = input.value === '' ? '' : parseFloat(input.value);
        showPriceFigure(key, input.value);
        updateDepositExample();
        st().markDirty();
      });
    });
  }

  /* ---------- Photography packages ---------- */

  const pkgField = (id, name) => `pkg-${id}-${name}`;
  const numValue = v => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? '' : Number(v));
  const numFromInput = input => (input.value === '' ? '' : Number(input.value));

  /* ----- Session length: [ h ] h : [ m ] min, plus "Entire day" ----- */

  /** Length stored for a new "Entire day" package (not used for booking times). */
  const FULL_DAY_MINUTES = 1440;
  const sessionIds = id => ({ h: pkgField(id, 'duration-h'), m: pkgField(id, 'duration-m'), day: pkgField(id, 'fullday') });
  const NEW_SESSION_IDS = { h: 'pkgNewDurationH', m: 'pkgNewDurationM', day: 'pkgNewFullDay' };
  const sessionEls = ids => ({ h: document.getElementById(ids.h), m: document.getElementById(ids.m), day: document.getElementById(ids.day) });

  /** Stored minutes as the two field values ({ h: '', m: '' } when there is no length). */
  function splitMinutes(v) {
    const n = Number(v);
    if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < 0) return { h: '', m: '' };
    return { h: Math.floor(n / 60), m: Math.round(n % 60) };
  }

  /** Total minutes from the two fields ('' when both are empty or a value is not a number). */
  function sessionTotal(els) {
    const hv = els.h?.value ?? '';
    const mv = els.m?.value ?? '';
    const fv = R().formValidation;
    const total = fv?.sessionMinutes
      ? fv.sessionMinutes(hv, mv)
      : (hv === '' && mv === '' ? '' : Number(hv || 0) * 60 + Number(mv || 0));
    return total === '' || !Number.isFinite(total) ? '' : total;
  }

  const errorHtml = fieldId => `<p class="field__error" id="${fieldId}-error" hidden><svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg><span></span></p>`;

  /** The Session length group of a package frame (the Add package form has the same markup in index.html). */
  function sessionFieldHtml(ids, pkg) {
    const fullDay = pkg.full_day === true;
    const { h, m } = splitMinutes(pkg.duration_minutes);
    const off = fullDay ? ' disabled aria-disabled="true"' : '';
    return `
            <div class="field pay-session" role="group" aria-labelledby="${ids.h}-group">
              <span class="field__label" id="${ids.h}-group">Session length</span>
              <div class="pay-session__line">
                <div class="pay-session__units">
                  <div class="field__control pay-session__unit">
                    <input class="field__input num" id="${ids.h}" type="number" inputmode="numeric" min="0" max="24" step="1" value="${esc(h)}" data-pkg-input="duration-h"${off}>
                  </div>
                  <label class="pay-session__suffix" for="${ids.h}"><span class="sr-only">Session length </span>h<span class="sr-only">ours</span></label>
                  <span class="pay-session__sep" aria-hidden="true">:</span>
                  <div class="field__control pay-session__unit">
                    <input class="field__input num" id="${ids.m}" type="number" inputmode="numeric" min="0" max="59" step="1" value="${esc(m)}" data-pkg-input="duration-m"${off}>
                  </div>
                  <label class="pay-session__suffix" for="${ids.m}"><span class="sr-only">Session length </span>min<span class="sr-only">utes</span></label>
                </div>
                <label class="pay-check" for="${ids.day}">
                  <input type="checkbox" id="${ids.day}" data-pkg-input="fullday"${fullDay ? ' checked' : ''}>
                  <span>Entire day</span>
                </label>
              </div>
              ${errorHtml(ids.h)}
              ${errorHtml(ids.m)}
            </div>`;
  }

  function bindSession(els) {
    const fv = R().formValidation;
    if (!fv?.sessionLengthRules || !els.h || !els.m) return;
    const rules = fv.sessionLengthRules(els.h, els.m, els.day);
    fv.bind(els.h, rules.hours);
    fv.bind(els.m, rules.minutes);
  }

  /** Each field's rule reads the other one, so both are re-checked together. */
  function revalidateSession(els, show = false) {
    const fv = R().formValidation;
    if (!fv) return;
    [els.h, els.m].forEach(el => {
      if (!el) return;
      if (show) fv.validate?.(el);
      else fv.revalidate?.(el);
    });
  }

  /** "Entire day" ticked: both fields are disabled (their typed values stay) and are not checked. */
  function applyFullDay(els) {
    const off = Boolean(els.day?.checked);
    [els.h, els.m].forEach(el => {
      if (!el) return;
      el.disabled = off;
      if (off) el.setAttribute('aria-disabled', 'true');
      else el.removeAttribute('aria-disabled');
    });
    // ticking clears any message; unticking re-checks quietly (a message shows again on blur or review)
    revalidateSession(els, off);
  }
  const findPkg = id => (cur().packages || []).find(p => sameId(p.id, id));
  const savedPkg = id => (st().getSaved?.().packages || {})[id] || null;

  function packageSlotHtml(pkg) {
    const id = esc(pkg.id);
    const active = pkg.active !== false;
    const name = String(pkg.name ?? '');
    const sp = savedPkg(pkg.id);
    const priceEdited = sp && String(sp.price ?? '') !== String(pkg.price ?? '');
    const priceVal = pkg.price === '' || pkg.price === null || pkg.price === undefined ? '' : Number(pkg.price);
    return `
      <div class="slot">
        <div class="edge caps" aria-hidden="true"><span><svg class="tri"><use href="#i-tri"/></svg><span data-frame-no>Frame</span></span><span data-frame-code></span></div>
        <article class="frame pay-pkg${active ? '' : ' is-inactive'}" id="card-pkg-${id}" data-pkg-id="${id}" aria-labelledby="pkg-${id}-title">
          <div class="frame-head">
            <div>
              <h3 id="pkg-${id}-title" data-pkg-title>${esc(name.trim() || 'Package')}</h3>
              ${active ? '' : '<p class="pay-tags"><span class="tag tag--muted">Inactive</span></p>'}
            </div>
            <label class="switch">
              <input type="checkbox" role="switch" data-pkg-toggle="${id}" ${active ? 'checked' : ''} aria-describedby="pkg-${id}-title">
              <span class="switch__track" aria-hidden="true"></span>
              <span class="switch__label">Available</span>
            </label>
          </div>
          <div class="fields">
            <div class="field">
              <label class="field__label" for="${pkgField(id, 'name')}">Package name</label>
              <div class="field__control">
                <input class="field__input" id="${pkgField(id, 'name')}" type="text" autocomplete="off" maxlength="120" value="${esc(name)}" data-pkg-input="name">
              </div>
            </div>
            <div class="field">
              <div class="pay-label-row">
                <label class="field__label" for="${pkgField(id, 'price')}">Price ($)</label>
                <button type="button" class="btn btn--ghost btn--sm" data-pkg-price-edit="${id}" aria-controls="${pkgField(id, 'price')}" aria-pressed="${priceEdited ? 'true' : 'false'}"><svg class="ico" aria-hidden="true"><use href="#i-edit"/></svg><span class="price-edit-text">${priceEdited ? 'Finish editing' : 'Edit price'}</span></button>
              </div>
              <div class="field__control">
                <input class="field__input num" id="${pkgField(id, 'price')}" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(priceVal)}" ${priceEdited ? '' : 'readonly'} data-pkg-input="price">
              </div>
            </div>
            <div class="field pay-outfits">
              <label class="field__label" for="${pkgField(id, 'outfits')}">Number of outfits</label>
              <div class="field__control">
                <input class="field__input num" id="${pkgField(id, 'outfits')}" type="number" inputmode="numeric" min="0" max="50" step="1" value="${esc(numValue(pkg.outfits))}" data-pkg-input="outfits">
              </div>
            </div>
            ${sessionFieldHtml(sessionIds(id), pkg)}
            <div class="field">
              <label class="field__label" for="${pkgField(id, 'description')}">Short description</label>
              <div class="field__control">
                <textarea class="field__input pay-desc" id="${pkgField(id, 'description')}" rows="3" data-pkg-input="description">${esc(pkg.description || '')}</textarea>
              </div>
            </div>
          </div>
          <div class="pay-actions pay-pkg-foot">
            <button type="button" class="btn btn--danger btn--sm" data-pkg-delete="${id}">Remove package</button>
          </div>
        </article>
      </div>`;
  }

  /** A slot without the frame numbering edge content, for loading / failed / empty states. */
  function stateSlotHtml(inner) {
    return `<div class="slot pay-state-slot">
      <div class="edge caps" aria-hidden="true"><span><svg class="tri"><use href="#i-tri"/></svg><span data-frame-no>Frame</span></span><span data-frame-code></span></div>
      <div class="frame">${inner}</div>
    </div>`;
  }

  function renderPackages() {
    const container = $('#packageList');
    if (!container) return;
    const status = loadStatus('packages');
    const addBtn = $('#addPackageBtn');
    if (addBtn) addBtn.disabled = status !== 'loaded';
    if (status !== 'loaded') closeAddForm();

    if (status === 'loading') {
      container.innerHTML = stateSlotHtml(skelHtml('Loading packages'));
      numberFrames();
      return;
    }
    if (status === 'failed') {
      container.innerHTML = stateSlotHtml(loadErrorHtml('packages'));
      numberFrames();
      return;
    }

    const packages = cur().packages || [];
    if (!packages.length) {
      container.innerHTML = stateSlotHtml(`<div class="empty">
          <svg class="cam" width="110" height="96" viewBox="0 0 110 96" aria-hidden="true"><use href="#logo-camera"/></svg>
          <p>No Photography Packages Configured</p>
          <small>Use “Add package” to create session offerings with custom pricing and descriptions.</small>
        </div>`);
      numberFrames();
      return;
    }

    container.innerHTML = packages.map(packageSlotHtml).join('');
    const fv = R().formValidation;
    packages.forEach(pkg => {
      const name = document.getElementById(pkgField(pkg.id, 'name'));
      const price = document.getElementById(pkgField(pkg.id, 'price'));
      const outfits = document.getElementById(pkgField(pkg.id, 'outfits'));
      const session = sessionEls(sessionIds(pkg.id));
      fv?.bind?.(name, fv.rules?.packageName);
      fv?.bind?.(price, fv.rules?.packagePrice);
      fv?.bind?.(outfits, fv.rules?.packageOutfits);
      bindSession(session);
      // keep an invalid unsaved value visibly flagged after a re-render
      const sp = savedPkg(pkg.id);
      if (name && name.value !== String(sp?.name ?? name.value)) fv?.validate?.(name);
      if (price && !price.readOnly) fv?.validate?.(price);
      if (outfits && String(numValue(sp?.outfits)) !== outfits.value) fv?.validate?.(outfits);
      if (pkg.full_day !== true && (sp?.full_day === true || String(numValue(sp?.duration_minutes)) !== String(sessionTotal(session)))) {
        revalidateSession(session, true);
      }
    });
    numberFrames();
  }

  function onPackageInput(e) {
    const input = e.target.closest?.('[data-pkg-input]');
    if (!input) return;
    const frame = input.closest('[data-pkg-id]');
    const pkg = frame && findPkg(frame.dataset.pkgId);
    if (!pkg) return;
    const kind = input.dataset.pkgInput;
    if (kind === 'name') {
      pkg.name = input.value;
      const title = frame.querySelector('[data-pkg-title]');
      if (title) title.textContent = input.value.trim() || 'Package';
    } else if (kind === 'price') {
      if (input.readOnly) return;
      pkg.price = input.value === '' ? '' : parseFloat(input.value);
    } else if (kind === 'description') {
      pkg.description = input.value;
    } else if (kind === 'outfits') {
      pkg.outfits = numFromInput(input);
    } else if (kind === 'duration-h' || kind === 'duration-m' || kind === 'fullday') {
      const session = sessionEls(sessionIds(pkg.id));
      if (kind === 'fullday') {
        pkg.full_day = input.checked;
        applyFullDay(session);
      } else {
        pkg.duration_minutes = sessionTotal(session);
        revalidateSession(session);
      }
    }
    st().markDirty();
  }

  function onPackagePriceEdit(btn) {
    const id = btn.dataset.pkgPriceEdit;
    const pkg = findPkg(id);
    const input = document.getElementById(pkgField(id, 'price'));
    if (!pkg || !input) return;
    const text = btn.querySelector('.price-edit-text') || btn;
    if (input.readOnly) {
      input.readOnly = false;
      text.textContent = 'Finish editing';
      btn.setAttribute('aria-pressed', 'true');
      input.focus();
      input.select?.();
      return;
    }
    // Finish editing: keep the typed price (it goes through the save bar) and lock the field again.
    // An invalid price stays unlocked so the admin (or the review dialog's Fix) can correct it.
    if (R().formValidation?.validate && !R().formValidation.validate(input)) {
      input.focus();
      return;
    }
    input.readOnly = true;
    text.textContent = 'Edit price';
    btn.setAttribute('aria-pressed', 'false');
    st().markDirty();
  }

  /** Delete (record write). The server deactivates instead when bookings still use the package. */
  function onPackageDelete(btn) {
    const id = btn.dataset.pkgDelete;
    const pkg = findPkg(id);
    if (!pkg) return;
    const label = (savedPkg(id)?.name || pkg.name || 'this package').trim() || 'this package';
    R().confirmation.confirmRemovePackage(label, async () => {
      btn.disabled = true;
      try {
        const res = await R().packagesApi.deletePackage(pkg.id);
        const message = String(res?.message || '');
        if (/deactivat/i.test(message)) {
          pkg.active = false;
          renderPackages();
          toast(`“${label}” is still used by existing bookings, so it was made unavailable instead of deleted.`, { type: 'success' });
        } else {
          st().removePackage(pkg.id);
          renderPackages();
          toast(`${label} deleted`, { type: 'success' });
        }
      } catch (err) {
        failToast(`Couldn't remove “${label}”.`, err);
      } finally {
        if (btn.isConnected) btn.disabled = false;
      }
    });
  }

  /** Availability toggle (record write): sends only { is_active }. */
  function onPackageToggle(toggle) {
    const id = toggle.dataset.pkgToggle;
    const pkg = findPkg(id);
    if (!pkg) return;
    const nextActive = toggle.checked;
    const label = (savedPkg(id)?.name || pkg.name || 'This package').trim() || 'This package';
    // Show the stored state until the server confirms
    toggle.checked = !nextActive;
    R().confirmation.confirmToggleActive('package', label, nextActive, async () => {
      toggle.disabled = true;
      try {
        await R().packagesApi.updatePackage(pkg.id, { is_active: nextActive ? 1 : 0 });
        pkg.active = nextActive;
        renderPackages();
        toast(nextActive ? `${label} is available again` : `${label} is now unavailable`, { type: 'success' });
      } catch (err) {
        failToast(`Couldn't change “${label}”.`, err);
        if (toggle.isConnected) toggle.disabled = false;
      }
    });
  }

  /* ----- Add package form (record write: POSTs on confirm) ----- */

  function openAddForm() {
    if (!isLoaded('packages')) return;
    const form = $('#pkgAddForm');
    const btn = $('#addPackageBtn');
    if (!form || !btn) return;
    form.hidden = false;
    btn.hidden = true;
    btn.setAttribute('aria-expanded', 'true');
    $('#pkgNewName')?.focus();
  }

  function closeAddForm({ focusButton = false } = {}) {
    const form = $('#pkgAddForm');
    const btn = $('#addPackageBtn');
    if (!form || !btn || form.hidden) return;
    form.reset();
    applyFullDay(sessionEls(NEW_SESSION_IDS));
    form.querySelectorAll('[aria-invalid="true"]').forEach(el => {
      el.setCustomValidity?.('');
      R().formValidation?.validate?.(el);
    });
    form.hidden = true;
    btn.hidden = false;
    btn.setAttribute('aria-expanded', 'false');
    if (focusButton) btn.focus();
  }

  function submitAddForm(e) {
    e.preventDefault();
    const fv = R().formValidation;
    const nameEl = $('#pkgNewName');
    const priceEl = $('#pkgNewPrice');
    const descEl = $('#pkgNewDescription');
    const outfitsEl = $('#pkgNewOutfits');
    const session = sessionEls(NEW_SESSION_IDS);
    if (!nameEl || !priceEl || !session.h || !session.m) return;
    const fullDay = Boolean(session.day?.checked);
    const total = sessionTotal(session);
    const check = (el, fallback) => (fv ? fv.validate(el) : fallback);
    const checks = [
      [nameEl, check(nameEl, nameEl.value.trim() !== '')],
      [priceEl, check(priceEl, priceEl.value !== '')],
      [outfitsEl, outfitsEl ? check(outfitsEl, true) : true],
      // Entire day: the length fields are disabled and not checked
      [session.h, fullDay || check(session.h, Number.isInteger(total) && total >= 15 && total <= 1440)],
      [session.m, fullDay || check(session.m, true)]
    ];
    const firstBad = checks.find(([, ok]) => !ok);
    if (firstBad) { firstBad[0]?.focus(); return; }

    const name = nameEl.value.trim();
    const price = parseFloat(priceEl.value);
    const description = (descEl?.value || '').trim();
    const outfits = outfitsEl && outfitsEl.value !== '' ? Number(outfitsEl.value) : null;
    const durationMinutes = fullDay ? FULL_DAY_MINUTES : total;
    R().confirmation.confirmSavePackage(name, true, () => createPackage({ name, price, description, outfits, durationMinutes, fullDay }));
  }

  async function createPackage({ name, price, description, outfits, durationMinutes, fullDay }) {
    const submit = $('#pkgNewCreate');
    const cancel = $('#pkgNewCancel');
    if (submit) submit.disabled = true;
    if (cancel) cancel.disabled = true;
    try {
      const res = await R().packagesApi.createPackage({
        name, price, description, outfits, duration_minutes: durationMinutes, full_day: fullDay, is_active: 1
      });
      const data = res?.data && typeof res.data === 'object' ? res.data : {};
      const id = res?.id ?? data.id;
      if (id === undefined || id === null || id === '') throw new Error('The server did not return the new package.');
      const pkg = {
        id,
        name: data.name ?? data.title ?? name,
        description: data.description ?? description,
        price: data.price !== undefined && data.price !== null ? Number(data.price) / 100 : price,
        duration_minutes: numValue(data.duration_minutes ?? durationMinutes),
        outfits: numValue(data.outfits !== undefined ? data.outfits : outfits),
        full_day: data.full_day !== undefined ? (data.full_day === true || Number(data.full_day) === 1) : fullDay,
        category: data.category ?? '',
        active: data.is_active === undefined ? true : (data.is_active !== 0 && data.is_active !== false)
      };
      st().addPackage(pkg);
      closeAddForm();
      renderPackages();
      toast(`${pkg.name} added`, { type: 'success' });
      document.getElementById(pkgField(pkg.id, 'name'))?.focus();
    } catch (err) {
      failToast(`Couldn't add “${name}”.`, err);
    } finally {
      if (submit) submit.disabled = false;
      if (cancel) cancel.disabled = false;
    }
  }

  function initPackageListeners() {
    const fv = R().formValidation;
    fv?.bind?.($('#pkgNewName'), fv.rules?.packageName);
    fv?.bind?.($('#pkgNewPrice'), fv.rules?.packagePrice);
    fv?.bind?.($('#pkgNewOutfits'), fv.rules?.packageOutfits);
    const newSession = sessionEls(NEW_SESSION_IDS);
    bindSession(newSession);
    newSession.h?.addEventListener('input', () => revalidateSession(newSession));
    newSession.m?.addEventListener('input', () => revalidateSession(newSession));
    newSession.day?.addEventListener('change', () => applyFullDay(newSession));

    $('#addPackageBtn')?.addEventListener('click', openAddForm);
    $('#pkgNewCancel')?.addEventListener('click', () => closeAddForm({ focusButton: true }));
    $('#pkgAddForm')?.addEventListener('submit', submitAddForm);
    $('#pkgAddForm')?.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); closeAddForm({ focusButton: true }); }
    });

    const list = $('#packageList');
    if (!list) return;
    list.addEventListener('input', onPackageInput);
    list.addEventListener('click', e => {
      const t = e.target instanceof Element ? e.target : e.target?.parentElement;
      if (!t) return;
      const del = t.closest('[data-pkg-delete]');
      if (del) { e.preventDefault(); onPackageDelete(del); return; }
      const edit = t.closest('[data-pkg-price-edit]');
      if (edit) { e.preventDefault(); onPackagePriceEdit(edit); }
    });
    list.addEventListener('change', e => {
      const toggle = e.target.closest?.('[data-pkg-toggle]');
      if (toggle) onPackageToggle(toggle);
    });
  }

  /* ---------- Coupons (records) ---------- */

  let editingCouponId = null;
  const couponType = t => (t === 'percent' ? 'percent' : 'amount');
  const couponValue = c => Number(c.amount ?? c.discount ?? 0);
  const couponLabel = c => (couponType(c.type) === 'percent' ? `${couponValue(c)}% off` : `${money(couponValue(c))} off`);

  function couponRowHtml(c) {
    const id = esc(c.id);
    const active = c.active !== false;
    return `
      <li class="row pay-coupon${active ? '' : ' is-inactive'}">
        <div class="row__main">
          <strong class="pay-coupon-code" id="coupon-${id}-code">${esc(c.code)}</strong>
          <span class="sub">${esc(couponLabel(c))}${active ? '' : ' <span class="tag tag--muted">Inactive</span>'}</span>
        </div>
        <div class="row__acts">
          <label class="switch">
            <input type="checkbox" role="switch" data-coupon-toggle="${id}" ${active ? 'checked' : ''} aria-describedby="coupon-${id}-code">
            <span class="switch__track" aria-hidden="true"></span>
            <span class="switch__label">Active</span>
          </label>
          <button type="button" class="btn btn--sm" data-coupon-edit="${id}" aria-describedby="coupon-${id}-code"><svg class="ico" aria-hidden="true"><use href="#i-edit"/></svg>Edit</button>
          <button type="button" class="btn btn--danger btn--sm" data-coupon-delete="${id}" aria-describedby="coupon-${id}-code">Remove</button>
        </div>
      </li>`;
  }

  function setCouponFormEnabled(on) {
    ['#couponCode', '#couponType', '#couponAmount', '#couponSubmit', '#couponCancelEdit'].forEach(sel => {
      const el = $(sel);
      if (el) el.disabled = !on;
    });
  }

  function renderCoupons() {
    const list = $('#couponList');
    if (!list) return;
    const status = loadStatus('coupons');
    const notice = $('#couponNotice');
    if (notice) notice.innerHTML = status === 'failed' ? loadErrorHtml('coupons') : '';
    setCouponFormEnabled(status === 'loaded');

    if (status === 'loading') { list.innerHTML = skelHtml('Loading coupons'); return; }
    if (status === 'failed') { list.innerHTML = ''; return; }

    const coupons = cur().coupons || [];
    if (!coupons.length) {
      list.innerHTML = '<p class="hint">No coupon codes yet.</p>';
      return;
    }
    list.innerHTML = `<ul class="rows">${coupons.map(couponRowHtml).join('')}</ul>`;
  }

  function syncCouponTypeUI() {
    const typeSelect = $('#couponType');
    if (!typeSelect) return;
    const isPct = typeSelect.value === 'percent';
    const labelEl = $('#couponAmountLabel');
    const amountEl = $('#couponAmount');
    if (labelEl) labelEl.textContent = isPct ? 'Percent off' : 'Amount off ($)';
    if (amountEl) {
      amountEl.step = isPct ? '1' : '0.01';
      if (isPct) amountEl.max = '100';
      else amountEl.removeAttribute('max');
    }
  }

  function couponError(msg, field) {
    const errEl = $('#couponError');
    if (errEl) errEl.textContent = msg || '';
    ['#couponCode', '#couponAmount'].forEach(sel => {
      const el = $(sel);
      if (!el) return;
      const bad = Boolean(msg) && el === field;
      if (bad) {
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', 'couponError');
      } else {
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      }
    });
    if (field && msg) field.focus();
  }

  function resetCouponForm() {
    editingCouponId = null;
    const codeEl = $('#couponCode');
    const amtEl = $('#couponAmount');
    const typeEl = $('#couponType');
    if (codeEl) codeEl.value = '';
    if (amtEl) amtEl.value = '';
    if (typeEl) typeEl.value = 'percent';
    couponError('');
    const subEl = $('#couponSubmit');
    if (subEl) subEl.textContent = 'Add coupon';
    const cancelEl = $('#couponCancelEdit');
    if (cancelEl) cancelEl.hidden = true;
    syncCouponTypeUI();
  }

  function submitCoupon() {
    if (!isLoaded('coupons')) return;
    const fv = R().formValidation;
    const codeEl = $('#couponCode');
    const amtEl = $('#couponAmount');
    const code = (codeEl?.value || '').trim().toUpperCase();
    const type = couponType($('#couponType')?.value);
    const rawAmount = amtEl?.value ?? '';
    const amount = parseFloat(rawAmount);

    if (!code) return couponError('Please enter a coupon code.', codeEl);
    if (!fv?.isValidCouponCode(code)) return couponError('Codes can only use letters, numbers, dashes and underscores.', codeEl);
    if (type === 'percent') {
      if (!fv?.isValidPercentage(rawAmount) || !(amount >= 1)) return couponError('A percent discount must be between 1 and 100%.', amtEl);
    } else if (!fv?.isValidPrice(rawAmount) || !(amount > 0)) {
      return couponError('Please enter a valid discount amount greater than 0.', amtEl);
    }
    if ((cur().coupons || []).some(c => String(c.code).toUpperCase() === code && !sameId(c.id, editingCouponId))) {
      return couponError('A coupon with that code already exists.', codeEl);
    }
    couponError('');

    const editId = editingCouponId;
    R().confirmation.confirmSaveCoupon(code, editId !== null, () =>
      (editId !== null ? updateCoupon(editId, { code, type, amount }) : addCoupon({ code, type, amount })));
  }

  /** Builds the state record from the server's coupon (falls back to what was sent). */
  function couponFromServer(server, sent, id) {
    const s = server && typeof server === 'object' ? server : {};
    const amount = Number(s.amount ?? s.discount ?? s.discount_value ?? sent.amount);
    return {
      id,
      code: s.code ?? sent.code,
      type: couponType(s.type ?? s.discount_type ?? sent.type),
      amount,
      discount: amount,
      description: s.description ?? sent.description ?? '',
      active: s.active !== undefined ? Boolean(s.active) : (s.is_active !== undefined ? s.is_active !== 0 : sent.active !== false)
    };
  }

  function setCouponFormBusy(busy) {
    ['#couponSubmit', '#couponCancelEdit'].forEach(sel => {
      const el = $(sel);
      if (el) el.disabled = busy;
    });
  }

  async function addCoupon({ code, type, amount }) {
    const payload = { code, type, amount, discount: amount, description: '', active: true };
    setCouponFormBusy(true);
    try {
      const res = await R().paymentsApi.createCoupon(payload);
      const id = res?.id ?? res?.data?.id ?? res?.coupon?.id;
      if (id === undefined || id === null || id === '') throw new Error('The server did not return the new coupon.');
      cur().coupons = cur().coupons || [];
      cur().coupons.push(couponFromServer(res?.coupon || res?.data, payload, id));
      resetCouponForm();
      renderCoupons();
      toast('Coupon added', { type: 'success' });
    } catch (err) {
      failToast(`Couldn't add the coupon ${code}.`, err);
    } finally {
      setCouponFormBusy(false);
    }
  }

  async function updateCoupon(id, { code, type, amount }) {
    const target = (cur().coupons || []).find(c => sameId(c.id, id));
    if (!target) return;
    const payload = {
      code,
      type,
      amount,
      discount: amount,
      description: target.description || '',
      active: target.active !== false
    };
    setCouponFormBusy(true);
    try {
      const res = await R().paymentsApi.updateCoupon(target.id, payload);
      Object.assign(target, couponFromServer(res?.coupon || res?.data, payload, target.id));
      resetCouponForm();
      renderCoupons();
      toast('Coupon updated', { type: 'success' });
    } catch (err) {
      failToast(`Couldn't update the coupon ${code}.`, err);
    } finally {
      setCouponFormBusy(false);
    }
  }

  function startCouponEdit(id) {
    const c = (cur().coupons || []).find(x => sameId(x.id, id));
    if (!c) return;
    editingCouponId = c.id;
    $('#couponCode').value = c.code;
    $('#couponType').value = couponType(c.type); // keeps an amount coupon an amount coupon (F2)
    $('#couponAmount').value = couponValue(c);
    couponError('');
    $('#couponSubmit').textContent = 'Update coupon';
    $('#couponCancelEdit').hidden = false;
    syncCouponTypeUI();
    $('#couponCode').focus();
  }

  function removeCoupon(btn) {
    const id = btn.dataset.couponDelete;
    const coupon = (cur().coupons || []).find(c => sameId(c.id, id));
    if (!coupon) return;
    R().confirmation.confirmRemoveCoupon(coupon.code, async () => {
      btn.disabled = true;
      try {
        await R().paymentsApi.deleteCoupon(coupon.id);
        cur().coupons = (cur().coupons || []).filter(c => !sameId(c.id, coupon.id));
        if (sameId(editingCouponId, coupon.id)) resetCouponForm();
        renderCoupons();
        toast('Coupon removed', { type: 'success' });
      } catch (err) {
        failToast(`Couldn't remove the coupon ${coupon.code}.`, err);
        if (btn.isConnected) btn.disabled = false;
      }
    });
  }

  function toggleCoupon(toggle) {
    const id = toggle.dataset.couponToggle;
    const target = (cur().coupons || []).find(c => sameId(c.id, id));
    if (!target) return;
    const nextActive = toggle.checked;
    toggle.checked = !nextActive; // show the stored state until the server confirms
    R().confirmation.confirmToggleActive('coupon', target.code, nextActive, async () => {
      toggle.disabled = true;
      try {
        await R().paymentsApi.updateCoupon(target.id, {
          code: target.code,
          type: couponType(target.type),
          amount: couponValue(target),
          discount: couponValue(target),
          description: target.description || '',
          active: nextActive
        });
        target.active = nextActive;
        renderCoupons();
        toast(nextActive ? `${target.code} is active` : `${target.code} is inactive`, { type: 'success' });
      } catch (err) {
        failToast(`Couldn't change the coupon ${target.code}.`, err);
        if (toggle.isConnected) toggle.disabled = false;
      }
    });
  }

  function initCouponListeners() {
    $('#couponSubmit')?.addEventListener('click', submitCoupon);
    $('#couponType')?.addEventListener('change', syncCouponTypeUI);
    $('#couponCancelEdit')?.addEventListener('click', () => { resetCouponForm(); $('#couponCode')?.focus(); });
    ['#couponAmount', '#couponCode'].forEach(sel => {
      const el = $(sel);
      el?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitCoupon(); } });
      el?.addEventListener('input', () => { if (el.getAttribute('aria-invalid') === 'true') couponError(''); });
    });

    const list = $('#couponList');
    if (!list) return;
    list.addEventListener('click', e => {
      const t = e.target instanceof Element ? e.target : e.target?.parentElement;
      if (!t) return;
      const edit = t.closest('[data-coupon-edit]');
      if (edit) { startCouponEdit(edit.dataset.couponEdit); return; }
      const rm = t.closest('[data-coupon-delete]');
      if (rm) removeCoupon(rm);
    });
    list.addEventListener('change', e => {
      const toggle = e.target.closest?.('[data-coupon-toggle]');
      if (toggle) toggleCoupon(toggle);
    });
  }

  /* ---------- Init ---------- */

  let initialised = false;
  function initPaymentsListeners() {
    if (initialised) return;
    initialised = true;
    initPricingListeners();
    initPackageListeners();
    initCouponListeners();
    numberFrames();
  }

  window.R59 = window.R59 || {};
  window.R59.payments = {
    renderPricing,
    renderPackages,
    renderCoupons,
    resetCouponForm,
    pricingIsInvalid,
    initPaymentsListeners
  };
  window.renderPricing = renderPricing;
  window.renderCoupons = renderCoupons;
  window.resetCouponForm = resetCouponForm;
  window.pricingIsInvalid = pricingIsInvalid;
})();
