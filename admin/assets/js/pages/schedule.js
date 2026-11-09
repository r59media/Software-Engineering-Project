// @ts-nocheck
/**
 * R59 Media Admin — Schedule, Availability & Bookings Page Module
 *
 * Calendar Day/Week/Month views, weekly availability (a setting: edited in state, saved through
 * the unsaved bar), blocked dates and bookings (records: written to the server first, list
 * updated from the response), and the booking create/edit modals.
 */
(function () {
    'use strict';
    const $ = s => document.querySelector(s);
    const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const esc = s => (window.R59.formValidation?.escapeHtml
        ? window.R59.formValidation.escapeHtml(s ?? '')
        : String(s ?? '').replace(/[&<>"']/g, c => ESC_MAP[c]));
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const DAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const BASE_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
    const MONTH_EVENTS_SHOWN = 2;
    const AREA_LABELS = { bookings: 'bookings', availability: 'availability', blockedDates: 'blocked dates', profile: 'the profile', images: 'photos' };
    /* Today ring (contract §2) */
    const TODAY_RING = '<svg class="grease y" viewBox="0 0 40 36" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M22 3C9 2 3 10 4 19s10 14 20 13 13-8 12-16S27 2 14 6" stroke-width="3.2"/></svg>';
    const ICON = id => `<svg class="ico" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
    let currentCalView = 'month';
    let selectedDayDate = toISODate(new Date());
    let editingTimeframeDay = null;
    let editingTimeframeId = null;
    let editingBookingId = null;
    let nbEndAuto = true;
    let lastFocus = null;
    const st = () => window.R59.state;
    const statusOf = area => (st().getLoadStatus ? st().getLoadStatus(area) : 'loaded');
    const isLoaded = area => statusOf(area) === 'loaded';
    const toast = (msg, opts) => window.toast && window.toast(msg, opts);
    /* ---------- Date & time utilities ---------- */
    function toISODate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    function fromISODate(dateStr) {
        const [y, m, d] = String(dateStr).split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    }
    function startOfWeek(date) {
        const result = new Date(date);
        result.setHours(0, 0, 0, 0);
        result.setDate(result.getDate() - result.getDay());
        return result;
    }
    function endOfWeek(date) {
        const result = startOfWeek(date);
        result.setDate(result.getDate() + 6);
        return result;
    }
    const formatLongDate = date => date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const formatMonthYear = date => date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    function formatWeekRange(start, end) {
        const sameYear = start.getFullYear() === end.getFullYear();
        const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
        return sameYear
            ? `${startLabel} – ${endLabel}, ${end.getFullYear()}`
            : `${startLabel}, ${start.getFullYear()} – ${endLabel}`;
    }
    /** "09:00 AM" — timeframe labels and the day-view hour column (unchanged format). */
    function formatTime12h(time24) {
        if (!time24)
            return '';
        const [h, m] = time24.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
    }
    function to24(str) {
        if (!str)
            return '';
        const s = String(str).trim();
        const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (m12) {
            let h = parseInt(m12[1], 10);
            const ampm = m12[3].toUpperCase();
            if (ampm === 'PM' && h < 12)
                h += 12;
            if (ampm === 'AM' && h === 12)
                h = 0;
            return `${String(h).padStart(2, '0')}:${m12[2]}`;
        }
        const m24 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (m24)
            return `${String(parseInt(m24[1], 10)).padStart(2, '0')}:${m24[2]}`;
        return '';
    }
    /** "9:00 AM" — booking times, the same for loaded and newly created bookings. */
    function from24(t) {
        const t24 = to24(t);
        if (!t24)
            return String(t || '');
        const [h, m] = t24.split(':').map(Number);
        return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    }
    function addMinutes(time24, minutes) {
        const t = to24(time24);
        if (!t || !(minutes > 0))
            return '';
        const [h, m] = t.split(':').map(Number);
        const total = h * 60 + m + Math.round(minutes);
        if (total >= 24 * 60)
            return '';
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }
    function money(n) {
        const v = Number(n || 0);
        return '$' + v.toLocaleString('en-US', {
            minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
            maximumFractionDigits: 2
        });
    }
    const round2 = n => Math.round(n * 100) / 100;
    const fmtCents = c => st().formatCents(c);
    /** What is left on a booking, from R59.state.balanceOf: { label, value, text } for rows and summaries. */
    function dueOf(b) {
        const m = st().balanceOf(b);
        if (m.cancelled) {
            return m.refundOwedCents > 0
                ? { label: 'Refund owed', value: fmtCents(m.refundOwedCents), text: `Refund owed ${fmtCents(m.refundOwedCents)}` }
                : { label: 'Refund owed', value: 'Nothing paid', text: 'Nothing paid' };
        }
        if (m.overpaidCents > 0)
            return { label: 'Overpaid', value: fmtCents(m.overpaidCents), text: `Overpaid ${fmtCents(m.overpaidCents)}` };
        if (m.balanceCents > 0)
            return { label: 'Balance due', value: fmtCents(m.balanceCents), text: `Balance ${fmtCents(m.balanceCents)}` };
        return { label: 'Balance due', value: 'Paid in full', text: 'Paid in full' };
    }
    const startOf = b => to24(b.start_time || b.time);
    const bookingSortKey = b => (b.date || '') + ' ' + (startOf(b) || '00:00');
    function bookingTimeText(b) {
        const start = startOf(b);
        const end = to24(b.end_time);
        if (!start)
            return String(b.time || '');
        return end ? `${from24(start)} – ${from24(end)}` : from24(start);
    }
    function statusKey(b) {
        const raw = String(b.status || 'pending').toLowerCase();
        return ['confirmed', 'cancelled', 'pending'].includes(raw) ? raw : 'pending';
    }
    function statusTagHTML(b) {
        const key = statusKey(b);
        const cls = key === 'confirmed' ? 'tag bk-tag--confirmed' : 'tag tag--muted';
        return `<span class="${cls}">${esc(b.status || 'Pending')}</span>`;
    }
    function dateParts(dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        return {
            formatted: `${MONTH_NAMES[m - 1]} ${d}, ${y}`,
            label: `${MONTH_NAMES[m - 1].toUpperCase()} ${d}, ${y}`
        };
    }
    /* ---------- Shared state markup: loading, failed, empty ---------- */
    function loadingHTML(lines = 4) {
        return `<div class="skel" aria-hidden="true">${'<i></i>'.repeat(lines)}</div><p class="sr-only">Loading…</p>`;
    }
    function loadErrorHTML(area, label) {
        const what = label || AREA_LABELS[area] || area;
        const msg = st().getLoadError ? st().getLoadError(area) : '';
        return `<div class="load-error" role="alert">${ICON('i-alert')}<p><strong>Couldn't load ${esc(what)}.</strong> <span>${esc(msg)}</span></p><button class="btn btn--sm" type="button" data-retry="${esc(area)}">Retry</button></div>`;
    }
    function emptyHTML(title, small) {
        return `<div class="empty"><svg class="cam" width="110" height="96" viewBox="0 0 110 96" aria-hidden="true" focusable="false"><use href="#logo-camera"/></svg><p>${esc(title)}</p>${small ? `<small>${esc(small)}</small>` : ''}</div>`;
    }
    /** Returns markup for a non-loaded area, or '' when the area is loaded. */
    function areaStateHTML(area, lines) {
        const s = statusOf(area);
        if (s === 'failed')
            return loadErrorHTML(area);
        if (s !== 'loaded')
            return loadingHTML(lines);
        return '';
    }
    function indexBookingsByDate() {
        const map = new Map();
        st().getBookings().forEach(b => {
            if (!b || !b.date)
                return;
            if (!map.has(b.date))
                map.set(b.date, []);
            map.get(b.date).push(b);
        });
        map.forEach(list => list.sort((x, y) => bookingSortKey(x).localeCompare(bookingSortKey(y))));
        return map;
    }
    function indexBlocked() {
        const map = new Map();
        st().getBlockedDates().forEach(b => map.set(b.dateStr || b.date, b));
        return map;
    }
    /* ---------- Calendar (Day / Week / Month) ---------- */
    function renderCalendar() {
        const container = $('#calendarDisplay');
        const label = $('#calActiveRange');
        const prevBtn = $('#calPrev');
        const nextBtn = $('#calNext');
        if (!container)
            return;
        ['Day', 'Week', 'Month'].forEach(v => {
            const btn = document.getElementById(`calBtn${v}`);
            if (btn)
                btn.setAttribute('aria-pressed', String(currentCalView === v.toLowerCase()));
        });
        const selectedDate = fromISODate(selectedDayDate);
        const unit = currentCalView === 'month' ? 'month' : currentCalView === 'week' ? 'week' : 'day';
        prevBtn?.setAttribute('aria-label', `Previous ${unit}`);
        nextBtn?.setAttribute('aria-label', `Next ${unit}`);
        if (currentCalView === 'month') {
            if (label)
                label.textContent = formatMonthYear(selectedDate);
            container.innerHTML = buildMonthGridHTML(selectedDate.getFullYear(), selectedDate.getMonth(), {
                mode: 'schedule',
                selectedStr: selectedDayDate
            });
        }
        else if (currentCalView === 'week') {
            if (label)
                label.textContent = formatWeekRange(startOfWeek(selectedDate), endOfWeek(selectedDate));
            container.innerHTML = buildWeekHTML();
        }
        else {
            if (label)
                label.textContent = formatLongDate(selectedDate).toUpperCase();
            container.innerHTML = buildDayHTML();
        }
    }
    function calEventHTML(b, attr, { detailed = false } = {}) {
        const key = statusKey(b);
        const name = b.customer || 'Unknown Client';
        const pkg = b.package || st().NO_PACKAGE;
        const time = bookingTimeText(b);
        const aria = `${time}, ${name}, ${pkg}, ${b.status || 'Pending'}`;
        if (detailed) {
            return `<button type="button" class="cal-ev cal-ev--block${key === 'cancelled' ? ' is-cancelled' : ''}" ${attr} aria-label="${esc(aria)}">
          <span class="cal-ev__time num">${esc(time)}</span>
          <strong class="cal-ev__name">${esc(name)}</strong>
          <span class="cal-ev__pkg">${esc(pkg)}</span>
          ${statusTagHTML(b)}
        </button>`;
        }
        return `<button type="button" class="cal-ev${key === 'cancelled' ? ' is-cancelled' : ''}" ${attr} aria-label="${esc(aria)}" title="${esc(name)} (${esc(pkg)})"><span class="cal-ev__pip" aria-hidden="true"></span><span class="cal-ev__t"><span class="num">${esc(from24(startOf(b)) || time)}</span> ${esc(name)}</span></button>`;
    }
    /**
     * Month grid shared by the Schedule calendar and the Overview calendar.
     * opts.mode: 'schedule' (day numbers select a day; events open the Day view) or
     * 'overview' (events open the booking editor). opts.chipAction === 'edit' means 'overview'.
     */
    function buildMonthGridHTML(year, month, opts = {}) {
        const mode = opts.mode || (opts.chipAction === 'edit' ? 'overview' : 'schedule');
        const firstDayOffset = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayStr = toISODate(new Date());
        const byDate = isLoaded('bookings') ? indexBookingsByDate() : new Map();
        const blockedMap = isLoaded('blockedDates') ? indexBlocked() : new Map();
        let html = `<div class="cal cal--month" aria-label="${esc(MONTH_NAMES[month])} ${year}">`;
        DAYS_OF_WEEK.forEach(d => {
            html += `<div class="dow caps" aria-hidden="true">${d.slice(0, 1)}<span class="dow__rest">${d.slice(1)}</span></div>`;
        });
        for (let i = 0; i < firstDayOffset; i++)
            html += '<div class="day out" aria-hidden="true"></div>';
        for (let d = 1; d <= daysInMonth; d++) {
            const cellDate = new Date(year, month, d);
            const dateStr = toISODate(cellDate);
            const dayBookings = byDate.get(dateStr) || [];
            const blocked = blockedMap.get(dateStr);
            const isToday = dateStr === todayStr;
            const isSelected = mode === 'schedule' && dateStr === opts.selectedStr;
            const count = dayBookings.length;
            const cls = ['day'];
            if (isToday)
                cls.push('today');
            if (blocked)
                cls.push('is-blocked');
            if (isSelected)
                cls.push('is-selected');
            if (count)
                cls.push('has-bookings');
            const spoken = `${DAY_NAMES_LONG[cellDate.getDay()]}, ${formatLongDate(cellDate)}`
                + (isToday ? ' (today)' : '')
                + (count ? `, ${count} booking${count > 1 ? 's' : ''}` : '')
                + (blocked ? `, blocked: ${blocked.reason || 'Unavailable'}` : '');
            const num = mode === 'schedule'
                ? `<button type="button" class="day__n num" data-select-cal-date="${esc(dateStr)}" aria-pressed="${isSelected}" aria-label="${esc(spoken)}">${isToday ? TODAY_RING : ''}${d}</button>`
                : `<span class="day__n num">${isToday ? TODAY_RING : ''}${d}</span><span class="sr-only">${esc(spoken)}</span>`;
            const evAttr = b => (mode === 'overview'
                ? `data-open-booking="${esc(b.id)}"`
                : `data-select-day="${esc(b.date)}"`);
            const shown = dayBookings.slice(0, MONTH_EVENTS_SHOWN).map(b => calEventHTML(b, evAttr(b))).join('');
            const more = count > MONTH_EVENTS_SHOWN ? `<span class="cal-more">+${count - MONTH_EVENTS_SHOWN}<span class="cal-more__w"> more</span></span>` : '';
            const blockedTag = blocked ? `<span class="day__blocked caps" title="${esc(blocked.reason || 'Unavailable')}" aria-hidden="true">Blocked</span>` : '';
            html += `<div class="${cls.join(' ')}"${isToday ? ' aria-current="date"' : ''}>${num}${blockedTag}${shown || more ? `<div class="day__evs">${shown}${more}</div>` : ''}</div>`;
        }
        const tail = (7 - ((firstDayOffset + daysInMonth) % 7)) % 7;
        for (let i = 0; i < tail; i++)
            html += '<div class="day out" aria-hidden="true"></div>';
        html += '</div>';
        return html;
    }
    function buildWeekHTML() {
        const start = startOfWeek(fromISODate(selectedDayDate));
        const byDate = isLoaded('bookings') ? indexBookingsByDate() : new Map();
        const blockedMap = isLoaded('blockedDates') ? indexBlocked() : new Map();
        const todayStr = toISODate(new Date());
        let html = '<div class="week">';
        for (let i = 0; i < 7; i++) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);
            const dateStr = toISODate(date);
            const dayBookings = byDate.get(dateStr) || [];
            const blocked = blockedMap.get(dateStr);
            const isSelected = dateStr === selectedDayDate;
            const isToday = dateStr === todayStr;
            const cls = ['week__day'];
            if (blocked)
                cls.push('is-blocked');
            if (isSelected)
                cls.push('is-selected');
            const body = dayBookings.length
                ? `<ul class="week__list">${dayBookings.map(b => `<li>${calEventHTML(b, `data-select-day="${esc(b.date)}"`, { detailed: true })}</li>`).join('')}</ul>`
                : blocked
                    ? `<p class="week__none week__none--blocked">Blocked: ${esc(blocked.reason || 'Unavailable')}</p>`
                    : '<p class="week__none">No bookings</p>';
            html += `
        <section class="${cls.join(' ')}" aria-label="${esc(DAY_NAMES_LONG[date.getDay()])}, ${esc(formatLongDate(date))}">
          <button type="button" class="week__head" data-select-cal-date="${esc(dateStr)}" aria-pressed="${isSelected}"${isToday ? ' aria-current="date"' : ''}>
            <span class="caps">${DAYS_OF_WEEK[date.getDay()]}</span>
            <span class="week__n num">${isToday ? TODAY_RING : ''}${date.getDate()}</span>
            ${isToday ? '<span class="sr-only"> (today)</span>' : ''}
          </button>
          ${blocked && dayBookings.length ? `<p class="week__none week__none--blocked">Blocked: ${esc(blocked.reason || 'Unavailable')}</p>` : ''}
          ${body}
        </section>`;
        }
        html += '</div>';
        return html;
    }
    function buildDayHTML() {
        const byDate = isLoaded('bookings') ? indexBookingsByDate() : new Map();
        const blockedMap = isLoaded('blockedDates') ? indexBlocked() : new Map();
        const selected = fromISODate(selectedDayDate);
        const monthPrefix = selectedDayDate.slice(0, 7);
        // Quick jumps to the days with bookings in the month being viewed
        const datesWithBookings = [...byDate.keys()].filter(d => d.startsWith(monthPrefix)).sort();
        const chips = datesWithBookings.length ? `
      <div class="chips day-jumps" role="group" aria-label="Days with bookings in ${esc(formatMonthYear(selected))}">
        ${datesWithBookings.map(d => {
            const dt = fromISODate(d);
            return `<button type="button" class="chip" data-select-day="${esc(d)}" aria-pressed="${d === selectedDayDate}">${esc(dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}</button>`;
        }).join('')}
      </div>` : '';
        const dayBookings = byDate.get(selectedDayDate) || [];
        const blocked = blockedMap.get(selectedDayDate);
        const hours = new Set(BASE_HOURS);
        dayBookings.forEach(b => {
            const t = startOf(b);
            if (t)
                hours.add(parseInt(t.split(':')[0], 10));
        });
        const untimed = dayBookings.filter(b => !startOf(b));
        const rows = [...hours].sort((a, b) => a - b).map(h => {
            const time24 = `${String(h).padStart(2, '0')}:00`;
            const inHour = dayBookings.filter(b => {
                const t = startOf(b);
                return t && parseInt(t.split(':')[0], 10) === h;
            });
            if (!inHour.length) {
                return `<li class="tl-row"><span class="tl-time num">${formatTime12h(time24)}</span><div class="tl-body"><span class="sub">Available slot</span><span class="tag tag--muted">Open</span></div></li>`;
            }
            return `<li class="tl-row is-booked"><span class="tl-time num">${formatTime12h(time24)}</span><div class="tl-body tl-body--stack">${inHour.map(dayBookingHTML).join('')}</div></li>`;
        }).join('');
        const untimedRow = untimed.length
            ? `<li class="tl-row is-booked"><span class="tl-time">No time</span><div class="tl-body tl-body--stack">${untimed.map(dayBookingHTML).join('')}</div></li>`
            : '';
        const blockedBanner = blocked ? `
      <div class="day-blocked" role="note">${ICON('i-alert')}<p><strong>Date Blocked:</strong> ${esc(blocked.reason || 'Unavailable')} — No bookings allowed.</p></div>` : '';
        return `<div class="dayview">${chips}${blockedBanner}<ol class="timeline" aria-label="Appointments on ${esc(formatLongDate(selected))}">${rows}${untimedRow}</ol></div>`;
    }
    function dayBookingHTML(b) {
        const m = st().balanceOf(b);
        return `
      <div class="tl-booking${statusKey(b) === 'cancelled' ? ' is-cancelled' : ''}">
        <div class="tl-booking__main">
          <p class="tl-booking__title"><strong>${esc(b.customer || 'Unknown Client')}</strong> — ${esc(b.package || st().NO_PACKAGE)}</p>
          <p class="sub num">${esc(bookingTimeText(b))} · Total ${esc(fmtCents(m.totalCents))} · Paid ${esc(fmtCents(m.paidCents))} · ${esc(dueOf(b).text)}</p>
        </div>
        ${statusTagHTML(b)}
      </div>`;
    }
    function moveCalendar(delta) {
        const date = fromISODate(selectedDayDate);
        if (currentCalView === 'day') {
            date.setDate(date.getDate() + delta);
        }
        else if (currentCalView === 'week') {
            date.setDate(date.getDate() + (delta * 7));
        }
        else {
            const day = date.getDate();
            date.setDate(1);
            date.setMonth(date.getMonth() + delta);
            const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
            date.setDate(Math.min(day, lastDay));
        }
        selectedDayDate = toISODate(date);
        renderCalendar();
    }
    /* ---------- Booking availability (a setting: saved through the unsaved bar) ---------- */
    function nextTimeframeId() {
        let max = 0;
        st().getAvailability().forEach(d => (d.timeframes || []).forEach(tf => {
            const n = Number(tf.id);
            if (Number.isFinite(n) && n > max)
                max = n;
        }));
        return max + 1;
    }
    function timeframeFormHTML(item) {
        let currentRepeat = 'weekly';
        let currentStart = '';
        let currentEnd = '';
        if (editingTimeframeId !== null) {
            const tf = item.timeframes?.find(t => t.id === editingTimeframeId);
            if (tf) {
                currentStart = tf.start;
                currentEnd = tf.end;
                currentRepeat = tf.repeat || 'weekly';
            }
        }
        const title = `${editingTimeframeId !== null ? 'Edit Timeframe' : 'Add Timeframe'} for ${item.day}`;
        return `
      <div class="tf-form" role="group" aria-labelledby="tfFormTitle">
        <p class="tf-form__title" id="tfFormTitle">${esc(title)}</p>
        <div class="field-row">
          <div class="field">
            <label class="field__label" for="tfStart">Start Time</label>
            <div class="field__control"><input type="time" class="field__input" id="tfStart" value="${esc(currentStart)}" required aria-describedby="tfStart-error"></div>
            <p class="field__error" id="tfStart-error" hidden>${ICON('i-alert')}<span></span></p>
          </div>
          <div class="field">
            <label class="field__label" for="tfEnd">End Time</label>
            <div class="field__control"><input type="time" class="field__input" id="tfEnd" value="${esc(currentEnd)}" required aria-describedby="tfEnd-error"></div>
            <p class="field__error" id="tfEnd-error" hidden>${ICON('i-alert')}<span></span></p>
          </div>
        </div>
        <fieldset class="tf-repeat">
          <legend class="field__label">Repeat:</legend>
          <label class="radio"><input type="radio" name="tfRepeat" id="tfRepeatNone" value="none" ${currentRepeat === 'none' ? 'checked' : ''}><span>Does not repeat</span></label>
          <label class="radio"><input type="radio" name="tfRepeat" id="tfRepeatWeekly" value="weekly" ${currentRepeat === 'weekly' ? 'checked' : ''}><span>Repeat weekly</span></label>
        </fieldset>
        <div class="tf-form__acts">
          <button type="button" class="btn btn--primary btn--sm" data-save-timeframe-day="${esc(item.day)}">Save Timeframe</button>
          <button type="button" class="btn btn--sm" data-cancel-timeframe="true">Cancel</button>
        </div>
      </div>`;
    }
    function renderAvailability() {
        const container = $('#availabilityList');
        if (!container)
            return;
        const notReady = areaStateHTML('availability', 7);
        if (notReady) {
            editingTimeframeDay = null;
            editingTimeframeId = null;
            container.innerHTML = notReady;
            return;
        }
        const availability = st().getAvailability();
        container.innerHTML = `<ul class="avail">${availability.map(item => {
            const open = Boolean(item.available && item.timeframes && item.timeframes.length > 0);
            const isEditingThisDay = editingTimeframeDay === item.day;
            const slots = open ? `
        <ul class="rows avail__slots">
          ${item.timeframes.map(tf => `
            <li class="row">
              <div class="row__main">
                <p><strong class="num">${esc(tf.label)}</strong> <span class="tag${tf.repeat === 'weekly' ? '' : ' tag--muted'}">${tf.repeat === 'weekly' ? 'Repeat weekly' : 'Does not repeat'}</span></p>
              </div>
              <div class="row__acts">
                <button type="button" class="btn btn--sm" data-edit-timeframe-day="${esc(item.day)}" data-edit-timeframe-id="${Number(tf.id)}" aria-label="Edit ${esc(tf.label)} on ${esc(item.day)}">${ICON('i-edit')}Edit</button>
                <button type="button" class="btn btn--sm btn--danger" data-remove-timeframe-day="${esc(item.day)}" data-remove-timeframe-id="${Number(tf.id)}" aria-label="Remove ${esc(tf.label)} on ${esc(item.day)}">Remove</button>
              </div>
            </li>`).join('')}
        </ul>` : '<p class="sub avail__none">Unavailable</p>';
            return `
        <li class="avail__day">
          <div class="avail__head">
            <p class="avail__title"><strong>${esc(item.day)}</strong> <span class="tag${open ? ' bk-tag--confirmed' : ' tag--muted'}">${open ? 'Available' : 'Unavailable'}</span></p>
            <button type="button" class="btn btn--sm" data-add-timeframe-day="${esc(item.day)}" aria-label="Add timeframe for ${esc(item.day)}">${ICON('i-plus')}Add Timeframe</button>
          </div>
          ${slots}
          ${isEditingThisDay ? timeframeFormHTML(item) : ''}
        </li>`;
        }).join('')}</ul>`;
        if (editingTimeframeDay)
            $('#tfStart')?.focus();
    }
    function showAddTimeframe(day) {
        if (!isLoaded('availability'))
            return;
        editingTimeframeDay = day;
        editingTimeframeId = null;
        renderAvailability();
    }
    function editTimeframe(day, id) {
        if (!isLoaded('availability'))
            return;
        editingTimeframeDay = day;
        editingTimeframeId = id;
        renderAvailability();
    }
    function cancelTimeframe() {
        const day = editingTimeframeDay;
        editingTimeframeDay = null;
        editingTimeframeId = null;
        renderAvailability();
        document.querySelector(`[data-add-timeframe-day="${CSS.escape(day || '')}"]`)?.focus();
    }
    function setFieldError(input, message) {
        if (!input)
            return;
        const errEl = document.getElementById(`${input.id}-error`);
        if (message) {
            input.setAttribute('aria-invalid', 'true');
            input.setCustomValidity?.(message);
        }
        else {
            input.removeAttribute('aria-invalid');
            input.setCustomValidity?.('');
        }
        if (errEl) {
            errEl.hidden = !message;
            const span = errEl.querySelector('span');
            if (span)
                span.textContent = message || '';
        }
    }
    function saveTimeframe(day) {
        const startEl = $('#tfStart');
        const endEl = $('#tfEnd');
        const start = startEl?.value || '';
        const end = endEl?.value || '';
        const repeatVal = $('input[name="tfRepeat"]:checked')?.value || 'weekly';
        if (!start) {
            setFieldError(startEl, 'Add a start time.');
            startEl?.focus();
            return;
        }
        setFieldError(startEl, '');
        if (!end) {
            setFieldError(endEl, 'Add an end time.');
            endEl?.focus();
            return;
        }
        if (end <= start) {
            setFieldError(endEl, 'End time must be after start time.');
            endEl?.focus();
            return;
        }
        const item = st().getAvailability().find(d => d.day === day);
        if (!item)
            return;
        item.timeframes = item.timeframes || [];
        const label = `${formatTime12h(start)} – ${formatTime12h(end)}`;
        if (editingTimeframeId !== null) {
            const tf = item.timeframes.find(t => t.id === editingTimeframeId);
            if (tf)
                Object.assign(tf, { start, end, label, repeat: repeatVal });
        }
        else {
            item.timeframes.push({ id: nextTimeframeId(), start, end, label, repeat: repeatVal });
            item.available = true;
        }
        editingTimeframeDay = null;
        editingTimeframeId = null;
        renderAvailability();
        st().markDirty();
        document.querySelector(`[data-add-timeframe-day="${CSS.escape(day)}"]`)?.focus();
    }
    function removeTimeframe(day, id) {
        if (!isLoaded('availability'))
            return;
        const item = st().getAvailability().find(d => d.day === day);
        const timeframe = item?.timeframes?.find(t => t.id === id);
        if (!timeframe)
            return;
        window.R59.confirmation.confirmRemoveTimeframe(timeframe.label, day, () => {
            item.timeframes = item.timeframes.filter(t => t.id !== id);
            if (item.timeframes.length === 0)
                item.available = false;
            if (editingTimeframeId === id) {
                editingTimeframeDay = null;
                editingTimeframeId = null;
            }
            renderAvailability();
            st().markDirty();
        });
    }
    /* ---------- Blocked dates (records: written immediately) ---------- */
    function setBlockFormEnabled(on) {
        ['#blockDateInput', '#blockReasonInput', '#btnBlockDate'].forEach(sel => {
            const el = $(sel);
            if (el)
                el.disabled = !on;
        });
    }
    function renderBlockedDates() {
        const container = $('#blockedDatesList');
        if (!container)
            return;
        const notReady = areaStateHTML('blockedDates', 3);
        setBlockFormEnabled(!notReady);
        // The Overview calendar marks blocked days too
        window.R59.dashboard?.renderOverview?.();
        if (notReady) {
            container.innerHTML = notReady;
            return;
        }
        const blocked = [...st().getBlockedDates()].sort((a, b) => String(a.dateStr || a.date).localeCompare(String(b.dateStr || b.date)));
        if (blocked.length === 0) {
            container.innerHTML = '<p class="sub">No dates are currently blocked.</p>';
            return;
        }
        container.innerHTML = `<ul class="rows" aria-labelledby="sc-blocked-list-title">${blocked.map(item => {
            const when = item.dateFormatted || item.dateStr || item.date;
            return `
        <li class="row">
          <div class="row__main">
            <strong class="num">${esc(when)}</strong>
            <span class="sub">${esc(item.reason || 'Blocked date')}</span>
          </div>
          <div class="row__acts">
            <button type="button" class="btn btn--sm btn--danger" data-remove-block="${esc(item.id)}" aria-label="Remove blocked date ${esc(when)}">Remove</button>
          </div>
        </li>`;
        }).join('')}</ul>`;
    }
    function afterBlockedChange() {
        renderBlockedDates();
        renderCalendar();
    }
    function removeBlockedDate(id) {
        const blockedList = st().getBlockedDates();
        const removed = blockedList.find(b => String(b.id) === String(id));
        if (!removed)
            return;
        const when = removed.dateFormatted || removed.dateStr || removed.date;
        window.R59.confirmation.confirmRemoveBlockedDate(when, async () => {
            const btn = document.querySelector(`[data-remove-block="${CSS.escape(String(id))}"]`);
            if (btn)
                btn.disabled = true;
            try {
                await window.R59.scheduleApi.removeBlockedDate(removed.id);
                st().setBlockedDates(st().getBlockedDates().filter(b => String(b.id) !== String(id)));
                afterBlockedChange();
                toast('Date unblocked', { type: 'success' });
            }
            catch (err) {
                if (err.status !== 401)
                    toast(`Couldn't unblock ${when}. ${err.message}`, { type: 'error' });
                if (btn && btn.isConnected)
                    btn.disabled = false;
            }
        });
    }
    function formatBlockedDate(dateStr) {
        return fromISODate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function addBlockedDate() {
        if (!isLoaded('blockedDates'))
            return;
        const dateEl = $('#blockDateInput');
        const dateVal = dateEl?.value;
        const reasonVal = $('#blockReasonInput')?.value.trim() || '';
        if (!dateVal || !window.R59.formValidation?.isValidISODate(dateVal)) {
            setFieldError(dateEl, 'Please choose a valid date to block.');
            dateEl?.focus();
            return;
        }
        if (st().getBlockedDates().some(b => (b.dateStr || b.date) === dateVal)) {
            setFieldError(dateEl, 'That date is already blocked.');
            dateEl?.focus();
            return;
        }
        setFieldError(dateEl, '');
        const dateFormatted = dateParts(dateVal).formatted;
        window.R59.confirmation.confirmBlockDate(dateFormatted, () => commitBlockedDate(dateVal, reasonVal));
    }
    async function commitBlockedDate(dateVal, reasonVal) {
        const btn = $('#btnBlockDate');
        if (btn)
            btn.disabled = true;
        const reason = reasonVal || '';
        try {
            const res = await window.R59.scheduleApi.addBlockedDate({ date: dateVal, reason });
            const id = res?.id ?? res?.data?.id;
            if (id === undefined || id === null)
                throw new Error('The server did not return the new blocked date.');
            const list = st().getBlockedDates();
            if (!list.some(b => String(b.id) === String(id))) {
                const date = res?.date || res?.data?.date || dateVal;
                list.push({
                    id,
                    date,
                    dateStr: date,
                    dateFormatted: formatBlockedDate(date),
                    reason: res?.reason ?? res?.data?.reason ?? reason
                });
            }
            $('#blockDateInput').value = '';
            $('#blockReasonInput').value = '';
            afterBlockedChange();
            const existing = st().getBookings().filter(b => b.date === dateVal && statusKey(b) !== 'cancelled').length;
            toast(existing
                ? `Date blocked — note: ${existing} existing booking${existing > 1 ? 's' : ''} on that day ${existing > 1 ? 'are' : 'is'} not cancelled`
                : 'Date blocked', { type: 'success' });
        }
        catch (err) {
            if (err.status !== 401)
                toast(`Couldn't block the date. ${err.message}`, { type: 'error' });
        }
        finally {
            if (btn)
                btn.disabled = !isLoaded('blockedDates');
        }
    }
    /* ---------- Bookings list ---------- */
    function bookingRowHTML(b) {
        const m = st().balanceOf(b);
        const due = dueOf(b);
        const isCancelled = statusKey(b) === 'cancelled';
        const name = b.customer || 'Unknown Client';
        const contact = [b.email, b.phone].filter(Boolean).map(esc).join(' · ');
        const extra = [];
        if (b.attendees)
            extra.push(`${Number(b.attendees)} attendee${b.attendees > 1 ? 's' : ''}`);
        if (b.coupon && typeof b.coupon === 'object')
            extra.push(`Coupon ${esc(b.coupon.code)} (−${money(b.coupon.discount)})`);
        else if (b.coupon)
            extra.push(`Coupon ${esc(b.coupon)}`);
        return `
      <li class="row bk${isCancelled ? ' is-cancelled' : ''}">
        <div class="row__main">
          <p class="bk__when num">${esc(bookingTimeText(b))}</p>
          <p class="bk__who"><strong>${esc(name)}</strong> ${statusTagHTML(b)}</p>
          <p class="sub">${esc(b.package || st().NO_PACKAGE)}</p>
          ${contact ? `<p class="sub">${contact}</p>` : ''}
          ${b.location ? `<p class="sub">Location: ${esc(b.location)}</p>` : ''}
          ${extra.length ? `<p class="sub">${extra.join(' · ')}</p>` : ''}
          ${b.notes ? `<p class="bk__notes">Notes: ${esc(b.notes)}</p>` : ''}
          <dl class="bk__money">
            <div><dt class="caps">Total</dt><dd class="num">${esc(fmtCents(m.totalCents))}</dd></div>
            <div><dt class="caps">Paid</dt><dd class="num">${esc(fmtCents(m.paidCents))}</dd></div>
            <div><dt class="caps">${esc(due.label)}</dt><dd class="num">${esc(due.value)}</dd></div>
          </dl>
        </div>
        <div class="row__acts">
          <button type="button" class="btn btn--sm" data-edit-booking="${esc(b.id)}" aria-label="Edit ${esc(name)}'s booking">${ICON('i-edit')}Edit</button>
          ${isCancelled
            ? `<button type="button" class="btn btn--sm btn--danger" data-delete-booking="${esc(b.id)}" aria-label="Remove ${esc(name)}'s cancelled booking">Remove</button>`
            : `<button type="button" class="btn btn--sm btn--danger" data-cancel-booking="${esc(b.id)}" aria-label="Cancel ${esc(name)}'s booking">Cancel Booking</button>`}
        </div>
      </li>`;
    }
    /** Bookings grouped by date. `empty` = { title, small } for the empty state (or a string). */
    function bookingsGroupedHTML(list, empty) {
        if (!list || list.length === 0) {
            const e = typeof empty === 'string' ? { title: empty } : (empty || { title: 'No bookings scheduled' });
            return emptyHTML(e.title, e.small);
        }
        const sorted = [...list].sort((x, y) => bookingSortKey(x).localeCompare(bookingSortKey(y)));
        const grouped = new Map();
        sorted.forEach(b => {
            const label = b.dateLabel || b.date;
            if (!grouped.has(label))
                grouped.set(label, []);
            grouped.get(label).push(b);
        });
        return [...grouped.entries()].map(([dateKey, items]) => `
      <section class="bk-group" aria-label="${esc(dateKey)}">
        <h4 class="bk-group__head caps"><span>${esc(dateKey)}</span><span>${items.length} booking${items.length > 1 ? 's' : ''}</span></h4>
        <ul class="rows">${items.map(bookingRowHTML).join('')}</ul>
      </section>`).join('');
    }
    function renderBookings() {
        const container = $('#bookingsList');
        const addBtn = $('#btnAddBooking');
        if (addBtn)
            addBtn.disabled = !isLoaded('bookings');
        if (container) {
            container.innerHTML = areaStateHTML('bookings', 6)
                || bookingsGroupedHTML(st().getBookings(), { title: 'No bookings scheduled' });
        }
        syncClearCancelledButtons();
        window.R59.dashboard?.renderOverview?.();
    }
    function syncClearCancelledButtons() {
        const loaded = isLoaded('bookings');
        const allCancelled = loaded ? st().getBookings().filter(b => statusKey(b) === 'cancelled') : [];
        const setBtn = (sel, count, label) => {
            const el = $(sel);
            if (!el)
                return;
            el.hidden = count === 0;
            el.textContent = `${label} (${count})`;
        };
        setBtn('#btnClearCancelled', allCancelled.length, 'Clear all cancelled');
        const ovYear = window.R59.dashboard?.getYear ? window.R59.dashboard.getYear() : new Date().getFullYear();
        const ovMonth = window.R59.dashboard?.getMonth ? window.R59.dashboard.getMonth() : new Date().getMonth();
        const monthCancelled = allCancelled.filter(b => {
            const [y, m] = String(b.date || '').split('-').map(Number);
            return y === ovYear && (m - 1) === ovMonth;
        });
        setBtn('#ovClearCancelled', monthCancelled.length, 'Clear cancelled');
    }
    function findBooking(id) {
        return st().getBookings().find(item => String(item.id) === String(id));
    }
    function bookingButtons(attr, id) {
        return [...document.querySelectorAll(`[${attr}="${CSS.escape(String(id))}"]`)];
    }
    function setDisabled(buttons, on) {
        buttons.forEach(b => { if (b && b.isConnected)
            b.disabled = on; });
    }
    function promptRemoveBooking(id) {
        const b = findBooking(id);
        if (!b || statusKey(b) !== 'cancelled')
            return;
        const n = Number(b.paymentsCount) || 0;
        const paymentsNote = n > 0
            ? `This also deletes ${n} recorded payment${n === 1 ? '' : 's'} (${fmtCents(b.paymentsTotal)}).`
            : '';
        window.R59.confirmation.confirmRemoveBooking(b, async () => {
            const btns = bookingButtons('data-delete-booking', id);
            setDisabled(btns, true);
            try {
                await window.R59.bookingsApi.deleteBooking(b.id);
                st().setBookings(st().getBookings().filter(item => String(item.id) !== String(id)));
                refreshBookingViews();
                toast('Cancelled booking removed', { type: 'success' });
            }
            catch (err) {
                if (err.status !== 401)
                    toast(`Couldn't remove the booking. ${err.message}`, { type: 'error' });
                setDisabled(btns, false);
            }
        }, paymentsNote);
    }
    function promptCancelBooking(id) {
        const b = findBooking(id);
        if (!b || statusKey(b) === 'cancelled')
            return;
        window.R59.confirmation.confirmCancelBooking(b, async () => {
            const btns = bookingButtons('data-cancel-booking', id);
            setDisabled(btns, true);
            try {
                await window.R59.bookingsApi.cancelBooking(b.id);
                b.status = 'Cancelled';
                refreshBookingViews();
                const refundCents = st().balanceOf({ ...b, status: 'Cancelled' }).refundOwedCents;
                toast(refundCents > 0
                    ? `Booking cancelled — ${st().formatCents(refundCents)} paid so far marked for reimbursement`
                    : 'Booking cancelled — nothing had been paid', { type: 'success' });
            }
            catch (err) {
                if (err.status !== 401)
                    toast(`Couldn't cancel the booking. ${err.message}`, { type: 'error' });
                setDisabled(btns, false);
            }
        });
    }
    /** Deletes the given cancelled bookings; only the ones the server removed leave the list. */
    function promptClearCancelled(scopeLabel, ids, triggerBtn) {
        if (!ids || !ids.length)
            return;
        // Name the recorded payments that go with them, as the single-delete confirm does
        const idSet = new Set(ids.map(String));
        let payCount = 0;
        let payCents = 0;
        st().getBookings().forEach(b => {
            if (!idSet.has(String(b.id)))
                return;
            payCount += Number(b.paymentsCount) || 0;
            payCents += st().balanceOf(b).paymentsCents;
        });
        const paymentsNote = payCount > 0
            ? `This also deletes ${payCount} recorded payment${payCount === 1 ? '' : 's'} (${fmtCents(payCents)}).`
            : '';
        window.R59.confirmation.confirmClearCancelled(ids.length, scopeLabel, async () => {
            const btns = [triggerBtn, $('#btnClearCancelled'), $('#ovClearCancelled')].filter(Boolean);
            setDisabled(btns, true);
            const results = await Promise.allSettled(ids.map(id => window.R59.bookingsApi.deleteBooking(id)));
            const removed = new Set();
            const failures = [];
            results.forEach((r, i) => {
                if (r.status === 'fulfilled')
                    removed.add(String(ids[i]));
                else
                    failures.push(r.reason);
            });
            if (removed.size)
                st().setBookings(st().getBookings().filter(b => !removed.has(String(b.id))));
            setDisabled(btns, false);
            refreshBookingViews();
            if (!failures.length) {
                toast(`${removed.size} cancelled booking${removed.size > 1 ? 's' : ''} cleared`, { type: 'success' });
            }
            else if (!failures.every(e => e && e.status === 401)) {
                const first = failures.find(e => e && e.status !== 401) || failures[0];
                toast(`Couldn't clear ${failures.length} of ${ids.length} cancelled booking${ids.length > 1 ? 's' : ''}. ${first?.message || ''}`.trim(), { type: 'error' });
            }
        }, paymentsNote);
    }
    function refreshBookingViews() {
        renderBookings();
        renderCalendar();
    }
    /* ---------- Modal helpers ---------- */
    function clearInvalid(modalSel) {
        document.querySelectorAll(`${modalSel} [aria-invalid="true"]`).forEach(el => el.removeAttribute('aria-invalid'));
    }
    function formError(errorSel, modalSel) {
        return (msg, fieldSel) => {
            clearInvalid(modalSel);
            const errEl = $(errorSel);
            if (errEl)
                errEl.textContent = msg;
            const field = fieldSel ? $(fieldSel) : null;
            if (field) {
                field.setAttribute('aria-invalid', 'true');
                field.focus();
            }
            return false;
        };
    }
    function isOpen(sel) {
        return Boolean($(sel)?.classList.contains('open'));
    }
    /* ---------- Booking edit modal ---------- */
    /** Package choices for the edit dialog: every package plus "No package" (value "none"). A booking
     *  without a package, or whose package was deleted, has "No package" selected. */
    function packageOptionsHTML(selectedId, currentName) {
        const pkgs = st().getState().packages || [];
        const hasId = selectedId !== null && selectedId !== undefined && selectedId !== '';
        const hasMatch = hasId && pkgs.some(p => String(p.id) === String(selectedId));
        const opts = pkgs.map(p => `<option value="${esc(p.id)}"${hasMatch && String(p.id) === String(selectedId) ? ' selected' : ''}>${esc(p.name)}${p.active ? '' : ' (inactive)'}</option>`);
        // A package that isn't in the loaded list (packages still loading, failed, or deleted) stays selected
        // as itself, so saving an unrelated edit never clears the booking's package
        if (hasId && !hasMatch) {
            opts.unshift(`<option value="${esc(selectedId)}" selected>${esc(currentName || st().NO_PACKAGE)}</option>`);
        }
        opts.unshift(`<option value="none"${hasId ? '' : ' selected'}>${esc(st().NO_PACKAGE)}</option>`);
        return opts.join('');
    }
    function openBookingEditor(id) {
        const b = findBooking(id);
        if (!b)
            return;
        editingBookingId = b.id;
        $('#bkCustomer').value = b.customer || '';
        $('#bkPackage').innerHTML = packageOptionsHTML(b.packageId !== undefined ? b.packageId : b.service_id, b.package);
        $('#bkLocation').value = b.location || '';
        $('#bkNotes').value = b.notes || '';
        $('#bkEmail').value = b.email || '';
        $('#bkPhone').value = b.phone || '';
        $('#bkAttendees').value = b.attendees || '';
        $('#bkDate').value = b.date || '';
        $('#bkStart').value = startOf(b);
        $('#bkEnd').value = to24(b.end_time);
        $('#bkPrice').value = b.price || 0;
        $('#bkDeposit').value = b.deposit || 0;
        $('#bkStatus').value = b.status || 'Pending';
        $('#bkError').textContent = '';
        $('#bkRefundNote').hidden = true;
        $('#bkSave').disabled = false;
        clearInvalid('#bookingModal');
        openPayments(b);
        if (!isOpen('#bookingModal'))
            lastFocus = document.activeElement;
        $('#bookingModal').classList.add('open');
        $('#bkCustomer').focus();
    }
    function closeBookingEditor() {
        $('#bookingModal')?.classList.remove('open');
        editingBookingId = null;
        payToken++; // late payment responses for this dialog are ignored
        payBookingId = null;
        if (lastFocus && typeof lastFocus.focus === 'function' && lastFocus.isConnected)
            lastFocus.focus();
        lastFocus = null;
    }
    /* ---------- Booking payments (record actions: saved on their own, never part of Review & save) ---------- */
    const PAY_AMOUNT_RE = /^\d{1,7}(\.\d{1,2})?$/;
    const PAY_FIELDS = ['#payAmount', '#payMethod', '#payDate', '#payNote'];
    let payToken = 0; // bumped on every open/close; a response for an older token is dropped
    let payBookingId = null; // booking whose payments the dialog shows
    let payList = []; // payments of that booking, as the server sent them
    let payLocked = false; // the server said the booking is cancelled (409)
    let billing = { charges: [], invoices: [], stale: false }; // GET /billing: charges oldest first, invoices newest first
    let billingStatus = 'loading'; // 'loading' | 'loaded' | 'failed'
    let billingError = '';
    let billingSeq = 0; // only the newest billing response is applied
    let chargeBusy = false; // an add-charge request is running
    let invoiceBusy = null; // 'send' | 'cancel' | 'check' while an invoice request is running
    const CHARGE_FIELDS = ['#chargeDesc', '#chargeAmount'];
    const LOCK_FIELDS = ['#bkPrice', '#bkDeposit', '#bkPackage'];
    const LOCKED_TEXT = 'An invoice is out for this booking. Cancel it to change amounts.';
    const INVOICE_BUSY_TEXT = { send: 'Sending…', cancel: 'Cancelling…', check: 'Checking…' };
    const DUE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    const payBooking = () => (payBookingId === null ? null : findBooking(payBookingId));
    const payCurrent = token => token === payToken && isOpen('#bookingModal') && payBookingId !== null;
    const samePay = (token, bookingId) => payCurrent(token) && String(payBookingId) === String(bookingId);
    /** A field of a success body (also duplicated under `data`). */
    const pick = (res, key) => (res ? (res[key] !== undefined ? res[key] : res.data?.[key]) : undefined) ?? null;
    /** The server's error code and details (apiClient keeps the body on err.data). */
    const errCode = err => (err && err.data && err.data.error && err.data.error.code) || '';
    const errDetails = err => (err && err.data && err.data.error && Array.isArray(err.data.error.details) ? err.data.error.details : []);
    /** An invoice is out (open statuses come from the server as is_open): amounts are locked. */
    const invoiceIsOpen = () => billingStatus === 'loaded' && billing.invoices.some(i => i && i.is_open);
    function payMaxDate() {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return toISODate(d);
    }
    function formatPaidOn(iso) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')))
            return String(iso || '');
        return fromISODate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    const payCents = v => Math.round(Number(String(v ?? '').trim()) * 100);
    const payRules = {
        amount: {
            message: 'Enter an amount like 150 or 19.99.',
            validate: v => {
                const s = String(v ?? '').trim();
                if (!PAY_AMOUNT_RE.test(s))
                    return false;
                const c = payCents(s);
                return c >= 1 && c <= 100000000;
            },
            attrs: { required: true }
        },
        method: {
            message: 'Choose a payment method.',
            validate: v => (st().PAYMENT_METHODS || []).includes(v),
            attrs: { required: true }
        },
        date: {
            message: 'Enter the date the payment was made.',
            validate: v => {
                const s = String(v ?? '');
                return Boolean(window.R59.formValidation?.isValidISODate(s)) && s >= '2000-01-01' && s <= payMaxDate();
            },
            attrs: { required: true }
        },
        note: {
            message: 'Keep the note to 500 characters or fewer.',
            validate: v => String(v ?? '').length <= 500
        }
    };
    const chargeRules = {
        description: {
            message: 'Enter a description of up to 120 characters.',
            validate: v => {
                const n = String(v ?? '').trim().length;
                return n >= 1 && n <= 120;
            },
            attrs: { required: true }
        }
    };
    function bindPaymentValidation() {
        const fv = window.R59.formValidation;
        if (!fv)
            return;
        fv.bind($('#payAmount'), payRules.amount);
        fv.bind($('#payMethod'), payRules.method);
        fv.bind($('#payDate'), payRules.date);
        fv.bind($('#payNote'), payRules.note);
        fv.bind($('#chargeDesc'), chargeRules.description);
        fv.bind($('#chargeAmount'), payRules.amount);
    }
    /** Clears a field's inline error the way formValidation does for a valid field. */
    function clearPayError(input) {
        if (!input)
            return;
        input.setCustomValidity('');
        input.removeAttribute('aria-invalid');
        const errEl = document.getElementById(`${input.id}-error`);
        if (errEl) {
            errEl.hidden = true;
            const span = errEl.querySelector('span');
            if (span)
                span.textContent = '';
            const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== errEl.id);
            if (ids.length)
                input.setAttribute('aria-describedby', ids.join(' '));
            else
                input.removeAttribute('aria-describedby');
        }
    }
    /** Shows a server-side field error (VALIDATION_FAILED details) in the field's inline error. */
    function showPayError(input, message) {
        if (!input || !message)
            return;
        input.setAttribute('aria-invalid', 'true');
        const errEl = document.getElementById(`${input.id}-error`);
        if (!errEl)
            return;
        const span = errEl.querySelector('span');
        if (span)
            span.textContent = message;
        else
            errEl.textContent = message;
        errEl.hidden = false;
        const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
        if (!ids.includes(errEl.id))
            input.setAttribute('aria-describedby', [...ids, errEl.id].join(' '));
    }
    function resetChargeForm() {
        CHARGE_FIELDS.forEach(sel => {
            const el = $(sel);
            if (!el)
                return;
            el.value = '';
            clearPayError(el);
        });
    }
    function resetPayForm() {
        PAY_FIELDS.forEach(sel => {
            const el = $(sel);
            if (!el)
                return;
            el.value = '';
            clearPayError(el);
        });
        const dateEl = $('#payDate');
        if (dateEl)
            dateEl.max = payMaxDate();
        const warn = $('#payMethodWarn');
        if (warn)
            warn.hidden = true;
    }
    function fillPayMethods() {
        const sel = $('#payMethod');
        if (!sel)
            return;
        sel.innerHTML = '<option value="" disabled selected>Choose a method</option>'
            + (st().PAYMENT_METHODS || []).map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    }
    function payIsCancelled(b) {
        return payLocked || Boolean(b && statusKey(b) === 'cancelled');
    }
    /** Cancelled bookings can't take payments: the form is disabled, Remove stays available.
     *  While an invoice is out, the form and manual Remove are locked too. */
    function syncPayFormState() {
        const cancelled = payIsCancelled(payBooking());
        const locked = !cancelled && invoiceIsOpen();
        const off = cancelled || locked;
        [...PAY_FIELDS, '#payRecord'].forEach(sel => setControlDisabled($(sel), off));
        const note = $('#payCancelledNote');
        if (note)
            note.hidden = !cancelled;
        const lockNote = $('#payLockedNote');
        if (lockNote)
            lockNote.hidden = !locked;
        document.querySelectorAll('#payList [data-remove-payment]').forEach(btn => { btn.disabled = invoiceIsOpen(); });
    }
    function setControlDisabled(el, off) {
        if (!el)
            return;
        el.disabled = off;
        if (off)
            el.setAttribute('aria-disabled', 'true');
        else
            el.removeAttribute('aria-disabled');
    }
    /** Locks while an invoice is out: Session price, Paid at booking, Package, the charge form and the
     *  payment form. The server enforces the same locks; this keeps the dialog honest. */
    function syncBillingLocks() {
        const b = payBooking();
        const locked = invoiceIsOpen();
        const cancelled = payIsCancelled(b);
        LOCK_FIELDS.forEach(sel => setControlDisabled($(sel), locked));
        const bkNote = $('#bkLockedNote');
        if (bkNote)
            bkNote.hidden = !locked;
        const chargeOff = locked || cancelled || billingStatus !== 'loaded';
        CHARGE_FIELDS.forEach(sel => setControlDisabled($(sel), chargeOff));
        setControlDisabled($('#chargeAdd'), chargeOff || chargeBusy);
        const chargeNote = $('#chargeLockedNote');
        if (chargeNote) {
            const span = chargeNote.querySelector('span');
            if (span)
                span.textContent = locked ? LOCKED_TEXT : "Cancelled bookings can't take new charges.";
            chargeNote.hidden = !(locked || cancelled);
        }
        document.querySelectorAll('#chargeList [data-remove-charge]').forEach(btn => { btn.disabled = locked; });
        syncPayFormState();
    }
    function syncBillingControls() {
        syncInvoiceButtons();
        syncBillingLocks();
    }
    function renderPaySummary() {
        const el = $('#paySummary');
        const b = payBooking();
        if (!el || !b)
            return;
        const m = st().balanceOf(b);
        const due = dueOf(b);
        const pct = b.depositPercent === null || b.depositPercent === undefined || b.depositPercent === '' ? NaN : Number(b.depositPercent);
        const atBooking = Number.isFinite(pct)
            ? `Paid at booking (${pct}% deposit, Square)`
            : (b.squarePaymentId ? 'Paid at booking (online, Square)' : 'Paid at booking');
        const chargesCents = Math.max(0, Math.round(Number(b.chargesCents) || 0));
        el.innerHTML = `
      <dl class="pay__figs">
        <div><dt class="caps">Total</dt><dd class="num">${esc(fmtCents(m.totalCents))}</dd></div>
        ${chargesCents > 0 ? `<div><dt class="caps">Extra charges</dt><dd class="num">${esc(fmtCents(chargesCents))}</dd></div>` : ''}
        <div><dt class="caps">${esc(atBooking)}</dt><dd class="num">${esc(fmtCents(m.depositCents))}</dd></div>
        <div><dt class="caps">Payments recorded</dt><dd class="num">${esc(fmtCents(m.paymentsCents))}</dd></div>
        <div class="pay__due"><dt class="caps">${esc(m.cancelled ? 'Refund' : 'Balance due')}</dt><dd class="num">${esc(due.text)}</dd></div>
      </dl>`;
        syncInvoiceButtons(); // "Send invoice for $X" follows the balance
    }
    function payRowHTML(p) {
        const amount = fmtCents(p.amount_cents);
        const date = formatPaidOn(p.paid_on);
        const method = p.method || 'Other';
        return `
      <li class="row pay__row">
        <div class="row__main">
          <p><strong class="num">${esc(amount)}</strong> <span class="pay__method">${esc(method)}</span>${p.square_invoice_id ? ' <span class="pay__via">via Square invoice</span>' : ''}</p>
          <p class="sub num">${esc(date)}</p>
          ${p.note ? `<p class="sub pay__note">${esc(p.note)}</p>` : ''}
        </div>
        ${p.removable ? `<div class="row__acts">
          <button type="button" class="btn btn--sm btn--danger" data-remove-payment="${esc(p.id)}" aria-label="${esc(`Remove the ${amount} ${method} payment on ${date}`)}"${invoiceIsOpen() ? ' disabled' : ''}>Remove</button>
        </div>` : ''}
      </li>`;
    }
    function renderPayList() {
        const el = $('#payList');
        if (!el)
            return;
        el.innerHTML = payList.length
            ? `<ul class="rows pay__rows">${payList.map(payRowHTML).join('')}</ul>`
            : '<p class="sub pay__empty">No payments recorded yet.</p>';
    }
    function payListErrorHTML(message) {
        return `<div class="load-error" role="alert">${ICON('i-alert')}<p><strong>Couldn't load payments.</strong> <span>${esc(message || '')}</span></p><button class="btn btn--sm" type="button" data-pay-retry>Retry</button></div>`;
    }
    function billingErrorHTML(message) {
        return `<div class="load-error" role="alert">${ICON('i-alert')}<p><strong>Couldn't load payments and charges.</strong> <span>${esc(message || '')}</span></p><button class="btn btn--sm" type="button" data-billing-retry>Retry</button></div>`;
    }
    /** Applies a server totals object (computeTotals) to the in-memory booking, then redraws the summary
     *  and the booking rows/calendar. `count` is the number of recorded payments, when known. */
    function applyBillingTotals(b, totals, count) {
        if (!b || !totals)
            return;
        const c = key => Math.max(0, Math.round(Number(totals[key]) || 0));
        b.baseCents = c('base_cents');
        b.chargesCents = c('charges_cents');
        b.priceCents = c('total_cents');
        b.depositCents = c('paid_at_booking_cents');
        b.paymentsTotal = c('payments_total_cents');
        if (Number.isInteger(count))
            b.paymentsCount = count;
        renderPaySummary();
        refreshBookingViews();
    }
    const isFullTotals = t => Boolean(t && t.total_cents !== undefined);
    /* ---------- Extra charges (record actions: saved right away, never part of Save changes) ---------- */
    function chargeRowHTML(c, locked) {
        const amount = fmtCents(c.amount_cents);
        const desc = String(c.description || '');
        return `
      <li class="row pay__row">
        <div class="row__main">
          <p><strong class="num">${esc(amount)}</strong> <span class="pay__method">${esc(desc)}</span></p>
        </div>
        <div class="row__acts">
          <button type="button" class="btn btn--sm btn--danger" data-remove-charge="${esc(c.id)}" aria-label="${esc(`Remove the charge ${desc} ${amount}`)}"${locked ? ' disabled' : ''}>Remove</button>
        </div>
      </li>`;
    }
    function renderCharges() {
        const el = $('#chargeList');
        if (!el)
            return;
        if (billingStatus === 'loading') {
            el.innerHTML = loadingHTML(2);
            return;
        }
        if (billingStatus === 'failed') {
            el.innerHTML = '<p class="sub pay__empty">Extra charges couldn\'t load. Use Retry above.</p>';
            return;
        }
        const locked = invoiceIsOpen();
        el.innerHTML = billing.charges.length
            ? `<ul class="rows pay__rows">${billing.charges.map(c => chargeRowHTML(c, locked)).join('')}</ul>`
            : '<p class="sub pay__empty">No extra charges.</p>';
    }
    async function addCharge() {
        const b = payBooking();
        const btn = $('#chargeAdd');
        if (!b || !btn || btn.disabled || chargeBusy)
            return;
        const fv = window.R59.formValidation;
        const fields = CHARGE_FIELDS.map(sel => $(sel));
        const firstBad = fields.find(el => el && fv && !fv.validate(el));
        if (firstBad) {
            firstBad.focus();
            return;
        }
        const description = $('#chargeDesc').value.trim();
        const amount = $('#chargeAmount').value.trim();
        const bookingId = b.id;
        const token = payToken;
        chargeBusy = true;
        syncBillingLocks();
        try {
            const res = await window.R59.bookingsApi.addCharge(bookingId, { description, amount });
            const charge = pick(res, 'charge');
            if (samePay(token, bookingId)) {
                if (charge) {
                    billing.charges.push(charge);
                    renderCharges();
                }
                else {
                    refreshBilling({ quiet: true });
                }
                resetChargeForm();
            }
            applyBillingTotals(findBooking(bookingId), totalsOf(res));
            toast('Charge added.', { type: 'success' });
            if (samePay(token, bookingId))
                $('#chargeDesc')?.focus();
        }
        catch (err) {
            const code = errCode(err);
            let inline = false;
            if (code === 'VALIDATION_FAILED' && samePay(token, bookingId)) {
                const fieldSel = { description: '#chargeDesc', amount: '#chargeAmount' };
                const d = errDetails(err).find(x => x && fieldSel[x.field]);
                const input = d ? $(fieldSel[d.field]) : null;
                if (input) {
                    showPayError(input, d.message || err.message);
                    input.focus();
                    inline = true;
                }
            }
            if (code === 'INVOICE_OPEN' && samePay(token, bookingId))
                refreshBilling({ quiet: true });
            if (code === 'BOOKING_CANCELLED')
                markPayCancelled(bookingId, token);
            if (!inline && err.status !== 401)
                toast(`Couldn't add the charge. ${err.message}`, { type: 'error' });
        }
        finally {
            if (samePay(token, bookingId)) {
                chargeBusy = false;
                syncBillingLocks();
            }
        }
    }
    function promptRemoveCharge(chargeId) {
        const b = payBooking();
        const c = billing.charges.find(x => String(x.id) === String(chargeId));
        if (!b || !c || invoiceIsOpen())
            return;
        const bookingId = b.id;
        const token = payToken;
        const amount = fmtCents(c.amount_cents);
        window.R59.confirmation.confirmDanger('Remove this charge?', `${c.description} ${amount} will come off the balance.`, 'Remove charge', async () => {
            const btns = [...document.querySelectorAll(`#chargeList [data-remove-charge="${CSS.escape(String(chargeId))}"]`)];
            setDisabled(btns, true);
            try {
                const res = await window.R59.bookingsApi.removeCharge(bookingId, c.id);
                if (samePay(token, bookingId)) {
                    billing.charges = billing.charges.filter(x => String(x.id) !== String(c.id));
                    renderCharges();
                }
                applyBillingTotals(findBooking(bookingId), totalsOf(res));
                toast('Charge removed.', { type: 'success' });
                const desc = $('#chargeDesc');
                if (samePay(token, bookingId) && desc && !desc.disabled)
                    desc.focus();
            }
            catch (err) {
                if ((errCode(err) === 'INVOICE_OPEN' || err.status === 404) && samePay(token, bookingId))
                    refreshBilling({ quiet: true });
                if (err.status !== 401)
                    toast(`Couldn't remove the charge. ${err.message}`, { type: 'error' });
                setDisabled(btns, invoiceIsOpen());
            }
        });
    }
    /** The server said the booking is cancelled (409 BOOKING_CANCELLED). */
    function markPayCancelled(bookingId, token) {
        const target = findBooking(bookingId);
        if (target)
            target.status = 'Cancelled';
        if (samePay(token, bookingId)) {
            payLocked = true;
            renderPaySummary();
            syncBillingControls();
        }
        refreshBookingViews();
    }
    /* ---------- Invoice (Square): send, check status, cancel ---------- */
    /** 'YYYY-MM-DD' (or the date part of a 'YYYY-MM-DD hh:mm:ss' timestamp) as a local "Nov 13". */
    function invoiceDate(value) {
        const s = String(value || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? DUE_FMT.format(fromISODate(s)) : '';
    }
    function invoiceTagClass(inv) {
        const s = String(inv.status || '').toUpperCase();
        if (inv.is_open && inv.label === 'Overdue')
            return 'tag tag--live';
        if (s === 'PAID' || s === 'PARTIALLY_REFUNDED')
            return 'tag bk-tag--confirmed';
        return inv.is_open ? 'tag' : 'tag tag--muted';
    }
    function invoiceNowHTML(inv) {
        const s = String(inv.status || '').toUpperCase();
        const amount = fmtCents(inv.amount_cents);
        // Open and payable: label · amount · due date · View invoice. CREATING, PAYMENT_PENDING and closed: label · amount.
        const full = Boolean(inv.is_open) && s !== 'CREATING' && s !== 'PAYMENT_PENDING';
        const due = full ? invoiceDate(inv.due_date) : '';
        const url = String(inv.public_url || '');
        const link = full && /^https:\/\//i.test(url) ? url : '';
        return `
      <ul class="rows pay__rows"><li class="row pay__row inv__now">
        <div class="row__main">
          <p><span class="${invoiceTagClass(inv)}">${esc(inv.label || s)}</span> <strong class="num">${esc(amount)}</strong></p>
          ${due ? `<p class="sub num">due ${esc(due)}</p>` : ''}
        </div>
        ${link ? `<div class="row__acts"><a class="btn btn--sm" href="${esc(link)}" target="_blank" rel="noopener noreferrer">View invoice<span class="sr-only"> (opens in a new tab)</span></a></div>` : ''}
      </li></ul>`;
    }
    function invoiceHistoryHTML(list) {
        if (!list.length)
            return '';
        const items = list.map(i => `<li>${esc([i.label || i.status, fmtCents(i.amount_cents), invoiceDate(i.created_at)].filter(Boolean).join(' · '))}</li>`).join('');
        return `<p class="caps list-cap">Earlier invoices</p><ul class="inv__hist num">${items}</ul>`;
    }
    function renderInvoiceBox() {
        const el = $('#invoiceBox');
        if (!el)
            return;
        if (billingStatus === 'loading') {
            el.innerHTML = loadingHTML(2);
            return;
        }
        if (billingStatus === 'failed') {
            el.innerHTML = `<div class="load-error">${ICON('i-alert')}<p><strong>Couldn't load the invoice.</strong> <span>${esc(billingError)}</span></p><button class="btn btn--sm" type="button" data-billing-retry>Retry</button></div>`;
            return;
        }
        const [now, ...rest] = billing.invoices;
        el.innerHTML = (now ? invoiceNowHTML(now) : '<p class="sub pay__empty">No invoice sent yet.</p>')
            + invoiceHistoryHTML(rest.slice(0, 5))
            + (billing.stale ? `<p class="refund-note">${ICON('i-alert')}<span>Couldn't reach Square. Showing the last saved status.</span></p>` : '');
    }
    /** '' when an invoice can be sent, otherwise the hint that says why not. */
    function invoiceSendBlock(b) {
        if (!b)
            return '';
        const m = st().balanceOf(b);
        if (m.cancelled || payIsCancelled(b))
            return "Cancelled bookings can't be invoiced.";
        if (m.balanceCents <= 0)
            return 'Nothing is left to pay, so there is nothing to invoice.';
        const email = String(b.email || '').trim();
        if (!email)
            return 'Add a client email and save the booking to send an invoice.';
        const fv = window.R59.formValidation;
        const ok = fv?.rules?.email ? fv.rules.email.validate(email) : Boolean(fv?.isValidEmail?.(email));
        if (!ok)
            return "The client email isn't valid. Fix it and save the booking to send an invoice.";
        return '';
    }
    /** Send / Check status / Cancel, per the invoice block state table. */
    function syncInvoiceButtons() {
        const send = $('#invoiceSend');
        const check = $('#invoiceCheck');
        const cancel = $('#invoiceCancel');
        const hint = $('#invoiceHint');
        if (!send || !check || !cancel)
            return;
        const b = payBooking();
        const loaded = billingStatus === 'loaded';
        const now = loaded ? billing.invoices[0] : null;
        const status = String(now?.status || '').toUpperCase();
        const open = invoiceIsOpen();
        const block = loaded && !open ? invoiceSendBlock(b) : '';
        const balanceCents = b ? st().balanceOf(b).balanceCents : 0;
        send.textContent = invoiceBusy === 'send'
            ? INVOICE_BUSY_TEXT.send
            : (balanceCents > 0 ? `Send invoice for ${fmtCents(balanceCents)}` : 'Send invoice');
        send.disabled = !b || !loaded || open || Boolean(block) || Boolean(invoiceBusy);
        if (block)
            send.setAttribute('aria-describedby', 'invoiceHint');
        else
            send.removeAttribute('aria-describedby');
        if (hint) {
            hint.textContent = block;
            hint.hidden = !block;
        }
        check.hidden = !loaded || !now;
        check.textContent = invoiceBusy === 'check' ? INVOICE_BUSY_TEXT.check : 'Check status';
        check.disabled = Boolean(invoiceBusy);
        cancel.hidden = !(loaded && now && now.is_open && status !== 'CREATING' && status !== 'PAYMENT_PENDING');
        cancel.textContent = invoiceBusy === 'cancel' ? INVOICE_BUSY_TEXT.cancel : 'Cancel invoice';
        cancel.disabled = Boolean(invoiceBusy);
    }
    /** After a request the busy button may be hidden, or was disabled: put focus back on a live control. */
    function focusInvoiceControl(prefer) {
        if (!isOpen('#bookingModal'))
            return;
        const a = document.activeElement;
        if (a && a !== document.body && a.isConnected && !a.hidden && !a.disabled)
            return;
        const el = [prefer, '#invoiceCheck', '#invoiceSend'].map(sel => sel && $(sel)).find(x => x && !x.hidden && !x.disabled);
        if (el)
            el.focus();
    }
    function upsertInvoice(invoice) {
        if (!invoice)
            return;
        const i = billing.invoices.findIndex(x => String(x.id) === String(invoice.id));
        if (i >= 0)
            billing.invoices[i] = invoice;
        else
            billing.invoices.unshift(invoice);
    }
    /**
     * GET /bookings/:id/billing (the server also re-checks an open invoice with Square). Replaces the
     * payment list, charges and invoices, then applies the totals. `quiet` keeps the current view until
     * the answer arrives and reports a failure as a toast instead of replacing the lists.
     */
    async function refreshBilling({ quiet = false } = {}) {
        const token = payToken;
        const bookingId = payBookingId;
        if (bookingId === null)
            return false;
        const seq = ++billingSeq;
        const keepView = quiet && billingStatus === 'loaded';
        if (!keepView) {
            billingStatus = 'loading';
            const list = $('#payList');
            if (list)
                list.innerHTML = loadingHTML(2);
            renderCharges();
            renderInvoiceBox();
            syncBillingControls();
        }
        try {
            const res = await window.R59.bookingsApi.getBilling(bookingId);
            if (!samePay(token, bookingId) || seq !== billingSeq)
                return false;
            const charges = pick(res, 'charges');
            const invoices = pick(res, 'invoices');
            const payments = pick(res, 'payments');
            if (!Array.isArray(charges) || !Array.isArray(invoices) || !Array.isArray(payments)) {
                throw new Error('The server sent unexpected billing details.');
            }
            billing = { charges, invoices, stale: Boolean(pick(res, 'stale')) };
            payList = payments;
            billingStatus = 'loaded';
            billingError = '';
            renderPayList();
            renderCharges();
            renderInvoiceBox();
            applyBillingTotals(findBooking(bookingId), totalsOf(res), payments.length);
            syncBillingControls();
            return true;
        }
        catch (err) {
            if (!samePay(token, bookingId) || seq !== billingSeq)
                return false;
            if (keepView) {
                if (err.status !== 401)
                    toast(`Couldn't check the invoice status. ${err.message}`, { type: 'error' });
                return false;
            }
            billingStatus = 'failed';
            billingError = (err && err.message) || '';
            const list = $('#payList');
            if (list)
                list.innerHTML = billingErrorHTML(billingError);
            renderCharges();
            renderInvoiceBox();
            syncBillingControls();
            return false;
        }
    }
    async function checkInvoice() {
        if (invoiceBusy || billingStatus !== 'loaded')
            return;
        const token = payToken;
        const bookingId = payBookingId;
        invoiceBusy = 'check';
        syncInvoiceButtons();
        await refreshBilling({ quiet: true });
        if (!samePay(token, bookingId))
            return;
        invoiceBusy = null;
        syncBillingControls();
        focusInvoiceControl('#invoiceCheck');
    }
    function sendInvoice() {
        const b = payBooking();
        const btn = $('#invoiceSend');
        if (!b || !btn || btn.disabled || invoiceBusy)
            return;
        const { balanceCents } = st().balanceOf(b);
        const email = String(b.email || '').trim();
        const bookingId = b.id;
        const token = payToken;
        window.R59.confirmation.confirmSendInvoice(fmtCents(balanceCents), email, async () => {
            if (!samePay(token, bookingId) || invoiceBusy)
                return;
            invoiceBusy = 'send';
            syncInvoiceButtons();
            try {
                const res = await window.R59.bookingsApi.sendInvoice(bookingId, balanceCents);
                const invoice = pick(res, 'invoice');
                if (samePay(token, bookingId))
                    upsertInvoice(invoice);
                applyBillingTotals(findBooking(bookingId), totalsOf(res));
                if (samePay(token, bookingId) && !invoice)
                    refreshBilling({ quiet: true });
                toast(`Invoice sent to ${email}.`, { type: 'success' });
            }
            catch (err) {
                const code = errCode(err);
                if (code === 'BALANCE_CHANGED') {
                    const cents = Number(errDetails(err)[0]?.balance_cents);
                    if (samePay(token, bookingId))
                        refreshBilling({ quiet: true });
                    toast(Number.isFinite(cents) ? `The balance changed to ${fmtCents(cents)}. Review and send again.` : err.message, { type: 'error' });
                }
                else {
                    if (code === 'BOOKING_CANCELLED')
                        markPayCancelled(bookingId, token);
                    else if (samePay(token, bookingId) && err.status !== 401 && code !== 'SQUARE_NOT_CONFIGURED' && code !== 'INVALID_EMAIL')
                        refreshBilling({ quiet: true });
                    if (err.status !== 401)
                        toast(`Couldn't send the invoice. ${err.message}`, { type: 'error' });
                }
            }
            finally {
                if (samePay(token, bookingId)) {
                    invoiceBusy = null;
                    renderInvoiceBox();
                    syncBillingControls();
                    focusInvoiceControl('#invoiceCheck');
                }
            }
        });
    }
    function cancelInvoice() {
        const b = payBooking();
        const btn = $('#invoiceCancel');
        if (!b || !btn || btn.hidden || btn.disabled || invoiceBusy)
            return;
        const bookingId = b.id;
        const token = payToken;
        window.R59.confirmation.confirmCancelInvoice(async () => {
            if (!samePay(token, bookingId) || invoiceBusy)
                return;
            invoiceBusy = 'cancel';
            syncInvoiceButtons();
            try {
                const res = await window.R59.bookingsApi.cancelInvoice(bookingId);
                const invoice = pick(res, 'invoice');
                if (samePay(token, bookingId))
                    upsertInvoice(invoice);
                applyBillingTotals(findBooking(bookingId), totalsOf(res));
                if (samePay(token, bookingId) && !invoice)
                    refreshBilling({ quiet: true });
                toast('Invoice cancelled.', { type: 'success' });
            }
            catch (err) {
                if (samePay(token, bookingId) && err.status !== 401 && errCode(err) !== 'SQUARE_NOT_CONFIGURED')
                    refreshBilling({ quiet: true });
                if (err.status !== 401)
                    toast(`Couldn't cancel the invoice. ${err.message}`, { type: 'error' });
            }
            finally {
                if (samePay(token, bookingId)) {
                    invoiceBusy = null;
                    renderInvoiceBox();
                    syncBillingControls();
                    focusInvoiceControl('#invoiceSend');
                }
            }
        });
    }
    /** Applies server totals to the in-memory booking; re-renders rows/KPIs when the figures changed. */
    function applyPayTotals(b, totalsCents, count) {
        if (!b)
            return;
        const changed = (Number(b.paymentsTotal) || 0) !== totalsCents || (Number(b.paymentsCount) || 0) !== count;
        b.paymentsTotal = totalsCents;
        b.paymentsCount = count;
        renderPaySummary();
        if (changed)
            refreshBookingViews();
    }
    const totalsOf = res => (res && (res.totals || res.data?.totals)) || null;
    async function loadPayments() {
        const token = payToken;
        const bookingId = payBookingId;
        const el = $('#payList');
        if (!el || bookingId === null)
            return;
        el.innerHTML = loadingHTML(2);
        try {
            const res = await window.R59.bookingsApi.getPayments(bookingId);
            if (!payCurrent(token) || String(payBookingId) !== String(bookingId))
                return;
            const rows = res && (Array.isArray(res.payments) ? res.payments : res.data?.payments);
            if (!Array.isArray(rows))
                throw new Error('The server sent an unexpected payment list.');
            payList = rows;
            renderPayList();
            const totals = totalsOf(res);
            if (isFullTotals(totals)) {
                applyBillingTotals(findBooking(bookingId), totals, rows.length);
            }
            else {
                const sum = totals && Number.isFinite(Number(totals.payments_total_cents))
                    ? Math.round(Number(totals.payments_total_cents))
                    : rows.reduce((n, p) => n + (Math.round(Number(p.amount_cents)) || 0), 0);
                applyPayTotals(findBooking(bookingId), sum, rows.length);
            }
            syncPayFormState();
        }
        catch (err) {
            if (!payCurrent(token) || String(payBookingId) !== String(bookingId))
                return;
            el.innerHTML = payListErrorHTML(err && err.message);
        }
    }
    function openPayments(b) {
        payToken++;
        payBookingId = b.id;
        payList = [];
        payLocked = false;
        billing = { charges: [], invoices: [], stale: false };
        billingStatus = 'loading';
        billingError = '';
        chargeBusy = false;
        invoiceBusy = null;
        fillPayMethods();
        resetPayForm();
        resetChargeForm();
        syncPayFormState();
        renderPaySummary();
        refreshBilling();
    }
    function onPayMethodChange() {
        const b = payBooking();
        const warn = $('#payMethodWarn');
        if (warn)
            warn.hidden = !($('#payMethod')?.value === 'Square' && b && b.squarePaymentId);
    }
    function recordPayment() {
        const b = payBooking();
        if (!b || payIsCancelled(b) || $('#payRecord')?.disabled)
            return;
        const fv = window.R59.formValidation;
        const fields = PAY_FIELDS.map(sel => $(sel));
        const firstBad = fields.find(el => el && fv && !fv.validate(el));
        if (firstBad) {
            firstBad.focus();
            return;
        }
        const amount = $('#payAmount').value.trim();
        const method = $('#payMethod').value;
        const paid_on = $('#payDate').value;
        const note = $('#payNote').value.trim();
        const cents = payCents(amount);
        const { balanceCents } = st().balanceOf(b);
        const bookingId = b.id;
        const token = payToken;
        const go = async () => {
            const btn = $('#payRecord');
            if (btn)
                btn.disabled = true;
            try {
                const res = await window.R59.bookingsApi.addPayment(bookingId, { amount, method, paid_on, note });
                const target = findBooking(bookingId);
                const payment = res && (res.payment || res.data?.payment);
                const totals = totalsOf(res);
                if (target && isFullTotals(totals)) {
                    applyBillingTotals(target, totals, (Number(target.paymentsCount) || 0) + 1);
                }
                else if (target) {
                    target.paymentsTotal = totals && Number.isFinite(Number(totals.payments_total_cents))
                        ? Math.round(Number(totals.payments_total_cents))
                        : (Number(target.paymentsTotal) || 0) + cents;
                    target.paymentsCount = (Number(target.paymentsCount) || 0) + 1;
                }
                if (payCurrent(token) && String(payBookingId) === String(bookingId)) {
                    if (payment) {
                        payList.push(payment);
                        payList.sort((x, y) => String(x.paid_on).localeCompare(String(y.paid_on)) || (Number(x.id) || 0) - (Number(y.id) || 0));
                        renderPayList();
                    }
                    else {
                        loadPayments();
                    }
                    resetPayForm();
                    renderPaySummary();
                }
                refreshBookingViews();
                toast('Payment recorded.', { type: 'success' });
            }
            catch (err) {
                if (err.status === 409 && errCode(err) === 'INVOICE_OPEN') {
                    if (payCurrent(token) && String(payBookingId) === String(bookingId))
                        refreshBilling({ quiet: true });
                }
                else if (err.status === 409) {
                    const cancelledTarget = findBooking(bookingId);
                    if (cancelledTarget)
                        cancelledTarget.status = 'Cancelled';
                    if (payCurrent(token) && String(payBookingId) === String(bookingId)) {
                        payLocked = true;
                        renderPaySummary();
                    }
                    refreshBookingViews();
                }
                if (err.status !== 401)
                    toast(`Couldn't record the payment. ${err.message}`, { type: 'error' });
            }
            finally {
                if (payCurrent(token) && String(payBookingId) === String(bookingId))
                    syncPayFormState();
            }
        };
        if (!payIsCancelled(b) && cents > balanceCents) {
            window.R59.confirmation.confirmOverBalance(fmtCents(balanceCents), go);
        }
        else {
            go();
        }
    }
    function promptRemovePayment(paymentId) {
        const b = payBooking();
        const p = payList.find(x => String(x.id) === String(paymentId));
        if (!b || !p)
            return;
        const bookingId = b.id;
        const token = payToken;
        const label = `${fmtCents(p.amount_cents)} ${p.method || 'Other'} payment on ${formatPaidOn(p.paid_on)}`;
        window.R59.confirmation.confirmRemovePayment(label, async () => {
            const btns = [...document.querySelectorAll(`#payList [data-remove-payment="${CSS.escape(String(paymentId))}"]`)];
            setDisabled(btns, true);
            try {
                const res = await window.R59.bookingsApi.removePayment(bookingId, p.id);
                const target = findBooking(bookingId);
                const totals = totalsOf(res);
                if (target && isFullTotals(totals)) {
                    applyBillingTotals(target, totals, Math.max(0, (Number(target.paymentsCount) || 0) - 1));
                }
                else if (target) {
                    target.paymentsTotal = totals && Number.isFinite(Number(totals.payments_total_cents))
                        ? Math.round(Number(totals.payments_total_cents))
                        : Math.max(0, (Number(target.paymentsTotal) || 0) - (Math.round(Number(p.amount_cents)) || 0));
                    target.paymentsCount = Math.max(0, (Number(target.paymentsCount) || 0) - 1);
                }
                if (payCurrent(token) && String(payBookingId) === String(bookingId)) {
                    payList = payList.filter(x => String(x.id) !== String(p.id));
                    renderPaySummary();
                    loadPayments(); // fresh list (and removable flags) from the server
                }
                refreshBookingViews();
                toast('Payment removed.', { type: 'success' });
            }
            catch (err) {
                const code = errCode(err);
                if ((code === 'INVOICE_OPEN' || code === 'SQUARE_INVOICE_PAYMENT') && payCurrent(token) && String(payBookingId) === String(bookingId)) {
                    refreshBilling({ quiet: true });
                }
                if (err.status !== 401)
                    toast(`Couldn't remove the payment. ${err.message}`, { type: 'error' });
                setDisabled(btns, invoiceIsOpen());
            }
        }, payIsCancelled(b));
    }
    function initPaymentListeners() {
        bindPaymentValidation();
        $('#payMethod')?.addEventListener('change', onPayMethodChange);
        $('#paySection')?.addEventListener('click', e => {
            const target = e.target instanceof Element ? e.target : e.target?.parentElement;
            if (!target)
                return;
            let el;
            if ((el = target.closest('#payRecord'))) {
                e.preventDefault();
                recordPayment();
                return;
            }
            if ((el = target.closest('[data-remove-payment]'))) {
                e.preventDefault();
                if (!el.disabled)
                    promptRemovePayment(el.dataset.removePayment);
                return;
            }
            if ((el = target.closest('[data-pay-retry]'))) {
                e.preventDefault();
                loadPayments();
                return;
            }
            if ((el = target.closest('[data-billing-retry]'))) {
                e.preventDefault();
                refreshBilling();
                return;
            }
            if ((el = target.closest('#chargeAdd'))) {
                e.preventDefault();
                addCharge();
                return;
            }
            if ((el = target.closest('[data-remove-charge]'))) {
                e.preventDefault();
                if (!el.disabled)
                    promptRemoveCharge(el.dataset.removeCharge);
                return;
            }
            if ((el = target.closest('#invoiceSend'))) {
                e.preventDefault();
                sendInvoice();
                return;
            }
            if ((el = target.closest('#invoiceCheck'))) {
                e.preventDefault();
                checkInvoice();
                return;
            }
            if ((el = target.closest('#invoiceCancel'))) {
                e.preventDefault();
                cancelInvoice();
            }
        });
        // Enter in a charge field adds the charge
        $('#chargeForm')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
                addCharge();
            }
        });
        // Enter in a payment field records it (the dialog's Save changes is not involved)
        $('#payForm')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
                recordPayment();
            }
        });
    }
    function saveBookingEdit() {
        const b = findBooking(editingBookingId);
        if (!b)
            return closeBookingEditor();
        const fv = window.R59.formValidation;
        const err = formError('#bkError', '#bookingModal');
        clearInvalid('#bookingModal');
        $('#bkError').textContent = '';
        const customer = $('#bkCustomer').value.trim();
        const pkgSelect = $('#bkPackage');
        const packageId = pkgSelect.value;
        const pkg = (st().getState().packages || []).find(p => String(p.id) === String(packageId));
        const date = $('#bkDate').value;
        const start = $('#bkStart').value;
        const end = $('#bkEnd').value;
        const price = parseFloat($('#bkPrice').value);
        const deposit = parseFloat($('#bkDeposit').value);
        const email = $('#bkEmail').value.trim();
        const rawPhone = $('#bkPhone').value.trim();
        const phone = rawPhone && fv?.cleanPhone ? fv.cleanPhone(rawPhone) : rawPhone;
        const attendeesRaw = $('#bkAttendees').value.trim();
        const status = $('#bkStatus').value;
        if (!customer)
            return err('Please enter the customer name.', '#bkCustomer');
        if (email && !fv.isValidEmail(email))
            return err('Please enter a valid email address.', '#bkEmail');
        if (phone && !fv.isValidPhone(phone))
            return err('Please enter a valid phone number (10+ digits).', '#bkPhone');
        if (attendeesRaw && !(parseInt(attendeesRaw, 10) >= 1))
            return err('Attendees must be at least 1.', '#bkAttendees');
        if (!date || !fv.isValidISODate(date))
            return err('Please choose a valid date.', '#bkDate');
        const blockedDay = st().getBlockedDates().find(x => (x.dateStr || x.date) === date);
        if (blockedDay && date !== b.date && status !== 'Cancelled') {
            return err(`That date is blocked (${blockedDay.reason || 'Unavailable'}). Pick another date.`, '#bkDate');
        }
        if (!start)
            return err('Please choose a start time.', '#bkStart');
        if (end && end <= start)
            return err('End time must be after start time.', '#bkEnd');
        if (!(price >= 0))
            return err('Please enter a valid session price.', '#bkPrice');
        if (!(deposit >= 0))
            return err('Please enter a valid amount paid at booking.', '#bkDeposit');
        if (deposit > price)
            return err('Paid at booking cannot be more than the session price.', '#bkDeposit');
        const parts = dateParts(date);
        const bookingId = b.id;
        window.R59.confirmation.confirmSaveBooking(customer, parts.formatted, false, async () => {
            const saveBtn = $('#bkSave');
            saveBtn.disabled = true;
            const attendees = attendeesRaw ? parseInt(attendeesRaw, 10) : undefined;
            const location = $('#bkLocation').value.trim();
            const notes = $('#bkNotes').value.trim();
            const payload = {
                customer_name: customer,
                customer_email: email,
                phone,
                location,
                notes,
                attendees,
                date,
                startTime: start,
                endTime: end || undefined,
                price,
                deposit,
                status
            };
            // Only send the package when the admin changed it (an unchanged choice keeps the stored one)
            const prevPackage = b.packageId === null || b.packageId === undefined ? 'none' : String(b.packageId);
            const packageChanged = String(packageId) !== prevPackage;
            const noPackage = packageChanged && !pkg && packageId === 'none';
            if (packageChanged && pkg)
                payload.packageId = pkg.id;
            else if (noPackage)
                payload.packageId = 'none';
            try {
                await window.R59.bookingsApi.updateBooking(bookingId, payload);
                const target = findBooking(bookingId);
                if (target) {
                    Object.assign(target, {
                        customer,
                        email,
                        phone,
                        location,
                        notes,
                        attendees,
                        people: attendees,
                        date,
                        dateFormatted: parts.formatted,
                        dateLabel: parts.label,
                        time: start,
                        start_time: start,
                        end_time: end || target.end_time || '',
                        price,
                        deposit,
                        status
                    });
                    // Same conversion the server makes: dollars -> whole cents
                    target.baseCents = Math.max(0, Math.round(price * 100));
                    target.priceCents = target.baseCents + (Number(target.chargesCents) || 0);
                    target.depositCents = Math.max(0, Math.round(deposit * 100));
                    if (packageChanged && pkg)
                        Object.assign(target, { service_id: pkg.id, packageId: pkg.id, package: pkg.name });
                    else if (noPackage)
                        Object.assign(target, { service_id: null, packageId: null, package: st().NO_PACKAGE });
                    target.timeRange = bookingTimeText(target);
                }
                if (String(editingBookingId) === String(bookingId))
                    closeBookingEditor();
                refreshBookingViews();
                toast('Booking updated', { type: 'success' });
            }
            catch (e) {
                const msg = `Couldn't save the booking. ${e.message}`;
                if (isOpen('#bookingModal') && String(editingBookingId) === String(bookingId)) {
                    $('#bkError').textContent = msg;
                }
                else if (e.status !== 401) {
                    toast(msg, { type: 'error' });
                }
            }
            finally {
                saveBtn.disabled = false;
            }
        });
        return true;
    }
    /* ---------- New booking modal ---------- */
    // Bookings are priced from the SAVED (live) pricing, never from unsaved edits in the Payment view
    function livePricing() {
        return (st().getSaved?.() || {}).pricing || st().getState().pricing || {};
    }
    function getDepositRate() {
        const v = parseFloat(livePricing().depositPercent);
        return (isNaN(v) ? 60 : Math.min(100, Math.max(1, v))) / 100;
    }
    function getAvailablePackages() {
        const savedPkgs = (st().getSaved?.() || {}).packages || {};
        return (st().getState().packages || []).filter(p => p.active).map(p => {
            const saved = savedPkgs[p.id];
            return saved ? {
                ...p,
                name: saved.name ?? p.name,
                price: Number(saved.price ?? p.price) || 0,
                duration_minutes: saved.duration_minutes ?? p.duration_minutes,
                full_day: saved.full_day ?? p.full_day
            } : p;
        });
    }
    function computeBookingPrice({ pkgPrice, attendees, coupon }) {
        const pricing = livePricing();
        const base = parseFloat(pricing.baseFee) || 0;
        const perPerson = parseFloat(pricing.perPerson) || 0;
        const attendeeFee = perPerson * attendees;
        const subtotal = pkgPrice + base + attendeeFee;
        let discount = 0;
        if (coupon) {
            discount = coupon.type === 'percent'
                ? subtotal * coupon.amount / 100
                : Math.min(coupon.amount, subtotal);
        }
        discount = round2(discount);
        const total = round2(Math.max(0, subtotal - discount));
        return { base, perPerson, attendeeFee, subtotal, discount, total, deposit: round2(total * getDepositRate()) };
    }
    /** The chosen package, the "No package" choice, or null when the chosen package is gone. */
    function nbSelectedPackage() {
        const val = $('#nbPackage').value;
        if (val === 'none')
            return { key: 'none', name: st().NO_PACKAGE, price: 0, none: true };
        return getAvailablePackages().find(p => String(p.id) === String(val)) || null;
    }
    const NB_PRICE_RE = /^\d{1,7}(\.\d{1,2})?$/;
    const nbCustomPriceRule = {
        message: 'Enter a price of 0 or more.',
        // Only checked while "No package (custom price)" is chosen
        validate: v => $('#nbPackage')?.value !== 'none' || NB_PRICE_RE.test(String(v ?? '').trim())
    };
    /** The typed custom price in dollars (0 while it isn't a valid amount). */
    function nbCustomPrice() {
        const s = String($('#nbCustomPrice')?.value ?? '').trim();
        return NB_PRICE_RE.test(s) ? round2(Number(s)) : 0;
    }
    /** "No package" bookings are priced by hand: the total is the custom price, with no fees added. */
    function nbPricing(pkg, attendees) {
        if (pkg.none) {
            const total = nbCustomPrice();
            return { total, deposit: round2(total * getDepositRate()) };
        }
        return computeBookingPrice({ pkgPrice: pkg.price || 0, attendees });
    }
    function syncNbCustomPriceField() {
        const field = $('#nbCustomPriceField');
        const input = $('#nbCustomPrice');
        if (!field || !input)
            return;
        const on = $('#nbPackage')?.value === 'none';
        field.hidden = !on;
        input.required = on;
        if (!on)
            clearPayError(input);
        else
            window.R59.formValidation?.revalidate(input);
    }
    function renderNewBookingSummary() {
        const summaryEl = $('#nbSummary');
        if (!summaryEl)
            return;
        const pkg = nbSelectedPackage();
        const attendees = Math.max(1, parseInt($('#nbAttendees').value, 10) || 1);
        if (!pkg) {
            summaryEl.innerHTML = '';
            return;
        }
        if (pkg.none) {
            const c = nbPricing(pkg, attendees);
            summaryEl.innerHTML = `
      <dl class="ps">
        <div class="ps__row ps__row--total"><dt>Total (custom price)</dt><dd class="num">${money(c.total)}</dd></div>
        <div class="ps__row"><dt>Down payment (${Math.round(getDepositRate() * 100)}%)</dt><dd class="num">${money(c.deposit)}</dd></div>
      </dl>`;
            return;
        }
        const c = computeBookingPrice({ pkgPrice: pkg.price || 0, attendees });
        summaryEl.innerHTML = `
      <dl class="ps">
        <div class="ps__row"><dt>${esc(pkg.name)} package</dt><dd class="num">${money(pkg.price)}</dd></div>
        <div class="ps__row"><dt>Base fee</dt><dd class="num">${money(c.base)}</dd></div>
        <div class="ps__row"><dt>Attendees (${attendees} × ${money(c.perPerson)})</dt><dd class="num">${money(c.attendeeFee)}</dd></div>
        <div class="ps__row ps__row--total"><dt>Total</dt><dd class="num">${money(c.total)}</dd></div>
        <div class="ps__row"><dt>Down payment (${Math.round(getDepositRate() * 100)}%)</dt><dd class="num">${money(c.deposit)}</dd></div>
      </dl>`;
    }
    /**
     * Prefills the end time from the chosen package's length, unless the admin typed one.
     * An "Entire day" package has no length to add: the times are left for the admin to enter
     * (an end time that was only prefilled from a previous package is cleared).
     */
    function prefillNewBookingEnd() {
        const endEl = $('#nbEnd');
        const start = $('#nbStart').value;
        if (!endEl || !start)
            return;
        if (!nbEndAuto && endEl.value)
            return;
        const pkg = nbSelectedPackage();
        if (!pkg)
            return;
        if (pkg.full_day) {
            endEl.value = '';
            nbEndAuto = true;
            return;
        }
        const minutes = Number(pkg.duration_minutes);
        const end = addMinutes(start, minutes);
        if (end) {
            endEl.value = end;
            nbEndAuto = true;
            if (endEl.getAttribute('aria-invalid') === 'true' && end > start)
                endEl.removeAttribute('aria-invalid');
        }
    }
    function openNewBooking() {
        if (!isLoaded('bookings'))
            return;
        if (st().getLoadStatus?.('pricing') !== 'loaded') {
            toast("Pricing hasn't loaded, so a booking total can't be worked out yet. Retry it on the Payment page first.", { type: 'error' });
            return;
        }
        ['#nbFirst', '#nbLast', '#nbEmail', '#nbPhone', '#nbDate', '#nbStart', '#nbEnd', '#nbLocation', '#nbNotes', '#nbCustomPrice'].forEach(id => {
            const el = $(id);
            if (el)
                el.value = '';
        });
        $('#nbAttendees').value = 1;
        $('#nbError').textContent = '';
        $('#nbSave').disabled = false;
        nbEndAuto = true;
        clearInvalid('#newBookingModal');
        const pkgSelect = $('#nbPackage');
        if (pkgSelect) {
            pkgSelect.innerHTML = getAvailablePackages().map(p => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)}</option>`).join('')
                + '<option value="none">No package (custom price)</option>';
        }
        clearPayError($('#nbCustomPrice'));
        syncNbCustomPriceField();
        renderNewBookingSummary();
        if (!isOpen('#newBookingModal'))
            lastFocus = document.activeElement;
        $('#newBookingModal').classList.add('open');
        $('#nbFirst').focus();
    }
    function closeNewBooking() {
        $('#newBookingModal')?.classList.remove('open');
        if (lastFocus && typeof lastFocus.focus === 'function' && lastFocus.isConnected)
            lastFocus.focus();
        lastFocus = null;
    }
    function createBooking() {
        const fv = window.R59.formValidation;
        const err = formError('#nbError', '#newBookingModal');
        clearInvalid('#newBookingModal');
        $('#nbError').textContent = '';
        const first = $('#nbFirst').value.trim();
        const last = $('#nbLast').value.trim();
        const email = $('#nbEmail').value.trim();
        const rawPhone = $('#nbPhone').value.trim();
        const phone = rawPhone && fv?.cleanPhone ? fv.cleanPhone(rawPhone) : rawPhone;
        const attendees = parseInt($('#nbAttendees').value, 10);
        const date = $('#nbDate').value;
        const start = $('#nbStart').value;
        const end = $('#nbEnd').value;
        const pkg = nbSelectedPackage();
        if (!first)
            return err('Please enter a first name.', '#nbFirst');
        if (!last)
            return err('Please enter a last name.', '#nbLast');
        if (!fv.isValidEmail(email))
            return err('Please enter a valid email address.', '#nbEmail');
        if (!fv.isValidPhone(phone))
            return err('Please enter a valid phone number (10+ digits).', '#nbPhone');
        if (!(attendees >= 1))
            return err('Number of attendees must be at least 1.', '#nbAttendees');
        if (!date || !fv.isValidISODate(date))
            return err('Please choose a valid date for the booking.', '#nbDate');
        if (!start)
            return err('Please choose a start time.', '#nbStart');
        if (!end)
            return err('Add an end time.', '#nbEnd');
        if (end <= start)
            return err('End time must be after start time.', '#nbEnd');
        const blocked = st().getBlockedDates().find(b => (b.dateStr || b.date) === date);
        if (blocked)
            return err(`That date is blocked (${blocked.reason || 'Unavailable'}). Unblock it first or pick another date.`, '#nbDate');
        if (!pkg)
            return err('That package is no longer available. Choose another or No package.', '#nbPackage');
        if (pkg.none) {
            const priceEl = $('#nbCustomPrice');
            if (priceEl && !window.R59.formValidation.validate(priceEl)) {
                priceEl.focus();
                return false;
            }
        }
        const c = nbPricing(pkg, attendees);
        const parts = dateParts(date);
        const customer = `${first} ${last}`;
        window.R59.confirmation.confirmSaveBooking(customer, parts.formatted, true, async () => {
            const saveBtn = $('#nbSave');
            saveBtn.disabled = true;
            const location = $('#nbLocation').value.trim();
            const notes = $('#nbNotes').value.trim();
            const packageId = pkg.none ? null : pkg.id;
            const payload = {
                client_name: customer,
                client_email: email,
                phone,
                location,
                notes,
                people: attendees,
                date,
                startTime: start,
                endTime: end,
                packageId: packageId === null ? 'none' : packageId,
                totalPrice: c.total,
                deposit: c.deposit,
                status: 'confirmed'
            };
            if (packageId === null)
                payload.custom_price = Math.round(c.total * 100);
            try {
                const res = await window.R59.bookingsApi.createBooking(payload);
                const id = res?.id ?? res?.data?.id;
                if (id === undefined || id === null) {
                    // Saved on the server, but the reply had no id: reload the list from the server
                    await window.R59.app?.reloadArea?.('bookings');
                }
                else {
                    const booking = {
                        id,
                        service_id: packageId,
                        packageId,
                        slot_id: res?.data?.slot_id,
                        date,
                        dateFormatted: parts.formatted,
                        dateLabel: parts.label,
                        time: start,
                        start_time: start,
                        end_time: end,
                        customer,
                        email,
                        phone,
                        location,
                        notes,
                        people: attendees,
                        attendees,
                        coupon: '',
                        package: packageId === null ? st().NO_PACKAGE : pkg.name,
                        price: c.total,
                        deposit: c.deposit,
                        priceCents: Math.round(c.total * 100),
                        depositCents: Math.round(c.deposit * 100),
                        paymentsTotal: 0,
                        paymentsCount: 0,
                        squarePaymentId: '',
                        status: 'Confirmed'
                    };
                    booking.timeRange = bookingTimeText(booking);
                    st().getBookings().push(booking);
                }
                if (isOpen('#newBookingModal'))
                    closeNewBooking();
                refreshBookingViews();
                toast(`Booking created for ${customer}`, { type: 'success' });
            }
            catch (e) {
                const msg = `Couldn't create the booking. ${e.message}`;
                if (isOpen('#newBookingModal'))
                    $('#nbError').textContent = msg;
                else if (e.status !== 401)
                    toast(msg, { type: 'error' });
            }
            finally {
                saveBtn.disabled = false;
            }
        });
        return true;
    }
    /* ---------- Listeners ---------- */
    function initScheduleListeners() {
        ['Day', 'Week', 'Month'].forEach(v => {
            document.getElementById(`calBtn${v}`)?.addEventListener('click', e => {
                e.preventDefault();
                currentCalView = v.toLowerCase();
                renderCalendar();
            });
        });
        $('#calPrev')?.addEventListener('click', e => { e.preventDefault(); moveCalendar(-1); });
        $('#calNext')?.addEventListener('click', e => { e.preventDefault(); moveCalendar(1); });
        $('#btnBlockDate')?.addEventListener('click', addBlockedDate);
        $('#blockDateInput')?.addEventListener('input', e => {
            if (e.target.getAttribute('aria-invalid') === 'true')
                setFieldError(e.target, '');
        });
        $('#btnAddBooking')?.addEventListener('click', openNewBooking);
        $('#btnClearCancelled')?.addEventListener('click', e => {
            const ids = st().getBookings().filter(b => statusKey(b) === 'cancelled').map(b => b.id);
            if (ids.length)
                promptClearCancelled('', ids, e.currentTarget);
        });
        // New booking modal
        $('#nbCancel')?.addEventListener('click', closeNewBooking);
        $('#nbSave')?.addEventListener('click', createBooking);
        $('#nbAttendees')?.addEventListener('input', renderNewBookingSummary);
        $('#nbPackage')?.addEventListener('change', () => { syncNbCustomPriceField(); renderNewBookingSummary(); prefillNewBookingEnd(); });
        window.R59.formValidation?.bind($('#nbCustomPrice'), nbCustomPriceRule);
        $('#nbCustomPrice')?.addEventListener('input', renderNewBookingSummary);
        $('#nbStart')?.addEventListener('change', prefillNewBookingEnd);
        $('#nbEnd')?.addEventListener('input', e => { nbEndAuto = !e.target.value; });
        $('#newBookingModal')?.addEventListener('click', e => {
            if (e.target.id === 'newBookingModal')
                closeNewBooking();
        });
        // Edit booking modal
        const bkStatusEl = $('#bkStatus');
        bkStatusEl?.addEventListener('change', () => {
            const b = findBooking(editingBookingId);
            const warn = $('#bkRefundNote');
            if (warn)
                warn.hidden = !(bkStatusEl.value === 'Cancelled' && b && statusKey(b) !== 'cancelled');
        });
        $('#bkSave')?.addEventListener('click', saveBookingEdit);
        initPaymentListeners();
        $('#bkCancel')?.addEventListener('click', closeBookingEditor);
        $('#bookingModal')?.addEventListener('click', e => {
            if (e.target.id === 'bookingModal')
                closeBookingEditor();
        });
        // Clear a field's invalid mark as soon as the admin edits it
        ['#newBookingModal', '#bookingModal'].forEach(sel => {
            $(sel)?.addEventListener('input', e => {
                // Payment and custom-price fields keep formValidation's inline messages, so leave them alone
                if (e.target.closest && e.target.closest('#paySection, #nbCustomPriceField'))
                    return;
                if (e.target.getAttribute && e.target.getAttribute('aria-invalid') === 'true')
                    e.target.removeAttribute('aria-invalid');
            });
        });
        // Delegated clicks for rendered rows, calendar events and the timeframe editor
        document.addEventListener('click', e => {
            const target = e.target instanceof Element ? e.target : e.target?.parentElement;
            if (!target)
                return;
            const hit = sel => target.closest(sel);
            let el;
            if ((el = hit('[data-open-booking]'))) {
                e.preventDefault();
                openBookingEditor(el.dataset.openBooking);
                return;
            }
            if ((el = hit('[data-edit-booking]'))) {
                e.preventDefault();
                openBookingEditor(el.dataset.editBooking);
                return;
            }
            if ((el = hit('[data-cancel-booking]'))) {
                e.preventDefault();
                promptCancelBooking(el.dataset.cancelBooking);
                return;
            }
            if ((el = hit('[data-delete-booking]'))) {
                e.preventDefault();
                promptRemoveBooking(el.dataset.deleteBooking);
                return;
            }
            if ((el = hit('[data-select-day]'))) {
                e.preventDefault();
                selectDayView(el.dataset.selectDay);
                return;
            }
            if ((el = hit('[data-select-cal-date]'))) {
                e.preventDefault();
                selectCalendarDate(el.dataset.selectCalDate);
                return;
            }
            if ((el = hit('[data-add-timeframe-day]'))) {
                e.preventDefault();
                showAddTimeframe(el.dataset.addTimeframeDay);
                return;
            }
            if ((el = hit('[data-save-timeframe-day]'))) {
                e.preventDefault();
                saveTimeframe(el.dataset.saveTimeframeDay);
                return;
            }
            if ((el = hit('[data-cancel-timeframe]'))) {
                e.preventDefault();
                cancelTimeframe();
                return;
            }
            if ((el = hit('[data-edit-timeframe-day]'))) {
                e.preventDefault();
                editTimeframe(el.dataset.editTimeframeDay, Number(el.dataset.editTimeframeId));
                return;
            }
            if ((el = hit('[data-remove-timeframe-day]'))) {
                e.preventDefault();
                removeTimeframe(el.dataset.removeTimeframeDay, Number(el.dataset.removeTimeframeId));
                return;
            }
            if ((el = hit('[data-remove-block]'))) {
                e.preventDefault();
                removeBlockedDate(el.dataset.removeBlock);
            }
        });
        // Enter in the timeframe editor saves it; Escape cancels it
        $('#availabilityList')?.addEventListener('keydown', e => {
            if (!editingTimeframeDay || !e.target.closest('.tf-form'))
                return;
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
                saveTimeframe(editingTimeframeDay);
            }
            else if (e.key === 'Escape') {
                e.preventDefault();
                cancelTimeframe();
            }
        });
    }
    function selectCalendarDate(ds) {
        selectedDayDate = ds;
        renderCalendar();
        document.querySelector(`#calendarDisplay [data-select-cal-date="${CSS.escape(ds)}"]`)?.focus();
    }
    function selectDayView(ds) {
        selectedDayDate = ds;
        currentCalView = 'day';
        renderCalendar();
        (document.querySelector('#calendarDisplay .chip[aria-pressed="true"]') || $('#calBtnDay'))?.focus();
    }
    window.R59 = window.R59 || {};
    window.R59.schedule = {
        renderCalendar,
        renderAvailability,
        renderBlockedDates,
        renderBookings,
        refreshBookingViews,
        buildMonthGridHTML,
        bookingsGroupedHTML,
        syncClearCancelledButtons,
        loadErrorHTML,
        loadingHTML,
        emptyHTML,
        selectCalendarDate,
        selectDayView,
        showAddTimeframe,
        editTimeframe,
        cancelTimeframe,
        saveTimeframe,
        removeTimeframe,
        removeBlockedDate,
        promptRemoveBooking,
        promptCancelBooking,
        promptClearCancelled,
        openBookingEditor,
        closeBookingEditor,
        loadPayments,
        recordPayment,
        promptRemovePayment,
        openNewBooking,
        closeNewBooking,
        initScheduleListeners
    };
    // Legacy globals kept for existing callers
    window.renderCalendar = renderCalendar;
    window.renderAvailability = renderAvailability;
    window.renderBlockedDates = renderBlockedDates;
    window.renderBookings = renderBookings;
    window.selectCalendarDate = selectCalendarDate;
    window.selectDayView = selectDayView;
    window.showAddTimeframe = showAddTimeframe;
    window.editTimeframe = editTimeframe;
    window.cancelTimeframe = cancelTimeframe;
    window.saveTimeframe = saveTimeframe;
    window.removeTimeframe = removeTimeframe;
    window.removeBlockedDate = removeBlockedDate;
    window.openBookingEditor = openBookingEditor;
    window.promptRemoveBooking = promptRemoveBooking;
    window.promptCancelBooking = promptCancelBooking;
})();
