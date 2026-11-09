/**
 * R59 Media Admin — Dashboard & Overview Page Controller
 *
 * Manages KPI metrics calculations, overview month navigation,
 * overview calendar display, and month-scoped booking list.
 */
const $ = (s) => document.querySelector(s);
export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];
let ovYear = new Date().getFullYear();
let ovMonth = new Date().getMonth();
export function money(n) {
    const v = Number(n || 0);
    return '$' + v.toLocaleString('en-US', {
        minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
        maximumFractionDigits: 2
    });
}
export const isCounted = (b) => Boolean(b && b.status !== 'Cancelled');
export function bookingYM(b) {
    if (!b || !b.date)
        return { y: 0, m: 0 };
    const [y, m] = b.date.split('-').map(Number);
    return { y, m: m - 1 };
}
export function moveOverviewMonth(delta) {
    const d = new Date(ovYear, ovMonth + delta, 1);
    ovYear = d.getFullYear();
    ovMonth = d.getMonth();
    renderOverview();
}
export function renderOverview() {
    if (!$('#kpiTotalRevenue'))
        return;
    const bookings = window.R59?.state?.getBookings
        ? window.R59.state.getBookings()
        : [];
    const counted = bookings.filter(isCounted);
    const monthLabel = `${MONTH_NAMES[ovMonth]} ${ovYear}`;
    // Total revenue across all valid bookings
    const total = counted.reduce((sum, b) => sum + (Number(b.price) || 0), 0);
    const deposits = counted.reduce((sum, b) => sum + (Number(b.deposit) || 0), 0);
    const kpiTotalRevenue = $('#kpiTotalRevenue');
    if (kpiTotalRevenue)
        kpiTotalRevenue.textContent = money(total);
    const kpiTotalSub = $('#kpiTotalSub');
    if (kpiTotalSub) {
        kpiTotalSub.textContent = total === 0 && deposits === 0
            ? 'No active bookings recorded'
            : `${money(deposits)} collected in down payments · ${money(total - deposits)} outstanding`;
    }
    // Monthly revenue for viewed month
    const inMonth = counted.filter(b => {
        const t = bookingYM(b);
        return t.y === ovYear && t.m === ovMonth;
    });
    const kpiMonthRevenue = $('#kpiMonthRevenue');
    if (kpiMonthRevenue) {
        kpiMonthRevenue.textContent = money(inMonth.reduce((sum, b) => sum + (Number(b.price) || 0), 0));
    }
    const kpiMonthLabel = $('#kpiMonthLabel');
    if (kpiMonthLabel)
        kpiMonthLabel.textContent = monthLabel;
    // Bookings count: YTD and monthly
    const ytd = counted.filter(b => {
        const t = bookingYM(b);
        return t.y === ovYear && t.m <= ovMonth;
    });
    const kpiBookingsYtd = $('#kpiBookingsYtd');
    if (kpiBookingsYtd)
        kpiBookingsYtd.textContent = String(ytd.length);
    const kpiYtdLabel = $('#kpiYtdLabel');
    if (kpiYtdLabel) {
        kpiYtdLabel.textContent = `Year to date (${MONTH_NAMES[0].slice(0, 3)} – ${MONTH_NAMES[ovMonth].slice(0, 3)} ${ovYear})`;
    }
    const kpiBookingsMonth = $('#kpiBookingsMonth');
    if (kpiBookingsMonth)
        kpiBookingsMonth.textContent = String(inMonth.length);
    const kpiBookingsMonthLabel = $('#kpiBookingsMonthLabel');
    if (kpiBookingsMonthLabel)
        kpiBookingsMonthLabel.textContent = monthLabel;
    // Overview Calendar
    const calTitle = $('#ovCalTitle');
    if (calTitle)
        calTitle.textContent = monthLabel;
    const calDisplay = $('#ovCalendarDisplay');
    if (calDisplay && window.R59?.schedule?.buildMonthGridHTML) {
        calDisplay.innerHTML = window.R59.schedule.buildMonthGridHTML(ovYear, ovMonth, {
            chipAction: 'edit'
        });
    }
    // Bookings manager for the active month
    const monthBookings = bookings.filter(b => {
        const t = bookingYM(b);
        return t.y === ovYear && t.m === ovMonth;
    });
    const hintEl = $('#ovBookingsHint');
    if (hintEl)
        hintEl.textContent = `Edit or remove customer bookings for ${monthLabel}`;
    const listEl = $('#ovBookingsList');
    if (listEl && window.R59?.schedule?.bookingsGroupedHTML) {
        listEl.innerHTML = window.R59.schedule.bookingsGroupedHTML(monthBookings, `No bookings in ${monthLabel}.`);
    }
    // Sync clear cancelled buttons
    if (window.R59?.schedule?.syncClearCancelledButtons) {
        window.R59.schedule.syncClearCancelledButtons();
    }
    // Live preview biography
    refreshOverview();
}
export function refreshOverview() {
    const currentState = window.R59?.state?.getState ? window.R59.state.getState() : {};
    const bioEl = $('#previewBio');
    if (bioEl) {
        bioEl.textContent = (currentState.bio && currentState.bio.trim()) || 'Your biography will appear here once entered in the Dashboard.';
    }
    const imgEl = $('#previewImg');
    if (imgEl) {
        const aboutImg = currentState.images?.about?.[0];
        const safeSrc = aboutImg && window.R59?.photography?.safeImgSrc
            ? window.R59.photography.safeImgSrc(aboutImg.src)
            : (aboutImg ? aboutImg.src : '');
        imgEl.src = safeSrc;
        imgEl.style.display = safeSrc ? '' : 'none';
    }
}
export function initDashboardListeners() {
    ['#ovPrevMonth', '#ovCalPrev'].forEach(sel => $(sel)?.addEventListener('click', () => moveOverviewMonth(-1)));
    ['#ovNextMonth', '#ovCalNext'].forEach(sel => $(sel)?.addEventListener('click', () => moveOverviewMonth(1)));
    $('#ovCalToday')?.addEventListener('click', () => {
        const now = new Date();
        ovYear = now.getFullYear();
        ovMonth = now.getMonth();
        renderOverview();
    });
    $('#ovClearCancelled')?.addEventListener('click', () => {
        const bookings = window.R59?.state?.getBookings
            ? window.R59.state.getBookings()
            : [];
        const inMonth = bookings.filter(b => b.status === 'Cancelled' && (t => t.y === ovYear && t.m === ovMonth)(bookingYM(b)));
        const ids = inMonth.map(b => b.id);
        if (ids.length && window.R59?.schedule?.promptClearCancelled) {
            window.R59.schedule.promptClearCancelled(`in ${MONTH_NAMES[ovMonth]} ${ovYear}`, ids);
        }
    });
}
export const getYear = () => ovYear;
export const getMonth = () => ovMonth;
export const dashboard = {
    renderOverview,
    refreshOverview,
    moveOverviewMonth,
    initDashboardListeners,
    getYear,
    getMonth
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.dashboard = dashboard;
    window.renderOverview = renderOverview;
    window.refreshOverview = refreshOverview;
}
export default dashboard;
