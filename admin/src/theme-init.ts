// @ts-nocheck
/**
 * R59 Media Admin — Theme init (loaded blocking in <head>, before the stylesheets).
 * Resolves the theme before first paint so there is no light/dark flash.
 * Default: system preference via matchMedia('(prefers-color-scheme: dark)').
 */
(function () {
  'use strict';
  var root = document.documentElement;
  var choice = 'system';
  root.removeAttribute('data-theme');

  var dark = false;
  try {
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    dark = false;
  }
  root.setAttribute('data-theme-effective', dark ? 'dark' : 'light');
})();
