/**
 * R59 Media Admin — Header fold, Menu panel and dropdowns
 *
 * One 56px header row. Items fold into the Menu by measurement only (never a fixed breakpoint):
 *   nav groups right -> left (Overview last), then Open portfolio, Settings and Log out (.act-fold),
 *   then tighter gaps. The save status is a fixed-size icon, so it never folds.
 * The row is overflow:hidden in CSS, so fitting never causes a horizontal scroll flash.
 */
(function () {
  'use strict';

  const top = document.getElementById('top');
  const row = document.getElementById('topRow');
  const menuBtn = document.getElementById('menuBtn');
  const menuPanel = document.getElementById('menuPanel');
  if (!top || !row || !menuBtn || !menuPanel) return;

  const navItems = [...row.querySelectorAll('#tabs > li')];
  const menuGroups = navItems.map(li => menuPanel.querySelector(`.mp-nav[data-group="${li.dataset.group}"]`));
  const drops = [...row.querySelectorAll('.drop > button[aria-controls]')];
  let level = 0;

  /* ---------- Dropdowns ---------- */
  const panelOf = btn => document.getElementById(btn.getAttribute('aria-controls'));
  const isOpen = btn => btn.getAttribute('aria-expanded') === 'true';
  const openDrop = () => drops.find(isOpen) || null;

  function placePanel(btn, panel) {
    const r = btn.getBoundingClientRect();
    panel.style.top = Math.round(r.bottom + 2) + 'px';
    const left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8));
    panel.style.left = Math.round(left) + 'px';
  }

  function closeDrops(except) {
    drops.forEach(b => {
      if (b === except) return;
      b.setAttribute('aria-expanded', 'false');
      const p = panelOf(b);
      if (p) p.hidden = true;
    });
  }

  function setDrop(btn, open, { focusFirst = false } = {}) {
    closeDrops(btn);
    const panel = panelOf(btn);
    if (!panel) return;
    btn.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    if (open) {
      placePanel(btn, panel);
      if (focusFirst) panel.querySelector('button, a')?.focus();
    }
  }

  drops.forEach(btn => {
    btn.addEventListener('click', () => setDrop(btn, !isOpen(btn)));
    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setDrop(btn, true, { focusFirst: true });
      }
    });
    const panel = panelOf(btn);
    panel?.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const items = [...panel.querySelectorAll('button, a')];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      let next = 0;
      if (e.key === 'End') next = items.length - 1;
      else if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % items.length;
      else if (e.key === 'ArrowUp') next = i <= 0 ? items.length - 1 : i - 1;
      items[next].focus();
    });
  });

  /* ---------- Menu panel ---------- */
  const menuOpen = () => menuBtn.getAttribute('aria-expanded') === 'true';

  function setMenu(open, { returnFocus = false } = {}) {
    menuBtn.setAttribute('aria-expanded', String(open));
    menuPanel.hidden = !open;
    if (!open && returnFocus && menuBtn.offsetParent !== null) menuBtn.focus();
  }

  menuBtn.addEventListener('click', () => {
    closeDrops();
    setMenu(!menuOpen());
  });

  /* ---------- Fold levels ---------- */
  function setLevel(next) {
    const n = navItems.length;
    const folded = Math.min(next, n);
    navItems.forEach((li, i) => {
      const f = i >= n - folded;
      li.classList.toggle('folded', f);
      if (menuGroups[i]) menuGroups[i].hidden = !f;
    });
    top.classList.toggle('f1', folded > 0);
    top.classList.toggle('f2', next > n);
    top.classList.toggle('f3', next > n + 1);
    level = next;
  }

  function fit() {
    const max = navItems.length + 2;
    let next = 0;
    for (; next <= max; next++) {
      setLevel(next);
      if (row.scrollWidth <= row.clientWidth + 1) break;
    }
    if (next > max) setLevel(max);
    // a dropdown whose group just folded must not stay open
    const d = openDrop();
    if (d && d.closest('li')?.classList.contains('folded')) closeDrops();
    else if (d) placePanel(d, panelOf(d));
    if (level === 0 && menuOpen()) setMenu(false);
  }

  let raf = 0;
  function scheduleFit() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; fit(); });
  }

  /* ---------- Global listeners ---------- */
  document.addEventListener('click', e => {
    const t = e.target;
    const go = t.closest('[data-go]');

    // choosing an item closes its dropdown and returns focus to the dropdown button
    const inPanel = t.closest('.drop-panel');
    if (inPanel && go) {
      const btn = drops.find(b => panelOf(b) === inPanel);
      closeDrops();
      btn?.focus({ preventScroll: true });
    } else if (!t.closest('.drop')) {
      closeDrops();
    }

    if (go && menuPanel.contains(go)) setMenu(false, { returnFocus: true });
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // modals and the review dialog own Escape while open
    if (document.querySelector('.modal.open, dialog[open]')) return;
    const d = openDrop();
    if (d) {
      closeDrops();
      d.focus();
      return;
    }
    if (menuOpen()) setMenu(false, { returnFocus: true });
  });

  window.addEventListener('scroll', () => { if (openDrop()) closeDrops(); }, { passive: true });

  if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleFit).observe(row);
  else window.addEventListener('resize', scheduleFit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

  fit(); // once now, with the row clipped, before first paint of the header

  window.R59 = window.R59 || {};
  window.R59.headerFold = { fit };
})();
