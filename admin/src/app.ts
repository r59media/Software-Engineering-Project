// @ts-nocheck
/**
 * R59 Media Admin — Main Application Entry Point
 *
 * Startup session check, gated module loading, per-area data loading with load status,
 * the save bar (Review & save / Discard), login and logout. The Settings dialog lives in
 * components/settings.js (R59.account); Forgot password and #reset= links in components/passwordReset.js.
 */

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const R = () => window.R59;
  const toast = (msg, opts) => window.R59.notifications?.toast?.(msg, opts);

  // Loaded dynamically upon confirmed session authentication;
  // index.html does not load these directly on boot.
  const GATED_ADMIN_SCRIPTS = [
    'assets/js/api/bookingsApi.js',
    'assets/js/api/packagesApi.js',
    'assets/js/api/paymentsApi.js',
    'assets/js/api/photographyApi.js',
    'assets/js/api/scheduleApi.js',
    'assets/js/utils/webpConverter.js',
    'assets/js/pages/dashboard.js',
    'assets/js/pages/schedule.js',
    'assets/js/pages/payments.js',
    'assets/js/pages/photography.js',
    'assets/js/pages/leads.js'
  ];

  const AREA_NAMES = {
    profile: 'profile',
    pricing: 'pricing',
    availability: 'availability',
    packages: 'packages',
    coupons: 'coupons',
    bookings: 'bookings',
    blockedDates: 'blocked dates',
    images: 'photos'
  };
  const SETTINGS_AREAS = ['profile', 'pricing', 'availability', 'packages'];

  let adminModulesLoaded = false;
  let adminModulesPromise = null;
  let hasEnteredApp = false;
  let saving = false;

  /* ---------- Shell ---------- */

  function setWorkspaceAuthenticated(isAuth) {
    document.body.classList.toggle('authenticated', Boolean(isAuth));
    document.body.classList.toggle('is-login', !isAuth);
    const appEl = $('.app');
    if (appEl) {
      if (isAuth) {
        appEl.removeAttribute('inert');
        appEl.removeAttribute('aria-hidden');
      } else {
        appEl.setAttribute('inert', '');
        appEl.setAttribute('aria-hidden', 'true');
      }
    }
  }

  function fetchGatedScript(src: string): Promise<boolean> {
    const existing = document.querySelector(`script[data-gated-src="${src}"]`);
    if (existing && existing.getAttribute('data-loaded') === 'true') {
      return Promise.resolve(true);
    }
    if (existing) existing.remove();
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.async = false;
      s.setAttribute('data-gated-src', src);
      s.addEventListener('load', () => {
        s.setAttribute('data-loaded', 'true');
        resolve(true);
      });
      s.addEventListener('error', (err) => {
        console.error('[R59 Admin] Failed to load module script:', src, err);
        s.remove();
        resolve(false);
      });
      s.src = src;
      document.body.appendChild(s);
    });
  }

  async function ensureAdminModulesLoaded() {
    if (adminModulesLoaded) return true;
    if (adminModulesPromise) return adminModulesPromise;
    adminModulesPromise = (async () => {
      try {
        // Load all module scripts externally (CSP script-src 'self'), preserving execution order
        const results = await Promise.all(
          GATED_ADMIN_SCRIPTS.map(src => fetchGatedScript(src))
        );

        // Pages namespace & event aliases for compatibility
        const r = R();
        const allLoaded = results.every(Boolean);
        const modulesReady = Boolean(
          r.dashboard && r.payments && r.photography && r.schedule && r.leads &&
          r.packagesApi && r.photographyApi && r.paymentsApi && r.scheduleApi && r.bookingsApi
        );
        if (!allLoaded || !modulesReady) {
          throw new Error('One or more admin modules failed to initialize.');
        }

        r.pages = r.pages || {};
        if (r.schedule) {
          r.pages.schedule = r.schedule;
          r.pages.schedule.initScheduleEvents = r.schedule.initScheduleListeners;
        }
        if (r.payments) {
          r.pages.payments = r.payments;
          r.pages.payments.initPaymentEvents = r.payments.initPaymentsListeners;
        }
        if (r.photography) {
          r.pages.photography = r.photography;
          r.pages.photography.initPhotographyEvents = r.photography.initPhotographyListeners;
        }
        if (r.dashboard) {
          r.pages.dashboard = r.dashboard;
          r.pages.dashboard.initDashboardEvents = r.dashboard.initDashboardListeners;
        }

        r.pages.schedule?.initScheduleEvents?.();
        r.pages.payments?.initPaymentEvents?.();
        r.pages.photography?.initPhotographyEvents?.();
        r.pages.dashboard?.initDashboardEvents?.();
        r.leads?.initLeadsListeners?.();

        adminModulesLoaded = true;
        return true;
      } catch (err) {
        console.error('[R59 Admin] Failed to load gated admin modules:', err);
        adminModulesPromise = null;
        return false;
      }
    })();
    return adminModulesPromise;
  }

  /* ---------- Rendering ---------- */

  function fillBindings() {
    const currentState = R().state ? R().state.getState() : {};
    $$('[data-bind]').forEach(el => {
      const v = currentState[el.dataset.bind];
      if (v !== undefined && v !== null && typeof v !== 'object') el.value = v;
    });
  }

  const RENDER_HOOKS = {
    profile: () => {
      fillBindings();
      R().photography?.updateBioCount?.();
      R().photography?.renderSocial?.();
      R().photography?.renderProfile?.();
    },
    pricing: () => R().payments?.renderPricing?.(),
    packages: () => R().payments?.renderPackages?.(),
    coupons: () => R().payments?.renderCoupons?.(),
    availability: () => R().schedule?.renderAvailability?.(),
    bookings: () => {
      R().schedule?.renderBookings?.();
      R().schedule?.renderCalendar?.();
      R().dashboard?.renderOverview?.();
    },
    blockedDates: () => {
      R().schedule?.renderBlockedDates?.();
      R().schedule?.renderCalendar?.();
    },
    images: () => R().photography?.renderImages?.()
  };

  function renderArea(area) {
    try {
      RENDER_HOOKS[area]?.();
    } catch (err) {
      console.error(`[app] Rendering ${area} failed:`, err);
    }
  }

  function renderAll({ keepRecordForms = false } = {}) {
    fillBindings();

    const r = R();
    if (r.photography) {
      r.photography.updateBioCount?.();
      r.photography.renderSocial?.();
      r.photography.renderProfile?.();
      r.photography.renderImages?.();
    }
    if (r.payments) {
      r.payments.renderPricing?.();
      r.payments.renderPackages?.();
      if (!keepRecordForms) r.payments.resetCouponForm?.();
      r.payments.renderCoupons?.();
    }
    if (r.schedule) {
      r.schedule.renderCalendar?.();
      r.schedule.renderAvailability?.();
      r.schedule.renderBookings?.();
      r.schedule.renderBlockedDates?.();
    }
    (r.pages?.dashboard || r.dashboard)?.renderOverview?.();
  }

  /* ---------- Loading ---------- */

  function formatLongDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function mapBooking(b) {
    const rawStart = b.start_time || b.time || '';
    const rawEnd = b.end_time || '';
    const dateStr = b.date || '';
    let dateFormatted = b.dateFormatted || dateStr;
    let dateLabel = b.dateLabel || dateStr;
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      dateFormatted = formatLongDate(dateStr);
      dateLabel = dateFormatted.toUpperCase();
    }
    const rawPrice = b.totalPrice !== undefined
      ? Number(b.totalPrice)
      : (b.price_at_booking !== undefined ? Number(b.price_at_booking) / 100 : Number(b.price ?? 0));
    // Money is kept in integer cents for balanceOf (state.js); price/deposit stay in dollars for display code
    const wholeCents = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
    const priceCents = wholeCents(b.total_cents) ?? wholeCents(b.price_at_booking) ?? Math.round((Number.isFinite(rawPrice) ? rawPrice : 0) * 100);
    const depositCents = wholeCents(b.deposit_paid) ?? Math.round((Number(b.deposit) || 0) * 100);
    const baseCents = wholeCents(b.base_cents) ?? Math.round((Number.isFinite(rawPrice) ? rawPrice : 0) * 100);
    const chargesCents = wholeCents(b.charges_cents) ?? 0;
    const depositPercent = wholeCents(b.deposit_percent);
    const rawPackageId = b.packageId !== undefined ? b.packageId : b.service_id;
    const packageId = rawPackageId === undefined || rawPackageId === null || rawPackageId === '' ? null : Number(rawPackageId);
    const noPackage = R().state?.NO_PACKAGE || 'No package';
    return {
      id: b.id,
      service_id: packageId,
      packageId,
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
      package: packageId === null ? noPackage : (b.service_name || b.package || noPackage),
      price: rawPrice,
      deposit: Number(b.deposit ?? 0),
      priceCents,
      baseCents,
      chargesCents,
      depositCents,
      depositPercent,
      paymentsTotal: wholeCents(b.payments_total) ?? 0,
      paymentsCount: wholeCents(b.payments_count) ?? 0,
      squarePaymentId: b.square_payment_id ? String(b.square_payment_id) : '',
      photo_permission_portfolio: b.photo_permission_portfolio ?? 0,
      photo_permission_social: b.photo_permission_social ?? 0,
      photo_permission_accepted_at: b.photo_permission_accepted_at || null,
      photo_permission_version: b.photo_permission_version || 'v1',
      photoPermissionPortfolio: Boolean(b.photo_permission_portfolio),
      photoPermissionSocial: Boolean(b.photo_permission_social),
      photoPermissionAcceptedAt: b.photo_permission_accepted_at || null,
      photoPermissionVersion: b.photo_permission_version || 'v1',
      status: b.status ? (b.status.charAt(0).toUpperCase() + b.status.slice(1).toLowerCase()) : 'Confirmed'
    };
  }

  function requireApi(name) {
    const api = R()[name];
    if (!api) throw new Error('This part of the admin did not load. Refresh the page.');
    return api;
  }

  const str = v => (v === undefined || v === null ? '' : (typeof v === 'string' ? v : String(v)));

  // Each loader fetches one area (rejecting on any failure) and writes it into state.
  const LOADERS = {
    async packages() {
      const services = await requireApi('packagesApi').getPackages();
      if (!Array.isArray(services)) throw new Error('The server sent an unexpected package list.');
      const st = R().state;
      // Stored values only: a missing field stays empty (no placeholder defaults)
      const whole = v => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v));
      const normAp = ap => {
        if (ap === undefined || ap === null || ap === '') return '';
        if (typeof ap === 'object') return JSON.stringify(ap);
        const trimmed = String(ap).trim();
        if (!trimmed) return '';
        try { return JSON.stringify(JSON.parse(trimmed)); } catch { return trimmed; }
      };
      st.getState().packages = services.map(s => {
        const bookingMode = (s.booking_mode ?? s.bookingMode) === 'inquiry' ? 'inquiry' : 'direct';
        const priceMissing = s.priceMinor === null || s.price === null || s.price === undefined;
        const apParsed = s.additionalPeople ?? (typeof s.additional_people === 'object' ? s.additional_people : undefined);
        const imgUrl = str(s.image_url ?? s.imageUrl ?? s.image?.url);
        const imgAlt = str(s.image_alt ?? s.imageAlt ?? s.image?.alt);
        const bestFor = str(s.best_for ?? s.bestFor);
        const photoCount = whole(s.photo_count ?? s.photoCount);
        const displayOrder = Number(s.display_order ?? s.displayOrder ?? 0) || 0;
        const apStr = normAp(s.additional_people ?? s.additionalPeople);
        return {
          id: s.id,
          name: str(s.name ?? s.title),
          description: str(s.description),
          price: priceMissing && bookingMode === 'inquiry' ? '' : (Number(s.price || 0) / 100),
          duration_minutes: whole(s.duration_minutes ?? s.durationMinutes),
          outfits: whole(s.outfits),
          full_day: s.full_day === true || Number(s.full_day) === 1 || s.fullDay === true,
          category: str(s.category),
          active: s.is_active !== 0 && s.is_active !== false && s.isActive !== false,
          best_for: bestFor,
          bestFor,
          booking_mode: bookingMode,
          bookingMode,
          photo_count: photoCount,
          photoCount,
          image_url: imgUrl,
          imageUrl: imgUrl,
          image_alt: imgAlt,
          imageAlt: imgAlt,
          additional_people: apStr,
          additionalPeople: apParsed,
          display_order: displayOrder,
          displayOrder
        };
      });
      st.commitSaved('packages', st.getSettings().packages);
    },

    async bookings() {
      const api = requireApi('bookingsApi');
      let rows;
      if (typeof api.getAllBookings === 'function') {
        rows = await api.getAllBookings();
      } else {
        const res = await api.getBookings();
        rows = res && res.bookings;
      }
      if (!Array.isArray(rows)) throw new Error('The server sent an unexpected booking list.');
      R().state.setBookings(rows.map(mapBooking));
    },

    async pricing() {
      const pricing = await requireApi('paymentsApi').getPricingSettings();
      if (!pricing || typeof pricing !== 'object') throw new Error('The server sent no pricing settings.');
      const clean = pricing.data || pricing;
      const st = R().state;
      const cur = st.getState();
      const rawFeeRules = Array.isArray(clean.feeRules) ? clean.feeRules : [];
      const rawPolicy = clean.policy && typeof clean.policy === 'object' ? clean.policy : {};
      cur.pricing = {
        baseFee: Number(clean.baseFee ?? cur.pricing.baseFee ?? 0),
        perPerson: Number(clean.perPerson ?? cur.pricing.perPerson ?? 0),
        depositPercent: Number(clean.depositPercent ?? cur.pricing.depositPercent ?? 60),
        feeRules: rawFeeRules.map((r, idx) => ({
          id: String(r?.id || `fr_${idx + 1}`),
          name: String(r?.name ?? ''),
          trigger: String(r?.trigger ?? 'always'),
          daysBefore: r?.trigger === 'days_before_max' && r?.daysBefore !== undefined && r?.daysBefore !== null && r?.daysBefore !== ''
            ? Number(r.daysBefore)
            : '',
          amountType: String(r?.amountType ?? 'fixed_cents'),
          amount: Number(r?.amount ?? 0),
          active: r?.active !== false
        })),
        policy: {
          balanceDueDaysAfterEvent: Number(rawPolicy.balanceDueDaysAfterEvent ?? 4),
          rescheduleCutoffDays: Number(rawPolicy.rescheduleCutoffDays ?? 3),
          requireSignature: rawPolicy.requireSignature !== false
        }
      };
      st.commitSaved('pricing', st.getSettings().pricing);
    },

    async coupons() {
      const coupons = await requireApi('paymentsApi').getCoupons();
      if (!Array.isArray(coupons)) throw new Error('The server sent an unexpected coupon list.');
      R().state.getState().coupons = coupons.map(c => ({
        id: c.id,
        code: c.code,
        type: c.type || c.discount_type || 'percent',
        amount: Number(c.amount ?? c.discount ?? c.discount_value ?? 0),
        discount: Number(c.discount ?? c.amount ?? c.discount_value ?? 0),
        description: c.description || '',
        active: c.active !== undefined ? Boolean(c.active) : c.is_active !== 0
      }));
    },

    async availability() {
      const avail = await requireApi('scheduleApi').getWeeklyAvailability();
      if (!Array.isArray(avail)) throw new Error('The server sent an unexpected availability list.');
      const st = R().state;
      if (avail.length > 0) {
        st.setAvailability(avail.map(d => ({
          ...d,
          available: Boolean(d.available),
          timeframes: Array.isArray(d.timeframes) ? d.timeframes : []
        })));
      }
      st.commitSaved('availability', st.getSettings().availability);
    },

    async blockedDates() {
      const blocked = await requireApi('scheduleApi').getBlockedDates();
      if (!Array.isArray(blocked)) throw new Error('The server sent an unexpected blocked-date list.');
      R().state.setBlockedDates(blocked.map(d => {
        const dateStr = d.dateStr || d.date || '';
        let dateFormatted = d.dateFormatted || dateStr;
        if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          const [y, m, day] = dateStr.split('-').map(Number);
          dateFormatted = new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
        return { id: d.id, date: dateStr, dateStr, dateFormatted, reason: d.reason || '' };
      }));
    },

    async profile() {
      const profile = await requireApi('photographyApi').getProfile();
      if (!profile || typeof profile !== 'object') throw new Error('The server sent no profile.');
      const st = R().state;
      const cur = st.getState();
      // A missing value means an empty field (no placeholder defaults)
      cur.bio = str(profile.bio);
      cur.email = str(profile.email);
      cur.phone = str(profile.phone);
      cur.location = str(profile.location);
      cur.travel = str(profile.travel);
      // Each row gets a client-side _id (review diff key and field ids); it is never sent back
      cur.social = Array.isArray(profile.social)
        ? profile.social.map(s => ({ _id: st.newSocialId(), platform: str(s && s.platform), url: str(s && s.url) }))
        : [];
      st.commitSaved('profile', st.getSettings().profile);
    },

    async images() {
      const records = await (R().api?.photography || requireApi('photographyApi')).getGalleryImages();
      if (!Array.isArray(records)) throw new Error('The server sent an unexpected photo list.');
      const photography = R().photography;
      if (!photography?.setImagesFromRecords) throw new Error('The photo library did not load. Refresh the page.');
      photography.setImagesFromRecords(records);
    }
  };

  function ensureImageBuckets() {
    const cur = R().state.getState();
    cur.images = cur.images || {};
    ['main', 'gallery', 'about', 'hero'].forEach(k => {
      cur.images[k] = Array.isArray(cur.images[k]) ? cur.images[k] : [];
    });
  }

  /**
   * Loads one area. A settings area with unsaved edits is left alone (e.g. after a re-login)
   * unless `force` is set.
   */
  async function loadArea(area, { force = false } = {}) {
    const st = R().state;
    if (!LOADERS[area]) return;
    if (!force && SETTINGS_AREAS.includes(area) && st.getLoadStatus(area) === 'loaded' && st.isAreaDirty(area)) {
      return;
    }
    st.setLoadStatus(area, 'loading');
    renderArea(area);
    try {
      await LOADERS[area]();
      st.setLoadStatus(area, 'loaded');
    } catch (err) {
      console.warn(`[app] Could not load ${AREA_NAMES[area]}:`, err);
      st.setLoadStatus(area, 'failed', (err && err.message) || `Couldn't load ${AREA_NAMES[area]}.`);
    }
    renderArea(area);
    R().dashboard?.refreshOverview?.();
    st.recompute();
  }

  function reloadArea(area) {
    return loadArea(area);
  }

  async function loadInitialBackendData() {
    ensureImageBuckets();
    await Promise.allSettled(R().state.LOAD_AREAS.map(area => loadArea(area)));
    R().state.recompute();
  }

  const loadBackendData = loadInitialBackendData;

  function initRetry() {
    document.addEventListener('click', async e => {
      const btn = e.target.closest('[data-retry]');
      if (!btn || btn.disabled) return;
      const area = btn.dataset.retry;
      if (!LOADERS[area]) return;
      btn.disabled = true;
      try {
        await reloadArea(area);
      } finally {
        if (btn.isConnected) btn.disabled = false;
      }
    });
  }

  /* ---------- Save bar ---------- */

  function joinLabels(list) {
    if (list.length <= 1) return list.join('');
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  }

  const withPeriod = s => {
    const t = String(s || '').trim();
    return !t ? '' : (/[.!?]$/.test(t) ? t : `${t}.`);
  };

  function setSaveControlsDisabled(disabled) {
    ['#save', '#discard'].forEach(sel => { const b = $(sel); if (b) b.disabled = disabled; });
    R().reviewChanges?.setBusy?.(disabled);
    R().state.setSaving(disabled);
  }

  /** Builds the ordered save steps (pricing → availability → profile → packages) with frozen payloads. */
  function buildSaveSteps(rows) {
    const st = R().state;
    const cur = st.clone(st.getSettings());
    const savedPkgs = st.getSaved().packages || {};
    const areas = new Set(rows.map(r => r.area));
    const steps = [];

    if (areas.has('pricing')) {
      const p = cur.pricing;
      const payload = {
        baseFee: Number(p.baseFee),
        perPerson: Number(p.perPerson),
        depositPercent: Number(p.depositPercent),
        feeRules: (Array.isArray(p.feeRules) ? p.feeRules : []).map(r => {
          const rule = {
            id: String(r.id || '').trim() || `fr_${Date.now().toString(36)}`,
            name: String(r.name || '').trim(),
            trigger: String(r.trigger || 'always'),
            amountType: String(r.amountType || 'fixed_cents'),
            amount: Number(r.amount) || 0,
            active: r.active !== false
          };
          if (rule.trigger === 'days_before_max') {
            rule.daysBefore = Number(r.daysBefore);
          }
          return rule;
        }),
        policy: {
          balanceDueDaysAfterEvent: Number(p.policy?.balanceDueDaysAfterEvent ?? 4),
          rescheduleCutoffDays: Number(p.policy?.rescheduleCutoffDays ?? 3),
          requireSignature: p.policy?.requireSignature !== false
        }
      };
      steps.push({ area: 'pricing', label: 'Pricing', payload, send: x => R().paymentsApi.updatePricingSettings(x) });
    }
    if (areas.has('availability')) {
      const payload = cur.availability;
      steps.push({ area: 'availability', label: 'Availability', payload, send: x => R().scheduleApi.saveWeeklyAvailability(x) });
    }
    if (areas.has('profile')) {
      const p = cur.profile;
      const trim = v => str(v).trim();
      const payload = {
        bio: trim(p.bio),
        email: trim(p.email),
        phone: trim(p.phone),
        location: trim(p.location),
        travel: trim(p.travel),
        // Rows with both fields blank are dropped; _id stays in the committed baseline only
        social: (p.social || [])
          .filter(s => trim(s.platform) !== '' || trim(s.url) !== '')
          .map(s => ({ _id: s._id, platform: trim(s.platform), url: trim(s.url) }))
      };
      const toServer = x => Object.assign({}, x, {
        social: x.social.map(s => ({ platform: s.platform, url: s.url }))
      });
      steps.push({ area: 'profile', label: 'Profile', payload, send: x => R().photographyApi.saveProfile(toServer(x)) });
    }
    [...areas].filter(a => String(a).startsWith('package:')).forEach(area => {
      const id = area.slice('package:'.length);
      const p = cur.packages[id];
      if (!p) return;
      const wholeOrNull = v => (str(v).trim() === '' ? null : Number(v));
      const sp = savedPkgs[id] || {};
      const fullDay = p.full_day === true;
      const isInquiry = (p.booking_mode || 'direct') === 'inquiry';
      const typedLength = str(p.duration_minutes).trim() === '' ? NaN : Number(p.duration_minutes);
      const isLength = n => Number.isInteger(n) && n >= 15 && n <= 1440;
      const payload = {
        name: str(p.name).trim(),
        price: str(p.price).trim() === '' ? '' : Number(p.price),
        description: str(p.description).trim(),
        outfits: wholeOrNull(p.outfits),
        // Entire day: the length inputs are disabled and not checked, so a length that is not valid
        // keeps the saved one (the server keeps its stored length too)
        duration_minutes: fullDay && !isLength(typedLength) ? sp.duration_minutes : (Number.isNaN(typedLength) ? '' : typedLength),
        full_day: fullDay,
        best_for: str(p.best_for).trim(),
        booking_mode: isInquiry ? 'inquiry' : 'direct',
        photo_count: wholeOrNull(p.photo_count),
        image_url: str(p.image_url).trim(),
        additional_people: str(p.additional_people).trim()
      };
      const savedName = str(sp.name).trim() || payload.name || 'Untitled';
      const pkgId = Number.isNaN(Number(id)) ? id : Number(id);
      // Outfits, session length and Entire day are sent when they changed (an older stored length
      // outside 15–1440 is not re-sent, so a name or price edit still saves)
      const same = (a, b) => str(a ?? '').trim() === str(b ?? '').trim();
      const toServer = x => {
        const out = Object.assign({}, x, {
          price: x.price === '' ? null : x.price,
          duration_minutes: x.duration_minutes === '' ? null : x.duration_minutes,
          additional_people: x.additional_people === '' ? null : x.additional_people
        });
        if (same(sp.outfits, x.outfits)) delete out.outfits;
        if (same(sp.duration_minutes, x.duration_minutes)) delete out.duration_minutes;
        if ((sp.full_day === true) === x.full_day) delete out.full_day;
        return out;
      };
      steps.push({
        area, label: `Package “${savedName}”`, payload,
        send: x => R().packagesApi.updatePackage(pkgId, toServer(x))
      });
    });
    return steps;
  }

  async function runSave() {
    if (saving) return;
    const st = R().state;
    const rows = st.recompute();
    if (!rows.length || rows.some(r => r.invalid)) return;

    const steps = buildSaveSteps(rows);
    saving = true;
    setSaveControlsDisabled(true);

    const done = [];
    let failure = null;
    for (const step of steps) {
      try {
        await step.send(st.clone(step.payload));
        st.commitSaved(step.area, step.payload);
        done.push(step);
      } catch (err) {
        failure = { step, err };
        break;
      }
    }

    saving = false;
    setSaveControlsDisabled(false);
    R().reviewChanges?.close?.();
    // The saved baseline changed: drop blank social rows and re-check "can't be emptied" fields
    if (done.some(step => step.area === 'profile')) R().photography?.onProfileSaved?.();
    st.recompute();
    R().payments?.renderPricing?.();
    R().payments?.renderPackages?.();
    R().dashboard?.refreshOverview?.();
    if (!document.activeElement || document.activeElement === document.body) {
      const h1 = document.querySelector('.view.active h1');
      if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    }

    if (!failure) {
      toast('Changes saved', { type: 'success' });
      return;
    }
    if (failure.err && failure.err.status === 401) {
      // The login screen is showing (r59:unauthorized); edits stay in memory and stay unsaved.
      return;
    }
    const savedPart = done.length
      ? ` ${joinLabels(done.map(s => s.label))} ${done.length === 1 ? 'was' : 'were'} saved.`
      : '';
    st.setSaveFailed?.(true);
    const reason = withPeriod(failure.err && failure.err.message);
    toast(
      `${failure.step.label} couldn't be saved.${reason ? ' ' + reason : ''}${savedPart} Anything not saved is still in the save bar.`,
      { type: 'error' }
    );
  }

  function onSaveClick() {
    if (saving) return;
    const rows = R().state.recompute();
    if (!rows.length) {
      toast('No changes to save.', { type: 'info' });
      return;
    }
    if (!R().reviewChanges?.open) return;
    R().reviewChanges.open(rows, runSave);
  }

  /** Settings snapshot limited to areas that loaded (a failed area is never touched). */
  function loadedSavedSnapshot() {
    const st = R().state;
    const saved = st.clone(st.getSaved());
    const snap = {};
    SETTINGS_AREAS.forEach(area => {
      if (st.getLoadStatus(area) === 'loaded') snap[area] = saved[area];
    });
    return snap;
  }

  function discardChanges() {
    const st = R().state;
    st.setSettings(loadedSavedSnapshot());
    renderAll({ keepRecordForms: true }); // Discard restores settings only (rule 7); an open coupon edit stays
    st.recompute();
    toast('Changes discarded', { type: 'info' });
  }

  function initSaveBar() {
    $('#save')?.addEventListener('click', onSaveClick);
    $('#discard')?.addEventListener('click', () => {
      if (saving) return;
      if (!R().state.isDirty()) return;
      R().confirmation.confirmDiscardChanges(discardChanges);
    });

    window.addEventListener('beforeunload', e => {
      if (R().state?.isDirty?.()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  /* ---------- Login / logout ---------- */

  function setLoginStatus(message) {
    const statusEl = document.getElementById('loginStatus');
    if (!statusEl) return;
    if (message) {
      statusEl.textContent = message;
      statusEl.classList.remove('hidden');
      statusEl.removeAttribute('hidden');
    } else {
      statusEl.textContent = '';
      statusEl.classList.add('hidden');
      statusEl.setAttribute('hidden', '');
    }
  }

  // --- Google Identity Services & Auth State ---
  const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client?onload=__gsiReady&hl=en';
  let currentNonce: string | null = null;
  let cachedGoogleClientId = '';
  let gsiReady = typeof google !== 'undefined' && Boolean(google?.accounts?.id);
  let gsiInitPromise: Promise<void> | null = null;
  let cleanupGsiTriggers: (() => void) | null = null;
  const gsiReadyCallbacks: Array<() => void> = [];

  function onGsiReady() {
    gsiReady = true;
    while (gsiReadyCallbacks.length) {
      const cb = gsiReadyCallbacks.shift();
      if (cb) {
        try { cb(); } catch {}
      }
    }
  }

  // Global callback invoked by <script src="https://accounts.google.com/gsi/client?onload=__gsiReady">
  (window as any).__gsiReady = function () {
    onGsiReady();
  };

  function ensureGsiScriptLoaded(): void {
    if (typeof google !== 'undefined' && google?.accounts?.id) {
      gsiReady = true;
      return;
    }
    const existing = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', onGsiReady, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', onGsiReady, { once: true });
    document.head.appendChild(script);
  }

  function whenGsiReady(timeoutMs = 8000): Promise<void> {
    if (typeof google !== 'undefined' && google?.accounts?.id) {
      gsiReady = true;
      return Promise.resolve();
    }
    if (gsiReady) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = gsiReadyCallbacks.indexOf(onReady);
        if (idx !== -1) gsiReadyCallbacks.splice(idx, 1);
        reject(new Error('Google Sign-In script timed out'));
      }, timeoutMs);
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      gsiReadyCallbacks.push(onReady);
    });
  }

  function generateNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function getBuildTimeGoogleClientId(): string {
    const meta = document.querySelector('meta[name="google-client-id"], meta[name="google-signin-client_id"]');
    const metaVal = meta?.getAttribute('content')?.trim();
    if (metaVal && !metaVal.startsWith('%')) {
      return metaVal;
    }
    const win = window as any;
    if (win.VITE_GOOGLE_CLIENT_ID) return win.VITE_GOOGLE_CLIENT_ID;
    if (win.__GOOGLE_CLIENT_ID__) return win.__GOOGLE_CLIENT_ID__;
    if (win.APP_CONFIG?.googleClientId) return win.APP_CONFIG.googleClientId;
    try {
      const viteEnv = (new Function('try { return import.meta.env.VITE_GOOGLE_CLIENT_ID; } catch { return ""; }'))();
      if (viteEnv) return viteEnv;
    } catch {}
    return '';
  }

  async function resolveGoogleClientId(): Promise<string> {
    if (cachedGoogleClientId) return cachedGoogleClientId;
    const buildVal = getBuildTimeGoogleClientId();
    if (buildVal) {
      cachedGoogleClientId = buildVal;
      return cachedGoogleClientId;
    }
    // Fallback: network roundtrip only if build-time client ID is missing
    const config = await R().apiClient?.fetchAuthConfig?.();
    const id = config?.googleClientId;
    if (id) {
      cachedGoogleClientId = id;
      return cachedGoogleClientId;
    }
    return '';
  }

  function renderGsiButton(clientId: string) {
    if (!clientId || typeof google === 'undefined' || !google.accounts?.id) return;
    currentNonce = generateNonce();
    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      nonce: currentNonce
    });
    const targetBtn = document.getElementById('googleSignInBtn');
    if (targetBtn) {
      targetBtn.innerHTML = '';
      google.accounts.id.renderButton(targetBtn, {
        theme: 'filled_black',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        width: 280,
        logo_alignment: 'left',
        locale: 'en'
      });
    }
  }

  async function handleCredentialResponse(response: any) {
    setLoginStatus('');
    const nonceToSend = currentNonce;

    if (!response || !response.credential) {
      if (cachedGoogleClientId && typeof google !== 'undefined' && google?.accounts?.id) {
        renderGsiButton(cachedGoogleClientId);
      }
      setLoginStatus('Access denied: Account not authorized for admin access.');
      return;
    }
    try {
      const res = await R().apiClient.loginWithGoogle({
        idToken: response.credential,
        nonce: nonceToSend
      });
      if (res && res.ok) {
        if (res.token) {
          R().apiClient?.setAuthToken?.(res.token);
        }
        await initDashboard();
      } else {
        if (cachedGoogleClientId && typeof google !== 'undefined' && google?.accounts?.id) {
          renderGsiButton(cachedGoogleClientId);
        }
        setLoginStatus(res?.error || 'Access denied: Account not authorized for admin access.');
      }
    } catch (err: any) {
      if (cachedGoogleClientId && typeof google !== 'undefined' && google?.accounts?.id) {
        renderGsiButton(cachedGoogleClientId);
      }
      setLoginStatus(err?.message || 'Access denied: Account not authorized for admin access.');
    }
  }

  async function initGoogleSignIn() {
    const btn = document.getElementById('googleSignInBtn');
    if (!btn) return;
    if (gsiInitPromise) return gsiInitPromise;
    gsiInitPromise = (async () => {
      try {
        ensureGsiScriptLoaded();
        const clientId = await resolveGoogleClientId();
        if (!clientId) {
          console.error('[R59 Admin] Google client ID not found in auth config');
          setLoginStatus('Google Sign-In is not configured on the server.');
          return;
        }
        await whenGsiReady();
        renderGsiButton(clientId);
      } catch (err) {
        console.error('[R59 Admin] Failed to initialize Google Sign-In:', err);
        setLoginStatus('Google Sign-In failed to load. Check your connection or ad blocker and refresh.');
        const placeholder = document.getElementById('gsiPlaceholderBtn') as HTMLButtonElement | null;
        if (placeholder) {
          placeholder.disabled = false;
          const label = placeholder.querySelector('span');
          if (label) {
            label.textContent = 'Sign in with Google';
          } else {
            placeholder.textContent = 'Sign in with Google';
          }
        }
      } finally {
        gsiInitPromise = null;
      }
    })();
    return gsiInitPromise;
  }

  function bindDeferredGsiTriggers() {
    if (gsiReady || (typeof google !== 'undefined' && Boolean(google?.accounts?.id))) {
      void initGoogleSignIn();
      return;
    }
    cleanupGsiTriggers?.();
    const docEvents = ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'focusin'] as const;
    const placeholderBtn = document.getElementById('gsiPlaceholderBtn') as HTMLButtonElement | null;

    const removeDocListeners = () => {
      for (const evt of docEvents) {
        document.removeEventListener(evt, onDocTrigger, { capture: true });
      }
    };

    const cleanupAll = () => {
      removeDocListeners();
      placeholderBtn?.removeEventListener('click', onPlaceholderClick);
      if (cleanupGsiTriggers === cleanupAll) {
        cleanupGsiTriggers = null;
      }
    };

    const onDocTrigger = () => {
      removeDocListeners();
      ensureGsiScriptLoaded();
      void initGoogleSignIn();
    };

    const onPlaceholderClick = () => {
      cleanupAll();
      if (placeholderBtn && !gsiReady) {
        placeholderBtn.disabled = true;
        const label = placeholderBtn.querySelector('span');
        if (label) {
          label.textContent = 'Loading Google Sign-In...';
        } else {
          placeholderBtn.textContent = 'Loading Google Sign-In...';
        }
      }
      ensureGsiScriptLoaded();
      void initGoogleSignIn().then(() => {
        if (gsiReady) {
          (window as any).google?.accounts?.id?.prompt?.();
        }
      });
    };

    for (const evt of docEvents) {
      document.addEventListener(evt, onDocTrigger, { once: true, passive: true, capture: true });
    }
    placeholderBtn?.addEventListener('click', onPlaceholderClick, { once: true });
    cleanupGsiTriggers = cleanupAll;
  }

  /** Shows the login screen. In-memory edits are kept. */
  function showLogin({ message = '' } = {}) {
    R().reviewChanges?.close?.({ restoreFocus: false });
    if ($('#modal')?.classList.contains('open')) R().modal?.closeModal?.();
    if ($('#bookingModal')?.classList.contains('open')) R().schedule?.closeBookingEditor?.();
    if ($('#newBookingModal')?.classList.contains('open')) R().schedule?.closeNewBooking?.();
    if ($('#settingsModal')?.classList.contains('open')) R().account?.closeSettings?.({ restoreFocus: false });
    R().leads?.reset?.();
    const menuPanel = $('#menuPanel');
    if (menuPanel && !menuPanel.hidden) {
      menuPanel.hidden = true;
      $('#menuBtn')?.setAttribute('aria-expanded', 'false');
    }
    setWorkspaceAuthenticated(false);
    $('#login')?.classList.add('open');
    setLoginStatus(message);
    bindDeferredGsiTriggers();
  }

  /** After a confirmed session: load modules, show the app, load data. */
  async function enterApp() {
    cleanupGsiTriggers?.();
    const modulesLoaded = await ensureAdminModulesLoaded();
    if (!modulesLoaded) {
      showLogin({ message: 'Failed to load administrative modules. Please refresh and try again.' });
      return false;
    }
    setWorkspaceAuthenticated(true);
    $('#login')?.classList.remove('open');
    setLoginStatus('');
    renderAll();
    if (!hasEnteredApp) {
      R().navigation?.go?.('overview');
      hasEnteredApp = true;
    }
    loadBackendData(); // in the background; areas render as they arrive
    // Enquiries load on first open; after a re-login on that view, load it again (showLogin reset it)
    if ($('#view-leads')?.classList.contains('active')) R().leads?.load?.();
    return true;
  }

  async function initDashboard() {
    return enterApp();
  }

  async function checkSession() {
    let authenticated = false;
    try {
      authenticated = await R().apiClient.verifySession();
    } catch {
      showLogin({ message: "Can't reach the server. Check your connection and try again." });
      return;
    }
    if (authenticated) {
      await enterApp();
    } else {
      showLogin();
    }
  }

  async function doLogout() {
    const ok = await R().apiClient?.logout?.();
    if (ok === false) {
      toast("Couldn't reach the server, so you are still signed in. Try logging out again.", { type: 'error' });
      return;
    }
    // The confirm said unsaved changes will be lost: restore the saved settings.
    R().state.setSettings(loadedSavedSnapshot());
    renderAll();
    R().state.recompute();
    hasEnteredApp = false; // next sign-in starts on Overview
    showLogin();
    toast('Logged out', { type: 'info' });
  }

  function initAuth() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-logout]');
      if (!btn) return;
      e.preventDefault();
      if (saving) return;
      if (R().state?.isDirty?.()) {
        R().confirmation.confirmLogout(true, doLogout);
      } else {
        doLogout();
      }
    });

    window.addEventListener('r59:unauthorized', () => {
      const dirty = R().state?.isDirty?.();
      showLogin({
        message: dirty
          ? 'Your session has expired. Sign in again to keep working. Your unsaved changes are kept.'
          : 'Your session has expired. Sign in again to keep working.'
      });
    });
  }

  /* ---------- Boot ---------- */

  document.addEventListener('DOMContentLoaded', () => {
    R().modal?.initModalListeners?.();
    R().navigation?.initNavigation?.();

    initAuth();
    initSaveBar();
    initRetry();
    R().state?.recompute?.();

    checkSession();
  });

  window.handleCredentialResponse = handleCredentialResponse;

  window.R59 = window.R59 || {};
  window.R59.app = {
    renderAll,
    loadInitialBackendData,
    loadBackendData,
    reloadArea,
    ensureAdminModulesLoaded,
    setWorkspaceAuthenticated,
    checkSession,
    initDashboard,
    handleCredentialResponse
  };
  window.renderAll = renderAll;
})();
