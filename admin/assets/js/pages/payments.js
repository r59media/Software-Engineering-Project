/**
 * R59 Media Admin — Payments, Packages & Coupons Page Controller
 *
 * Manages base fees, per-person fees, down payment percentage,
 * photography package CRUD operations, and promotional coupon codes.
 */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => window.R59?.formValidation?.escapeHtml?.(s) || (s === null || s === undefined ? '' : String(s));
export function formatCurrency(val) {
    const num = parseFloat(val);
    return isNaN(num) ? '$0.00' : `$${num.toFixed(2)}`;
}
export function money(n) {
    const v = Number(n || 0);
    return '$' + v.toLocaleString('en-US', {
        minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
        maximumFractionDigits: 2
    });
}
export const PRICE_FIELDS = {
    baseFee: { input: '#baseFee', display: '#baseFeeDisplay' },
    perPerson: { input: '#perPerson', display: '#perPersonDisplay' },
    depositPercent: {
        input: '#depositPercent',
        display: '#depositDisplay',
        fmt: (v) => `${isNaN(parseFloat(v)) ? 0 : parseFloat(v)}%`,
        label: 'Edit percentage'
    }
};
export function setPriceLocked(key, locked) {
    const f = PRICE_FIELDS[key];
    if (!f)
        return;
    const input = $(f.input);
    const btn = document.querySelector(`.price-edit-btn[data-price-key="${key}"]`);
    if (!input)
        return;
    input.readOnly = locked;
    input.classList.toggle('price-locked', locked);
    if (btn) {
        btn.textContent = locked ? (f.label || 'Edit price') : 'Cancel';
        btn.setAttribute('aria-pressed', String(!locked));
    }
}
export function renderPricing() {
    const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
    if (!currentState.pricing)
        currentState.pricing = {};
    Object.entries(PRICE_FIELDS).forEach(([key, f]) => {
        const input = $(f.input);
        const val = currentState.pricing[key] ?? 0;
        if (input)
            input.value = String(val);
        if (f.display && $(f.display)) {
            $(f.display).textContent = (f.fmt || formatCurrency)(val);
        }
        setPriceLocked(key, true);
    });
    updateDepositExample();
}
export function updateDepositExample() {
    const el = $('#depositExample');
    if (!el)
        return;
    const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
    const pct = parseFloat(currentState.pricing?.depositPercent);
    if (isNaN(pct) || pct === 0) {
        el.textContent = 'Enter a percentage between 0 and 100 (e.g. 50%).';
    }
    else {
        const exampleDown = Math.round(500 * pct / 100);
        el.textContent = `The share of a booking's total collected upfront. Example: on a $500 booking, the down payment is ${money(exampleDown)}.`;
    }
}
export function pricingIsInvalid() {
    const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
    if (!currentState.pricing)
        return false;
    return Object.keys(PRICE_FIELDS).some(k => {
        const v = currentState.pricing[k];
        return v === '' || isNaN(parseFloat(v)) || parseFloat(v) < 0 || (k === 'depositPercent' && parseFloat(v) > 100);
    });
}
export function renderPackages() {
    const container = $('#packageList');
    if (!container)
        return;
    const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
    const packages = currentState.packages || [];
    if (packages.length === 0) {
        container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-title">No Photography Packages Configured</div>
        <p class="empty-state-desc">Click “Add package” below to create session offerings with custom pricing and descriptions.</p>
      </div>`;
        return;
    }
    container.innerHTML = packages.map(pkg => {
        const isCustomPrice = pkg.price === null || (pkg.priceMinor === null && pkg.price === null) || ((pkg.bookingMode === 'inquiry' || pkg.booking_mode === 'inquiry') && (pkg.price === null || pkg.price === 0));
        const displayPrice = isCustomPrice ? '' : (pkg.price !== null && pkg.price !== undefined ? Number(pkg.price) : 0);
        const bookingMode = pkg.bookingMode || pkg.booking_mode || (isCustomPrice ? 'inquiry' : 'direct');
        let addPeople = pkg.additionalPeople || pkg.additional_people || null;
        if (typeof addPeople === 'string') {
            try {
                addPeople = JSON.parse(addPeople);
            }
            catch {
                addPeople = null;
            }
        }
        const includedPeople = addPeople && addPeople.includedPeople !== undefined && addPeople.includedPeople !== null ? addPeople.includedPeople : '';
        const maxPeople = addPeople && addPeople.maxPeople !== undefined && addPeople.maxPeople !== null ? addPeople.maxPeople : '';
        let extraPrice = '';
        if (addPeople) {
            if (addPeople.extraPersonPriceMinor !== undefined && addPeople.extraPersonPriceMinor !== null) {
                extraPrice = addPeople.extraPersonPriceMinor / 100;
            }
            else if (addPeople.extraPersonPrice !== undefined && addPeople.extraPersonPrice !== null) {
                extraPrice = addPeople.extraPersonPrice;
            }
        }
        const durationVal = pkg.durationMinutes !== null && pkg.durationMinutes !== undefined
            ? pkg.durationMinutes
            : (pkg.duration_minutes !== null && pkg.duration_minutes !== undefined ? pkg.duration_minutes : (bookingMode === 'inquiry' ? '' : 60));
        const photoCountVal = pkg.photoCount !== null && pkg.photoCount !== undefined
            ? pkg.photoCount
            : (pkg.photo_count !== null && pkg.photo_count !== undefined ? pkg.photo_count : '');
        const outfitsVal = pkg.outfits !== null && pkg.outfits !== undefined ? pkg.outfits : '';
        return `
    <div class="card package-card" id="card-pkg-${esc(pkg.id)}" data-pkg-id="${esc(pkg.id)}">
      <div class="card-head">
        <h2>${esc(pkg.name || 'New Package')}</h2>
        <label class="toggle">
          <input type="checkbox" class="pkg-active-toggle" data-pkg-toggle="${esc(pkg.id)}" ${pkg.active !== false ? 'checked' : ''}>
          <span>Available</span>
        </label>
      </div>

      <label class="f" for="pkg-${esc(pkg.id)}-name">Package name</label>
      <input class="input package-name" id="pkg-${esc(pkg.id)}-name" type="text" value="${esc(pkg.name || '')}" placeholder="e.g. Portrait, Event">

      <label class="f" for="pkg-${esc(pkg.id)}-best-for" style="margin-top:10px;">Best for</label>
      <input class="input package-best-for" id="pkg-${esc(pkg.id)}-best-for" type="text" value="${esc(pkg.bestFor || pkg.best_for || '')}" placeholder="e.g. LinkedIn, resumes & personal branding">

      <div class="price-field-row" style="margin-top:10px;">
        <label class="f" for="pkg-${esc(pkg.id)}-price">Price ($)</label>
        <button type="button" class="btn btn-sm package-price-edit" style="${isCustomPrice ? 'display:none;' : ''}">Edit price</button>
      </div>
      <input class="input package-price price-locked" id="pkg-${esc(pkg.id)}-price" type="number" min="0" step="10" value="${esc(displayPrice)}" placeholder="${isCustomPrice ? 'Custom quote' : 'e.g. 150'}" readonly ${isCustomPrice ? 'disabled' : ''}>

      <label class="toggle" style="margin-top:8px; display:inline-flex; align-items:center; gap:8px;">
        <input type="checkbox" class="package-custom-price-toggle" id="pkg-${esc(pkg.id)}-custom-price" ${isCustomPrice ? 'checked' : ''}>
        <span style="font-size:12px; font-weight:500;">Custom Quote / Inquiry (No fixed price)</span>
      </label>

      <div class="row" style="gap:10px; margin-top:10px;">
        <div style="flex:1;">
          <label class="f" for="pkg-${esc(pkg.id)}-duration">Duration (minutes)</label>
          <input class="input package-duration" id="pkg-${esc(pkg.id)}-duration" type="number" min="0" step="5" value="${esc(durationVal)}" placeholder="e.g. 60">
        </div>
        <div style="flex:1;">
          <label class="f" for="pkg-${esc(pkg.id)}-booking-mode">Booking Mode</label>
          <select class="input package-booking-mode" id="pkg-${esc(pkg.id)}-booking-mode">
            <option value="direct" ${bookingMode === 'direct' ? 'selected' : ''}>Direct booking</option>
            <option value="inquiry" ${bookingMode === 'inquiry' ? 'selected' : ''}>Custom quote / Inquiry</option>
          </select>
        </div>
      </div>

      <div class="row" style="gap:10px; margin-top:10px;">
        <div style="flex:1;">
          <label class="f" for="pkg-${esc(pkg.id)}-photo-count">Photo count</label>
          <input class="input package-photo-count" id="pkg-${esc(pkg.id)}-photo-count" type="number" min="0" step="1" value="${esc(photoCountVal)}" placeholder="e.g. 10">
        </div>
        <div style="flex:1;">
          <label class="f" for="pkg-${esc(pkg.id)}-outfits">Outfits</label>
          <input class="input package-outfits" id="pkg-${esc(pkg.id)}-outfits" type="number" min="0" step="1" value="${esc(outfitsVal)}" placeholder="e.g. 2">
        </div>
      </div>

      <div class="additional-people-block" style="margin-top:12px; padding:10px; background:var(--panel-2, #18181b); border-radius:6px; border:1px solid var(--line, #27272a);">
        <div class="hint" style="font-weight:600; margin-bottom:6px; color:var(--text, #f4f4f5);">Additional People Rules</div>
        <div class="row" style="gap:8px;">
          <div style="flex:1;">
            <label class="f" for="pkg-${esc(pkg.id)}-inc-people" style="font-size:11px;">Included</label>
            <input class="input package-included-people" id="pkg-${esc(pkg.id)}-inc-people" type="number" min="1" step="1" value="${esc(includedPeople)}" placeholder="1">
          </div>
          <div style="flex:1;">
            <label class="f" for="pkg-${esc(pkg.id)}-max-people" style="font-size:11px;">Max</label>
            <input class="input package-max-people" id="pkg-${esc(pkg.id)}-max-people" type="number" min="1" step="1" value="${esc(maxPeople)}" placeholder="Unlimited">
          </div>
          <div style="flex:1;">
            <label class="f" for="pkg-${esc(pkg.id)}-extra-price" style="font-size:11px;">Extra ($)</label>
            <input class="input package-extra-price" id="pkg-${esc(pkg.id)}-extra-price" type="number" min="0" step="5" value="${esc(extraPrice)}" placeholder="0">
          </div>
        </div>
      </div>

      <label class="f" for="pkg-${esc(pkg.id)}-desc" style="margin-top:10px;">Short description</label>
      <textarea class="input desc-input" id="pkg-${esc(pkg.id)}-desc" rows="3" placeholder="Describe this photography package">${esc(pkg.description || '')}</textarea>

      <div class="row" style="margin-top:16px;">
        <button type="button" class="btn btn-danger btn-sm pkg-remove-btn" data-pkg-delete="${esc(pkg.id)}">Remove package</button>
        <button type="button" class="btn btn-primary btn-sm pkg-save-btn" style="flex:1; justify-content:center;">Save package</button>
      </div>
    </div>
  `;
    }).join('');
}
export function addPackage() {
    const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
    const newId = `pkg_${Date.now()}`;
    currentState.packages = currentState.packages || [];
    const newPkg = {
        id: newId,
        name: 'New Package',
        title: 'New Package',
        price: 0,
        priceMinor: 0,
        description: '',
        bestFor: '',
        best_for: '',
        durationMinutes: 60,
        duration_minutes: 60,
        photoCount: 5,
        photo_count: 5,
        outfits: 1,
        bookingMode: 'direct',
        booking_mode: 'direct',
        additionalPeople: { includedPeople: 1 },
        additional_people: { includedPeople: 1 },
        category: 'General',
        active: true,
        isNew: true
    };
    currentState.packages.push(newPkg);
    renderPackages();
    window.R59?.state?.markDirty?.();
    const newCard = document.querySelector(`#card-pkg-${newId}`);
    if (newCard) {
        const nameInput = newCard.querySelector('.package-name');
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    }
}
let editingCouponId = null;
export const couponLabel = (c) => {
    const amt = Number(c.amount ?? c.discount ?? 0);
    return c.type === 'percent' ? `${amt}% off` : `${money(amt)} off`;
};
export function renderCoupons() {
    const list = $('#couponList');
    if (!list)
        return;
    const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
    const coupons = currentState.coupons || [];
    if (!coupons.length) {
        list.innerHTML = '<p class="hint">No coupon codes yet.</p>';
        return;
    }
    list.innerHTML = coupons.map(c => {
        const label = couponLabel(c);
        return `
    <div class="coupon-item ${c.active ? '' : 'inactive'}">
      <div>
        <div class="coupon-code">${esc(c.code)}</div>
        <div class="hint">${label}${c.active ? '' : ' · Inactive'}</div>
      </div>
      <div class="coupon-actions">
        <label class="toggle">
          <input type="checkbox" data-coupon-active="${esc(c.id)}" data-coupon-toggle="${esc(c.id)}" ${c.active ? 'checked' : ''}>
          <span>Active</span>
        </label>
        <button type="button" class="btn btn-sm" data-coupon-edit="${esc(c.id)}">Edit</button>
        <button type="button" class="btn btn-danger btn-sm" data-coupon-remove="${esc(c.id)}" data-coupon-delete="${esc(c.id)}">Remove</button>
      </div>
    </div>`;
    }).join('');
}
export function syncCouponTypeUI() {
    const typeSelect = $('#couponType');
    if (!typeSelect)
        return;
    const isPct = typeSelect.value === 'percent';
    const labelEl = $('#couponAmountLabel');
    const amountEl = $('#couponAmount');
    if (labelEl)
        labelEl.textContent = isPct ? 'Percent off' : 'Amount off ($)';
    if (amountEl) {
        amountEl.placeholder = isPct ? '10' : '25';
        amountEl.step = isPct ? '1' : '0.01';
    }
}
export function resetCouponForm() {
    editingCouponId = null;
    const codeEl = $('#couponCode');
    const amtEl = $('#couponAmount');
    const typeEl = $('#couponType');
    const errEl = $('#couponError');
    const subEl = $('#couponSubmit');
    const cancelEl = $('#couponCancelEdit');
    if (codeEl)
        codeEl.value = '';
    if (amtEl)
        amtEl.value = '';
    if (typeEl)
        typeEl.value = 'percent';
    if (errEl)
        errEl.textContent = '';
    if (subEl)
        subEl.textContent = 'Add coupon';
    if (cancelEl)
        cancelEl.style.display = 'none';
    syncCouponTypeUI();
}
export async function submitCoupon() {
    const err = (msg) => {
        const errEl = $('#couponError');
        if (errEl)
            errEl.textContent = msg;
    };
    const code = ($('#couponCode')?.value || '').trim().toUpperCase();
    const type = ($('#couponType')?.value || 'percent');
    const amount = parseFloat(($('#couponAmount')?.value || '0'));
    if (!code)
        return err('Please enter a coupon code.');
    if (!window.R59?.formValidation?.isValidCouponCode?.(code)) {
        return err('Codes can only use letters, numbers, dashes and underscores.');
    }
    if (type === 'percent') {
        if (!window.R59?.formValidation?.isValidPercentage?.(amount) || amount <= 0) {
            return err('A percent discount must be between 1 and 100%.');
        }
    }
    else {
        if (!window.R59?.formValidation?.isValidPrice?.(amount) || amount <= 0) {
            return err('Please enter a valid discount amount greater than 0.');
        }
    }
    const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
    const coupons = currentState.coupons || [];
    if (coupons.some(c => c.code === code && String(c.id) !== String(editingCouponId))) {
        return err('A coupon with that code already exists.');
    }
    if (window.R59?.confirmation?.confirmSaveCoupon) {
        window.R59.confirmation.confirmSaveCoupon(code, Boolean(editingCouponId), () => commitCoupon({ code, type, amount }));
    }
    else {
        commitCoupon({ code, type, amount });
    }
}
export function commitCoupon({ code, type, amount }) {
    const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
    currentState.coupons = currentState.coupons || [];
    if (editingCouponId) {
        const target = currentState.coupons.find((c) => String(c.id) === String(editingCouponId));
        if (target) {
            const description = target.description || '';
            const active = target.active !== false;
            Object.assign(target, { code, type, amount, discount: amount, description, active });
            if (window.R59?.api?.payments?.updateCoupon) {
                window.R59.api.payments.updateCoupon(target.id, {
                    code,
                    type,
                    amount,
                    discount: amount,
                    description,
                    active
                }).catch((e) => console.warn('[payments] Failed to update coupon:', e));
            }
        }
        window.toast?.('Coupon updated');
    }
    else {
        const nextId = (currentState.coupons.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0)) + 1;
        const newCoupon = { id: nextId, code, type, amount, discount: amount, description: '', active: true };
        currentState.coupons.push(newCoupon);
        if (window.R59?.api?.payments?.createCoupon) {
            window.R59.api.payments.createCoupon({
                code,
                type,
                amount,
                discount: amount,
                description: '',
                active: true
            }).then((created) => {
                if (created?.id) {
                    newCoupon.id = created.id;
                    renderCoupons();
                }
            }).catch((e) => console.warn('[payments] Failed to create coupon:', e));
        }
        window.toast?.('Coupon added');
    }
    resetCouponForm();
    renderCoupons();
    window.R59?.state?.markDirty?.();
}
export function initPaymentsListeners() {
    // Pricing lock / edit buttons
    Object.entries(PRICE_FIELDS).forEach(([key, f]) => {
        const input = $(f.input);
        const btn = document.querySelector(`.price-edit-btn[data-price-key="${key}"]`);
        if (!input || !btn)
            return;
        btn.addEventListener('click', () => {
            const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
            const savedState = window.R59?.state?.getSaved ? window.R59.state.getSaved() : {};
            if (input.readOnly) {
                setPriceLocked(key, false);
                input.focus();
                input.select();
            }
            else {
                // Cancel edit: restore saved amount
                if (currentState.pricing && savedState.pricing) {
                    currentState.pricing[key] = savedState.pricing[key];
                    input.value = savedState.pricing[key];
                    if (f.display && $(f.display)) {
                        $(f.display).textContent = (f.fmt || formatCurrency)(savedState.pricing[key]);
                    }
                    setPriceLocked(key, true);
                    updateDepositExample();
                    const isDirty = JSON.stringify(currentState) !== JSON.stringify(savedState);
                    window.R59?.state?.setDirty?.(isDirty);
                }
            }
        });
        input.addEventListener('input', () => {
            if (input.readOnly)
                return;
            const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
            if (!currentState.pricing)
                currentState.pricing = {};
            currentState.pricing[key] = input.value === '' ? '' : parseFloat(input.value);
            if (f.display && $(f.display)) {
                $(f.display).textContent = (f.fmt || formatCurrency)(input.value);
            }
            updateDepositExample();
            window.R59?.state?.markDirty?.();
        });
    });
    // Package add button
    $('#addPackageBtn')?.addEventListener('click', addPackage);
    // Delegated package card actions
    document.addEventListener('click', async (e) => {
        const rawTarget = e.target instanceof Element ? e.target : e.target?.parentElement;
        if (!rawTarget)
            return;
        const removeBtn = rawTarget.closest('.pkg-remove-btn, [data-pkg-delete]');
        if (removeBtn) {
            e.preventDefault();
            const card = removeBtn.closest('.package-card');
            if (!card)
                return;
            const pkgId = removeBtn.dataset.pkgDelete || card.dataset.pkgId;
            const nameInput = card.querySelector('.package-name');
            const packageName = (nameInput?.value || 'this package').trim();
            const onConfirm = () => {
                const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
                const pkg = (currentState.packages || []).find((p) => String(p.id) === String(pkgId));
                currentState.packages = (currentState.packages || []).filter((p) => String(p.id) !== String(pkgId));
                const api = window.R59?.api?.packages || window.R59?.packagesApi;
                if (pkg && !pkg.isNew && !String(pkg.id).startsWith('pkg_') && api?.deletePackage) {
                    api.deletePackage(pkg.id).catch((err) => console.warn('[payments] Failed to delete package:', err));
                }
                renderPackages();
                window.R59?.state?.markDirty?.();
                window.toast?.(`${packageName} deleted`);
            };
            if (window.R59?.confirmation?.confirmRemovePackage) {
                window.R59.confirmation.confirmRemovePackage(packageName, onConfirm);
            }
            else {
                onConfirm();
            }
            return;
        }
        const editPriceBtn = rawTarget.closest('.package-price-edit');
        if (editPriceBtn) {
            e.preventDefault();
            const card = editPriceBtn.closest('.package-card');
            const customPriceToggle = card?.querySelector('.package-custom-price-toggle');
            if (customPriceToggle && customPriceToggle.checked)
                return;
            const priceInput = card?.querySelector('.package-price');
            if (priceInput) {
                priceInput.readOnly = !priceInput.readOnly;
                priceInput.classList.toggle('price-locked', priceInput.readOnly);
                editPriceBtn.textContent = priceInput.readOnly ? 'Edit price' : 'Finish editing';
                if (!priceInput.readOnly) {
                    priceInput.focus();
                    priceInput.select();
                }
            }
            return;
        }
        const saveBtn = rawTarget.closest('.pkg-save-btn');
        if (saveBtn) {
            e.preventDefault();
            const card = saveBtn.closest('.package-card');
            if (!card)
                return;
            const pkgId = card.dataset.pkgId;
            const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
            const pkg = currentState.packages?.find((p) => String(p.id) === String(pkgId));
            if (pkg) {
                const isCustomPrice = card.querySelector('.package-custom-price-toggle')?.checked ?? false;
                const rawPrice = card.querySelector('.package-price')?.value;
                if (!isCustomPrice) {
                    if (rawPrice !== undefined && rawPrice !== '' && !window.R59?.formValidation?.isValidPrice?.(rawPrice)) {
                        window.toast?.('Please enter a valid package price');
                        return;
                    }
                }
                const pendingName = card.querySelector('.package-name')?.value.trim() || 'Package';
                const isNewPending = pkg.isNew || String(pkg.id).startsWith('pkg_');
                if (window.R59?.confirmation?.confirmSavePackage) {
                    window.R59.confirmation.confirmSavePackage(pendingName, isNewPending, () => savePackage(card, pkg));
                }
                else {
                    savePackage(card, pkg);
                }
            }
            return;
        }
    });
    async function savePackage(card, pkg) {
        const name = card.querySelector('.package-name')?.value.trim() || 'Package';
        const bestFor = card.querySelector('.package-best-for')?.value.trim() || '';
        const isCustomPrice = card.querySelector('.package-custom-price-toggle')?.checked ?? false;
        const rawPrice = card.querySelector('.package-price')?.value;
        const rawDuration = card.querySelector('.package-duration')?.value;
        const rawPhotoCount = card.querySelector('.package-photo-count')?.value;
        const rawOutfits = card.querySelector('.package-outfits')?.value;
        const bookingMode = card.querySelector('.package-booking-mode')?.value || 'direct';
        const rawIncluded = card.querySelector('.package-included-people')?.value;
        const rawMax = card.querySelector('.package-max-people')?.value;
        const rawExtraPrice = card.querySelector('.package-extra-price')?.value;
        const description = card.querySelector('.desc-input')?.value.trim() || '';
        const active = card.querySelector('.pkg-active-toggle')?.checked ?? true;
        const price = isCustomPrice ? null : (rawPrice !== '' && rawPrice !== undefined && rawPrice !== null ? parseFloat(rawPrice) : null);
        const durationMinutes = rawDuration !== '' && rawDuration !== undefined && rawDuration !== null
            ? parseInt(rawDuration, 10)
            : (bookingMode === 'inquiry' ? null : 60);
        const photoCount = rawPhotoCount !== '' && rawPhotoCount !== undefined && rawPhotoCount !== null ? parseInt(rawPhotoCount, 10) : null;
        const outfits = rawOutfits !== '' && rawOutfits !== undefined && rawOutfits !== null ? parseInt(rawOutfits, 10) : null;
        let additionalPeople = null;
        const inc = rawIncluded !== '' && rawIncluded !== undefined && rawIncluded !== null ? parseInt(rawIncluded, 10) : null;
        const max = rawMax !== '' && rawMax !== undefined && rawMax !== null ? parseInt(rawMax, 10) : null;
        const extra = rawExtraPrice !== '' && rawExtraPrice !== undefined && rawExtraPrice !== null ? parseFloat(rawExtraPrice) : null;
        if (inc !== null || max !== null || extra !== null) {
            additionalPeople = {
                includedPeople: inc !== null ? inc : 1
            };
            if (max !== null)
                additionalPeople.maxPeople = max;
            if (extra !== null)
                additionalPeople.extraPersonPriceMinor = Math.round(extra * 100);
        }
        // Lock price field visually
        const priceInput = card.querySelector('.package-price');
        const priceBtn = card.querySelector('.package-price-edit');
        if (priceInput) {
            priceInput.readOnly = true;
            priceInput.classList.add('price-locked');
        }
        if (priceBtn)
            priceBtn.textContent = 'Edit price';
        const payload = {
            name,
            title: name,
            description,
            best_for: bestFor,
            bestFor: bestFor,
            photo_count: photoCount,
            photoCount: photoCount,
            outfits,
            duration_minutes: durationMinutes,
            durationMinutes: durationMinutes,
            booking_mode: bookingMode,
            bookingMode: bookingMode,
            additional_people: additionalPeople,
            additionalPeople: additionalPeople,
            category: pkg.category || 'General',
            is_active: active ? 1 : 0,
            active: active,
            customPrice: isCustomPrice,
            price: price
        };
        const isNewPkg = pkg.isNew || String(pkg.id).startsWith('pkg_');
        const api = window.R59?.api?.packages || window.R59?.packagesApi;
        try {
            if (isNewPkg && api?.createPackage) {
                const created = await api.createPackage(payload);
                if (created?.id || created?.data?.id) {
                    pkg.id = String(created.id || created.data.id);
                    delete pkg.isNew;
                }
            }
            else if (!isNewPkg && api?.updatePackage) {
                await api.updatePackage(pkg.id, payload);
            }
        }
        catch (err) {
            console.warn('[payments] Failed to persist package:', err);
            window.toast?.(`Could not save ${name}. Please try again.`, 4000);
            return;
        }
        // Update local state
        pkg.name = name;
        pkg.title = name;
        pkg.description = description;
        pkg.bestFor = bestFor;
        pkg.best_for = bestFor;
        pkg.price = price;
        pkg.priceMinor = price !== null ? Math.round(price * 100) : null;
        pkg.durationMinutes = durationMinutes;
        pkg.duration_minutes = durationMinutes;
        pkg.photoCount = photoCount;
        pkg.photo_count = photoCount;
        pkg.outfits = outfits;
        pkg.bookingMode = bookingMode;
        pkg.booking_mode = bookingMode;
        pkg.additionalPeople = additionalPeople;
        pkg.additional_people = additionalPeople;
        pkg.active = active;
        pkg.is_active = active ? 1 : 0;
        delete pkg.isNew;
        renderPackages();
        window.R59?.state?.markDirty?.();
        window.toast?.('Package saved');
    }
    // Delegated change events for toggles and dropdowns
    document.addEventListener('change', (e) => {
        const rawTarget = e.target;
        if (!rawTarget)
            return;
        // Custom price toggle
        const customPriceToggle = rawTarget.closest('.package-custom-price-toggle');
        if (customPriceToggle) {
            const card = customPriceToggle.closest('.package-card');
            const priceInput = card?.querySelector('.package-price');
            const priceBtn = card?.querySelector('.package-price-edit');
            if (customPriceToggle.checked) {
                if (priceInput) {
                    priceInput.readOnly = true;
                    priceInput.classList.add('price-locked');
                    priceInput.disabled = true;
                    priceInput.placeholder = 'Custom quote';
                }
                if (priceBtn)
                    priceBtn.style.display = 'none';
            }
            else {
                if (priceInput) {
                    priceInput.disabled = false;
                    priceInput.readOnly = false;
                    priceInput.classList.remove('price-locked');
                    priceInput.placeholder = 'e.g. 150';
                    priceInput.focus();
                }
                if (priceBtn) {
                    priceBtn.style.display = '';
                    priceBtn.textContent = 'Finish editing';
                }
            }
            window.R59?.state?.markDirty?.();
            return;
        }
        // Booking mode change
        const bookingModeSelect = rawTarget.closest('.package-booking-mode');
        if (bookingModeSelect) {
            const card = bookingModeSelect.closest('.package-card');
            const customToggle = card?.querySelector('.package-custom-price-toggle');
            if (bookingModeSelect.value === 'inquiry') {
                if (customToggle && !customToggle.checked) {
                    customToggle.checked = true;
                    customToggle.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            else if (bookingModeSelect.value === 'direct') {
                if (customToggle && customToggle.checked) {
                    customToggle.checked = false;
                    customToggle.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            window.R59?.state?.markDirty?.();
            return;
        }
        // Package active toggle listener
        const toggle = rawTarget.closest('.pkg-active-toggle, [data-pkg-toggle]');
        if (toggle) {
            const card = toggle.closest('.package-card');
            const pkgId = toggle.dataset.pkgToggle || card?.dataset.pkgId;
            if (!pkgId)
                return;
            const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
            const pkg = currentState.packages?.find((p) => String(p.id) === String(pkgId));
            if (!pkg)
                return;
            const nextActive = toggle.checked;
            if (window.R59?.confirmation?.confirmToggleActive) {
                window.R59.confirmation.confirmToggleActive('package', pkg.name || 'This package', nextActive, () => applyPackageActive(pkg, nextActive), () => { toggle.checked = !nextActive; });
            }
            else {
                applyPackageActive(pkg, nextActive);
            }
            return;
        }
        // Coupon active toggle listener
        const couponToggle = rawTarget.closest('[data-coupon-active], [data-coupon-toggle]');
        if (couponToggle) {
            const rawId = couponToggle.dataset.couponToggle || couponToggle.dataset.couponActive;
            const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
            const targetCoupon = (currentState.coupons || []).find((c) => String(c.id) === String(rawId));
            if (!targetCoupon)
                return;
            const nextActive = couponToggle.checked;
            if (window.R59?.confirmation?.confirmToggleActive) {
                window.R59.confirmation.confirmToggleActive('coupon', targetCoupon.code, nextActive, () => applyCouponActive(targetCoupon, nextActive), () => { couponToggle.checked = !nextActive; });
            }
            else {
                applyCouponActive(targetCoupon, nextActive);
            }
            return;
        }
    });
    function applyPackageActive(pkg, nextActive) {
        pkg.active = nextActive;
        pkg.is_active = nextActive ? 1 : 0;
        window.R59?.state?.markDirty?.();
        const api = window.R59?.api?.packages || window.R59?.packagesApi;
        if (!pkg.isNew && !String(pkg.id).startsWith('pkg_') && api?.updatePackage) {
            api.updatePackage(pkg.id, {
                title: pkg.name,
                name: pkg.name,
                is_active: nextActive ? 1 : 0
            }).catch((err) => console.warn('[payments] Failed to toggle package active status:', err));
        }
    }
    // Package card live inputs
    document.addEventListener('input', (e) => {
        const inputEl = e.target;
        if (!inputEl)
            return;
        const card = inputEl.closest('.package-card');
        if (!card)
            return;
        const pkgId = card.dataset.pkgId;
        const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
        const pkg = currentState.packages?.find((p) => String(p.id) === String(pkgId));
        if (!pkg)
            return;
        if (inputEl.classList.contains('package-name')) {
            const h2 = card.querySelector('h2');
            const val = inputEl.value.trim();
            if (h2)
                h2.textContent = val || 'Package';
            pkg.name = val;
            pkg.title = val;
            window.R59?.state?.markDirty?.();
        }
        else if (inputEl.classList.contains('package-price')) {
            pkg.price = parseFloat(inputEl.value) || 0;
            window.R59?.state?.markDirty?.();
        }
        else if (inputEl.classList.contains('desc-input')) {
            pkg.description = inputEl.value.trim();
            window.R59?.state?.markDirty?.();
        }
        else if (inputEl.classList.contains('package-best-for')) {
            const val = inputEl.value.trim();
            pkg.bestFor = val;
            pkg.best_for = val;
            window.R59?.state?.markDirty?.();
        }
        else if (inputEl.classList.contains('package-duration')) {
            const rawVal = inputEl.value;
            pkg.durationMinutes = rawVal !== '' ? parseInt(rawVal, 10) : null;
            pkg.duration_minutes = pkg.durationMinutes;
            window.R59?.state?.markDirty?.();
        }
        else if (inputEl.classList.contains('package-photo-count')) {
            const rawVal = inputEl.value;
            pkg.photoCount = rawVal !== '' ? parseInt(rawVal, 10) : null;
            pkg.photo_count = pkg.photoCount;
            window.R59?.state?.markDirty?.();
        }
        else if (inputEl.classList.contains('package-outfits')) {
            const rawVal = inputEl.value;
            pkg.outfits = rawVal !== '' ? parseInt(rawVal, 10) : null;
            window.R59?.state?.markDirty?.();
        }
        else if (inputEl.classList.contains('package-included-people') ||
            inputEl.classList.contains('package-max-people') ||
            inputEl.classList.contains('package-extra-price')) {
            window.R59?.state?.markDirty?.();
        }
    });
    // Coupons listeners
    $('#couponSubmit')?.addEventListener('click', submitCoupon);
    $('#couponType')?.addEventListener('change', syncCouponTypeUI);
    $('#couponCancelEdit')?.addEventListener('click', resetCouponForm);
    $('#couponAmount')?.addEventListener('keydown', (e) => { if (e.key === 'Enter')
        submitCoupon(); });
    $('#couponCode')?.addEventListener('keydown', (e) => { if (e.key === 'Enter')
        submitCoupon(); });
    $('#couponList')?.addEventListener('click', (e) => {
        const rawTarget = e.target;
        if (!rawTarget)
            return;
        const edit = rawTarget.closest('[data-coupon-edit]');
        const rm = rawTarget.closest('[data-coupon-remove], [data-coupon-delete]');
        const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
        if (edit) {
            const editId = edit.dataset.couponEdit;
            const c = (currentState.coupons || []).find((x) => String(x.id) === String(editId));
            if (!c)
                return;
            editingCouponId = c.id;
            const codeInput = $('#couponCode');
            const typeSelect = $('#couponType');
            const amountInput = $('#couponAmount');
            const errEl = $('#couponError');
            const submitBtn = $('#couponSubmit');
            const cancelBtn = $('#couponCancelEdit');
            if (codeInput)
                codeInput.value = c.code;
            if (typeSelect)
                typeSelect.value = c.type;
            if (amountInput)
                amountInput.value = String(Number(c.amount ?? c.discount ?? 0));
            if (errEl)
                errEl.textContent = '';
            if (submitBtn)
                submitBtn.textContent = 'Update coupon';
            if (cancelBtn)
                cancelBtn.style.display = '';
            syncCouponTypeUI();
            if (codeInput)
                codeInput.focus();
        }
        else if (rm) {
            const rawId = rm.dataset.couponDelete || rm.dataset.couponRemove;
            const coupon = (currentState.coupons || []).find((c) => String(c.id) === String(rawId));
            if (!coupon)
                return;
            const onConfirm = () => {
                currentState.coupons = (currentState.coupons || []).filter((c) => String(c.id) !== String(rawId));
                if (String(editingCouponId) === String(rawId))
                    resetCouponForm();
                if (window.R59?.api?.payments?.deleteCoupon) {
                    window.R59.api.payments.deleteCoupon(coupon.id).catch((err) => console.warn('[payments] Failed to delete coupon:', err));
                }
                renderCoupons();
                window.R59?.state?.markDirty?.();
                window.toast?.('Coupon removed');
            };
            if (window.R59?.confirmation?.confirmRemoveCoupon) {
                window.R59.confirmation.confirmRemoveCoupon(coupon.code, onConfirm);
            }
            else {
                onConfirm();
            }
        }
    });
    function applyCouponActive(target, nextActive) {
        target.active = nextActive;
        if (window.R59?.api?.payments?.updateCoupon) {
            const amt = Number(target.amount ?? target.discount ?? 0);
            window.R59.api.payments.updateCoupon(target.id, {
                ...target,
                amount: amt,
                discount: amt,
                active: target.active
            }).catch((err) => console.warn('[payments] Failed to toggle coupon:', err));
        }
        renderCoupons();
        window.R59?.state?.markDirty?.();
    }
}
export const payments = {
    renderPricing,
    renderPackages,
    renderCoupons,
    resetCouponForm,
    pricingIsInvalid,
    initPaymentsListeners
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.payments = payments;
    window.renderPricing = renderPricing;
    window.renderCoupons = renderCoupons;
    window.resetCouponForm = resetCouponForm;
    window.pricingIsInvalid = pricingIsInvalid;
}
export default payments;
