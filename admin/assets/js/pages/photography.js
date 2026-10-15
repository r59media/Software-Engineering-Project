/**
 * R59 Media Admin — Photography, Gallery & Business Profile Page Module
 * 
 * Manages photo gallery tabs, upload drop zone, image reordering/replacement,
 * biography, contact info, and social media links.
 */

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => window.R59.formValidation?.escapeHtml(s) || String(s);

  let currentTab = 'main';
  let currentFilter = 'All';
  let replaceTarget = null;
  let uid = 0;

  const CATS = ['Portrait', 'Lifestyle', 'Events', 'Video'];
  const PLATFORMS = ['Instagram', 'TikTok', 'X', 'Threads', 'Facebook', 'YouTube', 'LinkedIn', 'Website'];

  function setTab(tab) {
    currentTab = tab;
    currentFilter = 'All';
    $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === tab));
    renderImages();
  }

  function getCurrentTab() {
    return currentTab;
  }

  function updateBioCount() {
    const currentState = window.R59.state.getState();
    const len = (currentState.bio || '').length;
    const el = $('#bioCount');
    if (el) el.textContent = `${len} / 1200`;
  }

  function renderSocial() {
    const container = $('#socialList');
    if (!container) return;

    const currentState = window.R59.state.getState();
    const social = currentState.social || [];

    if (social.length === 0) {
      container.innerHTML = '<p class="hint">No links yet.</p>';
      return;
    }

    container.innerHTML = social.map((s, i) => `
      <div class="social-row">
        <select class="input" data-s="${i}" data-k="platform" aria-label="Platform">
          ${PLATFORMS.map(p => `<option ${p === s.platform ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        <input class="input" type="url" value="${esc(s.url || '')}" placeholder="https://" data-s="${i}" data-k="url" aria-label="${esc(s.platform)} URL">
        <button class="icon-btn del" data-rm="${i}" aria-label="Remove ${esc(s.platform)} link">
          <svg class="i" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    `).join('');
  }

  function renderImages() {
    const grid = $('#imgGrid');
    if (!grid) return;

    const currentState = window.R59.state.getState();
    const list = currentState.images[currentTab] || [];
    const isGallery = currentTab === 'gallery';

    const filtersEl = $('#filters');
    if (filtersEl) {
      filtersEl.innerHTML = isGallery
        ? ['All', ...CATS].map(c => `<button class="chip ${c === currentFilter ? 'on' : ''}" data-filter="${c}">${c}</button>`).join('')
        : '';
    }

    const hintEl = $('#imgHint');
    if (hintEl) {
      hintEl.textContent = {
        main: list.length ? `${list.length} photo(s) · Hero + “Most recent photoshoot” strip` : 'No photos in Hero/Recent strip yet',
        gallery: list.length ? `${list.length} photo(s) · order = display order on site` : 'No gallery photos uploaded yet',
        about: list.length ? `${list.length} photo(s) · Polaroid cards + banner` : 'No About me photos uploaded yet'
      }[currentTab];
    }

    const shown = list
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => !isGallery || currentFilter === 'All' || it.cat === currentFilter);

    const cardsHtml = shown.map(({ it, i }) => `
      <div class="img-card" data-idx="${i}">
        <div class="thumb">
          <img src="${esc(it.src)}" alt="${esc(it.alt || it.label)}">
          ${it.slot ? `<span class="slot">${esc(it.slot)}</span>` : ''}
          <div class="actions">
            <button class="icon-btn" data-act="replace" aria-label="Replace ${esc(it.label || 'image')}">
              <svg class="i" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>
            </button>
            <button class="icon-btn del" data-act="delete" aria-label="Remove ${esc(it.label || 'image')}">
              <svg class="i" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        </div>
        <div class="meta">
          <input class="input" value="${esc(it.label || '')}" data-field="label" placeholder="Image title" aria-label="Image title">
          <input class="input" value="${esc(it.alt || '')}" data-field="alt" placeholder="Alt text" aria-label="Alt text">
          ${isGallery ? `<select class="input" data-field="cat" aria-label="Category">${CATS.map(c => `<option ${c === it.cat ? 'selected' : ''}>${c}</option>`).join('')}</select>` : ''}
          <div class="move">
            <button class="icon-btn" data-act="left" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>
              <svg class="i" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <button class="icon-btn" data-act="right" aria-label="Move later" ${i === list.length - 1 ? 'disabled' : ''}>
              <svg class="i" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>
            </button>
          </div>
        </div>
      </div>
    `).join('');

    const addTileHtml = `
      <button class="add-tile" id="addTile" type="button" aria-label="Add images">
        <span><b>+</b>Add image${isGallery ? 's' : ''}<br><span class="hint">or drop files here</span></span>
      </button>`;

    grid.innerHTML = cardsHtml + addTileHtml;

    if (window.R59.dashboard?.refreshOverview) {
      window.R59.dashboard.refreshOverview();
    }
  }

  function readFile(file) {
    return new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(file);
    });
  }

  async function replaceAt(idx, file) {
    if (!file || !file.type.startsWith('image/')) return;
    const currentState = window.R59.state.getState();
    const it = currentState.images[currentTab][idx];
    if (!it) return;
    it.src = await readFile(file);
    it.label = file.name.replace(/\.[^.]+$/, '');
    renderImages();
    window.R59.state.markDirty();
    window.toast('Image replaced');
  }

  async function addFiles(files) {
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    const currentState = window.R59.state.getState();
    currentState.images[currentTab] = currentState.images[currentTab] || [];

    for (const f of imgs) {
      const label = f.name.replace(/\.[^.]+$/, '');
      currentState.images[currentTab].push({
        id: ++uid,
        src: await readFile(f),
        label,
        alt: label,
        ...(currentTab === 'gallery' ? { cat: currentFilter === 'All' ? 'Portrait' : currentFilter } : {})
      });
    }

    if (imgs.length) {
      renderImages();
      window.R59.state.markDirty();
      window.toast(`${imgs.length} image${imgs.length > 1 ? 's' : ''} added`);
    }
  }

  function initPhotographyListeners() {
    // Tabs
    $$('.tab').forEach(t => {
      t.onclick = () => window.go('images', { tab: t.dataset.tab });
    });

    // Social list listeners
    const socialList = $('#socialList');
    if (socialList) {
      socialList.addEventListener('input', e => {
        const t = e.target;
        if (t.dataset.s === undefined) return;
        const currentState = window.R59.state.getState();
        currentState.social[t.dataset.s][t.dataset.k] = t.value;
        window.R59.state.markDirty();
      });

      socialList.addEventListener('click', e => {
        const b = e.target.closest('[data-rm]');
        if (!b) return;
        const idx = +b.dataset.rm;
        const currentState = window.R59.state.getState();
        const item = currentState.social[idx];
        const platformLabel = item?.platform || 'social link';

        window.R59.confirmation.confirmRemoveSocial(platformLabel, () => {
          currentState.social.splice(idx, 1);
          renderSocial();
          window.R59.state.markDirty();
          window.toast(`${platformLabel} link removed`);
        });
      });
    }

    $('#addSocial')?.addEventListener('click', () => {
      const currentState = window.R59.state.getState();
      currentState.social = currentState.social || [];
      const used = currentState.social.map(s => s.platform);
      currentState.social.push({
        platform: PLATFORMS.find(p => !used.includes(p)) || 'Website',
        url: ''
      });
      renderSocial();
      window.R59.state.markDirty();
      const lastInput = $$('#socialList input[type=url]').pop();
      if (lastInput) lastInput.focus();
    });

    // Image grid actions
    const grid = $('#imgGrid');
    if (grid) {
      grid.addEventListener('click', e => {
        if (e.target.closest('#addTile')) return $('#fileAdd')?.click();
        if (e.target.closest('.chip')) return;
        const card = e.target.closest('.img-card');
        if (!card) return;

        const idx = +card.dataset.idx;
        const currentState = window.R59.state.getState();
        const list = currentState.images[currentTab];
        const act = e.target.closest('[data-act]')?.dataset.act;

        if (act === 'delete') {
          const item = list[idx];
          const label = item?.label || 'image';
          window.R59.confirmation.confirmRemoveImage(label, () => {
            list.splice(idx, 1);
            renderImages();
            window.R59.state.markDirty();
            window.toast('Image removed');
          });
        } else if (act === 'left' || act === 'right') {
          const j = idx + (act === 'left' ? -1 : 1);
          if (j >= 0 && j < list.length) {
            [list[idx], list[j]] = [list[j], list[idx]];
            renderImages();
            window.R59.state.markDirty();
          }
        } else if (act === 'replace' || e.target.tagName === 'IMG') {
          replaceTarget = idx;
          $('#filePick')?.click();
        }
      });

      grid.addEventListener('input', e => {
        const f = e.target.dataset.field;
        if (!f) return;
        const card = e.target.closest('.img-card');
        if (!card) return;
        const currentState = window.R59.state.getState();
        currentState.images[currentTab][card.dataset.idx][f] = e.target.value;
        window.R59.state.markDirty();
        if (f === 'cat' && currentFilter !== 'All') renderImages();
      });

      // Drag and drop
      grid.addEventListener('dragover', e => {
        const t = e.target.closest('.img-card, .add-tile');
        if (!t) return;
        e.preventDefault();
        $$('.drag').forEach(x => x !== t && x.classList.remove('drag'));
        t.classList.add('drag');
      });

      grid.addEventListener('dragleave', e => {
        const t = e.target.closest('.img-card, .add-tile');
        if (t && !t.contains(e.relatedTarget)) t.classList.remove('drag');
      });

      grid.addEventListener('drop', e => {
        const t = e.target.closest('.img-card, .add-tile');
        if (!t) return;
        e.preventDefault();
        t.classList.remove('drag');
        if (t.classList.contains('add-tile')) {
          addFiles(e.dataTransfer.files);
        } else {
          replaceAt(+t.dataset.idx, e.dataTransfer.files[0]);
        }
      });
    }

    $('#filters')?.addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (!c) return;
      currentFilter = c.dataset.filter;
      renderImages();
    });

    const filePick = $('#filePick');
    if (filePick) {
      filePick.onchange = e => {
        replaceAt(replaceTarget, e.target.files[0]);
        e.target.value = '';
      };
    }

    const fileAdd = $('#fileAdd');
    if (fileAdd) {
      fileAdd.onchange = e => {
        addFiles(e.target.files);
        e.target.value = '';
      };
    }

    // Text field data bindings
    $$('[data-bind]').forEach(el => {
      el.addEventListener('input', () => {
        const currentState = window.R59.state.getState();
        currentState[el.dataset.bind] = el.value;
        if (el.id === 'bio') updateBioCount();
        window.R59.state.markDirty();
      });
    });
  }

  window.R59 = window.R59 || {};
  window.R59.photography = {
    setTab,
    getCurrentTab,
    updateBioCount,
    renderSocial,
    renderImages,
    initPhotographyListeners
  };
  window.setTab = setTab;
  window.updateBioCount = updateBioCount;
  window.renderSocial = renderSocial;
  window.renderImages = renderImages;
})();
