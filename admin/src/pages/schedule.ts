/**
 * R59 Media Admin — Schedule, Availability & Bookings Page Controller
 * 
 * Manages calendar Day/Week/Month views, date navigation, weekly availability rules,
 * blocked dates, customer bookings management, and booking creation/edit modals.
 */

const $ = <T extends HTMLElement = HTMLElement>(s: string): T | null => document.querySelector<T>(s);
const $$ = <T extends HTMLElement = HTMLElement>(s: string): T[] => Array.from(document.querySelectorAll<T>(s));
const esc = (s: any): string => window.R59?.formValidation?.escapeHtml?.(s) || (s === null || s === undefined ? '' : String(s));

export const MONTH_NAMES: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const DAYS_OF_WEEK: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface ScheduleBooking {
  id: string | number;
  customer?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  date: string;
  dateLabel?: string;
  dateFormatted?: string;
  time?: string;
  timeRange?: string;
  start_time?: string;
  startTime?: string;
  end_time?: string;
  endTime?: string;
  package?: string;
  location?: string;
  attendees?: number;
  notes?: string;
  price?: number;
  deposit?: number;
  status?: 'Confirmed' | 'Pending' | 'Cancelled' | string;
  coupon?: any;
  [key: string]: any;
}

export interface BlockedDateEntry {
  id: string | number;
  date: string;
  dateStr?: string;
  dateFormatted?: string;
  reason?: string;
  [key: string]: any;
}

export interface ScheduleTimeframe {
  id: number;
  start: string;
  end: string;
  label: string;
  repeat: 'weekly' | 'none' | string;
}

export interface ScheduleDayAvailability {
  day: string;
  available: boolean;
  timeframes: ScheduleTimeframe[];
}

export interface MonthGridOptions {
  chipAction?: 'edit' | string;
  selectedStr?: string;
  selectable?: boolean;
}

export interface PriceCalculation {
  base: number;
  perPerson: number;
  attendeeFee: number;
  subtotal: number;
  discount: number;
  total: number;
  deposit: number;
}

let currentCalView: 'day' | 'week' | 'month' | string = 'month';
let selectedDayDate: string = toISODate(new Date());

let nextTimeframeId = 100;
let editingTimeframeDay: string | null = null;
let editingTimeframeId: number | null = null;

let editingBookingId: string | number | null = null;
let lastFocus: HTMLElement | null = null;

/* ---------- Date Utilities ---------- */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromISODate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

export function endOfWeek(date: Date): Date {
  const result = startOfWeek(date);
  result.setDate(result.getDate() + 6);
  return result;
}

export function formatLongDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function formatWeekRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  return sameYear
    ? `${startLabel} – ${endLabel}, ${end.getFullYear()}`
    : `${startLabel}, ${start.getFullYear()} – ${endLabel}`;
}

