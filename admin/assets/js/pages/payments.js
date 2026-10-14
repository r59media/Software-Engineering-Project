/**
 * R59 Media Admin — Payments, Packages & Coupons Page Module
 * 
 * Manages base fees, per-person fees, down payment percentage,
 * photography package CRUD operations, and promotional coupon codes.
 */

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => window.R59.formValidation?.escapeHtml(s) || String(s);

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

  const PRICE_FIELDS = {
    baseFee: { input: '#baseFee', display: '#baseFeeDisplay' },
    perPerson: { input: '#perPerson', display: '#perPersonDisplay' },
    depositPercent: {
      input: '#depositPercent',
      display: '#depositDisplay',
      fmt: v => `${isNaN(parseFloat(v)) ? 0 : parseFloat(v)}%`,
      label: 'Edit percentage'
    }
  };

  function setPriceLocked(key, locked) {
    const f = PRICE_FIELDS[key];
    if (!f) return;
    const input = $(f.input);
    const btn = document.querySelector(`.price-edit-btn[data-price-key="${key}"]`);
    if (!input) return;
    input.readOnly = locked;
    input.classList.toggle('price-locked', locked);
    if (btn) {
      btn.textContent = locked ? (f.label || 'Edit price') : 'Cancel';
      btn.setAttribute('aria-pressed', String(!locked));
    }
  }

  function renderPricing() {
    const currentState = window.R59.state.getState();
    Object.entries(PRICE_FIELDS).forEach(([key, f]) => {
      const input = $(f.input);
      const val = currentState.pricing[key] ?? 0;
      if (input) input.value = val;
      if (f.display && $(f.display)) {
        $(f.display).textContent = (f.fmt || formatCurrency)(val);
      }
      setPriceLocked(key, true);
    });
    updateDepositExample();
  }

  function updateDepositExample() {
    const el = $('#depositExample');
    if (!el) return;
    const currentState = window.R59.state.getState();
    const pct = parseFloat(currentState.pricing.depositPercent);
    if (isNaN(pct) || pct === 0) {
      el.textContent = 'Enter a percentage between 0 and 100 (e.g. 50%).';
    } else {
      const exampleDown = Math.round(500 * pct / 100);
      el.textContent = `The share of a booking's total collected upfront. Example: on a $500 booking, the down payment is ${money(exampleDown)}.`;
    }
  }

  function pricingIsInvalid() {
    const currentState = window.R59.state.getState();
    return Object.keys(PRICE_FIELDS).some(k => {
      const v = currentState.pricing[k];
      return v === '' || isNaN(parseFloat(v)) || parseFloat(v) < 0 || (k === 'depositPercent' && parseFloat(v) > 100);
    });
  }

  /* ---------- Photography Packages Management ---------- */
  function renderPackages() {
    const container = $('#packageList');
    if (!container) return;

    const currentState = window.R59.state.getState();
    const packages = currentState.packages || [];

    if (packages.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state-title">No Photography Packages Configured</div>
          <p class="empty-state-desc">Click “Add package” below to create session offerings with custom pricing and descriptions.</p>
        </div>`;
      return;
    }

    container.innerHTML = packages.map(pkg => `
      <div class="card package-card" id="card-pkg-${pkg.id}" data-pkg-id="${pkg.id}">
        <div class="card-head">
          <h2>${esc(pkg.name || 'New Package')}</h2>
          <label class="toggle">
            <input type="checkbox" class="pkg-active-toggle" ${pkg.active ? 'checked' : ''}>
            <span>Available</span>
          </label>
        </div>
        <label class="f" for="pkg-${pkg.id}-name">Package name</label>
        <input class="input package-name" id="pkg-${pkg.id}-name" type="text" value="${esc(pkg.name || '')}">

        <div class="price-field-row">
          <label class="f" for="pkg-${pkg.id}-price">Price ($)</label>
          <button type="button" class="btn btn-sm package-price-edit">Edit price</button>
        </div>
        <input class="input package-price price-locked" id="pkg-${pkg.id}-price" type="number" min="0" step="10" value="${pkg.price || 0}" readonly>

        <label class="f" for="pkg-${pkg.id}-desc">Short description</label>
        <textarea class="input desc-input" id="pkg-${pkg.id}-desc" rows="3" placeholder="Describe this photography package">${esc(pkg.description || '')}</textarea>

        <div class="row" style="margin-top:16px;">
          <button type="button" class="btn btn-danger btn-sm pkg-remove-btn">Remove package</button>
          <button type="button" class="btn btn-primary btn-sm pkg-save-btn" style="flex:1; justify-content:center;">Save package</button>
        </div>
      </div>
    `).join('');
  }

  function addPackage() {
    const currentState = window.R59.state.getState();
    const newId = `pkg_${Date.now()}`;
    currentState.packages = currentState.packages || [];
    currentState.packages.push({
      id: newId,
      name: 'New Package',
      price: 0,
      description: '',
      active: true
    });
    renderPackages();
    window.R59.state.markDirty();
    const newCard = document.querySelector(`#card-pkg-${newId}`);
    if (newCard) {
      const nameInput = newCard.querySelector('.package-name');
      if (nameInput) { nameInput.focus(); nameInput.select(); }
    }
  }

  /* ---------- Coupons Management ---------- */
  let editingCouponId = null;
  const couponLabel = c => c.type === 'percent' ? `${c.amount}% off` : `${money(c.amount)} off`;

  function renderCoupons() {
    const list = $('#couponList');
    if (!list) return;

    const currentState = window.R59.state.getState();
    const coupons = currentState.coupons || [];

    if (!coupons.length) {
      list.innerHTML = '<p class="hint">No coupon codes yet.</p>';
      return;
    }

    list.innerHTML = coupons.map(c => `
      <div class="coupon-item ${c.active ? '' : 'inactive'}">
        <div>
          <div class="coupon-code">${esc(c.code)}</div>
          <div class="hint">${couponLabel(c)}${c.active ? '' : ' · Inactive'}</div>
        </div>
        <div class="coupon-actions">
          <label class="toggle">
            <input type="checkbox" data-coupon-active="${c.id}" ${c.active ? 'checked' : ''}>
            <span>Active</span>
          </label>
          <button type="button" class="btn btn-sm" data-coupon-edit="${c.id}">Edit</button>
          <button type="button" class="btn btn-danger btn-sm" data-coupon-remove="${c.id}">Remove</button>
        </div>
      </div>`).join('');
  }

  function syncCouponTypeUI() {
    const typeSelect = $('#couponType');
    if (!typeSelect) return;
    const isPct = typeSelect.value === 'percent';
    const labelEl = $('#couponAmountLabel');
    const amountEl = $('#couponAmount');
    if (labelEl) labelEl.textContent = isPct ? 'Percent off' : 'Amount off ($)';
    if (amountEl) {
      amountEl.placeholder = isPct ? '10' : '25';
      amountEl.step = isPct ? '1' : '0.01';
    }
  }

  function resetCouponForm() {
    editingCouponId = null;
    const codeEl = $('#couponCode');
    const amtEl = $('#couponAmount');
    const typeEl = $('#couponType');
    const errEl = $('#couponError');
    const subEl = $('#couponSubmit');
    const cancelEl = $('#couponCancelEdit');

    if (codeEl) codeEl.value = '';
    if (amtEl) amtEl.value = '';
    if (typeEl) typeEl.value = 'percent';
    if (errEl) errEl.textContent = '';
    if (subEl) subEl.textContent = 'Add coupon';
    if (cancelEl) cancelEl.style.display = 'none';
    syncCouponTypeUI();
  }

  function submitCoupon() {
    const err = msg => {
      const errEl = $('#couponError');
      if (errEl) errEl.textContent = msg;
    };

    const code = ($('#couponCode')?.value || '').trim().toUpperCase();
    const type = $('#couponType')?.value || 'percent';
    const amount = parseFloat($('#couponAmount')?.value);

    if (!code) return err('Please enter a coupon code.');
    if (!/^[A-Z0-9_-]+$/.test(code)) return err('Codes can only use letters, numbers, dashes and underscores.');
    if (!(amount > 0)) return err('Please enter a discount greater than 0.');
    if (type === 'percent' && amount > 100) return err('A percent discount cannot be more than 100%.');

    const currentState = window.R59.state.getState();
    if (currentState.coupons.some(c => c.code === code && c.id !== editingCouponId)) {
      return err('A coupon with that code already exists.');
    }

    if (editingCouponId) {
      const target = currentState.coupons.find(c => c.id === editingCouponId);
      if (target) Object.assign(target, { code, type, amount });
      window.toast('Coupon updated — click “Save changes” to apply');
    } else {
      const nextId = (currentState.coupons.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0)) + 1;
      currentState.coupons.push({ id: nextId, code, type, amount, active: true });
      window.toast('Coupon added — click “Save changes” to apply');
    }

    resetCouponForm();
    renderCoupons();
    window.R59.state.markDirty();
  }

  function initPaymentsListeners() {
    // Pricing lock / edit buttons
    Object.entries(PRICE_FIELDS).forEach(([key, f]) => {
      const input = $(f.input);
      const btn = document.querySelector(`.price-edit-btn[data-price-key="${key}"]`);
      if (!input || !btn) return;

      btn.addEventListener('click', () => {
        const currentState = window.R59.state.getState();
        const savedState = window.R59.state.getSaved();

        if (input.readOnly) {
          setPriceLocked(key, false);
          input.focus();
          input.select();
        } else {
          // Cancel edit: restore saved amount
          currentState.pricing[key] = savedState.pricing[key];
          input.value = savedState.pricing[key];
          if (f.display && $(f.display)) {
            $(f.display).textContent = (f.fmt || formatCurrency)(savedState.pricing[key]);
          }
          setPriceLocked(key, true);
          updateDepositExample();
          const isDirty = JSON.stringify(currentState) !== JSON.stringify(savedState);
          window.R59.state.setDirty(isDirty);
        }
      });

      input.addEventListener('input', () => {
        if (input.readOnly) return;
        const currentState = window.R59.state.getState();
        currentState.pricing[key] = input.value === '' ? '' : parseFloat(input.value);
        if (f.display && $(f.display)) {
          $(f.display).textContent = (f.fmt || formatCurrency)(input.value);
        }
        updateDepositExample();
        window.R59.state.markDirty();
      });
    });

    // Package add button
    $('#addPackageBtn')?.addEventListener('click', addPackage);

    // Delegated package card actions
    document.addEventListener('click', e => {
      const target = e.target instanceof Element ? e.target : e.target?.parentElement;
      if (!target) return;

      const removeBtn = target.closest('.pkg-remove-btn');
      if (removeBtn) {
        e.preventDefault();
        const card = removeBtn.closest('.package-card');
        if (!card) return;
        const pkgId = card.dataset.pkgId;
        const nameInput = card.querySelector('.package-name');
        const packageName = (nameInput?.value || 'this package').trim();

        window.R59.confirmation.confirmRemovePackage(packageName, () => {
          const currentState = window.R59.state.getState();
          currentState.packages = (currentState.packages || []).filter(p => String(p.id) !== String(pkgId));
          renderPackages();
          window.R59.state.markDirty();
          window.toast(`${packageName} deleted`);
        });
        return;
      }

      const editPriceBtn = target.closest('.package-price-edit');
      if (editPriceBtn) {
        e.preventDefault();
        const card = editPriceBtn.closest('.package-card');
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

      const saveBtn = target.closest('.pkg-save-btn');
      if (saveBtn) {
        e.preventDefault();
        const card = saveBtn.closest('.package-card');
        if (!card) return;
        const pkgId = card.dataset.pkgId;
        const currentState = window.R59.state.getState();
        const pkg = currentState.packages?.find(p => String(p.id) === String(pkgId));
        if (pkg) {
          pkg.name = card.querySelector('.package-name')?.value.trim() || 'Package';
          pkg.price = parseFloat(card.querySelector('.package-price')?.value) || 0;
          pkg.description = card.querySelector('.desc-input')?.value.trim() || '';
          pkg.active = card.querySelector('.pkg-active-toggle')?.checked ?? true;
        }
        window.R59.state.markDirty();
        window.toast('Package updated — click “Save changes” to apply');
      }
    });

    // Package card live inputs
    document.addEventListener('input', e => {
      const card = e.target.closest('.package-card');
      if (!card) return;
      const pkgId = card.dataset.pkgId;
      const currentState = window.R59.state.getState();
      const pkg = currentState.packages?.find(p => String(p.id) === String(pkgId));
      if (!pkg) return;

      if (e.target.classList.contains('package-name')) {
        const h2 = card.querySelector('h2');
        if (h2) h2.textContent = e.target.value.trim() || 'Package';
        pkg.name = e.target.value.trim();
        window.R59.state.markDirty();
      } else if (e.target.classList.contains('package-price')) {
        pkg.price = parseFloat(e.target.value) || 0;
        window.R59.state.markDirty();
      } else if (e.target.classList.contains('desc-input')) {
        pkg.description = e.target.value.trim();
        window.R59.state.markDirty();
      }
    });

    // Coupons listeners
    $('#couponSubmit')?.addEventListener('click', submitCoupon);
    $('#couponType')?.addEventListener('change', syncCouponTypeUI);
    $('#couponCancelEdit')?.addEventListener('click', resetCouponForm);
    $('#couponAmount')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitCoupon(); });
    $('#couponCode')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitCoupon(); });

    $('#couponList')?.addEventListener('click', e => {
      const edit = e.target.closest('[data-coupon-edit]');
      const rm = e.target.closest('[data-coupon-remove]');
      const currentState = window.R59.state.getState();

      if (edit) {
        const c = currentState.coupons.find(x => x.id === +edit.dataset.couponEdit);
        if (!c) return;
        editingCouponId = c.id;
        $('#couponCode').value = c.code;
        $('#couponType').value = c.type;
        $('#couponAmount').value = c.amount;
        $('#couponError').textContent = '';
        $('#couponSubmit').textContent = 'Update coupon';
        $('#couponCancelEdit').style.display = '';
        syncCouponTypeUI();
        $('#couponCode').focus();
      } else if (rm) {
        const id = +rm.dataset.couponRemove;
        const coupon = currentState.coupons.find(c => c.id === id);
        if (!coupon) return;
        window.R59.confirmation.confirmRemoveCoupon(coupon.code, () => {
          currentState.coupons = currentState.coupons.filter(c => c.id !== id);
          if (editingCouponId === id) resetCouponForm();
          renderCoupons();
          window.R59.state.markDirty();
          window.toast('Coupon removed — click “Save changes” to apply');
        });
      }
    });

    $('#couponList')?.addEventListener('change', e => {
      const t = e.target.closest('[data-coupon-active]');
      if (!t) return;
      const currentState = window.R59.state.getState();
      const target = currentState.coupons.find(c => c.id === +t.dataset.couponActive);
      if (target) {
        target.active = t.checked;
        renderCoupons();
        window.R59.state.markDirty();
      }
    });
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
