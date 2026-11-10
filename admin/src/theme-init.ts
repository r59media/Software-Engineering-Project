// @ts-nocheck
/**
 * R59 Media Admin — Theme init (loaded blocking in <head>, before the stylesheets).
 * Resolves the stored theme before first paint so there is no light/dark flash.
 * Values: system (default) | light | dark, stored under localStorage "r59_theme".
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var choice = 'system';
  try {
    var stored = localStorage.getItem('r59_theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') choice = stored;
  } catch (e) { /* storage blocked: fall back to system */ }

  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);

  var dark = choice === 'dark';
  if (choice === 'system') {
    try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { dark = false; }
  }
  root.setAttribute('data-theme-effective', dark ? 'dark' : 'light');
})();