export function formatTime12h(time24: string): string {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

export function to24(str: string | null | undefined): string {
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

export function from24(t: string | null | undefined): string {
  const t24 = to24(t);
  if (!t24) return String(t || '');
  const [h, m] = t24.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function money(n: number | string | null | undefined): string {
  const v = Number(n || 0);
  return '$' + v.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2
  });
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const bookingSortKey = (b: ScheduleBooking): string => (b.date || '') + ' ' + (to24(b.time) || '00:00');

/* ---------- Calendar Rendering (Day / Week / Month) ---------- */
export function renderCalendar(): void {
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

export function buildMonthGridHTML(year: number, month: number, opts: MonthGridOptions = {}): string {
  const firstDayOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDayOffset + daysInMonth) / 7) * 7;
  const todayStr = toISODate(new Date());

  const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
  const blockedList: BlockedDateEntry[] = window.R59?.state?.getBlockedDates ? window.R59.state.getBlockedDates() : [];

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

export function renderMonthCalendar(container: HTMLElement): void {
  const selectedDate = fromISODate(selectedDayDate);
  container.innerHTML = buildMonthGridHTML(selectedDate.getFullYear(), selectedDate.getMonth(), {
    selectedStr: selectedDayDate,
    selectable: true
  });
}

export function renderWeekCalendar(container: HTMLElement): void {
  const selectedDate = fromISODate(selectedDayDate);
  const start = startOfWeek(selectedDate);
  const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
  const blockedList: BlockedDateEntry[] = window.R59?.state?.getBlockedDates ? window.R59.state.getBlockedDates() : [];

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

export function renderDayCalendar(container: HTMLElement): void {
  const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
  const blockedList: BlockedDateEntry[] = window.R59?.state?.getBlockedDates ? window.R59.state.getBlockedDates() : [];

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
      const balance = (Number(b.price) || 0) - (Number(b.deposit) || 0);
      timelineHtml += `
        <div class="cal-timeline-row" style="border-left: 3px solid var(--yellow); background: rgba(255, 204, 34, 0.05);">
          <div class="cal-timeline-time">${hr.label}</div>
          <div class="cal-timeline-content">
            <div>
              <div style="font-weight: 700; font-size: 14px;">${esc(b.customer)} — ${esc(b.package)}</div>
              <div class="hint">${esc(b.timeRange || b.time)} · Price: ${money(b.price)} · Down Payment: ${money(b.deposit)} · Balance: ${money(balance)}</div>
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

export function moveCalendar(delta: number): void {
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
export function renderAvailability(): void {
  const container = $('#availabilityList');
  if (!container) return;

  const availability: any[] = window.R59?.state?.getAvailability ? window.R59.state.getAvailability() : [];

  container.innerHTML = availability.map(item => {
    const isEditingThisDay = editingTimeframeDay === item.day;
    const slotsHtml = (item.available && item.timeframes && item.timeframes.length > 0)
      ? `
        <div class="avail-slots-list">
          ${item.timeframes.map((tf: ScheduleTimeframe) => `
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
      const tf = item.timeframes?.find((t: ScheduleTimeframe) => t.id === editingTimeframeId);
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

export function showAddTimeframe(day: string): void {
  editingTimeframeDay = day;
  editingTimeframeId = null;
  renderAvailability();
}

export function editTimeframe(day: string, id: number): void {
  editingTimeframeDay = day;
  editingTimeframeId = id;
  renderAvailability();
}

export function cancelTimeframe(): void {
  editingTimeframeDay = null;
  editingTimeframeId = null;
  renderAvailability();
}

export function saveTimeframe(day: string): void {
  const start = (($('#tfStart') as HTMLInputElement)?.value) || '09:00';
  const end = (($('#tfEnd') as HTMLInputElement)?.value) || '17:00';
  const repeatVal = ($('input[name="tfRepeat"]:checked') as HTMLInputElement)?.value || 'weekly';

  const availability: any[] = window.R59?.state?.getAvailability ? window.R59.state.getAvailability() : [];
  const item = availability.find(d => d.day === day);
  if (!item) return;

  item.timeframes = item.timeframes || [];
  const label = `${formatTime12h(start)} – ${formatTime12h(end)}`;

  if (editingTimeframeId) {
    const tf = item.timeframes.find((t: ScheduleTimeframe) => t.id === editingTimeframeId);
    if (tf) {
      tf.start = start;
      tf.end = end;
      tf.label = label;
      tf.repeat = repeatVal;
    }
    window.toast?.('Timeframe updated');
  } else {
    item.timeframes.push({
      id: ++nextTimeframeId,
      start,
      end,
      label,
      repeat: repeatVal
    });
    item.available = true;
    window.toast?.('Timeframe added');
  }

  editingTimeframeDay = null;
  editingTimeframeId = null;
  renderAvailability();
  window.R59?.state?.markDirty?.();
}

export function removeTimeframe(day: string, id: number): void {
  const availability: any[] = window.R59?.state?.getAvailability ? window.R59.state.getAvailability() : [];
  const item = availability.find(d => d.day === day);
  if (!item) return;
  const timeframe = item.timeframes?.find((t: ScheduleTimeframe) => t.id === id);
  if (!timeframe) return;

  const onConfirm = () => {
    item.timeframes = item.timeframes.filter((t: ScheduleTimeframe) => t.id !== id);
    if (item.timeframes.length === 0) item.available = false;
    renderAvailability();
    window.R59?.state?.markDirty?.();
    window.toast?.('Timeframe removed');
  };

  if (window.R59?.confirmation?.confirmRemoveTimeframe) {
    window.R59.confirmation.confirmRemoveTimeframe(timeframe.label, day, onConfirm);
  } else {
    onConfirm();
  }
}

/* ---------- Blocked Dates ---------- */
export function renderBlockedDates(): void {
  const container = $('#blockedDatesList');
  if (!container) return;

  const blocked: BlockedDateEntry[] = window.R59?.state?.getBlockedDates ? window.R59.state.getBlockedDates() : [];

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

export function removeBlockedDate(id: string | number): void {
  const blockedList: BlockedDateEntry[] = window.R59?.state?.getBlockedDates ? window.R59.state.getBlockedDates() : [];
  const removed = blockedList.find(b => String(b.id) === String(id));
  if (!removed) return;

  const onConfirm = () => {
    window.R59?.state?.setBlockedDates?.(blockedList.filter(b => String(b.id) !== String(id)));
    if (removed?.id && window.R59?.api?.schedule?.removeBlockedDate) {
      window.R59.api.schedule.removeBlockedDate(removed.id).catch((err: any) => console.warn('[schedule] Failed to remove blocked date:', err));
    }
    renderBlockedDates();
    renderCalendar();
    if (window.R59?.dashboard?.renderOverview) window.R59.dashboard.renderOverview();
    window.R59?.state?.markDirty?.();
    window.toast?.('Date unblocked');
  };

  if (window.R59?.confirmation?.confirmRemoveBlockedDate) {
    window.R59.confirmation.confirmRemoveBlockedDate(removed.dateFormatted || removed.dateStr || removed.date, onConfirm);
  } else {
    onConfirm();
  }
}

export function addBlockedDate(): void {
  const dateVal = ($('#blockDateInput') as HTMLInputElement | null)?.value;
  const reasonVal = (($('#blockReasonInput') as HTMLInputElement | null)?.value || '').trim();
  if (!dateVal || !window.R59?.formValidation?.isValidISODate?.(dateVal)) {
    window.toast?.('Please choose a valid date to block');
    return;
  }

  const [y, m, d] = dateVal.split('-').map(Number);
  const dateFormatted = `${MONTH_NAMES[m - 1]} ${d}, ${y}`;

  if (window.R59?.confirmation?.confirmBlockDate) {
    window.R59.confirmation.confirmBlockDate(dateFormatted, () => commitBlockedDate(dateVal, reasonVal, dateFormatted));
  } else {
    commitBlockedDate(dateVal, reasonVal, dateFormatted);
  }
}

export function commitBlockedDate(dateVal: string, reasonVal: string, dateFormatted: string): void {
  const blockedList: BlockedDateEntry[] = window.R59?.state?.getBlockedDates ? window.R59.state.getBlockedDates() : [];
  const newBlock: BlockedDateEntry = {
    id: Date.now(),
    date: dateVal,
    dateStr: dateVal,
    dateFormatted: dateFormatted,
    reason: reasonVal || 'Unavailable'
  };
  blockedList.push(newBlock);

  if (window.R59?.api?.schedule?.addBlockedDate) {
    window.R59.api.schedule.addBlockedDate({ date: dateVal, reason: reasonVal || 'Unavailable' })
      .then((res: any) => {
        if (res?.id) {
          newBlock.id = res.id;
          renderBlockedDates();
        }
      })
      .catch((err: any) => console.warn('[schedule] Failed to add blocked date:', err));
  }

  const blockDateInput = $('#blockDateInput') as HTMLInputElement | null;
  const blockReasonInput = $('#blockReasonInput') as HTMLInputElement | null;
  if (blockDateInput) blockDateInput.value = '';
  if (blockReasonInput) blockReasonInput.value = '';
  renderBlockedDates();
  renderCalendar();
  if (window.R59?.dashboard?.renderOverview) window.R59.dashboard.renderOverview();
  window.R59?.state?.markDirty?.();

  const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
  const existing = bookings.filter(b => b.date === dateVal && b.status !== 'Cancelled').length;
  window.toast?.(existing
    ? `Date blocked — note: ${existing} existing booking${existing > 1 ? 's' : ''} on that day ${existing > 1 ? 'are' : 'is'} not cancelled`
    : 'Date blocked');
}

/* ---------- Bookings List & Cards ---------- */
export function bookingCardHTML(b: ScheduleBooking): string {
  const balance = Math.max(0, (Number(b.price) || 0) - (Number(b.deposit) || 0));
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

export function bookingsGroupedHTML(list: ScheduleBooking[], emptyMsg: string): string {
  if (!list || list.length === 0) return `<p class="hint">${emptyMsg}</p>`;
  const sorted = [...list].sort((x, y) => bookingSortKey(x).localeCompare(bookingSortKey(y)));
  const grouped = new Map<string, ScheduleBooking[]>();
  sorted.forEach(b => {
    const label = b.dateLabel || b.date;
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)!.push(b);
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

export function renderBookings(): void {
  const container = $('#bookingsList');
  const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
  if (container) {
    container.innerHTML = bookingsGroupedHTML(bookings, 'No bookings scheduled.');
  }
  syncClearCancelledButtons();
  if (window.R59?.dashboard?.renderOverview) {
    window.R59.dashboard.renderOverview();
  }
}

export function syncClearCancelledButtons(): void {
  const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
  const allCancelled = bookings.filter(b => b.status === 'Cancelled');
  const setBtn = (sel: string, count: number, label: string) => {
    const el = $(sel);
    if (!el) return;
    el.style.display = count > 0 ? '' : 'none';
    el.textContent = `${label} (${count})`;
  };
  setBtn('#btnClearCancelled', allCancelled.length, 'Clear all cancelled');

  const ovYear = window.R59?.dashboard?.getYear ? window.R59.dashboard.getYear() : new Date().getFullYear();
  const ovMonth = window.R59?.dashboard?.getMonth ? window.R59.dashboard.getMonth() : new Date().getMonth();
  const monthCancelled = allCancelled.filter(b => {
    const [y, m] = b.date.split('-').map(Number);
    return y === ovYear && (m - 1) === ovMonth;
  });
  setBtn('#ovClearCancelled', monthCancelled.length, 'Clear cancelled');
}

export function promptRemoveBooking(id: string | number): void {
  const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
  const b = bookings.find(item => String(item.id) === String(id));
  if (!b || b.status !== 'Cancelled') return;

  const onConfirm = () => {
    window.R59?.state?.setBookings?.(bookings.filter(item => String(item.id) !== String(id)));
    if (window.R59?.api?.bookings?.deleteBooking) {
      window.R59.api.bookings.deleteBooking(id).catch((err: any) => console.warn('[schedule] Failed to delete booking:', err));
    }
    refreshBookingViews();
    window.toast?.('Cancelled booking removed');
  };

  if (window.R59?.confirmation?.confirmRemoveBooking) {
    window.R59.confirmation.confirmRemoveBooking(b, onConfirm);
  } else {
    onConfirm();
  }
}

export function promptCancelBooking(id: string | number): void {
  const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
  const b = bookings.find(item => String(item.id) === String(id));
  if (!b || b.status === 'Cancelled') return;

  const onConfirm = () => {
    b.status = 'Cancelled';
    if (window.R59?.api?.bookings?.cancelBooking) {
      window.R59.api.bookings.cancelBooking(id).catch((err: any) => console.warn('[schedule] Failed to cancel booking:', err));
    }
    refreshBookingViews();
    window.toast?.(`Booking cancelled — ${money(b.deposit)} down payment marked for reimbursement`);
  };

  if (window.R59?.confirmation?.confirmCancelBooking) {
    window.R59.confirmation.confirmCancelBooking(b, onConfirm);
  } else {
    onConfirm();
  }
}

export function promptClearCancelled(scopeLabel: string, ids: (string | number)[]): void {
  const onConfirm = () => {
    const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
    const strIds = ids.map(String);
    window.R59?.state?.setBookings?.(bookings.filter(b => !strIds.includes(String(b.id))));
    if (window.R59?.api?.bookings?.deleteBooking) {
      ids.forEach(id => {
        window.R59!.api.bookings.deleteBooking(id).catch((err: any) => console.warn('[schedule] Failed to clear booking:', err));
      });
    }
    refreshBookingViews();
    window.toast?.(`${ids.length} cancelled booking${ids.length > 1 ? 's' : ''} cleared`);
  };

  if (window.R59?.confirmation?.confirmClearCancelled) {
    window.R59.confirmation.confirmClearCancelled(ids.length, scopeLabel, onConfirm);
  } else {
    onConfirm();
  }
}

export function refreshBookingViews(): void {
  renderBookings();
  renderCalendar();
}

/* ---------- Booking Edit Modal ---------- */
export function openBookingEditor(id: string | number): void {
  const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
  const b = bookings.find(item => String(item.id) === String(id));
  if (!b) return;

  editingBookingId = b.id;
  const bkCustomer = $('#bkCustomer') as HTMLInputElement | null;
  const bkPackage = $('#bkPackage') as HTMLInputElement | null;
  const bkLocation = $('#bkLocation') as HTMLInputElement | null;
  const bkNotes = $('#bkNotes') as HTMLTextAreaElement | null;
  const bkEmail = $('#bkEmail') as HTMLInputElement | null;
  const bkPhone = $('#bkPhone') as HTMLInputElement | null;
  const bkAttendees = $('#bkAttendees') as HTMLInputElement | null;
  const bkDate = $('#bkDate') as HTMLInputElement | null;
  const bkStart = $('#bkStart') as HTMLInputElement | null;
  const bkEnd = $('#bkEnd') as HTMLInputElement | null;
  const bkPrice = $('#bkPrice') as HTMLInputElement | null;
  const bkDeposit = $('#bkDeposit') as HTMLInputElement | null;
  const bkStatus = $('#bkStatus') as HTMLSelectElement | null;
  const bkError = $('#bkError');
  const bkRefundNote = $('#bkRefundNote') as HTMLElement | null;

  if (bkCustomer) bkCustomer.value = b.customer || '';
  if (bkPackage) bkPackage.value = b.package || '';
  if (bkLocation) bkLocation.value = b.location || '';
  if (bkNotes) bkNotes.value = b.notes || '';
  if (bkEmail) bkEmail.value = b.email || '';
  if (bkPhone) bkPhone.value = b.phone || '';
  if (bkAttendees) bkAttendees.value = String(b.attendees ?? '');
  if (bkDate) bkDate.value = b.date || '';
  if (bkStart) bkStart.value = to24(b.time);
  if (bkEnd) bkEnd.value = to24(b.end_time || (b.timeRange || '').split(/[-–]/)[1] || '');
  if (bkPrice) bkPrice.value = String(b.price || 0);
  if (bkDeposit) bkDeposit.value = String(b.deposit || 0);
  if (bkStatus) bkStatus.value = b.status || 'Pending';
  if (bkError) bkError.textContent = '';
  if (bkRefundNote) bkRefundNote.style.display = 'none';

  lastFocus = document.activeElement as HTMLElement | null;
  $('#bookingModal')?.classList.add('open');
  bkCustomer?.focus();
}

export function closeBookingEditor(): void {
  $('#bookingModal')?.classList.remove('open');
  editingBookingId = null;
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
}

export function saveBookingEdit(): void {
  const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
  const b = bookings.find(item => String(item.id) === String(editingBookingId));
  if (!b) return closeBookingEditor();

  const customer = (($('#bkCustomer') as HTMLInputElement)?.value || '').trim();
  const pkg = (($('#bkPackage') as HTMLInputElement)?.value || '').trim();
  const date = (($('#bkDate') as HTMLInputElement)?.value || '');
  const start = (($('#bkStart') as HTMLInputElement)?.value || '');
  const end = (($('#bkEnd') as HTMLInputElement)?.value || '');
  const price = parseFloat((($('#bkPrice') as HTMLInputElement)?.value || '0'));
  const deposit = parseFloat((($('#bkDeposit') as HTMLInputElement)?.value || '0'));
  const err = (msg: string) => {
    const bkError = $('#bkError');
    if (bkError) bkError.textContent = msg;
  };

  if (!customer) return err('Please enter the customer name.');
  if (!pkg) return err('Please enter a package.');
  const email = (($('#bkEmail') as HTMLInputElement)?.value || '').trim();
  const rawPhone = (($('#bkPhone') as HTMLInputElement)?.value || '').trim();
  const phone = rawPhone && window.R59?.formValidation?.cleanPhone ? window.R59.formValidation.cleanPhone(rawPhone) : rawPhone;
  const attendeesRaw = (($('#bkAttendees') as HTMLInputElement)?.value || '').trim();
  if (email && !window.R59?.formValidation?.isValidEmail?.(email)) return err('Please enter a valid email address.');
  if (phone && !window.R59?.formValidation?.isValidPhone?.(phone)) return err('Please enter a valid phone number (10+ digits).');
  if (attendeesRaw && !(parseInt(attendeesRaw, 10) >= 1)) return err('Attendees must be at least 1.');
  if (!date || !window.R59?.formValidation?.isValidISODate?.(date)) return err('Please choose a valid date.');

  const blockedList: BlockedDateEntry[] = window.R59?.state?.getBlockedDates ? window.R59.state.getBlockedDates() : [];
  const blockedDay = blockedList.find(x => x.dateStr === date);
  const currentStatusVal = (($('#bkStatus') as HTMLSelectElement)?.value || 'Pending');
  if (blockedDay && date !== b.date && currentStatusVal !== 'Cancelled') {
    return err(`That date is blocked (${blockedDay.reason || 'Unavailable'}). Pick another date.`);
  }

  if (!start) return err('Please choose a start time.');
  if (end && end <= start) return err('End time must be after the start time.');
  if (!(price >= 0)) return err('Please enter a valid session price.');
  if (!(deposit >= 0)) return err('Please enter a valid down payment.');
  if (deposit > price) return err('Down payment cannot be more than the session price.');

  const [y, m, d] = date.split('-').map(Number);
  const onConfirm = () => {
    Object.assign(b, {
      customer,
      package: pkg,
      date,
      email,
      phone,
      location: (($('#bkLocation') as HTMLInputElement)?.value || '').trim(),
      notes: (($('#bkNotes') as HTMLTextAreaElement)?.value || '').trim(),
      attendees: attendeesRaw ? parseInt(attendeesRaw, 10) : undefined,
      dateFormatted: `${MONTH_NAMES[m - 1]} ${d}, ${y}`,
      dateLabel: `${MONTH_NAMES[m - 1].toUpperCase()} ${d}, ${y}`,
      time: from24(start),
      timeRange: end ? `${from24(start)} – ${from24(end)}` : from24(start),
      price,
      deposit,
      status: currentStatusVal
    });

    if (window.R59?.api?.bookings?.updateBooking) {
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
      }).catch((err: any) => console.warn('[schedule] Failed to update booking:', err));
    }

    closeBookingEditor();
    refreshBookingViews();
    window.toast?.('Booking updated');
  };

  if (window.R59?.confirmation?.confirmSaveBooking) {
    window.R59.confirmation.confirmSaveBooking(customer, `${MONTH_NAMES[m - 1]} ${d}, ${y}`, false, onConfirm);
  } else {
    onConfirm();
  }
}

/* ---------- New Booking Modal ---------- */
export function getDepositRate(): number {
  const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
  const v = parseFloat(currentState.pricing?.depositPercent);
  return (isNaN(v) ? 50 : Math.min(100, Math.max(0, v))) / 100;
}

export function getAvailablePackages(): any[] {
  const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
  const packages: any[] = currentState.packages || [];
  return packages.filter(p => p.active !== false);
}

export function computeBookingPrice({ pkgPrice, attendees, coupon }: { pkgPrice: number; attendees: number; coupon?: any }): PriceCalculation {
  const currentState = window.R59?.state?.getState ? window.R59.state.getState() : ({} as any);
  const base = parseFloat(currentState.pricing?.baseFee) || 0;
  const perPerson = parseFloat(currentState.pricing?.perPerson) || 0;
  const attendeeFee = perPerson * attendees;
  const subtotal = pkgPrice + base + attendeeFee;
  let discount = 0;
  if (coupon) {
    discount = coupon.type === 'percent'
      ? subtotal * (Number(coupon.amount) || 0) / 100
      : Math.min(Number(coupon.amount) || 0, subtotal);
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

export function nbSelectedPackage(): any {
  const val = (($('#nbPackage') as HTMLSelectElement | null)?.value) || 'none';
  if (val === 'none') return { key: 'none', name: 'No package', price: 0, none: true };
  return getAvailablePackages().find(p => String(p.id) === String(val)) || { key: 'custom', name: 'Custom', price: 0 };
}

export function renderNewBookingSummary(): void {
  const summaryEl = $('#nbSummary');
  if (!summaryEl) return;
  const pkg = nbSelectedPackage();
  const attendees = Math.max(1, parseInt((($('#nbAttendees') as HTMLInputElement | null)?.value) || '1', 10) || 1);
  const c = computeBookingPrice({ pkgPrice: pkg.price || 0, attendees });

  summaryEl.innerHTML = `
    ${pkg.none ? '' : `<div class="ps-row"><span>${esc(pkg.name)} package</span><b>${money(pkg.price)}</b></div>`}
    <div class="ps-row"><span>Base fee</span><b>${money(c.base)}</b></div>
    <div class="ps-row"><span>Attendees (${attendees} × ${money(c.perPerson)})</span><b>${money(c.attendeeFee)}</b></div>
    <div class="ps-row total"><span>Total</span><b>${money(c.total)}</b></div>
    <div class="ps-row"><span>Down payment (${Math.round(getDepositRate() * 100)}%)</span><b>${money(c.deposit)}</b></div>`;
}

export function openNewBooking(): void {
  ['#nbFirst', '#nbLast', '#nbEmail', '#nbPhone', '#nbDate', '#nbStart', '#nbEnd', '#nbLocation', '#nbNotes'].forEach(id => {
    const el = $(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el) el.value = '';
  });
  const nbAttendees = $('#nbAttendees') as HTMLInputElement | null;
  if (nbAttendees) nbAttendees.value = '1';
  const nbError = $('#nbError');
  if (nbError) nbError.textContent = '';

  const pkgs = getAvailablePackages();
  const pkgSelect = $('#nbPackage') as HTMLSelectElement | null;
  if (pkgSelect) {
    pkgSelect.innerHTML = pkgs.map(p => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)}</option>`).join('')
      + '<option value="none">No package</option>';
  }

  renderNewBookingSummary();
  lastFocus = document.activeElement as HTMLElement | null;
  $('#newBookingModal')?.classList.add('open');
  ($('#nbFirst') as HTMLInputElement | null)?.focus();
}

export function closeNewBooking(): void {
  $('#newBookingModal')?.classList.remove('open');
  if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
}

export function createBooking(): void {
  const err = (msg: string) => {
    const nbError = $('#nbError');
    if (nbError) nbError.textContent = msg;
  };
  const first = (($('#nbFirst') as HTMLInputElement)?.value || '').trim();
  const last = (($('#nbLast') as HTMLInputElement)?.value || '').trim();
  const email = (($('#nbEmail') as HTMLInputElement)?.value || '').trim();
  const rawPhone = (($('#nbPhone') as HTMLInputElement)?.value || '').trim();
  const phone = rawPhone && window.R59?.formValidation?.cleanPhone ? window.R59.formValidation.cleanPhone(rawPhone) : rawPhone;
  const attendees = parseInt((($('#nbAttendees') as HTMLInputElement)?.value || '1'), 10);
  const date = (($('#nbDate') as HTMLInputElement)?.value || '');
  const start = (($('#nbStart') as HTMLInputElement)?.value || '');
  const end = (($('#nbEnd') as HTMLInputElement)?.value || '');
  const pkg = nbSelectedPackage();

  if (!first) return err('Please enter a first name.');
  if (!last) return err('Please enter a last name.');
  if (!window.R59?.formValidation?.isValidEmail?.(email)) return err('Please enter a valid email address.');
  if (!window.R59?.formValidation?.isValidPhone?.(phone)) return err('Please enter a valid phone number (10+ digits).');
  if (!(attendees >= 1)) return err('Number of attendees must be at least 1.');
  if (!date || !window.R59?.formValidation?.isValidISODate?.(date)) return err('Please choose a valid date for the booking.');
  if (!start) return err('Please choose a start time.');
  if (end && end <= start) return err('End time must be after the start time.');

  const blockedList: BlockedDateEntry[] = window.R59?.state?.getBlockedDates ? window.R59.state.getBlockedDates() : [];
  const blocked = blockedList.find(b => b.dateStr === date);
  if (blocked) return err(`That date is blocked (${blocked.reason || 'Unavailable'}). Unblock it first or pick another date.`);

  const c = computeBookingPrice({ pkgPrice: pkg.price || 0, attendees });
  const [y, m, d] = date.split('-').map(Number);

  const onConfirm = () => {
    const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
    const nextId = (bookings.reduce((max, b) => Math.max(max, Number(b.id) || 0), 0)) + 1;

    const newBooking: ScheduleBooking = {
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
      location: (($('#nbLocation') as HTMLInputElement)?.value || '').trim(),
      notes: (($('#nbNotes') as HTMLTextAreaElement)?.value || '').trim(),
      package: pkg.name,
      price: c.total,
      deposit: c.deposit,
      coupon: null,
      status: 'Confirmed'
    };

    bookings.push(newBooking);

    if (window.R59?.api?.bookings?.createBooking) {
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
        status: 'confirmed'
      }).then((res: any) => {
        if (res?.data?.id || res?.id) {
          newBooking.id = res?.data?.id || res?.id;
          refreshBookingViews();
        }
      }).catch((err: any) => console.warn('[schedule] Failed to persist new booking:', err));
    }

    closeNewBooking();
    refreshBookingViews();
    window.toast?.(`Booking created for ${first} ${last}`);
  };

  if (window.R59?.confirmation?.confirmSaveBooking) {
    window.R59.confirmation.confirmSaveBooking(`${first} ${last}`, `${MONTH_NAMES[m - 1]} ${d}, ${y}`, true, onConfirm);
  } else {
    onConfirm();
  }
}

export function initScheduleListeners(): void {
  // Calendar view buttons
  ['Day', 'Week', 'Month'].forEach(v => {
    document.getElementById(`calBtn${v}`)?.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      currentCalView = v.toLowerCase();
      renderCalendar();
    });
  });

  $('#calPrev')?.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    moveCalendar(-1);
  });

  $('#calNext')?.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    moveCalendar(1);
  });

  // Block dates button
  $('#btnBlockDate')?.addEventListener('click', addBlockedDate);

  // Bookings buttons
  $('#btnAddBooking')?.addEventListener('click', openNewBooking);
  $('#btnClearCancelled')?.addEventListener('click', () => {
    const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
    const ids = bookings.filter(b => b.status === 'Cancelled').map(b => b.id);
    if (ids.length) promptClearCancelled('', ids);
  });

  // New booking modal listeners
  $('#nbCancel')?.addEventListener('click', closeNewBooking);
  $('#nbSave')?.addEventListener('click', createBooking);
  ['#nbPackage', '#nbAttendees'].forEach(sel => $(sel)?.addEventListener('input', renderNewBookingSummary));
  $('#newBookingModal')?.addEventListener('click', (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.id === 'newBookingModal') closeNewBooking();
  });

  // Edit booking modal listeners
  const bkStatusEl = $('#bkStatus') as HTMLSelectElement | null;
  if (bkStatusEl) {
    bkStatusEl.addEventListener('change', () => {
      const bookings: ScheduleBooking[] = window.R59?.state?.getBookings ? window.R59.state.getBookings() : [];
      const b = bookings.find(item => String(item.id) === String(editingBookingId));
      const warn = $('#bkRefundNote');
      if (warn) warn.style.display = (bkStatusEl.value === 'Cancelled' && b && b.status !== 'Cancelled') ? 'block' : 'none';
    });
  }
  $('#bkSave')?.addEventListener('click', saveBookingEdit);
  $('#bkCancel')?.addEventListener('click', closeBookingEditor);
  $('#bookingModal')?.addEventListener('click', (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.id === 'bookingModal') closeBookingEditor();
  });

  // Delegated click listeners for dynamically rendered cards & calendar chips
  document.addEventListener('click', (e: MouseEvent) => {
    const rawTarget = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement;
    if (!rawTarget) return;

    const openBk = rawTarget.closest<HTMLElement>('[data-open-booking]');
    if (openBk?.dataset.openBooking) {
      e.preventDefault();
      openBookingEditor(openBk.dataset.openBooking);
      return;
    }

    const editBk = rawTarget.closest<HTMLElement>('[data-edit-booking]');
    if (editBk?.dataset.editBooking) {
      e.preventDefault();
      openBookingEditor(editBk.dataset.editBooking);
      return;
    }

    const cancelBk = rawTarget.closest<HTMLElement>('[data-cancel-booking]');
    if (cancelBk?.dataset.cancelBooking) {
      e.preventDefault();
      promptCancelBooking(cancelBk.dataset.cancelBooking);
      return;
    }

    const delBk = rawTarget.closest<HTMLElement>('[data-delete-booking]');
    if (delBk?.dataset.deleteBooking) {
      e.preventDefault();
      promptRemoveBooking(delBk.dataset.deleteBooking);
      return;
    }

    const selDay = rawTarget.closest<HTMLElement>('[data-select-day]');
    if (selDay?.dataset.selectDay) {
      e.preventDefault();
      selectDayView(selDay.dataset.selectDay);
      return;
    }

    const selCalDate = rawTarget.closest<HTMLElement>('[data-select-cal-date]');
    if (selCalDate?.dataset.selectCalDate) {
      e.preventDefault();
      selectCalendarDate(selCalDate.dataset.selectCalDate);
      return;
    }

    const addTf = rawTarget.closest<HTMLElement>('[data-add-timeframe-day]');
    if (addTf?.dataset.addTimeframeDay) {
      e.preventDefault();
      showAddTimeframe(addTf.dataset.addTimeframeDay);
      return;
    }

    const saveTf = rawTarget.closest<HTMLElement>('[data-save-timeframe-day]');
    if (saveTf?.dataset.saveTimeframeDay) {
      e.preventDefault();
      saveTimeframe(saveTf.dataset.saveTimeframeDay);
      return;
    }

    const cancelTf = rawTarget.closest<HTMLElement>('[data-cancel-timeframe]');
    if (cancelTf) {
      e.preventDefault();
      cancelTimeframe();
      return;
    }

    const editTf = rawTarget.closest<HTMLElement>('[data-edit-timeframe-day]');
    if (editTf?.dataset.editTimeframeDay && editTf.dataset.editTimeframeId) {
      e.preventDefault();
      editTimeframe(editTf.dataset.editTimeframeDay, Number(editTf.dataset.editTimeframeId));
      return;
    }

    const rmTf = rawTarget.closest<HTMLElement>('[data-remove-timeframe-day]');
    if (rmTf?.dataset.removeTimeframeDay && rmTf.dataset.removeTimeframeId) {
      e.preventDefault();
      removeTimeframe(rmTf.dataset.removeTimeframeDay, Number(rmTf.dataset.removeTimeframeId));
      return;
    }

    const rmBlock = rawTarget.closest<HTMLElement>('[data-remove-block]');
    if (rmBlock?.dataset.removeBlock) {
      e.preventDefault();
      removeBlockedDate(rmBlock.dataset.removeBlock);
      return;
    }
  });

  // Keyboard activation for calendar day cells, chips, and day selectors
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const rawTarget = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement;
    if (!rawTarget) return;

    const openBk = rawTarget.closest<HTMLElement>('[data-open-booking]');
    if (openBk?.dataset.openBooking) {
      e.preventDefault();
      openBookingEditor(openBk.dataset.openBooking);
      return;
    }

    const selDay = rawTarget.closest<HTMLElement>('[data-select-day]');
    if (selDay?.dataset.selectDay) {
      e.preventDefault();
      selectDayView(selDay.dataset.selectDay);
      return;
    }

    const selCalDate = rawTarget.closest<HTMLElement>('[data-select-cal-date]');
    if (selCalDate?.dataset.selectCalDate) {
      e.preventDefault();
      selectCalendarDate(selCalDate.dataset.selectCalDate);
      return;
    }
  });
}

