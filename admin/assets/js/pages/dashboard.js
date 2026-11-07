/**
 * R59 Media Admin — Overview Page Module
 *
 * KPI figures, overview month navigation, the month calendar, the month-scoped bookings list
 * and the read-only "Live preview · About me" frame (About photo + biography from state).
 * refreshOverview() runs on every state recompute, so it only touches the About preview and
 * skips DOM work when nothing it shows has changed.
 */

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DEFAULT_ALT = 'Portrait of the photographer, as shown in the About section';

  let ovYear = new Date().getFullYear();
  let ovMonth = new Date().getMonth();
  let previewKey = null;

  const st = () => window.R59.state;
  const sched = () => window.R59.schedule || {};
  const statusOf = area => (st().getLoadStatus ? st().getLoadStatus(area) : 'loaded');

  function money(n) {
    const v = Number(n || 0);
    return '$' + v.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  const isCancelled = b => String(b && b.status || '').toLowerCase() === 'cancelled';
  const isCounted = b => b && !isCancelled(b);

  function bookingYM(b) {
    if (!b || !b.date) return { y: 0, m: 0 };
    const [y, m] = b.date.split('-').map(Number);
    return { y, m: m - 1 };
  }

  const inViewedMonth = b => {
    const t = bookingYM(b);
    return t.y === ovYear && t.m === ovMonth;
  };

  function setText(sel, text) {
    const el = $(sel);
    if (el) el.textContent = text;
  }

  function moveOverviewMonth(delta) {
    const d = new Date(ovYear, ovMonth + delta, 1);
    ovYear = d.getFullYear();
    ovMonth = d.getMonth();
    renderOverview();
  }

  function renderKpis(status, bookings, monthLabel) {
    const yearLabel = `Year to date (${MONTH_NAMES[0].slice(0, 3)} – ${MONTH_NAMES[ovMonth].slice(0, 3)} ${ovYear})`;
    setText('#kpiMonthLabel', monthLabel);
    setText('#kpiBookingsMonthLabel', monthLabel);
    setText('#kpiYtdLabel', yearLabel);

    if (status !== 'loaded') {
      ['#kpiTotalRevenue', '#kpiMonthRevenue', '#kpiBookingsMonth', '#kpiBookingsYtd', '#kpiBalanceDue'].forEach(sel => setText(sel, '—'));
      const note = status === 'failed' ? "Couldn't load bookings." : 'Loading bookings…';
      setText('#kpiTotalSub', note);
      setText('#kpiBalanceSub', note);
      return;
    }

    // Money is worked out per booking by state.balanceOf (integer cents), every render: payments
    // recorded elsewhere call renderOverview(), so nothing here is cached.
    const counted = bookings.filter(isCounted);
    const balances = counted.map(b => st().balanceOf(b));
    const total = balances.reduce((sum, m) => sum + m.totalCents, 0) / 100; // summed in cents
    const collectedCents = balances.reduce((sum, m) => sum + m.paidCents, 0);
    setText('#kpiTotalRevenue', money(total));
    setText('#kpiTotalSub', counted.length
      ? `Collected ${st().formatCents(collectedCents)}`
      : 'No active bookings recorded');

    const owing = balances.filter(m => m.balanceCents > 0);
    setText('#kpiBalanceDue', st().formatCents(owing.reduce((sum, m) => sum + m.balanceCents, 0)));
    setText('#kpiBalanceSub', owing.length
      ? `${owing.length} booking${owing.length === 1 ? '' : 's'} with a balance`
      : 'Nothing outstanding');

    const inMonth = counted.filter(inViewedMonth);
    setText('#kpiMonthRevenue', money(inMonth.reduce((sum, b) => sum + st().balanceOf(b).totalCents, 0) / 100));
    setText('#kpiBookingsMonth', String(inMonth.length));

    const ytd = counted.filter(b => {
      const t = bookingYM(b);
      return t.y === ovYear && t.m <= ovMonth;
    });
    setText('#kpiBookingsYtd', String(ytd.length));
  }

  function renderOverview() {
    if (!$('#kpiTotalRevenue')) return;

    const status = statusOf('bookings');
    const bookings = status === 'loaded' ? st().getBookings() : [];
    const monthLabel = `${MONTH_NAMES[ovMonth]} ${ovYear}`;

    renderKpis(status, bookings, monthLabel);

    // Calendar
    setText('#ovCalTitle', monthLabel);
    const calDisplay = $('#ovCalendarDisplay');
    if (calDisplay && sched().buildMonthGridHTML) {
      calDisplay.innerHTML = sched().buildMonthGridHTML(ovYear, ovMonth, { mode: 'overview' });
    }
    const sessions = bookings.filter(b => isCounted(b) && inViewedMonth(b)).length;
    setText('#ovCalFootCount', status !== 'loaded'
      ? (status === 'failed' ? 'Bookings could not be loaded.' : 'Loading bookings…')
      : sessions
        ? `${sessions} session${sessions > 1 ? 's' : ''} booked in ${monthLabel}.`
        : `No sessions booked in ${monthLabel}.`);

    // Bookings manager for the viewed month
    setText('#ovBookingsHint', `Edit or remove customer bookings for ${monthLabel}`);
    const listEl = $('#ovBookingsList');
    if (listEl) {
      if (status === 'failed' && sched().loadErrorHTML) {
        listEl.innerHTML = sched().loadErrorHTML('bookings');
      } else if (status !== 'loaded' && sched().loadingHTML) {
        listEl.innerHTML = sched().loadingHTML(5);
      } else if (sched().bookingsGroupedHTML) {
        listEl.innerHTML = sched().bookingsGroupedHTML(bookings.filter(inViewedMonth), {
          title: 'No bookings scheduled',
          small: monthLabel
        });
      }
    }

    sched().syncClearCancelledButtons?.();
    refreshOverview();
  }

  /* ---------- Live preview · About me (read-only) ---------- */
  function safeSrc(url) {
    if (window.R59.photography?.safeImgSrc) return window.R59.photography.safeImgSrc(url);
    const s = String(url || '').trim();
    return /^(https?:|blob:|data:image\/|\/(?!\/))/i.test(s) ? s : '';
  }

  /** A photo the site shows: hidden rows carry active === false or is_active 0/false. */
  const isActivePhoto = p => p && p.active !== false && p.is_active !== 0 && p.is_active !== false;

  /** The photo the site shows: first ACTIVE About record by display_order ASC, then id ASC. */
  function aboutPhoto(images) {
    const list = (Array.isArray(images && images.about) ? images.about : []).filter(isActivePhoto);
    if (!list.length) return null;
    const order = p => Number(p.display_order ?? p.order ?? 0) || 0;
    return [...list].sort((a, b) => order(a) - order(b) || (Number(a.id) || 0) - (Number(b.id) || 0))[0];
  }

  function show(sel, on) {
    const el = $(sel);
    if (el) el.hidden = !on;
  }

  function refreshOverview() {
    const bioEl = $('#previewBio');
    const imgEl = $('#previewImg');
    if (!bioEl && !imgEl) return;

    const cur = st().getState();
    const profileStatus = statusOf('profile');
    const imagesStatus = statusOf('images');
    const bio = String(cur.bio || '').trim();
    const photo = imagesStatus === 'loaded' ? aboutPhoto(cur.images) : null;
    const src = photo ? safeSrc(photo.src || photo.url) : '';
    const alt = (photo && (photo.alt || '').trim()) || DEFAULT_ALT;

    const key = [profileStatus, bio, imagesStatus, src, alt].join('\u0001');
    if (key === previewKey) return;
    previewKey = key;

    // Biography
    const bioErr = $('#ovBioError');
    if (profileStatus === 'failed') {
      if (bioErr && sched().loadErrorHTML) bioErr.innerHTML = sched().loadErrorHTML('profile', 'the biography');
      show('#previewBio', false);
      show('#ovBioEmpty', false);
    } else {
      if (bioErr) bioErr.innerHTML = '';
      const hasBio = profileStatus === 'loaded' && bio.length > 0;
      if (bioEl) bioEl.textContent = hasBio ? bio : '';
      show('#previewBio', hasBio);
      show('#ovBioEmpty', !hasBio);
      // While loading, show only the skeleton (the note would claim the bio is empty)
      const note = $('#ovBioEmpty .skel-note');
      if (note) note.hidden = profileStatus !== 'loaded';
    }

    // About photo
    const photoErr = $('#ovAboutError');
    if (imagesStatus === 'failed') {
      if (photoErr && sched().loadErrorHTML) photoErr.innerHTML = sched().loadErrorHTML('images', 'the About photo');
      show('#ovAboutPrint', false);
      show('#ovAboutEmpty', false);
    } else if (imagesStatus !== 'loaded') {
      if (photoErr) photoErr.innerHTML = '<div class="print print--loading" aria-hidden="true"></div><p class="sr-only">Loading…</p>';
      show('#ovAboutPrint', false);
      show('#ovAboutEmpty', false);
    } else {
      if (photoErr) photoErr.innerHTML = '';
      if (src && imgEl) {
        if (imgEl.getAttribute('src') !== src) imgEl.src = src;
        imgEl.alt = alt;
      } else if (imgEl) {
        imgEl.removeAttribute('src');
      }
      show('#ovAboutPrint', Boolean(src));
      show('#ovAboutEmpty', !src);
    }
  }

  function initDashboardListeners() {
    ['#ovPrevMonth', '#ovCalPrev'].forEach(sel => $(sel)?.addEventListener('click', () => moveOverviewMonth(-1)));
    ['#ovNextMonth', '#ovCalNext'].forEach(sel => $(sel)?.addEventListener('click', () => moveOverviewMonth(1)));
    $('#ovCalToday')?.addEventListener('click', () => {
      const now = new Date();
      ovYear = now.getFullYear();
      ovMonth = now.getMonth();
      renderOverview();
    });

    $('#ovClearCancelled')?.addEventListener('click', e => {
      if (statusOf('bookings') !== 'loaded') return;
      const ids = st().getBookings().filter(b => isCancelled(b) && inViewedMonth(b)).map(b => b.id);
      if (ids.length && sched().promptClearCancelled) {
        sched().promptClearCancelled(`in ${MONTH_NAMES[ovMonth]} ${ovYear}`, ids, e.currentTarget);
      }
    });
  }

  window.R59 = window.R59 || {};
  window.R59.dashboard = {
    renderOverview,
    refreshOverview,
    moveOverviewMonth,
    initDashboardListeners,
    getYear: () => ovYear,
    getMonth: () => ovMonth
  };
  window.renderOverview = renderOverview;
  window.refreshOverview = refreshOverview;
})();
