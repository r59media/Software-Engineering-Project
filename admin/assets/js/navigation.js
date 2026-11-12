// @ts-nocheck
/**
 * R59 Media Admin — Navigation & Theming
 *
 * Single-page view routing (`go()`), header/menu "current page" state, anchor focusing,
 * and the single System -> Light -> Dark theme button.
 * Header folding, the Menu panel and dropdowns live in components/headerFold.js.
 */
(function () {
    'use strict';
    const $ = s => document.querySelector(s);
    const $$ = s => [...document.querySelectorAll(s)];
    /* ---------- Current-page state ---------- */
    // header top-level item for each view (dropdown buttons carry the group's current state)
    const GROUP_OF_VIEW = {
        overview: 'navOverview',
        text: 'ddPersonalBtn',
        payment: 'ddBusinessBtn',
        schedule: 'ddBusinessBtn',
        leads: 'ddBusinessBtn',
        images: 'ddImagesBtn'
    };
    function markCurrent(view, anchor, tab) {
        const groupId = GROUP_OF_VIEW[view];
        ['navOverview', 'ddPersonalBtn', 'ddBusinessBtn', 'ddImagesBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (!el)
                return;
            if (id === groupId)
                el.setAttribute('aria-current', 'page');
            else
                el.removeAttribute('aria-current');
        });
        // dropdown + menu panel items: exact item match (view, then tab for images, anchor for text)
        $$('.drop-item[data-go], .menu-item[data-go]').forEach(item => {
            let match = item.dataset.go === view;
            if (match && view === 'images')
                match = item.dataset.tab === tab;
            if (match && view === 'text')
                match = anchor ? item.dataset.anchor === anchor : item.dataset.anchor === 'card-bio';
            if (match)
                item.setAttribute('aria-current', 'page');
            else
                item.removeAttribute('aria-current');
        });
    }
    /* ---------- Anchor focusing (contract §8) ---------- */
    const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';
    const CONTROL = /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/;
    function focusAnchor(anchor) {
        requestAnimationFrame(() => {
            const el = document.getElementById(anchor);
            if (!el)
                return;
            const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
            const target = (CONTROL.test(el.tagName) || el.hasAttribute('tabindex'))
                ? el
                : el.querySelector(FOCUSABLE);
            el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: target === el ? 'center' : 'start' });
            if (target)
                setTimeout(() => target.focus({ preventScroll: true }), reduce ? 0 : 350);
        });
    }
    function go(view, { anchor, tab } = {}) {
        if (!document.body.classList.contains('authenticated')) {
            return;
        }
        $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
        if (tab && window.R59.photography?.setTab) {
            window.R59.photography.setTab(tab);
        }
        const currentTab = window.R59.photography?.getCurrentTab ? window.R59.photography.getCurrentTab() : (tab || 'main');
        markCurrent(view, anchor, currentTab);
        if (anchor) {
            focusAnchor(anchor);
        }
        else {
            window.scrollTo({ top: 0 });
        }
        // Views that load on first open (Enquiries) listen for this
        document.dispatchEvent(new CustomEvent('r59:view', { detail: { view } }));
    }
    /* ---------- Theming: one button cycling System -> Light -> Dark ---------- */
    const root = document.documentElement;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const ORDER = ['system', 'light', 'dark'];
    const NAME = { system: 'System', light: 'Light', dark: 'Dark' };
    let themeChoice = 'system';
    function applyTheme() {
        if (themeChoice === 'system')
            root.removeAttribute('data-theme');
        else
            root.setAttribute('data-theme', themeChoice);
        const eff = themeChoice === 'system' ? (mq.matches ? 'dark' : 'light') : themeChoice;
        root.setAttribute('data-theme-effective', eff);
        const btn = $('#themeToggle');
        if (btn) {
            const next = ORDER[(ORDER.indexOf(themeChoice) + 1) % ORDER.length];
            const label = `Theme: ${NAME[themeChoice]} (click for ${NAME[next]})`;
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }
    }
    function cycleTheme() {
        themeChoice = ORDER[(ORDER.indexOf(themeChoice) + 1) % ORDER.length];
        applyTheme();
    }
    function initNavigation() {
        document.addEventListener('click', e => {
            const b = e.target.closest('[data-go]');
            if (!b)
                return;
            go(b.dataset.go, { anchor: b.dataset.anchor, tab: b.dataset.tab });
        });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape')
                return;
            const modal = $('#modal');
            const bookingModal = $('#bookingModal');
            const newBookingModal = $('#newBookingModal');
            if (modal && modal.classList.contains('open'))
                window.R59.modal?.closeModal();
            else if ($('#settingsModal')?.classList.contains('open'))
                window.R59.account?.closeSettings?.();
            else if (bookingModal && bookingModal.classList.contains('open'))
                window.R59.schedule?.closeBookingEditor();
            else if (newBookingModal && newBookingModal.classList.contains('open'))
                window.R59.schedule?.closeNewBooking();
        });
        $('#themeToggle')?.addEventListener('click', cycleTheme);
        mq.addEventListener('change', () => { if (themeChoice === 'system')
            applyTheme(); });
        applyTheme();
    }
    window.R59 = window.R59 || {};
    window.R59.navigation = {
        go,
        applyTheme,
        initNavigation
    };
    window.go = go;
})();
