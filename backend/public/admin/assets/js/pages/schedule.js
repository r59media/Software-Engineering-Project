(function(){"use strict";const o=t=>document.querySelector(t),Fe=t=>[...document.querySelectorAll(t)],r=t=>window.R59.formValidation?.escapeHtml(t)||String(t),P=["January","February","March","April","May","June","July","August","September","October","November","December"],ye=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];let T="month",h=V(new Date),he=100,I=null,x=null,j=null,v=null,M=null;function V(t){const e=t.getFullYear(),n=String(t.getMonth()+1).padStart(2,"0"),a=String(t.getDate()).padStart(2,"0");return`${e}-${n}-${a}`}function W(t){const[e,n,a]=t.split("-").map(Number);return new Date(e,n-1,a)}function J(t){const e=new Date(t);return e.setHours(0,0,0,0),e.setDate(e.getDate()-e.getDay()),e}function $e(t){const e=J(t);return e.setDate(e.getDate()+6),e}function De(t){return t.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}function Se(t){return t.toLocaleDateString("en-US",{month:"long",year:"numeric"})}function Re(t,e){const n=t.getFullYear()===e.getFullYear(),a=t.toLocaleDateString("en-US",{month:"short",day:"numeric"}),i=e.toLocaleDateString("en-US",{month:"short",day:"numeric",...n?{}:{year:"numeric"}});return n?`${a} \u2013 ${i}, ${e.getFullYear()}`:`${a}, ${t.getFullYear()} \u2013 ${i}`}function ie(t){if(!t)return"";const[e,n]=t.split(":").map(Number),a=e>=12?"PM":"AM",i=e%12||12;return`${String(i).padStart(2,"0")}:${String(n).padStart(2,"0")} ${a}`}function U(t){if(!t)return"";const e=String(t).trim(),n=e.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);if(n){let i=parseInt(n[1],10);const l=n[2],c=n[3].toUpperCase();return c==="PM"&&i<12&&(i+=12),c==="AM"&&i===12&&(i=0),`${String(i).padStart(2,"0")}:${l}`}const a=e.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);return a?`${String(parseInt(a[1],10)).padStart(2,"0")}:${a[2]}`:""}function E(t){const e=U(t);if(!e)return String(t||"");const[n,a]=e.split(":").map(Number);return`${n%12||12}:${String(a).padStart(2,"0")} ${n>=12?"PM":"AM"}`}function b(t){const e=Number(t||0);return"$"+e.toLocaleString("en-US",{minimumFractionDigits:Number.isInteger(e)?0:2,maximumFractionDigits:2})}const q=t=>Math.round(t*100)/100,se=t=>t.date+" "+(U(t.time)||"00:00");function L(){const t=o("#calendarDisplay"),e=o("#calActiveRange"),n=o("#calPrev"),a=o("#calNext");if(!t)return;["Day","Week","Month"].forEach(l=>{const c=document.getElementById(`calBtn${l}`);if(c){const d=T===l.toLowerCase();c.classList.toggle("active",d),c.setAttribute("aria-pressed",String(d))}});const i=W(h);if(T==="month")e&&(e.textContent=Se(i)),n&&n.setAttribute("aria-label","Previous month"),a&&a.setAttribute("aria-label","Next month"),Be(t);else if(T==="week"){const l=J(i),c=$e(i);e&&(e.textContent=Re(l,c)),n&&n.setAttribute("aria-label","Previous week"),a&&a.setAttribute("aria-label","Next week"),Ce(t)}else e&&(e.textContent=De(i).toUpperCase()),n&&n.setAttribute("aria-label","Previous day"),a&&a.setAttribute("aria-label","Next day"),xe(t)}function le(t,e,n={}){const a=new Date(t,e,1).getDay(),i=new Date(t,e+1,0).getDate(),l=Math.ceil((a+i)/7)*7,c=V(new Date),d=window.R59.state.getBookings(),u=window.R59.state.getBlockedDates();let s='<div class="cal-month-grid">';ye.forEach(f=>{s+=`<div class="cal-day-header">${f}</div>`});const p=n.chipAction==="edit"||!n.selectedStr&&!n.selectable;for(let f=0;f<l;f++){const m=new Date(t,e,f-a+1),g=V(m),k=m.getMonth()===e,S=d.filter(w=>w.date===g),D=u.find(w=>(w.dateStr||w.date)===g),R=S.length>0,$=g===n.selectedStr,B=g===c,y=p?"":` data-select-cal-date="${r(g)}"`,C=S.map(w=>{const ke=String(w.status||"pending").toLowerCase(),we=["confirmed","cancelled","pending"].includes(ke)?ke:"pending",Ne=p?`data-open-booking="${r(w.id)}"`:`data-select-day="${r(w.date)}"`;return`
          <div class="cal-event-chip ${we==="cancelled"?"cancelled":""}" role="button" tabindex="0" ${Ne} title="${r(w.customer)} (${r(w.package)})">
            <span class="cal-event-time">${r(w.time)}</span>
            <strong class="cal-event-name">${r(w.customer)}</strong>
            <span class="cal-event-pkg">${r(w.package)}</span>
            <span class="status-badge status-${we}" style="font-size: 9px; padding: 1px 5px;">${r(w.status||"Pending")}</span>
          </div>
        `}).join(""),oe=D?`
        <div class="cal-blocked-tag">Blocked: ${r(D.reason||"Unavailable")}</div>
      `:"";s+=`
        <div class="cal-day-cell ${k?"":"other-month"} ${R?"has-booking":""} ${D?"cal-blocked":""} ${$?"cal-selected":""}" role="button" tabindex="0"${y}>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="cal-day-num">${m.getDate()}</span>
            ${B?'<span class="status-badge status-available" style="font-size:9px;padding:1px 5px;">Today</span>':""}
            ${R?`<span class="hint" style="font-size: 10px; color: var(--yellow);">${S.length}</span>`:""}
          </div>
          ${oe}
          ${C}
        </div>
      `}return s+="</div>",s}function Be(t){const e=W(h);t.innerHTML=le(e.getFullYear(),e.getMonth(),{selectedStr:h,selectable:!0})}function Ce(t){const e=W(h),n=J(e),a=window.R59.state.getBookings(),i=window.R59.state.getBlockedDates(),l=Array.from({length:7},(d,u)=>{const s=new Date(n);return s.setDate(n.getDate()+u),{name:s.toLocaleDateString("en-US",{weekday:"short"}),dateNum:s.getDate(),dateStr:V(s)}});let c='<div class="cal-week-grid">';l.forEach(d=>{const u=a.filter(m=>m.date===d.dateStr),s=i.find(m=>(m.dateStr||m.date)===d.dateStr),p=h===d.dateStr,f=u.length>0?u.map(m=>{const g=String(m.status||"pending").toLowerCase(),k=["confirmed","cancelled","pending"].includes(g)?g:"pending";return`
            <div class="cal-event-chip ${k==="cancelled"?"cancelled":""}" role="button" tabindex="0" data-select-day="${r(m.date)}" style="padding: 8px;">
              <span class="cal-event-time">${r(m.timeRange||m.time)}</span>
              <strong class="cal-event-name" style="font-size: 13px;">${r(m.customer)}</strong>
              <span class="cal-event-pkg" style="font-size: 11px;">${r(m.package)}</span>
              <div style="margin-top: 4px;">
                <span class="status-badge status-${k}">${r(m.status||"Pending")}</span>
              </div>
            </div>
          `}).join(""):s?`<div class="cal-blocked-tag" style="margin-top: 10px; text-align: center;">Blocked: ${r(s.reason||"Unavailable")}</div>`:'<span class="hint" style="font-size: 12px; text-align: center; margin-top: 20px;">No bookings</span>';c+=`
        <div class="cal-week-col ${s?"cal-blocked":""} ${p?"cal-selected":""}" role="button" tabindex="0" data-select-cal-date="${r(d.dateStr)}">
          <div class="cal-week-col-head">
            <div class="cal-week-col-name">${d.name}</div>
            <div class="cal-week-col-date">${d.dateNum}</div>
          </div>
          ${f}
        </div>
      `}),c+="</div>",t.innerHTML=c}function xe(t){const e=window.R59.state.getBookings(),n=window.R59.state.getBlockedDates(),a=[...new Set(e.map(s=>s.date))],i=a.length>0?`
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
        ${a.map(s=>{const p=e.find(m=>m.date===s);return`
            <button type="button" class="btn btn-sm ${h===s?"btn-primary":""}" data-select-day="${r(s)}">
              ${r(p&&p.dateLabel||s)}
            </button>
          `}).join("")}
      </div>
    `:"",l=[{label:"09:00 AM",time24:"09:00"},{label:"10:00 AM",time24:"10:00"},{label:"11:00 AM",time24:"11:00"},{label:"12:00 PM",time24:"12:00"},{label:"01:00 PM",time24:"13:00"},{label:"02:00 PM",time24:"14:00"},{label:"03:00 PM",time24:"15:00"},{label:"04:00 PM",time24:"16:00"},{label:"05:00 PM",time24:"17:00"}],c=e.filter(s=>s.date===h),d=n.find(s=>(s.dateStr||s.date)===h);let u='<div class="cal-day-timeline">';d&&(u+=`
        <div style="background: rgba(255, 34, 34, 0.1); border: 1px solid var(--red); padding: 12px; border-radius: 6px; margin-bottom: 8px;">
          <strong style="color: var(--red);">Date Blocked:</strong> ${r(d.reason||"Unavailable")} \u2014 No bookings allowed.
        </div>
      `),l.forEach(s=>{const p=c.find(f=>{const m=U(f.time||f.start_time);if(!m)return!1;const g=parseInt(m.split(":")[0],10),k=parseInt(s.time24.split(":")[0],10);return g===k});if(p){const f=(p.status||"pending").toLowerCase(),m=["confirmed","pending","cancelled"].includes(f)?f:"pending";u+=`
          <div class="cal-timeline-row" style="border-left: 3px solid var(--yellow); background: rgba(255, 204, 34, 0.05);">
            <div class="cal-timeline-time">${s.label}</div>
            <div class="cal-timeline-content">
              <div>
                <div style="font-weight: 700; font-size: 14px;">${r(p.customer)} \u2014 ${r(p.package)}</div>
                <div class="hint">${r(p.timeRange||p.time)} \xB7 Price: ${b(p.price)} \xB7 Down Payment: ${b(p.deposit)} \xB7 Balance: ${b(p.price-p.deposit)}</div>
              </div>
              <div>
                <span class="status-badge status-${m}">${r(p.status||"Pending")}</span>
              </div>
            </div>
          </div>
        `}else u+=`
          <div class="cal-timeline-row">
            <div class="cal-timeline-time">${s.label}</div>
            <div class="cal-timeline-content">
              <span class="hint" style="color: var(--muted);">Available slot</span>
              <span class="status-badge status-available">Open</span>
            </div>
          </div>
        `}),u+="</div>",t.innerHTML=i+u}function de(t){const e=W(h);if(T==="day")e.setDate(e.getDate()+t);else if(T==="week")e.setDate(e.getDate()+t*7);else{const n=e.getDate();e.setDate(1),e.setMonth(e.getMonth()+t);const a=new Date(e.getFullYear(),e.getMonth()+1,0).getDate();e.setDate(Math.min(n,a))}h=V(e),L()}function A(){const t=o("#availabilityList");if(!t)return;const e=window.R59.state.getAvailability();t.innerHTML=e.map(n=>{const a=I===n.day,i=n.available&&n.timeframes&&n.timeframes.length>0?`
          <div class="avail-slots-list">
            ${n.timeframes.map(s=>`
              <div class="avail-slot-row">
                <div>
                  <strong>${r(s.label)}</strong>
                  <span class="tf-badge ${s.repeat==="weekly"?"tf-repeat":"tf-norepeat"}" style="margin-left: 6px;">
                    ${s.repeat==="weekly"?"Repeat weekly":"Does not repeat"}
                  </span>
                </div>
                <div class="avail-slot-actions">
                  <button type="button" class="btn btn-sm" data-edit-timeframe-day="${r(n.day)}" data-edit-timeframe-id="${Number(s.id)}" style="padding: 3px 8px; font-size: 11px;">Edit</button>
                  <button type="button" class="btn btn-danger btn-sm" data-remove-timeframe-day="${r(n.day)}" data-remove-timeframe-id="${Number(s.id)}" style="padding: 3px 8px; font-size: 11px;">Remove</button>
                </div>
              </div>
            `).join("")}
          </div>
        `:'<div class="hint" style="color: var(--muted); font-size: 13px;">Unavailable</div>';let l="weekly",c="09:00",d="17:00";if(x){const s=n.timeframes?.find(p=>p.id===x);s&&(c=s.start,d=s.end,l=s.repeat||"weekly")}const u=a?`
        <div class="timeframe-form">
          <div style="font-weight: 700; font-size: 13px; color: var(--accent-text);">
            ${x?"Edit Timeframe":"Add Timeframe"} for ${r(n.day)}
          </div>
          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            <div>
              <label class="f" style="margin: 0 0 4px; font-size: 11px;">Start Time</label>
              <input type="time" class="input" id="tfStart" style="width: auto; padding: 6px 8px;" value="${r(c)}">
            </div>
            <div>
              <label class="f" style="margin: 0 0 4px; font-size: 11px;">End Time</label>
              <input type="time" class="input" id="tfEnd" style="width: auto; padding: 6px 8px;" value="${r(d)}">
            </div>
          </div>
          <div>
            <div class="hint" style="font-weight: 600; margin-bottom: 6px; color: var(--text-soft);">Repeat:</div>
            <div style="display: flex; gap: 16px; align-items: center;">
              <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                <input type="radio" name="tfRepeat" id="tfRepeatNone" value="none" ${l==="none"?"checked":""} style="accent-color: var(--yellow);">
                Does not repeat
              </label>
              <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                <input type="radio" name="tfRepeat" id="tfRepeatWeekly" value="weekly" ${l==="weekly"?"checked":""} style="accent-color: var(--yellow);">
                Repeat weekly
              </label>
            </div>
          </div>
          <div class="row" style="gap: 8px;">
            <button type="button" class="btn btn-primary btn-sm" data-save-timeframe-day="${r(n.day)}">Save Timeframe</button>
            <button type="button" class="btn btn-sm" data-cancel-timeframe="true">Cancel</button>
          </div>
        </div>
      `:"";return`
        <div class="avail-day-card">
          <div class="avail-day-head">
            <div class="avail-day-title">
              <strong>${r(n.day)}</strong>
              <span class="status-badge ${n.available&&n.timeframes?.length>0?"status-available":"status-unavailable"}">
                ${n.available&&n.timeframes?.length>0?"Available":"Unavailable"}
              </span>
            </div>
            <button type="button" class="btn btn-sm" data-add-timeframe-day="${r(n.day)}">+ Add Timeframe</button>
          </div>
          ${i}
          ${u}
        </div>
      `}).join("")}function G(t){I=t,x=null,A()}function K(t,e){I=t,x=e,A()}function Q(){I=null,x=null,A()}function X(t){const e=o("#tfStart")?.value||"09:00",n=o("#tfEnd")?.value||"17:00",a=o('input[name="tfRepeat"]:checked')?.value||"weekly",l=window.R59.state.getAvailability().find(d=>d.day===t);if(!l)return;l.timeframes=l.timeframes||[];const c=`${ie(e)} \u2013 ${ie(n)}`;if(x){const d=l.timeframes.find(u=>u.id===x);d&&(d.start=e,d.end=n,d.label=c,d.repeat=a),window.toast("Timeframe updated")}else l.timeframes.push({id:++he,start:e,end:n,label:c,repeat:a}),l.available=!0,window.toast("Timeframe added");I=null,x=null,A(),window.R59.state.markDirty()}function Z(t,e){const a=window.R59.state.getAvailability().find(l=>l.day===t);if(!a)return;const i=a.timeframes?.find(l=>l.id===e);i&&window.R59.confirmation.confirmRemoveTimeframe(i.label,t,()=>{a.timeframes=a.timeframes.filter(l=>l.id!==e),a.timeframes.length===0&&(a.available=!1),A(),window.R59.state.markDirty(),window.toast("Timeframe removed")})}function H(){const t=o("#blockedDatesList");if(!t)return;const e=window.R59.state.getBlockedDates();if(e.length===0){t.innerHTML='<p class="hint">No dates are currently blocked.</p>';return}t.innerHTML=e.map(n=>`
      <div class="blocked-date-item">
        <div>
          <div style="font-family: var(--display); font-size: 15px; font-weight: 700; color: var(--text);">${r(n.dateFormatted||n.dateStr||n.date)}</div>
          <div class="hint" style="color: var(--muted);">${r(n.reason||"Blocked date")}</div>
        </div>
        <button type="button" class="btn btn-danger btn-sm" data-remove-block="${r(n.id)}">Remove</button>
      </div>
    `).join("")}function ee(t){const e=window.R59.state.getBlockedDates(),n=e.find(a=>String(a.id)===String(t));n&&window.R59.confirmation.confirmRemoveBlockedDate(n.dateFormatted||n.dateStr||n.date,()=>{window.R59.state.setBlockedDates(e.filter(a=>String(a.id)!==String(t))),n?.id&&window.R59.api?.schedule?.removeBlockedDate&&window.R59.api.schedule.removeBlockedDate(n.id).catch(a=>console.warn("[schedule] Failed to remove blocked date:",a)),H(),L(),window.R59.dashboard?.renderOverview&&window.R59.dashboard.renderOverview(),window.R59.state.markDirty(),window.toast("Date unblocked")})}function Le(){const t=o("#blockDateInput")?.value,e=o("#blockReasonInput")?.value.trim();if(!t||!window.R59.formValidation?.isValidISODate(t)){window.toast("Please choose a valid date to block");return}const[n,a,i]=t.split("-").map(Number),l=`${P[a-1]} ${i}, ${n}`;window.R59.confirmation.confirmBlockDate(l,()=>Me(t,e,l))}function Me(t,e,n){const a=window.R59.state.getBlockedDates(),i={id:Date.now(),date:t,dateStr:t,dateFormatted:n,reason:e||"Unavailable"};a.push(i),window.R59.api?.schedule?.addBlockedDate&&window.R59.api.schedule.addBlockedDate({date:t,reason:e||"Unavailable"}).then(d=>{d?.id&&(i.id=d.id,H())}).catch(d=>console.warn("[schedule] Failed to add blocked date:",d)),o("#blockDateInput").value="",o("#blockReasonInput").value="",H(),L(),window.R59.dashboard?.renderOverview&&window.R59.dashboard.renderOverview(),window.R59.state.markDirty();const c=window.R59.state.getBookings().filter(d=>d.date===t&&d.status!=="Cancelled").length;window.toast(c?`Date blocked \u2014 note: ${c} existing booking${c>1?"s":""} on that day ${c>1?"are":"is"} not cancelled`:"Date blocked")}function Ee(t){const e=Math.max(0,(t.price||0)-(t.deposit||0)),n=t.status==="Cancelled",a=String(t.status||"pending").toLowerCase(),i=["confirmed","cancelled","pending"].includes(a)?a:"pending";return`
      <div class="booking-item ${n?"cancelled":""}">
        <div class="booking-head">
          <div>
            <div class="booking-time">${r(t.time||"")}</div>
            <div class="booking-client">${r(t.customer||"Unknown Client")}</div>
            <div class="booking-pkg">${r(t.package||"Custom Session")}</div>
            ${t.email||t.phone?`<div class="booking-pkg">${r(t.email||"")}${t.email&&t.phone?" \xB7 ":""}${r(t.phone||"")}</div>`:""}
            ${t.location?`<div class="booking-pkg">Location: ${r(t.location)}</div>`:""}
            ${t.attendees?`<div class="booking-pkg">${t.attendees} attendee${t.attendees>1?"s":""}${t.coupon&&typeof t.coupon=="object"?` \xB7 Coupon ${r(t.coupon.code)} (\u2212${b(t.coupon.discount)})`:""}</div>`:""}
            ${t.notes?`<div class="booking-notes">Notes: ${r(t.notes)}</div>`:""}
          </div>
          <div>
            <span class="status-badge status-${i}">${r(t.status||"Pending")}</span>
          </div>
        </div>

        <div class="booking-financials">
          <div class="financial-stat">
            <span>Session Price</span>
            <b>${b(t.price)}</b>
          </div>
          <div class="financial-stat">
            <span>Down Payment</span>
            <b>${b(t.deposit)}</b>
          </div>
          <div class="financial-stat">
            <span>Remaining Balance</span>
            <b>${b(e)}</b>
          </div>
        </div>

        <div class="booking-foot">
          <button type="button" class="btn btn-sm" data-edit-booking="${r(t.id)}">Edit</button>
          ${n?`<button type="button" class="btn btn-danger btn-sm" data-delete-booking="${r(t.id)}">Remove</button>`:`<button type="button" class="btn btn-danger btn-sm" data-cancel-booking="${r(t.id)}">Cancel Booking</button>`}
        </div>
      </div>`}function re(t,e){if(!t||t.length===0)return`<p class="hint">${e}</p>`;const n=[...t].sort((i,l)=>se(i).localeCompare(se(l))),a=new Map;return n.forEach(i=>{const l=i.dateLabel||i.date;a.has(l)||a.set(l,[]),a.get(l).push(i)}),[...a.entries()].map(([i,l])=>`
      <div class="booking-group">
        <div class="booking-date-head">
          <span>${r(i)}</span>
          <span class="hint">${l.length} booking${l.length>1?"s":""}</span>
        </div>
        ${l.map(Ee).join("")}
      </div>`).join("")}function te(){const t=o("#bookingsList"),e=window.R59.state.getBookings();t&&(t.innerHTML=re(e,"No bookings scheduled.")),ce(),window.R59.dashboard?.renderOverview&&window.R59.dashboard.renderOverview()}function ce(){const e=window.R59.state.getBookings().filter(c=>c.status==="Cancelled"),n=(c,d,u)=>{const s=o(c);s&&(s.style.display=d>0?"":"none",s.textContent=`${u} (${d})`)};n("#btnClearCancelled",e.length,"Clear all cancelled");const a=window.R59.dashboard?.getYear?window.R59.dashboard.getYear():new Date().getFullYear(),i=window.R59.dashboard?.getMonth?window.R59.dashboard.getMonth():new Date().getMonth(),l=e.filter(c=>{const[d,u]=c.date.split("-").map(Number);return d===a&&u-1===i});n("#ovClearCancelled",l.length,"Clear cancelled")}function ne(t){const e=window.R59.state.getBookings(),n=e.find(a=>String(a.id)===String(t));!n||n.status!=="Cancelled"||window.R59.confirmation.confirmRemoveBooking(n,()=>{window.R59.state.setBookings(e.filter(a=>String(a.id)!==String(t))),window.R59.api?.bookings?.deleteBooking&&window.R59.api.bookings.deleteBooking(t).catch(a=>console.warn("[schedule] Failed to delete booking:",a)),N(),window.toast("Cancelled booking removed")})}function ae(t){const n=window.R59.state.getBookings().find(a=>String(a.id)===String(t));!n||n.status==="Cancelled"||window.R59.confirmation.confirmCancelBooking(n,()=>{n.status="Cancelled",window.R59.api?.bookings?.cancelBooking&&window.R59.api.bookings.cancelBooking(t).catch(a=>console.warn("[schedule] Failed to cancel booking:",a)),N(),window.toast(`Booking cancelled \u2014 ${b(n.deposit)} down payment marked for reimbursement`)})}function ue(t,e){window.R59.confirmation.confirmClearCancelled(e.length,t,()=>{const n=window.R59.state.getBookings(),a=e.map(String);window.R59.state.setBookings(n.filter(i=>!a.includes(String(i.id)))),window.R59.api?.bookings?.deleteBooking&&e.forEach(i=>{window.R59.api.bookings.deleteBooking(i).catch(l=>console.warn("[schedule] Failed to clear booking:",l))}),N(),window.toast(`${e.length} cancelled booking${e.length>1?"s":""} cleared`)})}function N(){te(),L()}function O(t){const n=window.R59.state.getBookings().find(a=>String(a.id)===String(t));n&&(j=n.id,o("#bkCustomer").value=n.customer||"",o("#bkPackage").value=n.package||"",o("#bkLocation").value=n.location||"",o("#bkNotes").value=n.notes||"",o("#bkEmail").value=n.email||"",o("#bkPhone").value=n.phone||"",o("#bkAttendees").value=n.attendees||"",o("#bkDate").value=n.date||"",o("#bkStart").value=U(n.time),o("#bkEnd").value=U(n.end_time||(n.timeRange||"").split(/[-–]/)[1]||""),o("#bkPrice").value=n.price||0,o("#bkDeposit").value=n.deposit||0,o("#bkStatus").value=n.status||"Pending",o("#bkError").textContent="",o("#bkRefundNote").style.display="none",M=document.activeElement,o("#bookingModal").classList.add("open"),o("#bkCustomer").focus())}function z(){o("#bookingModal")?.classList.remove("open"),j=null,M&&typeof M.focus=="function"&&M.focus()}function Pe(){const e=window.R59.state.getBookings().find(B=>String(B.id)===String(j));if(!e)return z();const n=o("#bkCustomer").value.trim(),a=o("#bkPackage").value.trim(),i=o("#bkDate").value,l=o("#bkStart").value,c=o("#bkEnd").value,d=parseFloat(o("#bkPrice").value),u=parseFloat(o("#bkDeposit").value),s=B=>{o("#bkError").textContent=B};if(!n)return s("Please enter the customer name.");if(!a)return s("Please enter a package.");const p=o("#bkEmail").value.trim(),f=o("#bkPhone").value.trim(),m=f&&window.R59.formValidation?.cleanPhone?window.R59.formValidation.cleanPhone(f):f,g=o("#bkAttendees").value.trim();if(p&&!window.R59.formValidation.isValidEmail(p))return s("Please enter a valid email address.");if(m&&!window.R59.formValidation.isValidPhone(m))return s("Please enter a valid phone number (10+ digits).");if(g&&!(parseInt(g,10)>=1))return s("Attendees must be at least 1.");if(!i||!window.R59.formValidation.isValidISODate(i))return s("Please choose a valid date.");const S=window.R59.state.getBlockedDates().find(B=>B.dateStr===i);if(S&&i!==e.date&&o("#bkStatus").value!=="Cancelled")return s(`That date is blocked (${S.reason||"Unavailable"}). Pick another date.`);if(!l)return s("Please choose a start time.");if(c&&c<=l)return s("End time must be after the start time.");if(!(d>=0))return s("Please enter a valid session price.");if(!(u>=0))return s("Please enter a valid down payment.");if(u>d)return s("Down payment cannot be more than the session price.");const[D,R,$]=i.split("-").map(Number);window.R59.confirmation.confirmSaveBooking(n,`${P[R-1]} ${$}, ${D}`,!1,()=>{Object.assign(e,{customer:n,package:a,date:i,email:p,phone:m,location:o("#bkLocation").value.trim(),notes:o("#bkNotes").value.trim(),attendees:g?parseInt(g,10):void 0,dateFormatted:`${P[R-1]} ${$}, ${D}`,dateLabel:`${P[R-1].toUpperCase()} ${$}, ${D}`,time:E(l),timeRange:c?`${E(l)} \u2013 ${E(c)}`:E(l),price:d,deposit:u,status:o("#bkStatus").value}),window.R59.api?.bookings?.updateBooking&&window.R59.api.bookings.updateBooking(e.id,{customer_name:e.customer,customer_email:e.email,phone:e.phone,location:e.location,notes:e.notes,attendees:e.attendees,date:e.date,startTime:l,endTime:c,price:e.price,deposit:e.deposit,status:e.status}).catch(B=>console.warn("[schedule] Failed to update booking:",B)),z(),N(),window.toast("Booking updated")})}function pe(){const t=window.R59.state.getState(),e=parseFloat(t.pricing.depositPercent);return(isNaN(e)?50:Math.min(100,Math.max(0,e)))/100}function me(){return(window.R59.state.getState().packages||[]).filter(n=>n.active)}function fe({pkgPrice:t,attendees:e,coupon:n}){const a=window.R59.state.getState(),i=parseFloat(a.pricing.baseFee)||0,l=parseFloat(a.pricing.perPerson)||0,c=l*e,d=t+i+c;let u=0;n&&(u=n.type==="percent"?d*n.amount/100:Math.min(n.amount,d)),u=q(u);const s=q(Math.max(0,d-u));return{base:i,perPerson:l,attendeeFee:c,subtotal:d,discount:u,total:s,deposit:q(s*pe())}}function ge(){const t=o("#nbPackage").value;return t==="none"?{key:"none",name:"No package",price:0,none:!0}:me().find(e=>String(e.id)===String(t))||{key:"custom",name:"Custom",price:0}}function Y(){const t=o("#nbSummary");if(!t)return;const e=ge(),n=Math.max(1,parseInt(o("#nbAttendees").value,10)||1),a=fe({pkgPrice:e.price||0,attendees:n,coupon:v});t.innerHTML=`
      ${e.none?"":`<div class="ps-row"><span>${r(e.name)} package</span><b>${b(e.price)}</b></div>`}
      <div class="ps-row"><span>Base fee</span><b>${b(a.base)}</b></div>
      <div class="ps-row"><span>Attendees (${n} \xD7 ${b(a.perPerson)})</span><b>${b(a.attendeeFee)}</b></div>
      ${v?`<div class="ps-row discount"><span>Coupon ${r(v.code)}</span><b>\u2212${b(a.discount)}</b></div>`:""}
      <div class="ps-row total"><span>Total</span><b>${b(a.total)}</b></div>
      <div class="ps-row"><span>Down payment (${Math.round(pe()*100)}%)</span><b>${b(a.deposit)}</b></div>`}function F(t,e){const n=o("#nbCouponMsg");n&&(n.textContent=t,n.style.color=e===void 0?"":e?"#4ade80":"var(--red)")}function ve(){o("#nbError").textContent="";const t=(o("#nbCoupon").value||"").trim().toUpperCase();if(!t){v=null,F("Enter a coupon code first.",!1),Y();return}const n=(window.R59.state.getState().coupons||[]).find(a=>a.code===t);n?n.active?(v=n,F(`Coupon applied: ${n.type==="percent"?n.amount+"% off":b(n.amount)+" off"}`,!0)):(v=null,F("That coupon code is not active.",!1)):(v=null,F("That coupon code does not exist.",!1)),Y()}function be(){["#nbFirst","#nbLast","#nbEmail","#nbPhone","#nbDate","#nbStart","#nbEnd","#nbCoupon","#nbLocation","#nbNotes"].forEach(n=>{const a=o(n);a&&(a.value="")}),o("#nbAttendees").value=1,v=null,F(""),o("#nbError").textContent="";const t=me(),e=o("#nbPackage");e&&(e.innerHTML=t.map(n=>`<option value="${r(n.id)}">${r(n.name)} \u2014 ${b(n.price)}</option>`).join("")+'<option value="none">No package</option>'),Y(),M=document.activeElement,o("#newBookingModal").classList.add("open"),o("#nbFirst").focus()}function _(){o("#newBookingModal")?.classList.remove("open"),M&&typeof M.focus=="function"&&M.focus()}function Te(){const t=$=>{o("#nbError").textContent=$},e=o("#nbFirst").value.trim(),n=o("#nbLast").value.trim(),a=o("#nbEmail").value.trim(),i=o("#nbPhone").value.trim(),l=i&&window.R59.formValidation?.cleanPhone?window.R59.formValidation.cleanPhone(i):i,c=parseInt(o("#nbAttendees").value,10),d=o("#nbDate").value,u=o("#nbStart").value,s=o("#nbEnd").value,p=ge(),f=o("#nbCoupon").value.trim();if(!e)return t("Please enter a first name.");if(!n)return t("Please enter a last name.");if(!window.R59.formValidation.isValidEmail(a))return t("Please enter a valid email address.");if(!window.R59.formValidation.isValidPhone(l))return t("Please enter a valid phone number (10+ digits).");if(!(c>=1))return t("Number of attendees must be at least 1.");if(!d||!window.R59.formValidation.isValidISODate(d))return t("Please choose a valid date for the booking.");if(!u)return t("Please choose a start time.");if(s&&s<=u)return t("End time must be after the start time.");if(f&&(!v||v.code!==f.toUpperCase()))return t("Click \u201CApply\u201D to use the coupon code, or clear the field.");const g=window.R59.state.getBlockedDates().find($=>$.dateStr===d);if(g)return t(`That date is blocked (${g.reason||"Unavailable"}). Unblock it first or pick another date.`);const k=fe({pkgPrice:p.price||0,attendees:c,coupon:v}),[S,D,R]=d.split("-").map(Number);window.R59.confirmation.confirmSaveBooking(`${e} ${n}`,`${P[D-1]} ${R}, ${S}`,!0,()=>{const $=window.R59.state.getBookings(),y={id:$.reduce((C,oe)=>Math.max(C,Number(oe.id)||0),0)+1,date:d,dateLabel:`${P[D-1].toUpperCase()} ${R}, ${S}`,dateFormatted:`${P[D-1]} ${R}, ${S}`,time:E(u),timeRange:s?`${E(u)} \u2013 ${E(s)}`:E(u),customer:`${e} ${n}`,firstName:e,lastName:n,email:a,phone:l,attendees:c,location:o("#nbLocation").value.trim(),notes:o("#nbNotes").value.trim(),package:p.name,price:k.total,deposit:k.deposit,coupon:v?{code:v.code,discount:k.discount}:null,status:"Confirmed"};$.push(y),window.R59.api?.bookings?.createBooking&&window.R59.api.bookings.createBooking({client_name:y.customer,client_email:y.email,phone:y.phone,location:y.location,notes:y.notes,people:y.attendees,date:y.date,startTime:u,endTime:s,packageId:p.id&&p.id!=="none"&&p.id!=="custom"?p.id:void 0,totalPrice:y.price,deposit:y.deposit,coupon:v?v.code:void 0,status:"confirmed"}).then(C=>{(C?.data?.id||C?.id)&&(y.id=C?.data?.id||C?.id,N())}).catch(C=>console.warn("[schedule] Failed to persist new booking:",C)),_(),N(),window.toast(`Booking created for ${e} ${n}`)})}function Ae(){["Day","Week","Month"].forEach(e=>{document.getElementById(`calBtn${e}`)?.addEventListener("click",n=>{n.preventDefault(),n.stopPropagation(),T=e.toLowerCase(),L()})}),o("#calPrev")?.addEventListener("click",e=>{e.preventDefault(),e.stopPropagation(),de(-1)}),o("#calNext")?.addEventListener("click",e=>{e.preventDefault(),e.stopPropagation(),de(1)}),o("#btnBlockDate")?.addEventListener("click",Le),o("#btnAddBooking")?.addEventListener("click",be),o("#btnClearCancelled")?.addEventListener("click",()=>{const n=window.R59.state.getBookings().filter(a=>a.status==="Cancelled").map(a=>a.id);n.length&&ue("",n)}),o("#nbCancel")?.addEventListener("click",_),o("#nbSave")?.addEventListener("click",Te),o("#nbApplyCoupon")?.addEventListener("click",ve),o("#nbCoupon")?.addEventListener("keydown",e=>{e.key==="Enter"&&(e.preventDefault(),ve())}),o("#nbCoupon")?.addEventListener("input",()=>{v&&o("#nbCoupon").value.trim().toUpperCase()!==v.code&&(v=null,F(""),Y())}),["#nbPackage","#nbAttendees"].forEach(e=>o(e)?.addEventListener("input",Y)),o("#newBookingModal")?.addEventListener("click",e=>{e.target.id==="newBookingModal"&&_()});const t=o("#bkStatus");t&&t.addEventListener("change",()=>{const n=window.R59.state.getBookings().find(i=>String(i.id)===String(j)),a=o("#bkRefundNote");a&&(a.style.display=t.value==="Cancelled"&&n&&n.status!=="Cancelled"?"block":"none")}),o("#bkSave")?.addEventListener("click",Pe),o("#bkCancel")?.addEventListener("click",z),o("#bookingModal")?.addEventListener("click",e=>{e.target.id==="bookingModal"&&z()}),document.addEventListener("click",e=>{const n=e.target instanceof Element?e.target:e.target?.parentElement;if(!n)return;const a=n.closest("[data-open-booking]");if(a){e.preventDefault(),O(a.dataset.openBooking);return}const i=n.closest("[data-edit-booking]");if(i){e.preventDefault(),O(i.dataset.editBooking);return}const l=n.closest("[data-cancel-booking]");if(l){e.preventDefault(),ae(l.dataset.cancelBooking);return}const c=n.closest("[data-delete-booking]");if(c){e.preventDefault(),ne(c.dataset.deleteBooking);return}const d=n.closest("[data-select-day]");if(d){e.preventDefault(),window.R59.schedule.selectDayView(d.dataset.selectDay);return}const u=n.closest("[data-select-cal-date]");if(u){e.preventDefault(),window.R59.schedule.selectCalendarDate(u.dataset.selectCalDate);return}const s=n.closest("[data-add-timeframe-day]");if(s){e.preventDefault(),G(s.dataset.addTimeframeDay);return}const p=n.closest("[data-save-timeframe-day]");if(p){e.preventDefault(),X(p.dataset.saveTimeframeDay);return}if(n.closest("[data-cancel-timeframe]")){e.preventDefault(),Q();return}const m=n.closest("[data-edit-timeframe-day]");if(m){e.preventDefault(),K(m.dataset.editTimeframeDay,Number(m.dataset.editTimeframeId));return}const g=n.closest("[data-remove-timeframe-day]");if(g){e.preventDefault(),Z(g.dataset.removeTimeframeDay,Number(g.dataset.removeTimeframeId));return}const k=n.closest("[data-remove-block]");if(k){e.preventDefault(),ee(k.dataset.removeBlock);return}}),document.addEventListener("keydown",e=>{if(e.key!=="Enter"&&e.key!==" "&&e.key!=="Spacebar")return;const n=e.target instanceof Element?e.target:e.target?.parentElement;if(!n)return;const a=n.closest("[data-open-booking]");if(a){e.preventDefault(),O(a.dataset.openBooking);return}const i=n.closest("[data-select-day]");if(i){e.preventDefault(),window.R59.schedule.selectDayView(i.dataset.selectDay);return}const l=n.closest("[data-select-cal-date]");if(l){e.preventDefault(),window.R59.schedule.selectCalendarDate(l.dataset.selectCalDate);return}})}window.R59=window.R59||{},window.R59.schedule={renderCalendar:L,renderAvailability:A,renderBlockedDates:H,renderBookings:te,refreshBookingViews:N,buildMonthGridHTML:le,bookingsGroupedHTML:re,syncClearCancelledButtons:ce,selectCalendarDate:t=>{h=t,L()},selectDayView:t=>{h=t,T="day",L()},showAddTimeframe:G,editTimeframe:K,cancelTimeframe:Q,saveTimeframe:X,removeTimeframe:Z,removeBlockedDate:ee,promptRemoveBooking:ne,promptCancelBooking:ae,promptClearCancelled:ue,openBookingEditor:O,closeBookingEditor:z,openNewBooking:be,closeNewBooking:_,initScheduleListeners:Ae},window.renderCalendar=L,window.renderAvailability=A,window.renderBlockedDates=H,window.renderBookings=te,window.selectCalendarDate=window.R59.schedule.selectCalendarDate,window.selectDayView=window.R59.schedule.selectDayView,window.showAddTimeframe=G,window.editTimeframe=K,window.cancelTimeframe=Q,window.saveTimeframe=X,window.removeTimeframe=Z,window.removeBlockedDate=ee,window.openBookingEditor=O,window.promptRemoveBooking=ne,window.promptCancelBooking=ae})();
