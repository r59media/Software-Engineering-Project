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
    function resetLoginForm() {
      const submitBtn = $('#loginBtn');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in';
      }
      const errEl = $('#loginError');
      if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
      }
      if ($('#lp')) $('#lp').value = '';
      if ($('#modal')?.classList.contains('open')) {
        window.R59.modal?.closeModal();
      }
    }

    function logout() {
      const drawer = $('#drawer');
      if (drawer && drawer.classList.contains('open')) {
        window.R59.navigation.setDrawer(false);
      }

      const doLogout = () => {
        window.R59?.api?.client?.logout?.();
        window.R59.apiClient?.setAuthToken(null);
        document.body.classList.remove('authenticated');
        $('#login')?.classList.add('open');
        resetLoginForm();
        window.R59.state.setDirty(false);
        window.R59.state.syncStatus();
        window.toast('Logged out');
        setTimeout(() => {
          const u = $('#lu');
          if (u && !u.value) u.focus();
          else $('#lp')?.focus();
        }, 50);
      };

      if (window.R59.state?.isDirty && window.R59.state.isDirty()) {
        window.R59.confirmation.confirmLogout(true, doLogout);
      } else {
        doLogout();
      }
    }

    window.addEventListener('r59:unauthorized', (e) => {
      window.R59.apiClient?.setAuthToken(null);
      document.body.classList.remove('authenticated');
      $('#login')?.classList.add('open');
      resetLoginForm();
      const errEl = $('#loginError');
      if (errEl) {
        errEl.textContent = (e.detail && e.detail.message) || 'Session expired. Please sign in again.';
        errEl.style.display = 'block';
      }
      setTimeout(() => $('#lp')?.focus(), 50);
    });

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

      let res;
      try {
        res = await window.R59.apiClient.post('/admin/login', { email, password });
        if (!res || !res.token) {
          throw new Error('Authentication failed: No session token received.');
        }
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Invalid email address or password.';
          errEl.style.display = 'block';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign in';
        }
        $('#lp')?.focus();
        return;
      }

      // Login succeeded: transition UI immediately
      window.R59.apiClient.setAuthToken(res.token);
      document.body.classList.add('authenticated');
      $('#login')?.classList.remove('open');
      resetLoginForm();
      renderAll();
      window.R59.navigation.go('overview');
      window.toast('Signed in');

      // Fetch dashboard data concurrently in background without blocking UI
      loadInitialBackendData();
    });
  }

  /**
   * Concurrently load backend records if the API is available.
   * If backend is not running or endpoints are not yet mounted,
   * frontend remains functional with empty state.
   */
  async function loadInitialBackendData() {
    try {
      await Promise.allSettled([
        // 1. Packages / Services
        (async () => {
          if (!window.R59.packagesApi) return;
          const services = await window.R59.packagesApi.getPackages().catch(() => []);
          if (Array.isArray(services) && services.length > 0) {
            const currentState = window.R59.state.getState();
            currentState.packages = services.map(s => ({
              id: s.id,
              name: s.name || s.title || 'Package',
              description: s.description || '',
              price: (s.price || 0) / 100, // convert cents to dollars
              duration_minutes: s.duration_minutes || 60,
              category: s.category || 'General',
              active: s.is_active !== 0
            }));
            window.R59.payments?.renderPackages();
          }
        })(),

        // 2. Bookings
        (async () => {
          if (!window.R59.bookingsApi) return;
          const res = await window.R59.bookingsApi.getBookings().catch(() => null);
          if (res && Array.isArray(res.bookings) && res.bookings.length > 0) {
            const bookings = res.bookings.map(b => {
              const rawStart = b.start_time || b.time || '';
              const rawEnd = b.end_time || '';
              const dateStr = b.date || '';
              let dateFormatted = b.dateFormatted || dateStr;
              let dateLabel = b.dateLabel || dateStr;
              if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                const [y, m, d] = dateStr.split('-').map(Number);
                const dt = new Date(y, m - 1, d);
                dateFormatted = dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                dateLabel = dateFormatted.toUpperCase();
              }
              const rawPrice = b.totalPrice !== undefined
                ? Number(b.totalPrice)
                : (b.price_at_booking !== undefined ? Number(b.price_at_booking) / 100 : Number(b.price ?? 0));
              return {
                id: b.id,
                service_id: b.service_id,
                slot_id: b.slot_id,
                date: dateStr,
                dateFormatted,
                dateLabel,
                time: rawStart,
                start_time: rawStart,
                end_time: rawEnd,
                timeRange: rawEnd ? `${rawStart} – ${rawEnd}` : rawStart,
                customer: b.client_name || b.customer || '',
                email: b.client_email || b.email || '',
                phone: b.phone || '',
                location: b.location || '',
                notes: b.notes || '',
                people: Number(b.people ?? b.attendees ?? 1),
                attendees: Number(b.attendees ?? b.people ?? 1),
                coupon: b.coupon || '',
                package: b.service_name || b.package || 'Photoshoot',
                price: rawPrice,
                deposit: Number(b.deposit ?? 0),
                status: b.status ? (b.status.charAt(0).toUpperCase() + b.status.slice(1).toLowerCase()) : 'Confirmed'
              };
            });
            window.R59.state.setBookings(bookings);
            window.R59.schedule?.renderBookings();
            window.R59.schedule?.renderCalendar();
            window.R59.dashboard?.renderOverview();
          }
        })(),

        // 3. Pricing Configuration
        (async () => {
          if (!window.R59.paymentsApi) return;
          const pricing = await window.R59.paymentsApi.getPricingSettings().catch(() => null);
          if (pricing && typeof pricing === 'object') {
            const currentState = window.R59.state.getState();
            currentState.pricing = { ...currentState.pricing, ...pricing };
            window.R59.payments?.renderPricing();
          }
        })(),

        // 4. Coupons
        (async () => {
          if (!window.R59.paymentsApi) return;
          const coupons = await window.R59.paymentsApi.getCoupons().catch(() => []);
          if (Array.isArray(coupons)) {
            const currentState = window.R59.state.getState();
            currentState.coupons = coupons.map(c => ({
              id: c.id,
              code: c.code,
              type: c.type || c.discount_type || 'percent',
              amount: Number(c.amount ?? c.discount ?? c.discount_value ?? 0),
              discount: Number(c.discount ?? c.amount ?? c.discount_value ?? 0),
              description: c.description || '',
              active: c.active !== undefined ? Boolean(c.active) : c.is_active !== 0
            }));
            window.R59.payments?.renderCoupons();
          }
        })(),

        // 5. Weekly Availability
        (async () => {
          if (!window.R59.scheduleApi) return;
          const avail = await window.R59.scheduleApi.getWeeklyAvailability().catch(() => null);
          if (Array.isArray(avail) && avail.length > 0) {
            window.R59.state.setAvailability(avail);
            window.R59.schedule?.renderAvailability();
          }
        })(),

        // 6. Blocked Dates
        (async () => {
          if (!window.R59.scheduleApi) return;
          const blocked = await window.R59.scheduleApi.getBlockedDates().catch(() => []);
          if (Array.isArray(blocked)) {
            const normalizedBlocked = blocked.map(d => {
              const dateStr = d.dateStr || d.date || '';
              let dateFormatted = d.dateFormatted || dateStr;
              if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                const [y, m, day] = dateStr.split('-').map(Number);
                dateFormatted = new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              }
              return { id: d.id, date: dateStr, dateStr, dateFormatted, reason: d.reason || '' };
            });
            window.R59.state.setBlockedDates(normalizedBlocked);
            window.R59.schedule?.renderBlockedDates();
            window.R59.schedule?.renderCalendar();
          }
        })(),

        // 7. Profile Information
        (async () => {
          if (!window.R59.photographyApi) return;
          const profile = await window.R59.photographyApi.getProfile().catch(() => null);
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
        })(),

        // 8. Portfolio / Gallery Images
        (async () => {
          const photosRes = await (window.R59.api?.photography
            ? window.R59.api.photography.getGalleryImages()
            : Promise.resolve(null)).catch(() => null);
          if (Array.isArray(photosRes) && photosRes.length > 0) {
            const currentState = window.R59.state.getState();
            const mappedPhotos = photosRes.map((p, idx) => ({
              id: p.id ?? idx + 1,
              src: p.url || p.src || p.r2_object_key || '',
              r2_object_key: p.r2_object_key || '',
              label: p.title || p.label || p.alt_text || 'Photo',
              alt: p.alt_text || p.alt || p.title || 'Photo',
              cat: p.category || p.cat || 'Portrait',
              display_order: p.display_order ?? idx,
              is_featured: Boolean(p.is_featured)
            }));
            currentState.photos = mappedPhotos;
            currentState.images = currentState.images || { main: [], gallery: [], about: [] };
            currentState.images.gallery = mappedPhotos;
            window.R59.photography?.renderImages();
          }
        })()
      ]);
    } finally {
      const currentState = window.R59.state.getState();
      window.R59.state.setSaved(JSON.parse(JSON.stringify(currentState)));
      window.R59.state.setDirty(false);
      window.R59.state.syncStatus();
    }
  }

  // App initialization
  document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize component listeners
    window.R59.modal.initModalListeners();
    window.R59.navigation.initNavigation();
    window.R59.payments.initPaymentsListeners();
    window.R59.photography.initPhotographyListeners();
    window.R59.schedule.initScheduleListeners();
    window.R59.dashboard.initDashboardListeners();

    initSaveBar();
    initAuth();

    // 2. Asynchronously verify session with backend
    const hasToken = !!window.R59.apiClient?.getAuthToken();
    let isAuthenticated = false;

    if (hasToken) {
      isAuthenticated = await window.R59.apiClient.verifySession();
    }

    if (isAuthenticated) {
      document.body.classList.add('authenticated');
      $('#login')?.classList.remove('open');
      renderAll();
      window.R59.navigation.go('overview');
      loadInitialBackendData();
    } else {
      document.body.classList.remove('authenticated');
      $('#login')?.classList.add('open');
      $('#lu')?.focus();
    }
  });

  window.R59 = window.R59 || {};
  window.R59.app = {
    renderAll,
    loadInitialBackendData
  };
  window.renderAll = renderAll;
})();
