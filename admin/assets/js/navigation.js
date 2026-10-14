/**
 * R59 Media Admin — Navigation & Theming
 * 
 * Handles single-page view routing (`go()`), mobile drawer navigation,
 * anchor scrolling, and light/dark appearance theming.
 */

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const drawer = $('#drawer');
  const burger = $('#burger');
  const scrim = $('#scrim');

  function setDrawer(open) {
    if (!drawer || !burger || !scrim) return;
    drawer.classList.toggle('open', open);
    scrim.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open);
    drawer.setAttribute('aria-hidden', !open);
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) {
      const firstLink = drawer.querySelector('.nav-link');
      if (firstLink) firstLink.focus();
    } else {
      burger.focus();
    }
  }

  function go(view, { anchor, tab } = {}) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));

    if (tab && window.R59.photography?.setTab) {
      window.R59.photography.setTab(tab);
    }

    const currentTab = window.R59.photography?.getCurrentTab ? window.R59.photography.getCurrentTab() : 'main';

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
          if (f) setTimeout(() => f.focus({ preventScroll: true }), 350);
        }
      });
    } else {
      window.scrollTo({ top: 0 });
    }
  }

  /* ---------- Theming ---------- */
  const root = document.documentElement;
  const mq = matchMedia('(prefers-color-scheme: light)');
  let themeChoice = localStorage.getItem('r59_theme') || 'system';

  function applyTheme() {
    if (themeChoice === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.dataset.theme = themeChoice;
    }
    const eff = themeChoice === 'system' ? (mq.matches ? 'light' : 'dark') : themeChoice;
    root.dataset.themeEffective = eff;

    const themeToggle = $('#themeToggle');
    if (themeToggle) {
      themeToggle.setAttribute('aria-label', eff === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    }
    $$('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === themeChoice));
  }

  function initNavigation() {
    if (burger) {
      burger.onclick = () => setDrawer(!drawer.classList.contains('open'));
    }
    const closeBtn = $('#closeDrawer');
    if (closeBtn) closeBtn.onclick = () => setDrawer(false);
    if (scrim) scrim.onclick = () => setDrawer(false);

    document.addEventListener('click', e => {
      const b = e.target.closest('[data-go]');
      if (!b) return;
      go(b.dataset.go, { anchor: b.dataset.anchor, tab: b.dataset.tab });
      if (drawer && drawer.contains(b)) setDrawer(false);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const modal = $('#modal');
        const bookingModal = $('#bookingModal');
        const newBookingModal = $('#newBookingModal');
        if (modal && modal.classList.contains('open')) window.R59.modal.closeModal();
        else if (bookingModal && bookingModal.classList.contains('open')) window.R59.schedule?.closeBookingEditor();
        else if (newBookingModal && newBookingModal.classList.contains('open')) window.R59.schedule?.closeNewBooking();
        else if (drawer && drawer.classList.contains('open')) setDrawer(false);
      }
    });

    const themeToggle = $('#themeToggle');
    if (themeToggle) {
      themeToggle.onclick = () => {
        themeChoice = root.dataset.themeEffective === 'light' ? 'dark' : 'light';
        localStorage.setItem('r59_theme', themeChoice);
        applyTheme();
      };
    }

    $$('[data-theme-set]').forEach(b => {
      b.onclick = () => {
        themeChoice = b.dataset.themeSet;
        localStorage.setItem('r59_theme', themeChoice);
        applyTheme();
      };
    });

    mq.addEventListener('change', applyTheme);
    applyTheme();
  }

  window.R59 = window.R59 || {};
  window.R59.navigation = {
    go,
    setDrawer,
    applyTheme,
    initNavigation
  };
  window.go = go;
})();
