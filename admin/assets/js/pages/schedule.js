/**
 * R59 Media Admin — Schedule, Availability & Bookings Page Module
 * 
 * Manages calendar Day/Week/Month views, date navigation, weekly availability rules,
 * blocked dates, customer bookings management, and booking creation/edit modals.
 */

(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => window.R59.formValidation?.escapeHtml(s) || String(s);

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  let currentCalView = 'month';
  let selectedDayDate = toISODate(new Date());

  let nextTimeframeId = 100;
  let editingTimeframeDay = null;
  let editingTimeframeId = null;

  let editingBookingId = null;
  let nbCoupon = null;
  let lastFocus = null;

  /* ---------- Date Utilities ---------- */
  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function fromISODate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
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

  function formatLongDate(date) {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function formatMonthYear(date) {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function formatWeekRange(start, end) {
    const sameYear = start.getFullYear() === end.getFullYear();
    const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
    return sameYear
      ? `${startLabel} – ${endLabel}, ${end.getFullYear()}`
      : `${startLabel}, ${start.getFullYear()} – ${endLabel}`;
  }

  function formatTime12h(time24) {
    if (!time24) return '';
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
  }

  function to24(str) {
    if (!str) return '';
    const s = String(str).trim();
    const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (m12) {
      let h = parseInt(m12[1], 10);
      const min = m12[2];
      const ampm = m12[3].toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${min}`;
    }
    const m24 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m24) {
      return `${String(parseInt(m24[1], 10)).padStart(2, '0')}:${m24[2]}`;
    }
    return '';
  }

  function from24(t) {
    const t24 = to24(t);
    if (!t24) return String(t || '');
    const [h, m] = t24.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }

  function money(n) {
    const v = Number(n || 0);
    return '$' + v.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
      maximumFractionDigits: 2
    });
  }

  const round2 = n => Math.round(n * 100) / 100;
  const bookingSortKey = b => b.date + ' ' + (to24(b.time) || '00:00');

  /* ---------- Calendar Rendering (Day / Week / Month) ---------- */
  function renderCalendar() {
    const container = $('#calendarDisplay');
    const label = $('#calActiveRange');
    const prevBtn = $('#calPrev');
    const nextBtn = $('#calNext');
    if (!container) return;

    ['Day', 'Week', 'Month'].forEach(v => {
      const btn = document.getElementById(`calBtn${v}`);
      if (btn) {
        const isActive = currentCalView === v.toLowerCase();
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
      }
    });

    const selectedDate = fromISODate(selectedDayDate);

    if (currentCalView === 'month') {
      if (label) label.textContent = formatMonthYear(selectedDate);
      if (prevBtn) prevBtn.setAttribute('aria-label', 'Previous month');
      if (nextBtn) nextBtn.setAttribute('aria-label', 'Next month');
      renderMonthCalendar(container);
    } else if (currentCalView === 'week') {
      const start = startOfWeek(selectedDate);
      const end = endOfWeek(selectedDate);
      if (label) label.textContent = formatWeekRange(start, end);
      if (prevBtn) prevBtn.setAttribute('aria-label', 'Previous week');
      if (nextBtn) nextBtn.setAttribute('aria-label', 'Next week');
      renderWeekCalendar(container);
    } else {
      if (label) label.textContent = formatLongDate(selectedDate).toUpperCase();
      if (prevBtn) prevBtn.setAttribute('aria-label', 'Previous day');
      if (nextBtn) nextBtn.setAttribute('aria-label', 'Next day');
      renderDayCalendar(container);
    }
  }

  function buildMonthGridHTML(year, month, opts = {}) {
    const firstDayOffset = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((firstDayOffset + daysInMonth) / 7) * 7;
    const todayStr = toISODate(new Date());

    const bookings = window.R59.state.getBookings();
    const blockedList = window.R59.state.getBlockedDates();

    let html = '<div class="cal-month-grid">';
    DAYS_OF_WEEK.forEach(d => {
      html += `<div class="cal-day-header">${d}</div>`;
    });

    const isOverviewMode = opts.chipAction === 'edit' || (!opts.selectedStr && !opts.selectable);

    for (let i = 0; i < totalCells; i++) {
      const cellDate = new Date(year, month, i - firstDayOffset + 1);
      const dateStr = toISODate(cellDate);
      const isCurrentMonth = cellDate.getMonth() === month;
      const dayBookings = bookings.filter(b => b.date === dateStr);
      const blocked = blockedList.find(b => (b.dateStr || b.date) === dateStr);
      const hasBookings = dayBookings.length > 0;
      const isSelected = dateStr === opts.selectedStr;
      const isToday = dateStr === todayStr;
      const cellAttr = !isOverviewMode ? ` data-select-cal-date="${esc(dateStr)}"` : '';

      const chipsHtml = dayBookings.map(b => {
        const rawStatus = String(b.status || 'pending').toLowerCase();
        const safeStatus = ['confirmed', 'cancelled', 'pending'].includes(rawStatus) ? rawStatus : 'pending';
        const chipAttr = isOverviewMode
          ? `data-open-booking="${esc(b.id)}"`
          : `data-select-day="${esc(b.date)}"`;
        return `
          <div class="cal-event-chip ${safeStatus === 'cancelled' ? 'cancelled' : ''}" role="button" tabindex="0" ${chipAttr} title="${esc(b.customer)} (${esc(b.package)})">
            <span class="cal-event-time">${esc(b.time)}</span>
            <strong class="cal-event-name">${esc(b.customer)}</strong>
            <span class="cal-event-pkg">${esc(b.package)}</span>
            <span class="status-badge status-${safeStatus}" style="font-size: 9px; padding: 1px 5px;">${esc(b.status || 'Pending')}</span>
          </div>
        `;
      }).join('');

      const blockedHtml = blocked ? `
        <div class="cal-blocked-tag">Blocked: ${esc(blocked.reason || 'Unavailable')}</div>
      ` : '';

      html += `
        <div class="cal-day-cell ${!isCurrentMonth ? 'other-month' : ''} ${hasBookings ? 'has-booking' : ''} ${blocked ? 'cal-blocked' : ''} ${isSelected ? 'cal-selected' : ''}" role="button" tabindex="0"${cellAttr}>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="cal-day-num">${cellDate.getDate()}</span>
            ${isToday ? '<span class="status-badge status-available" style="font-size:9px;padding:1px 5px;">Today</span>' : ''}
            ${hasBookings ? `<span class="hint" style="font-size: 10px; color: var(--yellow);">${dayBookings.length}</span>` : ''}
          </div>
          ${blockedHtml}
          ${chipsHtml}
        </div>
      `;
    }
    html += '</div>';
    return html;
  }

  function renderMonthCalendar(container) {
    const selectedDate = fromISODate(selectedDayDate);
    container.innerHTML = buildMonthGridHTML(selectedDate.getFullYear(), selectedDate.getMonth(), {
      selectedStr: selectedDayDate,
      selectable: true
    });
  }

  function renderWeekCalendar(container) {
    const selectedDate = fromISODate(selectedDayDate);
    const start = startOfWeek(selectedDate);
    const bookings = window.R59.state.getBookings();
    const blockedList = window.R59.state.getBlockedDates();

    const weekDays = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      return {
        name: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dateNum: date.getDate(),
        dateStr: toISODate(date)
      };
    });

    let html = '<div class="cal-week-grid">';
    weekDays.forEach(wd => {
      const dayBookings = bookings.filter(b => b.date === wd.dateStr);
      const blocked = blockedList.find(b => (b.dateStr || b.date) === wd.dateStr);
      const isSelected = selectedDayDate === wd.dateStr;

      const eventsHtml = dayBookings.length > 0
        ? dayBookings.map(b => {
          const rawStatus = String(b.status || 'pending').toLowerCase();
          const safeStatus = ['confirmed', 'cancelled', 'pending'].includes(rawStatus) ? rawStatus : 'pending';
          return `
            <div class="cal-event-chip ${safeStatus === 'cancelled' ? 'cancelled' : ''}" role="button" tabindex="0" data-select-day="${esc(b.date)}" style="padding: 8px;">
              <span class="cal-event-time">${esc(b.timeRange || b.time)}</span>
              <strong class="cal-event-name" style="font-size: 13px;">${esc(b.customer)}</strong>
              <span class="cal-event-pkg" style="font-size: 11px;">${esc(b.package)}</span>
              <div style="margin-top: 4px;">
                <span class="status-badge status-${safeStatus}">${esc(b.status || 'Pending')}</span>
              </div>
            </div>
          `;
        }).join('')
        : blocked
          ? `<div class="cal-blocked-tag" style="margin-top: 10px; text-align: center;">Blocked: ${esc(blocked.reason || 'Unavailable')}</div>`
          : '<span class="hint" style="font-size: 12px; text-align: center; margin-top: 20px;">No bookings</span>';

      html += `
        <div class="cal-week-col ${blocked ? 'cal-blocked' : ''} ${isSelected ? 'cal-selected' : ''}" role="button" tabindex="0" data-select-cal-date="${esc(wd.dateStr)}">
          <div class="cal-week-col-head">
            <div class="cal-week-col-name">${wd.name}</div>
            <div class="cal-week-col-date">${wd.dateNum}</div>
          </div>
          ${eventsHtml}
        </div>
      `;
    });
    html += '</div>';
    container.innerHTML = html;
  }

  function renderDayCalendar(container) {
    const bookings = window.R59.state.getBookings();
    const blockedList = window.R59.state.getBlockedDates();

    const datesWithBookings = [...new Set(bookings.map(b => b.date))];
    const navPillsHtml = datesWithBookings.length > 0 ? `
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
        ${datesWithBookings.map(d => {
          const b = bookings.find(item => item.date === d);
          const isSelected = selectedDayDate === d;
          return `
            <button type="button" class="btn btn-sm ${isSelected ? 'btn-primary' : ''}" data-select-day="${esc(d)}">
              ${b ? esc(b.dateLabel || d) : esc(d)}
            </button>
          `;
        }).join('')}
      </div>
    ` : '';

    const hours = [
      { label: '09:00 AM', time24: '09:00' },
      { label: '10:00 AM', time24: '10:00' },
      { label: '11:00 AM', time24: '11:00' },
      { label: '12:00 PM', time24: '12:00' },
      { label: '01:00 PM', time24: '13:00' },
      { label: '02:00 PM', time24: '14:00' },
      { label: '03:00 PM', time24: '15:00' },
      { label: '04:00 PM', time24: '16:00' },
      { label: '05:00 PM', time24: '17:00' }
    ];

    const dayBookings = bookings.filter(b => b.date === selectedDayDate);
    const isBlocked = blockedList.find(b => (b.dateStr || b.date) === selectedDayDate);

    let timelineHtml = '<div class="cal-day-timeline">';
    if (isBlocked) {
      timelineHtml += `
        <div style="background: rgba(255, 34, 34, 0.1); border: 1px solid var(--red); padding: 12px; border-radius: 6px; margin-bottom: 8px;">
          <strong style="color: var(--red);">Date Blocked:</strong> ${esc(isBlocked.reason || 'Unavailable')} — No bookings allowed.
        </div>
      `;
    }

    hours.forEach(hr => {
      const b = dayBookings.find(item => {
        const t24 = to24(item.time || item.start_time);
        if (!t24) return false;
        const bHour = parseInt(t24.split(':')[0], 10);
        const hrVal = parseInt(hr.time24.split(':')[0], 10);
        return bHour === hrVal;
      });

      if (b) {
        const rawStatus = (b.status || 'pending').toLowerCase();
        const statusClass = ['confirmed', 'pending', 'cancelled'].includes(rawStatus) ? rawStatus : 'pending';
        timelineHtml += `
          <div class="cal-timeline-row" style="border-left: 3px solid var(--yellow); background: rgba(255, 204, 34, 0.05);">
            <div class="cal-timeline-time">${hr.label}</div>
            <div class="cal-timeline-content">
              <div>
                <div style="font-weight: 700; font-size: 14px;">${esc(b.customer)} — ${esc(b.package)}</div>
                <div class="hint">${esc(b.timeRange || b.time)} · Price: ${money(b.price)} · Down Payment: ${money(b.deposit)} · Balance: ${money(b.price - b.deposit)}</div>
              </div>
              <div>
                <span class="status-badge status-${statusClass}">${esc(b.status || 'Pending')}</span>
              </div>
            </div>
          </div>
        `;
      } else {
        timelineHtml += `
          <div class="cal-timeline-row">
            <div class="cal-timeline-time">${hr.label}</div>
            <div class="cal-timeline-content">
              <span class="hint" style="color: var(--muted);">Available slot</span>
              <span class="status-badge status-available">Open</span>
            </div>
          </div>
        `;
      }
    });
    timelineHtml += '</div>';

    container.innerHTML = navPillsHtml + timelineHtml;
  }

  function moveCalendar(delta) {
    const date = fromISODate(selectedDayDate);
    if (currentCalView === 'day') {
      date.setDate(date.getDate() + delta);
    } else if (currentCalView === 'week') {
      date.setDate(date.getDate() + (delta * 7));
    } else {
      const day = date.getDate();
      date.setDate(1);
      date.setMonth(date.getMonth() + delta);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      date.setDate(Math.min(day, lastDay));
    }
    selectedDayDate = toISODate(date);
    renderCalendar();
  }

  /* ---------- Booking Availability ---------- */
  function renderAvailability() {
    const container = $('#availabilityList');
    if (!container) return;

    const availability = window.R59.state.getAvailability();

    container.innerHTML = availability.map(item => {
      const isEditingThisDay = editingTimeframeDay === item.day;
      const slotsHtml = (item.available && item.timeframes && item.timeframes.length > 0)
        ? `
          <div class="avail-slots-list">
            ${item.timeframes.map(tf => `
              <div class="avail-slot-row">
                <div>
                  <strong>${esc(tf.label)}</strong>
                  <span class="tf-badge ${tf.repeat === 'weekly' ? 'tf-repeat' : 'tf-norepeat'}" style="margin-left: 6px;">
                    ${tf.repeat === 'weekly' ? 'Repeat weekly' : 'Does not repeat'}
                  </span>
                </div>
                <div class="avail-slot-actions">
                  <button type="button" class="btn btn-sm" data-edit-timeframe-day="${esc(item.day)}" data-edit-timeframe-id="${Number(tf.id)}" style="padding: 3px 8px; font-size: 11px;">Edit</button>
                  <button type="button" class="btn btn-danger btn-sm" data-remove-timeframe-day="${esc(item.day)}" data-remove-timeframe-id="${Number(tf.id)}" style="padding: 3px 8px; font-size: 11px;">Remove</button>
                </div>
              </div>
            `).join('')}
          </div>
        `
        : `<div class="hint" style="color: var(--muted); font-size: 13px;">Unavailable</div>`;

      let currentRepeat = 'weekly';
      let currentStart = '09:00';
      let currentEnd = '17:00';

      if (editingTimeframeId) {
        const tf = item.timeframes?.find(t => t.id === editingTimeframeId);
        if (tf) {
          currentStart = tf.start;
          currentEnd = tf.end;
          currentRepeat = tf.repeat || 'weekly';
        }
      }

      const formHtml = isEditingThisDay ? `
        <div class="timeframe-form">
          <div style="font-weight: 700; font-size: 13px; color: var(--accent-text);">
            ${editingTimeframeId ? 'Edit Timeframe' : 'Add Timeframe'} for ${esc(item.day)}
          </div>
          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            <div>
              <label class="f" style="margin: 0 0 4px; font-size: 11px;">Start Time</label>
              <input type="time" class="input" id="tfStart" style="width: auto; padding: 6px 8px;" value="${esc(currentStart)}">
            </div>
            <div>
              <label class="f" style="margin: 0 0 4px; font-size: 11px;">End Time</label>
              <input type="time" class="input" id="tfEnd" style="width: auto; padding: 6px 8px;" value="${esc(currentEnd)}">
            </div>
          </div>
          <div>
            <div class="hint" style="font-weight: 600; margin-bottom: 6px; color: var(--text-soft);">Repeat:</div>
            <div style="display: flex; gap: 16px; align-items: center;">
              <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                <input type="radio" name="tfRepeat" id="tfRepeatNone" value="none" ${currentRepeat === 'none' ? 'checked' : ''} style="accent-color: var(--yellow);">
                Does not repeat
              </label>
              <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                <input type="radio" name="tfRepeat" id="tfRepeatWeekly" value="weekly" ${currentRepeat === 'weekly' ? 'checked' : ''} style="accent-color: var(--yellow);">
                Repeat weekly
              </label>
            </div>
          </div>
          <div class="row" style="gap: 8px;">
            <button type="button" class="btn btn-primary btn-sm" data-save-timeframe-day="${esc(item.day)}">Save Timeframe</button>
            <button type="button" class="btn btn-sm" data-cancel-timeframe="true">Cancel</button>
          </div>
        </div>
      ` : '';

      return `
        <div class="avail-day-card">
          <div class="avail-day-head">
            <div class="avail-day-title">
              <strong>${esc(item.day)}</strong>
              <span class="status-badge ${item.available && item.timeframes?.length > 0 ? 'status-available' : 'status-unavailable'}">
                ${item.available && item.timeframes?.length > 0 ? 'Available' : 'Unavailable'}
              </span>
            </div>
            <button type="button" class="btn btn-sm" data-add-timeframe-day="${esc(item.day)}">+ Add Timeframe</button>
          </div>
          ${slotsHtml}
          ${formHtml}
        </div>
      `;
    }).join('');
  }

  function showAddTimeframe(day) {
    editingTimeframeDay = day;
    editingTimeframeId = null;
    renderAvailability();
  }

  function editTimeframe(day, id) {
    editingTimeframeDay = day;
    editingTimeframeId = id;
    renderAvailability();
  }

  function cancelTimeframe() {
    editingTimeframeDay = null;
    editingTimeframeId = null;
    renderAvailability();
  }

  function saveTimeframe(day) {
    const start = $('#tfStart')?.value || '09:00';
    const end = $('#tfEnd')?.value || '17:00';
    const repeatVal = $('input[name="tfRepeat"]:checked')?.value || 'weekly';

    const availability = window.R59.state.getAvailability();
    const item = availability.find(d => d.day === day);
    if (!item) return;

    item.timeframes = item.timeframes || [];
    const label = `${formatTime12h(start)} – ${formatTime12h(end)}`;

    if (editingTimeframeId) {
      const tf = item.timeframes.find(t => t.id === editingTimeframeId);
      if (tf) {
        tf.start = start;
        tf.end = end;
        tf.label = label;
        tf.repeat = repeatVal;
      }
      window.toast('Timeframe updated');
    } else {
      item.timeframes.push({
        id: ++nextTimeframeId,
        start,
        end,
        label,
        repeat: repeatVal
      });
      item.available = true;
      window.toast('Timeframe added');
    }

    editingTimeframeDay = null;
    editingTimeframeId = null;
    renderAvailability();
    window.R59.state.markDirty();
  }

  function removeTimeframe(day, id) {
    const availability = window.R59.state.getAvailability();
    const item = availability.find(d => d.day === day);
    if (!item) return;
    const timeframe = item.timeframes?.find(t => t.id === id);
    if (!timeframe) return;

    window.R59.confirmation.confirmRemoveTimeframe(timeframe.label, day, () => {
      item.timeframes = item.timeframes.filter(t => t.id !== id);
      if (item.timeframes.length === 0) item.available = false;
      renderAvailability();
      window.R59.state.markDirty();
      window.toast('Timeframe removed');
    });
  }

  /* ---------- Blocked Dates ---------- */
  function renderBlockedDates() {
    const container = $('#blockedDatesList');
    if (!container) return;

    const blocked = window.R59.state.getBlockedDates();

    if (blocked.length === 0) {
      container.innerHTML = '<p class="hint">No dates are currently blocked.</p>';
      return;
    }

    container.innerHTML = blocked.map(item => `
      <div class="blocked-date-item">
        <div>
          <div style="font-family: var(--display); font-size: 15px; font-weight: 700; color: var(--text);">${esc(item.dateFormatted || item.dateStr || item.date)}</div>
          <div class="hint" style="color: var(--muted);">${esc(item.reason || 'Blocked date')}</div>
        </div>
        <button type="button" class="btn btn-danger btn-sm" data-remove-block="${esc(item.id)}">Remove</button>
      </div>
    `).join('');
  }

  function removeBlockedDate(id) {
    const blockedList = window.R59.state.getBlockedDates();
    const removed = blockedList.find(b => String(b.id) === String(id));
    if (!removed) return;

    window.R59.confirmation.confirmRemoveBlockedDate(removed.dateFormatted || removed.dateStr || removed.date, () => {
      window.R59.state.setBlockedDates(blockedList.filter(b => String(b.id) !== String(id)));
      if (removed?.id && window.R59.api?.schedule?.removeBlockedDate) {
        window.R59.api.schedule.removeBlockedDate(removed.id).catch(err => console.warn('[schedule] Failed to remove blocked date:', err));
      }
      renderBlockedDates();
      renderCalendar();
      if (window.R59.dashboard?.renderOverview) window.R59.dashboard.renderOverview();
      window.R59.state.markDirty();
      window.toast('Date unblocked');
    });
  }

  function addBlockedDate() {
    const dateVal = $('#blockDateInput')?.value;
    const reasonVal = $('#blockReasonInput')?.value.trim();
    if (!dateVal || !window.R59.formValidation?.isValidISODate(dateVal)) {
      window.toast('Please choose a valid date to block');
      return;
    }

    const [y, m, d] = dateVal.split('-').map(Number);
    const dateFormatted = `${MONTH_NAMES[m - 1]} ${d}, ${y}`;

    const blockedList = window.R59.state.getBlockedDates();
    const newBlock = {
      id: Date.now(),
      date: dateVal,
      dateStr: dateVal,
      dateFormatted: dateFormatted,
      reason: reasonVal || 'Unavailable'
    };
    blockedList.push(newBlock);

    if (window.R59.api?.schedule?.addBlockedDate) {
      window.R59.api.schedule.addBlockedDate({ date: dateVal, reason: reasonVal || 'Unavailable' })
        .then(res => {
          if (res?.id) {
            newBlock.id = res.id;
            renderBlockedDates();
          }
        })
        .catch(err => console.warn('[schedule] Failed to add blocked date:', err));
    }

    $('#blockDateInput').value = '';
    $('#blockReasonInput').value = '';
    renderBlockedDates();
    renderCalendar();
    if (window.R59.dashboard?.renderOverview) window.R59.dashboard.renderOverview();
    window.R59.state.markDirty();

    const bookings = window.R59.state.getBookings();
    const existing = bookings.filter(b => b.date === dateVal && b.status !== 'Cancelled').length;
    window.toast(existing
      ? `Date blocked — note: ${existing} existing booking${existing > 1 ? 's' : ''} on that day ${existing > 1 ? 'are' : 'is'} not cancelled`
      : 'Date blocked');
  }

  /* ---------- Bookings List & Cards ---------- */
  function bookingCardHTML(b) {
    const balance = Math.max(0, (b.price || 0) - (b.deposit || 0));
    const isCancelled = b.status === 'Cancelled';
    const rawStatus = String(b.status || 'pending').toLowerCase();
    const safeStatus = ['confirmed', 'cancelled', 'pending'].includes(rawStatus) ? rawStatus : 'pending';
    return `
      <div class="booking-item ${isCancelled ? 'cancelled' : ''}">
        <div class="booking-head">
          <div>
            <div class="booking-time">${esc(b.time || '')}</div>
            <div class="booking-client">${esc(b.customer || 'Unknown Client')}</div>
            <div class="booking-pkg">${esc(b.package || 'Custom Session')}</div>
            ${(b.email || b.phone) ? `<div class="booking-pkg">${esc(b.email || '')}${b.email && b.phone ? ' · ' : ''}${esc(b.phone || '')}</div>` : ''}
            ${b.location ? `<div class="booking-pkg">Location: ${esc(b.location)}</div>` : ''}
            ${b.attendees ? `<div class="booking-pkg">${b.attendees} attendee${b.attendees > 1 ? 's' : ''}${b.coupon && typeof b.coupon === 'object' ? ` · Coupon ${esc(b.coupon.code)} (−${money(b.coupon.discount)})` : ''}</div>` : ''}
            ${b.notes ? `<div class="booking-notes">Notes: ${esc(b.notes)}</div>` : ''}
          </div>
          <div>
            <span class="status-badge status-${safeStatus}">${esc(b.status || 'Pending')}</span>
          </div>
        </div>

        <div class="booking-financials">
          <div class="financial-stat">
            <span>Session Price</span>
            <b>${money(b.price)}</b>
          </div>
          <div class="financial-stat">
            <span>Down Payment</span>
            <b>${money(b.deposit)}</b>
          </div>
          <div class="financial-stat">
            <span>Remaining Balance</span>
            <b>${money(balance)}</b>
          </div>
        </div>

        <div class="booking-foot">
          <button type="button" class="btn btn-sm" data-edit-booking="${esc(b.id)}">Edit</button>
          ${isCancelled
            ? `<button type="button" class="btn btn-danger btn-sm" data-delete-booking="${esc(b.id)}">Remove</button>`
            : `<button type="button" class="btn btn-danger btn-sm" data-cancel-booking="${esc(b.id)}">Cancel Booking</button>`}
        </div>
      </div>`;
  }

  function bookingsGroupedHTML(list, emptyMsg) {
    if (!list || list.length === 0) return `<p class="hint">${emptyMsg}</p>`;
    const sorted = [...list].sort((x, y) => bookingSortKey(x).localeCompare(bookingSortKey(y)));
    const grouped = new Map();
    sorted.forEach(b => {
      const label = b.dateLabel || b.date;
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(b);
    });

    return [...grouped.entries()].map(([dateKey, items]) => `
      <div class="booking-group">
        <div class="booking-date-head">
          <span>${esc(dateKey)}</span>
          <span class="hint">${items.length} booking${items.length > 1 ? 's' : ''}</span>
        </div>
        ${items.map(bookingCardHTML).join('')}
      </div>`).join('');
  }

  function renderBookings() {
    const container = $('#bookingsList');
    const bookings = window.R59.state.getBookings();
    if (container) {
      container.innerHTML = bookingsGroupedHTML(bookings, 'No bookings scheduled.');
    }
    syncClearCancelledButtons();
    if (window.R59.dashboard?.renderOverview) {
      window.R59.dashboard.renderOverview();
    }
  }

  function syncClearCancelledButtons() {
    const bookings = window.R59.state.getBookings();
    const allCancelled = bookings.filter(b => b.status === 'Cancelled');
    const setBtn = (sel, count, label) => {
      const el = $(sel);
      if (!el) return;
      el.style.display = count > 0 ? '' : 'none';
      el.textContent = `${label} (${count})`;
    };
    setBtn('#btnClearCancelled', allCancelled.length, 'Clear all cancelled');

    const ovYear = window.R59.dashboard?.getYear ? window.R59.dashboard.getYear() : new Date().getFullYear();
    const ovMonth = window.R59.dashboard?.getMonth ? window.R59.dashboard.getMonth() : new Date().getMonth();
    const monthCancelled = allCancelled.filter(b => {
      const [y, m] = b.date.split('-').map(Number);
      return y === ovYear && (m - 1) === ovMonth;
    });
    setBtn('#ovClearCancelled', monthCancelled.length, 'Clear cancelled');
  }

  function promptRemoveBooking(id) {
    const bookings = window.R59.state.getBookings();
    const b = bookings.find(item => String(item.id) === String(id));
    if (!b || b.status !== 'Cancelled') return;

    window.R59.confirmation.confirmRemoveBooking(b, () => {
      window.R59.state.setBookings(bookings.filter(item => String(item.id) !== String(id)));
      if (window.R59.api?.bookings?.deleteBooking) {
        window.R59.api.bookings.deleteBooking(id).catch(err => console.warn('[schedule] Failed to delete booking:', err));
      }
      refreshBookingViews();
      window.toast('Cancelled booking removed');
    });
  }

  function promptCancelBooking(id) {
    const bookings = window.R59.state.getBookings();
    const b = bookings.find(item => String(item.id) === String(id));
    if (!b || b.status === 'Cancelled') return;

    window.R59.confirmation.confirmCancelBooking(b, () => {
      b.status = 'Cancelled';
      if (window.R59.api?.bookings?.cancelBooking) {
        window.R59.api.bookings.cancelBooking(id).catch(err => console.warn('[schedule] Failed to cancel booking:', err));
      }
      refreshBookingViews();
      window.toast(`Booking cancelled — ${money(b.deposit)} down payment marked for reimbursement`);
    });
  }

  function promptClearCancelled(scopeLabel, ids) {
    window.R59.confirmation.confirmClearCancelled(ids.length, scopeLabel, () => {
      const bookings = window.R59.state.getBookings();
      const strIds = ids.map(String);
      window.R59.state.setBookings(bookings.filter(b => !strIds.includes(String(b.id))));
      if (window.R59.api?.bookings?.deleteBooking) {
        ids.forEach(id => {
          window.R59.api.bookings.deleteBooking(id).catch(err => console.warn('[schedule] Failed to clear booking:', err));
        });
      }
      refreshBookingViews();
      window.toast(`${ids.length} cancelled booking${ids.length > 1 ? 's' : ''} cleared`);
    });
  }

  function refreshBookingViews() {
    renderBookings();
    renderCalendar();
  }

  /* ---------- Booking Edit Modal ---------- */
  function openBookingEditor(id) {
    const bookings = window.R59.state.getBookings();
    const b = bookings.find(item => String(item.id) === String(id));
    if (!b) return;

    editingBookingId = b.id;
    $('#bkCustomer').value = b.customer || '';
    $('#bkPackage').value = b.package || '';
    $('#bkLocation').value = b.location || '';
    $('#bkNotes').value = b.notes || '';
    $('#bkEmail').value = b.email || '';
    $('#bkPhone').value = b.phone || '';
    $('#bkAttendees').value = b.attendees || '';
    $('#bkDate').value = b.date || '';
    $('#bkStart').value = to24(b.time);
    $('#bkEnd').value = to24(b.end_time || (b.timeRange || '').split(/[-–]/)[1] || '');
    $('#bkPrice').value = b.price || 0;
    $('#bkDeposit').value = b.deposit || 0;
    $('#bkStatus').value = b.status || 'Pending';
    $('#bkError').textContent = '';
    $('#bkRefundNote').style.display = 'none';

    lastFocus = document.activeElement;
    $('#bookingModal').classList.add('open');
    $('#bkCustomer').focus();
  }

  function closeBookingEditor() {
    $('#bookingModal')?.classList.remove('open');
    editingBookingId = null;
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function saveBookingEdit() {
    const bookings = window.R59.state.getBookings();
    const b = bookings.find(item => String(item.id) === String(editingBookingId));
    if (!b) return closeBookingEditor();

    const customer = $('#bkCustomer').value.trim();
    const pkg = $('#bkPackage').value.trim();
    const date = $('#bkDate').value;
    const start = $('#bkStart').value;
    const end = $('#bkEnd').value;
    const price = parseFloat($('#bkPrice').value);
    const deposit = parseFloat($('#bkDeposit').value);
    const err = msg => { $('#bkError').textContent = msg; };

    if (!customer) return err('Please enter the customer name.');
    if (!pkg) return err('Please enter a package.');
    const email = $('#bkEmail').value.trim();
    const rawPhone = $('#bkPhone').value.trim();
    const phone = rawPhone && window.R59.formValidation?.cleanPhone ? window.R59.formValidation.cleanPhone(rawPhone) : rawPhone;
    const attendeesRaw = $('#bkAttendees').value.trim();
    if (email && !window.R59.formValidation.isValidEmail(email)) return err('Please enter a valid email address.');
    if (phone && !window.R59.formValidation.isValidPhone(phone)) return err('Please enter a valid phone number (10+ digits).');
    if (attendeesRaw && !(parseInt(attendeesRaw, 10) >= 1)) return err('Attendees must be at least 1.');
    if (!date || !window.R59.formValidation.isValidISODate(date)) return err('Please choose a valid date.');

    const blockedList = window.R59.state.getBlockedDates();
    const blockedDay = blockedList.find(x => x.dateStr === date);
    if (blockedDay && date !== b.date && $('#bkStatus').value !== 'Cancelled') {
      return err(`That date is blocked (${blockedDay.reason || 'Unavailable'}). Pick another date.`);
    }

    if (!start) return err('Please choose a start time.');
    if (end && end <= start) return err('End time must be after the start time.');
    if (!(price >= 0)) return err('Please enter a valid session price.');
    if (!(deposit >= 0)) return err('Please enter a valid down payment.');
    if (deposit > price) return err('Down payment cannot be more than the session price.');

    const [y, m, d] = date.split('-').map(Number);
    Object.assign(b, {
      customer,
      package: pkg,
      date,
      email,
      phone,
      location: $('#bkLocation').value.trim(),
      notes: $('#bkNotes').value.trim(),
      attendees: attendeesRaw ? parseInt(attendeesRaw, 10) : undefined,
      dateFormatted: `${MONTH_NAMES[m - 1]} ${d}, ${y}`,
      dateLabel: `${MONTH_NAMES[m - 1].toUpperCase()} ${d}, ${y}`,
      time: from24(start),
      timeRange: end ? `${from24(start)} – ${from24(end)}` : from24(start),
      price,
      deposit,
      status: $('#bkStatus').value
    });

    if (window.R59.api?.bookings?.updateBooking) {
      window.R59.api.bookings.updateBooking(b.id, {
        customer_name: b.customer,
        customer_email: b.email,
        phone: b.phone,
        location: b.location,
        notes: b.notes,
        attendees: b.attendees,
        date: b.date,
        startTime: start,
        endTime: end,
        price: b.price,
        deposit: b.deposit,
        status: b.status
      }).catch(err => console.warn('[schedule] Failed to update booking:', err));
    }

    closeBookingEditor();
    refreshBookingViews();
    window.toast('Booking updated');
  }

  /* ---------- New Booking Modal ---------- */
  function getDepositRate() {
    const currentState = window.R59.state.getState();
    const v = parseFloat(currentState.pricing.depositPercent);
    return (isNaN(v) ? 50 : Math.min(100, Math.max(0, v))) / 100;
  }

  function getAvailablePackages() {
    const currentState = window.R59.state.getState();
    const packages = currentState.packages || [];
    return packages.filter(p => p.active);
  }

  function computeBookingPrice({ pkgPrice, attendees, coupon }) {
    const currentState = window.R59.state.getState();
    const base = parseFloat(currentState.pricing.baseFee) || 0;
    const perPerson = parseFloat(currentState.pricing.perPerson) || 0;
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
    return {
      base,
      perPerson,
      attendeeFee,
      subtotal,
      discount,
      total,
      deposit: round2(total * getDepositRate())
    };
  }

  function nbSelectedPackage() {
    const val = $('#nbPackage').value;
    if (val === 'none') return { key: 'none', name: 'No package', price: 0, none: true };
    return getAvailablePackages().find(p => String(p.id) === String(val)) || { key: 'custom', name: 'Custom', price: 0 };
  }

  function renderNewBookingSummary() {
    const summaryEl = $('#nbSummary');
    if (!summaryEl) return;
    const pkg = nbSelectedPackage();
    const attendees = Math.max(1, parseInt($('#nbAttendees').value, 10) || 1);
    const c = computeBookingPrice({ pkgPrice: pkg.price || 0, attendees, coupon: nbCoupon });

    summaryEl.innerHTML = `
      ${pkg.none ? '' : `<div class="ps-row"><span>${esc(pkg.name)} package</span><b>${money(pkg.price)}</b></div>`}
      <div class="ps-row"><span>Base fee</span><b>${money(c.base)}</b></div>
      <div class="ps-row"><span>Attendees (${attendees} × ${money(c.perPerson)})</span><b>${money(c.attendeeFee)}</b></div>
      ${nbCoupon ? `<div class="ps-row discount"><span>Coupon ${esc(nbCoupon.code)}</span><b>−${money(c.discount)}</b></div>` : ''}
      <div class="ps-row total"><span>Total</span><b>${money(c.total)}</b></div>
      <div class="ps-row"><span>Down payment (${Math.round(getDepositRate() * 100)}%)</span><b>${money(c.deposit)}</b></div>`;
  }

  function setNbCouponMsg(text, ok) {
    const el = $('#nbCouponMsg');
    if (!el) return;
    el.textContent = text;
    el.style.color = ok === undefined ? '' : (ok ? '#4ade80' : 'var(--red)');
  }

  function applyNbCoupon() {
    $('#nbError').textContent = '';
    const code = ($('#nbCoupon').value || '').trim().toUpperCase();
    if (!code) {
      nbCoupon = null;
      setNbCouponMsg('Enter a coupon code first.', false);
      renderNewBookingSummary();
      return;
    }
    const currentState = window.R59.state.getState();
    const c = (currentState.coupons || []).find(x => x.code === code);
    if (!c) {
      nbCoupon = null;
      setNbCouponMsg('That coupon code does not exist.', false);
    } else if (!c.active) {
      nbCoupon = null;
      setNbCouponMsg('That coupon code is not active.', false);
    } else {
      nbCoupon = c;
      setNbCouponMsg(`Coupon applied: ${c.type === 'percent' ? c.amount + '% off' : money(c.amount) + ' off'}`, true);
    }
    renderNewBookingSummary();
  }

  function openNewBooking() {
    ['#nbFirst', '#nbLast', '#nbEmail', '#nbPhone', '#nbDate', '#nbStart', '#nbEnd', '#nbCoupon', '#nbLocation', '#nbNotes'].forEach(id => {
      const el = $(id);
      if (el) el.value = '';
    });
    $('#nbAttendees').value = 1;
    nbCoupon = null;
    setNbCouponMsg('');
    $('#nbError').textContent = '';

    const pkgs = getAvailablePackages();
    const pkgSelect = $('#nbPackage');
    if (pkgSelect) {
      pkgSelect.innerHTML = pkgs.map(p => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)}</option>`).join('')
        + '<option value="none">No package</option>';
    }

    renderNewBookingSummary();
    lastFocus = document.activeElement;
    $('#newBookingModal').classList.add('open');
    $('#nbFirst').focus();
  }

  function closeNewBooking() {
    $('#newBookingModal')?.classList.remove('open');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function createBooking() {
    const err = msg => { $('#nbError').textContent = msg; };
    const first = $('#nbFirst').value.trim();
    const last = $('#nbLast').value.trim();
    const email = $('#nbEmail').value.trim();
    const rawPhone = $('#nbPhone').value.trim();
    const phone = rawPhone && window.R59.formValidation?.cleanPhone ? window.R59.formValidation.cleanPhone(rawPhone) : rawPhone;
    const attendees = parseInt($('#nbAttendees').value, 10);
    const date = $('#nbDate').value;
    const start = $('#nbStart').value;
    const end = $('#nbEnd').value;
    const pkg = nbSelectedPackage();
    const couponText = $('#nbCoupon').value.trim();

    if (!first) return err('Please enter a first name.');
    if (!last) return err('Please enter a last name.');
    if (!window.R59.formValidation.isValidEmail(email)) return err('Please enter a valid email address.');
    if (!window.R59.formValidation.isValidPhone(phone)) return err('Please enter a valid phone number (10+ digits).');
    if (!(attendees >= 1)) return err('Number of attendees must be at least 1.');
    if (!date || !window.R59.formValidation.isValidISODate(date)) return err('Please choose a valid date for the booking.');
    if (!start) return err('Please choose a start time.');
    if (end && end <= start) return err('End time must be after the start time.');
    if (couponText && (!nbCoupon || nbCoupon.code !== couponText.toUpperCase())) {
      return err('Click “Apply” to use the coupon code, or clear the field.');
    }

    const blockedList = window.R59.state.getBlockedDates();
    const blocked = blockedList.find(b => b.dateStr === date);
    if (blocked) return err(`That date is blocked (${blocked.reason || 'Unavailable'}). Unblock it first or pick another date.`);

    const c = computeBookingPrice({ pkgPrice: pkg.price || 0, attendees, coupon: nbCoupon });
    const [y, m, d] = date.split('-').map(Number);

    const bookings = window.R59.state.getBookings();
    const nextId = (bookings.reduce((max, b) => Math.max(max, Number(b.id) || 0), 0)) + 1;

    const newBooking = {
      id: nextId,
      date,
      dateLabel: `${MONTH_NAMES[m - 1].toUpperCase()} ${d}, ${y}`,
      dateFormatted: `${MONTH_NAMES[m - 1]} ${d}, ${y}`,
      time: from24(start),
      timeRange: end ? `${from24(start)} – ${from24(end)}` : from24(start),
      customer: `${first} ${last}`,
      firstName: first,
      lastName: last,
      email,
      phone,
      attendees,
      location: $('#nbLocation').value.trim(),
      notes: $('#nbNotes').value.trim(),
      package: pkg.name,
      price: c.total,
      deposit: c.deposit,
      coupon: nbCoupon ? { code: nbCoupon.code, discount: c.discount } : null,
      status: 'Confirmed'
    };

    bookings.push(newBooking);

    if (window.R59.api?.bookings?.createBooking) {
      window.R59.api.bookings.createBooking({
        client_name: newBooking.customer,
        client_email: newBooking.email,
        phone: newBooking.phone,
        location: newBooking.location,
        notes: newBooking.notes,
        people: newBooking.attendees,
        date: newBooking.date,
        startTime: start,
        endTime: end,
        packageId: pkg.id && pkg.id !== 'none' && pkg.id !== 'custom' ? pkg.id : undefined,
        totalPrice: newBooking.price,
        deposit: newBooking.deposit,
        coupon: nbCoupon ? nbCoupon.code : undefined,
        status: 'confirmed'
      }).then(res => {
        if (res?.data?.id || res?.id) {
          newBooking.id = res?.data?.id || res?.id;
          refreshBookingViews();
        }
      }).catch(err => console.warn('[schedule] Failed to persist new booking:', err));
    }

    closeNewBooking();
    refreshBookingViews();
    window.toast(`Booking created for ${first} ${last}`);
  }

  function initScheduleListeners() {
    // Calendar view buttons
    ['Day', 'Week', 'Month'].forEach(v => {
      document.getElementById(`calBtn${v}`)?.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        currentCalView = v.toLowerCase();
        renderCalendar();
      });
    });

    $('#calPrev')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      moveCalendar(-1);
    });

    $('#calNext')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      moveCalendar(1);
    });

    // Block dates button
    $('#btnBlockDate')?.addEventListener('click', addBlockedDate);

    // Bookings buttons
    $('#btnAddBooking')?.addEventListener('click', openNewBooking);
    $('#btnClearCancelled')?.addEventListener('click', () => {
      const bookings = window.R59.state.getBookings();
      const ids = bookings.filter(b => b.status === 'Cancelled').map(b => b.id);
      if (ids.length) promptClearCancelled('', ids);
    });

    // New booking modal listeners
    $('#nbCancel')?.addEventListener('click', closeNewBooking);
    $('#nbSave')?.addEventListener('click', createBooking);
    $('#nbApplyCoupon')?.addEventListener('click', applyNbCoupon);
    $('#nbCoupon')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyNbCoupon();
      }
    });
    $('#nbCoupon')?.addEventListener('input', () => {
      if (nbCoupon && $('#nbCoupon').value.trim().toUpperCase() !== nbCoupon.code) {
        nbCoupon = null;
        setNbCouponMsg('');
        renderNewBookingSummary();
      }
    });
    ['#nbPackage', '#nbAttendees'].forEach(sel => $(sel)?.addEventListener('input', renderNewBookingSummary));
    $('#newBookingModal')?.addEventListener('click', e => {
      if (e.target.id === 'newBookingModal') closeNewBooking();
    });

    // Edit booking modal listeners
    const bkStatusEl = $('#bkStatus');
    if (bkStatusEl) {
      bkStatusEl.addEventListener('change', () => {
        const bookings = window.R59.state.getBookings();
        const b = bookings.find(item => String(item.id) === String(editingBookingId));
        const warn = $('#bkRefundNote');
        if (warn) warn.style.display = (bkStatusEl.value === 'Cancelled' && b && b.status !== 'Cancelled') ? 'block' : 'none';
      });
    }
    $('#bkSave')?.addEventListener('click', saveBookingEdit);
    $('#bkCancel')?.addEventListener('click', closeBookingEditor);
    $('#bookingModal')?.addEventListener('click', e => {
      if (e.target.id === 'bookingModal') closeBookingEditor();
    });

    // Delegated click listeners for dynamically rendered cards & calendar chips
    document.addEventListener('click', e => {
      const target = e.target instanceof Element ? e.target : e.target?.parentElement;
      if (!target) return;

      const openBk = target.closest('[data-open-booking]');
      if (openBk) {
        e.preventDefault();
        openBookingEditor(openBk.dataset.openBooking);
        return;
      }

      const editBk = target.closest('[data-edit-booking]');
      if (editBk) {
        e.preventDefault();
        openBookingEditor(editBk.dataset.editBooking);
        return;
      }

      const cancelBk = target.closest('[data-cancel-booking]');
      if (cancelBk) {
        e.preventDefault();
        promptCancelBooking(cancelBk.dataset.cancelBooking);
        return;
      }

      const delBk = target.closest('[data-delete-booking]');
      if (delBk) {
        e.preventDefault();
        promptRemoveBooking(delBk.dataset.deleteBooking);
        return;
      }

      const selDay = target.closest('[data-select-day]');
      if (selDay) {
        e.preventDefault();
        window.R59.schedule.selectDayView(selDay.dataset.selectDay);
        return;
      }

      const selCalDate = target.closest('[data-select-cal-date]');
      if (selCalDate) {
        e.preventDefault();
        window.R59.schedule.selectCalendarDate(selCalDate.dataset.selectCalDate);
        return;
      }

      const addTf = target.closest('[data-add-timeframe-day]');
      if (addTf) {
        e.preventDefault();
        showAddTimeframe(addTf.dataset.addTimeframeDay);
        return;
      }

      const saveTf = target.closest('[data-save-timeframe-day]');
      if (saveTf) {
        e.preventDefault();
        saveTimeframe(saveTf.dataset.saveTimeframeDay);
        return;
      }

      const cancelTf = target.closest('[data-cancel-timeframe]');
      if (cancelTf) {
        e.preventDefault();
        cancelTimeframe();
        return;
      }

      const editTf = target.closest('[data-edit-timeframe-day]');
      if (editTf) {
        e.preventDefault();
        editTimeframe(editTf.dataset.editTimeframeDay, Number(editTf.dataset.editTimeframeId));
        return;
      }

      const rmTf = target.closest('[data-remove-timeframe-day]');
      if (rmTf) {
        e.preventDefault();
        removeTimeframe(rmTf.dataset.removeTimeframeDay, Number(rmTf.dataset.removeTimeframeId));
        return;
      }

      const rmBlock = target.closest('[data-remove-block]');
      if (rmBlock) {
        e.preventDefault();
        removeBlockedDate(rmBlock.dataset.removeBlock);
        return;
      }
    });

    // Keyboard activation for calendar day cells, chips, and day selectors
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const target = e.target instanceof Element ? e.target : e.target?.parentElement;
      if (!target) return;

      const openBk = target.closest('[data-open-booking]');
      if (openBk) {
        e.preventDefault();
        openBookingEditor(openBk.dataset.openBooking);
        return;
      }

      const selDay = target.closest('[data-select-day]');
      if (selDay) {
        e.preventDefault();
        window.R59.schedule.selectDayView(selDay.dataset.selectDay);
        return;
      }

      const selCalDate = target.closest('[data-select-cal-date]');
      if (selCalDate) {
        e.preventDefault();
        window.R59.schedule.selectCalendarDate(selCalDate.dataset.selectCalDate);
        return;
      }
    });
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
    selectCalendarDate: ds => { selectedDayDate = ds; renderCalendar(); },
    selectDayView: ds => { selectedDayDate = ds; currentCalView = 'day'; renderCalendar(); },
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
    openNewBooking,
    closeNewBooking,
    initScheduleListeners
  };

  // Expose methods for existing event handlers
  window.renderCalendar = renderCalendar;
  window.renderAvailability = renderAvailability;
  window.renderBlockedDates = renderBlockedDates;
  window.renderBookings = renderBookings;
  window.selectCalendarDate = window.R59.schedule.selectCalendarDate;
  window.selectDayView = window.R59.schedule.selectDayView;
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
