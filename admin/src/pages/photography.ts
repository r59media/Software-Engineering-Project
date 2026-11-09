/**
 * R59 Media Admin — Photography, Gallery & Business Profile Page Controller
 *
 * Manages photo gallery tabs, upload drop zone with automatic WebP conversion,
 * image reordering/replacement, biography, contact info, and social media links.
 *
 * Photo changes (add, replace, remove, reorder, captions) are saved to the
 * backend immediately, so the public site reflects them on its next load.
 */

import {
  convertToWebP as utilsConvertToWebP,
  isSupportedImageFile as utilsIsSupportedImageFile
} from '../utils/webpConverter';

const convertToWebP = (file: File, opts?: any) => {
  if (window.R59?.webpConverter?.convertToWebP) {
    return window.R59.webpConverter.convertToWebP(file, opts);
  }
  return utilsConvertToWebP(file, opts);
};

const isSupportedImageFile = (file: File | Blob | null | undefined): boolean => {
  if (window.R59?.webpConverter?.isSupportedImageFile) {
    return window.R59.webpConverter.isSupportedImageFile(file);
  }
  return utilsIsSupportedImageFile(file);
};

const $ = <T extends HTMLElement = HTMLElement>(s: string): T | null => document.querySelector<T>(s);
const $$ = <T extends HTMLElement = HTMLElement>(s: string): T[] => Array.from(document.querySelectorAll<T>(s));
const esc = (s: any): string => window.R59?.formValidation?.escapeHtml?.(s) || (s === null || s === undefined ? '' : String(s));
const api = () => window.R59?.api?.photography;
const toast = (msg: string, ms?: number) => window.toast?.(msg, ms);

export interface PhotoItem {
  id: string | number;
  src: string;
  key?: string;
  media_key?: string;
  section?: string;
  label?: string;
  alt?: string;
  cat?: string;
  order?: number;
  display_order?: number;
  is_featured?: boolean | number;
  slot?: string;
  busy?: boolean;
  [key: string]: any;
}

export interface SocialLink {
  platform: string;
  url: string;
}

export interface PhotographyProfile {
  bio: string;
  email: string;
  phone: string;
  location: string;
  travel: string | boolean;
  social: SocialLink[];
}

let currentTab = 'main';
let currentFilter = 'All';
let replaceTarget: number | null = null;
let uploading = false;

export const CATS: readonly string[] = ['Portrait', 'Lifestyle', 'Events', 'Extras']; // matches the public portfolio filters
export const PLATFORMS: readonly string[] = ['Instagram', 'TikTok', 'X', 'Threads', 'Facebook', 'YouTube', 'LinkedIn', 'Website'];

// Each admin tab maps to the section of the public site that displays its photos
export const TAB_TO_SECTION: Record<string, string> = { main: 'recent', gallery: 'gallery', about: 'about', hero: 'hero' };
export const SECTION_TO_TAB: Record<string, string> = { recent: 'main', gallery: 'gallery', about: 'about', hero: 'hero' };
// How each tab's destination is named in confirmation dialogs
export const SECTION_LABELS: Record<string, string> = {
  main: 'Most Recent Photoshoot',
  gallery: 'the Portfolio gallery',
  about: 'About Me',
  hero: 'the Hero banner'
};
export const META_SAVE_DELAY_MS = 600;
const metaSaveTimers = new Map<string | number, any>();

export function sectionForTab(tab: string): string {
  return TAB_TO_SECTION[tab] || 'gallery';
}

export function ensureImageBuckets(st = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any)): Record<string, PhotoItem[]> {
  st.images = st.images || {};
  st.images.main = Array.isArray(st.images.main) ? st.images.main : [];
  st.images.gallery = Array.isArray(st.images.gallery) ? st.images.gallery : [];
  st.images.about = Array.isArray(st.images.about) ? st.images.about : [];
  st.images.hero = Array.isArray(st.images.hero) ? st.images.hero : [];
  return st.images;
}

export function imagesFor(tab: string): PhotoItem[] {
  const images = ensureImageBuckets();
  images[tab] = images[tab] || [];
  return images[tab];
}

/**
 * Photo edits are already persisted, so copy them into the "saved" snapshot.
 * Without this, Discard would bring deleted photos back and the save bar
 * would claim there are unsaved changes.
 */
export function commitImages(): void {
  const state = window.R59?.state;
  if (!state) return;
  const current = state.getState ? state.getState() : ({} as any);
  if (!current.images) current.images = {};
  current.photos = current.images.gallery;
  const saved = state.getSaved ? state.getSaved() : ({} as any);
  if (saved) {
    saved.images = state.clone ? state.clone(current.images) : JSON.parse(JSON.stringify(current.images));
    saved.photos = saved.images.gallery;
  }
  window.R59?.dashboard?.refreshOverview?.();
}

