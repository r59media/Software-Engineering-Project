/**
 * R59 Media Admin — Main Application Entry Point
 * 
 * Orchestrates module initialization, global save/discard bar actions,
 * user authentication flow, and initial render lifecycle.
 */

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  function renderAll() {
    const currentState = window.R59.state.getState();

    // Bind basic text fields
    $$('[data-bind]').forEach(el => {
      if (currentState[el.dataset.bind] !== undefined) {
        el.value = currentState[el.dataset.bind];
      }
    });

    // Render each domain
    if (window.R59.photography) {
      window.R59.photography.updateBioCount();
      window.R59.photography.renderSocial();
      window.R59.photography.renderImages();
    }

    if (window.R59.payments) {
      window.R59.payments.renderPricing();
      window.R59.payments.renderPackages();
      window.R59.payments.resetCouponForm();
      window.R59.payments.renderCoupons();
    }

    if (window.R59.schedule) {
      window.R59.schedule.renderCalendar();
      window.R59.schedule.renderAvailability();
      window.R59.schedule.renderBookings();
      window.R59.schedule.renderBlockedDates();
    }

    if (window.R59.dashboard) {
      window.R59.dashboard.renderOverview();
    }
  }

  function initSaveBar() {
    $('#save')?.addEventListener('click', () => {
      if (window.R59.payments?.pricingIsInvalid()) {
        window.toast('Please enter valid amounts (prices 0 or more, down payment 0–100%) before saving');
        return;
      }

      const currentState = window.R59.state.getState();
      window.R59.state.setSaved(window.R59.state.clone(currentState));
      window.R59.state.setDirty(false);
      window.R59.state.setLastSaved(new Date());

      // Re-lock pricing fields
      window.R59.payments?.renderPricing();
      window.R59.state.syncStatus();
      if (window.R59.dashboard?.refreshOverview) window.R59.dashboard.refreshOverview();

      // Persist changes to backend if available
      (async () => {
        try {
          if (window.R59.paymentsApi) {
            await window.R59.paymentsApi.updatePricingSettings(currentState.pricing);
          }
          if (window.R59.scheduleApi) {
            await window.R59.scheduleApi.saveWeeklyAvailability(window.R59.state.getAvailability());
          }
          if (window.R59.photographyApi) {
            await window.R59.photographyApi.saveProfile({
              bio: currentState.bio || '',
              email: currentState.email || '',
              phone: currentState.phone || '',
              location: currentState.location || '',
              travel: currentState.travel || '',
              social: currentState.social || []
            });
          }
        } catch (err) {
          console.warn('[app] Could not persist changes to backend:', err);
        }
      })();

      window.toast('Changes saved');
    });

    $('#discard')?.addEventListener('click', () => {
      const savedState = window.R59.state.getSaved();
      window.R59.state.setState(window.R59.state.clone(savedState));
      window.R59.state.setDirty(false);
      window.R59.state.syncStatus();
      renderAll();
      window.toast('Changes discarded');
    });

    window.addEventListener('beforeunload', e => {
      if (window.R59.state.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function initAuth() {
    function logout() {
      const drawer = $('#drawer');
      if (drawer && drawer.classList.contains('open')) {
        window.R59.navigation.setDrawer(false);
      }

      window.R59.confirmation.confirmLogout(window.R59.state.isDirty(), () => {
        window.R59.apiClient?.setAuthToken(null);
        const savedState = window.R59.state.getSaved();
        window.R59.state.setState(window.R59.state.clone(savedState));
        window.R59.state.setDirty(false);
        window.R59.state.syncStatus();
        renderAll();
        $('#login')?.classList.add('open');
        $('#lu')?.focus();
      });
    }

    $('#logoutTop')?.addEventListener('click', logout);
    $('#logoutDrawer')?.addEventListener('click', logout);

    $('#loginForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#lu')?.value.trim() || '';
      const password = $('#lp')?.value || '';
      const errEl = $('#loginError');
      const submitBtn = $('#loginBtn');

      if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
      }

      if (!email || !password) {
        if (errEl) {
          errEl.textContent = 'Please enter both email and password.';
          errEl.style.display = 'block';
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';
      }

      try {
        const res = await window.R59.apiClient.post('/admin/login', { email, password });
        const token = (res && res.token) || password;
        if (window.R59.apiClient) {
          window.R59.apiClient.setAuthToken(token);
        }
        $('#login')?.classList.remove('open');
        window.R59.navigation.go('overview');
        window.toast('Signed in');
        await loadInitialBackendData();
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Invalid email or password.';
          errEl.style.display = 'block';
        }
        $('#lp')?.focus();
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign in';
        }
      }
    });
  }

  /**
   * Attempt to load backend records if the API is available.
   * If backend is not running or endpoints are not yet mounted,
   * frontend remains functional with empty state.
   */
  async function loadInitialBackendData() {
    // 1. Packages / Services
    try {
      if (window.R59.packagesApi) {
        const services = await window.R59.packagesApi.getPackages();
        if (Array.isArray(services) && services.length > 0) {
          const currentState = window.R59.state.getState();
          currentState.packages = services.map(s => ({
            id: s.id,
            name: s.name,
            description: s.description || '',
            price: (s.price || 0) / 100, // convert cents to dollars
            active: s.is_active !== 0
          }));
          window.R59.payments?.renderPackages();
        }
      }
    } catch {}

    // 2. Bookings
    try {
      if (window.R59.bookingsApi) {
        const res = await window.R59.bookingsApi.getBookings();
        if (res && Array.isArray(res.bookings) && res.bookings.length > 0) {
          const bookings = res.bookings.map(b => ({
            id: b.id,
            date: b.date || '',
            time: b.start_time || '',
            timeRange: b.end_time ? `${b.start_time} – ${b.end_time}` : b.start_time,
            customer: b.client_name || '',
            email: b.client_email || '',
            package: b.service_name || 'Photoshoot',
            price: (b.price_at_booking || 0) / 100,
            deposit: 0,
            status: b.status ? (b.status.charAt(0).toUpperCase() + b.status.slice(1)) : 'Confirmed'
          }));
          window.R59.state.setBookings(bookings);
          window.R59.schedule?.renderBookings();
          window.R59.schedule?.renderCalendar();
          window.R59.dashboard?.renderOverview();
        }
      }
    } catch {}

    // 3. Pricing Configuration
    try {
      if (window.R59.paymentsApi) {
        const pricing = await window.R59.paymentsApi.getPricingSettings();
        if (pricing && typeof pricing === 'object') {
          const currentState = window.R59.state.getState();
          currentState.pricing = { ...currentState.pricing, ...pricing };
          window.R59.payments?.renderPricing();
        }
      }
    } catch {}

    // 4. Coupons
    try {
      if (window.R59.paymentsApi) {
        const coupons = await window.R59.paymentsApi.getCoupons();
        if (Array.isArray(coupons)) {
          const currentState = window.R59.state.getState();
          currentState.coupons = coupons;
          window.R59.payments?.renderCoupons();
        }
      }
    } catch {}

    // 5. Weekly Availability
    try {
      if (window.R59.scheduleApi) {
        const avail = await window.R59.scheduleApi.getWeeklyAvailability();
        if (Array.isArray(avail) && avail.length > 0) {
          window.R59.state.setAvailability(avail);
          window.R59.schedule?.renderAvailability();
        }
      }
    } catch {}

    // 6. Blocked Dates
    try {
      if (window.R59.scheduleApi) {
        const blocked = await window.R59.scheduleApi.getBlockedDates();
        if (Array.isArray(blocked)) {
          window.R59.state.setBlockedDates(blocked);
          window.R59.schedule?.renderBlockedDates();
        }
      }
    } catch {}

    // 7. Profile Information
    try {
      if (window.R59.photographyApi) {
        const profile = await window.R59.photographyApi.getProfile();
        if (profile && typeof profile === 'object') {
          const currentState = window.R59.state.getState();
          if (profile.bio !== undefined) currentState.bio = profile.bio;
          if (profile.email !== undefined) currentState.email = profile.email;
          if (profile.phone !== undefined) currentState.phone = profile.phone;
          if (profile.location !== undefined) currentState.location = profile.location;
          if (profile.travel !== undefined) currentState.travel = profile.travel;
          if (Array.isArray(profile.social)) currentState.social = profile.social;
          renderAll();
        }
      }
    } catch {}
  }

  // App initialization
  document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize component listeners
    window.R59.modal.initModalListeners();
    window.R59.navigation.initNavigation();
    window.R59.payments.initPaymentsListeners();
    window.R59.photography.initPhotographyListeners();
    window.R59.schedule.initScheduleListeners();
    window.R59.dashboard.initDashboardListeners();

    initSaveBar();
    initAuth();

    // 2. Render initial view with clean state
    renderAll();
    window.R59.navigation.go('overview');

    // Prompt login modal if not yet authenticated
    if (!window.R59.apiClient?.getAuthToken()) {
      $('#login')?.classList.add('open');
      $('#lu')?.focus();
    } else {
      // 3. Gracefully query backend if authenticated
      loadInitialBackendData();
    }
  });

  window.R59 = window.R59 || {};
  window.R59.app = {
    renderAll,
    loadInitialBackendData
  };
  window.renderAll = renderAll;
})();
