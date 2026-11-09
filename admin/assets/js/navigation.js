/**
 * R59 Media Admin — Navigation & Theming
 *
 * Handles single-page view routing (`go()`), mobile drawer navigation,
 * anchor scrolling, and light/dark appearance theming.
 */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
export function setDrawer(open) {
    const drawer = $('#drawer');
    const burger = $('#burger');
    const scrim = $('#scrim');
    if (!drawer || !burger || !scrim)
        return;
    drawer.classList.toggle('open', open);
    scrim.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    drawer.setAttribute('aria-hidden', String(!open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) {
        const firstLink = drawer.querySelector('.nav-link');
        if (firstLink)
            firstLink.focus();
    }
    else {
        burger.focus();
    }
}
export function go(view, { anchor, tab } = {}) {
    if (!document.body.classList.contains('authenticated')) {
        return;
    }
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    if (tab && window.R59?.photography?.setTab) {
        window.R59.photography.setTab(tab);
    }
    const currentTab = window.R59?.photography?.getCurrentTab
        ? window.R59.photography.getCurrentTab()
        : 'main';
    $$('.drawer .nav-link').forEach(l => {
        const match = l.dataset.go === view &&
            (view !== 'images' || l.dataset.tab === currentTab) &&
            (l.dataset.anchor ? l.dataset.anchor === anchor : !anchor || view !== 'text');
        l.classList.toggle('active', match);
    });
    if (anchor) {
        requestAnimationFrame(() => {
            const el = document.getElementById(anchor);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                const f = el.querySelector('input, textarea');
                if (f)
                    setTimeout(() => f.focus({ preventScroll: true }), 350);
            }
        });
    }
    else {
        window.scrollTo({ top: 0 });
    }
}
/* ---------- Theming ---------- */
let themeChoice = typeof localStorage !== 'undefined'
    ? (localStorage.getItem('r59_theme') || 'system')
    : 'system';
export function getThemeChoice() {
    return themeChoice;
}
export function setThemeChoice(choice) {
    themeChoice = choice;
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('r59_theme', themeChoice);
    }
    applyTheme();
}
export function applyTheme() {
    if (typeof document === 'undefined')
        return;
    const root = document.documentElement;
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    if (themeChoice === 'system') {
        root.removeAttribute('data-theme');
    }
    else {
        root.dataset.theme = themeChoice;
    }
    const eff = themeChoice === 'system' ? (mq && mq.matches ? 'light' : 'dark') : themeChoice;
    root.dataset.themeEffective = eff;
    const themeToggle = $('#themeToggle');
    if (themeToggle) {
        themeToggle.setAttribute('aria-label', eff === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    }
    $$('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === themeChoice)));
}
export function initNavigation() {
    const burger = $('#burger');
    const drawer = $('#drawer');
    if (burger) {
        burger.onclick = () => setDrawer(!drawer?.classList.contains('open'));
    }
    const closeBtn = $('#closeDrawer');
    if (closeBtn)
        closeBtn.onclick = () => setDrawer(false);
    const scrim = $('#scrim');
    if (scrim)
        scrim.onclick = () => setDrawer(false);
    document.addEventListener('click', (e) => {
        const target = e.target;
        const b = target?.closest('[data-go]');
        if (!b)
            return;
        go(b.dataset.go || '', { anchor: b.dataset.anchor, tab: b.dataset.tab });
        if (drawer && drawer.contains(b))
            setDrawer(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = $('#modal');
            const bookingModal = $('#bookingModal');
            const newBookingModal = $('#newBookingModal');
            if (modal && modal.classList.contains('open'))
                window.R59?.modal?.closeModal?.();
            else if (bookingModal && bookingModal.classList.contains('open'))
                window.R59?.schedule?.closeBookingEditor?.();
            else if (newBookingModal && newBookingModal.classList.contains('open'))
                window.R59?.schedule?.closeNewBooking?.();
            else if (drawer && drawer.classList.contains('open'))
                setDrawer(false);
        }
    });
    const themeToggle = $('#themeToggle');
    if (themeToggle) {
        themeToggle.onclick = () => {
            const root = document.documentElement;
            themeChoice = root.dataset.themeEffective === 'light' ? 'dark' : 'light';
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('r59_theme', themeChoice);
            }
            applyTheme();
        };
    }
    $$('[data-theme-set]').forEach(b => {
        b.onclick = () => {
            themeChoice = b.dataset.themeSet || 'system';
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('r59_theme', themeChoice);
            }
            applyTheme();
        };
    });
    if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: light)');
        mq.addEventListener('change', applyTheme);
    }
    applyTheme();
}
export const navigation = {
    go,
    setDrawer,
    applyTheme,
    initNavigation,
    getThemeChoice,
    setThemeChoice
};
if (typeof window !== 'undefined') {
    window.R59 = window.R59 || {};
    window.R59.navigation = navigation;
    window.go = go;
}
export default navigation;
