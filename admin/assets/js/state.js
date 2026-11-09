/**
 * R59 Media Admin — Application State Management
 *
 * Clean state initialization without fictional/sample data.
 * Ready to receive persistence data from backend API services.
 */
export const PLATFORMS = [
    'Instagram',
    'TikTok',
    'X',
    'Threads',
    'Facebook',
    'YouTube',
    'LinkedIn',
    'Website'
];
export const CATEGORIES = [
    'Portrait',
    'Lifestyle',
    'Events',
    'Extras'
]; // matches the public portfolio filters
export const DAYS_OF_WEEK = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday'
];
// Initial clean application state
export const initialState = {
    bio: '',
    email: '',
    phone: '',
    location: '',
    travel: '',
    social: [],
    images: {
        main: [],
        gallery: [],
        about: []
    },
    pricing: {
        baseFee: 0,
        perPerson: 0,
        depositPercent: 50
    },
    packages: [],
    coupons: []
};
export const clone = (o) => JSON.parse(JSON.stringify(o));
let state = clone(initialState);
let saved = clone(state);
let dirty = false;
let lastSaved = null;
// Schedule domain state (empty collections)
let scheduleBookings = [];
let weeklyAvailability = DAYS_OF_WEEK.map(day => ({
    day,
    available: false,
    timeframes: []
}));
let blockedDates = [];
export function markDirty() {
    dirty = true;
    syncStatus();
    if (typeof window !== 'undefined' && window.R59?.dashboard?.refreshOverview) {
        window.R59.dashboard.refreshOverview();
    }
}
export function syncStatus() {
    if (typeof document === 'undefined')
        return;
    const statusEl = document.querySelector('#status');
    const savebarEl = document.querySelector('#savebar');
    if (statusEl) {
        statusEl.textContent = dirty ? 'Unsaved changes' : 'All changes saved';
        statusEl.classList.toggle('dirty', dirty);
    }
    if (savebarEl) {
        savebarEl.classList.toggle('show', dirty);
    }
}
export function setDirty(isDirty) {
    dirty = isDirty;
    syncStatus();
}
export const getState = () => state;
export const setState = (newState) => { state = newState; };
export const getSaved = () => saved;
export const setSaved = (newSaved) => { saved = newSaved; };
export const isDirty = () => dirty;
export const getLastSaved = () => lastSaved;
export const setLastSaved = (dt) => { lastSaved = dt; };
export const getBookings = () => scheduleBookings;
export const setBookings = (b) => { scheduleBookings = b; };
export const getAvailability = () => weeklyAvailability;
export const setAvailability = (a) => { weeklyAvailability = a; };
export const getBlockedDates = () => blockedDates;
export const setBlockedDates = (bd) => { blockedDates = bd; };
export const stateManager = {
    PLATFORMS,
    CATEGORIES,
    clone,
    getState,
    setState,
    getSaved,
    setSaved,
    isDirty,
    setDirty,
    markDirty,
    syncStatus,
    getLastSaved,
    setLastSaved,
    getBookings,
    setBookings,
    getAvailability,
    setAvailability,
    getBlockedDates,
    setBlockedDates
};
// Window global registration for zero-build and modular compatibility
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.state = stateManager;
    // Aliases for global compatibility across page modules
    window.state = state;
    window.saved = saved;
    Object.defineProperty(window, 'dirty', {
        get: () => dirty,
        set: (v) => { setDirty(v); },
        configurable: true
    });
    window.clone = clone;
    window.markDirty = markDirty;
    window.syncStatus = syncStatus;
    window.PLATFORMS = PLATFORMS;
    window.CATS = CATEGORIES;
    Object.defineProperty(window, 'scheduleBookings', {
        get: () => scheduleBookings,
        set: (b) => { scheduleBookings = b; },
        configurable: true
    });
    Object.defineProperty(window, 'weeklyAvailability', {
        get: () => weeklyAvailability,
        set: (a) => { weeklyAvailability = a; },
        configurable: true
    });
    Object.defineProperty(window, 'blockedDates', {
        get: () => blockedDates,
        set: (bd) => { blockedDates = bd; },
        configurable: true
    });
}
export default stateManager;
