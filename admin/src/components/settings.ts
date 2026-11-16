// @ts-nocheck
/**
 * R59 Media Admin — Settings dialog (R59.account)
 *
 * Displays account information:
 *   Authorized Admin: <email from /admin/verify> (Google Sign-In)
 */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  let accountEmail = '';
  const accountText = () => accountEmail ? `Authorized Admin: ${accountEmail} (Google Sign-In)` : 'Authorized Admin (Google Sign-In)';

  let opener = null;

  const modalEl = () => $('#settingsModal');
  const isOpen = () => Boolean(modalEl()?.classList.contains('open'));

  function closeMenuPanel() {
    const menuPanel = $('#menuPanel');
    if (menuPanel && !menuPanel.hidden) {
      menuPanel.hidden = true;
      $('#menuBtn')?.setAttribute('aria-expanded', 'false');
    }
  }

  function renderAccountIndicator() {
    const indicator = $('#accountIndicator') || $('#adminAccountIndicator');
    if (indicator) {
      indicator.textContent = accountText();
    }
  }

  function openSettings(from) {
    const el = modalEl();
    if (!el) return;
    const source = from || document.activeElement;
    opener = source && $('#menuPanel')?.contains(source) ? $('#menuBtn') : source;
    closeMenuPanel();
    renderAccountIndicator();
    window.R59?.apiClient?.get('/admin/verify').then(r => {
      const e = r?.email || r?.data?.email;
      if (e) { accountEmail = e; renderAccountIndicator(); }
    }).catch(() => {});
    el.classList.add('open');
    $('#settingsClose')?.focus();
  }

  function closeSettings({ restoreFocus = true } = {}) {
    const el = modalEl();
    if (!el) return;
    const active = document.activeElement;
    if (active && el.contains(active) && typeof active.blur === 'function') active.blur();
    el.classList.remove('open');
    const back = opener;
    opener = null;
    if (restoreFocus && back && typeof back.focus === 'function' && back.isConnected && back.offsetParent !== null) {
      back.focus();
    }
  }

  function init() {
    renderAccountIndicator();

    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-settings]');
      if (!btn) return;
      e.preventDefault();
      openSettings(btn);
    });

    $('#settingsClose')?.addEventListener('click', () => closeSettings());
    modalEl()?.addEventListener('click', e => {
      if (e.target.id === 'settingsModal') closeSettings();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  window.R59 = window.R59 || {};
  window.R59.account = { openSettings, closeSettings, init };
})();
