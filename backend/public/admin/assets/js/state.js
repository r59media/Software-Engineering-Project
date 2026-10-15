/**
 * R59 Media Admin — Application State Management
 * 
 * Clean state initialization without fictional/sample data.
 * Ready to receive persistence data from backend API services.
 */

(function () {
  'use strict';

  const PLATFORMS = ['Instagram', 'TikTok', 'X', 'Threads', 'Facebook', 'YouTube', 'LinkedIn', 'Website'];
  const CATEGORIES = ['Portrait', 'Lifestyle', 'Events', 'Video'];

  // Initial clean application state (no fake bookings, no fake revenue, no sample packages or coupons)
  const initialState = {
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

  const clone = o => JSON.parse(JSON.stringify(o));

  let state = clone(initialState);
  let saved = clone(state);
  let dirty = false;
  let lastSaved = null;

  // Schedule domain state (empty collections)
  let scheduleBookings = [];

  const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  let weeklyAvailability = DAYS_OF_WEEK.map(day => ({
    day,
    available: false,
    timeframes: []
  }));

  let blockedDates = [];

  function markDirty() {
    dirty = true;
    syncStatus();
    if (window.R59.dashboard?.refreshOverview) {
      window.R59.dashboard.refreshOverview();
    }
  }

  function syncStatus() {
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

  function setDirty(isDirty) {
    dirty = isDirty;
    syncStatus();
  }

  window.R59 = window.R59 || {};
  window.R59.state = {
    PLATFORMS,
    CATEGORIES,
    clone,
    getState: () => state,
    setState: (newState) => { state = newState; },
    getSaved: () => saved,
    setSaved: (newSaved) => { saved = newSaved; },
    isDirty: () => dirty,
    setDirty,
    markDirty,
    syncStatus,
    getLastSaved: () => lastSaved,
    setLastSaved: (dt) => { lastSaved = dt; },
    getBookings: () => scheduleBookings,
    setBookings: (b) => { scheduleBookings = b; },
    getAvailability: () => weeklyAvailability,
    setAvailability: (a) => { weeklyAvailability = a; },
    getBlockedDates: () => blockedDates,
    setBlockedDates: (bd) => { blockedDates = bd; }
  };

  // Aliases for global compatibility across page modules
  window.state = state;
  window.saved = saved;
  Object.defineProperty(window, 'dirty', {
    get: () => dirty,
    set: (v) => { setDirty(v); }
  });
  window.clone = clone;
  window.markDirty = markDirty;
  window.syncStatus = syncStatus;
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