export function describeError(err: any): string {
  return (err && err.message) || 'Unknown error';
}

export function setTabUI(): void {
  const list = imagesFor(currentTab);
  const hintEl = $('#imgHint');
  if (hintEl) {
    const hintMessages: Record<string, string> = {
      main: list.length ? `${list.length} photo(s) · “Most recent photoshoot” carousel on the home page` : 'No photos in the Most Recent carousel yet',
      gallery: list.length ? `${list.length} photo(s) · order = display order on site` : 'No gallery photos uploaded yet',
      hero: list.length ? `${list.length} photo(s) · Homepage hero slideshow background` : 'No hero photos uploaded yet',
      about: list.length ? `${list.length} photo(s) · Polaroid cards + banner` : 'No About me photos uploaded yet'
    };
    hintEl.textContent = hintMessages[currentTab] || '';
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

export const DEFAULT_PROFILE: PhotographyProfile = {
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

export function initProfileCard(): void {
  const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
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

  const bioEl = $('#bio') as HTMLTextAreaElement | null;
  if (bioEl && !bioEl.value) bioEl.value = currentState.bio;
  const emailEl = $('#email') as HTMLInputElement | null;
  if (emailEl && !emailEl.value) emailEl.value = currentState.email;
  const phoneEl = $('#phone') as HTMLInputElement | null;
  if (phoneEl && !phoneEl.value) phoneEl.value = currentState.phone;
  const locEl = ($('#city') || $('#location')) as HTMLInputElement | null;
  if (locEl && !locEl.value) locEl.value = currentState.location;
  const travelEl = $('#travel') as HTMLInputElement | null;
  if (travelEl && !travelEl.value) travelEl.value = currentState.travel;

  updateBioCount();
  renderSocial();
}

export function setTab(tab: string): void {
  currentTab = tab;
  currentFilter = 'All';
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
  setTabUI();
  if (tab === 'about') {
    initProfileCard();
  }
  renderImages();
}

export function getCurrentTab(): string {
  return currentTab;
}

/**
 * Turn backend portfolio records into the card items each tab renders,
 * grouped by the site section they belong to.
 */
export function setImagesFromRecords(records: any[]): void {
  const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
  const st = currentState;
  const grouped: Record<string, PhotoItem[]> = { main: [], gallery: [], about: [], hero: [] };
  const resolve = api()?.resolveApiUrl || ((u: string) => u);

  (records || []).forEach((p: any) => {
    let tab: string;
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
      cat: p.category && (CATS as readonly string[]).includes(p.category) ? p.category : (tab === 'hero' ? 'hero' : 'Portrait'),
      order,
      display_order: order,
      is_featured: Boolean(p.is_featured)
    });
  });

  Object.values(grouped).forEach(list => list.sort((a, b) => (a.order ?? a.display_order ?? 0) - (b.order ?? b.display_order ?? 0) || Number(a.id) - Number(b.id)));

  st.images = grouped;
  commitImages();
  renderImages();
}

export function updateBioCount(): void {
  const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
  const len = (currentState.bio || '').length;
  const el = $('#bioCount');
  if (el) el.textContent = `${len} / 1200`;
}

export function renderSocial(): void {
  const container = $('#socialList');
  if (!container) return;

  const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
  const social: SocialLink[] = currentState.social || [];

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

export function safeImgSrc(url: string | null | undefined): string {
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

export function renderImages(): void {
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

  window.R59?.dashboard?.refreshOverview?.();
}

export function setAddTileStatus(message: string): void {
  const addTile = $('#addTile') as HTMLButtonElement | null;
  if (!addTile) return;
  addTile.classList.add('loading');
  addTile.disabled = true;
  addTile.innerHTML = `<span><b>⟳</b> ${esc(message)}</span>`;
}

export async function convertForUpload(file: File, progressLabel?: string): Promise<File> {
  const rawExt = (file.name.split('.').pop() || '').toUpperCase();
  const message = `Converting ${file.name} (${rawExt} → WebP)${progressLabel ? ` ${progressLabel}` : ''}...`;
  setAddTileStatus(message);
  toast(message);
  const { file: webpFile } = await convertToWebP(file, { quality: 0.92, maxDimension: 2560 });
  return webpFile;
}

export async function replaceAt(idx: number, file: File): Promise<void> {
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

  const onConfirm = async () => {
    item.busy = true;
    renderImages();
    try {
      const webpFile = await convertForUpload(file);
      setAddTileStatus(`Uploading ${webpFile.name}...`);
      const updated = await api()?.replaceImageFile(item.id, webpFile);
      if (updated) {
        item.src = safeImgSrc(updated.src || updated.url) || item.src;
        item.key = updated.key || item.key;
      }
      commitImages();
      toast('Image replaced (auto-converted to WebP)');
    } catch (err) {
      console.error('Failed to replace image:', err);
      toast(`Could not replace image: ${describeError(err)}`, 4000);
    } finally {
      delete item.busy;
      renderImages();
    }
  };

  if (window.R59?.confirmation?.confirmReplaceImage) {
    window.R59.confirmation.confirmReplaceImage(item.label, file.name, onConfirm);
  } else {
    onConfirm();
  }
}

export async function handleFiles(files: FileList | File[] | null | undefined): Promise<void> {
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
  const confirmed = await new Promise<boolean>(resolve => {
    if (window.R59?.confirmation?.confirmUploadImages) {
      window.R59.confirmation.confirmUploadImages(
        supported.length,
        SECTION_LABELS[tab] || 'this section',
        () => resolve(true),
        () => resolve(false)
      );
    } else {
      resolve(true);
    }
  });
  if (!confirmed) {
    uploading = false;
    toast('Upload cancelled');
    return;
  }

  const failures: { name: string; message: string }[] = [];
  let added = 0;

  try {
    for (let i = 0; i < supported.length; i++) {
      const rawFile = supported[i];
      try {
        const webpFile = await convertForUpload(rawFile, `[${i + 1}/${supported.length}]`);
        setAddTileStatus(`Uploading ${webpFile.name} [${i + 1}/${supported.length}]...`);

        const label = webpFile.name.replace(/\.[^.]+$/, '');
        const saved = await api()?.uploadImageFile(webpFile, { section, category, title: label, altText: label });

        if (saved) {
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
        }
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

export function deletePhoto(idx: number): void {
  const tab = currentTab;
  const list = imagesFor(tab);
  const item = list[idx];
  if (!item || item.busy) return;
  const label = item.label || 'image';

  const onConfirm = async () => {
    item.busy = true;
    renderImages();
    try {
      if (item.id && api()?.deleteImage) await api()!.deleteImage(item.id);
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
  };

  if (window.R59?.confirmation?.confirmRemoveImage) {
    window.R59.confirmation.confirmRemoveImage(label, onConfirm);
  } else {
    onConfirm();
  }
}

export function moveImage(idx: number, direction: number): void {
  const list = imagesFor(currentTab);
  const j = idx + direction;
  if (j < 0 || j >= list.length) return;
  if (window.R59?.confirmation?.confirmReorderImages) {
    window.R59.confirmation.confirmReorderImages(list[idx]?.label, () => applyMove(list, idx, j));
  } else {
    applyMove(list, idx, j);
  }
}

export async function applyMove(list: PhotoItem[], idx: number, j: number): Promise<void> {
  [list[idx], list[j]] = [list[j], list[idx]];
  list.forEach((img, order) => { img.display_order = order; });
  renderImages();

  try {
    if (api()?.updateImageOrder) {
      await api()!.updateImageOrder(list.filter(img => img.id).map(img => ({ id: img.id, display_order: img.display_order })));
    }
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
export function scheduleMetaSave(item: PhotoItem): void {
  if (!item.id) return;
  clearTimeout(metaSaveTimers.get(item.id));
  metaSaveTimers.set(item.id, setTimeout(async () => {
    metaSaveTimers.delete(item.id);
    try {
      if (api()?.updateImage) {
        await api()!.updateImage(item.id, {
          title: item.label || '',
          alt_text: item.alt || item.label || '',
          ...(item.section === 'gallery' ? { category: item.cat || 'Portrait' } : {})
        });
      }
      commitImages();
    } catch (err) {
      toast(`Could not save photo details: ${describeError(err)}`, 4000);
    }
  }, META_SAVE_DELAY_MS));
}

export function initPhotographyListeners(): void {
  // Tabs & ArrowLeft / ArrowRight keyboard navigation
  const tabEls = $$('.tabs [role="tab"]');
  tabEls.forEach((t, index) => {
    t.onclick = () => window.go?.('images', { tab: t.dataset.tab });
    t.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const nextIndex = e.key === 'ArrowRight'
          ? (index + 1) % tabEls.length
          : (index - 1 + tabEls.length) % tabEls.length;
        const nextTab = tabEls[nextIndex];
        nextTab.focus();
        window.go?.('images', { tab: nextTab.dataset.tab });
      }
    });
  });

  // Social list listeners
  const socialList = $('#socialList');
  if (socialList) {
    socialList.addEventListener('input', (e: Event) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement | null;
      if (!t || t.dataset.s === undefined || !t.dataset.k) return;
      const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
      const sIdx = Number(t.dataset.s);
      if (currentState.social && currentState.social[sIdx]) {
        currentState.social[sIdx][t.dataset.k] = t.value;
        window.R59?.state?.markDirty?.();
      }
    });

    socialList.addEventListener('change', (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      if (!t || t.dataset.s === undefined || t.dataset.k !== 'url') return;
      const val = t.value.trim();
      if (val && !window.R59?.formValidation?.isValidUrl?.(val)) {
        toast('Please enter a valid URL (starting with http:// or https://)');
      }
    });

    socialList.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const b = target?.closest<HTMLElement>('[data-rm]');
      if (!b || b.dataset.rm === undefined) return;
      const idx = +b.dataset.rm;
      const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
      const item = currentState.social?.[idx];
      const platformLabel = item?.platform || 'social link';

      const onConfirm = () => {
        currentState.social.splice(idx, 1);
        renderSocial();
        window.R59?.state?.markDirty?.();
        toast(`${platformLabel} link removed`);
      };

      if (window.R59?.confirmation?.confirmRemoveSocial) {
        window.R59.confirmation.confirmRemoveSocial(platformLabel, onConfirm);
      } else {
        onConfirm();
      }
    });
  }

  $('#addSocial')?.addEventListener('click', () => {
    const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
    currentState.social = currentState.social || [];
    const used = currentState.social.map((s: SocialLink) => s.platform);
    currentState.social.push({
      platform: PLATFORMS.find(p => !used.includes(p)) || 'Website',
      url: ''
    });
    renderSocial();
    window.R59?.state?.markDirty?.();
    const lastInput = $$<HTMLInputElement>('#socialList input[type=url]').pop();
    if (lastInput) lastInput.focus();
  });

  // Image grid actions
  const grid = $('#imgGrid');
  if (grid) {
    grid.addEventListener('click', (e: MouseEvent) => {
      const rawTarget = e.target as HTMLElement | null;
      if (!rawTarget) return;

      if (rawTarget.closest('#addTile')) {
        if (uploading) return;
        return ($('#photo-file-input') || $('#fileAdd'))?.click();
      }
      if (rawTarget.closest('.chip')) return;
      const card = rawTarget.closest<HTMLElement>('.img-card');
      if (!card || !card.dataset.idx) return;

      const idx = +card.dataset.idx;
      const act = rawTarget.closest<HTMLElement>('[data-act]')?.dataset.act;

      if (act === 'delete') {
        deletePhoto(idx);
      } else if (act === 'left' || act === 'right') {
        moveImage(idx, act === 'left' ? -1 : 1);
      } else if (act === 'replace' || rawTarget.tagName === 'IMG') {
        replaceTarget = idx;
        const cardInput = card.querySelector<HTMLInputElement>('input[data-replace]');
        if (cardInput) {
          cardInput.click();
        } else {
          $('#filePick')?.click();
        }
      }
    });

    grid.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement | null;
      if (!target) return;
      const f = target.dataset.field;
      if (!f) return;
      const card = target.closest<HTMLElement>('.img-card');
      if (!card || !card.dataset.idx) return;
      const item = imagesFor(currentTab)[+card.dataset.idx];
      if (!item) return;
      item[f] = target.value;
    });

    // Remember each field's saved value so a declined edit can be put back
    grid.addEventListener('focusin', (e: FocusEvent) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement | null;
      if (target?.dataset?.field) {
        target.dataset.savedValue = target.value;
      }
    });

    grid.addEventListener('change', (e: Event) => {
      const input = e.target as HTMLInputElement | HTMLSelectElement | null;
      if (!input) return;
      const field = input.dataset?.field;
      if (!field) return;
      const card = input.closest<HTMLElement>('.img-card');
      if (!card || !card.dataset.idx) return;
      const item = imagesFor(currentTab)[+card.dataset.idx];
      if (!item) return;
      const previous = input.dataset.savedValue ?? '';
      if (input.value === previous) return;

      const onConfirm = () => {
        input.dataset.savedValue = input.value;
        scheduleMetaSave(item);
        if (field === 'cat' && currentFilter !== 'All') renderImages();
      };

      const onCancel = () => {
        item[field] = previous;
        input.value = previous;
      };

      if (window.R59?.confirmation?.confirmSavePhotoDetails) {
        window.R59.confirmation.confirmSavePhotoDetails(
          item.label || previous,
          onConfirm,
          onCancel
        );
      } else {
        onConfirm();
      }
    });

    // Drag and drop
    grid.addEventListener('dragover', (e: DragEvent) => {
      const rawTarget = e.target as HTMLElement | null;
      const t = rawTarget?.closest<HTMLElement>('.img-card, .add-tile');
      if (!t) return;
      e.preventDefault();
      $$('.drag').forEach(x => x !== t && x.classList.remove('drag'));
      t.classList.add('drag');
    });

    grid.addEventListener('dragleave', (e: DragEvent) => {
      const rawTarget = e.target as HTMLElement | null;
      const t = rawTarget?.closest<HTMLElement>('.img-card, .add-tile');
      if (t && !t.contains(e.relatedTarget as Node | null)) t.classList.remove('drag');
    });

    grid.addEventListener('drop', (e: DragEvent) => {
      const rawTarget = e.target as HTMLElement | null;
      const t = rawTarget?.closest<HTMLElement>('.img-card, .add-tile');
      if (!t) return;
      e.preventDefault();
      t.classList.remove('drag');
      if (t.classList.contains('add-tile')) {
        if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
      } else if (t.dataset.idx !== undefined) {
        if (e.dataTransfer?.files?.[0]) replaceAt(+t.dataset.idx, e.dataTransfer.files[0]);
      }
    });
  }

  $('#filters')?.addEventListener('click', (e: MouseEvent) => {
    const rawTarget = e.target as HTMLElement | null;
    const c = rawTarget?.closest<HTMLElement>('.chip');
    if (!c || !c.dataset.filter) return;
    currentFilter = c.dataset.filter;
    renderImages();
  });

  const filePick = $('#filePick') as HTMLInputElement | null;
  if (filePick) {
    filePick.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files[0] && replaceTarget !== null) {
        replaceAt(replaceTarget, target.files[0]);
      }
      target.value = '';
    };
  }

  grid?.addEventListener('change', (e: Event) => {
    const t = e.target as HTMLInputElement | null;
    if (!t || !t.matches?.('input[data-replace]')) return;
    if (t.files && t.files[0]) {
      const targetIdx = t.dataset.idx !== undefined ? +t.dataset.idx : (replaceTarget ?? 0);
      replaceAt(targetIdx, t.files[0]);
    }
    t.value = '';
  });

  ['#fileAdd', '#photo-file-input', '#fileInput'].forEach(sel => {
    const input = $(sel) as HTMLInputElement | null;
    if (!input) return;
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files) handleFiles(target.files);
      target.value = '';
    };
  });

  // Initialize profile card with default content if needed
  initProfileCard();

  // Text field data bindings
  $$<HTMLInputElement | HTMLTextAreaElement>('[data-bind]').forEach(el => {
    el.addEventListener('input', () => {
      const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
      const field = el.dataset.bind;
      if (field) {
        currentState[field] = el.value;
        if (el.id === 'bio') updateBioCount();
        window.R59?.state?.markDirty?.();
      }
    });
  });
}

