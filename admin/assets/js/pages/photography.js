/**
 * R59 Media Admin — Photography, Gallery & Business Profile Page Module
 *
 * Manages photo gallery tabs, upload drop zone with automatic WebP conversion,
 * image reordering/replacement, biography, contact info, and social media links.
 *
 * Photo changes (add, replace, remove, reorder, captions) are saved to the
 * backend immediately, so the public site reflects them on its next load.
 */

(function () {
  'use strict';

  const { convertToWebP, isSupportedImageFile } = window.R59.webpConverter;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => window.R59?.formValidation?.escapeHtml(s) || String(s);
  const api = () => window.R59?.api?.photography;
  const toast = (msg, ms) => window.toast?.(msg, ms);

  let currentTab = 'main';
  let currentFilter = 'All';
  let replaceTarget = null;
  let uploading = false;

  const CATS = ['Portrait', 'Lifestyle', 'Events', 'Extras']; // matches the public portfolio filters
  const PLATFORMS = ['Instagram', 'TikTok', 'X', 'Threads', 'Facebook', 'YouTube', 'LinkedIn', 'Website'];

  // Each admin tab maps to the section of the public site that displays its photos
  const TAB_TO_SECTION = { main: 'recent', gallery: 'gallery', about: 'about', hero: 'hero' };
  const SECTION_TO_TAB = { recent: 'main', gallery: 'gallery', about: 'about', hero: 'hero' };
  // How each tab's destination is named in confirmation dialogs
  const SECTION_LABELS = { main: 'Most Recent Photoshoot', gallery: 'the Portfolio gallery', about: 'About Me', hero: 'the Hero banner' };
  const META_SAVE_DELAY_MS = 600;
  const metaSaveTimers = new Map();

  function sectionForTab(tab) {
    return TAB_TO_SECTION[tab] || 'gallery';
  }

  function ensureImageBuckets(st = window.R59.state.getState()) {
    st.images = st.images || {};
    st.images.main = Array.isArray(st.images.main) ? st.images.main : [];
    st.images.gallery = Array.isArray(st.images.gallery) ? st.images.gallery : [];
    st.images.about = Array.isArray(st.images.about) ? st.images.about : [];
    st.images.hero = Array.isArray(st.images.hero) ? st.images.hero : [];
    return st.images;
  }

  function imagesFor(tab) {
    const images = ensureImageBuckets();
    images[tab] = images[tab] || [];
    return images[tab];
  }

  /**
   * Photo edits are already persisted, so copy them into the "saved" snapshot.
   * Without this, Discard would bring deleted photos back and the save bar
   * would claim there are unsaved changes.
   */
  function commitImages() {
    const { state } = window.R59;
    const current = state.getState();
    current.photos = current.images.gallery;
    const saved = state.getSaved();
    saved.images = state.clone(current.images);
    saved.photos = saved.images.gallery;
    window.R59.dashboard?.refreshOverview?.();
  }

  function describeError(err) {
    return (err && err.message) || 'Unknown error';
  }

  function setTabUI() {
    const list = imagesFor(currentTab);
    const hintEl = $('#imgHint');
    if (hintEl) {
      hintEl.textContent = {
        main: list.length ? `${list.length} photo(s) · “Most recent photoshoot” carousel on the home page` : 'No photos in the Most Recent carousel yet',
        gallery: list.length ? `${list.length} photo(s) · order = display order on site` : 'No gallery photos uploaded yet',
        hero: list.length ? `${list.length} photo(s) · Homepage hero slideshow background` : 'No hero photos uploaded yet',
        about: list.length ? `${list.length} photo(s) · Polaroid cards + banner` : 'No About me photos uploaded yet'
      }[currentTab] || '';
    }

    const filterWrap = $('#filterWrap') || $('#filters');
    if (filterWrap) {
      filterWrap.style.display = currentTab === 'gallery' ? '' : 'none';
      if (currentTab === 'gallery') {
        filterWrap.innerHTML = ['All', ...CATS].map(c => `<button class="chip ${c === currentFilter ? 'on' : ''}" data-filter="${c}">${c}</button>`).join('');
      } else {
        filterWrap.innerHTML = '';
      }
    }

    const card = $('#aboutProfileCard') || $('[data-collapsible-id="about-profile"]');
    const aboutProfileCard = card;
    if (aboutProfileCard) {
      aboutProfileCard.style.display = currentTab === 'about' ? '' : 'none';
    }
  }

  const DEFAULT_PROFILE = {
    bio: "I'm the photographer behind R59—drawn to quiet frames, honest light, and the small gestures that make a portrait feel lived-in.\n\nMost of my work sits between editorial portraiture and documentary storytelling. Whether we're in a studio or chasing late-afternoon sun on location, the goal is always the same: images that still feel like you ten years from now.",
    email: "hello@r59.Portraits",
    phone: "123-456-7890",
    location: "Studio & On-Location",
    travel: true,
    social: [
      { platform: 'Instagram', url: 'https://www.instagram.com' },
      { platform: 'Facebook', url: 'https://www.facebook.com' },
      { platform: 'Pinterest', url: 'https://www.pinterest.com' }
    ]
  };

  function initProfileCard() {
    const currentState = window.R59.state.getState();
    if (!currentState.bio) currentState.bio = DEFAULT_PROFILE.bio;
    if (!currentState.email) currentState.email = DEFAULT_PROFILE.email;
    if (!currentState.phone) currentState.phone = DEFAULT_PROFILE.phone;
    if (!currentState.location) currentState.location = DEFAULT_PROFILE.location;
    if (currentState.travel === undefined || currentState.travel === '') {
      currentState.travel = DEFAULT_PROFILE.travel ? 'Studio & On-Location (Worldwide)' : 'Studio only';
    }
    if (!Array.isArray(currentState.social) || currentState.social.length === 0) {
      currentState.social = DEFAULT_PROFILE.social;
    }

    const bioEl = $('#bio');
    if (bioEl && !bioEl.value) bioEl.value = currentState.bio;
    const emailEl = $('#email');
    if (emailEl && !emailEl.value) emailEl.value = currentState.email;
    const phoneEl = $('#phone');
    if (phoneEl && !phoneEl.value) phoneEl.value = currentState.phone;
    const locEl = $('#city') || $('#location');
    if (locEl && !locEl.value) locEl.value = currentState.location;
    const travelEl = $('#travel');
    if (travelEl && !travelEl.value) travelEl.value = currentState.travel;

    updateBioCount();
    renderSocial();
  }

  function setTab(tab) {
    currentTab = tab;
    currentFilter = 'All';
    $$('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === tab));
    setTabUI();
    if (tab === 'about') {
      initProfileCard();
    }
    renderImages();
  }

  function getCurrentTab() {
    return currentTab;
  }

  /**
   * Turn backend portfolio records into the card items each tab renders,
   * grouped by the site section they belong to.
   */
  function setImagesFromRecords(records) {
    const currentState = window.R59.state.getState();
    const st = currentState;
    const grouped = { main: [], gallery: [], about: [], hero: [] };
    const resolve = api()?.resolveApiUrl || (u => u);

    (records || []).forEach(p => {
      let tab;
      const secLower = (p.section || '').toLowerCase();
      const catLower = (p.category || '').toLowerCase();

      if (secLower === 'hero' || ((!p.section || secLower === 'gallery') && (catLower === 'hero' || p.is_featured === 1))) {
        tab = 'hero';
      } else {
        tab = SECTION_TO_TAB[secLower || 'gallery'] || 'gallery';
      }

      const key = p.media_key || '';
      const rawUrl = p.url || p.public_url || (key ? `/api/media/${String(key).replace(/^\/+/, '')}` : '');
      const order = p.order !== undefined && p.order !== null ? Number(p.order) : (p.display_order ?? 0);
      grouped[tab].push({
        id: p.id,
        src: resolve(rawUrl),
        key: key,
        media_key: key,
        section: tab === 'hero' ? 'hero' : (p.section || sectionForTab(tab)),
        label: p.title || p.alt_text || 'Photo',
        alt: p.alt_text || p.title || '',
        cat: p.category && CATS.includes(p.category) ? p.category : (tab === 'hero' ? 'hero' : 'Portrait'),
        order,
        display_order: order,
        is_featured: Boolean(p.is_featured)
      });
    });

    Object.values(grouped).forEach(list => list.sort((a, b) => (a.order ?? a.display_order ?? 0) - (b.order ?? b.display_order ?? 0) || a.id - b.id));

    st.images = grouped;
    commitImages();
    renderImages();
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

    setTabUI();

    const list = imagesFor(currentTab);
    const isGallery = currentTab === 'gallery';

    const shown = list
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => !isGallery || currentFilter === 'All' || it.cat === currentFilter);

    const cardsHtml = shown.map(({ it, i }) => `
      <div class="img-card${it.busy ? ' loading' : ''}" data-idx="${i}" ${it.busy ? 'aria-busy="true"' : ''}>
        <div class="thumb">
          <img src="${esc(safeImgSrc(it.src))}" alt="${esc(it.alt || it.label)}">
          ${it.slot ? `<span class="slot">${esc(it.slot)}</span>` : ''}
          <div class="actions">
            <button class="icon-btn" data-act="replace" aria-label="Replace ${esc(it.label || 'image')}" ${it.busy ? 'disabled' : ''}>
              <svg class="i" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>
            </button>
            <input type="file" class="card-replace-input" data-replace data-idx="${i}" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/*,.heic,.heif,.cr2,.cr3,.nef,.arw,.dng,.raf,.orf,.rw2,.pef,.srw" hidden>
            <button class="icon-btn del" data-act="delete" aria-label="Remove ${esc(it.label || 'image')}" ${it.busy ? 'disabled' : ''}>
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

    window.R59.dashboard?.refreshOverview?.();
  }

  function setAddTileStatus(message) {
    const addTile = $('#addTile');
    if (!addTile) return;
    addTile.classList.add('loading');
    addTile.disabled = true;
    addTile.innerHTML = `<span><b>⟳</b> ${esc(message)}</span>`;
  }

  async function convertForUpload(file, progressLabel) {
    const rawExt = (file.name.split('.').pop() || '').toUpperCase();
    const message = `Converting ${file.name} (${rawExt} → WebP)${progressLabel ? ` ${progressLabel}` : ''}...`;
    setAddTileStatus(message);
    toast(message);
    const { file: webpFile } = await convertToWebP(file, { quality: 0.92, maxDimension: 2560 });
    return webpFile;
  }

  async function replaceAt(idx, file) {
    if (!file || !isSupportedImageFile(file)) {
      toast('Unsupported file format. Please upload JPG, PNG, WebP, HEIC, or RAW.');
      return;
    }
    const tab = currentTab;
    const item = imagesFor(tab)[idx];
    if (!item || item.busy) return;
    if (!item.id) {
      toast('This photo has not finished saving yet. Try again in a moment.');
      return;
    }

    window.R59.confirmation.confirmReplaceImage(item.label, file.name, async () => {
      item.busy = true;
      renderImages();
      try {
        const webpFile = await convertForUpload(file);
        setAddTileStatus(`Uploading ${webpFile.name}...`);
        const updated = await api().replaceImageFile(item.id, webpFile);
        item.src = safeImgSrc(updated.src || updated.url) || item.src;
        item.key = updated.key || item.key;
        commitImages();
        toast('Image replaced (auto-converted to WebP)');
      } catch (err) {
        console.error('Failed to replace image:', err);
        toast(`Could not replace image: ${describeError(err)}`, 4000);
      } finally {
        delete item.busy;
        renderImages();
      }
    });
  }

  async function handleFiles(files) {
    const allFiles = Array.from(files || []);
    if (!allFiles.length) return;
    if (uploading) {
      toast('Please wait for the current upload to finish.');
      return;
    }

    const supported = allFiles.filter(f => isSupportedImageFile(f));
    const unsupported = allFiles.filter(f => !isSupportedImageFile(f));

    if (unsupported.length > 0) {
      const names = unsupported.map(f => f.name).slice(0, 3).join(', ');
      const more = unsupported.length > 3 ? ` and ${unsupported.length - 3} more` : '';
      toast(`Unsupported format: ${names}${more}. Supported: JPG, PNG, WebP, HEIC, RAW (CR2, NEF, ARW, DNG, etc.)`);
    }
    if (supported.length === 0) return;

    // Lock in the destination now so switching tabs mid-upload can't misfile photos
    const tab = currentTab;
    const section = tab === 'hero' ? 'hero' : sectionForTab(tab);
    const category = tab === 'hero' ? 'hero' : (tab === 'gallery' ? (currentFilter === 'All' ? 'Portrait' : currentFilter) : 'All');
    const list = imagesFor(tab);

    // Hold further drops while the admin decides, then upload only once they confirm
    uploading = true;
    const confirmed = await new Promise(resolve => {
      window.R59.confirmation.confirmUploadImages(
        supported.length,
        SECTION_LABELS[tab] || 'this section',
        () => resolve(true),
        () => resolve(false)
      );
    });
    if (!confirmed) {
      uploading = false;
      toast('Upload cancelled');
      return;
    }

    const failures = [];
    let added = 0;

    try {
      for (let i = 0; i < supported.length; i++) {
        const rawFile = supported[i];
        try {
          const webpFile = await convertForUpload(rawFile, `[${i + 1}/${supported.length}]`);
          setAddTileStatus(`Uploading ${webpFile.name} [${i + 1}/${supported.length}]...`);

          const label = webpFile.name.replace(/\.[^.]+$/, '');
          const saved = await api().uploadImageFile(webpFile, { section, category, title: label, altText: label });

          const orderVal = saved.order ?? saved.display_order ?? list.length;
          list.push({
            id: saved.id,
            src: safeImgSrc(saved.src || saved.url),
            key: saved.key,
            section,
            label,
            alt: label,
            cat: tab === 'hero' ? 'hero' : (tab === 'gallery' ? category : 'Portrait'),
            order: orderVal,
            display_order: orderVal
          });
          added++;
          // Show each photo as soon as it lands rather than waiting for the whole batch
          if (tab === currentTab) renderImages();
          setAddTileStatus(`Uploaded ${added}/${supported.length}...`);
        } catch (err) {
          console.error(`Failed to upload ${rawFile.name}:`, err);
          failures.push({ name: rawFile.name, message: describeError(err) });
        }
      }
    } finally {
      uploading = false;
      commitImages();
      renderImages();
    }

    if (failures.length === 0) {
      toast(`${added} photo${added === 1 ? '' : 's'} uploaded and live on the site`);
    } else {
      const first = failures[0];
      const summary = added > 0 ? `${added} uploaded, ${failures.length} failed. ` : '';
      toast(`${summary}${first.name}: ${first.message}`, 5000);
    }
  }

  function deletePhoto(idx) {
    const tab = currentTab;
    const list = imagesFor(tab);
    const item = list[idx];
    if (!item || item.busy) return;
    const label = item.label || 'image';

    window.R59.confirmation.confirmRemoveImage(label, async () => {
      item.busy = true;
      renderImages();
      try {
        if (item.id) await api().deleteImage(item.id);
        const at = list.indexOf(item);
        if (at !== -1) list.splice(at, 1);
        commitImages();
        toast('Image removed from the site');
      } catch (err) {
        console.error('Failed to delete image:', err);
        toast(`Could not remove image: ${describeError(err)}`, 4000);
      } finally {
        delete item.busy;
        renderImages();
      }
    });
  }

  function moveImage(idx, direction) {
    const list = imagesFor(currentTab);
    const j = idx + direction;
    if (j < 0 || j >= list.length) return;
    window.R59.confirmation.confirmReorderImages(list[idx]?.label, () => applyMove(list, idx, j));
  }

  async function applyMove(list, idx, j) {
    [list[idx], list[j]] = [list[j], list[idx]];
    list.forEach((img, order) => { img.display_order = order; });
    renderImages();

    try {
      await api().updateImageOrder(list.filter(img => img.id).map(img => ({ id: img.id, display_order: img.display_order })));
      commitImages();
    } catch (err) {
      // Put the cards back so the admin view matches what the site shows
      [list[idx], list[j]] = [list[j], list[idx]];
      list.forEach((img, order) => { img.display_order = order; });
      renderImages();
      toast(`Could not save new order: ${describeError(err)}`, 4000);
    }
  }

  /** Save caption/category edits shortly after typing stops, one request per photo. */
  function scheduleMetaSave(item) {
    if (!item.id) return;
    clearTimeout(metaSaveTimers.get(item.id));
    metaSaveTimers.set(item.id, setTimeout(async () => {
      metaSaveTimers.delete(item.id);
      try {
        await api().updateImage(item.id, {
          title: item.label || '',
          alt_text: item.alt || item.label || '',
          ...(item.section === 'gallery' ? { category: item.cat || 'Portrait' } : {})
        });
        commitImages();
      } catch (err) {
        toast(`Could not save photo details: ${describeError(err)}`, 4000);
      }
    }, META_SAVE_DELAY_MS));
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
          toast('Please enter a valid URL (starting with http:// or https://)');
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
          toast(`${platformLabel} link removed`);
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
        if (e.target.closest('#addTile')) {
          if (uploading) return;
          return ($('#photo-file-input') || $('#fileAdd'))?.click();
        }
        if (e.target.closest('.chip')) return;
        const card = e.target.closest('.img-card');
        if (!card) return;

        const idx = +card.dataset.idx;
        const act = e.target.closest('[data-act]')?.dataset.act;

        if (act === 'delete') {
          deletePhoto(idx);
        } else if (act === 'left' || act === 'right') {
          moveImage(idx, act === 'left' ? -1 : 1);
        } else if (act === 'replace' || e.target.tagName === 'IMG') {
          replaceTarget = idx;
          const cardInput = card.querySelector('input[data-replace]');
          if (cardInput) {
            cardInput.click();
          } else {
            $('#filePick')?.click();
          }
        }
      });

      grid.addEventListener('input', e => {
        const f = e.target.dataset.field;
        if (!f) return;
        const card = e.target.closest('.img-card');
        if (!card) return;
        const item = imagesFor(currentTab)[card.dataset.idx];
        if (!item) return;
        item[f] = e.target.value;
      });

      // Remember each field's saved value so a declined edit can be put back
      grid.addEventListener('focusin', e => {
        if (e.target.dataset?.field) e.target.dataset.savedValue = e.target.value;
      });

      grid.addEventListener('change', e => {
        const field = e.target.dataset?.field;
        if (!field) return;
        const card = e.target.closest('.img-card');
        const item = card && imagesFor(currentTab)[card.dataset.idx];
        if (!item) return;
        const input = e.target;
        const previous = input.dataset.savedValue ?? '';
        if (input.value === previous) return;

        window.R59.confirmation.confirmSavePhotoDetails(
          item.label || previous,
          () => {
            input.dataset.savedValue = input.value;
            scheduleMetaSave(item);
            if (field === 'cat' && currentFilter !== 'All') renderImages();
          },
          () => {
            item[field] = previous;
            input.value = previous;
          }
        );
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
        if (e.target.files && e.target.files[0]) {
          replaceAt(replaceTarget, e.target.files[0]);
        }
        e.target.value = '';
      };
    }

    grid?.addEventListener('change', e => {
      const t = e.target;
      if (!t.matches?.('input[data-replace]')) return;
      if (t.files && t.files[0]) {
        const targetIdx = t.dataset.idx !== undefined ? +t.dataset.idx : replaceTarget;
        replaceAt(targetIdx, t.files[0]);
      }
      t.value = '';
    });

    ['#fileAdd', '#photo-file-input', '#fileInput'].forEach(sel => {
      const input = $(sel);
      if (!input) return;
      input.onchange = e => {
        handleFiles(e.target.files);
        e.target.value = '';
      };
    });

    // Initialize profile card with default content if needed
    initProfileCard();

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
    setTabUI,
    initProfileCard,
    ensureImageBuckets,
    getCurrentTab,
    updateBioCount,
    renderSocial,
    renderImages,
    setImagesFromRecords,
    handleFiles,
    addFiles: handleFiles,
    deletePhoto,
    safeImgSrc,
    initPhotographyListeners
  };
  window.setTab = setTab;
  window.setTabUI = setTabUI;
  window.initProfileCard = initProfileCard;
  window.ensureImageBuckets = ensureImageBuckets;
  window.updateBioCount = updateBioCount;
  window.renderSocial = renderSocial;
  window.renderImages = renderImages;
  window.handleFiles = handleFiles;
})();