export const selectCalendarDate = (ds: string): void => {
  selectedDayDate = ds;
  renderCalendar();
};

export const selectDayView = (ds: string): void => {
  selectedDayDate = ds;
  currentCalView = 'day';
  renderCalendar();
};

export interface ScheduleController {
  renderCalendar: typeof renderCalendar;
  renderAvailability: typeof renderAvailability;
  renderBlockedDates: typeof renderBlockedDates;
  renderBookings: typeof renderBookings;
  refreshBookingViews: typeof refreshBookingViews;
  buildMonthGridHTML: typeof buildMonthGridHTML;
  bookingsGroupedHTML: typeof bookingsGroupedHTML;
  syncClearCancelledButtons: typeof syncClearCancelledButtons;
  selectCalendarDate: typeof selectCalendarDate;
  selectDayView: typeof selectDayView;
  showAddTimeframe: typeof showAddTimeframe;
  editTimeframe: typeof editTimeframe;
  cancelTimeframe: typeof cancelTimeframe;
  saveTimeframe: typeof saveTimeframe;
  removeTimeframe: typeof removeTimeframe;
  removeBlockedDate: typeof removeBlockedDate;
  promptRemoveBooking: typeof promptRemoveBooking;
  promptCancelBooking: typeof promptCancelBooking;
  promptClearCancelled: typeof promptClearCancelled;
  openBookingEditor: typeof openBookingEditor;
  closeBookingEditor: typeof closeBookingEditor;
  openNewBooking: typeof openNewBooking;
  closeNewBooking: typeof closeNewBooking;
  initScheduleListeners: typeof initScheduleListeners;
}