export interface PhotographyController {
  setTab: typeof setTab;
  setTabUI: typeof setTabUI;
  initProfileCard: typeof initProfileCard;
  ensureImageBuckets: typeof ensureImageBuckets;
  getCurrentTab: typeof getCurrentTab;
  updateBioCount: typeof updateBioCount;
  renderSocial: typeof renderSocial;
  renderImages: typeof renderImages;
  setImagesFromRecords: typeof setImagesFromRecords;
  handleFiles: typeof handleFiles;
  addFiles: typeof handleFiles;
  deletePhoto: typeof deletePhoto;
  safeImgSrc: typeof safeImgSrc;
  initPhotographyListeners: typeof initPhotographyListeners;
}

export const photography: PhotographyController = {
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

declare global {
  interface Window {
    setTab?: typeof setTab;
    setTabUI?: typeof setTabUI;
    initProfileCard?: typeof initProfileCard;
    ensureImageBuckets?: typeof ensureImageBuckets;
    updateBioCount?: typeof updateBioCount;
    renderSocial?: typeof renderSocial;
    renderImages?: typeof renderImages;
    handleFiles?: typeof handleFiles;
    toast?: (message: string, duration?: number) => void;
  }
}

if (typeof window !== 'undefined') {
  window.R59 = window.R59 || {};
  window.R59.photography = photography;
  window.setTab = setTab;
  window.setTabUI = setTabUI;
  window.initProfileCard = initProfileCard;
  window.ensureImageBuckets = ensureImageBuckets;
  window.updateBioCount = updateBioCount;
  window.renderSocial = renderSocial;
  window.renderImages = renderImages;
  window.handleFiles = handleFiles;
}

export default photography;
