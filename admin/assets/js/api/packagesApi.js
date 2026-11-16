// @ts-nocheck
/**
 * R59 Media Admin — Packages (Services) API Service
 *
 * Integration layer for photography package management (Cloudflare Workers /services routes).
 *
 * Units: the backend stores prices in cents. Callers pass `price` in DOLLARS; pass
 * `priceInCents` instead when a value is already in cents. `getPackages()` returns the
 * raw services (price in cents); app.js converts them to dollars for state.
 *
 * Every call rejects on an HTTP or network failure; nothing is swallowed here.
 */
(function () {
    'use strict';
    function toCents(data) {
        if (data.priceInCents !== undefined) {
            return data.priceInCents === null || data.priceInCents === '' ? null : Math.round(Number(data.priceInCents) || 0);
        }
        if (data.price !== undefined) {
            if (data.price === null || data.price === '')
                return null;
            return Math.round((Number(data.price) || 0) * 100);
        }
        return undefined;
    }
    const activeFlag = v => (v ? 1 : 0);
    /** Number of outfits: '' or null means not set (sent as null). */
    const outfitsValue = v => (v === null || v === undefined || String(v).trim() === '' ? null : Number(v));
    function cleanAdditionalPeople(val) {
        if (val === undefined)
            return undefined;
        if (val === null || val === '')
            return null;
        if (typeof val === 'object')
            return val;
        if (typeof val === 'string') {
            try {
                return JSON.parse(val);
            }
            catch {
                const n = Number(val);
                if (Number.isInteger(n) && n >= 0)
                    return { includedPeople: n };
                return val;
            }
        }
        return val;
    }
    const packagesApi = {
        _rawPackagesById: new Map(),
        /**
         * GET /services?all=true (includes inactive packages for the admin) → raw services, price in cents,
         * with duration_minutes, outfits (null when not set) and full_day (true for an "Entire day" package).
         */
        async getPackages() {
            const data = await window.R59.apiClient.get('/services?all=true');
            const list = data?.services ?? data?.data;
            if (!Array.isArray(list))
                throw new Error('The server sent an unexpected package list.');
            packagesApi._rawPackagesById = new Map();
            list.forEach(s => {
                if (s && s.id !== undefined) {
                    packagesApi._rawPackagesById.set(String(s.id), s);
                }
            });
            return list;
        },
        getRawPackage(id) {
            return packagesApi._rawPackagesById?.get(String(id)) || null;
        },
        /**
         * POST /services. `data`: { name, description, price ($) | priceInCents, duration_minutes, outfits, full_day, is_active,
         *   best_for, photo_count, booking_mode, image_url, additional_people, display_order }.
         * Resolves with the server response ({ id, data: { id, name, description, price (cents), … } }).
         */
        async createPackage(data = {}) {
            const name = String(data.name ?? data.title ?? '').trim();
            const bookingModeRaw = data.booking_mode ?? data.bookingMode;
            const isInquiry = bookingModeRaw === 'inquiry';
            const rawDur = data.duration_minutes !== undefined ? data.duration_minutes : data.durationMinutes;
            const cents = toCents(data);
            const payload = {
                name,
                title: name,
                description: data.description || '',
                price: cents !== undefined ? cents : (isInquiry ? null : 0),
                duration_minutes: rawDur === null || rawDur === '' || rawDur === undefined ? null : Number(rawDur),
                outfits: outfitsValue(data.outfits),
                full_day: data.full_day === true || data.full_day === 1,
                is_active: data.is_active !== undefined
                    ? activeFlag(data.is_active)
                    : (data.isActive !== undefined ? activeFlag(data.isActive) : 1)
            };
            if (data.category !== undefined)
                payload.category = data.category;
            const bestFor = data.best_for ?? data.bestFor;
            if (bestFor !== undefined) {
                payload.best_for = bestFor ? String(bestFor).trim() : null;
                payload.bestFor = payload.best_for;
            }
            const photoCount = data.photo_count !== undefined ? data.photo_count : data.photoCount;
            if (photoCount !== undefined && photoCount !== null && photoCount !== '') {
                payload.photo_count = Math.max(0, Math.round(Number(photoCount)));
                payload.photoCount = payload.photo_count;
            }
            else if (photoCount === null || photoCount === '') {
                payload.photo_count = null;
                payload.photoCount = null;
            }
            const bookingMode = data.booking_mode ?? data.bookingMode;
            if (bookingMode !== undefined) {
                payload.booking_mode = bookingMode === 'inquiry' ? 'inquiry' : 'direct';
                payload.bookingMode = payload.booking_mode;
            }
            const imageUrl = data.image_url ?? data.imageUrl ?? data.image?.url;
            const imageAlt = data.image_alt ?? data.imageAlt ?? data.image?.alt;
            if (imageUrl !== undefined) {
                payload.image_url = imageUrl ? String(imageUrl).trim() : null;
                payload.imageUrl = payload.image_url;
                if (imageAlt !== undefined) {
                    payload.image_alt = imageAlt ? String(imageAlt).trim() : null;
                    payload.imageAlt = payload.image_alt;
                }
                if (payload.image_url) {
                    payload.image = { url: payload.image_url, alt: payload.image_alt || name };
                }
            }
            const rawAP = data.additional_people !== undefined ? data.additional_people : data.additionalPeople;
            if (rawAP !== undefined) {
                const ap = cleanAdditionalPeople(rawAP);
                payload.additional_people = ap ? (typeof ap === 'object' ? JSON.stringify(ap) : String(ap)) : null;
                payload.additionalPeople = ap;
            }
            const displayOrder = data.display_order ?? data.displayOrder;
            if (displayOrder !== undefined) {
                payload.display_order = Math.round(Number(displayOrder));
                payload.displayOrder = payload.display_order;
            }
            const res = await window.R59.apiClient.post('/services', payload);
            const resData = res?.data ?? res;
            if (resData && resData.id !== undefined) {
                packagesApi._rawPackagesById?.set(String(resData.id), resData);
            }
            return res;
        },
        /**
         * PUT /services/:id — partial: only the fields given are sent.
         * Settings save (app.js): { name, price ($), description } plus outfits, duration_minutes and
         * full_day when they changed. Availability toggle: { is_active }.
         */
        async updatePackage(id, data = {}) {
            const payload = {};
            const name = data.name ?? data.title;
            if (name !== undefined) {
                payload.name = name;
                payload.title = name;
            }
            if (data.description !== undefined)
                payload.description = data.description;
            const cents = toCents(data);
            if (cents !== undefined)
                payload.price = cents;
            const duration = data.duration_minutes !== undefined ? data.duration_minutes : data.durationMinutes;
            if (duration !== undefined) {
                payload.duration_minutes = duration === null || duration === '' ? null : Number(duration);
            }
            if (data.outfits !== undefined)
                payload.outfits = outfitsValue(data.outfits);
            if (data.full_day !== undefined)
                payload.full_day = data.full_day === true || data.full_day === 1;
            if (data.category !== undefined)
                payload.category = data.category;
            if (data.is_active !== undefined)
                payload.is_active = activeFlag(data.is_active);
            else if (data.isActive !== undefined)
                payload.is_active = activeFlag(data.isActive);
            const curPkg = window.R59?.state?.getState?.()?.packages?.find?.(p => String(p.id) === String(id));
            const bestFor = data.best_for !== undefined ? data.best_for : (data.bestFor !== undefined ? data.bestFor : (data.name !== undefined ? (curPkg?.best_for ?? curPkg?.bestFor) : undefined));
            if (bestFor !== undefined) {
                payload.best_for = bestFor ? String(bestFor).trim() : null;
                payload.bestFor = payload.best_for;
            }
            const photoCount = data.photo_count !== undefined ? data.photo_count : (data.photoCount !== undefined ? data.photoCount : (data.name !== undefined ? (curPkg?.photo_count ?? curPkg?.photoCount) : undefined));
            if (photoCount !== undefined) {
                if (photoCount === null || photoCount === '') {
                    payload.photo_count = null;
                    payload.photoCount = null;
                }
                else {
                    payload.photo_count = Math.max(0, Math.round(Number(photoCount)));
                    payload.photoCount = payload.photo_count;
                }
            }
            const bookingMode = data.booking_mode !== undefined ? data.booking_mode : (data.bookingMode !== undefined ? data.bookingMode : (data.name !== undefined ? (curPkg?.booking_mode ?? curPkg?.bookingMode) : undefined));
            if (bookingMode !== undefined) {
                payload.booking_mode = bookingMode === 'inquiry' ? 'inquiry' : 'direct';
                payload.bookingMode = payload.booking_mode;
            }
            const imageUrl = data.image_url !== undefined ? data.image_url : (data.imageUrl !== undefined ? data.imageUrl : (data.image?.url !== undefined ? data.image?.url : (data.name !== undefined ? (curPkg?.image_url ?? curPkg?.imageUrl ?? curPkg?.image?.url) : undefined)));
            const imageAlt = data.image_alt !== undefined ? data.image_alt : (data.imageAlt !== undefined ? data.imageAlt : (data.image?.alt !== undefined ? data.image?.alt : (data.name !== undefined ? (curPkg?.image_alt ?? curPkg?.imageAlt ?? curPkg?.image?.alt) : undefined)));
            if (imageUrl !== undefined) {
                payload.image_url = imageUrl ? String(imageUrl).trim() : null;
                payload.imageUrl = payload.image_url;
                if (imageAlt !== undefined) {
                    payload.image_alt = imageAlt ? String(imageAlt).trim() : null;
                    payload.imageAlt = payload.image_alt;
                }
                if (payload.image_url) {
                    payload.image = { url: payload.image_url, alt: payload.image_alt || name || curPkg?.name || '' };
                }
            }
            const rawAP = data.additional_people !== undefined ? data.additional_people : (data.additionalPeople !== undefined ? data.additionalPeople : (data.name !== undefined ? (curPkg?.additional_people ?? curPkg?.additionalPeople) : undefined));
            if (rawAP !== undefined) {
                const ap = cleanAdditionalPeople(rawAP);
                payload.additional_people = ap ? (typeof ap === 'object' ? JSON.stringify(ap) : String(ap)) : null;
                payload.additionalPeople = ap;
            }
            const displayOrder = data.display_order !== undefined ? data.display_order : (data.displayOrder !== undefined ? data.displayOrder : (data.name !== undefined ? (curPkg?.display_order ?? curPkg?.displayOrder) : undefined));
            if (displayOrder !== undefined) {
                payload.display_order = Math.round(Number(displayOrder));
                payload.displayOrder = payload.display_order;
            }
            const res = await window.R59.apiClient.put(`/services/${encodeURIComponent(id)}`, payload);
            const resData = res?.data ?? res;
            if (resData && resData.id !== undefined) {
                packagesApi._rawPackagesById?.set(String(resData.id), resData);
            }
            return res;
        },
        /**
         * PUT /api/services/order with body { ids: number[] }.
         * Reorders packages by display_order.
         */
        async reorder(ids) {
            const cleanIds = (Array.isArray(ids) ? ids : []).map(id => Number(id)).filter(n => Number.isFinite(n));
            return await window.R59.apiClient.put('/services/order', { ids: cleanIds });
        },
        /**
         * DELETE /services/:id. The server deletes the package, or deactivates it when bookings
         * or other records still point at it (it then answers 2xx with a "deactivated" message).
         */
        async deletePackage(id) {
            return await window.R59.apiClient.delete(`/services/${encodeURIComponent(id)}`);
        }
    };
    window.R59 = window.R59 || {};
    window.R59.packagesApi = packagesApi;
    window.R59.api = window.R59.api || {};
    window.R59.api.packages = packagesApi;
})();