export const schedule: ScheduleController = {
  renderCalendar,
  renderAvailability,
  renderBlockedDates,
  renderBookings,
  refreshBookingViews,
  buildMonthGridHTML,
  bookingsGroupedHTML,
  syncClearCancelledButtons,
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
  openNewBooking,
  closeNewBooking,
  initScheduleListeners
};

declare global {
  interface Window {
    renderCalendar?: typeof renderCalendar;
    renderAvailability?: typeof renderAvailability;
    renderBlockedDates?: typeof renderBlockedDates;
    renderBookings?: typeof renderBookings;
    selectCalendarDate?: typeof selectCalendarDate;
    selectDayView?: typeof selectDayView;
    showAddTimeframe?: typeof showAddTimeframe;
    editTimeframe?: typeof editTimeframe;
    cancelTimeframe?: typeof cancelTimeframe;
    saveTimeframe?: typeof saveTimeframe;
    removeTimeframe?: typeof removeTimeframe;
    removeBlockedDate?: typeof removeBlockedDate;
    openBookingEditor?: typeof openBookingEditor;
    promptRemoveBooking?: typeof promptRemoveBooking;
    promptCancelBooking?: typeof promptCancelBooking;
    toast?: (message: string, duration?: number) => void;
  }
}

if (typeof window !== 'undefined') {
  window.R59 = window.R59 || {};
  window.R59.schedule = schedule;
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
}

export default schedule;
