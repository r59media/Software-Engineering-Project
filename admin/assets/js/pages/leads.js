// @ts-nocheck
/**
 * R59 Media Admin — Enquiries view (#view-leads)
 *
 * Lists contact-form enquiries (newest first, 50 per page, keyset "Load more") and deletes them.
 * Loads the first time the view opens (document 'r59:view' with detail.view === 'leads'), not at
 * startup. Delete is a record action: confirm, pessimistic DELETE, then remove the row locally.
 * Every piece of enquiry data is written with DOM APIs (textContent / a.href), never innerHTML.
 *
 * Public API: window.R59.leads = { initLeadsListeners, reset, load }
 */
(function () {
    'use strict';
    const PAGE_SIZE = 50;
    const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const $ = id => document.getElementById(id);
    const toast = (msg, opts) => window.toast && window.toast(msg, opts);
    const api = () => window.R59.apiClient;
    // status: 'idle' (never loaded / reset) | 'loading' | 'loaded' | 'failed'
    let state = freshState();
    let generation = 0; // bumps on reset so a response from before a re-login is dropped
    let listenersBound = false;
    function freshState() {
        return {
            status: 'idle',
            error: '',
            leads: [],
            hasMore: false,
            nextBeforeId: null,
            moreLoading: false,
            moreError: ''
        };
    }
    /* ---------- Small DOM helpers ---------- */
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className)
            node.className = className;
        if (text !== undefined && text !== null)
            node.textContent = text;
        return node;
    }
    function icon(id) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'ico');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', '#' + id);
        svg.appendChild(use);
        return svg;
    }
    function announce(msg) {
        const live = $('leadsStatus');
        if (live)
            live.textContent = msg;
    }
    /* ---------- Formatting ---------- */
    function str(v) {
        return v === undefined || v === null ? '' : String(v).trim();
    }
    /** created_at is stored as UTC "YYYY-MM-DD HH:MM:SS". Returns a Date or null. */
    function parseUtc(s) {
        const raw = str(s);
        if (!raw)
            return null;
        const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
        const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
        return Number.isNaN(d.getTime()) ? null : d;
    }
    function formatReceived(d) {
        return d.toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
        });
    }
    /** tel: href from a phone string, or '' when it doesn't have 7–15 digits. */
    function telHref(phone) {
        const digits = phone.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15)
            return '';
        return 'tel:' + (phone.startsWith('+') ? '+' : '') + digits;
    }
    /* ---------- Shared state markup (same classes as schedule.js) ---------- */
    function loadingNode(lines) {
        const frag = document.createDocumentFragment();
        const skel = el('div', 'skel');
        skel.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < lines; i++)
            skel.appendChild(el('i'));
        frag.appendChild(skel);
        frag.appendChild(el('p', 'sr-only', 'Loading…'));
        return frag;
    }
    function errorNode(what, message, onRetry) {
        const box = el('div', 'load-error');
        box.setAttribute('role', 'alert');
        box.appendChild(icon('i-alert'));
        const p = el('p');
        p.appendChild(el('strong', null, `Couldn't load ${what}.`));
        p.appendChild(document.createTextNode(' '));
        p.appendChild(el('span', null, message));
        box.appendChild(p);
        const retry = el('button', 'btn btn--sm', 'Retry');
        retry.type = 'button';
        retry.addEventListener('click', onRetry);
        box.appendChild(retry);
        return box;
    }
    function emptyNode() {
        const box = el('div', 'empty');
        const cam = document.createElementNS(SVG_NS, 'svg');
        cam.setAttribute('class', 'cam');
        cam.setAttribute('width', '110');
        cam.setAttribute('height', '96');
        cam.setAttribute('viewBox', '0 0 110 96');
        cam.setAttribute('aria-hidden', 'true');
        cam.setAttribute('focusable', 'false');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', '#logo-camera');
        cam.appendChild(use);
        box.appendChild(cam);
        box.appendChild(el('p', null, 'No enquiries yet.'));
        box.appendChild(el('small', null, 'Messages from the contact form on the site appear here.'));
        return box;
    }
    /* ---------- One enquiry ---------- */
    function displayName(lead) {
        return str(lead.name) || 'Unnamed sender';
    }
    function contactLine(label, value, href) {
        const item = el('div', 'enq-contact__item');
        item.appendChild(el('dt', 'caps', label));
        const dd = el('dd');
        if (href) {
            const a = el('a', null, value);
            a.href = href;
            dd.appendChild(a);
        }
        else {
            dd.textContent = value;
        }
        item.appendChild(dd);
        return item;
    }
    function leadNode(lead) {
        const name = displayName(lead);
        const li = el('li', 'enq');
        li.dataset.leadId = String(lead.id);
        const head = el('div', 'enq__head');
        const who = el('div', 'enq__who');
        const nameId = 'enq-name-' + String(lead.id).replace(/[^A-Za-z0-9_-]/g, '');
        const h4 = el('h4', 'enq__name', name);
        h4.id = nameId;
        who.appendChild(h4);
        const meta = el('p', 'enq__meta sub');
        const received = parseUtc(lead.created_at);
        if (received) {
            const t = el('time', null, formatReceived(received));
            t.dateTime = received.toISOString();
            meta.appendChild(document.createTextNode('Received '));
            meta.appendChild(t);
        }
        else {
            meta.textContent = 'Received date unknown';
        }
        who.appendChild(meta);
        head.appendChild(who);
        const session = str(lead.session_type);
        if (session)
            head.appendChild(el('span', 'tag', session));
        li.appendChild(head);
        const email = str(lead.email);
        const phone = str(lead.phone);
        if (email || phone) {
            const dl = el('dl', 'enq-contact');
            if (email) {
                dl.appendChild(contactLine('Email', email, EMAIL_RE.test(email) ? 'mailto:' + encodeURIComponent(email) : ''));
            }
            if (phone)
                dl.appendChild(contactLine('Phone', phone, telHref(phone)));
            li.appendChild(dl);
        }
        const message = str(lead.message);
        const msg = el('p', 'enq__msg' + (message ? '' : ' sub'), message || 'No message.');
        li.appendChild(msg);
        const acts = el('div', 'row__acts enq__acts');
        const del = el('button', 'btn btn--sm btn--danger', 'Delete');
        del.type = 'button';
        del.dataset.leadDelete = String(lead.id);
        del.setAttribute('aria-label', `Delete enquiry from ${name}`);
        acts.appendChild(del);
        li.appendChild(acts);
        li.setAttribute('aria-labelledby', nameId);
        return li;
    }
    /* ---------- Render ---------- */
    function renderMore() {
        const wrap = $('leadsMoreWrap');
        const btn = $('leadsMore');
        const errBox = $('leadsMoreError');
        if (!wrap || !btn || !errBox)
            return;
        const show = state.status === 'loaded' && state.hasMore;
        wrap.hidden = !show;
        btn.disabled = state.moreLoading;
        btn.setAttribute('aria-busy', state.moreLoading ? 'true' : 'false');
        btn.textContent = state.moreLoading ? 'Loading…' : 'Load more';
        btn.hidden = !!state.moreError;
        errBox.replaceChildren();
        if (state.moreError) {
            errBox.appendChild(errorNode('more enquiries', state.moreError, () => loadMore()));
        }
    }
    function render() {
        const list = $('leadsList');
        if (!list)
            return;
        list.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');
        if (state.status === 'loading' || state.status === 'idle') {
            list.replaceChildren(loadingNode(6));
        }
        else if (state.status === 'failed') {
            list.replaceChildren(errorNode('enquiries', state.error, () => load()));
        }
        else if (!state.leads.length && !state.hasMore) {
            list.replaceChildren(emptyNode());
        }
        else {
            const ul = el('ul', 'rows enq-list');
            ul.setAttribute('aria-labelledby', 'enq-title');
            state.leads.forEach(lead => ul.appendChild(leadNode(lead)));
            list.replaceChildren(ul);
        }
        renderMore();
    }
    /** Appends rows to the existing list without rebuilding it (keeps focus on Load more). */
    function appendRows(leads) {
        const ul = $('leadsList')?.querySelector('ul.enq-list');
        if (!ul) {
            render();
            return;
        }
        leads.forEach(lead => ul.appendChild(leadNode(lead)));
        renderMore();
    }
    /* ---------- Data ---------- */
    function readPage(res) {
        const leads = Array.isArray(res?.leads) ? res.leads : (Array.isArray(res?.data) ? res.data : []);
        const next = res?.next_before_id;
        return {
            leads: leads.filter(l => l && l.id !== undefined && l.id !== null),
            hasMore: !!res?.has_more,
            nextBeforeId: next === undefined || next === null || next === '' ? null : next
        };
    }
    function errorMessage(err) {
        return (err && err.message) || 'Something went wrong. Try again.';
    }
    /** Loads the first page (also the Retry action). */
    async function load() {
        const gen = generation;
        state = freshState();
        state.status = 'loading';
        render();
        try {
            const res = await api().get('/admin/leads', { limit: PAGE_SIZE });
            if (gen !== generation)
                return;
            const page = readPage(res);
            state.status = 'loaded';
            state.leads = page.leads;
            state.hasMore = page.hasMore && page.nextBeforeId !== null;
            state.nextBeforeId = page.nextBeforeId;
            render();
            announce(page.leads.length
                ? `${page.leads.length} ${page.leads.length === 1 ? 'enquiry' : 'enquiries'} loaded.`
                : 'No enquiries yet.');
        }
        catch (err) {
            if (gen !== generation)
                return;
            state.status = 'failed';
            state.error = errorMessage(err);
            render();
        }
    }
    /**
     * Keyset cursor for the next page: the id of the last enquiry still shown. The server's
     * next_before_id can point at a row deleted since, so it is used only as a fallback.
     */
    function cursorId() {
        const last = state.leads[state.leads.length - 1];
        return last ? last.id : state.nextBeforeId;
    }
    /** After deletes empty the list while older enquiries exist: fetch the first page again. */
    function refillIfEmpty() {
        if (state.leads.length || !state.hasMore)
            return false;
        load().then(() => { if (state.status === 'loaded')
            focusHeading(); });
        return true;
    }
    async function loadMore() {
        if (state.status !== 'loaded' || state.moreLoading || !state.hasMore || state.nextBeforeId === null)
            return;
        if (refillIfEmpty())
            return;
        const gen = generation;
        const hadError = !!state.moreError;
        state.moreLoading = true;
        state.moreError = '';
        renderMore();
        if (hadError)
            $('leadsMore')?.focus();
        try {
            const res = await api().get('/admin/leads', { limit: PAGE_SIZE, before_id: cursorId() });
            if (gen !== generation)
                return;
            const page = readPage(res);
            const known = new Set(state.leads.map(l => String(l.id)));
            const fresh = page.leads.filter(l => !known.has(String(l.id)));
            state.leads = state.leads.concat(fresh);
            state.hasMore = page.hasMore && page.nextBeforeId !== null;
            state.nextBeforeId = page.nextBeforeId;
            state.moreLoading = false;
            const firstNew = fresh.length ? String(fresh[0].id) : null;
            if (!state.leads.length && !state.hasMore)
                render();
            else
                appendRows(fresh);
            announce(fresh.length
                ? `${fresh.length} more ${fresh.length === 1 ? 'enquiry' : 'enquiries'} loaded.`
                : 'No more enquiries.');
            // The button disappears on the last page: move focus to the first new enquiry instead
            if (!state.hasMore && firstNew !== null) {
                focusDeleteFor(firstNew);
            }
        }
        catch (err) {
            if (gen !== generation)
                return;
            state.moreLoading = false;
            state.moreError = errorMessage(err);
            renderMore();
            $('leadsMoreError')?.querySelector('button')?.focus();
        }
    }
    function focusDeleteFor(id) {
        const btn = Array.from(document.querySelectorAll('#leadsList [data-lead-delete]'))
            .find(b => b.dataset.leadDelete === id);
        if (btn)
            btn.focus();
    }
    function focusHeading() {
        $('enq-title')?.focus();
    }
    /* ---------- Delete (record action) ---------- */
    function requestDelete(btn) {
        const id = btn.dataset.leadDelete;
        const lead = state.leads.find(l => String(l.id) === id);
        if (!lead)
            return;
        const name = displayName(lead);
        window.R59.confirmation.confirmRemoveLead(name, () => deleteLead(id, btn));
    }
    async function deleteLead(id, btn) {
        const gen = generation;
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        try {
            await api().delete('/admin/leads/' + encodeURIComponent(id));
            if (gen !== generation)
                return;
            // Work out where focus goes before the row disappears
            const li = btn.closest('li.enq');
            const nextLi = li?.nextElementSibling || li?.previousElementSibling || null;
            const nextId = nextLi?.dataset.leadId || null;
            const hadFocus = document.activeElement === btn || document.activeElement === document.body;
            state.leads = state.leads.filter(l => String(l.id) !== id);
            toast('Enquiry deleted.', { type: 'success' });
            if (refillIfEmpty())
                return;
            if (!state.leads.length) {
                render();
            }
            else if (li) {
                li.remove();
            }
            if (hadFocus) {
                if (nextId)
                    focusDeleteFor(nextId);
                else if (state.hasMore && $('leadsMore') && !$('leadsMore').hidden)
                    $('leadsMore').focus();
                else
                    focusHeading();
            }
        }
        catch (err) {
            if (gen !== generation)
                return;
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
            if (err && err.status === 404) {
                // Already gone on the server: reflect that locally
                state.leads = state.leads.filter(l => String(l.id) !== id);
                if (!refillIfEmpty()) {
                    render();
                    focusHeading();
                }
            }
            if (!err || err.status !== 401)
                toast(`Couldn't delete the enquiry. ${errorMessage(err)}`, { type: 'error' });
        }
    }
    /* ---------- Wiring ---------- */
    function onView(e) {
        if (!e || !e.detail || e.detail.view !== 'leads')
            return;
        if (state.status === 'idle')
            load();
    }
    function initLeadsListeners() {
        if (listenersBound)
            return;
        listenersBound = true;
        document.addEventListener('r59:view', onView);
        $('leadsMore')?.addEventListener('click', () => loadMore());
        $('leadsList')?.addEventListener('click', e => {
            const btn = e.target.closest('[data-lead-delete]');
            if (btn && !btn.disabled)
                requestDelete(btn);
        });
        // The view may already be open (e.g. restored before this module loaded)
        if ($('view-leads')?.classList.contains('active') && state.status === 'idle')
            load();
    }
    /** Clears the data so the next open reloads (after re-login). */
    function reset() {
        generation += 1;
        state = freshState();
        announce('');
        const list = $('leadsList');
        if (list) {
            list.replaceChildren();
            list.setAttribute('aria-busy', 'false');
        }
        renderMore();
    }
    window.R59 = window.R59 || {};
    window.R59.leads = { initLeadsListeners, reset, load };
})();
