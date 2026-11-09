/**
 * R59 Media Admin — Main Application Entry Point
 *
 * Orchestrates module initialization, global save/discard bar actions,
 * user authentication flow, and initial render lifecycle.
 */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
export const GATED_ADMIN_SCRIPTS = [
    'assets/js/api/bookingsApi.js',
    'assets/js/api/packagesApi.js',
    'assets/js/api/paymentsApi.js',
    'assets/js/api/photographyApi.js',
    'assets/js/api/scheduleApi.js',
    'assets/js/pages/dashboard.js',
    'assets/js/pages/schedule.js',
    'assets/js/pages/payments.js',
    'assets/js/utils/webpConverter.js',
    'assets/js/pages/photography.js'
];
let adminModulesLoaded = false;
let adminModulesPromise = null;
export function setWorkspaceAuthenticated(isAuth) {
    document.body.classList.toggle('authenticated', Boolean(isAuth));
    const appEl = document.querySelector('.app');
    if (appEl) {
        if (isAuth) {
            appEl.removeAttribute('inert');
            appEl.removeAttribute('aria-hidden');
        }
        else {
            appEl.setAttribute('inert', '');
            appEl.setAttribute('aria-hidden', 'true');
        }
    }
}
export function loadScriptSequential(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[data-gated-src="${src}"]`)) {
            resolve();
            return;
        }
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.setAttribute('data-gated-src', src);
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.body.appendChild(s);
    });
}
export async function ensureAdminModulesLoaded() {
    if (adminModulesLoaded)
        return true;
    if (adminModulesPromise)
        return adminModulesPromise;
    adminModulesPromise = (async () => {
        try {
            for (const src of GATED_ADMIN_SCRIPTS) {
                await loadScriptSequential(src);
            }
            // Hook up pages namespace & event aliases for compatibility
            const r59 = window.R59 || {};
            r59.pages = r59.pages || {};
            if (r59.schedule) {
                r59.pages.schedule = r59.schedule;
                r59.pages.schedule.initScheduleEvents = r59.schedule.initScheduleListeners;
            }
            if (r59.payments) {
                r59.pages.payments = r59.payments;
                r59.pages.payments.initPaymentEvents = r59.payments.initPaymentsListeners;
            }
            if (r59.photography) {
                r59.pages.photography = r59.photography;
                r59.pages.photography.initPhotographyEvents = r59.photography.initPhotographyListeners;
            }
            if (r59.dashboard) {
                r59.pages.dashboard = r59.dashboard;
                r59.pages.dashboard.initDashboardEvents = r59.dashboard.initDashboardListeners;
            }
            r59.pages?.schedule?.initScheduleEvents?.();
            r59.pages?.payments?.initPaymentEvents?.();
            r59.pages?.photography?.initPhotographyEvents?.();
            r59.pages?.dashboard?.initDashboardEvents?.();
            adminModulesLoaded = true;
            return true;
        }
        catch (err) {
            console.error('[R59 Admin] Failed to load gated admin modules:', err);
            adminModulesPromise = null;
            return false;
        }
    })();
    return adminModulesPromise;
}
export function renderAll() {
    const currentState = window.R59.state ? window.R59.state.getState() : {};
    // Bind basic text fields
    $$('[data-bind]').forEach(el => {
        const bindKey = el.dataset.bind;
        if (bindKey && currentState[bindKey] !== undefined) {
            el.value = currentState[bindKey];
        }
    });
    // Render each domain
    if (window.R59.photography) {
        window.R59.photography.updateBioCount?.();
        window.R59.photography.renderSocial?.();
        window.R59.photography.renderImages?.();
    }
    if (window.R59.payments) {
        window.R59.payments.renderPricing?.();
        window.R59.payments.renderPackages?.();
        window.R59.payments.resetCouponForm?.();
        window.R59.payments.renderCoupons?.();
    }
    if (window.R59.schedule) {
        window.R59.schedule.renderCalendar?.();
        window.R59.schedule.renderAvailability?.();
        window.R59.schedule.renderBookings?.();
        window.R59.schedule.renderBlockedDates?.();
    }
    const pages = window.R59?.pages;
    if (pages?.dashboard?.renderOverview) {
        pages.dashboard.renderOverview();
    }
    else if (window.R59.dashboard?.renderOverview) {
        window.R59.dashboard.renderOverview();
    }
}
export function initSaveBar() {
    $('#save')?.addEventListener('click', () => {
        if (window.R59.payments?.pricingIsInvalid?.()) {
            window.toast?.('Please enter valid amounts (prices 0 or more, down payment 0–100%) before saving');
            return;
        }
        window.R59.confirmation?.confirmSaveChanges(saveChanges);
    });
    async function saveChanges() {
        const currentState = window.R59.state.getState();
        window.R59.state.setSaved(window.R59.state.clone(currentState));
        window.R59.state.setDirty(false);
        window.R59.state.setLastSaved(new Date());
        // Re-lock pricing fields
        window.R59.payments?.renderPricing?.();
        window.R59.state.syncStatus();
        if (window.R59.dashboard?.refreshOverview)
            window.R59.dashboard.refreshOverview();
        // Persist changes to the backend, and only report success once every request has gone through
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
        }
        catch (err) {
            console.warn('[app] Could not persist changes to backend:', err);
            window.R59.state.setDirty(true);
            window.R59.state.syncStatus();
            window.toast?.('Some changes could not be saved. Check your connection and save again.', 5000);
            return;
        }
        window.toast?.('Changes saved');
    }
    $('#discard')?.addEventListener('click', () => {
        window.R59.confirmation?.confirmDiscardChanges(discardChanges);
    });
    function discardChanges() {
        const savedState = window.R59.state.getSaved();
        window.R59.state.setState(window.R59.state.clone(savedState));
        window.R59.state.setDirty(false);
        window.R59.state.syncStatus();
        renderAll();
        window.toast?.('Changes discarded');
    }
    window.addEventListener('beforeunload', e => {
        if (window.R59.state?.isDirty && window.R59.state.isDirty()) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}
export function initAuth() {
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
        const lp = $('#lp');
        if (lp)
            lp.value = '';
        if ($('#modal')?.classList.contains('open')) {
            window.R59.modal?.closeModal();
        }
    }
    function logout() {
        const drawer = $('#drawer');
        if (drawer && drawer.classList.contains('open')) {
            window.R59.navigation?.setDrawer?.(false);
        }
        const doLogout = () => {
            window.R59.apiClient?.logout?.();
            window.R59.apiClient?.clearAuthToken?.();
            setWorkspaceAuthenticated(false);
            $('#login')?.classList.add('open');
            resetLoginForm();
            window.R59.state?.setDirty?.(false);
            window.R59.state?.syncStatus?.();
            window.toast?.('Logged out');
            setTimeout(() => {
                const u = $('#lu');
                if (u && !u.value)
                    u.focus();
                else
                    $('#lp')?.focus();
            }, 50);
        };
        if (window.R59.state?.isDirty && window.R59.state.isDirty()) {
            window.R59.confirmation?.confirmLogout(true, doLogout);
        }
        else {
            doLogout();
        }
    }
    window.addEventListener('r59:unauthorized', (e) => {
        const customEvent = e;
        window.R59.apiClient?.clearAuthToken?.();
        setWorkspaceAuthenticated(false);
        $('#login')?.classList.add('open');
        resetLoginForm();
        const errEl = $('#loginError');
        if (errEl) {
            errEl.textContent = (customEvent.detail && customEvent.detail.message) || 'Session expired. Please sign in again.';
            errEl.style.display = 'block';
        }
        setTimeout(() => $('#lp')?.focus(), 50);
    });
    $('#logoutTop')?.addEventListener('click', logout);
    $('#logoutDrawer')?.addEventListener('click', logout);
    $('#loginForm')?.addEventListener('submit', async (e) => {
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
            await window.R59.apiClient.login(email, password);
        }
        catch (err) {
            if (errEl) {
                errEl.textContent = err?.message || 'Invalid email address or password.';
                errEl.style.display = 'block';
            }
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign in';
            }
            $('#lp')?.focus();
            return;
        }
        const modulesLoaded = await ensureAdminModulesLoaded();
        if (!modulesLoaded) {
            if (errEl) {
                errEl.textContent = 'Failed to load administrative modules. Please refresh and try again.';
                errEl.style.display = 'block';
            }
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign in';
            }
            return;
        }
        // Login succeeded: transition UI immediately
        setWorkspaceAuthenticated(true);
        $('#login')?.classList.remove('open');
        resetLoginForm();
        renderAll();
        const pages = window.R59?.pages;
        if (pages?.dashboard?.renderOverview) {
            pages.dashboard.renderOverview();
        }
        window.R59.navigation?.go?.('overview');
        window.toast?.('Signed in');
        // Fetch dashboard data concurrently in background without blocking UI
        loadBackendData();
    });
}
/**
 * Concurrently load backend records if the API is available.
 * If backend is not running or endpoints are not yet mounted,
 * frontend remains functional with empty state.
 */
export async function loadInitialBackendData() {
    try {
        const initCurrentState = window.R59.state.getState();
        initCurrentState.images = initCurrentState.images || {};
        initCurrentState.images.main = Array.isArray(initCurrentState.images.main) ? initCurrentState.images.main : [];
        initCurrentState.images.gallery = Array.isArray(initCurrentState.images.gallery) ? initCurrentState.images.gallery : [];
        initCurrentState.images.about = Array.isArray(initCurrentState.images.about) ? initCurrentState.images.about : [];
        initCurrentState.images.hero = Array.isArray(initCurrentState.images.hero) ? initCurrentState.images.hero : [];
        await Promise.allSettled([
            // 1. Packages / Services
            (async () => {
                if (!window.R59.packagesApi)
                    return;
                const services = await window.R59.packagesApi.getPackages().catch(() => []);
                if (Array.isArray(services) && services.length > 0) {
                    const currentState = window.R59.state.getState();
                    currentState.packages = services.map((s) => ({
                        id: s.id,
                        name: s.name || s.title || 'Package',
                        description: s.description || '',
                        price: (s.price || 0) / 100, // convert cents to dollars
                        duration_minutes: s.duration_minutes || 60,
                        category: s.category || 'General',
                        active: s.is_active !== 0
                    }));
                    window.R59.payments?.renderPackages?.();
                }
            })(),
            // 2. Bookings
            (async () => {
                if (!window.R59.bookingsApi)
                    return;
                const res = await window.R59.bookingsApi.getBookings().catch(() => null);
                if (res && Array.isArray(res.bookings) && res.bookings.length > 0) {
                    const bookings = res.bookings.map((b) => {
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
                    window.R59.schedule?.renderBookings?.();
                    window.R59.schedule?.renderCalendar?.();
                    window.R59.dashboard?.renderOverview?.();
                }
            })(),
            // 3. Pricing Configuration
            (async () => {
                if (!window.R59.paymentsApi)
                    return;
                const pricing = await window.R59.paymentsApi.getPricingSettings().catch(() => null);
                if (pricing && typeof pricing === 'object') {
                    const cleanPricing = pricing.data || pricing;
                    const currentState = window.R59.state.getState();
                    currentState.pricing = {
                        baseFee: Number(cleanPricing.baseFee ?? currentState.pricing.baseFee ?? 0),
                        perPerson: Number(cleanPricing.perPerson ?? currentState.pricing.perPerson ?? 0),
                        depositPercent: Number(cleanPricing.depositPercent ?? currentState.pricing.depositPercent ?? 50)
                    };
                    window.R59.payments?.renderPricing?.();
                }
            })(),
            // 4. Coupons
            (async () => {
                if (!window.R59.paymentsApi)
                    return;
                const coupons = await window.R59.paymentsApi.getCoupons().catch(() => []);
                if (Array.isArray(coupons)) {
                    const currentState = window.R59.state.getState();
                    currentState.coupons = coupons.map((c) => ({
                        id: c.id,
                        code: c.code,
                        type: c.type || c.discount_type || 'percent',
                        amount: Number(c.amount ?? c.discount ?? c.discount_value ?? 0),
                        discount: Number(c.discount ?? c.amount ?? c.discount_value ?? 0),
                        description: c.description || '',
                        active: c.active !== undefined ? Boolean(c.active) : c.is_active !== 0
                    }));
                    window.R59.payments?.renderCoupons?.();
                }
            })(),
            // 5. Weekly Availability
            (async () => {
                if (!window.R59.scheduleApi)
                    return;
                const avail = await window.R59.scheduleApi.getWeeklyAvailability().catch(() => null);
                if (Array.isArray(avail) && avail.length > 0) {
                    window.R59.state.setAvailability(avail);
                    window.R59.schedule?.renderAvailability?.();
                }
            })(),
            // 6. Blocked Dates
            (async () => {
                if (!window.R59.scheduleApi)
                    return;
                const blocked = await window.R59.scheduleApi.getBlockedDates().catch(() => []);
                if (Array.isArray(blocked)) {
                    const normalizedBlocked = blocked.map((d) => {
                        const dateStr = d.dateStr || d.date || '';
                        let dateFormatted = d.dateFormatted || dateStr;
                        if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                            const [y, m, day] = dateStr.split('-').map(Number);
                            dateFormatted = new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        }
                        return { id: d.id, date: dateStr, dateStr, dateFormatted, reason: d.reason || '' };
                    });
                    window.R59.state.setBlockedDates(normalizedBlocked);
                    window.R59.schedule?.renderBlockedDates?.();
                    window.R59.schedule?.renderCalendar?.();
                }
            })(),
            // 7. Profile Information
            (async () => {
                if (!window.R59.photographyApi)
                    return;
                const profile = await window.R59.photographyApi.getProfile().catch(() => null);
                if (profile && typeof profile === 'object') {
                    const currentState = window.R59.state.getState();
                    if (profile.bio !== undefined)
                        currentState.bio = profile.bio;
                    if (profile.email !== undefined)
                        currentState.email = profile.email;
                    if (profile.phone !== undefined)
                        currentState.phone = profile.phone;
                    if (profile.location !== undefined)
                        currentState.location = profile.location;
                    if (profile.travel !== undefined)
                        currentState.travel = profile.travel;
                    if (Array.isArray(profile.social))
                        currentState.social = profile.social;
                    renderAll();
                }
            })(),
            // 8. Portfolio images, sorted into Most Recent / Gallery / Hero / About tabs by site section
            (async () => {
                const SECTION_TO_TAB = { recent: 'main', gallery: 'gallery', about: 'about', hero: 'hero' };
                const currentState = window.R59.state.getState();
                currentState.images = currentState.images || {};
                currentState.images.main = Array.isArray(currentState.images.main) ? currentState.images.main : [];
                currentState.images.gallery = Array.isArray(currentState.images.gallery) ? currentState.images.gallery : [];
                currentState.images.about = Array.isArray(currentState.images.about) ? currentState.images.about : [];
                currentState.images.hero = Array.isArray(currentState.images.hero) ? currentState.images.hero : [];
                if (!window.R59.api?.photography)
                    return;
                const records = await window.R59.api.photography.getGalleryImages().catch((err) => {
                    console.warn('[app] Could not load portfolio images:', err);
                    return null;
                });
                if (Array.isArray(records)) {
                    if (window.R59.photography?.setImagesFromRecords) {
                        window.R59.photography.setImagesFromRecords(records);
                    }
                    else {
                        const grouped = { main: [], gallery: [], about: [], hero: [] };
                        records.forEach((p) => {
                            let tab;
                            const secLower = (p.section || '').toLowerCase();
                            const catLower = (p.category || '').toLowerCase();
                            if (secLower === 'hero' || ((!p.section || secLower === 'gallery') && (catLower === 'hero' || p.is_featured === 1))) {
                                tab = 'hero';
                            }
                            else {
                                tab = SECTION_TO_TAB[secLower || 'gallery'] || 'gallery';
                            }
                            const order = p.order !== undefined && p.order !== null ? Number(p.order) : (p.display_order ?? 0);
                            grouped[tab].push({
                                ...p,
                                section: tab === 'hero' ? 'hero' : (p.section || (tab === 'main' ? 'recent' : tab)),
                                order,
                                display_order: order
                            });
                        });
                        Object.values(grouped).forEach(list => list.sort((a, b) => (a.order ?? a.display_order ?? 0) - (b.order ?? b.display_order ?? 0) || a.id - b.id));
                        currentState.images = grouped;
                    }
                }
            })()
        ]);
    }
    finally {
        const currentState = window.R59.state?.getState?.();
        if (currentState) {
            window.R59.state?.setSaved?.(JSON.parse(JSON.stringify(currentState)));
            window.R59.state?.setDirty?.(false);
            window.R59.state?.syncStatus?.();
        }
    }
}
export const loadBackendData = loadInitialBackendData;
export const initLogin = initAuth;
export const initGlobalActions = initSaveBar;
// App initialization
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', async () => {
        // 1. Initialize static shell component listeners only
        window.R59.modal?.initModalListeners?.();
        window.R59.navigation?.initNavigation?.();
        initLogin();
        initGlobalActions();
        const hasLocalToken = Boolean(window.R59.apiClient?.getAuthToken?.());
        if (hasLocalToken) {
            const valid = await window.R59.apiClient.verifySession();
            if (valid) {
                const modulesLoaded = await ensureAdminModulesLoaded();
                if (modulesLoaded) {
                    setWorkspaceAuthenticated(true);
                    $('#login')?.classList.remove('open');
                    renderAll();
                    const pages = window.R59?.pages;
                    if (pages?.dashboard?.renderOverview) {
                        pages.dashboard.renderOverview();
                    }
                    window.R59.navigation?.go?.('overview');
                    loadBackendData();
                    return;
                }
            }
            window.R59.apiClient?.logout?.();
        }
        // Not authenticated (new tab, invalid session, or modules failed)
        window.R59.apiClient?.clearAuthToken?.();
        setWorkspaceAuthenticated(false);
        const loginEl = $('#login');
        if (loginEl)
            loginEl.classList.add('open');
        const luEl = $('#lu');
        const lpEl = $('#lp');
        if (luEl) {
            luEl.value = '';
            luEl.focus();
        }
        if (lpEl)
            lpEl.value = '';
    });
}
export const app = {
    renderAll,
    loadInitialBackendData,
    loadBackendData,
    ensureAdminModulesLoaded,
    setWorkspaceAuthenticated
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.app = app;
    window.renderAll = renderAll;
}
export default app;
