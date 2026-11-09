/**
 * R59 Media Admin — Application State Management
 * 
 * Clean state initialization without fictional/sample data.
 * Ready to receive persistence data from backend API services.
 */

export const PLATFORMS: readonly string[] = [
  'Instagram',
  'TikTok',
  'X',
  'Threads',
  'Facebook',
  'YouTube',
  'LinkedIn',
  'Website'
];

export const CATEGORIES: readonly string[] = [
  'Portrait',
  'Lifestyle',
  'Events',
  'Extras'
]; // matches the public portfolio filters

export const DAYS_OF_WEEK: readonly string[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

export interface SocialLink {
  platform: string;
  url: string;
}

export interface ImagesState {
  main: any[];
  gallery: any[];
  about: any[];
}

export interface PricingState {
  baseFee: number;
  perPerson: number;
  depositPercent: number;
}

export interface AdminAppState {
  bio: string;
  email: string;
  phone: string;
  location: string;
  travel: string;
  social: SocialLink[];
  images: ImagesState;
  pricing: PricingState;
  packages: any[];
  coupons: any[];
}

export interface Timeframe {
  start: string;
  end: string;
}

export interface DayAvailability {
  day: string;
  available: boolean;
  timeframes: Timeframe[];
}

export interface BlockedDate {
  date: string;
  reason?: string;
  [key: string]: any;
}

export interface StateManager {
  PLATFORMS: readonly string[];
  CATEGORIES: readonly string[];
  clone: <T>(o: T) => T;
  getState: () => AdminAppState;
  setState: (newState: AdminAppState) => void;
  getSaved: () => AdminAppState;
  setSaved: (newSaved: AdminAppState) => void;
  isDirty: () => boolean;
  setDirty: (isDirty: boolean) => void;
  markDirty: () => void;
  syncStatus: () => void;
  getLastSaved: () => Date | string | null;
  setLastSaved: (dt: Date | string | null) => void;
  getBookings: () => any[];
  setBookings: (b: any[]) => void;
  getAvailability: () => DayAvailability[];
  setAvailability: (a: DayAvailability[]) => void;
  getBlockedDates: () => BlockedDate[];
  setBlockedDates: (bd: BlockedDate[]) => void;
}

// Initial clean application state
export const initialState: AdminAppState = {
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

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

let state: AdminAppState = clone(initialState);
let saved: AdminAppState = clone(state);
let dirty = false;
let lastSaved: Date | string | null = null;

// Schedule domain state (empty collections)
let scheduleBookings: any[] = [];

let weeklyAvailability: DayAvailability[] = DAYS_OF_WEEK.map(day => ({
  day,
  available: false,
  timeframes: []
}));

let blockedDates: BlockedDate[] = [];

export function markDirty(): void {
  dirty = true;
  syncStatus();
  if (typeof window !== 'undefined' && window.R59?.dashboard?.refreshOverview) {
    window.R59.dashboard.refreshOverview();
  }
}

export function syncStatus(): void {
  if (typeof document === 'undefined') return;
  const statusEl = document.querySelector<HTMLElement>('#status');
  const savebarEl = document.querySelector<HTMLElement>('#savebar');
  if (statusEl) {
    statusEl.textContent = dirty ? 'Unsaved changes' : 'All changes saved';
    statusEl.classList.toggle('dirty', dirty);
  }
  if (savebarEl) {
    savebarEl.classList.toggle('show', dirty);
  }
}

export function setDirty(isDirty: boolean): void {
  dirty = isDirty;
  syncStatus();
}

export const getState = (): AdminAppState => state;
export const setState = (newState: AdminAppState): void => { state = newState; };

export const getSaved = (): AdminAppState => saved;
export const setSaved = (newSaved: AdminAppState): void => { saved = newSaved; };

export const isDirty = (): boolean => dirty;

export const getLastSaved = (): Date | string | null => lastSaved;
export const setLastSaved = (dt: Date | string | null): void => { lastSaved = dt; };

export const getBookings = (): any[] => scheduleBookings;
export const setBookings = (b: any[]): void => { scheduleBookings = b; };

export const getAvailability = (): DayAvailability[] => weeklyAvailability;
export const setAvailability = (a: DayAvailability[]): void => { weeklyAvailability = a; };

export const getBlockedDates = (): BlockedDate[] => blockedDates;
export const setBlockedDates = (bd: BlockedDate[]): void => { blockedDates = bd; };

export const stateManager: StateManager = {
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

declare global {
  interface Window {
    state?: AdminAppState;
    saved?: AdminAppState;
    dirty?: boolean;
    clone?: <T>(o: T) => T;
    markDirty?: () => void;
    syncStatus?: () => void;
    PLATFORMS?: readonly string[];
    CATS?: readonly string[];
    scheduleBookings?: any[];
    weeklyAvailability?: DayAvailability[];
    blockedDates?: BlockedDate[];
  }
}

// Window global registration for zero-build and modular compatibility
if (typeof window !== 'undefined') {
  window.R59 = window.R59 || {};
  window.R59.state = stateManager;

  // Aliases for global compatibility across page modules
  window.state = state;
  window.saved = saved;
  Object.defineProperty(window, 'dirty', {
    get: () => dirty,
    set: (v: boolean) => { setDirty(v); },
    configurable: true
  });
  window.clone = clone;
  window.markDirty = markDirty;
  window.syncStatus = syncStatus;
  window.PLATFORMS = PLATFORMS;
  window.CATS = CATEGORIES;
  Object.defineProperty(window, 'scheduleBookings', {
    get: () => scheduleBookings,
    set: (b: any[]) => { scheduleBookings = b; },
    configurable: true
  });
  Object.defineProperty(window, 'weeklyAvailability', {
    get: () => weeklyAvailability,
    set: (a: DayAvailability[]) => { weeklyAvailability = a; },
    configurable: true
  });
  Object.defineProperty(window, 'blockedDates', {
    get: () => blockedDates,
    set: (bd: BlockedDate[]) => { blockedDates = bd; },
    configurable: true
  });
}

export default stateManager;
