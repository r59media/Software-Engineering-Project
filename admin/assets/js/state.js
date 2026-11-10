// @ts-nocheck
/**
 * R59 Media Admin — Application State
 *
 * Two kinds of data live here:
 *  - Settings (profile, pricing, weekly availability, package name/price/description) are edited
 *    locally and published through the save bar. They have a `current` value (the live `state`
 *    object plus `weeklyAvailability`) and a `saved` baseline in the snapshot shape below.
 *  - Records (coupons, bookings, blocked dates, photos, package add/delete/active) are written to the
 *    server immediately by the pages. They live in `current` only and are never part of `saved`.
 *
 * Snapshot shape (getSettings / getSaved / setSettings):
 *   { profile: { bio, email, phone, location, travel, social: [{ _id, platform, url }] },
 *     pricing: { baseFee, perPerson, depositPercent },
 *     availability: [{ day, available, timeframes: [{ id, start, end, label, repeat }] }],
 *     packages: { [serverId]: { name, price, description, outfits, duration_minutes, full_day } } }
 *
 * Social links are free-form rows (any platform). `_id` is a client-side row id from
 * newSocialId(): the review diff keys rows by it and field ids use it. It is never sent to the
 * server (app.js strips it from the save payload).
 */
(function () {
    'use strict';
    // The platforms the public footer has an icon for (SiteFooter.tsx). Any other platform is
    // stored and saved, and Site copy notes that the footer does not show an icon for it yet.
    const PLATFORMS = ['Instagram', 'Threads', 'X', 'Facebook', 'Pinterest'];
    const CATEGORIES = ['Portrait', 'Lifestyle', 'Events', 'Extras']; // matches the public portfolio filters
    const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const SETTINGS_AREAS = ['profile', 'pricing', 'availability', 'packages'];
    const LOAD_AREAS = ['profile', 'pricing', 'availability', 'packages', 'coupons', 'bookings', 'blockedDates', 'images'];
    const PROFILE_KEYS = ['bio', 'email', 'phone', 'location', 'travel'];
    let socialSeq = 0;
    const newSocialId = () => `s${++socialSeq}`;
    const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
    // Clean initial state (no fictional data)
    const initialState = {
        bio: '',
        email: '',
        phone: '',
        location: '',
        travel: '',
        social: [],
        images: { main: [], gallery: [], hero: [], about: [] },
        pricing: { baseFee: 0, perPerson: 0, depositPercent: 60 },
        packages: [],
        coupons: []
    };
    let state = clone(initialState);
    let scheduleBookings = [];
    let weeklyAvailability = DAYS_OF_WEEK.map(day => ({ day, available: false, timeframes: [] }));
    let blockedDates = [];
    let lastSaved = null;
    const loadStatus = {};
    /* ---------- Booking money (integer cents; dollars only when rendering) ---------- */
    const PAYMENT_METHODS = ['Cash', 'Card', 'Square', 'Zelle', 'Venmo', 'Cash App', 'Other'];
    const NO_PACKAGE = 'No package';
    const cents = v => {
        const n = Math.round(Number(v));
        return Number.isFinite(n) ? n : 0;
    };
    /** "$1,234.50" from integer cents (always two decimals). */
    function formatCents(value) {
        const n = cents(value);
        const sign = n < 0 ? '-' : '';
        return `${sign}$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    /**
     * The one place a booking's money is worked out. `b` is a mapped booking (app.js mapBooking):
     * total = its price, paid = paid at booking (deposit_paid) + recorded payments.
     * A cancelled booking has no balance; what was paid on it is a refund owed.
     */
    function balanceOf(b) {
        const totalCents = Math.max(0, cents(b && b.priceCents));
        const depositCents = Math.max(0, cents(b && b.depositCents));
        const paymentsCents = Math.max(0, cents(b && b.paymentsTotal));
        const paidCents = depositCents + paymentsCents;
        const cancelled = String((b && b.status) || '').toLowerCase() === 'cancelled';
        return {
            totalCents,
            depositCents,
            paymentsCents,
            paidCents,
            balanceCents: cancelled ? 0 : Math.max(0, totalCents - paidCents),
            overpaidCents: cancelled ? 0 : Math.max(0, paidCents - totalCents),
            refundOwedCents: cancelled ? paidCents : 0,
            cancelled
        };
    }
    const loadErrors = {};
    LOAD_AREAS.forEach(a => { loadStatus[a] = 'loading'; loadErrors[a] = ''; });
    let saving = false;
    let saveFailed = false; // the last Review & save stopped on an error; cleared by the next save or when clean
    let lastRows = [];
    /* ---------- Settings snapshot ---------- */
    function hasServerId(pkg) {
        if (!pkg || pkg.id === undefined || pkg.id === null || pkg.id === '')
            return false;
        return !String(pkg.id).startsWith('pkg_'); // legacy local drafts never count as settings
    }
    function packageSetting(pkg) {
        return {
            name: pkg.name ?? '',
            price: pkg.price ?? '',
            description: pkg.description ?? '',
            outfits: pkg.outfits ?? '',
            duration_minutes: pkg.duration_minutes ?? '',
            full_day: pkg.full_day === true
        };
    }
    function getSettings() {
        const profile = {};
        PROFILE_KEYS.forEach(k => { profile[k] = state[k] ?? ''; });
        profile.social = Array.isArray(state.social)
            ? state.social.map(s => ({ _id: s?._id ?? '', platform: s?.platform ?? '', url: s?.url ?? '' }))
            : [];
        const pricing = {
            baseFee: state.pricing?.baseFee ?? '',
            perPerson: state.pricing?.perPerson ?? '',
            depositPercent: state.pricing?.depositPercent ?? ''
        };
        const packages = {};
        (Array.isArray(state.packages) ? state.packages : []).forEach(pkg => {
            if (hasServerId(pkg))
                packages[pkg.id] = packageSetting(pkg);
        });
        return clone({ profile, pricing, availability: weeklyAvailability, packages });
    }
    let saved = getSettings();
    /** Writes the areas present in `snapshot` back into current. Areas left out are untouched. */
    function setSettings(snapshot) {
        if (!snapshot || typeof snapshot !== 'object')
            return;
        const snap = clone(snapshot);
        if (snap.profile) {
            PROFILE_KEYS.forEach(k => { if (k in snap.profile)
                state[k] = snap.profile[k] ?? ''; });
            if (Array.isArray(snap.profile.social))
                state.social = snap.profile.social;
        }
        if (snap.pricing) {
            state.pricing = Object.assign({}, state.pricing, snap.pricing);
        }
        if (Array.isArray(snap.availability)) {
            weeklyAvailability = snap.availability;
        }
        if (snap.packages && typeof snap.packages === 'object') {
            (Array.isArray(state.packages) ? state.packages : []).forEach(pkg => {
                const p = hasServerId(pkg) ? snap.packages[pkg.id] : null;
                if (p)
                    Object.assign(pkg, p);
            });
        }
    }
    /** area: 'profile' | 'pricing' | 'availability' | 'packages' (whole map) | 'package:<id>' */
    function commitSaved(area, payload) {
        const value = clone(payload);
        if (area === 'profile' || area === 'pricing' || area === 'availability') {
            saved[area] = value;
        }
        else if (area === 'packages') {
            saved.packages = value && typeof value === 'object' ? value : {};
        }
        else if (typeof area === 'string' && area.startsWith('package:')) {
            const id = area.slice('package:'.length);
            saved.packages[id] = value ? packageSetting(value) : packageSetting({});
        }
        lastSaved = new Date();
    }
    /** A package the server just created: in current and in the baseline, so it is not "dirty". */
    function addPackage(pkg) {
        if (!pkg)
            return;
        state.packages = Array.isArray(state.packages) ? state.packages : [];
        if (!state.packages.some(p => String(p.id) === String(pkg.id)))
            state.packages.push(pkg);
        if (hasServerId(pkg))
            saved.packages[pkg.id] = packageSetting(pkg);
        recompute();
    }
    function removePackage(id) {
        state.packages = (Array.isArray(state.packages) ? state.packages : []).filter(p => String(p.id) !== String(id));
        delete saved.packages[id];
        recompute();
    }
    /* ---------- Load status ---------- */
    function setLoadStatus(area, status, message) {
        loadStatus[area] = status;
        loadErrors[area] = status === 'failed' ? String(message || '') : '';
        recompute();
    }
    const getLoadStatus = area => loadStatus[area] || 'loading';
    const getLoadError = area => loadErrors[area] || '';
    /* ---------- Diff + status UI ---------- */
    /** Saved/current snapshots restricted to settings areas that finished loading. */
    function comparableSnapshots() {
        const cur = getSettings();
        const s = {};
        const c = {};
        SETTINGS_AREAS.forEach(area => {
            if (getLoadStatus(area) !== 'loaded')
                return;
            s[area] = saved[area];
            c[area] = cur[area];
        });
        return { s, c };
    }
    function computeRows() {
        const diff = window.R59.reviewChanges?.diff;
        if (typeof diff !== 'function')
            return [];
        const { s, c } = comparableSnapshots();
        try {
            return diff(s, c) || [];
        }
        catch (err) {
            console.error('[state] Could not compute changes:', err);
            return [];
        }
    }
    function renderStatus(rows) {
        const count = rows.length;
        const invalid = rows.filter(r => r.invalid).length;
        const clean = count === 0;
        // Header status is an icon (#status[data-state]); the words go in its title and the sr-only,
        // aria-live #statusText, and are only rewritten when they change so nothing is re-announced
        const statusEl = document.getElementById('status');
        const statusText = document.getElementById('statusText');
        if (clean && !saving)
            saveFailed = false;
        const changes = `${count} unsaved change${count === 1 ? '' : 's'}`;
        const fixes = invalid > 0 ? `, ${invalid} need${invalid === 1 ? 's' : ''} a fix` : '';
        let state;
        let label;
        if (saving) {
            state = 'saving';
            label = 'Saving changes…';
        }
        else if (clean) {
            state = 'saved';
            label = 'All changes saved';
        }
        else if (saveFailed) {
            state = 'error';
            label = `Save failed: ${changes}${fixes}`;
        }
        else {
            state = 'dirty';
            label = `${changes}${fixes}`;
        }
        if (statusEl) {
            statusEl.classList.toggle('saved', state === 'saved');
            statusEl.dataset.state = state;
            statusEl.setAttribute('title', label);
        }
        if (statusText && statusText.textContent !== label)
            statusText.textContent = label;
        const bar = document.getElementById('savebar');
        if (bar)
            bar.hidden = clean && !saving;
        const countEl = document.getElementById('changeCount');
        if (countEl)
            countEl.textContent = String(count);
        const wordEl = document.getElementById('changeWord');
        if (wordEl)
            wordEl.textContent = count === 1 ? 'unsaved change' : 'unsaved changes';
        const noteEl = document.getElementById('changeNote');
        if (noteEl) {
            noteEl.textContent = invalid > 0
                ? `· ${invalid} need${invalid === 1 ? 's' : ''} a fix`
                : '· ready to review';
        }
    }
    /** Recomputes the diff, updates header status, save bar and overview, and returns the rows. */
    function recompute() {
        lastRows = computeRows();
        renderStatus(lastRows);
        window.R59.dashboard?.refreshOverview?.();
        return lastRows;
    }
    function isDirty() {
        return computeRows().length > 0;
    }
    function isAreaDirty(area) {
        const rows = computeRows();
        if (area === 'packages')
            return rows.some(r => String(r.area).startsWith('package:'));
        return rows.some(r => r.area === area);
    }
    function setSaving(on) {
        saving = Boolean(on);
        if (saving)
            saveFailed = false;
        renderStatus(lastRows);
    }
    /** Marks the header status as failed (red alert) until the next save or until nothing is unsaved. */
    function setSaveFailed(on) {
        saveFailed = Boolean(on);
        renderStatus(lastRows);
    }
    window.R59 = window.R59 || {};
    window.R59.state = {
        PLATFORMS,
        CATEGORIES,
        PAYMENT_METHODS,
        NO_PACKAGE,
        balanceOf,
        formatCents,
        newSocialId,
        DAYS_OF_WEEK,
        SETTINGS_AREAS,
        LOAD_AREAS,
        clone,
        getState: () => state,
        setState: (newState) => { state = newState; },
        getSettings,
        getSaved: () => saved,
        setSettings,
        commitSaved,
        addPackage,
        removePackage,
        setLoadStatus,
        getLoadStatus,
        getLoadError,
        recompute,
        markDirty: recompute,
        setDirty: () => recompute(), // back-compat: dirtiness is now derived from the diff
        syncStatus: () => renderStatus(lastRows),
        isDirty,
        isAreaDirty,
        isSaving: () => saving,
        setSaving,
        setSaveFailed,
        getLastSaved: () => lastSaved,
        setLastSaved: (dt) => { lastSaved = dt; },
        getBookings: () => scheduleBookings,
        setBookings: (b) => { scheduleBookings = b; },
        getAvailability: () => weeklyAvailability,
        setAvailability: (a) => { weeklyAvailability = a; },
        getBlockedDates: () => blockedDates,
        setBlockedDates: (bd) => { blockedDates = bd; }
    };
    // Global compatibility aliases used by page modules
    Object.defineProperty(window, 'dirty', {
        get: () => isDirty(),
        set: () => { recompute(); }
    });
    window.clone = clone;
    window.markDirty = recompute;
    window.syncStatus = window.R59.state.syncStatus;
    window.PLATFORMS = PLATFORMS;
    window.CATS = CATEGORIES;
    Object.defineProperty(window, 'scheduleBookings', {
        get: () => scheduleBookings,
        set: (b) => { scheduleBookings = b; }
    });
    Object.defineProperty(window, 'weeklyAvailability', {
        get: () => weeklyAvailability,
        set: (a) => { weeklyAvailability = a; }
    });
    Object.defineProperty(window, 'blockedDates', {
        get: () => blockedDates,
        set: (bd) => { blockedDates = bd; }
    });
})();
