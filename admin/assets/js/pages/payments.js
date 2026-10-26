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
      <div class="card package-card" id="card-pkg-${esc(pkg.id)}" data-pkg-id="${esc(pkg.id)}">
        <div class="card-head">
          <h2>${esc(pkg.name || 'New Package')}</h2>
          <label class="toggle">
            <input type="checkbox" class="pkg-active-toggle" data-pkg-toggle="${esc(pkg.id)}" ${pkg.active !== false ? 'checked' : ''}>
            <span>Available</span>
          </label>
        </div>
        <label class="f" for="pkg-${esc(pkg.id)}-name">Package name</label>
        <input class="input package-name" id="pkg-${esc(pkg.id)}-name" type="text" value="${esc(pkg.name || '')}">

        <div class="price-field-row">
          <label class="f" for="pkg-${esc(pkg.id)}-price">Price ($)</label>
          <button type="button" class="btn btn-sm package-price-edit">Edit price</button>
        </div>
        <input class="input package-price price-locked" id="pkg-${esc(pkg.id)}-price" type="number" min="0" step="10" value="${Number(pkg.price) || 0}" readonly>

        <label class="f" for="pkg-${esc(pkg.id)}-desc">Short description</label>
        <textarea class="input desc-input" id="pkg-${esc(pkg.id)}-desc" rows="3" placeholder="Describe this photography package">${esc(pkg.description || '')}</textarea>

        <div class="row" style="margin-top:16px;">
          <button type="button" class="btn btn-danger btn-sm pkg-remove-btn" data-pkg-delete="${esc(pkg.id)}">Remove package</button>
          <button type="button" class="btn btn-primary btn-sm pkg-save-btn" style="flex:1; justify-content:center;">Save package</button>
        </div>
      </div>
    `).join('');
  }

  function addPackage() {
    const currentState = window.R59.state.getState();
    const newId = `pkg_${Date.now()}`;
    currentState.packages = currentState.packages || [];
    const newPkg = {
      id: newId,
      name: 'New Package',
      price: 0,
      description: '',
      duration_minutes: 60,
      category: 'General',
      active: true,
      isNew: true
    };
    currentState.packages.push(newPkg);
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
  const couponLabel = c => {
    const amt = Number(c.amount ?? c.discount ?? 0);
    return c.type === 'percent' ? `${amt}% off` : `${money(amt)} off`;
  };

  function renderCoupons() {
    const list = $('#couponList');
    if (!list) return;

    const currentState = window.R59.state.getState();
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

  async function submitCoupon() {
    const err = msg => {
      const errEl = $('#couponError');
      if (errEl) errEl.textContent = msg;
    };

    const code = ($('#couponCode')?.value || '').trim().toUpperCase();
    const type = $('#couponType')?.value || 'percent';
    const amount = parseFloat($('#couponAmount')?.value);

    if (!code) return err('Please enter a coupon code.');
    if (!window.R59.formValidation?.isValidCouponCode(code)) return err('Codes can only use letters, numbers, dashes and underscores.');
    if (type === 'percent') {
      if (!window.R59.formValidation?.isValidPercentage(amount) || amount <= 0) return err('A percent discount must be between 1 and 100%.');
    } else {
      if (!window.R59.formValidation?.isValidPrice(amount) || amount <= 0) return err('Please enter a valid discount amount greater than 0.');
    }

    const currentState = window.R59.state.getState();
    if (currentState.coupons.some(c => c.code === code && String(c.id) !== String(editingCouponId))) {
      return err('A coupon with that code already exists.');
    }

    if (editingCouponId) {
      const target = currentState.coupons.find(c => String(c.id) === String(editingCouponId));
      if (target) {
        const description = target.description || '';
        const active = target.active !== false;
        Object.assign(target, { code, type, amount, discount: amount, description, active });
        if (window.R59.api?.payments?.updateCoupon) {
          window.R59.api.payments.updateCoupon(target.id, {
            code,
            type,
            amount,
            discount: amount,
            description,
            active
          }).catch(e => console.warn('[payments] Failed to update coupon:', e));
        }
      }
      window.toast('Coupon updated');
    } else {
      const nextId = (currentState.coupons.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0)) + 1;
      const newCoupon = { id: nextId, code, type, amount, discount: amount, description: '', active: true };
      currentState.coupons.push(newCoupon);
      if (window.R59.api?.payments?.createCoupon) {
        window.R59.api.payments.createCoupon({
          code,
          type,
          amount,
          discount: amount,
          description: '',
          active: true
        }).then(created => {
          if (created?.id) {
            newCoupon.id = created.id;
            renderCoupons();
          }
        }).catch(e => console.warn('[payments] Failed to create coupon:', e));
      }
      window.toast('Coupon added');
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
    document.addEventListener('click', async e => {
      const target = e.target instanceof Element ? e.target : e.target?.parentElement;
      if (!target) return;

      const removeBtn = target.closest('.pkg-remove-btn, [data-pkg-delete]');
      if (removeBtn) {
        e.preventDefault();
        const card = removeBtn.closest('.package-card');
        if (!card) return;
        const pkgId = removeBtn.dataset.pkgDelete || card.dataset.pkgId;
        const nameInput = card.querySelector('.package-name');
        const packageName = (nameInput?.value || 'this package').trim();

        window.R59.confirmation.confirmRemovePackage(packageName, () => {
          const currentState = window.R59.state.getState();
          const pkg = (currentState.packages || []).find(p => String(p.id) === String(pkgId));
          currentState.packages = (currentState.packages || []).filter(p => String(p.id) !== String(pkgId));
          if (pkg && !pkg.isNew && !String(pkg.id).startsWith('pkg_') && window.R59.api?.packages?.deletePackage) {
            window.R59.api.packages.deletePackage(pkg.id).catch(err => console.warn('[payments] Failed to delete package:', err));
          }
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
          const rawPrice = card.querySelector('.package-price')?.value;
          if (rawPrice !== undefined && rawPrice !== '' && !window.R59.formValidation?.isValidPrice(rawPrice)) {
            window.toast?.('Please enter a valid package price');
            return;
          }
          pkg.name = card.querySelector('.package-name')?.value.trim() || 'Package';
          pkg.price = parseFloat(rawPrice) || 0;
          pkg.description = card.querySelector('.desc-input')?.value.trim() || '';
          pkg.active = card.querySelector('.pkg-active-toggle')?.checked ?? true;

          const priceInput = card.querySelector('.package-price');
          const priceBtn = card.querySelector('.package-price-edit');
          if (priceInput) {
            priceInput.readOnly = true;
            priceInput.classList.add('price-locked');
          }
          if (priceBtn) priceBtn.textContent = 'Edit price';

          const isNewPkg = pkg.isNew || String(pkg.id).startsWith('pkg_');
          try {
            if (isNewPkg && window.R59.api?.packages?.createPackage) {
              const created = await window.R59.api.packages.createPackage({
                title: pkg.name,
                description: pkg.description,
                price: Math.round((Number(pkg.price) || 0) * 100),
                duration_minutes: Number(pkg.duration_minutes) || 60,
                category: pkg.category || 'General',
                is_active: pkg.active !== false ? 1 : 0
              });
              if (created?.id) {
                pkg.id = created.id;
                delete pkg.isNew;
                renderPackages();
              }
            } else if (!isNewPkg && window.R59.api?.packages?.updatePackage) {
              await window.R59.api.packages.updatePackage(pkg.id, {
                title: pkg.name,
                description: pkg.description,
                price: Math.round((Number(pkg.price) || 0) * 100),
                duration_minutes: Number(pkg.duration_minutes) || 60,
                category: pkg.category || 'General',
                is_active: pkg.active !== false ? 1 : 0
              });
            }
          } catch (err) {
            console.warn('[payments] Failed to persist package:', err);
          }
        }
        window.R59.state.markDirty();
        window.toast('Package saved');
      }
    });

    // Package active toggle listener
    document.addEventListener('change', e => {
      const toggle = e.target.closest('.pkg-active-toggle, [data-pkg-toggle]');
      if (!toggle) return;
      const card = toggle.closest('.package-card');
      const pkgId = toggle.dataset.pkgToggle || card?.dataset.pkgId;
      if (!pkgId) return;
      const currentState = window.R59.state.getState();
      const pkg = currentState.packages?.find(p => String(p.id) === String(pkgId));
      if (!pkg) return;
      pkg.active = toggle.checked;
      window.R59.state.markDirty();
      if (!pkg.isNew && !String(pkg.id).startsWith('pkg_') && window.R59.api?.packages?.updatePackage) {
        window.R59.api.packages.updatePackage(pkg.id, {
          title: pkg.name,
          description: pkg.description,
          price: Math.round((Number(pkg.price) || 0) * 100),
          is_active: pkg.active ? 1 : 0
        }).catch(err => console.warn('[payments] Failed to toggle package active status:', err));
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
      const rm = e.target.closest('[data-coupon-remove], [data-coupon-delete]');
      const currentState = window.R59.state.getState();

      if (edit) {
        const editId = edit.dataset.couponEdit;
        const c = currentState.coupons.find(x => String(x.id) === String(editId));
        if (!c) return;
        editingCouponId = c.id;
        $('#couponCode').value = c.code;
        $('#couponType').value = c.type;
        $('#couponAmount').value = Number(c.amount ?? c.discount ?? 0);
        $('#couponError').textContent = '';
        $('#couponSubmit').textContent = 'Update coupon';
        $('#couponCancelEdit').style.display = '';
        syncCouponTypeUI();
        $('#couponCode').focus();
      } else if (rm) {
        const rawId = rm.dataset.couponDelete || rm.dataset.couponRemove;
        const coupon = currentState.coupons.find(c => String(c.id) === String(rawId));
        if (!coupon) return;
        window.R59.confirmation.confirmRemoveCoupon(coupon.code, () => {
          currentState.coupons = currentState.coupons.filter(c => String(c.id) !== String(rawId));
          if (String(editingCouponId) === String(rawId)) resetCouponForm();
          if (window.R59.api?.payments?.deleteCoupon) {
            window.R59.api.payments.deleteCoupon(coupon.id).catch(err => console.warn('[payments] Failed to delete coupon:', err));
          }
          renderCoupons();
          window.R59.state.markDirty();
          window.toast('Coupon removed');
        });
      }
    });

    $('#couponList')?.addEventListener('change', e => {
      const t = e.target.closest('[data-coupon-active], [data-coupon-toggle]');
      if (!t) return;
      const rawId = t.dataset.couponToggle || t.dataset.couponActive;
      const currentState = window.R59.state.getState();
      const target = currentState.coupons.find(c => String(c.id) === String(rawId));
      if (target) {
        target.active = t.checked;
        if (window.R59.api?.payments?.updateCoupon) {
          const amt = Number(target.amount ?? target.discount ?? 0);
          window.R59.api.payments.updateCoupon(target.id, {
            ...target,
            amount: amt,
            discount: amt,
            active: target.active
          }).catch(err => console.warn('[payments] Failed to toggle coupon:', err));
        }
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
