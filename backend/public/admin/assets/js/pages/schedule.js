(function(){"use strict";const o=t=>document.querySelector(t),Ne=t=>[...document.querySelectorAll(t)],d=t=>window.R59.formValidation?.escapeHtml(t)||String(t),F=["January","February","March","April","May","June","July","August","September","October","November","December"],ye=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];let E="month",$=V(new Date),he=100,I=null,S=null,j=null,v=null,x=null;function V(t){const e=t.getFullYear(),n=String(t.getMonth()+1).padStart(2,"0"),a=String(t.getDate()).padStart(2,"0");return`${e}-${n}-${a}`}function W(t){const[e,n,a]=t.split("-").map(Number);return new Date(e,n-1,a)}function J(t){const e=new Date(t);return e.setHours(0,0,0,0),e.setDate(e.getDate()-e.getDay()),e}function $e(t){const e=J(t);return e.setDate(e.getDate()+6),e}function De(t){return t.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}function Se(t){return t.toLocaleDateString("en-US",{month:"long",year:"numeric"})}function Re(t,e){const n=t.getFullYear()===e.getFullYear(),a=t.toLocaleDateString("en-US",{month:"short",day:"numeric"}),s=e.toLocaleDateString("en-US",{month:"short",day:"numeric",...n?{}:{year:"numeric"}});return n?`${a} \u2013 ${s}, ${e.getFullYear()}`:`${a}, ${t.getFullYear()} \u2013 ${s}`}function ie(t){if(!t)return"";const[e,n]=t.split(":").map(Number),a=e>=12?"PM":"AM",s=e%12||12;return`${String(s).padStart(2,"0")}:${String(n).padStart(2,"0")} ${a}`}function U(t){if(!t)return"";const e=String(t).trim(),n=e.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);if(n){let s=parseInt(n[1],10);const l=n[2],c=n[3].toUpperCase();return c==="PM"&&s<12&&(s+=12),c==="AM"&&s===12&&(s=0),`${String(s).padStart(2,"0")}:${l}`}const a=e.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);return a?`${String(parseInt(a[1],10)).padStart(2,"0")}:${a[2]}`:""}function L(t){const e=U(t);if(!e)return String(t||"");const[n,a]=e.split(":").map(Number);return`${n%12||12}:${String(a).padStart(2,"0")} ${n>=12?"PM":"AM"}`}function b(t){const e=Number(t||0);return"$"+e.toLocaleString("en-US",{minimumFractionDigits:Number.isInteger(e)?0:2,maximumFractionDigits:2})}const q=t=>Math.round(t*100)/100,se=t=>t.date+" "+(U(t.time)||"00:00");function R(){const t=o("#calendarDisplay"),e=o("#calActiveRange"),n=o("#calPrev"),a=o("#calNext");if(!t)return;["Day","Week","Month"].forEach(l=>{const c=document.getElementById(`calBtn${l}`);if(c){const r=E===l.toLowerCase();c.classList.toggle("active",r),c.setAttribute("aria-pressed",String(r))}});const s=W($);if(E==="month")e&&(e.textContent=Se(s)),n&&n.setAttribute("aria-label","Previous month"),a&&a.setAttribute("aria-label","Next month"),Be(t);else if(E==="week"){const l=J(s),c=$e(s);e&&(e.textContent=Re(l,c)),n&&n.setAttribute("aria-label","Previous week"),a&&a.setAttribute("aria-label","Next week"),Ce(t)}else e&&(e.textContent=De(s).toUpperCase()),n&&n.setAttribute("aria-label","Previous day"),a&&a.setAttribute("aria-label","Next day"),xe(t)}function le(t,e,n={}){const a=new Date(t,e,1).getDay(),s=new Date(t,e+1,0).getDate(),l=Math.ceil((a+s)/7)*7,c=V(new Date),r=window.R59.state.getBookings(),p=window.R59.state.getBlockedDates();let i='<div class="cal-month-grid">';ye.forEach(g=>{i+=`<div class="cal-day-header">${g}</div>`});const u=n.chipAction==="edit"||!n.selectedStr&&!n.selectable;for(let g=0;g<l;g++){const m=new Date(t,e,g-a+1),f=V(m),k=m.getMonth()===e,B=r.filter(y=>y.date===f),C=p.find(y=>(y.dateStr||y.date)===f),M=B.length>0,A=f===n.selectedStr,D=f===c,h=u?"":` data-select-cal-date="${d(f)}"`,w=B.map(y=>{const ke=String(y.status||"pending").toLowerCase(),we=["confirmed","cancelled","pending"].includes(ke)?ke:"pending",Ae=u?`data-open-booking="${d(y.id)}"`:`data-select-day="${d(y.date)}"`;return`
          <div class="cal-event-chip ${we==="cancelled"?"cancelled":""}" role="button" tabindex="0" ${Ae} title="${d(y.customer)} (${d(y.package)})">
            <span class="cal-event-time">${d(y.time)}</span>
            <strong class="cal-event-name">${d(y.customer)}</strong>
            <span class="cal-event-pkg">${d(y.package)}</span>
            <span class="status-badge status-${we}" style="font-size: 9px; padding: 1px 5px;">${d(y.status||"Pending")}</span>
          </div>
        `}).join(""),oe=C?`
        <div class="cal-blocked-tag">Blocked: ${d(C.reason||"Unavailable")}</div>
      `:"";i+=`
        <div class="cal-day-cell ${k?"":"other-month"} ${M?"has-booking":""} ${C?"cal-blocked":""} ${A?"cal-selected":""}" role="button" tabindex="0"${h}>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="cal-day-num">${m.getDate()}</span>
            ${D?'<span class="status-badge status-available" style="font-size:9px;padding:1px 5px;">Today</span>':""}
            ${M?`<span class="hint" style="font-size: 10px; color: var(--yellow);">${B.length}</span>`:""}
          </div>
          ${oe}
          ${w}
        </div>
      `}return i+="</div>",i}function Be(t){const e=W($);t.innerHTML=le(e.getFullYear(),e.getMonth(),{selectedStr:$,selectable:!0})}function Ce(t){const e=W($),n=J(e),a=window.R59.state.getBookings(),s=window.R59.state.getBlockedDates(),l=Array.from({length:7},(r,p)=>{const i=new Date(n);return i.setDate(n.getDate()+p),{name:i.toLocaleDateString("en-US",{weekday:"short"}),dateNum:i.getDate(),dateStr:V(i)}});let c='<div class="cal-week-grid">';l.forEach(r=>{const p=a.filter(m=>m.date===r.dateStr),i=s.find(m=>(m.dateStr||m.date)===r.dateStr),u=$===r.dateStr,g=p.length>0?p.map(m=>{const f=String(m.status||"pending").toLowerCase(),k=["confirmed","cancelled","pending"].includes(f)?f:"pending";return`
            <div class="cal-event-chip ${k==="cancelled"?"cancelled":""}" role="button" tabindex="0" data-select-day="${d(m.date)}" style="padding: 8px;">
              <span class="cal-event-time">${d(m.timeRange||m.time)}</span>
              <strong class="cal-event-name" style="font-size: 13px;">${d(m.customer)}</strong>
              <span class="cal-event-pkg" style="font-size: 11px;">${d(m.package)}</span>
              <div style="margin-top: 4px;">
                <span class="status-badge status-${k}">${d(m.status||"Pending")}</span>
              </div>
            </div>
          `}).join(""):i?`<div class="cal-blocked-tag" style="margin-top: 10px; text-align: center;">Blocked: ${d(i.reason||"Unavailable")}</div>`:'<span class="hint" style="font-size: 12px; text-align: center; margin-top: 20px;">No bookings</span>';c+=`
        <div class="cal-week-col ${i?"cal-blocked":""} ${u?"cal-selected":""}" role="button" tabindex="0" data-select-cal-date="${d(r.dateStr)}">
          <div class="cal-week-col-head">
            <div class="cal-week-col-name">${r.name}</div>
            <div class="cal-week-col-date">${r.dateNum}</div>
          </div>
          ${g}
        </div>
      `}),c+="</div>",t.innerHTML=c}function xe(t){const e=window.R59.state.getBookings(),n=window.R59.state.getBlockedDates(),a=[...new Set(e.map(i=>i.date))],s=a.length>0?`
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
        ${a.map(i=>{const u=e.find(m=>m.date===i);return`
            <button type="button" class="btn btn-sm ${$===i?"btn-primary":""}" data-select-day="${d(i)}">
              ${d(u&&u.dateLabel||i)}
            </button>
          `}).join("")}
      </div>
    `:"",l=[{label:"09:00 AM",time24:"09:00"},{label:"10:00 AM",time24:"10:00"},{label:"11:00 AM",time24:"11:00"},{label:"12:00 PM",time24:"12:00"},{label:"01:00 PM",time24:"13:00"},{label:"02:00 PM",time24:"14:00"},{label:"03:00 PM",time24:"15:00"},{label:"04:00 PM",time24:"16:00"},{label:"05:00 PM",time24:"17:00"}],c=e.filter(i=>i.date===$),r=n.find(i=>(i.dateStr||i.date)===$);let p='<div class="cal-day-timeline">';r&&(p+=`
        <div style="background: rgba(255, 34, 34, 0.1); border: 1px solid var(--red); padding: 12px; border-radius: 6px; margin-bottom: 8px;">
          <strong style="color: var(--red);">Date Blocked:</strong> ${d(r.reason||"Unavailable")} \u2014 No bookings allowed.
        </div>
      `),l.forEach(i=>{const u=c.find(g=>{const m=U(g.time||g.start_time);if(!m)return!1;const f=parseInt(m.split(":")[0],10),k=parseInt(i.time24.split(":")[0],10);return f===k});if(u){const g=(u.status||"pending").toLowerCase(),m=["confirmed","pending","cancelled"].includes(g)?g:"pending";p+=`
          <div class="cal-timeline-row" style="border-left: 3px solid var(--yellow); background: rgba(255, 204, 34, 0.05);">
            <div class="cal-timeline-time">${i.label}</div>
            <div class="cal-timeline-content">
              <div>
                <div style="font-weight: 700; font-size: 14px;">${d(u.customer)} \u2014 ${d(u.package)}</div>
                <div class="hint">${d(u.timeRange||u.time)} \xB7 Price: ${b(u.price)} \xB7 Down Payment: ${b(u.deposit)} \xB7 Balance: ${b(u.price-u.deposit)}</div>
              </div>
              <div>
                <span class="status-badge status-${m}">${d(u.status||"Pending")}</span>
              </div>
            </div>
          </div>
        `}else p+=`
          <div class="cal-timeline-row">
            <div class="cal-timeline-time">${i.label}</div>
            <div class="cal-timeline-content">
              <span class="hint" style="color: var(--muted);">Available slot</span>
              <span class="status-badge status-available">Open</span>
            </div>
          </div>
        `}),p+="</div>",t.innerHTML=s+p}function de(t){const e=W($);if(E==="day")e.setDate(e.getDate()+t);else if(E==="week")e.setDate(e.getDate()+t*7);else{const n=e.getDate();e.setDate(1),e.setMonth(e.getMonth()+t);const a=new Date(e.getFullYear(),e.getMonth()+1,0).getDate();e.setDate(Math.min(n,a))}$=V(e),R()}function P(){const t=o("#availabilityList");if(!t)return;const e=window.R59.state.getAvailability();t.innerHTML=e.map(n=>{const a=I===n.day,s=n.available&&n.timeframes&&n.timeframes.length>0?`
          <div class="avail-slots-list">
            ${n.timeframes.map(i=>`
              <div class="avail-slot-row">
                <div>
                  <strong>${d(i.label)}</strong>
                  <span class="tf-badge ${i.repeat==="weekly"?"tf-repeat":"tf-norepeat"}" style="margin-left: 6px;">
                    ${i.repeat==="weekly"?"Repeat weekly":"Does not repeat"}
                  </span>
                </div>
                <div class="avail-slot-actions">
                  <button type="button" class="btn btn-sm" data-edit-timeframe-day="${d(n.day)}" data-edit-timeframe-id="${Number(i.id)}" style="padding: 3px 8px; font-size: 11px;">Edit</button>
                  <button type="button" class="btn btn-danger btn-sm" data-remove-timeframe-day="${d(n.day)}" data-remove-timeframe-id="${Number(i.id)}" style="padding: 3px 8px; font-size: 11px;">Remove</button>
                </div>
              </div>
            `).join("")}
          </div>
        `:'<div class="hint" style="color: var(--muted); font-size: 13px;">Unavailable</div>';let l="weekly",c="09:00",r="17:00";if(S){const i=n.timeframes?.find(u=>u.id===S);i&&(c=i.start,r=i.end,l=i.repeat||"weekly")}const p=a?`
        <div class="timeframe-form">
          <div style="font-weight: 700; font-size: 13px; color: var(--accent-text);">
            ${S?"Edit Timeframe":"Add Timeframe"} for ${d(n.day)}
          </div>
          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            <div>
              <label class="f" style="margin: 0 0 4px; font-size: 11px;">Start Time</label>
              <input type="time" class="input" id="tfStart" style="width: auto; padding: 6px 8px;" value="${d(c)}">
            </div>
            <div>
              <label class="f" style="margin: 0 0 4px; font-size: 11px;">End Time</label>
              <input type="time" class="input" id="tfEnd" style="width: auto; padding: 6px 8px;" value="${d(r)}">
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
            <button type="button" class="btn btn-primary btn-sm" data-save-timeframe-day="${d(n.day)}">Save Timeframe</button>
            <button type="button" class="btn btn-sm" data-cancel-timeframe="true">Cancel</button>
          </div>
        </div>
      `:"";return`
        <div class="avail-day-card">
          <div class="avail-day-head">
            <div class="avail-day-title">
              <strong>${d(n.day)}</strong>
              <span class="status-badge ${n.available&&n.timeframes?.length>0?"status-available":"status-unavailable"}">
                ${n.available&&n.timeframes?.length>0?"Available":"Unavailable"}
              </span>
            </div>
            <button type="button" class="btn btn-sm" data-add-timeframe-day="${d(n.day)}">+ Add Timeframe</button>
          </div>
          ${s}
          ${p}
        </div>
      `}).join("")}function G(t){I=t,S=null,P()}function K(t,e){I=t,S=e,P()}function Q(){I=null,S=null,P()}function X(t){const e=o("#tfStart")?.value||"09:00",n=o("#tfEnd")?.value||"17:00",a=o('input[name="tfRepeat"]:checked')?.value||"weekly",l=window.R59.state.getAvailability().find(r=>r.day===t);if(!l)return;l.timeframes=l.timeframes||[];const c=`${ie(e)} \u2013 ${ie(n)}`;if(S){const r=l.timeframes.find(p=>p.id===S);r&&(r.start=e,r.end=n,r.label=c,r.repeat=a),window.toast("Timeframe updated")}else l.timeframes.push({id:++he,start:e,end:n,label:c,repeat:a}),l.available=!0,window.toast("Timeframe added");I=null,S=null,P(),window.R59.state.markDirty()}function Z(t,e){const a=window.R59.state.getAvailability().find(l=>l.day===t);if(!a)return;const s=a.timeframes?.find(l=>l.id===e);s&&window.R59.confirmation.confirmRemoveTimeframe(s.label,t,()=>{a.timeframes=a.timeframes.filter(l=>l.id!==e),a.timeframes.length===0&&(a.available=!1),P(),window.R59.state.markDirty(),window.toast("Timeframe removed")})}function H(){const t=o("#blockedDatesList");if(!t)return;const e=window.R59.state.getBlockedDates();if(e.length===0){t.innerHTML='<p class="hint">No dates are currently blocked.</p>';return}t.innerHTML=e.map(n=>`
      <div class="blocked-date-item">
        <div>
          <div style="font-family: var(--display); font-size: 15px; font-weight: 700; color: var(--text);">${d(n.dateFormatted||n.dateStr||n.date)}</div>
          <div class="hint" style="color: var(--muted);">${d(n.reason||"Blocked date")}</div>
        </div>
        <button type="button" class="btn btn-danger btn-sm" data-remove-block="${d(n.id)}">Remove</button>
      </div>
    `).join("")}function ee(t){const e=window.R59.state.getBlockedDates(),n=e.find(a=>String(a.id)===String(t));n&&window.R59.confirmation.confirmRemoveBlockedDate(n.dateFormatted||n.dateStr||n.date,()=>{window.R59.state.setBlockedDates(e.filter(a=>String(a.id)!==String(t))),n?.id&&window.R59.api?.schedule?.removeBlockedDate&&window.R59.api.schedule.removeBlockedDate(n.id).catch(a=>console.warn("[schedule] Failed to remove blocked date:",a)),H(),R(),window.R59.dashboard?.renderOverview&&window.R59.dashboard.renderOverview(),window.R59.state.markDirty(),window.toast("Date unblocked")})}function Le(){const t=o("#blockDateInput")?.value,e=o("#blockReasonInput")?.value.trim();if(!t||!window.R59.formValidation?.isValidISODate(t)){window.toast("Please choose a valid date to block");return}const[n,a,s]=t.split("-").map(Number),l=`${F[a-1]} ${s}, ${n}`,c=window.R59.state.getBlockedDates(),r={id:Date.now(),date:t,dateStr:t,dateFormatted:l,reason:e||"Unavailable"};c.push(r),window.R59.api?.schedule?.addBlockedDate&&window.R59.api.schedule.addBlockedDate({date:t,reason:e||"Unavailable"}).then(u=>{u?.id&&(r.id=u.id,H())}).catch(u=>console.warn("[schedule] Failed to add blocked date:",u)),o("#blockDateInput").value="",o("#blockReasonInput").value="",H(),R(),window.R59.dashboard?.renderOverview&&window.R59.dashboard.renderOverview(),window.R59.state.markDirty();const i=window.R59.state.getBookings().filter(u=>u.date===t&&u.status!=="Cancelled").length;window.toast(i?`Date blocked \u2014 note: ${i} existing booking${i>1?"s":""} on that day ${i>1?"are":"is"} not cancelled`:"Date blocked")}function Me(t){const e=Math.max(0,(t.price||0)-(t.deposit||0)),n=t.status==="Cancelled",a=String(t.status||"pending").toLowerCase(),s=["confirmed","cancelled","pending"].includes(a)?a:"pending";return`
      <div class="booking-item ${n?"cancelled":""}">
        <div class="booking-head">
          <div>
            <div class="booking-time">${d(t.time||"")}</div>
            <div class="booking-client">${d(t.customer||"Unknown Client")}</div>
            <div class="booking-pkg">${d(t.package||"Custom Session")}</div>
            ${t.email||t.phone?`<div class="booking-pkg">${d(t.email||"")}${t.email&&t.phone?" \xB7 ":""}${d(t.phone||"")}</div>`:""}
            ${t.location?`<div class="booking-pkg">Location: ${d(t.location)}</div>`:""}
            ${t.attendees?`<div class="booking-pkg">${t.attendees} attendee${t.attendees>1?"s":""}${t.coupon&&typeof t.coupon=="object"?` \xB7 Coupon ${d(t.coupon.code)} (\u2212${b(t.coupon.discount)})`:""}</div>`:""}
            ${t.notes?`<div class="booking-notes">Notes: ${d(t.notes)}</div>`:""}
          </div>
          <div>
            <span class="status-badge status-${s}">${d(t.status||"Pending")}</span>
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
          <button type="button" class="btn btn-sm" data-edit-booking="${d(t.id)}">Edit</button>
          ${n?`<button type="button" class="btn btn-danger btn-sm" data-delete-booking="${d(t.id)}">Remove</button>`:`<button type="button" class="btn btn-danger btn-sm" data-cancel-booking="${d(t.id)}">Cancel Booking</button>`}
        </div>
      </div>`}function re(t,e){if(!t||t.length===0)return`<p class="hint">${e}</p>`;const n=[...t].sort((s,l)=>se(s).localeCompare(se(l))),a=new Map;return n.forEach(s=>{const l=s.dateLabel||s.date;a.has(l)||a.set(l,[]),a.get(l).push(s)}),[...a.entries()].map(([s,l])=>`
      <div class="booking-group">
        <div class="booking-date-head">
          <span>${d(s)}</span>
          <span class="hint">${l.length} booking${l.length>1?"s":""}</span>
        </div>
        ${l.map(Me).join("")}
      </div>`).join("")}function te(){const t=o("#bookingsList"),e=window.R59.state.getBookings();t&&(t.innerHTML=re(e,"No bookings scheduled.")),ce(),window.R59.dashboard?.renderOverview&&window.R59.dashboard.renderOverview()}function ce(){const e=window.R59.state.getBookings().filter(c=>c.status==="Cancelled"),n=(c,r,p)=>{const i=o(c);i&&(i.style.display=r>0?"":"none",i.textContent=`${p} (${r})`)};n("#btnClearCancelled",e.length,"Clear all cancelled");const a=window.R59.dashboard?.getYear?window.R59.dashboard.getYear():new Date().getFullYear(),s=window.R59.dashboard?.getMonth?window.R59.dashboard.getMonth():new Date().getMonth(),l=e.filter(c=>{const[r,p]=c.date.split("-").map(Number);return r===a&&p-1===s});n("#ovClearCancelled",l.length,"Clear cancelled")}function ne(t){const e=window.R59.state.getBookings(),n=e.find(a=>String(a.id)===String(t));!n||n.status!=="Cancelled"||window.R59.confirmation.confirmRemoveBooking(n,()=>{window.R59.state.setBookings(e.filter(a=>String(a.id)!==String(t))),window.R59.api?.bookings?.deleteBooking&&window.R59.api.bookings.deleteBooking(t).catch(a=>console.warn("[schedule] Failed to delete booking:",a)),T(),window.toast("Cancelled booking removed")})}function ae(t){const n=window.R59.state.getBookings().find(a=>String(a.id)===String(t));!n||n.status==="Cancelled"||window.R59.confirmation.confirmCancelBooking(n,()=>{n.status="Cancelled",window.R59.api?.bookings?.cancelBooking&&window.R59.api.bookings.cancelBooking(t).catch(a=>console.warn("[schedule] Failed to cancel booking:",a)),T(),window.toast(`Booking cancelled \u2014 ${b(n.deposit)} down payment marked for reimbursement`)})}function ue(t,e){window.R59.confirmation.confirmClearCancelled(e.length,t,()=>{const n=window.R59.state.getBookings(),a=e.map(String);window.R59.state.setBookings(n.filter(s=>!a.includes(String(s.id)))),window.R59.api?.bookings?.deleteBooking&&e.forEach(s=>{window.R59.api.bookings.deleteBooking(s).catch(l=>console.warn("[schedule] Failed to clear booking:",l))}),T(),window.toast(`${e.length} cancelled booking${e.length>1?"s":""} cleared`)})}function T(){te(),R()}function O(t){const n=window.R59.state.getBookings().find(a=>String(a.id)===String(t));n&&(j=n.id,o("#bkCustomer").value=n.customer||"",o("#bkPackage").value=n.package||"",o("#bkLocation").value=n.location||"",o("#bkNotes").value=n.notes||"",o("#bkEmail").value=n.email||"",o("#bkPhone").value=n.phone||"",o("#bkAttendees").value=n.attendees||"",o("#bkDate").value=n.date||"",o("#bkStart").value=U(n.time),o("#bkEnd").value=U(n.end_time||(n.timeRange||"").split(/[-–]/)[1]||""),o("#bkPrice").value=n.price||0,o("#bkDeposit").value=n.deposit||0,o("#bkStatus").value=n.status||"Pending",o("#bkError").textContent="",o("#bkRefundNote").style.display="none",x=document.activeElement,o("#bookingModal").classList.add("open"),o("#bkCustomer").focus())}function z(){o("#bookingModal")?.classList.remove("open"),j=null,x&&typeof x.focus=="function"&&x.focus()}function Ee(){const e=window.R59.state.getBookings().find(D=>String(D.id)===String(j));if(!e)return z();const n=o("#bkCustomer").value.trim(),a=o("#bkPackage").value.trim(),s=o("#bkDate").value,l=o("#bkStart").value,c=o("#bkEnd").value,r=parseFloat(o("#bkPrice").value),p=parseFloat(o("#bkDeposit").value),i=D=>{o("#bkError").textContent=D};if(!n)return i("Please enter the customer name.");if(!a)return i("Please enter a package.");const u=o("#bkEmail").value.trim(),g=o("#bkPhone").value.trim(),m=g&&window.R59.formValidation?.cleanPhone?window.R59.formValidation.cleanPhone(g):g,f=o("#bkAttendees").value.trim();if(u&&!window.R59.formValidation.isValidEmail(u))return i("Please enter a valid email address.");if(m&&!window.R59.formValidation.isValidPhone(m))return i("Please enter a valid phone number (10+ digits).");if(f&&!(parseInt(f,10)>=1))return i("Attendees must be at least 1.");if(!s||!window.R59.formValidation.isValidISODate(s))return i("Please choose a valid date.");const B=window.R59.state.getBlockedDates().find(D=>D.dateStr===s);if(B&&s!==e.date&&o("#bkStatus").value!=="Cancelled")return i(`That date is blocked (${B.reason||"Unavailable"}). Pick another date.`);if(!l)return i("Please choose a start time.");if(c&&c<=l)return i("End time must be after the start time.");if(!(r>=0))return i("Please enter a valid session price.");if(!(p>=0))return i("Please enter a valid down payment.");if(p>r)return i("Down payment cannot be more than the session price.");const[C,M,A]=s.split("-").map(Number);Object.assign(e,{customer:n,package:a,date:s,email:u,phone:m,location:o("#bkLocation").value.trim(),notes:o("#bkNotes").value.trim(),attendees:f?parseInt(f,10):void 0,dateFormatted:`${F[M-1]} ${A}, ${C}`,dateLabel:`${F[M-1].toUpperCase()} ${A}, ${C}`,time:L(l),timeRange:c?`${L(l)} \u2013 ${L(c)}`:L(l),price:r,deposit:p,status:o("#bkStatus").value}),window.R59.api?.bookings?.updateBooking&&window.R59.api.bookings.updateBooking(e.id,{customer_name:e.customer,customer_email:e.email,phone:e.phone,location:e.location,notes:e.notes,attendees:e.attendees,date:e.date,startTime:l,endTime:c,price:e.price,deposit:e.deposit,status:e.status}).catch(D=>console.warn("[schedule] Failed to update booking:",D)),z(),T(),window.toast("Booking updated")}function pe(){const t=window.R59.state.getState(),e=parseFloat(t.pricing.depositPercent);return(isNaN(e)?50:Math.min(100,Math.max(0,e)))/100}function me(){return(window.R59.state.getState().packages||[]).filter(n=>n.active)}function ge({pkgPrice:t,attendees:e,coupon:n}){const a=window.R59.state.getState(),s=parseFloat(a.pricing.baseFee)||0,l=parseFloat(a.pricing.perPerson)||0,c=l*e,r=t+s+c;let p=0;n&&(p=n.type==="percent"?r*n.amount/100:Math.min(n.amount,r)),p=q(p);const i=q(Math.max(0,r-p));return{base:s,perPerson:l,attendeeFee:c,subtotal:r,discount:p,total:i,deposit:q(i*pe())}}function fe(){const t=o("#nbPackage").value;return t==="none"?{key:"none",name:"No package",price:0,none:!0}:me().find(e=>String(e.id)===String(t))||{key:"custom",name:"Custom",price:0}}function Y(){const t=o("#nbSummary");if(!t)return;const e=fe(),n=Math.max(1,parseInt(o("#nbAttendees").value,10)||1),a=ge({pkgPrice:e.price||0,attendees:n,coupon:v});t.innerHTML=`
      ${e.none?"":`<div class="ps-row"><span>${d(e.name)} package</span><b>${b(e.price)}</b></div>`}
      <div class="ps-row"><span>Base fee</span><b>${b(a.base)}</b></div>
      <div class="ps-row"><span>Attendees (${n} \xD7 ${b(a.perPerson)})</span><b>${b(a.attendeeFee)}</b></div>
      ${v?`<div class="ps-row discount"><span>Coupon ${d(v.code)}</span><b>\u2212${b(a.discount)}</b></div>`:""}
      <div class="ps-row total"><span>Total</span><b>${b(a.total)}</b></div>
      <div class="ps-row"><span>Down payment (${Math.round(pe()*100)}%)</span><b>${b(a.deposit)}</b></div>`}function N(t,e){const n=o("#nbCouponMsg");n&&(n.textContent=t,n.style.color=e===void 0?"":e?"#4ade80":"var(--red)")}function ve(){o("#nbError").textContent="";const t=(o("#nbCoupon").value||"").trim().toUpperCase();if(!t){v=null,N("Enter a coupon code first.",!1),Y();return}const n=(window.R59.state.getState().coupons||[]).find(a=>a.code===t);n?n.active?(v=n,N(`Coupon applied: ${n.type==="percent"?n.amount+"% off":b(n.amount)+" off"}`,!0)):(v=null,N("That coupon code is not active.",!1)):(v=null,N("That coupon code does not exist.",!1)),Y()}function be(){["#nbFirst","#nbLast","#nbEmail","#nbPhone","#nbDate","#nbStart","#nbEnd","#nbCoupon","#nbLocation","#nbNotes"].forEach(n=>{const a=o(n);a&&(a.value="")}),o("#nbAttendees").value=1,v=null,N(""),o("#nbError").textContent="";const t=me(),e=o("#nbPackage");e&&(e.innerHTML=t.map(n=>`<option value="${d(n.id)}">${d(n.name)} \u2014 ${b(n.price)}</option>`).join("")+'<option value="none">No package</option>'),Y(),x=document.activeElement,o("#newBookingModal").classList.add("open"),o("#nbFirst").focus()}function _(){o("#newBookingModal")?.classList.remove("open"),x&&typeof x.focus=="function"&&x.focus()}function Pe(){const t=w=>{o("#nbError").textContent=w},e=o("#nbFirst").value.trim(),n=o("#nbLast").value.trim(),a=o("#nbEmail").value.trim(),s=o("#nbPhone").value.trim(),l=s&&window.R59.formValidation?.cleanPhone?window.R59.formValidation.cleanPhone(s):s,c=parseInt(o("#nbAttendees").value,10),r=o("#nbDate").value,p=o("#nbStart").value,i=o("#nbEnd").value,u=fe(),g=o("#nbCoupon").value.trim();if(!e)return t("Please enter a first name.");if(!n)return t("Please enter a last name.");if(!window.R59.formValidation.isValidEmail(a))return t("Please enter a valid email address.");if(!window.R59.formValidation.isValidPhone(l))return t("Please enter a valid phone number (10+ digits).");if(!(c>=1))return t("Number of attendees must be at least 1.");if(!r||!window.R59.formValidation.isValidISODate(r))return t("Please choose a valid date for the booking.");if(!p)return t("Please choose a start time.");if(i&&i<=p)return t("End time must be after the start time.");if(g&&(!v||v.code!==g.toUpperCase()))return t("Click \u201CApply\u201D to use the coupon code, or clear the field.");const f=window.R59.state.getBlockedDates().find(w=>w.dateStr===r);if(f)return t(`That date is blocked (${f.reason||"Unavailable"}). Unblock it first or pick another date.`);const k=ge({pkgPrice:u.price||0,attendees:c,coupon:v}),[B,C,M]=r.split("-").map(Number),A=window.R59.state.getBookings(),h={id:A.reduce((w,oe)=>Math.max(w,Number(oe.id)||0),0)+1,date:r,dateLabel:`${F[C-1].toUpperCase()} ${M}, ${B}`,dateFormatted:`${F[C-1]} ${M}, ${B}`,time:L(p),timeRange:i?`${L(p)} \u2013 ${L(i)}`:L(p),customer:`${e} ${n}`,firstName:e,lastName:n,email:a,phone:l,attendees:c,location:o("#nbLocation").value.trim(),notes:o("#nbNotes").value.trim(),package:u.name,price:k.total,deposit:k.deposit,coupon:v?{code:v.code,discount:k.discount}:null,status:"Confirmed"};A.push(h),window.R59.api?.bookings?.createBooking&&window.R59.api.bookings.createBooking({client_name:h.customer,client_email:h.email,phone:h.phone,location:h.location,notes:h.notes,people:h.attendees,date:h.date,startTime:p,endTime:i,packageId:u.id&&u.id!=="none"&&u.id!=="custom"?u.id:void 0,totalPrice:h.price,deposit:h.deposit,coupon:v?v.code:void 0,status:"confirmed"}).then(w=>{(w?.data?.id||w?.id)&&(h.id=w?.data?.id||w?.id,T())}).catch(w=>console.warn("[schedule] Failed to persist new booking:",w)),_(),T(),window.toast(`Booking created for ${e} ${n}`)}function Te(){["Day","Week","Month"].forEach(e=>{document.getElementById(`calBtn${e}`)?.addEventListener("click",n=>{n.preventDefault(),n.stopPropagation(),E=e.toLowerCase(),R()})}),o("#calPrev")?.addEventListener("click",e=>{e.preventDefault(),e.stopPropagation(),de(-1)}),o("#calNext")?.addEventListener("click",e=>{e.preventDefault(),e.stopPropagation(),de(1)}),o("#btnBlockDate")?.addEventListener("click",Le),o("#btnAddBooking")?.addEventListener("click",be),o("#btnClearCancelled")?.addEventListener("click",()=>{const n=window.R59.state.getBookings().filter(a=>a.status==="Cancelled").map(a=>a.id);n.length&&ue("",n)}),o("#nbCancel")?.addEventListener("click",_),o("#nbSave")?.addEventListener("click",Pe),o("#nbApplyCoupon")?.addEventListener("click",ve),o("#nbCoupon")?.addEventListener("keydown",e=>{e.key==="Enter"&&(e.preventDefault(),ve())}),o("#nbCoupon")?.addEventListener("input",()=>{v&&o("#nbCoupon").value.trim().toUpperCase()!==v.code&&(v=null,N(""),Y())}),["#nbPackage","#nbAttendees"].forEach(e=>o(e)?.addEventListener("input",Y)),o("#newBookingModal")?.addEventListener("click",e=>{e.target.id==="newBookingModal"&&_()});const t=o("#bkStatus");t&&t.addEventListener("change",()=>{const n=window.R59.state.getBookings().find(s=>String(s.id)===String(j)),a=o("#bkRefundNote");a&&(a.style.display=t.value==="Cancelled"&&n&&n.status!=="Cancelled"?"block":"none")}),o("#bkSave")?.addEventListener("click",Ee),o("#bkCancel")?.addEventListener("click",z),o("#bookingModal")?.addEventListener("click",e=>{e.target.id==="bookingModal"&&z()}),document.addEventListener("click",e=>{const n=e.target instanceof Element?e.target:e.target?.parentElement;if(!n)return;const a=n.closest("[data-open-booking]");if(a){e.preventDefault(),O(a.dataset.openBooking);return}const s=n.closest("[data-edit-booking]");if(s){e.preventDefault(),O(s.dataset.editBooking);return}const l=n.closest("[data-cancel-booking]");if(l){e.preventDefault(),ae(l.dataset.cancelBooking);return}const c=n.closest("[data-delete-booking]");if(c){e.preventDefault(),ne(c.dataset.deleteBooking);return}const r=n.closest("[data-select-day]");if(r){e.preventDefault(),window.R59.schedule.selectDayView(r.dataset.selectDay);return}const p=n.closest("[data-select-cal-date]");if(p){e.preventDefault(),window.R59.schedule.selectCalendarDate(p.dataset.selectCalDate);return}const i=n.closest("[data-add-timeframe-day]");if(i){e.preventDefault(),G(i.dataset.addTimeframeDay);return}const u=n.closest("[data-save-timeframe-day]");if(u){e.preventDefault(),X(u.dataset.saveTimeframeDay);return}if(n.closest("[data-cancel-timeframe]")){e.preventDefault(),Q();return}const m=n.closest("[data-edit-timeframe-day]");if(m){e.preventDefault(),K(m.dataset.editTimeframeDay,Number(m.dataset.editTimeframeId));return}const f=n.closest("[data-remove-timeframe-day]");if(f){e.preventDefault(),Z(f.dataset.removeTimeframeDay,Number(f.dataset.removeTimeframeId));return}const k=n.closest("[data-remove-block]");if(k){e.preventDefault(),ee(k.dataset.removeBlock);return}}),document.addEventListener("keydown",e=>{if(e.key!=="Enter"&&e.key!==" "&&e.key!=="Spacebar")return;const n=e.target instanceof Element?e.target:e.target?.parentElement;if(!n)return;const a=n.closest("[data-open-booking]");if(a){e.preventDefault(),O(a.dataset.openBooking);return}const s=n.closest("[data-select-day]");if(s){e.preventDefault(),window.R59.schedule.selectDayView(s.dataset.selectDay);return}const l=n.closest("[data-select-cal-date]");if(l){e.preventDefault(),window.R59.schedule.selectCalendarDate(l.dataset.selectCalDate);return}})}window.R59=window.R59||{},window.R59.schedule={renderCalendar:R,renderAvailability:P,renderBlockedDates:H,renderBookings:te,refreshBookingViews:T,buildMonthGridHTML:le,bookingsGroupedHTML:re,syncClearCancelledButtons:ce,selectCalendarDate:t=>{$=t,R()},selectDayView:t=>{$=t,E="day",R()},showAddTimeframe:G,editTimeframe:K,cancelTimeframe:Q,saveTimeframe:X,removeTimeframe:Z,removeBlockedDate:ee,promptRemoveBooking:ne,promptCancelBooking:ae,promptClearCancelled:ue,openBookingEditor:O,closeBookingEditor:z,openNewBooking:be,closeNewBooking:_,initScheduleListeners:Te},window.renderCalendar=R,window.renderAvailability=P,window.renderBlockedDates=H,window.renderBookings=te,window.selectCalendarDate=window.R59.schedule.selectCalendarDate,window.selectDayView=window.R59.schedule.selectDayView,window.showAddTimeframe=G,window.editTimeframe=K,window.cancelTimeframe=Q,window.saveTimeframe=X,window.removeTimeframe=Z,window.removeBlockedDate=ee,window.openBookingEditor=O,window.promptRemoveBooking=ne,window.promptCancelBooking=ae})();
