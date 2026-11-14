// @ts-nocheck
/**
 * R59 Media Admin — Photo library & Site copy page module
 *
 * Site copy (#view-text): biography, contact info, location and social links (free-form rows:
 * any platform name + an https:// address). These are settings: edits update R59.state and go
 * live through "Review & save". Contact and location fields that have a saved value can't be emptied.
 *
 * Photo library (#view-images): photos are records. Upload, replace, remove, reorder and
 * caption/alt/category edits are written to the server right after their confirmation, and the
 * list only changes once the server answers with 2xx (build contract §7).
 */

(function () {
  'use strict';

  const { convertToWebP, isSupportedImageFile } = window.R59.webpConverter;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  const esc = s => {
    const fv = window.R59?.formValidation;
    if (fv?.escapeHtml) return fv.escapeHtml(s ?? '');
    return String(s ?? '').replace(/[&<>"'`]/g, c => ESC_MAP[c]);
  };
  const api = () => window.R59?.api?.photography || window.R59?.photographyApi;
  const st = () => window.R59.state;
  const toast = (msg, opts) => window.toast?.(msg, opts);
  const lc = s => String(s ?? '').trim().toLowerCase();
  const pad2 = n => String(n).padStart(2, '0');
  const isUnauthorized = err => err && err.status === 401;

  let currentTab = 'main';
  let currentFilter = 'All';
  let replaceTarget = null;
  let uploading = false;
  let reordering = false;

  const CATS = window.R59.state?.CATEGORIES || ['Portrait', 'Lifestyle', 'Events', 'Extras']; // public portfolio filters
  // Platforms the public footer has an icon for; other platforms are saved but get a note
  const PLATFORMS = window.R59.state?.PLATFORMS || ['Instagram', 'Threads', 'X', 'Facebook', 'Pinterest'];
  const PLATFORM_LC = PLATFORMS.map(lc);
  const SOCIAL_NOTE = "Saved, but the site footer doesn't show an icon for this platform yet.";

  const ACCEPT_HINT = 'JPG, PNG, HEIC, RAW → auto-converted to WebP';

  // Each admin tab maps to the section of the public site that displays its photos
  const TAB_TO_SECTION = { main: 'recent', gallery: 'gallery', about: 'about', hero: 'hero' };
  const SECTION_TO_TAB = { recent: 'main', gallery: 'gallery', about: 'about', hero: 'hero' };
  // How each tab's destination is named in confirmation dialogs
  const SECTION_LABELS = { main: 'Most Recent Photoshoot', gallery: 'the Portfolio gallery', about: 'About Me', hero: 'the Hero banner' };
  // "View on site" target per tab (design doc link map)
  const SITE_LINKS = { main: '/#recent-photoshoot', gallery: '/#portfolio', hero: '/#hero', about: '/#about' };

  function sectionForTab(tab) {
    return TAB_TO_SECTION[tab] || 'gallery';
  }

  function ensureImageBuckets(state = st().getState()) {
    state.images = state.images || {};
    ['main', 'gallery', 'about', 'hero'].forEach(k => {
      state.images[k] = Array.isArray(state.images[k]) ? state.images[k] : [];
    });
    return state.images;
  }

  function imagesFor(tab) {
    return ensureImageBuckets()[tab];
  }

  /** Photos are records: nothing goes into the settings baseline, only the overview preview refreshes. */
  function photosChanged() {
    window.R59.dashboard?.refreshOverview?.();
  }

  function describeError(err) {
    return (err && err.message) || 'Unknown error';
  }

  function imagesStatus() {
    return st().getLoadStatus ? st().getLoadStatus('images') : 'loaded';
  }

  function canEditImages() {
    return imagesStatus() === 'loaded';
  }

  const byDisplayOrder = (a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0) || (Number(a.id) || 0) - (Number(b.id) || 0);

  /* ======================================================================
     Site copy: profile fields + social links (settings)
     ====================================================================== */

  function profileStatus() {
    return st().getLoadStatus ? st().getLoadStatus('profile') : 'loaded';
  }

  /* ---------- Social link rows ---------- */

  const socialIds = id => ({
    platform: `social-platform-${id}`,
    url: `social-url-${id}`,
    note: `social-note-${id}`
  });

  function socialList() {
    const state = st().getState();
    if (!Array.isArray(state.social)) state.social = [];
    // every row needs a client-side id (review diff key, field ids)
    state.social.forEach(s => { if (s && !s._id) s._id = st().newSocialId(); });
    return state.social;
  }

  const findSocial = id => socialList().find(s => s && String(s._id) === String(id));
  const isBlankSocial = s => !String(s?.platform ?? '').trim() && !String(s?.url ?? '').trim();

  /** Loading = disabled, failed = read-only; row actions need a loaded profile. */
  function profileLock() {
    const status = profileStatus();
    return { disabled: status === 'loading', readOnly: status === 'failed', actionsOff: status !== 'loaded' };
  }

  function applyLock(lock, root) {
    const scope = root || document;
    scope.querySelectorAll('[data-social-field]').forEach(el => {
      el.disabled = lock.disabled;
      el.readOnly = lock.readOnly;
    });
    scope.querySelectorAll('[data-rm-social]').forEach(b => { b.disabled = lock.actionsOff; });
    const add = $('#socialAdd');
    if (add) add.disabled = lock.actionsOff;
  }

  function setDescribedBy(el, id, on) {
    const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).filter(x => x !== id);
    if (on) ids.push(id);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  }

  /** Note for a platform the footer has no icon for, plus the Remove button's accessible name. */
  function updateSocialRowMeta(li, platform) {
    const id = li.dataset.socialId;
    const ids = socialIds(id);
    const name = String(platform ?? '').trim();
    const showNote = name !== '' && !PLATFORM_LC.includes(lc(name));
    const note = document.getElementById(ids.note);
    if (note) note.hidden = !showNote;
    const input = document.getElementById(ids.platform);
    if (input) setDescribedBy(input, ids.note, showNote);
    const rm = li.querySelector('[data-rm-social]');
    if (rm) rm.setAttribute('aria-label', name ? `Remove the ${name} link` : 'Remove this link');
  }

  function socialRowHtml(entry) {
    const id = esc(entry._id);
    const ids = socialIds(id);
    const platform = String(entry.platform ?? '');
    const url = String(entry.url ?? '');
    return `
      <li class="social-row" data-social-id="${id}">
        <div class="field social-row__platform">
          <label class="field__label" for="${ids.platform}">Platform</label>
          <div class="field__control">
            <input class="field__input" id="${ids.platform}" type="text" maxlength="40" required autocomplete="off" data-social-field="platform" value="${esc(platform)}">
          </div>
        </div>
        <div class="field social-row__url">
          <label class="field__label" for="${ids.url}">Address</label>
          <div class="field__control">
            <input class="field__input" id="${ids.url}" type="url" inputmode="url" required autocomplete="off" data-social-field="url" value="${esc(url)}" aria-describedby="social-hint">
          </div>
        </div>
        <button class="btn btn--danger social-row__rm" type="button" data-rm-social="${id}">Remove</button>
        <p class="field__hint social-row__note" id="${ids.note}" hidden>${esc(SOCIAL_NOTE)}</p>
      </li>`;
  }

  /** Binds the row's rules and sets its note, lock state and accessible names. */
  function setUpSocialRow(li) {
    const fv = window.R59.formValidation;
    const entry = findSocial(li.dataset.socialId);
    const ids = socialIds(li.dataset.socialId);
    const platformEl = document.getElementById(ids.platform);
    const urlEl = document.getElementById(ids.url);
    if (fv?.bind) {
      fv.bind(platformEl, fv.rules.socialPlatform);
      fv.bind(urlEl, fv.rules.socialUrl);
    }
    updateSocialRowMeta(li, entry?.platform);
    applyLock(profileLock(), li);
  }

  function updateSocialEmpty() {
    const empty = $('#socialEmpty');
    if (empty) empty.hidden = socialList().length > 0;
  }

  /** Rebuild the rows from state.social (load, Discard, save). Errors already on screen stay on screen. */
  function renderSocial() {
    const list = $('#socialList');
    if (!list) return;
    const shownInvalid = $$('#socialList [aria-invalid="true"]').map(el => el.id);
    list.innerHTML = socialList().map(socialRowHtml).join('');
    $$('#socialList [data-social-id]').forEach(setUpSocialRow);
    const fv = window.R59.formValidation;
    shownInvalid.forEach(id => {
      const el = document.getElementById(id);
      if (el && fv?.validate) fv.validate(el);
    });
    updateSocialEmpty();
    applyLock(profileLock());
  }

  function addSocialRow() {
    if (profileStatus() !== 'loaded') return;
    const list = $('#socialList');
    if (!list) return;
    const entry = { _id: st().newSocialId(), platform: '', url: '' };
    socialList().push(entry);
    list.insertAdjacentHTML('beforeend', socialRowHtml(entry));
    const li = list.lastElementChild;
    if (li) setUpSocialRow(li);
    updateSocialEmpty();
    document.getElementById(socialIds(entry._id).platform)?.focus();
    st().markDirty();
  }

  function removeSocialRow(id) {
    if (profileStatus() !== 'loaded') return;
    const entry = findSocial(id);
    if (!entry) return;
    const label = String(entry.platform ?? '').trim();

    const doRemove = () => {
      const social = socialList();
      const at = social.indexOf(entry);
      if (at === -1) return;
      social.splice(at, 1);
      const li = $(`#socialList [data-social-id="${CSS.escape(String(id))}"]`);
      const next = li?.nextElementSibling || li?.previousElementSibling;
      li?.remove();
      updateSocialEmpty();
      const target = next ? next.querySelector('[data-social-field="platform"]') : $('#socialAdd');
      target?.focus();
      st().markDirty();
      if (label) toast(`${label} link removed. Save to take it off the site.`, { type: 'info' });
    };

    // A row with nothing typed in it has nothing to lose: remove it without asking
    if (isBlankSocial(entry)) doRemove();
    else window.R59.confirmation.confirmRemoveSocial(label || 'social', doRemove);
  }

  /* ---------- Contact and location: required once saved ---------- */

  // [selector, profile key, base rule]
  const KEEP_SAVED_FIELDS = [
    ['#email', 'email', 'email'],
    ['#phone', 'phone', 'phone'],
    ['#city', 'location', null],
    ['#travel', 'travel', null]
  ];

  /** A contact or location field with a saved value can't be emptied. Re-run when `saved` changes. */
  function applySavedRules() {
    const fv = window.R59.formValidation;
    if (!fv?.bindKeepSaved) return;
    const saved = st().getSaved?.().profile || {};
    KEEP_SAVED_FIELDS.forEach(([sel, key, rule]) => {
      fv.bindKeepSaved($(sel), rule ? fv.rules[rule] : null, saved[key]);
    });
  }

  /** After a profile save: drop blank social rows and re-check the required-once-saved fields. */
  function onProfileSaved() {
    const social = socialList();
    const kept = social.filter(s => !isBlankSocial(s));
    if (kept.length !== social.length) {
      social.splice(0, social.length, ...kept);
      renderSocial();
    }
    applySavedRules();
  }

  /* ---------- Site copy view ---------- */

  function profileControls() {
    return ['#bio', '#email', '#phone', '#city', '#travel'].map(s => $(s)).filter(Boolean);
  }

  function revalidateShownErrors(inputs) {
    const fv = window.R59.formValidation;
    if (!fv?.validate) return;
    inputs.forEach(el => {
      if (el && el.getAttribute('aria-invalid') === 'true') fv.validate(el);
    });
  }

  /** Load state for the Site copy view: loading = disabled, failed = read-only + Retry. */
  function renderProfile() {
    const status = profileStatus();
    const lock = profileLock();
    const controls = profileControls();
    controls.forEach(el => {
      el.disabled = lock.disabled;
      el.readOnly = lock.readOnly;
    });
    applyLock(lock);
    applySavedRules();

    const box = $('#profileStatus');
    if (box) {
      if (status === 'failed') {
        const message = st().getLoadError?.('profile') || 'Check your connection and try again.';
        box.innerHTML = `
          <div class="load-error" role="alert">
            <svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg>
            <p><strong>Couldn't load your site copy.</strong> <span>${esc(message)}</span> These fields are read-only until it loads.</p>
            <button class="btn btn--sm" type="button" data-retry="profile">Retry</button>
          </div>`;
      } else if (status === 'loading') {
        box.innerHTML = '<p class="sub" role="status">Loading your site copy…</p>';
      } else {
        box.innerHTML = '';
      }
    }

    if (status === 'loaded') revalidateShownErrors([...controls, ...$$('#socialList [data-social-field]')]);
  }

  function updateBioCount() {
    const len = (st().getState().bio || '').length;
    const el = $('#bioCount');
    if (el) el.textContent = `${len} / 1200`;
  }

  function initSiteCopyListeners() {
    const fv = window.R59.formValidation;
    if (fv?.bind && fv.rules?.bio) fv.bind($('#bio'), fv.rules.bio);
    applySavedRules(); // email, phone, city, travel (format rules + required once saved)

    // Text fields bound to profile keys (app.js renderAll fills them)
    $$('#view-text [data-bind]').forEach(el => {
      el.addEventListener('input', () => {
        st().getState()[el.dataset.bind] = el.value;
        if (el.id === 'bio') updateBioCount();
        st().markDirty();
      });
    });

    $('#socialAdd')?.addEventListener('click', addSocialRow);

    const list = $('#socialList');
    list?.addEventListener('input', e => {
      const input = e.target.closest?.('[data-social-field]');
      const li = input?.closest('[data-social-id]');
      if (!input || !li || input.readOnly || input.disabled) return;
      const entry = findSocial(li.dataset.socialId);
      if (!entry) return;
      const field = input.dataset.socialField;
      entry[field] = input.value;
      if (field === 'platform') updateSocialRowMeta(li, input.value);
      st().markDirty();
    });
    list?.addEventListener('click', e => {
      const b = e.target.closest?.('[data-rm-social]');
      if (!b || b.disabled) return;
      removeSocialRow(b.dataset.rmSocial);
    });
  }

  /* ======================================================================
     Photo library: records
     ====================================================================== */

  /** A record is shown on the site unless the server marks it inactive (rows without the field are active). */
  function isActiveRecord(p) {
    const v = p && p.is_active;
    return !(v === 0 || v === false || v === '0');
  }

  /** About shows one photo: the first ACTIVE record by display_order, id (lists are kept in that order). */
  function aboutSlotIndex(list) {
    return list.findIndex(it => it && it.active !== false);
  }

  function recordToItem(p) {
    const resolve = api()?.resolveApiUrl || (u => u);
    const secLower = lc(p.section);
    const catLower = lc(p.category);

    let tab;
    if (secLower === 'hero' || ((!p.section || secLower === 'gallery') && (catLower === 'hero' || p.is_featured === 1))) {
      tab = 'hero';
    } else {
      tab = SECTION_TO_TAB[secLower || 'gallery'] || 'gallery';
    }

    const key = p.media_key || '';
    const rawUrl = p.url || p.public_url || (key ? `/api/media/${String(key).replace(/^\/+/, '')}` : '');
    const order = p.order !== undefined && p.order !== null ? Number(p.order) : Number(p.display_order ?? 0);
    const active = isActiveRecord(p);
    return {
      tab,
      item: {
        id: p.id,
        src: resolve(rawUrl),
        key,
        media_key: key,
        section: tab === 'hero' ? 'hero' : (p.section || sectionForTab(tab)),
        title: p.title || '',
        label: p.title || p.alt_text || 'Photo',
        alt: p.alt_text || '',
        // F12: keep the stored category as-is (no silent "Portrait")
        cat: p.category ?? '',
        order,
        display_order: order,
        is_featured: Boolean(p.is_featured),
        is_active: active ? 1 : 0,
        active
      }
    };
  }

  /**
   * Turn backend portfolio records into the items each tab renders,
   * grouped by the site section they belong to.
   */
  function setImagesFromRecords(records) {
    const grouped = { main: [], gallery: [], about: [], hero: [] };
    (records || []).forEach(p => {
      const { tab, item } = recordToItem(p);
      grouped[tab].push(item);
    });
    Object.values(grouped).forEach(list => list.sort(byDisplayOrder));

    st().getState().images = grouped;
    photosChanged();
    renderImages();
  }

  /** Re-read the About section from the server after an upload or replace settles. */
  async function refreshAbout() {
    try {
      const records = await api().getGalleryImages({ section: 'about' });
      const about = records
        .map(recordToItem)
        .filter(({ tab }) => tab === 'about')
        .map(({ item }) => item)
        .sort(byDisplayOrder);
      ensureImageBuckets().about = about;
    } catch (err) {
      console.warn('[photography] Could not refresh the About photo:', err);
    }
    photosChanged();
    renderImages();
  }

  function safeImgSrc(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (trimmed.startsWith('//')) return ''; // protocol-relative: could point at another host
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

  /* ---------- Tabs, toolbar ---------- */

  function setTabUI() {
    const list = imagesFor(currentTab);
    const status = imagesStatus();
    const n = list.length;
    const photos = `${n} photo${n === 1 ? '' : 's'}`;

    const hintEl = $('#imgHint');
    if (hintEl) {
      let hint;
      if (status === 'loading') hint = 'Loading photos…';
      else if (status === 'failed') hint = '';
      else if (currentTab === 'about') {
        const shownOnSite = aboutSlotIndex(list) === -1 ? 0 : 1;
        const extra = n - shownOnSite;
        const extraNote = extra > 0 ? ` · ${extra} ${shownOnSite ? 'more ' : ''}not shown on site` : '';
        if (shownOnSite) hint = `One photo · shown in the About section${extraNote}`;
        else if (n) hint = `No About me photo shown on site${extraNote}`;
        else hint = 'No About me photo uploaded yet';
      } else {
        const hidden = list.filter(it => it.active === false).length;
        const counted = hidden ? `${photos} · ${n - hidden} shown on site, ${hidden} hidden` : photos;
        hint = {
          main: n ? `${counted} · “Most recent photoshoot” carousel on the home page` : 'No photos in the Most Recent carousel yet',
          gallery: n ? `${counted} · order = display order on site` : 'No gallery photos uploaded yet',
          hero: n ? `${counted} · Homepage hero slideshow background` : 'No hero photos uploaded yet'
        }[currentTab] || '';
      }
      hintEl.textContent = hint;
      hintEl.hidden = !hint;
    }

    const link = $('#imgSiteLink');
    if (link) link.setAttribute('href', SITE_LINKS[currentTab] || '/');

    const filters = $('#filters');
    if (filters) {
      const show = currentTab === 'gallery' && status === 'loaded';
      filters.hidden = !show;
      filters.innerHTML = show
        ? ['All', ...CATS].map(c => `<button class="chip" type="button" data-filter="${esc(c)}" aria-pressed="${c === currentFilter}">${esc(c)}</button>`).join('')
        : '';
    }

    const btnReopt = $('#btnReoptimizeGallery');
    if (btnReopt) {
      btnReopt.hidden = !(currentTab === 'gallery' && status === 'loaded');
    }

    const fileAdd = $('#fileAdd');
    if (fileAdd) fileAdd.multiple = currentTab !== 'about';
  }

  function setTab(tab) {
    if (!TAB_TO_SECTION[tab]) tab = 'main';
    currentTab = tab;
    currentFilter = 'All';
    $$('#photoTabs .tabbar__tab').forEach(t => {
      const on = t.dataset.tab === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    $('#photoPanel')?.setAttribute('aria-labelledby', `tab-${tab}`);
    renderImages();
  }

  function getCurrentTab() {
    return currentTab;
  }

  /* ---------- Markup ---------- */

  function edgeHtml(n, right) {
    return `<div class="edge caps" aria-hidden="true"><span><svg class="tri"><use href="#i-tri"/></svg>Frame ${pad2(n)}</span><span>${right || `${pad2(n)}A`}</span></div>`;
  }

  function categoryOptions(value) {
    const options = [...CATS];
    // F12: a non-standard stored category is shown as its own option instead of "Portrait"
    if (!CATS.includes(value)) options.push(value);
    return options.map(c => {
      const label = c === '' ? 'No category' : c;
      return `<option value="${esc(c)}" ${c === value ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('');
  }

  function fieldValue(it, field) {
    if (it.draft && field in it.draft) return it.draft[field];
    if (field === 'title') return it.title ?? '';
    if (field === 'alt') return it.alt ?? '';
    if (field === 'cat') return it.cat ?? '';
    return '';
  }

  function detailFieldsHtml(it, i, { withCategory }) {
    const base = `ph-${currentTab}-${i}`;
    const busy = it.busy || it.saving ? 'disabled' : '';
    return `
      <div class="fields photo__fields">
        <div class="field">
          <label class="field__label" for="${base}-title">Title</label>
          <div class="field__control"><input class="field__input" id="${base}-title" type="text" maxlength="200" data-field="title" value="${esc(fieldValue(it, 'title'))}" ${busy}></div>
        </div>
        <div class="field">
          <label class="field__label" for="${base}-alt">Alt text</label>
          <div class="field__control"><input class="field__input" id="${base}-alt" type="text" maxlength="500" data-field="alt" value="${esc(fieldValue(it, 'alt'))}" ${busy}></div>
        </div>
        ${withCategory ? `
        <div class="field">
          <label class="field__label" for="${base}-cat">Category</label>
          <div class="field__control"><select class="field__input" id="${base}-cat" data-field="cat" ${busy}>${categoryOptions(fieldValue(it, 'cat'))}</select></div>
        </div>` : ''}
      </div>`;
  }

  function busyNoteHtml(it) {
    if (it.busy) return '<span class="photo__busy caps" role="status">Uploading…</span>';
    if (it.saving) return '<span class="photo__busy caps" role="status">Saving…</span>';
    return '';
  }

  function photoSlotHtml(it, i, n, list) {
    const label = it.label || 'image';
    const isGallery = currentTab === 'gallery';
    const lock = it.busy || it.saving || uploading;
    const src = esc(safeImgSrc(it.src));
    const hidden = it.active === false;
    const toggleLabel = hidden ? `Show “${label}” on the site` : `Hide “${label}” from the site`;
    return `
      <div class="slot photo-slot" data-idx="${i}">
        ${edgeHtml(n, hidden ? `${pad2(n)}A · Hidden` : '')}
        <article class="frame photo${it.busy ? ' is-busy' : ''}${hidden ? ' is-hidden' : ''}" ${it.busy || it.saving ? 'aria-busy="true"' : ''}>
          <div class="photo__img">
            <button class="photo__pick" type="button" data-act="replace" aria-label="Replace “${esc(label)}”" ${lock ? 'disabled' : ''}>
              ${src ? `<img src="${src}" data-auth-src="${src}" alt="" loading="lazy" decoding="async">` : '<span class="photo__missing caps">No preview</span>'}
            </button>
            ${hidden ? '<span class="tag photo__hidden">Hidden from site</span>' : ''}
            ${busyNoteHtml(it)}
          </div>
          ${detailFieldsHtml(it, i, { withCategory: isGallery })}
          <div class="photo__acts">
            <div class="photo__move">
              <button class="btn btn--icon btn--sm btn--ghost" type="button" data-act="left" aria-label="Move “${esc(label)}” earlier" ${i === 0 || reordering || lock ? 'disabled' : ''}><svg class="ico" aria-hidden="true"><use href="#i-left"/></svg></button>
              <button class="btn btn--icon btn--sm btn--ghost" type="button" data-act="right" aria-label="Move “${esc(label)}” later" ${i === list.length - 1 || reordering || lock ? 'disabled' : ''}><svg class="ico" aria-hidden="true"><use href="#i-right"/></svg></button>
            </div>
            <div class="photo__btns">
              <button class="btn btn--sm" type="button" data-act="toggle" aria-label="${esc(toggleLabel)}" ${lock || !it.id ? 'disabled' : ''}>${it.toggling ? (hidden ? 'Showing…' : 'Hiding…') : (hidden ? 'Show on site' : 'Hide from site')}</button>
              <button class="btn btn--sm" type="button" data-act="replace" ${lock ? 'disabled' : ''}><svg class="ico" aria-hidden="true"><use href="#i-swap"/></svg>Replace</button>
              <button class="btn btn--sm btn--danger" type="button" data-act="delete" aria-label="Remove “${esc(label)}”" ${lock ? 'disabled' : ''}>Remove</button>
            </div>
          </div>
        </article>
      </div>`;
  }

  function addSlotHtml(n, plural) {
    return `
      <div class="slot">
        ${edgeHtml(n, 'Blank')}
        <div class="frame add-frame">
          <button class="add-tile" id="addTile" type="button" ${uploading ? 'disabled' : ''}>
            <svg class="ico" aria-hidden="true"><use href="#i-upload"/></svg>
            <strong>Add image${plural ? 's' : ''}</strong>
            <span class="sub">or drop files here</span>
            <small class="sub">${ACCEPT_HINT}</small>
          </button>
        </div>
      </div>`;
  }

  function skeletonHtml() {
    return [1, 2, 3].map(n => `
      <div class="slot" aria-hidden="true">
        ${edgeHtml(n)}
        <div class="frame photo photo--skel"><div class="photo__img"></div><div class="skel"><i></i><i></i><i></i></div></div>
      </div>`).join('');
  }

  function loadErrorHtml() {
    const message = st().getLoadError?.('images') || 'Check your connection and try again.';
    return `
      <div class="slot photo-slot--wide">
        ${edgeHtml(1)}
        <div class="frame">
          <div class="load-error" role="alert">
            <svg class="ico" aria-hidden="true"><use href="#i-alert"/></svg>
            <p><strong>Couldn't load the photo library.</strong> <span>${esc(message)}</span></p>
            <button class="btn btn--sm" type="button" data-retry="images">Retry</button>
          </div>
        </div>
      </div>`;
  }

  /**
   * About = one photo (F9): the first ACTIVE record by display_order, id is the one the site shows.
   * Every other About record (older extras and hidden ones) is listed as "Not shown on site".
   */
  function aboutHtml(list) {
    const at = aboutSlotIndex(list);
    const target = at === -1 ? null : list[at];
    const lock = uploading || (target && (target.busy || target.saving));
    const src = target ? esc(safeImgSrc(target.src)) : '';

    const print = target
      ? `<figure class="print" data-idx="${at}">
           <button class="photo__pick" type="button" data-act="replace" aria-label="Replace the About photo" ${lock ? 'disabled' : ''}>
             ${src ? `<img src="${src}" data-auth-src="${src}" alt="" loading="lazy" decoding="async">` : '<span class="photo__missing caps">No preview</span>'}
           </button>
           ${busyNoteHtml(target)}
           <figcaption class="caps"><span>Shown on site</span><span>1 / 1</span></figcaption>
         </figure>`
      : `<div class="print print--empty" data-drop="about">
           <div class="empty">
             <svg class="cam" width="110" height="96" viewBox="0 0 110 96" aria-hidden="true"><use href="#logo-camera"/></svg>
             <p>${list.length ? 'No About me photo shown on site' : 'No About me photo yet'}</p>
             <small>Until you add one, the site shows its built-in portrait.</small>
           </div>
         </div>`;

    const action = target
      ? `<button class="btn btn--sm" type="button" data-act="replace" data-idx="${at}" ${lock ? 'disabled' : ''}><svg class="ico" aria-hidden="true"><use href="#i-swap"/></svg>${target.busy ? 'Replacing…' : 'Replace photo'}</button>`
      : `<button class="btn btn--sm btn--primary" type="button" id="aboutAdd" data-act="add" ${uploading ? 'disabled' : ''}><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg>${uploading ? 'Uploading…' : 'Add photo'}</button>`;

    const main = `
      <div class="slot about-slot"${target ? ` data-idx="${at}"` : ''}>
        ${edgeHtml(1, target ? '<b>Live</b>&nbsp;01A' : '01A')}
        <article class="frame" id="card-about-photo" aria-labelledby="about-photo-h" ${target && (target.busy || target.saving) ? 'aria-busy="true"' : ''}>
          <div class="frame-head">
            <div>
              <h3 id="about-photo-h">About me photo</h3>
              <p class="hint">One photo, shown in the About section. The yellow and red cards around it are part of the site design.</p>
            </div>
          </div>
          <div class="about">
            <div class="about__photo" data-drop="about">
              ${print}
              <div class="photo-acts">
                <p class="sub">${target ? 'One photo · drop a file here to replace it' : `Drop a file here or add one · ${ACCEPT_HINT}`}</p>
                ${action}
              </div>
            </div>
            ${target ? `<div class="about__details" data-idx="${at}">${detailFieldsHtml(target, at, { withCategory: false })}</div>` : ''}
          </div>
        </article>
      </div>`;

    const extras = list.map((it, i) => ({ it, i })).filter(({ i }) => i !== at);
    const legacy = extras.length ? `
      <div class="slot">
        ${edgeHtml(2)}
        <article class="frame" aria-labelledby="about-extra-h">
          <div class="frame-head">
            <div>
              <h3 id="about-extra-h">Not shown on site</h3>
              <p class="hint">${target ? 'Older or hidden About photos. The site only shows the photo in frame 01.' : 'Older or hidden About photos. The site shows none of them.'}</p>
            </div>
          </div>
          <ul class="rows">
            ${extras.map(({ it, i }) => {
              const s = esc(safeImgSrc(it.src));
              return `
              <li class="row about-extra" data-idx="${i}">
                <div class="row__main">
                  <span class="about-extra__thumb">${s ? `<img src="${s}" data-auth-src="${s}" alt="" loading="lazy" decoding="async">` : ''}</span>
                  <strong>${esc(it.label || 'Photo')}</strong>
                </div>
                <div class="row__acts">
                  <span class="tag tag--muted">Not shown on site</span>
                  <button class="btn btn--sm btn--danger" type="button" data-act="delete" aria-label="Remove “${esc(it.label || 'photo')}”" ${it.busy || uploading ? 'disabled' : ''}>Remove</button>
                </div>
              </li>`;
            }).join('')}
          </ul>
        </article>
      </div>` : '';

    return main + legacy;
  }

  function hydrateAuthorizedImages(root) {
    if (!root) return;
    const apply = window.R59?.apiClient?.applyAuthorizedImageSrc;
    root.querySelectorAll('img[data-auth-src]').forEach(img => {
      const url = img.getAttribute('data-auth-src') || '';
      if (apply) {
        apply(img, url);
      } else if (url) {
        img.src = url;
      }
    });
  }

  function renderImages() {
    const grid = $('#imgGrid');
    if (!grid) return;

    setTabUI();

    const status = imagesStatus();
    const list = imagesFor(currentTab);
    grid.classList.toggle('is-about', currentTab === 'about');
    grid.classList.toggle('is-hero', currentTab === 'hero');
    grid.classList.toggle('has-extras', currentTab === 'about' && list.length > (aboutSlotIndex(list) === -1 ? 0 : 1));
    grid.setAttribute('aria-busy', String(status === 'loading'));

    if (status === 'failed') {
      grid.innerHTML = loadErrorHtml();
      photosChanged();
      return;
    }
    if (status === 'loading' && !list.length) {
      grid.innerHTML = skeletonHtml();
      return;
    }

    if (currentTab === 'about') {
      grid.innerHTML = aboutHtml(list);
      hydrateAuthorizedImages(grid);
      photosChanged();
      return;
    }

    const isGallery = currentTab === 'gallery';
    const shown = list
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => !isGallery || currentFilter === 'All' || lc(it.cat) === lc(currentFilter));

    const slots = shown.map(({ it, i }, k) => photoSlotHtml(it, i, k + 1, list)).join('');
    const empty = !shown.length && isGallery && currentFilter !== 'All' && list.length
      ? `<div class="slot photo-slot--wide">${edgeHtml(1)}<div class="frame"><div class="empty"><svg class="cam" width="110" height="96" viewBox="0 0 110 96" aria-hidden="true"><use href="#logo-camera"/></svg><p>No ${esc(currentFilter)} photos</p><small>Add one below or choose another category.</small></div></div></div>`
      : '';
    grid.innerHTML = slots + empty + addSlotHtml(shown.length + (empty ? 2 : 1), currentTab !== 'about');
    hydrateAuthorizedImages(grid);

    photosChanged();
  }

  function setAddTileStatus(message) {
    const addTile = $('#addTile') || $('#aboutAdd');
    if (!addTile) return;
    addTile.disabled = true;
    addTile.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-upload"/></svg><strong>${esc(message)}</strong>`;
  }

  /* ---------- Writes (pessimistic, contract §7) ---------- */

  async function convertForUpload(file, progressLabel) {
    const rawExt = (file.name.split('.').pop() || '').toUpperCase();
    const message = `Converting ${file.name} (${rawExt} → WebP)${progressLabel ? ` ${progressLabel}` : ''}...`;
    setAddTileStatus(message);
    toast(message, { type: 'info' });
    const { file: webpFile } = await convertToWebP(file, { quality: 0.92, maxDimension: 2560 });
    return webpFile;
  }

  function replaceAt(idx, file) {
    if (!canEditImages()) return;
    if (!file || !isSupportedImageFile(file)) {
      toast('Unsupported file format. Please upload JPG, PNG, WebP, HEIC, or RAW.', { type: 'error' });
      return;
    }
    const tab = currentTab;
    const item = imagesFor(tab)[idx];
    if (!item || item.busy || item.saving) return;
    if (uploading) {
      toast('Please wait for the current upload to finish.', { type: 'info' });
      return;
    }
    if (!item.id) {
      toast('This photo has not finished saving yet. Try again in a moment.', { type: 'info' });
      return;
    }

    window.R59.confirmation.confirmReplaceImage(item.label, file.name, async () => {
      item.busy = true;
      uploading = true;
      renderImages();
      try {
        const webpFile = await convertForUpload(file);
        setAddTileStatus(`Uploading ${webpFile.name}...`);
        const updated = await api().replaceImageFile(item.id, webpFile);
        item.src = safeImgSrc(updated.src || updated.url) || item.src;
        item.key = updated.key || item.key;
        item.media_key = item.key;
        toast('Image replaced (auto-converted to WebP)', { type: 'success' });
      } catch (err) {
        console.error('Failed to replace image:', err);
        if (!isUnauthorized(err)) toast(`Couldn't replace the image. ${describeError(err)}`, { type: 'error' });
      } finally {
        delete item.busy;
        uploading = false;
        if (tab === 'about') {
          await refreshAbout();
        } else {
          photosChanged();
          renderImages();
        }
      }
    });
  }

  async function handleFiles(files) {
    if (!canEditImages()) return;
    let allFiles = Array.from(files || []);
    if (!allFiles.length) return;
    if (uploading) {
      toast('Please wait for the current upload to finish.', { type: 'info' });
      return;
    }

    // Lock in the destination now so switching tabs mid-upload can't misfile photos
    const tab = currentTab;

    // About holds one photo: with a photo already there, a new file replaces it
    if (tab === 'about') {
      const at = aboutSlotIndex(imagesFor('about'));
      if (at !== -1) {
        replaceAt(at, allFiles[0]);
        return;
      }
      if (allFiles.length > 1) {
        toast('The About section shows one photo, so only the first file is used.', { type: 'info' });
        allFiles = allFiles.slice(0, 1);
      }
    }

    const supported = allFiles.filter(f => isSupportedImageFile(f));
    const unsupported = allFiles.filter(f => !isSupportedImageFile(f));

    if (unsupported.length > 0) {
      const names = unsupported.map(f => f.name).slice(0, 3).join(', ');
      const more = unsupported.length > 3 ? ` and ${unsupported.length - 3} more` : '';
      toast(`Unsupported format: ${names}${more}. Supported: JPG, PNG, WebP, HEIC, RAW (CR2, NEF, ARW, DNG, etc.)`, { type: 'error' });
    }
    if (supported.length === 0) return;

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
      toast('Upload cancelled', { type: 'info' });
      return;
    }
    renderImages();

    const failures = [];
    let added = 0;

    try {
      for (let i = 0; i < supported.length; i++) {
        const rawFile = supported[i];
        const progress = supported.length > 1 ? `[${i + 1}/${supported.length}]` : '';
        try {
          const webpFile = await convertForUpload(rawFile, progress);
          setAddTileStatus(`Uploading ${webpFile.name} ${progress}...`);

          const label = webpFile.name.replace(/\.[^.]+$/, '');
          const saved = await api().uploadImageFile(webpFile, { section, category, title: label, altText: label });
          if (saved?.id === undefined || saved?.id === null) {
            throw new Error('The server did not return the new photo id.');
          }

          const orderVal = Number(saved.order ?? saved.display_order ?? list.length);
          list.push({
            id: saved.id,
            src: safeImgSrc(saved.src || saved.url),
            key: saved.key,
            media_key: saved.key,
            section,
            title: label,
            label,
            alt: label,
            cat: category,
            order: orderVal,
            display_order: orderVal,
            is_active: 1,
            active: true
          });
          added++;
          // Show each photo as soon as it lands rather than waiting for the whole batch
          if (tab === currentTab) renderImages();
          setAddTileStatus(`Uploaded ${added}/${supported.length}...`);
        } catch (err) {
          console.error(`Failed to upload ${rawFile.name}:`, err);
          failures.push({ name: rawFile.name, message: describeError(err), unauthorized: isUnauthorized(err) });
          if (isUnauthorized(err)) break;
        }
      }
    } finally {
      uploading = false;
      if (tab === 'about') {
        await refreshAbout();
      } else {
        photosChanged();
        renderImages();
      }
    }

    if (failures.length === 0) {
      toast(`${added} photo${added === 1 ? '' : 's'} uploaded and live on the site`, { type: 'success' });
    } else if (!failures.some(f => f.unauthorized)) {
      const first = failures[0];
      const summary = added > 0 ? `${added} uploaded, ${failures.length} failed. ` : '';
      toast(`${summary}${first.name}: ${first.message}`, { type: 'error' });
    }
  }

  function deletePhoto(idx) {
    if (!canEditImages()) return;
    const tab = currentTab;
    const list = imagesFor(tab);
    const item = list[idx];
    if (!item || item.busy || item.saving || !item.id) return;
    const label = item.label || 'image';

    window.R59.confirmation.confirmRemoveImage(label, async () => {
      item.busy = true;
      renderImages();
      try {
        await api().deleteImage(item.id);
        const at = list.indexOf(item);
        if (at !== -1) list.splice(at, 1);
        toast('Photo removed from this section', { type: 'success' });
      } catch (err) {
        console.error('Failed to delete image:', err);
        if (!isUnauthorized(err)) toast(`Couldn't remove the image. ${describeError(err)}`, { type: 'error' });
      } finally {
        delete item.busy;
        photosChanged();
        renderImages();
      }
    });
  }

  /**
   * Hide a photo from the site or show it again (record action: confirm, then a pessimistic
   * PUT /portfolio/:id { is_active }). Not on the About tab. Never marks the settings dirty.
   */
  function togglePhoto(idx) {
    if (!canEditImages() || currentTab === 'about' || uploading || reordering) return;
    const tab = currentTab;
    const list = imagesFor(tab);
    const item = list[idx];
    if (!item || item.busy || item.saving || !item.id) return;
    const label = item.label || 'Photo';
    const willShow = item.active === false;
    const lastShown = !willShow && !list.some(it => it !== item && it.active !== false);

    const run = async () => {
      if (item.busy || item.saving) return;
      item.saving = true;
      item.toggling = true;
      renderImages();
      try {
        await api().setImageActive(item.id, willShow);
        item.active = willShow;
        item.is_active = willShow ? 1 : 0;
        toast(willShow ? 'Photo shown on the site.' : 'Photo hidden from the site.', { type: 'success' });
      } catch (err) {
        console.error('Failed to change photo visibility:', err);
        if (!isUnauthorized(err)) {
          toast(`Couldn't ${willShow ? 'show' : 'hide'} the photo. ${describeError(err)}`, { type: 'error' });
        }
      } finally {
        delete item.saving;
        delete item.toggling;
        photosChanged();
        renderImages();
      }
    };

    const confirmation = window.R59.confirmation;
    if (lastShown) confirmation.confirmHideLastPhoto(SECTION_LABELS[tab] || 'this section', run);
    else confirmation.confirmTogglePhoto(label, willShow, run);
  }

  function moveImage(idx, direction) {
    if (!canEditImages() || currentTab === 'about' || reordering) return; // About has one photo: no reorder
    const list = imagesFor(currentTab);
    const j = idx + direction;
    if (j < 0 || j >= list.length) return;
    window.R59.confirmation.confirmReorderImages(list[idx]?.label, () => applyMove(list, idx, j));
  }

  /** Sends the new order first; the list only changes after the server accepts it. */
  async function applyMove(list, idx, j) {
    const next = list.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    const mappings = next.map((img, order) => ({ id: img.id, display_order: order })).filter(m => m.id);

    reordering = true;
    renderImages();
    try {
      await api().updateImageOrder(mappings);
      next.forEach((img, order) => { img.display_order = order; img.order = order; });
      list.splice(0, list.length, ...next);
      toast('Photo order saved', { type: 'success' });
    } catch (err) {
      if (!isUnauthorized(err)) toast(`Couldn't save the new order. ${describeError(err)}`, { type: 'error' });
    } finally {
      reordering = false;
      photosChanged();
      renderImages();
    }
  }

  // F12: only the edited field is sent, so a title or alt edit never rewrites the category
  const DETAIL_PAYLOAD = {
    title: v => ({ title: v }),
    alt: v => ({ alt_text: v }),
    cat: v => ({ category: v })
  };

  async function savePhotoDetail(item, field, value, input) {
    item.saving = true;
    input.disabled = true;
    try {
      const payload = DETAIL_PAYLOAD[field](value);
      // As before the redesign: a photo with no alt text uses its title as alt text
      const fillAlt = field === 'title' && !String(item.alt || '').trim() && String(value || '').trim();
      if (fillAlt) payload.alt_text = value;
      await api().updateImage(item.id, payload);
      if (fillAlt) item.alt = value;
      if (field === 'title') {
        item.title = value;
        item.label = value || item.alt || 'Photo';
      } else {
        item[field] = value;
      }
      if (item.draft) delete item.draft[field];
      toast('Photo details saved', { type: 'success' });
    } catch (err) {
      if (item.draft) delete item.draft[field];
      if (!isUnauthorized(err)) toast(`Couldn't save the photo details. ${describeError(err)}`, { type: 'error' });
    } finally {
      delete item.saving;
      renderImages();
    }
  }

  function itemFromEvent(target) {
    const holder = target.closest('[data-idx]');
    if (!holder) return null;
    const idx = Number(holder.dataset.idx);
    return { idx, item: imagesFor(currentTab)[idx] };
  }

  function pickReplacement(idx) {
    if (!canEditImages() || uploading) return;
    replaceTarget = idx;
    const pick = $('#filePick');
    if (pick) pick.click();
  }

  function initPhotoListeners() {
    // Tabs (roving tabindex) with ArrowLeft / ArrowRight / Home / End
    const goTo = tab => (window.R59.navigation?.go || window.go)?.('images', { tab });
    const tabEls = $$('#photoTabs [role="tab"]');
    tabEls.forEach((t, index) => {
      t.addEventListener('click', () => goTo(t.dataset.tab));
      t.addEventListener('keydown', e => {
        let nextIndex = null;
        if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabEls.length;
        else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabEls.length) % tabEls.length;
        else if (e.key === 'Home') nextIndex = 0;
        else if (e.key === 'End') nextIndex = tabEls.length - 1;
        if (nextIndex === null) return;
        e.preventDefault();
        const nextTab = tabEls[nextIndex];
        nextTab.focus();
        goTo(nextTab.dataset.tab);
      });
    });

    $('#filters')?.addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (!c) return;
      currentFilter = c.dataset.filter;
      renderImages();
    });

    let reoptimizing = false;
    $('#btnReoptimizeGallery')?.addEventListener('click', async () => {
      if (reoptimizing || uploading) return;
      const btn = $('#btnReoptimizeGallery');
      const span = btn?.querySelector('span');
      const originalText = span ? span.textContent : 'Re-optimize Gallery Media';

      reoptimizing = true;
      if (btn) btn.disabled = true;

      try {
        toast('Starting gallery media re-optimization...', { type: 'info' });
        const res = await api().reoptimizeGalleryMedia(progress => {
          if (span && progress && progress.status) {
            span.textContent = progress.status;
          }
        });
        toast(`Re-optimization complete: ${res.optimized} photos optimized, ${res.failed} skipped.`, { type: 'success' });
        await window.R59.app?.reloadArea?.('images');
      } catch (err) {
        console.error('Re-optimization failed:', err);
        toast(`Re-optimization failed: ${err.message}`, { type: 'error' });
      } finally {
        reoptimizing = false;
        if (btn) btn.disabled = false;
        if (span) span.textContent = originalText;
      }
    });

    const grid = $('#imgGrid');
    if (grid) {
      grid.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn || btn.disabled || btn.hasAttribute('data-retry')) return;

        if (btn.id === 'addTile' || btn.dataset.act === 'add') {
          if (uploading || !canEditImages()) return;
          $('#fileAdd')?.click();
          return;
        }

        const act = btn.dataset.act;
        const hit = itemFromEvent(btn);
        if (!act || !hit) return;

        if (act === 'delete') deletePhoto(hit.idx);
        else if (act === 'left' || act === 'right') moveImage(hit.idx, act === 'left' ? -1 : 1);
        else if (act === 'replace') pickReplacement(hit.idx);
        else if (act === 'toggle') togglePhoto(hit.idx);
      });

      // Keep what the admin is typing if the grid re-renders (e.g. an upload lands)
      grid.addEventListener('input', e => {
        const field = e.target.dataset?.field;
        if (!field) return;
        const hit = itemFromEvent(e.target);
        if (!hit?.item) return;
        hit.item.draft = { ...(hit.item.draft || {}), [field]: e.target.value };
      });

      grid.addEventListener('change', e => {
        const input = e.target;
        const field = input.dataset?.field;
        if (!field || !DETAIL_PAYLOAD[field]) return;
        const hit = itemFromEvent(input);
        const item = hit?.item;
        if (!item || !item.id) return;
        const previous = field === 'title' ? (item.title ?? '') : (item[field] ?? '');
        const value = field === 'cat' ? input.value : input.value.trim();
        if (value === previous) {
          if (item.draft) delete item.draft[field];
          return;
        }

        window.R59.confirmation.confirmSavePhotoDetails(
          item.label || previous,
          () => savePhotoDetail(item, field, value, input),
          () => {
            if (item.draft) delete item.draft[field];
            input.value = previous;
          }
        );
      });

      // Drag and drop: onto a photo replaces it, onto the add tile (or empty About) uploads
      const dropTarget = e => e.target.closest('.photo-slot, .add-frame, [data-drop="about"]');

      grid.addEventListener('dragover', e => {
        const t = dropTarget(e);
        if (!t || !canEditImages()) return;
        e.preventDefault();
        $$('#imgGrid .drag').forEach(x => x !== t && x.classList.remove('drag'));
        t.classList.add('drag');
      });

      grid.addEventListener('dragleave', e => {
        const t = dropTarget(e);
        if (t && !t.contains(e.relatedTarget)) t.classList.remove('drag');
      });

      grid.addEventListener('drop', e => {
        const t = dropTarget(e);
        if (!t) return;
        e.preventDefault();
        t.classList.remove('drag');
        const files = e.dataTransfer?.files;
        if (!files || !files.length) return;
        if (t.matches('[data-drop="about"]') || t.classList.contains('add-frame')) {
          handleFiles(files);
        } else {
          replaceAt(Number(t.dataset.idx), files[0]);
        }
      });
    }

    const filePick = $('#filePick');
    filePick?.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file && replaceTarget !== null) replaceAt(replaceTarget, file);
      replaceTarget = null;
      e.target.value = '';
    });

    const fileAdd = $('#fileAdd');
    fileAdd?.addEventListener('change', e => {
      handleFiles(e.target.files);
      e.target.value = '';
    });
  }

  function initPhotographyListeners() {
    initSiteCopyListeners();
    initPhotoListeners();
    // Reflect whatever has loaded so far (app.js calls the render hooks again after each load)
    renderProfile();
    updateBioCount();
    renderSocial();
    renderImages();
  }

  // Global registry
  window.R59 = window.R59 || {};
  window.R59.photography = {
    setTab,
    setTabUI,
    ensureImageBuckets,
    getCurrentTab,
    updateBioCount,
    renderSocial,
    renderProfile,
    onProfileSaved,
    renderImages,
    setImagesFromRecords,
    refreshAbout,
    handleFiles,
    addFiles: handleFiles,
    replaceAt,
    deletePhoto,
    togglePhoto,
    safeImgSrc,
    initPhotographyListeners
  };
  window.setTab = setTab;
  window.setTabUI = setTabUI;
  window.ensureImageBuckets = ensureImageBuckets;
  window.updateBioCount = updateBioCount;
  window.renderSocial = renderSocial;
  window.renderImages = renderImages;
  window.handleFiles = handleFiles;
})();
