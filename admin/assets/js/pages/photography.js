/**
 * R59 Media Admin — Photography, Gallery & Business Profile Page Module
 * 
 * Manages photo gallery tabs, upload drop zone with automatic WebP conversion,
 * image reordering/replacement, biography, contact info, and social media links.
 */

(function () {
  'use strict';

  const { convertToWebP, isSupportedImageFile } = window.R59.webpConverter;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => window.R59?.formValidation?.escapeHtml(s) || String(s);

let currentTab = 'main';
let currentFilter = 'All';
let replaceTarget = null;
let uid = 0;
const pendingFiles = [];

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

function safeImgSrc(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }
  return '';
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
        <img src="${esc(safeImgSrc(it.src))}" alt="${esc(it.alt || it.label)}">
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
      <span><b>+</b>Add image${isGallery ? 's' : ''}<br><span class="hint">or drop files here<br><small style="opacity:0.75;font-size:11px">JPG, PNG, HEIC, RAW → auto-converted to WebP</small></span></span>
    </button>`;

  grid.innerHTML = cardsHtml + addTileHtml;

  if (window.R59.dashboard?.refreshOverview) {
    window.R59.dashboard.refreshOverview();
  }
}

async function replaceAt(idx, file) {
  if (!file || !isSupportedImageFile(file)) {
    window.toast?.('Unsupported file format. Please upload JPG, PNG, WebP, HEIC, or RAW.');
    return;
  }
  const currentState = window.R59.state.getState();
  const it = currentState.images[currentTab][idx];
  if (!it) return;

  const rawExt = (file.name.split('.').pop() || '').toUpperCase();
  window.toast?.(`Converting ${file.name} (${rawExt} → WebP)...`);

  let conversion;
  try {
    conversion = await convertToWebP(file);
  } catch (err) {
    console.error('Failed to convert replacement image to WebP:', err);
    window.toast?.(`Conversion failed: ${err.message || 'Unknown error'}`);
    return;
  }

  const { file: webpFile, originalSize, convertedSize, width, height, sourceFormat } = conversion;
  const previewUrl = URL.createObjectURL(webpFile);

  pendingFiles.push({
    file: webpFile,
    originalFile: file,
    previewUrl,
    originalSize,
    convertedSize,
    width,
    height,
    sourceFormat,
    timestamp: Date.now()
  });

  const label = webpFile.name.replace(/\.[^.]+$/, '');
  let finalSrc = previewUrl;

  if (window.R59?.api?.photography?.uploadImageFile && window.R59.apiClient?.getAuthToken()) {
    try {
      const uploaded = await window.R59.api.photography.uploadImageFile(webpFile, it.cat || 'Portrait', label);
      if (uploaded?.id) it.id = uploaded.id;
      if (safeImgSrc(uploaded?.src || uploaded?.url)) {
        finalSrc = safeImgSrc(uploaded.src || uploaded.url);
      }
    } catch {
      // Graceful fallback to preview blob URL when R2 is offline / mock mode
    }
  }

  it.src = finalSrc;
  it.label = label;
  renderImages();
  window.R59.state.markDirty();
  window.toast?.('Image replaced (auto-converted to WebP)');
}

async function handleFiles(files) {
  const allFiles = Array.from(files || []);
  if (!allFiles.length) return;

  const supported = [];
  const unsupported = [];
  for (const f of allFiles) {
    if (isSupportedImageFile(f)) {
      supported.push(f);
    } else {
      unsupported.push(f);
    }
  }

  if (unsupported.length > 0) {
    const names = unsupported.map(f => f.name).slice(0, 3).join(', ');
    const more = unsupported.length > 3 ? ` and ${unsupported.length - 3} more` : '';
    window.toast?.(`Unsupported format: ${names}${more}. Supported: JPG, PNG, WebP, HEIC, RAW (CR2, NEF, ARW, DNG, etc.)`);
  }

  if (supported.length === 0) return;

  const addTile = $('#addTile');
  const originalTileHtml = addTile?.innerHTML;

  const currentState = window.R59.state.getState();
  currentState.images[currentTab] = currentState.images[currentTab] || [];

  let successCount = 0;

  for (let i = 0; i < supported.length; i++) {
    const rawFile = supported[i];
    const rawExt = (rawFile.name.split('.').pop() || '').toUpperCase();
    const statusMsg = `Converting ${rawFile.name} (${rawExt} → WebP) [${i + 1}/${supported.length}]...`;

    if (addTile) {
      addTile.classList.add('loading');
      addTile.innerHTML = `<span><b>⟳</b> ${statusMsg}</span>`;
    }
    window.toast?.(statusMsg);

    let conversion;
    try {
      conversion = await convertToWebP(rawFile);
    } catch (err) {
      console.error(`Failed to convert ${rawFile.name} to WebP:`, err);
      window.toast?.(`Failed to convert ${rawFile.name}: ${err.message || 'Unknown error'}`);
      continue;
    }

    const { file: webpFile, originalSize, convertedSize, width, height, sourceFormat } = conversion;
    const previewUrl = URL.createObjectURL(webpFile);

    pendingFiles.push({
      file: webpFile,
      originalFile: rawFile,
      previewUrl,
      originalSize,
      convertedSize,
      width,
      height,
      sourceFormat,
      timestamp: Date.now()
    });

    const label = webpFile.name.replace(/\.[^.]+$/, '');
    const category = currentTab === 'gallery' ? (currentFilter === 'All' ? 'Portrait' : currentFilter) : 'Portrait';
    let newId = ++uid;
    let finalSrc = previewUrl;

    if (window.R59?.api?.photography?.uploadImageFile && window.R59.apiClient?.getAuthToken()) {
      try {
        const uploaded = await window.R59.api.photography.uploadImageFile(webpFile, category, label);
        if (uploaded?.id) newId = uploaded.id;
        if (safeImgSrc(uploaded?.src || uploaded?.url)) {
          finalSrc = safeImgSrc(uploaded.src || uploaded.url);
        }
      } catch {
        // Graceful fallback to preview blob URL when R2 is offline / mock mode
      }
    }

    const item = {
      id: newId,
      src: finalSrc,
      label,
      alt: label,
      ...(currentTab === 'gallery' ? { cat: category } : {})
    };
    currentState.images[currentTab].push(item);
    if (currentTab === 'gallery') {
      currentState.photos = currentState.images.gallery;
    }
    successCount++;
  }

  if (addTile && originalTileHtml) {
    addTile.classList.remove('loading');
    addTile.innerHTML = originalTileHtml;
  }

  if (successCount > 0) {
    renderImages();
    window.R59.state.markDirty();
    window.toast?.(`${successCount} photo${successCount > 1 ? 's' : ''} auto-converted to WebP & added`);
  }
}

function deletePhoto(idx) {
  const currentState = window.R59.state.getState();
  const list = currentState.images[currentTab] || [];
  const item = list[idx];
  if (!item) return;
  const label = item.label || 'image';
  window.R59.confirmation.confirmRemoveImage(label, () => {
    list.splice(idx, 1);
    if (item.id && window.R59?.api?.photography?.deleteImage) {
      window.R59.api.photography.deleteImage(item.id).catch(() => {});
    }
    renderImages();
    window.R59.state.markDirty();
    window.toast('Image removed');
  });
}

function initPhotographyListeners() {
  // Tabs & ArrowLeft / ArrowRight keyboard navigation
  const tabEls = $$('.tabs [role="tab"]');
  tabEls.forEach((t, index) => {
    t.onclick = () => window.go('images', { tab: t.dataset.tab });
    t.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const nextIndex = e.key === 'ArrowRight'
          ? (index + 1) % tabEls.length
          : (index - 1 + tabEls.length) % tabEls.length;
        const nextTab = tabEls[nextIndex];
        nextTab.focus();
        window.go('images', { tab: nextTab.dataset.tab });
      }
    });
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

    socialList.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.s === undefined || t.dataset.k !== 'url') return;
      const val = t.value.trim();
      if (val && !window.R59.formValidation?.isValidUrl(val)) {
        window.toast?.('Please enter a valid URL (starting with http:// or https://)');
      }
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
      if (e.target.closest('#addTile')) return ($('#photo-file-input') || $('#fileAdd'))?.click();
      if (e.target.closest('.chip')) return;
      const card = e.target.closest('.img-card');
      if (!card) return;

      const idx = +card.dataset.idx;
      const currentState = window.R59.state.getState();
      const list = currentState.images[currentTab];
      const act = e.target.closest('[data-act]')?.dataset.act;

      if (act === 'delete') {
        deletePhoto(idx);
      } else if (act === 'left' || act === 'right') {
        const j = idx + (act === 'left' ? -1 : 1);
        if (j >= 0 && j < list.length) {
          [list[idx], list[j]] = [list[j], list[idx]];
          if (window.R59?.api?.photography?.updateImageOrder) {
            window.R59.api.photography.updateImageOrder(
              list.map((img, orderIdx) => ({ id: img.id, display_order: orderIdx }))
            ).catch(() => {});
          }
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
      const item = currentState.images[currentTab][card.dataset.idx];
      if (!item) return;
      item[f] = e.target.value;
      if (item.id && window.R59?.api?.photography?.updateImage) {
        window.R59.api.photography.updateImage(item.id, {
          category: item.cat || 'Portrait',
          alt_text: item.alt || item.label || '',
          title: item.label || ''
        }).catch(() => {});
      }
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
        handleFiles(e.dataTransfer.files);
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
      handleFiles(e.target.files);
      e.target.value = '';
    };
  }

  const photoFileInput = $('#photo-file-input');
  if (photoFileInput) {
    photoFileInput.onchange = e => {
      handleFiles(e.target.files);
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

  // Global registry
  window.R59 = window.R59 || {};
  window.R59.photography = {
    setTab,
    getCurrentTab,
    updateBioCount,
    renderSocial,
    renderImages,
    handleFiles,
    addFiles: handleFiles,
    deletePhoto,
    safeImgSrc,
    initPhotographyListeners,
    pendingFiles
  };
  window.setTab = setTab;
  window.updateBioCount = updateBioCount;
  window.renderSocial = renderSocial;
  window.renderImages = renderImages;
  window.handleFiles = handleFiles;
})();
