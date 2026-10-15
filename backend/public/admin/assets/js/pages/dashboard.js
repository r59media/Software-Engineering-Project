/**
 * R59 Media Admin — Dashboard & Overview Page Module
 * 
 * Manages KPI metrics calculations, overview month navigation,
 * overview calendar display, and month-scoped booking list.
 */

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  let ovYear = new Date().getFullYear();
  let ovMonth = new Date().getMonth();

  function money(n) {
    const v = Number(n || 0);
    return '$' + v.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  const isCounted = b => b && b.status !== 'Cancelled';

  function bookingYM(b) {
    if (!b || !b.date) return { y: 0, m: 0 };
    const [y, m] = b.date.split('-').map(Number);
    return { y, m: m - 1 };
  }

  function moveOverviewMonth(delta) {
    const d = new Date(ovYear, ovMonth + delta, 1);
    ovYear = d.getFullYear();
    ovMonth = d.getMonth();
    renderOverview();
  }

  function renderOverview() {
    if (!$('#kpiTotalRevenue')) return;

    const bookings = window.R59.state.getBookings();
    const counted = bookings.filter(isCounted);
    const monthLabel = `${MONTH_NAMES[ovMonth]} ${ovYear}`;

    // Total revenue across all valid bookings
    const total = counted.reduce((sum, b) => sum + (Number(b.price) || 0), 0);
    const deposits = counted.reduce((sum, b) => sum + (Number(b.deposit) || 0), 0);
    
    $('#kpiTotalRevenue').textContent = money(total);
    $('#kpiTotalSub').textContent = total === 0 && deposits === 0
      ? 'No active bookings recorded'
      : `${money(deposits)} collected in down payments · ${money(total - deposits)} outstanding`;

    // Monthly revenue for viewed month
    const inMonth = counted.filter(b => {
      const t = bookingYM(b);
      return t.y === ovYear && t.m === ovMonth;
    });
    $('#kpiMonthRevenue').textContent = money(inMonth.reduce((sum, b) => sum + (Number(b.price) || 0), 0));
    $('#kpiMonthLabel').textContent = monthLabel;

    // Bookings count: YTD and monthly
    const ytd = counted.filter(b => {
      const t = bookingYM(b);
      return t.y === ovYear && t.m <= ovMonth;
    });
    $('#kpiBookingsYtd').textContent = ytd.length;
    $('#kpiYtdLabel').textContent = `Year to date (${MONTH_NAMES[0].slice(0, 3)} – ${MONTH_NAMES[ovMonth].slice(0, 3)} ${ovYear})`;
    $('#kpiBookingsMonth').textContent = inMonth.length;
    $('#kpiBookingsMonthLabel').textContent = monthLabel;

    // Overview Calendar
    const calTitle = $('#ovCalTitle');
    if (calTitle) calTitle.textContent = monthLabel;

    const calDisplay = $('#ovCalendarDisplay');
    if (calDisplay && window.R59.schedule?.buildMonthGridHTML) {
      calDisplay.innerHTML = window.R59.schedule.buildMonthGridHTML(ovYear, ovMonth, {
        chipClick: b => `window.R59.schedule.openBookingEditor(${Number(b.id)})`
      });
    }

    // Bookings manager for the active month
    const monthBookings = bookings.filter(b => {
      const t = bookingYM(b);
      return t.y === ovYear && t.m === ovMonth;
    });

    const hintEl = $('#ovBookingsHint');
    if (hintEl) hintEl.textContent = `Edit or remove customer bookings for ${monthLabel}`;

    const listEl = $('#ovBookingsList');
    if (listEl && window.R59.schedule?.bookingsGroupedHTML) {
      listEl.innerHTML = window.R59.schedule.bookingsGroupedHTML(monthBookings, `No bookings in ${monthLabel}.`);
    }

    // Sync clear cancelled buttons
    if (window.R59.schedule?.syncClearCancelledButtons) {
      window.R59.schedule.syncClearCancelledButtons();
    }

    // Live preview biography
    refreshOverview();
  }

  function refreshOverview() {
    const currentState = window.R59.state.getState();
    const bioEl = $('#previewBio');
    if (bioEl) {
      bioEl.textContent = (currentState.bio && currentState.bio.trim()) || 'Your biography will appear here once entered in the Dashboard.';
    }
    const imgEl = $('#previewImg');
    if (imgEl) {
      const aboutImg = currentState.images?.about?.[0];
      imgEl.src = aboutImg ? aboutImg.src : '';
      imgEl.style.display = aboutImg ? '' : 'none';
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

    $('#ovClearCancelled')?.addEventListener('click', () => {
      const bookings = window.R59.state.getBookings();
      const inMonth = bookings.filter(b => b.status === 'Cancelled' && (t => t.y === ovYear && t.m === ovMonth)(bookingYM(b)));
      const ids = inMonth.map(b => b.id);
      if (ids.length && window.R59.schedule?.promptClearCancelled) {
        window.R59.schedule.promptClearCancelled(`in ${MONTH_NAMES[ovMonth]} ${ovYear}`, ids);
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
