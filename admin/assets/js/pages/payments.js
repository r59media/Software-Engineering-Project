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
        if (fn)
            return fn(s);
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
        if (err && err.status === 401)
            return;
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
    const skelHtml = (label) => `<div class="skel" role="status" aria-label="${esc(label)}"><i></i><i></i><i></i><i></i></div>`;
    /** Frame numbers run 01, 02, … through the whole Payment view, in DOM order. */
    function numberFrames() {
        const view = $('#view-payment');
        if (!view)
            return;
        let n = 0;
        view.querySelectorAll('.roll').forEach(roll => {
            const first = n + 1;
            roll.querySelectorAll('.slot > .edge').forEach(edge => {
                n += 1;
                const no = edge.querySelector('[data-frame-no]');
                const code = edge.querySelector('[data-frame-code]');
                if (no)
                    no.textContent = `Frame ${pad2(n)}`;
                if (code)
                    code.textContent = `${pad2(n)}A`;
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
        if (!input)
            return;
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
        if (el)
            el.textContent = (f.fmt || formatCurrency)(value);
    }
    function renderPricing() {
        const status = loadStatus('pricing');
        const notice = $('#pricingNotice');
        if (notice)
            notice.innerHTML = status === 'failed' ? loadErrorHtml('pricing') : '';
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
            if (btn)
                btn.disabled = !usable;
            const figure = $(f.display);
            if (figure) {
                if (usable)
                    showPriceFigure(key, pricing[key] ?? 0);
                else
                    figure.textContent = '—';
                figure.classList.toggle('is-pending', !usable);
            }
            // A field with an unsaved edit stays open; everything else is locked.
            const edited = usable && String(pricing[key] ?? '') !== String(saved[key] ?? '');
            setPriceLocked(key, !edited);
            // re-check an edited field, and clear a stale error after Discard / save
            if (input && usable && (edited || input.getAttribute('aria-invalid') === 'true')) {
                R().formValidation?.validate?.(input);
            }
            else if (input && !usable) {
                input.removeAttribute('aria-invalid');
                const errEl = document.getElementById(`${input.id}-error`);
                if (errEl)
                    errEl.hidden = true;
            }
        });
        updateDepositExample();
    }
    function updateDepositExample() {
        const el = $('#depositExample');
        if (!el)
            return;
        if (!isLoaded('pricing')) {
            el.textContent = "The share of a booking's total that is collected upfront.";
            return;
        }
        const parsed = parseFloat(cur().pricing?.depositPercent);
        const pct = isNaN(parsed) ? 60 : parsed;
        if (pct < 1 || pct > 100) {
            el.textContent = 'Enter a whole number from 1 to 100 (e.g. 60%).';
        }
        else {
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
            if (!input)
                return;
            fv?.bind?.(input, fv.rules?.[f.rule]);
            btn?.addEventListener('click', () => {
                if (!isLoaded('pricing'))
                    return;
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
                if (input.readOnly || !isLoaded('pricing'))
                    return;
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
        if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < 0)
            return { h: '', m: '' };
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
    function bindSession(els, bookingModeEl) {
        const fv = R().formValidation;
        if (!fv?.sessionLengthRules || !els.h || !els.m)
            return;
        const rules = fv.sessionLengthRules(els.h, els.m, els.day, bookingModeEl);
        fv.bind(els.h, rules.hours);
        fv.bind(els.m, rules.minutes);
    }
    function packagePriceRule(bookingModeEl) {
        const fv = R().formValidation;
        const base = fv?.rules?.packagePrice;
        return {
            message: base?.message || 'Enter a price of 0 or more.',
            validate: v => {
                const isEmpty = v === null || v === undefined || String(v).trim() === '';
                if (bookingModeEl?.value === 'inquiry' && isEmpty)
                    return true;
                return base ? base.validate(v) : (!isEmpty && Number(v) >= 0);
            },
            attrs: { min: '0' }
        };
    }
    /** Each field's rule reads the other one, so both are re-checked together. */
    function revalidateSession(els, show = false) {
        const fv = R().formValidation;
        if (!fv)
            return;
        [els.h, els.m].forEach(el => {
            if (!el)
                return;
            if (show)
                fv.validate?.(el);
            else
                fv.revalidate?.(el);
        });
    }
    /** "Entire day" ticked: both fields are disabled (their typed values stay) and are not checked. */
    function applyFullDay(els) {
        const off = Boolean(els.day?.checked);
        [els.h, els.m].forEach(el => {
            if (!el)
                return;
            el.disabled = off;
            if (off)
                el.setAttribute('aria-disabled', 'true');
            else
                el.removeAttribute('aria-disabled');
        });
        // ticking clears any message; unticking re-checks quietly (a message shows again on blur or review)
        revalidateSession(els, off);
    }
    function showFieldError(input, message) {
        if (!input)
            return;
        input.setAttribute('aria-invalid', 'true');
        const errEl = document.getElementById(`${input.id}-error`);
        if (errEl) {
            const span = errEl.querySelector('span');
            if (span)
                span.textContent = message;
            errEl.hidden = false;
        }
    }
    function clearFieldError(input) {
        if (!input)
            return;
        input.removeAttribute('aria-invalid');
        const errEl = document.getElementById(`${input.id}-error`);
        if (errEl) {
            const span = errEl.querySelector('span');
            if (span)
                span.textContent = '';
            errEl.hidden = true;
        }
    }
    function validatePhotoCount(val) {
        if (val === '' || val === null || val === undefined)
            return { valid: true };
        const num = Number(val);
        if (!Number.isInteger(num) || num < 0) {
            return { valid: false, message: 'Photo count must be a whole number >= 0.' };
        }
        return { valid: true, value: num };
    }
    function validateAdditionalPeople(val) {
        if (!val || String(val).trim() === '')
            return { valid: true, parsed: null };
        const s = String(val).trim();
        try {
            const parsed = JSON.parse(s);
            if (typeof parsed !== 'object' || parsed === null) {
                return { valid: false, message: 'Must be a valid JSON object, e.g. {"includedPeople": 1}.' };
            }
            return { valid: true, parsed };
        }
        catch {
            const num = Number(s);
            if (Number.isInteger(num) && num >= 0) {
                return { valid: true, parsed: { includedPeople: num } };
            }
            return { valid: false, message: 'Must be valid JSON, e.g. {"includedPeople": 1} or leave blank.' };
        }
    }
    const findPkg = id => (cur().packages || []).find(p => sameId(p.id, id));
    const savedPkg = id => (st().getSaved?.().packages || {})[id] || null;
    const getRawSavedPkg = id => R().packagesApi?.getRawPackage?.(id) || null;
    function enrichPackage(pkg) {
        if (!pkg)
            return pkg;
        const raw = getRawSavedPkg(pkg.id);
        if (raw) {
            if (pkg.best_for === undefined && pkg.bestFor === undefined) {
                pkg.best_for = raw.best_for ?? raw.bestFor ?? '';
                pkg.bestFor = pkg.best_for;
            }
            if (pkg.booking_mode === undefined && pkg.bookingMode === undefined) {
                pkg.booking_mode = raw.booking_mode ?? raw.bookingMode ?? 'direct';
                pkg.bookingMode = pkg.booking_mode;
            }
            if (pkg.photo_count === undefined && pkg.photoCount === undefined) {
                pkg.photo_count = raw.photo_count !== null && raw.photo_count !== undefined
                    ? raw.photo_count
                    : (raw.photoCount !== null && raw.photoCount !== undefined ? raw.photoCount : '');
                pkg.photoCount = pkg.photo_count;
            }
            if (pkg.image_url === undefined && pkg.imageUrl === undefined) {
                pkg.image_url = raw.image_url ?? raw.imageUrl ?? raw.image?.url ?? '';
                pkg.imageUrl = pkg.image_url;
                pkg.image_alt = raw.image_alt ?? raw.imageAlt ?? raw.image?.alt ?? '';
                pkg.imageAlt = pkg.image_alt;
                if (pkg.image_url && !pkg.image) {
                    pkg.image = { url: pkg.image_url, alt: pkg.image_alt || pkg.name || '' };
                }
            }
            if (pkg.additional_people === undefined && pkg.additionalPeople === undefined) {
                const ap = raw.additional_people !== undefined ? raw.additional_people : raw.additionalPeople;
                pkg.additional_people = ap !== undefined && ap !== null ? (typeof ap === 'object' ? JSON.stringify(ap) : String(ap)) : '';
                pkg.additionalPeople = ap;
            }
            if (pkg.display_order === undefined && pkg.displayOrder === undefined) {
                pkg.display_order = raw.display_order !== undefined ? Number(raw.display_order) : (raw.displayOrder !== undefined ? Number(raw.displayOrder) : 0);
                pkg.displayOrder = pkg.display_order;
            }
        }
        return pkg;
    }
    function byDisplayOrder(a, b) {
        const orderA = a.display_order !== undefined ? Number(a.display_order) : (a.displayOrder !== undefined ? Number(a.displayOrder) : 0);
        const orderB = b.display_order !== undefined ? Number(b.display_order) : (b.displayOrder !== undefined ? Number(b.displayOrder) : 0);
        if (orderA !== orderB)
            return orderA - orderB;
        return Number(a.id || 0) - Number(b.id || 0);
    }
    let reordering = false;
    async function movePackage(id, direction) {
        if (reordering)
            return;
        const packages = (cur().packages || []).slice().sort(byDisplayOrder);
        const idx = packages.findIndex(p => sameId(p.id, id));
        if (idx === -1)
            return;
        const targetIdx = idx + (direction === 'up' ? -1 : 1);
        if (targetIdx < 0 || targetIdx >= packages.length)
            return;
        const moved = packages[idx];
        const target = packages[targetIdx];
        packages[idx] = target;
        packages[targetIdx] = moved;
        packages.forEach((p, i) => {
            p.display_order = i;
            p.displayOrder = i;
        });
        const ids = packages.map(p => Number(p.id)).filter(n => Number.isFinite(n));
        reordering = true;
        renderPackages();
        try {
            await R().packagesApi.reorder(ids);
            cur().packages = packages;
            packages.forEach(p => {
                const raw = R().packagesApi?._rawPackagesById?.get?.(String(p.id));
                if (raw) {
                    raw.display_order = p.display_order;
                    raw.displayOrder = p.display_order;
                }
            });
            toast(`“${moved.name || 'Package'}” moved ${direction}.`, { type: 'success' });
        }
        catch (err) {
            failToast("Couldn't update package order.", err);
            // Revert swap on failure:
            packages[targetIdx] = target;
            packages[idx] = moved;
            packages.forEach((p, i) => {
                p.display_order = i;
                p.displayOrder = i;
            });
        }
        finally {
            reordering = false;
            renderPackages();
        }
    }
    function packageSlotHtml(pkg, index = 0, total = 1) {
        const id = esc(pkg.id);
        const active = pkg.active !== false;
        const name = String(pkg.name ?? '');
        const sp = savedPkg(pkg.id);
        const priceEdited = sp && String(sp.price ?? '') !== String(pkg.price ?? '');
        const priceVal = pkg.price === '' || pkg.price === null || pkg.price === undefined ? '' : Number(pkg.price);
        const isFirst = index === 0;
        const isLast = index === total - 1;
        const bestFor = pkg.best_for ?? pkg.bestFor ?? '';
        const bookingMode = pkg.booking_mode ?? pkg.bookingMode ?? 'direct';
        const photoCount = pkg.photo_count !== undefined && pkg.photo_count !== null ? pkg.photo_count : (pkg.photoCount !== undefined && pkg.photoCount !== null ? pkg.photoCount : '');
        const imgUrl = pkg.image_url ?? pkg.imageUrl ?? pkg.image?.url ?? '';
        const apVal = pkg.additional_people !== undefined && pkg.additional_people !== null
            ? (typeof pkg.additional_people === 'object' ? JSON.stringify(pkg.additional_people) : String(pkg.additional_people))
            : (pkg.additionalPeople !== undefined && pkg.additionalPeople !== null ? (typeof pkg.additionalPeople === 'object' ? JSON.stringify(pkg.additionalPeople) : String(pkg.additionalPeople)) : '');
        return `
      <div class="slot">
        <div class="edge caps" aria-hidden="true"><span><svg class="tri"><use href="#i-tri"/></svg><span data-frame-no>Frame</span></span><span data-frame-code></span></div>
        <article class="frame pay-pkg${active ? '' : ' is-inactive'}" id="card-pkg-${id}" data-pkg-id="${id}" aria-labelledby="pkg-${id}-title">
          <div class="frame-head">
            <div>
              <h3 id="pkg-${id}-title" data-pkg-title>${esc(name.trim() || 'Package')}</h3>
              ${active ? '' : '<p class="pay-tags"><span class="tag tag--muted">Inactive</span></p>'}
            </div>
            <div style="display:flex;align-items:center;gap:var(--s2, 0.5rem);flex-wrap:wrap;">
              <div class="pay-order-controls" role="group" aria-label="Reorder package" style="display:inline-flex;align-items:center;gap:2px;">
                <button type="button" class="btn btn--icon btn--sm btn--ghost" data-pkg-move="up" data-pkg-id="${id}" title="Move package up" aria-label="Move package “${esc(name)}” up" ${isFirst || reordering ? 'disabled' : ''}>
                  <svg class="ico" aria-hidden="true"><use href="#i-up"/></svg>
                </button>
                <button type="button" class="btn btn--icon btn--sm btn--ghost" data-pkg-move="down" data-pkg-id="${id}" title="Move package down" aria-label="Move package “${esc(name)}” down" ${isLast || reordering ? 'disabled' : ''}>
                  <svg class="ico" aria-hidden="true"><use href="#i-down"/></svg>
                </button>
              </div>
              <label class="switch">
                <input type="checkbox" role="switch" data-pkg-toggle="${id}" ${active ? 'checked' : ''} aria-describedby="pkg-${id}-title">
                <span class="switch__track" aria-hidden="true"></span>
                <span class="switch__label">Available</span>
              </label>
            </div>
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
                <input class="field__input num" id="${pkgField(id, 'price')}" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(priceVal)}" placeholder="${bookingMode === 'inquiry' ? 'Custom' : ''}" ${priceEdited ? '' : 'readonly'} data-pkg-input="price">
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="${pkgField(id, 'best_for')}">Best for</label>
              <div class="field__control">
                <input class="field__input" id="${pkgField(id, 'best_for')}" type="text" maxlength="200" value="${esc(bestFor)}" data-pkg-input="best_for" placeholder="e.g. LinkedIn, resumes & personal branding">
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label class="field__label" for="${pkgField(id, 'booking_mode')}">Booking mode</label>
                <div class="field__control">
                  <select class="field__input" id="${pkgField(id, 'booking_mode')}" data-pkg-input="booking_mode">
                    <option value="direct"${bookingMode === 'direct' ? ' selected' : ''}>Direct booking</option>
                    <option value="inquiry"${bookingMode === 'inquiry' ? ' selected' : ''}>Inquiry only</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label class="field__label" for="${pkgField(id, 'photo_count')}">Photo count</label>
                <div class="field__control">
                  <input class="field__input num" id="${pkgField(id, 'photo_count')}" type="number" inputmode="numeric" min="0" step="1" value="${esc(numValue(photoCount))}" data-pkg-input="photo_count" placeholder="e.g. 10">
                </div>
                ${errorHtml(pkgField(id, 'photo_count'))}
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
              <label class="field__label" for="${pkgField(id, 'image_url')}">Package image</label>
              <div class="field__control" style="display:flex;gap:var(--s2, 0.5rem);align-items:center;">
                <input class="field__input" id="${pkgField(id, 'image_url')}" type="text" value="${esc(imgUrl)}" data-pkg-input="image_url" placeholder="https://... or /api/media/..." style="flex:1;">
                <label class="btn btn--ghost btn--sm" style="margin:0;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:var(--s1, 0.25rem);" title="Upload image file">
                  <svg class="ico" aria-hidden="true"><use href="#i-upload"/></svg>
                  <span>Upload</span>
                  <input type="file" accept="image/*" class="sr-only" data-pkg-image-file="${id}">
                </label>
              </div>
              <div class="pay-pkg-img-preview" style="margin-top:0.5rem;"${imgUrl ? '' : ' hidden'}><img data-auth-src="${esc(imgUrl)}" alt="${esc(name || 'Package')} preview" style="aspect-ratio: 16 / 7; width: 100%; max-width: 240px; object-fit: cover; border-radius: 6px;"></div>
            </div>
            <div class="field">
              <label class="field__label" for="${pkgField(id, 'additional_people')}">Additional people</label>
              <div class="field__control">
                <input class="field__input" id="${pkgField(id, 'additional_people')}" type="text" value="${esc(apVal)}" data-pkg-input="additional_people" placeholder='e.g. {"includedPeople": 1}'>
              </div>
              <p class="field__hint">JSON configuration for group bookings (e.g. {"includedPeople": 1, "maxPeople": 5}).</p>
              ${errorHtml(pkgField(id, 'additional_people'))}
            </div>
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
        if (!container)
            return;
        const status = loadStatus('packages');
        const addBtn = $('#addPackageBtn');
        if (addBtn)
            addBtn.disabled = status !== 'loaded';
        if (status !== 'loaded')
            closeAddForm();
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
        packages.forEach(enrichPackage);
        packages.sort(byDisplayOrder);
        container.innerHTML = packages.map((pkg, idx) => packageSlotHtml(pkg, idx, packages.length)).join('');
        const fv = R().formValidation;
        packages.forEach(pkg => {
            const name = document.getElementById(pkgField(pkg.id, 'name'));
            const price = document.getElementById(pkgField(pkg.id, 'price'));
            const outfits = document.getElementById(pkgField(pkg.id, 'outfits'));
            const photoCount = document.getElementById(pkgField(pkg.id, 'photo_count'));
            const additionalPeople = document.getElementById(pkgField(pkg.id, 'additional_people'));
            const bookingModeEl = document.getElementById(pkgField(pkg.id, 'booking_mode'));
            const session = sessionEls(sessionIds(pkg.id));
            const previewImg = document.querySelector(`#card-pkg-${CSS.escape(String(pkg.id))} .pay-pkg-img-preview img`);
            if (previewImg) {
                previewImg.addEventListener('error', () => {
                    if (previewImg.parentElement)
                        previewImg.parentElement.hidden = true;
                });
                const authSrc = previewImg.getAttribute('data-auth-src') || '';
                const apply = R().apiClient?.applyAuthorizedImageSrc;
                if (apply) {
                    apply(previewImg, authSrc);
                }
                else if (authSrc) {
                    previewImg.src = authSrc;
                }
            }
            fv?.bind?.(name, fv.rules?.packageName);
            fv?.bind?.(price, bookingModeEl ? packagePriceRule(bookingModeEl) : fv.rules?.packagePrice);
            fv?.bind?.(outfits, fv.rules?.packageOutfits);
            fv?.bind?.(photoCount, fv.rules?.packagePhotoCount);
            fv?.bind?.(additionalPeople, fv.rules?.packageAdditionalPeople);
            bindSession(session, bookingModeEl);
            // keep an invalid unsaved value visibly flagged after a re-render
            const sp = savedPkg(pkg.id);
            if (name && name.value !== String(sp?.name ?? name.value))
                fv?.validate?.(name);
            if (price && !price.readOnly)
                fv?.validate?.(price);
            if (outfits && String(numValue(sp?.outfits)) !== outfits.value)
                fv?.validate?.(outfits);
            if (photoCount && String(numValue(sp?.photo_count)) !== photoCount.value)
                fv?.validate?.(photoCount);
            if (additionalPeople && String(sp?.additional_people ?? '') !== additionalPeople.value.trim())
                fv?.validate?.(additionalPeople);
            if (pkg.full_day !== true && (sp?.full_day === true || String(numValue(sp?.duration_minutes)) !== String(sessionTotal(session)))) {
                revalidateSession(session, true);
            }
        });
        numberFrames();
    }
    async function onPackageImageUpload(fileInput) {
        const file = fileInput.files?.[0];
        if (!file)
            return;
        const converter = window.R59?.webpConverter;
        if (converter?.isSupportedImageFile && !converter.isSupportedImageFile(file)) {
            toast('Unsupported file format. Please upload JPG, PNG, WebP, HEIC, or RAW.', { type: 'error' });
            fileInput.value = '';
            return;
        }
        const id = fileInput.dataset.pkgImageFile;
        const isNew = id === 'new';
        const targetInput = isNew ? $('#pkgNewImage') : document.getElementById(pkgField(id, 'image_url'));
        fileInput.disabled = true;
        try {
            let uploadFile = file;
            if (converter?.convertToWebP) {
                toast(`Converting ${file.name} → WebP…`, { type: 'info' });
                const { file: webpFile } = await converter.convertToWebP(file, { quality: 0.92, maxDimension: 2560 });
                uploadFile = webpFile;
            }
            toast(`Uploading ${uploadFile.name}…`, { type: 'info' });
            let url = '';
            if (R().photographyApi?.uploadMedia) {
                const res = await R().photographyApi.uploadMedia(uploadFile);
                url = res.url || (res.key ? `/api/media/${res.key}` : '');
            }
            else {
                url = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(uploadFile);
                });
            }
            if (targetInput) {
                targetInput.value = url;
                targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            toast('Image uploaded', { type: 'success' });
        }
        catch (err) {
            failToast("Couldn't upload image.", err);
        }
        finally {
            fileInput.disabled = false;
            fileInput.value = '';
        }
    }
    function onPackageInput(e) {
        const input = e.target.closest?.('[data-pkg-input]');
        if (!input)
            return;
        const frame = input.closest('[data-pkg-id]');
        const pkg = frame && findPkg(frame.dataset.pkgId);
        if (!pkg)
            return;
        const kind = input.dataset.pkgInput;
        if (kind === 'name') {
            pkg.name = input.value;
            const title = frame.querySelector('[data-pkg-title]');
            if (title)
                title.textContent = input.value.trim() || 'Package';
        }
        else if (kind === 'price') {
            if (input.readOnly)
                return;
            pkg.price = input.value === '' ? '' : parseFloat(input.value);
        }
        else if (kind === 'description') {
            pkg.description = input.value;
        }
        else if (kind === 'outfits') {
            pkg.outfits = numFromInput(input);
        }
        else if (kind === 'duration-h' || kind === 'duration-m' || kind === 'fullday') {
            const session = sessionEls(sessionIds(pkg.id));
            if (kind === 'fullday') {
                pkg.full_day = input.checked;
                applyFullDay(session);
            }
            else {
                pkg.duration_minutes = sessionTotal(session);
                revalidateSession(session);
            }
        }
        else if (kind === 'best_for') {
            pkg.best_for = input.value;
            pkg.bestFor = input.value;
        }
        else if (kind === 'booking_mode') {
            pkg.booking_mode = input.value === 'inquiry' ? 'inquiry' : 'direct';
            pkg.bookingMode = pkg.booking_mode;
            const session = sessionEls(sessionIds(pkg.id));
            revalidateSession(session, true);
            const priceEl = document.getElementById(pkgField(pkg.id, 'price'));
            if (priceEl) {
                priceEl.placeholder = pkg.booking_mode === 'inquiry' ? 'Custom' : '';
                R().formValidation?.revalidate?.(priceEl);
            }
        }
        else if (kind === 'photo_count') {
            pkg.photo_count = numFromInput(input);
            pkg.photoCount = pkg.photo_count;
        }
        else if (kind === 'image_url') {
            pkg.image_url = input.value.trim();
            pkg.imageUrl = pkg.image_url;
            if (pkg.image_url) {
                pkg.image = { url: pkg.image_url, alt: pkg.name || 'Package' };
            }
            else {
                pkg.image = undefined;
            }
            const preview = frame.querySelector('.pay-pkg-img-preview img');
            if (preview) {
                const apply = R().apiClient?.applyAuthorizedImageSrc;
                if (apply) {
                    apply(preview, pkg.image_url);
                }
                else {
                    preview.src = pkg.image_url;
                }
                preview.parentElement.hidden = !pkg.image_url;
            }
        }
        else if (kind === 'additional_people') {
            const check = validateAdditionalPeople(input.value);
            pkg.additional_people = input.value.trim();
            pkg.additionalPeople = check.valid ? check.parsed : undefined;
        }
        st().markDirty();
    }
    function onPackagePriceEdit(btn) {
        const id = btn.dataset.pkgPriceEdit;
        const pkg = findPkg(id);
        const input = document.getElementById(pkgField(id, 'price'));
        if (!pkg || !input)
            return;
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
        if (!pkg)
            return;
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
                }
                else {
                    st().removePackage(pkg.id);
                    renderPackages();
                    toast(`${label} deleted`, { type: 'success' });
                }
            }
            catch (err) {
                failToast(`Couldn't remove “${label}”.`, err);
            }
            finally {
                if (btn.isConnected)
                    btn.disabled = false;
            }
        });
    }
    /** Availability toggle (record write): sends only { is_active }. */
    function onPackageToggle(toggle) {
        const id = toggle.dataset.pkgToggle;
        const pkg = findPkg(id);
        if (!pkg)
            return;
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
            }
            catch (err) {
                failToast(`Couldn't change “${label}”.`, err);
                if (toggle.isConnected)
                    toggle.disabled = false;
            }
        });
    }
    /* ----- Add package form (record write: POSTs on confirm) ----- */
    function openAddForm() {
        if (!isLoaded('packages'))
            return;
        const form = $('#pkgAddForm');
        const btn = $('#addPackageBtn');
        if (!form || !btn)
            return;
        form.hidden = false;
        btn.hidden = true;
        btn.setAttribute('aria-expanded', 'true');
        $('#pkgNewName')?.focus();
    }
    function closeAddForm({ focusButton = false } = {}) {
        const form = $('#pkgAddForm');
        const btn = $('#addPackageBtn');
        if (!form || !btn || form.hidden)
            return;
        form.reset();
        applyFullDay(sessionEls(NEW_SESSION_IDS));
        ['#pkgNewBestFor', '#pkgNewBookingMode', '#pkgNewPhotoCount', '#pkgNewImage', '#pkgNewAdditionalPeople'].forEach(sel => {
            const el = $(sel);
            if (el) {
                if (sel === '#pkgNewBookingMode')
                    el.value = 'direct';
                else
                    el.value = '';
                clearFieldError(el);
            }
        });
        form.querySelectorAll('[aria-invalid="true"]').forEach(el => {
            el.setCustomValidity?.('');
            R().formValidation?.validate?.(el);
        });
        form.hidden = true;
        btn.hidden = false;
        btn.setAttribute('aria-expanded', 'false');
        if (focusButton)
            btn.focus();
    }
    function submitAddForm(e) {
        e.preventDefault();
        const fv = R().formValidation;
        const nameEl = $('#pkgNewName');
        const priceEl = $('#pkgNewPrice');
        const descEl = $('#pkgNewDescription');
        const outfitsEl = $('#pkgNewOutfits');
        const bestForEl = $('#pkgNewBestFor');
        const bookingModeEl = $('#pkgNewBookingMode');
        const photoCountEl = $('#pkgNewPhotoCount');
        const imageEl = $('#pkgNewImage');
        const additionalPeopleEl = $('#pkgNewAdditionalPeople');
        const session = sessionEls(NEW_SESSION_IDS);
        if (!nameEl || !priceEl || !session.h || !session.m)
            return;
        const bookingMode = bookingModeEl?.value === 'inquiry' ? 'inquiry' : 'direct';
        const isDirect = bookingMode === 'direct';
        const fullDay = Boolean(session.day?.checked);
        const total = sessionTotal(session);
        const check = (el, fallback) => (fv ? fv.validate(el) : fallback);
        const pcCheck = photoCountEl ? validatePhotoCount(photoCountEl.value) : { valid: true };
        if (!pcCheck.valid)
            showFieldError(photoCountEl, pcCheck.message);
        else if (photoCountEl)
            clearFieldError(photoCountEl);
        const apCheck = additionalPeopleEl ? validateAdditionalPeople(additionalPeopleEl.value) : { valid: true };
        if (!apCheck.valid)
            showFieldError(additionalPeopleEl, apCheck.message);
        else if (additionalPeopleEl)
            clearFieldError(additionalPeopleEl);
        const checks = [
            [nameEl, check(nameEl, nameEl.value.trim() !== '')],
            [priceEl, !isDirect || check(priceEl, priceEl.value !== '')],
            [outfitsEl, outfitsEl ? check(outfitsEl, true) : true],
            [photoCountEl, pcCheck.valid],
            [additionalPeopleEl, apCheck.valid],
            // Entire day (or blank duration on an inquiry package): length fields are valid
            [session.h, fullDay || (!isDirect && total === '') || check(session.h, Number.isInteger(total) && total >= 15 && total <= 1440)],
            [session.m, fullDay || (!isDirect && total === '') || check(session.m, true)]
        ];
        const firstBad = checks.find(([, ok]) => !ok);
        if (firstBad) {
            firstBad[0]?.focus();
            return;
        }
        const name = nameEl.value.trim();
        const price = priceEl.value !== '' ? parseFloat(priceEl.value) : (isDirect ? 0 : null);
        const description = (descEl?.value || '').trim();
        const outfits = outfitsEl && outfitsEl.value !== '' ? Number(outfitsEl.value) : null;
        const durationMinutes = fullDay ? FULL_DAY_MINUTES : (total === '' ? null : total);
        const best_for = (bestForEl?.value || '').trim() || null;
        const photo_count = pcCheck.valid && photoCountEl && photoCountEl.value !== '' ? Number(photoCountEl.value) : null;
        const image_url = (imageEl?.value || '').trim() || null;
        const additional_people = apCheck.valid ? apCheck.parsed : null;
        R().confirmation.confirmSavePackage(name, true, () => createPackage({
            name,
            price,
            description,
            outfits,
            durationMinutes,
            fullDay,
            best_for,
            booking_mode: bookingMode,
            photo_count,
            image_url,
            additional_people
        }));
    }
    async function createPackage({ name, price, description, outfits, durationMinutes, fullDay, best_for, booking_mode, photo_count, image_url, additional_people }) {
        const submit = $('#pkgNewCreate');
        const cancel = $('#pkgNewCancel');
        if (submit)
            submit.disabled = true;
        if (cancel)
            cancel.disabled = true;
        try {
            const packages = cur().packages || [];
            const display_order = packages.length;
            const res = await R().packagesApi.createPackage({
                name,
                price,
                description,
                outfits,
                duration_minutes: durationMinutes,
                full_day: fullDay,
                is_active: 1,
                best_for,
                booking_mode,
                photo_count,
                image_url,
                additional_people,
                display_order
            });
            const data = res?.data && typeof res.data === 'object' ? res.data : {};
            const id = res?.id ?? data.id;
            if (id === undefined || id === null || id === '')
                throw new Error('The server did not return the new package.');
            const pkg = {
                id,
                name: data.name ?? data.title ?? name,
                description: data.description ?? description,
                price: data.price !== undefined && data.price !== null ? Number(data.price) / 100 : (price ?? 0),
                duration_minutes: numValue(data.duration_minutes ?? durationMinutes),
                outfits: numValue(data.outfits !== undefined ? data.outfits : outfits),
                full_day: data.full_day !== undefined ? (data.full_day === true || Number(data.full_day) === 1) : fullDay,
                category: data.category ?? '',
                active: data.is_active === undefined ? true : (data.is_active !== 0 && data.is_active !== false),
                best_for: data.best_for ?? data.bestFor ?? best_for ?? '',
                bestFor: data.best_for ?? data.bestFor ?? best_for ?? '',
                booking_mode: data.booking_mode ?? data.bookingMode ?? booking_mode ?? 'direct',
                bookingMode: data.booking_mode ?? data.bookingMode ?? booking_mode ?? 'direct',
                photo_count: numValue(data.photo_count ?? data.photoCount ?? photo_count),
                photoCount: numValue(data.photo_count ?? data.photoCount ?? photo_count),
                image_url: data.image_url ?? data.imageUrl ?? data.image?.url ?? image_url ?? '',
                imageUrl: data.image_url ?? data.imageUrl ?? data.image?.url ?? image_url ?? '',
                image_alt: data.image_alt ?? data.imageAlt ?? data.image?.alt ?? '',
                imageAlt: data.image_alt ?? data.imageAlt ?? data.image?.alt ?? '',
                image: data.image ?? (image_url ? { url: image_url, alt: name } : undefined),
                additional_people: data.additional_people !== undefined
                    ? (typeof data.additional_people === 'object' ? JSON.stringify(data.additional_people) : String(data.additional_people))
                    : (data.additionalPeople !== undefined ? (typeof data.additionalPeople === 'object' ? JSON.stringify(data.additionalPeople) : String(data.additionalPeople)) : (additional_people ? (typeof additional_people === 'object' ? JSON.stringify(additional_people) : String(additional_people)) : '')),
                additionalPeople: data.additionalPeople ?? additional_people,
                display_order: data.display_order ?? data.displayOrder ?? display_order,
                displayOrder: data.display_order ?? data.displayOrder ?? display_order
            };
            st().addPackage(pkg);
            closeAddForm();
            renderPackages();
            toast(`${pkg.name} added`, { type: 'success' });
            document.getElementById(pkgField(pkg.id, 'name'))?.focus();
        }
        catch (err) {
            failToast(`Couldn't add “${name}”.`, err);
        }
        finally {
            if (submit)
                submit.disabled = false;
            if (cancel)
                cancel.disabled = false;
        }
    }
    function initPackageListeners() {
        const fv = R().formValidation;
        const newBookingMode = $('#pkgNewBookingMode');
        fv?.bind?.($('#pkgNewName'), fv.rules?.packageName);
        fv?.bind?.($('#pkgNewPrice'), newBookingMode ? packagePriceRule(newBookingMode) : fv.rules?.packagePrice);
        fv?.bind?.($('#pkgNewOutfits'), fv.rules?.packageOutfits);
        const newSession = sessionEls(NEW_SESSION_IDS);
        bindSession(newSession, newBookingMode);
        newSession.h?.addEventListener('input', () => revalidateSession(newSession));
        newSession.m?.addEventListener('input', () => revalidateSession(newSession));
        newSession.day?.addEventListener('change', () => applyFullDay(newSession));
        newBookingMode?.addEventListener('change', () => {
            revalidateSession(newSession, true);
            fv?.revalidate?.($('#pkgNewPrice'));
        });
        $('#addPackageBtn')?.addEventListener('click', openAddForm);
        $('#pkgNewCancel')?.addEventListener('click', () => closeAddForm({ focusButton: true }));
        $('#pkgAddForm')?.addEventListener('submit', submitAddForm);
        $('#pkgAddForm')?.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeAddForm({ focusButton: true });
            }
        });
        const list = $('#packageList');
        if (!list)
            return;
        list.addEventListener('input', onPackageInput);
        list.addEventListener('click', e => {
            const t = e.target instanceof Element ? e.target : e.target?.parentElement;
            if (!t)
                return;
            const moveBtn = t.closest('[data-pkg-move]');
            if (moveBtn) {
                e.preventDefault();
                const dir = moveBtn.dataset.pkgMove;
                const id = moveBtn.dataset.pkgId;
                movePackage(id, dir);
                return;
            }
            const del = t.closest('[data-pkg-delete]');
            if (del) {
                e.preventDefault();
                onPackageDelete(del);
                return;
            }
            const edit = t.closest('[data-pkg-price-edit]');
            if (edit) {
                e.preventDefault();
                onPackagePriceEdit(edit);
            }
        });
        list.addEventListener('change', e => {
            const selectEl = e.target.closest?.('select[data-pkg-input]');
            if (selectEl)
                onPackageInput(e);
            const toggle = e.target.closest?.('[data-pkg-toggle]');
            if (toggle)
                onPackageToggle(toggle);
            const fileInput = e.target.closest?.('[data-pkg-image-file]');
            if (fileInput)
                onPackageImageUpload(fileInput);
        });
        $('#pkgAddForm')?.addEventListener('change', e => {
            const fileInput = e.target.closest?.('[data-pkg-image-file]');
            if (fileInput)
                onPackageImageUpload(fileInput);
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
            if (el)
                el.disabled = !on;
        });
    }
    function renderCoupons() {
        const list = $('#couponList');
        if (!list)
            return;
        const status = loadStatus('coupons');
        const notice = $('#couponNotice');
        if (notice)
            notice.innerHTML = status === 'failed' ? loadErrorHtml('coupons') : '';
        setCouponFormEnabled(status === 'loaded');
        if (status === 'loading') {
            list.innerHTML = skelHtml('Loading coupons');
            return;
        }
        if (status === 'failed') {
            list.innerHTML = '';
            return;
        }
        const coupons = cur().coupons || [];
        if (!coupons.length) {
            list.innerHTML = '<p class="hint">No coupon codes yet.</p>';
            return;
        }
        list.innerHTML = `<ul class="rows">${coupons.map(couponRowHtml).join('')}</ul>`;
    }
    function syncCouponTypeUI() {
        const typeSelect = $('#couponType');
        if (!typeSelect)
            return;
        const isPct = typeSelect.value === 'percent';
        const labelEl = $('#couponAmountLabel');
        const amountEl = $('#couponAmount');
        if (labelEl)
            labelEl.textContent = isPct ? 'Percent off' : 'Amount off ($)';
        if (amountEl) {
            amountEl.step = isPct ? '1' : '0.01';
            if (isPct)
                amountEl.max = '100';
            else
                amountEl.removeAttribute('max');
        }
    }
    function couponError(msg, field) {
        const errEl = $('#couponError');
        if (errEl)
            errEl.textContent = msg || '';
        ['#couponCode', '#couponAmount'].forEach(sel => {
            const el = $(sel);
            if (!el)
                return;
            const bad = Boolean(msg) && el === field;
            if (bad) {
                el.setAttribute('aria-invalid', 'true');
                el.setAttribute('aria-describedby', 'couponError');
            }
            else {
                el.removeAttribute('aria-invalid');
                el.removeAttribute('aria-describedby');
            }
        });
        if (field && msg)
            field.focus();
    }
    function resetCouponForm() {
        editingCouponId = null;
        const codeEl = $('#couponCode');
        const amtEl = $('#couponAmount');
        const typeEl = $('#couponType');
        if (codeEl)
            codeEl.value = '';
        if (amtEl)
            amtEl.value = '';
        if (typeEl)
            typeEl.value = 'percent';
        couponError('');
        const subEl = $('#couponSubmit');
        if (subEl)
            subEl.textContent = 'Add coupon';
        const cancelEl = $('#couponCancelEdit');
        if (cancelEl)
            cancelEl.hidden = true;
        syncCouponTypeUI();
    }
    function submitCoupon() {
        if (!isLoaded('coupons'))
            return;
        const fv = R().formValidation;
        const codeEl = $('#couponCode');
        const amtEl = $('#couponAmount');
        const code = (codeEl?.value || '').trim().toUpperCase();
        const type = couponType($('#couponType')?.value);
        const rawAmount = amtEl?.value ?? '';
        const amount = parseFloat(rawAmount);
        if (!code)
            return couponError('Please enter a coupon code.', codeEl);
        if (!fv?.isValidCouponCode(code))
            return couponError('Codes can only use letters, numbers, dashes and underscores.', codeEl);
        if (type === 'percent') {
            if (!fv?.isValidPercentage(rawAmount) || !(amount >= 1))
                return couponError('A percent discount must be between 1 and 100%.', amtEl);
        }
        else if (!fv?.isValidPrice(rawAmount) || !(amount > 0)) {
            return couponError('Please enter a valid discount amount greater than 0.', amtEl);
        }
        if ((cur().coupons || []).some(c => String(c.code).toUpperCase() === code && !sameId(c.id, editingCouponId))) {
            return couponError('A coupon with that code already exists.', codeEl);
        }
        couponError('');
        const editId = editingCouponId;
        R().confirmation.confirmSaveCoupon(code, editId !== null, () => (editId !== null ? updateCoupon(editId, { code, type, amount }) : addCoupon({ code, type, amount })));
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
            if (el)
                el.disabled = busy;
        });
    }
    async function addCoupon({ code, type, amount }) {
        const payload = { code, type, amount, discount: amount, description: '', active: true };
        setCouponFormBusy(true);
        try {
            const res = await R().paymentsApi.createCoupon(payload);
            const id = res?.id ?? res?.data?.id ?? res?.coupon?.id;
            if (id === undefined || id === null || id === '')
                throw new Error('The server did not return the new coupon.');
            cur().coupons = cur().coupons || [];
            cur().coupons.push(couponFromServer(res?.coupon || res?.data, payload, id));
            resetCouponForm();
            renderCoupons();
            toast('Coupon added', { type: 'success' });
        }
        catch (err) {
            failToast(`Couldn't add the coupon ${code}.`, err);
        }
        finally {
            setCouponFormBusy(false);
        }
    }
    async function updateCoupon(id, { code, type, amount }) {
        const target = (cur().coupons || []).find(c => sameId(c.id, id));
        if (!target)
            return;
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
        }
        catch (err) {
            failToast(`Couldn't update the coupon ${code}.`, err);
        }
        finally {
            setCouponFormBusy(false);
        }
    }
    function startCouponEdit(id) {
        const c = (cur().coupons || []).find(x => sameId(x.id, id));
        if (!c)
            return;
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
        if (!coupon)
            return;
        R().confirmation.confirmRemoveCoupon(coupon.code, async () => {
            btn.disabled = true;
            try {
                await R().paymentsApi.deleteCoupon(coupon.id);
                cur().coupons = (cur().coupons || []).filter(c => !sameId(c.id, coupon.id));
                if (sameId(editingCouponId, coupon.id))
                    resetCouponForm();
                renderCoupons();
                toast('Coupon removed', { type: 'success' });
            }
            catch (err) {
                failToast(`Couldn't remove the coupon ${coupon.code}.`, err);
                if (btn.isConnected)
                    btn.disabled = false;
            }
        });
    }
    function toggleCoupon(toggle) {
        const id = toggle.dataset.couponToggle;
        const target = (cur().coupons || []).find(c => sameId(c.id, id));
        if (!target)
            return;
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
            }
            catch (err) {
                failToast(`Couldn't change the coupon ${target.code}.`, err);
                if (toggle.isConnected)
                    toggle.disabled = false;
            }
        });
    }
    function initCouponListeners() {
        $('#couponSubmit')?.addEventListener('click', submitCoupon);
        $('#couponType')?.addEventListener('change', syncCouponTypeUI);
        $('#couponCancelEdit')?.addEventListener('click', () => { resetCouponForm(); $('#couponCode')?.focus(); });
        ['#couponAmount', '#couponCode'].forEach(sel => {
            const el = $(sel);
            el?.addEventListener('keydown', e => { if (e.key === 'Enter') {
                e.preventDefault();
                submitCoupon();
            } });
            el?.addEventListener('input', () => { if (el.getAttribute('aria-invalid') === 'true')
                couponError(''); });
        });
        const list = $('#couponList');
        if (!list)
            return;
        list.addEventListener('click', e => {
            const t = e.target instanceof Element ? e.target : e.target?.parentElement;
            if (!t)
                return;
            const edit = t.closest('[data-coupon-edit]');
            if (edit) {
                startCouponEdit(edit.dataset.couponEdit);
                return;
            }
            const rm = t.closest('[data-coupon-delete]');
            if (rm)
                removeCoupon(rm);
        });
        list.addEventListener('change', e => {
            const toggle = e.target.closest?.('[data-coupon-toggle]');
            if (toggle)
                toggleCoupon(toggle);
        });
    }
    /* ---------- Init ---------- */
    let initialised = false;
    function initPaymentsListeners() {
        if (initialised)
            return;
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
